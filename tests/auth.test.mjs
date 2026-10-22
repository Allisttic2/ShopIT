import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import vm from 'node:vm';

// Never connect to the shared database. All DB calls in this file are fixtures.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/auth_tests';
process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.DEMO_AUTH_ENABLED = 'true';
process.env.DEMO_PASSWORD = 'test-demo-password';
process.env.NODE_ENV = 'test';
delete process.env.PUBLIC_BASE_URL;

const { getPool, closePool } = await import('../backend/db.mjs');
const { createApp } = await import('../backend/app.mjs');
const { signToken, verifyToken, validateAuthConfig, setSessionCookie } = await import('../backend/auth.mjs');
const schools = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'School A', contact_email: 'a@example.test' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'School B', contact_email: 'b@example.test' },
];
const calls = [];
mock.method(getPool(), 'query', async (sql, params = []) => {
  calls.push({ sql, params });
  if (sql.includes('WHERE lower(btrim(contact_email))')) return { rows: schools.filter(s => s.contact_email === params[0].toLowerCase()) };
  if (sql.includes('FROM shopit.schools WHERE id')) return { rows: schools.filter(s => s.id === params[0]) };
  if (sql === 'SELECT 1') return { rows: [{}] };
  if (sql.includes('FROM shopit.active_listings')) return { rows: [{ id: '30000000-0000-4000-8000-000000000001', title: 'Laptop' }] };
  if (sql.includes('FROM shopit.products') || sql.includes('FROM shopit.listings') || sql.includes('FROM shopit.orders')) return { rows: [] };
  throw new Error(`Unexpected test query: ${sql}`);
});

let server, base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await closePool();
});

async function request(path, { method = 'GET', cookie, token, body, headers = {} } = {}) {
  return fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function login(email = schools[0].contact_email) {
  const response = await request('/api/auth/login', { method: 'POST', body: { email, password: process.env.DEMO_PASSWORD } });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], data: await response.json(), response };
}

