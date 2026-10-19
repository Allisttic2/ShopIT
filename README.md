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

Val av hosting och integration med SchoolSoft återstår att fastställa.

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
