# SchoolSoft-inloggning – utredning 22 oktober 2026

Auth-kort: https://trello.com/c/4rItkgqA. Utredningskortet https://trello.com/c/YUetG4pb är markerat klart men saknar slutsats/kommentar. Uppgiftsdokumentet i Google Docs kunde inte hämtas; kraven nedan bygger på Trello-korten och projektets README.

## Bekräftat

- NTI:s officiella SchoolSoft-sida hänvisar elever och personal till `https://sms.schoolsoft.se/nti/sso`: [NTI-inloggningen](https://sms.schoolsoft.se/nti/jsp/Login.jsp).
- SchoolSoft anger att varje skola har en egen inloggningssida och själv väljer inloggningsmetoder: [SchoolSoft support](https://schoolsoft.se/support-qa/).
- SS12000 stöds av SchoolSoft, men är en separat fråga från användarinloggning: [SchoolSofts information](https://schoolsoft.se/aktuellt/julbrev-fran-schoolsoft-2024/). Skolverket skiljer uttryckligen provisionering via SS12000 från inloggning: [tekniskt verifieringstest](https://www.skolverket.se/prov-och-bedomning/provplattformen---tekniska-forberedelser/tekniska-krav-och-vagledning/testa-tekniken/tekniskt-verifieringstest---overforing-av-uppgifter-enligt-standarden-ss-12000).
- Ingen offentlig, officiell guide hittades som registrerar ShopIT som en app för SchoolSoft-inloggning. En vanlig användares SchoolSoft-konto bevisar inte att projektet har integrationsåtkomst.

## Bedömning och nästa steg

Vår bedömning är att läraren/skolans IT behöver bekräfta om ShopIT ska anslutas till samma identitetsleverantör som SchoolSoft, eller använda en särskild godkänd SchoolSoft-integration. SSO-länken ensam ger inte ShopIT en verifierbar inloggning. Implementationen ska vänta på bekräftat protokoll i stället för att anta OAuth/OIDC/SAML eller återanvända en annan apps klient-ID.

Be läraren/skolans IT om:

1. Godkänd integrationsväg och dokumentation (OIDC, SAML eller annan specificerad metod).
2. Testmiljö och appregistrering för **ShopIT**, med utfärdare/metadata, klient-/entitets-ID, tillåtna callback-adresser och nödvändiga hemligheter via en privat kanal.
3. Verifierad stabil användaridentitet, skol-/enhetsattribut och vilka roller som får köpa/sälja. Bestäm en serverstyrd mappning till `shopit.schools.id`; acceptera aldrig skol-ID från formuläret som behörighetsbevis.
4. Testkonton för två skolor samt besked om spärrade användare, utloggning och sessionsåterkallelse.
5. Om integrationen inte kan ges i tid: uttryckligt godkännande av mockad inloggning för uppgiften och dokumentation av begränsningen.

När detta finns: implementera leverantörens verifierade inloggningsflöde med etablerat bibliotek, validera signatur/utfärdare/mottagare och protokollspecifika skydd, slå upp skolan på servern, skapa återkallningsbara sessioner och testa att fel skola/roll nekas. Detta är kvar innan auth-kortet kan markeras klart.

## Genomfört i denna ändring

Serverkontroll av marknadsplatssidor, alla API-rutter och uppladdade bilder; HttpOnly-cookie för webbläsaren; origin-skydd vid skrivningar; striktare tokenkontroll; krav på privat sessionshemlighet; inget cachelagrat skyddat innehåll. Lokal demo kräver uttryckligt påslag och fungerar aldrig i produktion. Inga SchoolSoft-lösenord samlas in eller skickas vidare av denna implementation.
