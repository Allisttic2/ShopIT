# ShopIT

## Teknikstack

Vi använder **JavaScript i både frontend och backend** samt **SQL för databasen**.

| Del | Teknik | Ansvar |
| --- | --- | --- |
| Frontend | React (JavaScript), HTML/JSX och CSS | Användargränssnittet som körs i webbläsaren. |
| Backend | Node.js med Express (JavaScript) | API, inloggning, behörigheter, annonser och köpflöden. |
| Relationsdatabas | PostgreSQL (SQL) | Lagrar skolor, annonser, lagersaldo, order och fakturarader. |

React kommunicerar med backend via ett API. Backend läser och skriver i PostgreSQL och kontrollerar behörigheter och indata. Frontend ansluter inte direkt till databasen.

Vid köp ska ordern skapas och lagersaldot uppdateras i samma databastransaktion, så att samtidiga köp inte kan sälja fler exemplar än vad som finns. Varje orderrad sparar priset vid köptillfället, så att senare prisändringar inte påverkar tidigare order eller fakturor.

Databasen körs på **Neon (molnbaserad PostgreSQL)** i projektet `sweet-sky-05648360`, branch `production`, för demon med upp till cirka 15 testare. Hosting för frontend/backend och integration med SchoolSoft återstår att fastställa.

## Databas – Anton Lindgren och Rasmus

Anton och Rasmus ansvarar för databasdelen: SQL-schema, relationer, ER-diagram, testdata och Neon-konfiguration. Backendteamet ansvarar för Node.js/Express, anslutningen till databasen, API, behörigheter och köptransaktioner.

Databasfiler, ER-diagram, installationssteg och överlämning finns i [database/README.md](database/README.md). De fem tabeller som uppgiften kräver och sex dummy-annonser är nu installerade i Neon och verifierade via Node.js-databasverktygen. Schema och seed testades först på en isolerad Neon-branch. Kör `npm install` och `npm run db:status` efter att anslutningsuppgifterna har konfigurerats privat.

## Backend – API (körs lokalt)

Backend körs lokalt med Node.js/Express och servar både API:et (`/api`) och den statiska frontenden på samma origin. Den kan prata med antingen en lokal PostgreSQL (Docker: `docker compose up -d db`) eller den befintliga Neon-installationen – enda skillnaden är `DATABASE_URL` i `.env`.

```bash
npm install
cp .env.example .env   # fyll i DATABASE_URL, AUTH_SECRET (och SMTP_* om riktiga mail önskas)
npm run db:migrate && npm run db:seed   # bara mot lokal PostgreSQL
npm start               # http://localhost:3000
```

API:t täcker hela specifikationen: aktiva annonser (förstasidan), detaljsida, inloggning/registrering (demonivå), ”Min sida” (skolinfo, egna annonser med redigering/tagning, inventarie), bilduppladdning (filväljare och mobilkamera), ”Köp direkt” och varukorgsköp med transaktionsskyddat lagersaldo, fakturagenerering och orderbekräftelsemail samt automatisk utgång av annonser efter 30 dagar (hanteras av databasvyn, ingen schemalagd job behövs). Fullständig endpointlista, exempel och dokumenterade gränser finns i [backend/README.md](backend/README.md).

Underlag: [databaskortet i Trello](https://trello.com/c/kcTl3R5z), [planeringsmötet](https://trello.com/c/lmzzXC1y) och [projektspecifikationen](https://docs.google.com/document/d/1954j7vGA32ExfJ2vr5VcZzSdrLb0nRkv/edit). Befintlig plan är publicering 3 november och slutpresentation 6 november 2026.

## Definition of Done

En uppgift är klar när:

- Uppgiftens acceptanskriterier är uppfyllda och funktionen fungerar som beskrivet.
- Den som byggt funktionen har testat den, och minst en annan gruppmedlem har testat eller granskat arbetet.
- Koden är mergad till `main` på GitHub och fungerar tillsammans med resten av applikationen.
- Det vanliga flödet och relevanta fel har testats. UI-ändringar har kontrollerats på både mobil och dator.
- Där det är relevant kontrollerar backend behörigheter och indata, och information sparas korrekt i databasen.
- Trello-kortet är uppdaterat med vad som har verifierats och eventuella kvarvarande begränsningar. Begränsningar som hindrar acceptanskriterierna måste lösas innan kortet flyttas till Done.

Specifika funktionskrav, som fakturagenerering och automatisk utgång av annonser, skrivs som acceptanskriterier på respektive Trello-kort.

## Checklista inför slutleverans

- [ ] Både Köp direkt och köp via varukorgen skapar korrekta order, fakturarader och orderbekräftelsemail.
- [ ] Köp uppdaterar lagersaldot korrekt och det går inte att köpa fler exemplar än vad som finns, även vid samtidiga köp.
- [ ] Skolor kan bara redigera och radera sina egna annonser. Behörigheterna kontrolleras även i backend.
- [ ] Annonser tas automatiskt ner efter 30 dagar. Detta har testats utan att behöva vänta i 30 dagar.
- [ ] Bilduppladdning och fotografering med mobilkameran fungerar på en riktig mobil.
- [ ] Publicerad frontend, backend och relationsdatabas fungerar tillsammans utanför utvecklingsmiljön.
- [ ] Minst två gruppmedlemmar kan förklara varje större del av systemet, och alla fem kan delta aktivt i en live-demo.

## Tidig beroendekontroll

Bekräfta med handledarna hur SchoolSoft-inloggningen ska integreras och vilken åtkomst teamet får. Detta är ett externt beroende som kan blockera hela applikationen och bör undersökas tidigt.
