# ShopIT backend

Lokal Node.js/Express-backend som servar API:et (`/api`) och den färdiga statiska frontenden – hela demon körs på en enda origin.

## Starta

```bash
npm install
cp .env.example .env   # fyll i DATABASE_URL (se nedan) och AUTH_SECRET
```

Databasen körs på **Neon**. Använd projektets befintliga `.env.local`, eller konfigurera `DATABASE_URL` och `DATABASE_URL_UNPOOLED` med anslutningsuppgifterna från Neon. `.env.local` läses före `.env`. Behåll befintliga anslutningsuppgifter om de redan är konfigurerade. Schema och seed är redan installerade på `production`.

Kontrollera anslutningen med `npm run db:status`.

Kör sedan:

```bash
npm start        # eller: npm run dev (auto-restart vid ändringar)
```

App: http://localhost:3000 · Hälsocheck: http://localhost:3000/api/health

## API

Alla svar är JSON. Session: `Authorization: Bearer <token>` (tokenet kommer från inloggning/registrering). `404`/`409`-svar innehåller en svensk `error`-meddelande.

| Metod | Sökväg | Auth | Beskrivning |
| --- | --- | --- | --- |
| GET | `/api/health` | – | Databasanslutning + mailleveransläge |
| GET | `/api/listings` | – | Aktiva annonser (förstasidans grid). 30-dagarstiden hanteras av vyn `active_listings` – utgångna annonser försvinner automatiskt utan jobbskriver. |
| GET | `/api/listings/:id` | – | Detaljsida: bild, titel, pris, antal, beskrivning, skola, status |
| POST | `/api/auth/login` | – | `{email, password}` – skolans kontakt-e-post + demolösenordet (`DEMO_PASSWORD`, standard `demo1234`) |
| POST | `/api/auth/register` | – | `{name, email, password}` – skapar en ny skola (demonivå; SchoolSoft-kopplingen ersätter detta senare) |
| GET | `/api/school/me` | ✓ | Skolans info för ”Min sida” (namn, adresser, faktureringsuppgifter) |
| GET | `/api/school/me/inventory` | ✓ | Inventarie: alla skolans produkter, oavsett annonsstatus |
| GET | `/api/school/me/listings` | ✓ | Egna annonser med status (`active`/`withdrawn`/`sold`/`expired`) |
| POST | `/api/school/me/listings` | ✓ | Ny annons: `{title, description, category, quantity, price, image_url}` |
| PATCH | `/api/listings/:id` | ✓ (ägare) | Redigera annons: `title`, `description`, `category`, `quantity`, `price`, `image_url` |
| DELETE | `/api/listings/:id` | ✓ (ägare) | Ta ner annonsen (`withdrawn`; ordertidninget påverkas inte) |
| POST | `/api/uploads` | ✓ | `multipart/form-data` med fältet `image` (JPEG/PNG/WebP/GIF/SVG, max 5 MB) – fungerar både för filväljare och mobilkamera. Svar: `{url: "/uploads/..."}` |
| POST | `/api/orders/direct` | ✓ | ”Köp direkt”: `{listing_id, quantity}` |
| POST | `/api/orders/checkout` | ✓ | Varukorg: `{items: [{listing_id, quantity}, ...]}` – kan sträcka sig över flera säljande skolor |
| GET | `/api/school/me/orders` | ✓ | Ordertidning som köpare, med rader och totaler |

Kategorier: `Datorer`, `Laddare`, `Kablar`, `Skärmar`, `Switchar`, `Router` (måste matcha databasens kontroll).

### Köpflödet

`/orders/direct` och `/orders/checkout` gör detsamma: i en databastransaktion spårras varje annons (`SELECT … FOR UPDATE`), tillgänglighet kontrolleras (aktiv, ej utgången, tillräckligt lager), lagersaldot dras, ordern och orderraderna skapas med pris- och skolsnapshot, och en annons som når noll lager markeras `sold`. Samtidiga köp kan alltså inte sälja fler exemplar än som finns. Därefter genereras fakturan (en sektion per säljande skola, demonivärde – ej giltig faktura) och orderbekräftelsemailet skickas till köparens kontakt-e-post.

### E-post

- **Lokalt (standard)**: utan `SMTP_HOST` sparas varje mail som HTML i `backend/mail-outbox/` (filnamnet loggas i konsolen) – bekvämt för demo och test.
- **Verklighet**: sätt `SMTP_HOST` (port, användare, lösenord, avsändare i `.env`) så skickas mailen via nodemailer.

## Exempel

```bash
# Inloggning (seedad skola)
curl -s -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"stockholm@example.test","password":"demo1234"}'

# Aktiva annonser
curl -s localhost:3000/api/listings

# Köp direkt
TOKEN=... \
curl -s -X POST localhost:3000/api/orders/direct \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"listing_id":"30000000-0000-4000-8000-000000000002","quantity":1}'
```

## Bekräftade gränser

- Inloggning är demonivå: alla skolor delar `DEMO_PASSWORD` och skolan är kontot (ingen `users`-tabell i schemat). SchoolSoft-kopplingen är planerad och ersätter detta.
- Frontenden i rotkatalogen använder API:et för annonser, inloggning, inventarie, bilduppladdning och beställningar. Skoluppgifter är ännu skrivskyddade i profilen.
- Registrering kräver samma `DEMO_PASSWORD` som inloggning; separata användarlösenord stöds inte i denna demo.
- Utan SMTP sparas bekräftelser lokalt som HTML. Detta verifierar inte faktisk e-postleverans eller bifogad PDF.

## Regressionstester

Kör `npm test` för tester av sessionshantering, sparad varukorg, fakturaunderlag och frontendens syntax. Databas- och köpflöden behöver dessutom integrationstestas mot en separat testdatabas.
