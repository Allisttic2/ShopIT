// Opt-in integration audit. Refuses the normal app database and only writes to
// a separately configured temporary Neon branch. Not part of `npm test`.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';

const envFile = process.env.SHOPIT_ENV_FILE;
assert.ok(envFile, 'Set SHOPIT_ENV_FILE to a separate temporary-branch env file.');
const config = dotenv.parse(await readFile(envFile));
assert.equal(config.SHOPIT_INTEGRATION_TARGET, 'temporary-neon-branch');
assert.match(config.NEON_BRANCH || '', /^codex-backend-check-/);
assert.notEqual(config.NODE_ENV, 'production');
const normalizedHost = value => new URL(value).hostname.replace('-pooler.', '.');
assert.equal(normalizedHost(config.DATABASE_URL), config.SHOPIT_TEST_DATABASE_HOST);
assert.equal(normalizedHost(config.DATABASE_URL_UNPOOLED), config.SHOPIT_TEST_DATABASE_HOST);
for (const file of ['.env.local', '.env']) {
  const original = await readFile(file).catch(() => null);
  if (!original) continue;
  const settings = dotenv.parse(original);
  if (settings.DATABASE_URL) assert.notEqual(normalizedHost(config.DATABASE_URL), normalizedHost(settings.DATABASE_URL), 'Refusing to write to the regular app database.');
}
Object.assign(process.env, config, { SMTP_HOST: '', NODE_ENV: 'test' });

