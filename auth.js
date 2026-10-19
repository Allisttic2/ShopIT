(() => {
  const LOGIN_PAGE = 'login.html';
  const SESSION_KEY = 'ntit_session';
  const USERS_KEY = 'ntit_users';
  const allowedPages = ['index.html', 'profil.html', 'checkout.html', 'help.html'];
  const currentPage = location.pathname.split('/').pop() || 'index.html';

  function getSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      const users = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
      return session && users.some(user => user.email === session.email) ? session : null;
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