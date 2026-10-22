-- Incremental and non-destructive. Existing duplicates stop this migration;
-- never merge/delete school accounts automatically.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS schools_contact_email_unique
ON shopit.schools (lower(btrim(contact_email)));
COMMIT;
