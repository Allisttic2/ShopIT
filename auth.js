// Sessionsvakt + loggut-knapp, byggd ovanpå det gemensamma API-lagret (api.js).
// Servern skyddar sidorna; klienten hämtar skoluppgifter och hanterar utloggning.
(() => {
  const LOGIN_PAGE = 'login.html';
  const allowedPages = ['index.html', 'profil.html', 'checkout.html', 'help.html'];
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  const isLogin = currentPage === LOGIN_PAGE;

  if (location.protocol === 'file:') {
    // api.js has already moved this file URL to the shared backend origin.
    return;
  }

  // A valid cookie works even when localStorage has been cleared or disabled.
  NTIT.sessionReady = NTIT.api('/auth/me').then(data => {
    NTIT.setSession(null, data.school);
    if (isLogin) {
      const next = new URLSearchParams(location.search).get('next');
      location.replace(allowedPages.includes(next) ? next : 'index.html');
    }
    return data.school;
  }).catch(error => {
    if (error.status === 401) {
      NTIT.clearSession();
      if (!isLogin) location.replace(`${LOGIN_PAGE}?next=${encodeURIComponent(currentPage)}`);
    }
    return null;
  });

  if (!isLogin) {
    document.addEventListener('DOMContentLoaded', () => {
      const headerActions = document.querySelector('.header-actions');
      if (!headerActions || headerActions.querySelector('.auth-logout-btn')) return;

      const logoutButton = document.createElement('button');
      logoutButton.type = 'button';
      logoutButton.className = 'auth-logout-btn';
      logoutButton.title = 'Logga ut';
      logoutButton.setAttribute('aria-label', 'Logga ut');
      logoutButton.innerHTML = '<i class="fa-solid fa-arrow-right-from-bracket"></i>';
      logoutButton.addEventListener('click', async () => {
        logoutButton.disabled = true;
        try {
          await NTIT.logout();
          location.replace(LOGIN_PAGE);
        } catch {
          logoutButton.disabled = false;
          alert('Det gick inte att logga ut. Försök igen.');
        }
      });
      headerActions.appendChild(logoutButton);
    });
  }
})();
