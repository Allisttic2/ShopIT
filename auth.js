// Sessionsvakt + loggut-knapp, byggd ovanpå det gemensamma API-lagret (api.js).
// Kör synkront i <head> – token-validering mot servern sker i bakgrunden.
(() => {
  const LOGIN_PAGE = 'login.html';
  const PROTECTED_PAGES = ['profil.html', 'checkout.html', 'help.html'];
  const allowedPages = ['index.html', 'profil.html', 'checkout.html', 'help.html'];
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const isLogin = currentPage === LOGIN_PAGE;
  const isProtected = PROTECTED_PAGES.includes(currentPage);

  const session = NTIT.getSession();

  if (isLogin && session) {
    const next = new URLSearchParams(location.search).get('next');
    location.replace(allowedPages.includes(next) ? next : 'index.html');
    return;
  }

  if (!isLogin && !session) {
    const next = isProtected ? currentPage : 'index.html';
    location.replace(`${LOGIN_PAGE}?next=${encodeURIComponent(next)}`);
    return;
  }

  if (!isLogin) {
    // Tokenet kan vara utgånget eller ogiltigt – validera mot servern i bakgrunden.
    NTIT.api('/auth/me').catch(() => {
      NTIT.clearSession();
      const next = isProtected ? currentPage : 'index.html';
      location.replace(`${LOGIN_PAGE}?next=${encodeURIComponent(next)}`);
    });

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
        NTIT.clearSession();
        location.replace(LOGIN_PAGE);
      });
      headerActions.appendChild(logoutButton);
    });
  }
})();
