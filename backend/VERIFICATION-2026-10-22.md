# Database and backend verification – 22 October 2026

## Follow-up after fixes

All five originally reproduced backend failures are fixed. The backend now also generates PDF invoices, saves local emails with actual PDF attachments, supports buyer-only PDF downloads, and publishes existing inventory without duplicating products. The user approved profile mockup A; inline school editing, save/cancel feedback, inventory-only creation and publication of existing stock are now connected in the profile. SchoolSoft and real inbox delivery remain outside this completed backend work; local test email was explicitly chosen.

Verification after the fixes: **23 automated tests and all 25 real-PostgreSQL integration checks passed**, including PDF pagination, SMTP attachment/rejection, concurrent registration, final-stock contention, combined filters, school updates, invoice privacy, existing-inventory publication, invalid numeric inputs and future-dated listings. Single-page and seven-page sample PDFs were rendered and visually checked. The incremental email index was applied to the shared demo database after passing on a temporary branch; shared records remain 3 schools, 7 products, 6 active listings and 0 orders. Both temporary test branches were deleted after testing. The local demo server is running the updated backend. Dependency audit reports zero vulnerabilities after updating Nodemailer.

The profile was also checked through the browser against an isolated in-memory PostgreSQL test database (PGlite): school edits persisted after reload, cancel restored saved values, duplicate emails showed an inline error, inventory creation added two units without an advertisement, and publishing those units increased the active advertisement count without increasing stock. Published stock could still be edited and remained correct after reload. Mobile checks at 390 px width confirmed no page overflow and a scrollable form with visible action buttons, including on a 667 px high screen. Escape closed the form and Tab wrapped from its final button to its close button. These UI checks did not modify shared database records.

The remainder of this document records the original audit for context.

The core demo database and purchasing flow work. The backend is not yet complete against the assignment. This audit added a repeatable integration check; it did not change application behavior or apply database migrations.

## Evidence

| Check | Result |
| --- | --- |
| Existing automated regression/auth tests | 19 passed |
| Live PostgreSQL connection | Passed |
| Live authenticated GET requests | 21 passed across all 3 seeded schools |
| Real PostgreSQL integration checks on a temporary Neon branch | 15 passed; 5 failed |
| Live integrity checks | No negative stock, invalid prices, duplicate school emails, unavailable listings in the active feed, or orders without lines |
| Live diagnostics | No locks reported; all five application tables present |

The shared database still has **3 schools, 7 products, 6 active listings, 0 orders and 0 order items**. Purchases and test registrations ran only in the temporary branch `codex-backend-check-20261022-0812`, which was deleted after testing. The normal `.env.local` and demo-login configuration were preserved. Test images and generated test email files were removed.

## Confirmed working

- Registration and subsequent login in explicitly enabled demo mode.
- Listing creation/editing, decimal prices, description and stock persisted through the real PostgreSQL driver.
- School ownership checks prevent another school editing/deleting listings or reading private inventory/order history.
- Authenticated image upload/download.
- Multi-seller checkout, duplicate cart-line merging, correct order totals, buyer/seller snapshots and persistent order history.
- Failed multi-item checkout rolls back both stock changes and the new order.
- Simultaneous purchases of the final item produce one successful purchase and one conflict; stock finishes at zero and the listing becomes sold.
- Withdrawn listings disappear while their inventory remains. Expired listings disappear and cannot be bought.
- Database constraints reject invalid stock, prices and foreign keys; existing invoice snapshots survive later product/school edits.
- Invoice HTML is saved locally with buyer, both sellers, purchased items and the correct total. This verifies HTML generation only.

## Original five reproduced failures (now fixed in the backend)

| Priority | Finding | Reproduction and evidence | Next change |
| --- | --- | --- | --- |
| 1 | Duplicate account emails under concurrent registration | Six registrations for one email produced five school accounts. `fetchSchoolByContactEmail` checks before insert, and `shopit.schools.contact_email` has no unique constraint. | Add a new migration enforcing case-insensitive email uniqueness, and translate uniqueness conflicts to HTTP 409. Do not rerun the initial schema migration on the shared database. |
| 2 | Invalid numeric input is silently accepted | Posting a listing with `quantity: null` and `price: null` returns 201 and stores zeros. The validators coerce null to 0. | Reject null, booleans, blank quantities and out-of-range values before writing. Preserve valid numeric zero and decimal prices. |
| 3 | API filtering is unfinished | `GET /api/listings?category=Kablar` returns other categories. The handler ignores query parameters and always sorts newest first. | Implement combined search/category/location filters and date/price sorting. Some filtering works in the browser; the backend requirement remains incomplete. [Trello task](https://trello.com/c/3LyKxQWC). |
| 4 | School details cannot be saved | `PATCH /api/school/me` returns 404. Only GET is implemented; profile fields are read-only. | Add an authorized update endpoint and then connect the profile controls. [Trello task](https://trello.com/c/FKlGAiSn). |
| 5 | Upload-limit errors are misreported | A PNG over 5 MB triggers Multer `LIMIT_FILE_SIZE`, which becomes HTTP 500. | Return a clear 413 response for file-size limits and 400 for malformed upload fields. |

Supporting implementation references: [routes](routes.mjs), [schema](../database/001_schema.sql), [error handler](app.mjs). PostgreSQL supports [unique expression indexes](https://www.postgresql.org/docs/18/sql-createindex.html); Multer documents [delegating upload errors to Express](https://expressjs.com/en/resources/middleware/multer/).

## Assignment features identified by the original review

- **Generated PDF invoices and email attachments:** the backend generates HTML, and checkout offers the browser's print/save-as-PDF dialog. No server-generated PDF or attachment is implemented. [PDF task](https://trello.com/c/FZN33FTg).
- **Real confirmation email:** SMTP is not configured locally, so emails go to `backend/mail-outbox/`. Real inbox delivery was not tested, and the mail sender does not attach an invoice. [Email task](https://trello.com/c/Nrq7xAMj).
- **Create an ad from existing inventory:** inventory can be read, but the create-listing handler always inserts a new product. There is no flow that reuses an existing inventory product. [Inventory task](https://trello.com/c/zsHwgogT).
- **SchoolSoft:** still not connected; see [integration research](SCHOOLSOFT.md).

## Repeat the audit

`npm test` runs the normal regression/auth suite without contacting the shared database.

`tests/backend-check.mjs` is an opt-in audit for a separately provisioned temporary Neon branch. It now applies/verifies the incremental migration and checks the fixes above. It is not included in `npm test`.

Prepare a separate ignored env file with the temporary branch's pooled/direct URLs and these test-only settings:

```dotenv
NEON_BRANCH=codex-backend-check-<unique-run>
SHOPIT_INTEGRATION_TARGET=temporary-neon-branch
SHOPIT_TEST_DATABASE_HOST=<temporary branch direct hostname>
DEMO_AUTH_ENABLED=true
DEMO_PASSWORD=<test password of at least 8 characters>
AUTH_SECRET=<random secret of at least 32 bytes>
NODE_ENV=test
SMTP_HOST=
PUBLIC_BASE_URL=
```

Then run in PowerShell:

```powershell
$env:SHOPIT_ENV_FILE='.env.backend-check'
node tests/backend-check.mjs
```

The script checks that both test connection URLs target the declared test host and differ from the regular app database before it writes anything. It forces local email output, starts its own loopback-only server, cleans up its local files, and saves detailed results under `.database-validation/`. Delete the temporary Neon branch and its test env file afterward. The branch used for this audit has already been removed.

Recommended order: fix duplicate emails and numeric validation first, then complete backend filters and school editing, followed by PDF/email and the existing-inventory flow.
