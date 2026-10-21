import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const authScript = readFileSync(new URL('../auth.js', import.meta.url), 'utf8');
const loginHTML = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const loginScript = [...loginHTML.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).find(source => source.includes("const USERS_KEY"));

function browser(initialStorage = {}, options = {}) {
  const storage = new Map(Object.entries(initialStorage));
  const elements = new Map();
  const redirects = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, hidden: false, textContent: '', innerHTML: '',
      handlers: {}, classList: { toggle() {} }, setAttribute() {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      reportValidity() { return true; }
    });
    return elements.get(id);
  };
  const storageError = () => Object.assign(new Error('Storage unavailable'), { name: 'SecurityError' });
  const sandbox = {
    console, Uint8Array, TextEncoder, URLSearchParams, btoa, atob,
    crypto: options.noCrypto ? {} : webcrypto,
    location: { pathname: '/login.html', search: options.search || '', replace(url) { redirects.push(url); } },
    document: { getElementById: element, addEventListener() {} },
    localStorage: {
      getItem(key) { if (options.blockedStorage) throw storageError(); return storage.get(key) ?? null; },
      setItem(key, value) {
        if (options.blockedStorage) throw storageError();
        if (options.fullStorage) throw Object.assign(new Error('Full'), { name: 'QuotaExceededError' });
        storage.set(key, value);
      },
      removeItem(key) { storage.delete(key); }
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(authScript, sandbox);
  vm.runInNewContext(loginScript, sandbox);

  async function submit({ register = false, email = 'test@example.invalid', password = 'Demo-password-483!', name = 'Test school' } = {}) {
    element(register ? 'registerTab' : 'loginTab').handlers.click();
    element('email').value = email;
    element('password').value = password;
    element('fullName').value = name;
    element('confirmPassword').value = password;
    await element('authForm').handlers.submit({ preventDefault() {} });
  }
  return { storage, element, redirects, submit, api: sandbox.ShopITStorage };
}

test('account creation and existing password login preserve the intended page', async () => {
  const first = browser({}, { search: '?next=profil.html' });
  await first.submit({ register: true, email: ' TEST@example.invalid ' });
  assert.equal(first.redirects.at(-1), 'profil.html');
  const users = JSON.parse(first.storage.get('ntit_users'));
  assert.equal(users[0].email, 'test@example.invalid');
  assert.ok(users[0].salt && users[0].passwordHash);
  assert.equal(users[0].password, undefined);

  const login = browser({ ntit_users: first.storage.get('ntit_users') });
  await login.submit();
  assert.equal(login.redirects.at(-1), 'index.html');
  assert.equal(JSON.parse(login.storage.get('ntit_session')).email, 'test@example.invalid');
});

test('wrong passwords and duplicate accounts do not create sessions or replace accounts', async () => {
  const registered = browser();
  await registered.submit({ register: true });
  const savedUsers = registered.storage.get('ntit_users');
  const login = browser({ ntit_users: savedUsers });
  await login.submit({ password: 'Incorrect-password' });
  assert.equal(login.redirects.length, 0);
  assert.equal(login.storage.has('ntit_session'), false);
  assert.match(login.element('authMessage').textContent, /lösenordet stämmer inte/);
  await login.submit({ register: true });
  assert.equal(login.storage.get('ntit_users'), savedUsers);
  assert.match(login.element('authMessage').textContent, /redan ett konto/);
});

test('corrupt account data displays an error and stays intact', async () => {
  for (const raw of ['{invalid', 'null', '{}', '[null]']) {
    const app = browser({ ntit_users: raw });
    await app.submit({ register: true });
    assert.equal(app.redirects.length, 0);
    assert.equal(app.storage.get('ntit_users'), raw);
    assert.equal(app.element('authMessage').hidden, false);
    assert.equal(app.element('authSubmit').disabled, false);
  }
});

test('blocked/full storage and unavailable Web Crypto leave the login form usable', async () => {
  for (const options of [{ blockedStorage: true }, { fullStorage: true }, { noCrypto: true }]) {
    const app = browser({}, options);
    await app.submit({ register: true });
    assert.equal(app.redirects.length, 0);
    assert.equal(app.element('authMessage').hidden, false);
    assert.equal(app.element('authSubmit').disabled, false);
    assert.equal(app.element('registerTab').disabled, false);
    assert.equal(app.element('loginTab').disabled, false);
    assert.doesNotMatch(app.element('authMessage').textContent, /importKey|TypeError/);
    if (options.noCrypto) assert.match(app.element('authMessage').textContent, /HTTPS/);
  }
});

test('corrupt cart data cannot crash the page reached after login', () => {
  for (const raw of ['{invalid', 'null', '{}', '"old cart"', '[null, {}, 4]']) {
    const app = browser({ ntit_cart: raw });
    assert.equal(app.api.readCart().length, 0);
  }
  const app = browser({
    ntit_cart: JSON.stringify([
      { id: 1, title: 'Laptop', qty: '2', price: '123.45' },
      { id: 2, title: 'Invalid price', qty: 1, price: 'no' },
      { id: 3, title: 'Invalid quantity', qty: -1, price: 5 }
    ]),
    ntit_inventory: '{}', ntit_school_info: '[]'
  });
  const cart = app.api.readCart();
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 2);
  assert.equal(cart[0].price, 123.45);
  assert.equal(app.api.read('ntit_inventory', []).length, 0);
  assert.equal(Object.keys(app.api.read('ntit_school_info', {})).length, 0);
  assert.equal(browser({}, { blockedStorage: true }).api.write('ntit_cart', []), false);
});

test('all frontend scripts parse', () => {
  for (const file of ['index.html', 'profil.html', 'checkout.html', 'help.html', 'login.html']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) new vm.Script(match[1], { filename: file });
    }
  }
});

test('file URLs leave file-specific storage before any login/index redirect', () => {
  for (const page of ['login.html', 'index.html', 'profil.html']) {
    const redirects = [];
    const sandbox = {
      window: {},
      location: {
        protocol: 'file:', pathname: `/C:/ShopIt/${page}`, search: '?next=profil.html', hash: '',
        replace(url) { redirects.push(url); }
      },
      localStorage: { getItem() { throw new Error('File storage must not be consulted'); } }
    };
    vm.runInNewContext(authScript, sandbox);
    assert.deepEqual(redirects, [`http://127.0.0.1:4173/${page}?next=profil.html`]);
  }
});