const { createApp } = await import('../backend/app.mjs');
const { closePool } = await import('../backend/db.mjs');
const { createDatabasePool } = await import('../database/connection.mjs');
const db = createDatabasePool({ direct: true });
const server = createApp().listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const run = `backend-check-${crypto.randomUUID()}`;
const results = [];
const uploads = [];
const outbox = new URL('../backend/mail-outbox/', import.meta.url);
const beforeMail = new Set(await readdir(outbox).catch(() => []));

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, passed: true, ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]').slice(0, 500);
    results.push({ name, passed: false, detail });
    console.log(`FAIL ${name}: ${detail.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}
async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + '/api' + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
async function register(label) {
  const response = await api('/auth/register', { method: 'POST', body: { name: `${run} ${label}`, email: `${run}-${label}@example.test`, password: config.DEMO_PASSWORD } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}
async function createListing(token, changes = {}) {
  const response = await api('/school/me/listings', { method: 'POST', token,
    body: { title: `${run} laptop`, description: 'Test description åäö', category: 'Datorer', quantity: 5, price: 123.45, ...changes } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.listing;
}
async function orderCount() { return (await db.query('SELECT count(*)::int AS count FROM shopit.orders')).rows[0].count; }
async function stock(id) { return (await db.query('SELECT p.quantity FROM shopit.products p JOIN shopit.listings l ON l.product_id=p.id WHERE l.id=$1', [id])).rows[0].quantity; }

let seller, buyer, secondSeller, listing, secondListing, order;
try {
  await check('incremental email-uniqueness migration applies safely and is repeatable', async () => {
    const sql = await readFile(new URL('../database/004_unique_school_email.sql', import.meta.url), 'utf8');
    await db.query(sql); await db.query(sql);
  });
  await check('SQL constraints, foreign keys, expiry, snapshots and rollback', async () => {
    await db.query(await readFile(new URL('../database/003_verify.sql', import.meta.url), 'utf8'));
  });
  await check('registration persists schools and supports subsequent login', async () => {
    seller = await register('seller'); buyer = await register('buyer'); secondSeller = await register('second-seller');
    const login = await api('/auth/login', { method: 'POST', body: { email: `${run}-seller@example.test`, password: config.DEMO_PASSWORD } });
    assert.equal(login.status, 200); assert.equal(login.data.school.id, seller.school.id);
    await db.query("UPDATE shopit.schools SET city='Test city', billing_address='Test billing address', billing_reference='TEST-REF' WHERE id=ANY($1)", [[seller.school.id, buyer.school.id, secondSeller.school.id]]);
  });
  await check('health and seeded listings read through the real PostgreSQL driver', async () => {
    const health = await api('/health', { token: seller.token });
    assert.equal(health.status, 200); assert.equal(health.data.ok, true); assert.equal(health.data.mail_delivery, 'outbox');
    assert.ok((await api('/listings', { token: seller.token })).data.listings.length >= 5);
  });
  await check('listing creation persists decimal prices, description and stock', async () => {
    listing = await createListing(seller.token);
    secondListing = await createListing(secondSeller.token, { title: `${run} cable`, category: 'Kablar', price: 10.25, quantity: 7 });
    const stored = (await db.query('SELECT p.description,p.quantity,l.price FROM shopit.products p JOIN shopit.listings l ON l.product_id=p.id WHERE l.id=$1', [listing.id])).rows[0];
    assert.equal(stored.description, 'Test description åäö'); assert.equal(stored.quantity, 5); assert.equal(Number(stored.price), 123.45);
  });
  await check('another school cannot edit, delete or see private inventory', async () => {
    assert.equal((await api(`/listings/${listing.id}`, { method: 'PATCH', token: buyer.token, body: { title: 'Unauthorized' } })).status, 404);
    assert.equal((await api(`/listings/${listing.id}`, { method: 'DELETE', token: buyer.token })).status, 404);
    assert.equal((await api('/school/me/inventory', { token: buyer.token })).data.products.length, 0);
  });
  await check('editing a listing persists the new title, quantity and price', async () => {
    const response = await api(`/listings/${listing.id}`, { method: 'PATCH', token: seller.token, body: { title: `${run} edited laptop`, quantity: 6, price: 100.25 } });
    assert.equal(response.status, 200); assert.equal(response.data.listing.quantity, 6); assert.equal(Number(response.data.listing.price), 100.25);
    assert.equal(await stock(listing.id), 6);
  });
  await check('image upload persists and is protected on download', async () => {
    const form = new FormData(); form.append('image', new Blob([await readFile(new URL('../images/logo.png', import.meta.url))], { type: 'image/png' }), 'backend-test.png');
    const response = await fetch(base + '/api/uploads', { method: 'POST', headers: { Authorization: `Bearer ${seller.token}` }, body: form });
    assert.equal(response.status, 201);
    const { url } = await response.json(); assert.match(url, /^\/uploads\/[0-9a-f-]+\.png$/); uploads.push(url);
    assert.equal((await fetch(base + url)).status, 401);
    const image = await fetch(base + url, { headers: { Authorization: `Bearer ${buyer.token}` } });
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png'); await image.arrayBuffer();
  });
  await check('multi-seller checkout merges repeated lines and decrements stock', async () => {
    const response = await api('/orders/checkout', { method: 'POST', token: buyer.token, body: { items: [
      { listing_id: listing.id, quantity: 1 }, { listing_id: secondListing.id, quantity: 2 }, { listing_id: listing.id, quantity: 1 },
    ] } });
    assert.equal(response.status, 201, JSON.stringify(response.data)); order = response.data.order;
    assert.equal(order.items.length, 2); assert.equal(order.total_sek, 221); assert.equal(order.email_sent, true); assert.equal(order.email_delivery, 'outbox');
    assert.equal(await stock(listing.id), 4); assert.equal(await stock(secondListing.id), 5);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM shopit.order_items WHERE order_id=$1', [order.id])).rows[0].count, 2);
  });
  await check('order history is private to the buyer and matches database totals', async () => {
    const history = (await api('/school/me/orders', { token: buyer.token })).data.orders;
    const saved = history.find(item => item.id === order.id); assert.ok(saved); assert.equal(saved.items.length, 2); assert.equal(Number(saved.total_sek), 221);
    assert.ok(!(await api('/school/me/orders', { token: seller.token })).data.orders.some(item => item.id === order.id));
  });
  await check('invoice HTML is saved with buyer, both sellers and purchased items', async () => {
    const files = (await readdir(outbox)).filter(file => !beforeMail.has(file) && file.endsWith('.html'));
    const documents = await Promise.all(files.map(file => readFile(new URL(file, outbox), 'utf8')));
    const html = documents.find(text => text.includes(order.invoice_number)); assert.ok(html);
    for (const value of [buyer.school.name, seller.school.name, secondSeller.school.name, 'Test billing address', 'TEST-REF', '221,00']) assert.ok(html.includes(value), value);
  });
  await check('PDF invoices are downloadable only by their buyer and attached to local emails', async () => {
    const get = token => fetch(base + order.invoice_url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal((await get()).status, 401); assert.equal((await get(seller.token)).status, 404);
    const response = await get(buyer.token); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/pdf');
    const pdf = Buffer.from(await response.arrayBuffer()); assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const files = (await readdir(outbox)).filter(name => !beforeMail.has(name));
    assert.ok(files.some(name => name.endsWith(`${order.invoice_number}.pdf`)));
    const emails = await Promise.all(files.filter(name => name.endsWith('.eml')).map(name => readFile(new URL(name, outbox), 'utf8')));
    assert.ok(emails.some(message => message.includes(order.invoice_number) && message.includes('Content-Type: application/pdf')));
  });
  await check('later product/school edits cannot rewrite existing invoice snapshots', async () => {
    await api(`/listings/${listing.id}`, { method: 'PATCH', token: seller.token, body: { title: 'Changed after purchase', price: 999 } });
    await db.query("UPDATE shopit.schools SET name='Changed after purchase' WHERE id=$1", [seller.school.id]);
    const stored = (await db.query('SELECT product_title,seller_name,unit_price FROM shopit.order_items WHERE order_id=$1 AND listing_id=$2', [order.id, listing.id])).rows[0];
    assert.equal(Number(stored.unit_price), 100.25); assert.equal(stored.seller_name, seller.school.name); assert.equal(stored.product_title, `${run} edited laptop`);
  });
  await check('failed multi-item checkout rolls back the entire order and stock', async () => {
    const before = await orderCount(); const beforeStock = await stock(listing.id);
    const response = await api('/orders/checkout', { method: 'POST', token: buyer.token, body: { items: [{ listing_id: listing.id, quantity: 1 }, { listing_id: secondListing.id, quantity: 999999 }] } });
    assert.equal(response.status, 409); assert.equal(await orderCount(), before); assert.equal(await stock(listing.id), beforeStock);
  });
  await check('simultaneous purchases cannot sell the final item twice', async () => {
    const last = await createListing(seller.token, { quantity: 1 });
    const responses = await Promise.all([buyer.token, secondSeller.token].map(token => api('/orders/direct', { method: 'POST', token, body: { listing_id: last.id, quantity: 1 } })));
    assert.deepEqual(responses.map(item => item.status).sort(), [201, 409]); assert.equal(await stock(last.id), 0);
    assert.equal((await api(`/listings/${last.id}`, { token: seller.token })).data.listing.status, 'sold');
  });
  await check('withdrawn listings disappear while inventory stays intact', async () => {
    const item = await createListing(seller.token);
    assert.equal((await api(`/listings/${item.id}`, { method: 'DELETE', token: seller.token })).status, 200);
    assert.ok(!(await api('/listings', { token: seller.token })).data.listings.some(row => row.id === item.id));
    assert.ok((await api('/school/me/inventory', { token: seller.token })).data.products.some(row => row.listing_id === item.id));
    assert.equal((await api('/orders/direct', { method: 'POST', token: buyer.token, body: { listing_id: item.id } })).status, 409);
  });
  await check('expired listings disappear and cannot be purchased', async () => {
    const item = await createListing(seller.token);
    await db.query("UPDATE shopit.listings SET created_at=now()-interval '31 days' WHERE id=$1", [item.id]);
    assert.ok(!(await api('/listings', { token: seller.token })).data.listings.some(row => row.id === item.id));
    assert.equal((await api('/orders/direct', { method: 'POST', token: buyer.token, body: { listing_id: item.id } })).status, 409);
  });
  await check('API category filtering returns only the requested category', async () => {
    const response = await api('/listings?category=Kablar', { token: buyer.token });
    assert.equal(response.status, 200); assert.ok(response.data.listings.length > 0);
    assert.ok(response.data.listings.every(item => item.category === 'Kablar'), 'The API ignores category=Kablar and returns other categories.');
  });
  await check('school profile changes can be saved', async () => {
    assert.equal((await api('/school/me', { method: 'PATCH', token: buyer.token, body: { city: 'Updated city' } })).status, 200);
    assert.equal((await api('/school/me', { token: buyer.token })).data.school.city, 'Updated city');
    assert.equal((await api('/school/me', { method: 'PATCH', token: buyer.token, body: { id: seller.school.id } })).status, 400);
    assert.equal((await api('/school/me', { method: 'PATCH', token: buyer.token, body: { contact_email: `${run}-seller@example.test` } })).status, 409);
  });
  await check('combined search, location, school and price filters work with sorting', async () => {
    const inventory = await api('/school/me/inventory', { method: 'POST', token: secondSeller.token, body: { title: `${run} special cable`, category: 'Kablar', quantity: 2 } });
    assert.equal(inventory.status, 201);
    const before = (await db.query('SELECT count(*)::int count FROM shopit.products')).rows[0].count;
    const path = `/school/me/inventory/${inventory.data.product.id}/listing`;
    assert.equal((await api(path, { method: 'POST', token: buyer.token, body: { price: 8.5 } })).status, 404);
    const published = await api(path, { method: 'POST', token: secondSeller.token, body: { price: 8.5 } });
    assert.equal(published.status, 201); assert.equal(published.data.listing.product_id, inventory.data.product.id);
    assert.equal((await db.query('SELECT count(*)::int count FROM shopit.products')).rows[0].count, before);
    assert.equal((await api(path, { method: 'POST', token: secondSeller.token, body: { price: 8.5 } })).status, 409);
    const combined = await api(`/listings?q=special&category=Kablar&city=Test%20city&school_id=${secondSeller.school.id}&min_price=8&max_price=9&sort=price-asc`, { token: buyer.token });
    assert.equal(combined.status, 200); assert.deepEqual(combined.data.listings.map(row => row.id), [published.data.listing.id]);
    const sorted = (await api('/listings?sort=price-desc', { token: buyer.token })).data.listings;
    assert.deepEqual(sorted.map(row => Number(row.price)), sorted.map(row => Number(row.price)).sort((a,b) => b-a));
    assert.equal((await api('/listings?sort=invalid', { token: buyer.token })).status, 400);
    assert.equal((await api('/listings?q=%27%20OR%201=1--', { token: buyer.token })).data.listings.length, 0);
  });
  await check('null stock/price values are rejected instead of becoming zero', async () => {
    const response = await api('/school/me/listings', { method: 'POST', token: seller.token, body: { title: `${run} null data`, category: 'Datorer', quantity: null, price: null } });
    assert.equal(response.status, 400, `Expected 400, got ${response.status}: null quantity/price should not silently become zero.`);
  });
  await check('invalid numeric inputs are rejected by create, edit and checkout endpoints', async () => {
    for (const value of [null, true, false, '', ' ', [], {}, 2147483648]) {
      assert.equal((await api(`/listings/${listing.id}`, { method: 'PATCH', token: seller.token, body: { quantity: value } })).status, 400);
      assert.equal((await api('/orders/direct', { method: 'POST', token: buyer.token, body: { listing_id: listing.id, quantity: value } })).status, 400);
    }
    for (const value of [null, true, '', ' ', -1, 10000000000]) {
      assert.equal((await api(`/listings/${listing.id}`, { method: 'PATCH', token: seller.token, body: { price: value } })).status, 400);
    }
  });
  await check('future-dated listings cannot be bought before they appear in the feed', async () => {
    const item = await createListing(seller.token);
    await db.query("UPDATE shopit.listings SET created_at=now()+interval '1 day' WHERE id=$1", [item.id]);
    assert.ok(!(await api('/listings', { token: buyer.token })).data.listings.some(row => row.id === item.id));
    assert.equal((await api('/orders/direct', { method: 'POST', token: buyer.token, body: { listing_id: item.id } })).status, 409);
  });
  await check('oversized image uploads return 413 rather than an internal error', async () => {
    const form = new FormData(); form.append('image', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'too-large.png');
    const response = await fetch(base + '/api/uploads', { method: 'POST', headers: { Authorization: `Bearer ${seller.token}` }, body: form });
    assert.equal(response.status, 413);
  });
  await check('concurrent registration cannot create duplicate school email addresses', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => api('/auth/register', { method: 'POST', body: { name: `${run} race`, email: `${run}-race@example.test`, password: config.DEMO_PASSWORD } })));
    const count = (await db.query('SELECT count(*)::int AS count FROM shopit.schools WHERE lower(contact_email)=lower($1)', [`${run}-race@example.test`])).rows[0].count;
    assert.equal(count, 1, `Concurrent registration created ${count} accounts for one email (responses: ${responses.map(item => item.status)}).`);
    assert.equal(responses.filter(item => item.status === 201).length, 1);
    assert.equal(responses.filter(item => item.status === 409).length, 5);
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  await closePool(); await db.end();
  for (const url of uploads) await unlink(new URL(`../backend${url}`, import.meta.url));
  const newMail = (await readdir(outbox).catch(() => [])).filter(name => !beforeMail.has(name));
  for (const file of newMail.filter(name => name.endsWith('.html'))) {
    const path = new URL(file, outbox);
    if ((await readFile(path, 'utf8')).includes(`${run}-`)) {
      const prefix = file.slice(0, -5);
      for (const related of newMail.filter(name => name === file || name === `${prefix}.eml` || name.startsWith(`${prefix}-`))) await unlink(new URL(related, outbox));
    }
  }
  const report = { checkedAt: new Date().toISOString(), branch: config.NEON_BRANCH, passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, results };
  await mkdir(new URL('../.database-validation/', import.meta.url), { recursive: true });
  await writeFile(new URL('../.database-validation/backend-check-report.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed }));
  process.exitCode = report.failed ? 1 : 0;
}
