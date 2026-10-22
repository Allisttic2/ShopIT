# ShopIT backend

Lokal Node.js/Express-backend som servar API:et (`/api`) och den färdiga statiska frontenden – hela demon körs på en enda origin.

## Starta

```bash
npm install
cp .env.example .env   # fyll i DATABASE_URL (se nedan) och AUTH_SECRET
```

Databasen körs på **Neon**. Använd projektets befintliga `.env.local`, eller konfigurera `DATABASE_URL` och `DATABASE_URL_UNPOOLED` med anslutningsuppgifterna från Neon. `.env.local` läses före `.env`. Behåll befintliga anslutningsuppgifter om de redan är konfigurerade. Schema och seed är redan installerade på `production`.

Kontrollera anslutningen med `npm run db:status`.

Kör `npm run db:upgrade` för den inkrementella migreringen `004_unique_school_email.sql`. Den förhindrar dubbla e-postadresser även vid samtidiga registreringar och kan köras igen. Befintliga dubbletter stoppar migreringen för manuell granskning; inga konton raderas. För en ny tom databas: kör först `db:migrate`, sedan `db:upgrade` och `db:seed`. Kör inte om initialschemat mot befintlig data.

Kör sedan:

```bash
npm start        # eller: npm run dev (auto-restart vid ändringar)
```

App: http://localhost:3000 · Hälsocheck (kräver session): http://localhost:3000/api/health

`AUTH_SECRET` krävs och måste vara minst 32 byte. Generera ett privat värde med `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` och spara det i din lokala miljöfil. Gamla sessioner måste logga in igen efter denna auth-uppdatering.

Inloggningen är avstängd tills SchoolSoft är inkopplat eller en **lokal demo uttryckligen aktiverats** med `DEMO_AUTH_ENABLED=true` och ett eget `DEMO_PASSWORD` (minst 8 tecken). Demo-läget accepteras aldrig med `NODE_ENV=production`, inte heller redan utfärdade demosessioner. Aktivera det endast för test/demonstration; det uppfyller inte SchoolSoft-kravet. Se [SchoolSoft-utredningen och nästa steg](SCHOOLSOFT.md).

## API

Alla API-svar är JSON. Webbläsaren använder en `HttpOnly`-cookie (`SameSite=Lax`, `Secure` vid HTTPS/produktion); inga sessionstoken sparas i localStorage. API-klienter kan använda `Authorization: Bearer <token>` från demo-inloggningen. Alla API-rutter kräver session förutom POST till login, register och logout. Alla marknadsplatssidor och uppladdade bilder kontrolleras även på servern. API, skyddade sidor och uppladdningar skickas med `Cache-Control: no-store`.

Skrivningar från webbläsaren måste komma från samma origin. Vid cookie-anrop utan `Origin` krävs `X-ShopIT-Request: 1`; frontend skickar detta automatiskt. `PUBLIC_BASE_URL` ska matcha den publika HTTPS-adressen bakom en proxy.

Utloggning rensar cookien och lokalt sparad skolinfo, varukorg och senaste faktura. Demo-token är signerade och giltiga i högst sju dagar: utloggning återkallar inte en redan kopierad Bearer-token. Avstängt demo-läge/produktion ogiltigförklarar alla demo-token; rotation av `AUTH_SECRET` ogiltigförklarar alla token. Serverlagrad sessionsåterkallelse behöver lösas med den riktiga SSO-integrationen.

| Metod | Sökväg | Auth | Beskrivning |
| --- | --- | --- | --- |
| GET | `/api/health` | ✓ | Databasanslutning + mailleveransläge |
| GET | `/api/listings` | ✓ | Aktiva annonser (förstasidans grid). 30-dagarstiden hanteras av vyn `active_listings` – utgångna annonser försvinner automatiskt utan jobbskriver. |
| GET | `/api/listings/:id` | ✓ | Detaljsida: bild, titel, pris, antal, beskrivning, skola, status |
| POST | `/api/auth/login` | – | `{email, password}` – endast i uttryckligen aktiverat lokalt demo-läge |
| POST | `/api/auth/register` | – | `{name, email, password}` – skapar en ny skola (demonivå; SchoolSoft-kopplingen ersätter detta senare) |
| POST | `/api/auth/logout` | – | Rensar sessionscookien; origin-skydd gäller även här |
| GET | `/api/auth/me` | ✓ | Verifierad skola från sessionen, aldrig från klientens skol-ID |
| GET | `/api/school/me` | ✓ | Skolans info för ”Min sida” (namn, adresser, faktureringsuppgifter) |
| PATCH | `/api/school/me` | ✓ | Uppdatera egna skolans namn, ort, adresser, referens och kontakt-e-post. Skol-ID kan inte ändras. |
| GET | `/api/school/me/inventory` | ✓ | Inventarie: alla skolans produkter, oavsett annonsstatus |
| POST | `/api/school/me/inventory` | ✓ | Skapa inventarie utan annons: `{title, description, category, quantity, image_url}` |
| POST | `/api/school/me/inventory/:id/listing` | ✓ (ägare) | Publicera befintlig inventarie med `{price}` utan ny produkt. Kräver saldo och att annons saknas. |
| GET | `/api/school/me/listings` | ✓ | Egna annonser med status (`active`/`withdrawn`/`sold`/`expired`) |
| POST | `/api/school/me/listings` | ✓ | Ny annons: `{title, description, category, quantity, price, image_url}` |
| POST | `/api/school/me/listings` | ✓ (ägare) | Alternativt `{product_id, price}` för en befintlig inventarie. |
| PATCH | `/api/listings/:id` | ✓ (ägare) | Redigera annons: `title`, `description`, `category`, `quantity`, `price`, `image_url` |
| DELETE | `/api/listings/:id` | ✓ (ägare) | Ta ner annonsen (`withdrawn`; ordertidninget påverkas inte) |
| POST | `/api/uploads` | ✓ | `multipart/form-data` med fältet `image` (JPEG/PNG/WebP/GIF/SVG, max 5 MB) – fungerar både för filväljare och mobilkamera. Svar: `{url: "/uploads/..."}` |
| POST | `/api/orders/direct` | ✓ | ”Köp direkt”: `{listing_id, quantity}` |
| POST | `/api/orders/checkout` | ✓ | Varukorg: `{items: [{listing_id, quantity}, ...]}` – kan sträcka sig över flera säljande skolor |
| GET | `/api/school/me/orders` | ✓ | Ordertidning som köpare, med rader och totaler |
| GET | `/api/orders/:id/invoice.pdf` | ✓ (köpare) | Ladda ner faktura som PDF, skapad från sparade ordersnapshots. Svaret är `application/pdf`, inte JSON. |