test('anonymous API access is denied before any database call', async () => {
  const start = calls.length;
  for (const [method, path] of [
    ['GET', '/api/listings'], ['HEAD', '/api/listings'], ['GET', '/api/listings/30000000-0000-4000-8000-000000000001'],
    ['GET', '/api/health'], ['GET', '/api/auth/me'], ['GET', '/api/school/me'],
    ['GET', '/api/school/me/inventory'], ['GET', '/api/school/me/listings'], ['GET', '/api/school/me/orders'],
    ['POST', '/api/school/me/listings'], ['PATCH', '/api/listings/30000000-0000-4000-8000-000000000001'],
    ['DELETE', '/api/listings/30000000-0000-4000-8000-000000000001'], ['POST', '/api/uploads'],
    ['POST', '/api/orders'], ['POST', '/api/orders/direct'], ['POST', '/api/orders/checkout'],
    ['GET', '/api/future-endpoint'],
  ]) {
    const response = await request(path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls.length, start);
});

test('marketplace HTML is protected without running any JavaScript', async () => {
  for (const page of ['/', '/index.html', '/profil.html', '/checkout.html', '/help.html']) {
    const response = await request(page);
    assert.equal(response.status, 303, page);
    assert.equal(response.headers.get('location'), `/login.html?next=${page === '/' ? 'index.html' : page.slice(1)}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const asset of ['/login.html', '/login.css', '/main.css', '/api.js', '/auth.js', '/images/logo.png', '/images/hero.png']) {
    assert.equal((await request(asset)).status, 200, asset);
  }
  for (const path of ['/backend/auth.mjs', '/database/001_schema.sql', '/.env.local']) {
    assert.equal((await request(path)).status, 404, path);
  }
  assert.equal((await request('/uploads/anything.png')).status, 401);
});

test('login establishes an HttpOnly cookie that serves pages, images and school APIs', async () => {
  const { cookie, data, response } = await login();
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal(data.school.id, schools[0].id);
  assert.equal((await request('/index.html', { cookie })).status, 200);
  assert.equal((await request('/images/product-placeholder.svg', { cookie })).status, 200);
  assert.equal((await request('/uploads/missing.png', { cookie })).status, 404);
  assert.equal((await request('/api/listings', { cookie })).status, 200);
  assert.equal((await request('/api/listings', { token: data.token })).status, 200);
  assert.equal((await (await request('/api/auth/me', { cookie })).json()).school.id, schools[0].id);
});

test('the verified identity determines the school, never client supplied IDs', async () => {
  const { cookie } = await login(schools[1].contact_email);
  const response = await request(`/api/school/me?school_id=${schools[0].id}`, { cookie });
  assert.equal((await response.json()).school.id, schools[1].id);
  await request(`/api/school/me/inventory?school_id=${schools[0].id}`, { cookie });
  assert.equal(calls.at(-1).params[0], schools[1].id);
});

test('uploaded images require a session and cannot execute scripts as the viewer', async () => {
  const { cookie } = await login();
  const form = new FormData();
  form.append('image', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'], { type: 'image/svg+xml' }), 'auth-test.svg');
  const uploaded = await fetch(`${base}/api/uploads`, { method: 'POST', body: form,
    headers: { Cookie: cookie, 'X-ShopIT-Request': '1' } });
  assert.equal(uploaded.status, 201);
  const { url } = await uploaded.json();
  assert.match(url, /^\/uploads\/[0-9a-f-]+\.svg$/);
  try {
    assert.equal((await request(url)).status, 401);
    const image = await request(url, { cookie });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('cache-control'), 'no-store');
    assert.match(image.headers.get('content-security-policy'), /sandbox/);
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    await image.arrayBuffer();
  } finally {
    await unlink(new URL(`../backend${url}`, import.meta.url));
  }
});

test('bad credentials and malformed, expired, forged or deleted-school sessions are rejected', async () => {
  const badLogin = await request('/api/auth/login', { method: 'POST', body: { email: schools[0].contact_email, password: 'incorrect' } });
  assert.equal(badLogin.status, 401);
  assert.equal(badLogin.headers.get('set-cookie'), null);
  const signed = payload => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${crypto.createHmac('sha256', process.env.AUTH_SECRET).update(encoded).digest('base64url')}`;
  };
  for (const token of [
    'invalid', `${signToken(schools[0].id)}.extra`, `${signToken(schools[0].id)}!`,
    signToken(schools[0].id).replace(/^./, 'X'),
    signed({ sid: schools[0].id, mode: 'demo', exp: Date.now() - 1 }),
    signed({ sid: schools[0].id, mode: 'demo', exp: 'forever' }),
    signed({ sid: schools[0].id, exp: Date.now() + 100000 }), // legacy token
    signToken('99999999-0000-4000-8000-000000000001'),
  ]) assert.equal((await request('/api/listings', { token })).status, 401, token);
  const { cookie } = await login();
  assert.equal((await request('/api/auth/me', { cookie, token: 'invalid' })).status, 401);
});

test('cross-origin login, logout and cookie-authenticated writes are rejected', async () => {
  const { cookie } = await login();
  for (const path of ['/api/auth/login', '/api/auth/logout', '/api/orders/checkout', '/api/uploads']) {
    assert.equal((await request(path, { cookie, method: 'POST', headers: { Origin: 'https://attacker.test' } })).status, 403, path);
  }
  assert.equal((await request('/api/auth/logout', { cookie, method: 'POST' })).status, 403);
  const response = await request('/api/auth/logout', { cookie, method: 'POST', headers: { 'X-ShopIT-Request': '1' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /shopit_session=;/);
  assert.match(response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request('/api/listings')).status, 401);
});

test('demo login, registration and existing demo tokens are disabled unless explicitly enabled, and always in production', async () => {
  const token = signToken(schools[0].id);
  for (const config of [{ enabled: 'false', env: 'test' }, { enabled: 'true', env: 'production' }]) {
    process.env.DEMO_AUTH_ENABLED = config.enabled;
    process.env.NODE_ENV = config.env;
    try {
      for (const path of ['/api/auth/login', '/api/auth/register']) {
        assert.equal((await request(path, { method: 'POST', body: { email: schools[0].contact_email, password: process.env.DEMO_PASSWORD } })).status, 503);
      }
      assert.equal((await request('/api/listings', { token })).status, 401);
    } finally {
      process.env.DEMO_AUTH_ENABLED = 'true';
      process.env.NODE_ENV = 'test';
    }
  }
});

test('weak session secrets stop startup, and HTTPS session cookies are Secure', () => {
  const original = process.env.AUTH_SECRET;
  try {
    for (const value of ['', 'change-me', 'shopit-dev-only-secret']) {
      process.env.AUTH_SECRET = value;
      assert.throws(validateAuthConfig, /AUTH_SECRET/);
    }
  } finally { process.env.AUTH_SECRET = original; }
  let options;
  setSessionCookie({ secure: true }, { cookie(_name, _token, value) { options = value; } }, 'test');
  assert.equal(options.secure, true);
  assert.equal(options.httpOnly, true);
  assert.equal(verifyToken(null), null);
});

test('browser stores only school data and uses cookies, including when storage is unavailable', async () => {
  const saved = new Map();
  const fetched = [];
  const sandbox = { window: {}, localStorage: {
    getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key),
  }, fetch: async (url, options) => {
    fetched.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) };
  }};
  vm.runInNewContext(readFileSync(new URL('../api.js', import.meta.url), 'utf8'), sandbox);
  const api = sandbox.window.NTIT;
  api.setSession('secret-token', schools[0]);
  assert.ok(!saved.get('ntit_session').includes('secret-token'));
  await api.api('/listings');
  assert.equal(fetched[0].options.credentials, 'same-origin');
  assert.equal(fetched[0].options.headers.Authorization, undefined);
  saved.set('ntit_cart', 'private cart'); saved.set('ntit_last_invoice', 'private invoice');
  await api.logout();
  assert.equal(saved.size, 0);
  assert.equal(fetched.at(-1).options.headers['X-ShopIT-Request'], '1');
  sandbox.localStorage.setItem = () => { throw new Error('Storage blocked'); };
  api.setSession(null, schools[1]);
  assert.equal(api.getSession().school.id, schools[1].id);
});
