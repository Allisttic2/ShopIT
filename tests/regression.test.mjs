import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildInvoiceHtml } from '../backend/invoices.mjs';

const apiScript = readFileSync(new URL('../api.js', import.meta.url), 'utf8');
const authScript = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');

function cartReader(raw) {
  const sandbox = { window: {}, localStorage: { getItem: () => raw } };
  vm.runInNewContext(apiScript, sandbox);
  return sandbox.window.NTIT.readCart();
}

test('invalid saved carts cannot stop the homepage, profile or checkout loading', () => {
  for (const raw of ['invalid JSON', 'null', '{}', '"old cart"', '[null,{}]']) {
    assert.equal(cartReader(raw).length, 0);
  }
});

test('valid cart quantities and decimal prices survive loading', () => {
  const cart = cartReader(JSON.stringify([
    { id: '30000000-0000-4000-8000-000000000001', title: 'Laptop', qty: '2', price: '123.45' },
    { id: 'old-demo-id', title: 'Old mock item', qty: 1, price: 5 },
    { id: '30000000-0000-4000-8000-000000000002', title: 'Invalid count', qty: -1, price: 5 }
  ]));
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 2);
  assert.equal(cart[0].price, 123.45);
});

function sessionGuard({ protocol = 'http:', session = { token: 'test' }, status, page = 'profil.html' } = {}) {
  const result = { redirects: [], cleared: false };
  const sandbox = {
    location: { protocol, pathname: `/${page}`, search: '', hash: '', replace: url => result.redirects.push(url) },
    URLSearchParams,
    NTIT: {
      getSession: () => session,
      clearSession: () => { result.cleared = true; },
      setSession() {},
      api: () => status ? Promise.reject(Object.assign(new Error('Test response'), { status })) : Promise.resolve({ school: {} })
    },
    document: { addEventListener() {} }
  };
  vm.runInNewContext(authScript, sandbox);
  return result;
}

test('opening an HTML file moves to the backend origin instead of a login/index loop', () => {
  for (const page of ['login.html', 'index.html', 'profil.html']) {
    const redirects = [];
    const location = { protocol: 'file:', pathname: `/C:/ShopIt/${page}`, search: '', hash: '', replace: url => redirects.push(url) };
    const sandbox = { window: { location }, location };
    vm.runInNewContext(apiScript, sandbox);
    sandbox.NTIT = sandbox.window.NTIT;
    vm.runInNewContext(authScript, sandbox);
    assert.deepEqual(redirects, [`http://127.0.0.1:3000/${page}`]);
  }
});

test('expired sessions return the user to login', async () => {
  const result = sessionGuard({ status: 401 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.cleared, true);
  assert.deepEqual(result.redirects, ['login.html?next=profil.html']);
});

test('temporary server errors do not erase a valid session', async () => {
  const result = sessionGuard({ status: 503 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.cleared, false);
  assert.deepEqual(result.redirects, []);
});

test('a stale token on the login page cannot cause a redirect loop', async () => {
  const result = sessionGuard({ page: 'login.html', status: 401 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.cleared, true);
  assert.deepEqual(result.redirects, []);
});

test('an existing valid session can leave the login page', async () => {
  const result = sessionGuard({ page: 'login.html' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.cleared, false);
  assert.deepEqual(result.redirects, ['index.html']);
});

test('invoice HTML includes buyer, seller, quantities and preserved prices', () => {
  const html = buildInvoiceHtml({
    order: { id: 'abc123', created_at: '2026-10-21T10:00:00Z', buyer_name: 'Buyer school', buyer_billing_address: 'Buyer address', buyer_billing_reference: 'Buyer ref' },
    items: [{ product_title: '<Laptop>', seller_name: 'Seller school', seller_billing_address: 'Seller address', quantity: 2, unit_price: '123.45', line_total: '246.90' }]
  });
  assert.ok(html.includes('Buyer school') && html.includes('Buyer address') && html.includes('Buyer ref'));
  assert.ok(html.includes('Seller school') && html.includes('246,90'));
  assert.ok(html.includes('&lt;Laptop&gt;'));
});

test('all shipped frontend scripts have valid JavaScript syntax', () => {
  for (const file of ['index.html', 'profil.html', 'checkout.html', 'login.html', 'help.html']) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: file });
    }
  }
  new vm.Script(apiScript);
  new vm.Script(authScript);
});