Kategorier: `Datorer`, `Laddare`, `Kablar`, `Skärmar`, `Switchar`, `Router` (måste matcha databasens kontroll).

`GET /api/listings` stöder kombinerade filter: `q` (titel/beskrivning), `category`, `city`, `location` (ort/skolnamn), `school_id`, `min_price`, `max_price`. Sortering: `sort=newest|oldest|price-asc|price-desc` (även `date-asc`, `date-desc`, `price_asc`, `price_desc`). Ogiltiga filter ger 400; alla sökvärden binds som SQL-parametrar.

Antal måste vara heltal inom PostgreSQLs intervall. Pris får vara 0–9999999999,99 kr och avrundas till två decimaler. Null, booleska värden och tomma strängar godtas inte som antal/pris. För stora bilduppladdningar ger 413, felaktiga uppladdningsfält 400.

### Köpflödet

`/orders/direct` och `/orders/checkout` gör detsamma: i en databastransaktion spårras varje annons (`SELECT … FOR UPDATE`), tillgänglighet kontrolleras (aktiv, ej utgången, tillräckligt lager), lagersaldot dras, ordern och orderraderna skapas med pris- och skolsnapshot, och en annons som når noll lager markeras `sold`. Samtidiga köp kan alltså inte sälja fler exemplar än som finns. Därefter genereras fakturan (en sektion per säljande skola, demonivärde – ej giltig faktura) och orderbekräftelsemailet skickas till köparens kontakt-e-post.

### E-post

- **Lokalt (valt för projektet)**: utan `SMTP_HOST` sparas HTML, en PDF och ett komplett `.eml`-mail med bifogad PDF i `backend/mail-outbox/`. Inga externa mail skickas.
- **SMTP**: ange server, port, användare, lösenord och avsändare privat. Samma PDF bifogas via Nodemailer. Avvisade mottagare och transportfel rapporteras utan att den redan skapade ordern försvinner. Produktionen kräver TLS. Riktig inkorgsleverans kräver separat konfiguration och verifiering.
- PDF:er innehåller köpare, skilda säljande skolor (även om namnen är lika), produkter, antal, priser och totaler. Långa fakturor får sidbrytningar och sidnummer. Fakturanummer använder orderåret och ändras inte vid en senare nedladdning.

## Exempel

```bash
# Lokal demo: aktivera DEMO_AUTH_ENABLED och konfigurera DEMO_PASSWORD först.
# Inloggning (seedad skola); ersätt lösenordet med ditt konfigurerade värde.
curl -s -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"stockholm@example.test","password":"demo1234"}'

# Aktiva annonser (använd tokenet från inloggningssvaret)
curl -s localhost:3000/api/listings -H "authorization: Bearer $TOKEN"

# Köp direkt
TOKEN=... \
curl -s -X POST localhost:3000/api/orders/direct \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"listing_id":"30000000-0000-4000-8000-000000000002","quantity":1}'
```

## Bekräftade gränser

- SchoolSoft är inte anslutet. Det uttryckligen aktiverade lokala demo-läget använder fortfarande ett gemensamt lösenord och skolan som konto (ingen `users`-tabell). Detta är ingen färdig produktionsinloggning.
- Profilen använder det godkända UI-förslaget A: skoluppgifter kan redigeras direkt med spara/avbryt och tydlig återkoppling. Produkter kan sparas i inventariet och sedan publiceras med ett pris utan att lagret dupliceras.
- Registrering kräver samma `DEMO_PASSWORD` som inloggning; separata användarlösenord stöds inte i denna demo.
- Lokal mailhantering med PDF-bilaga och SMTP-protokollet har testats mot en lokal SMTP-server. Verklig inkorgsleverans är inte aktiverad.

## Regressionstester

Kör `npm test` för HTTP-tester av autentisering/åtkomstkontroller, sessionshantering, varukorg, validering, PDF-sidbrytning och SMTP-bilagor samt frontendens syntax. Testerna behöver tillåtna loopback-anslutningar och använder inte den gemensamma databasen. `tests/backend-check.mjs` testar den riktiga PostgreSQL-drivrutinen och köpflödet mot en separat tillfällig Neon-branch; se [verifieringsrapporten](VERIFICATION-2026-10-22.md).
