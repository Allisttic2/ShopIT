// ShopIT frontend – gemensamt API-lager (window.NTIT).
// Pratar med Express-backenden som serveras under /api på samma origin.
(() => {
  const SESSION_KEY = 'ntit_session';
  const API_BASE = '/api';
  const CATEGORIES = ['Datorer', 'Laddare', 'Kablar', 'Skärmar', 'Switchar', 'Router'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let cachedSession = null;

  // SCB, Kommuner i kodnummerordning 2026:
  // https://www.scb.se/contentassets/7a89e48960f741e08918e489ea36354a/kommunlankod-2026.pdf
  const countyData = [
    ['01', 'Stockholms län', 'Upplands Väsby|Vallentuna|Österåker|Värmdö|Järfälla|Ekerö|Huddinge|Botkyrka|Salem|Haninge|Tyresö|Upplands-Bro|Nykvarn|Täby|Danderyd|Sollentuna|Stockholm|Södertälje|Nacka|Sundbyberg|Solna|Lidingö|Vaxholm|Norrtälje|Sigtuna|Nynäshamn'],
    ['03', 'Uppsala län', 'Håbo|Älvkarleby|Knivsta|Heby|Tierp|Uppsala|Enköping|Östhammar'],
    ['04', 'Södermanlands län', 'Vingåker|Gnesta|Nyköping|Oxelösund|Flen|Katrineholm|Eskilstuna|Strängnäs|Trosa'],
    ['05', 'Östergötlands län', 'Ödeshög|Ydre|Kinda|Boxholm|Åtvidaberg|Finspång|Valdemarsvik|Linköping|Norrköping|Söderköping|Motala|Vadstena|Mjölby'],
    ['06', 'Jönköpings län', 'Aneby|Gnosjö|Mullsjö|Habo|Gislaved|Vaggeryd|Jönköping|Nässjö|Värnamo|Sävsjö|Vetlanda|Eksjö|Tranås'],
    ['07', 'Kronobergs län', 'Uppvidinge|Lessebo|Tingsryd|Alvesta|Älmhult|Markaryd|Växjö|Ljungby'],
    ['08', 'Kalmar län', 'Högsby|Torsås|Mörbylånga|Hultsfred|Mönsterås|Emmaboda|Kalmar|Nybro|Oskarshamn|Västervik|Vimmerby|Borgholm'],
    ['09', 'Gotlands län', 'Gotland'],
    ['10', 'Blekinge län', 'Olofström|Karlskrona|Ronneby|Karlshamn|Sölvesborg'],
    ['12', 'Skåne län', 'Svalöv|Staffanstorp|Burlöv|Vellinge|Östra Göinge|Örkelljunga|Bjuv|Kävlinge|Lomma|Svedala|Skurup|Sjöbo|Hörby|Höör|Tomelilla|Bromölla|Osby|Perstorp|Klippan|Åstorp|Båstad|Malmö|Lund|Landskrona|Helsingborg|Höganäs|Eslöv|Ystad|Trelleborg|Kristianstad|Simrishamn|Ängelholm|Hässleholm'],
    ['13', 'Hallands län', 'Hylte|Halmstad|Laholm|Falkenberg|Varberg|Kungsbacka'],
    ['14', 'Västra Götalands län', 'Härryda|Partille|Öckerö|Stenungsund|Tjörn|Orust|Sotenäs|Munkedal|Tanum|Dals-Ed|Färgelanda|Ale|Lerum|Vårgårda|Bollebygd|Grästorp|Essunga|Karlsborg|Gullspång|Tranemo|Bengtsfors|Mellerud|Lilla Edet|Mark|Svenljunga|Herrljunga|Vara|Götene|Tibro|Töreboda|Göteborg|Mölndal|Kungälv|Lysekil|Uddevalla|Strömstad|Vänersborg|Trollhättan|Alingsås|Borås|Ulricehamn|Åmål|Mariestad|Lidköping|Skara|Skövde|Hjo|Tidaholm|Falköping'],
    ['17', 'Värmlands län', 'Kil|Eda|Torsby|Storfors|Hammarö|Munkfors|Forshaga|Grums|Årjäng|Sunne|Karlstad|Kristinehamn|Filipstad|Hagfors|Arvika|Säffle'],
    ['18', 'Örebro län', 'Lekeberg|Laxå|Hallsberg|Degerfors|Hällefors|Ljusnarsberg|Örebro|Kumla|Askersund|Karlskoga|Nora|Lindesberg'],
    ['19', 'Västmanlands län', 'Skinnskatteberg|Surahammar|Kungsör|Hallstahammar|Norberg|Västerås|Sala|Fagersta|Köping|Arboga'],
    ['20', 'Dalarnas län', 'Vansbro|Malung-Sälen|Gagnef|Leksand|Rättvik|Orsa|Älvdalen|Smedjebacken|Mora|Falun|Borlänge|Säter|Hedemora|Avesta|Ludvika'],
    ['21', 'Gävleborgs län', 'Ockelbo|Hofors|Ovanåker|Nordanstig|Ljusdal|Gävle|Sandviken|Söderhamn|Bollnäs|Hudiksvall'],
    ['22', 'Västernorrlands län', 'Ånge|Timrå|Härnösand|Sundsvall|Kramfors|Sollefteå|Örnsköldsvik'],
    ['23', 'Jämtlands län', 'Ragunda|Bräcke|Krokom|Strömsund|Åre|Berg|Härjedalen|Östersund'],
    ['24', 'Västerbottens län', 'Nordmaling|Bjurholm|Vindeln|Robertsfors|Norsjö|Malå|Storuman|Sorsele|Dorotea|Vännäs|Vilhelmina|Åsele|Umeå|Lycksele|Skellefteå'],
    ['25', 'Norrbottens län', 'Arvidsjaur|Arjeplog|Jokkmokk|Överkalix|Kalix|Övertorneå|Pajala|Gällivare|Älvsbyn|Luleå|Piteå|Boden|Haparanda|Kiruna'],
  ];

  const counties = countyData.map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));
  const normalizePlace = value => (value || '').trim().normalize('NFC').toLocaleLowerCase('sv-SE');
  const countyByPlace = new Map(countyData.flatMap(([code, name, municipalities]) =>
    [name, ...municipalities.split('|')].map(place => [normalizePlace(place), code])
  ));
  // Visby is the postal town for Gotland's municipal seat.
  countyByPlace.set('visby', '09');

  function countyForListing(listing) {
    return listing.county_code || countyByPlace.get(normalizePlace(listing.city));
  }

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
    counties,
    normalizePlace,
    countyForListing,
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
