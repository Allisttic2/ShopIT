(() => {
  function readStoredJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
      if (fallback && typeof fallback === 'object') {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
      }
      return value ?? fallback;
    } catch { return fallback; }
  }

  function readCart() {
    return readStoredJSON('ntit_cart', []).filter(item =>
      item && typeof item === 'object' &&
      (typeof item.id === 'string' || Number.isSafeInteger(item.id)) &&
      typeof item.title === 'string' &&
      Number.isSafeInteger(Number(item.qty)) && Number(item.qty) > 0 &&
      Number.isFinite(Number(item.price)) && Number(item.price) >= 0
    ).map(item => ({
      ...item, qty: Number(item.qty), price: Number(item.price),
      image: typeof item.image === 'string' && item.image.startsWith('data:image/') ? item.image : ''
    }));
  }

  function writeStoredJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch { return false; }
  }

  window.ShopITStorage = Object.freeze({ read: readStoredJSON, readCart, write: writeStoredJSON });

  const LOGIN_PAGE = 'login.html';
  const SESSION_KEY = 'ntit_session';
  const USERS_KEY = 'ntit_users';
  const allowedPages = ['index.html', 'profil.html', 'checkout.html', 'help.html'];
  const currentPage = location.pathname.split('/').pop() || 'index.html';

  // File URLs can give login.html and index.html separate storage, causing a loop.
  // Use one HTTP origin for every page in the local prototype.
  if (location.protocol === 'file:') {
    const page = [LOGIN_PAGE, ...allowedPages].includes(currentPage) ? currentPage : LOGIN_PAGE;
    location.replace(`http://127.0.0.1:4173/${page}${location.search || ''}${location.hash || ''}`);
    return;
  }

  function getSession() {
    try {
      const session = readStoredJSON(SESSION_KEY, null);
      const users = readStoredJSON(USERS_KEY, []);
      return typeof session?.email === 'string' && users.some(user => user && user.email === session.email) ? session : null;
    } catch {
      return null;
    }
  }

  const session = getSession();
  if (currentPage === LOGIN_PAGE && session) {
    location.replace('index.html');
    return;
  }

  if (currentPage !== LOGIN_PAGE && !session) {
    const next = allowedPages.includes(currentPage) ? currentPage : 'index.html';
    location.replace(`${LOGIN_PAGE}?next=${encodeURIComponent(next)}`);
    return;
  }

  if (currentPage !== LOGIN_PAGE) {
    document.addEventListener('DOMContentLoaded', () => {
      const headerActions = document.querySelector('.header-actions');
      if (!headerActions || headerActions.querySelector('.auth-logout-btn')) return;

      const logoutButton = document.createElement('button');
      logoutButton.type = 'button';
      logoutButton.className = 'auth-logout-btn';
      logoutButton.title = 'Logga ut';
      logoutButton.setAttribute('aria-label', 'Logga ut');
      logoutButton.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i>';
      logoutButton.addEventListener('click', () => {
        localStorage.removeItem(SESSION_KEY);
        location.replace(LOGIN_PAGE);
      });
      headerActions.appendChild(logoutButton);
    });
  }
})();
