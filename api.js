// ShopIT frontend – gemensamt API-lager (window.NTIT).
// Pratar med Express-backenden som serveras under /api på samma origin.
(() => {
  const SESSION_KEY = 'ntit_session';
  const API_BASE = '/api';
  const CATEGORIES = ['Datorer', 'Laddare', 'Kablar', 'Skärmar', 'Switchar', 'Router'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let cachedSession = null;

  function getSession() {
    try {
      if (cachedSession) return cachedSession;
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      // Credentials now live in an HttpOnly cookie. Remove legacy bearer tokens.
      if (session?.token) localStorage.removeItem(SESSION_KEY);
      return session && !session.token && UUID.test(session.school?.id || '') ? session : null;
    } catch {
      return null;
    }
  }

  function setSession(_token, school) {
    cachedSession = { school, createdAt: Date.now() };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(cachedSession)); } catch { /* cookie still works */ }
  }

  function clearSession() {
    cachedSession = null;
    try {
      for (const key of [SESSION_KEY, 'ntit_cart', 'ntit_last_invoice']) localStorage.removeItem(key);
    } catch { /* storage may be unavailable */ }
  }

  async function logout() {
    await request('/auth/logout', { method: 'POST' });
    clearSession();
  }

  function readCart() {
    let value;
    try { value = JSON.parse(localStorage.getItem('ntit_cart') || '[]'); }
    catch { return []; }
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && UUID.test(String(item.id || '')) &&
      typeof item.title === 'string' && Number.isSafeInteger(Number(item.qty)) && Number(item.qty) > 0 &&
      Number.isFinite(Number(item.price)) && Number(item.price) >= 0
    ).map(item => ({ ...item, qty: Number(item.qty), price: Number(item.price) }));
  }

  async function request(path, options = {}) {
    const headers = { Accept: 'application/json' };
    if (options.method && !['GET', 'HEAD'].includes(options.method)) headers['X-ShopIT-Request'] = '1';
    const hasBody = options.body !== undefined;
    // Utan Content-Type parsar inte express.json() kroppen – alla POST/PATCH skulle komma in tomma.
    if (hasBody) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* tomt svar */ }
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Servern svarade med felkod ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function api(path, options = {}) {
    return request(path, options);
  }

  // Multipart-uppladdning av en bildfil -> /uploads/... URL.
  async function uploadImage(file) {
    const form = new FormData();
    form.append('image', file);
    const response = await fetch(`${API_BASE}/uploads`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-ShopIT-Request': '1' },
      body: form,
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* tomt svar */ }
    if (!response.ok) {
      const error = new Error((payload && payload.error) || `Servern svarade med felkod ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return payload.url;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString('sv-SE')} kr`;
  }

  function shortId(id) {
    return typeof id === 'string' ? id.slice(0, 8) : '';
  }

  window.NTIT = {
    CATEGORIES,
    UUID,
    getSession,
    setSession,
    clearSession,
    logout,
    api,
    uploadImage,
    escapeHTML,
    money,
    shortId,
    readCart,
  };

  // Every HTML page loads api.js, including the login page.
  if (window.location?.protocol === 'file:') {
    const pages = ['login.html', 'index.html', 'profil.html', 'checkout.html', 'help.html'];
    const name = window.location.pathname.split('/').pop();
    const page = pages.includes(name) ? name : 'index.html';
    window.location.replace(`http://127.0.0.1:3000/${page}${window.location.search || ''}${window.location.hash || ''}`);
  }
})();
