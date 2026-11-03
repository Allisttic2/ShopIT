BEGIN;

ALTER TABLE shopit.schools
    ADD COLUMN IF NOT EXISTS county_code text
    CHECK (county_code ~ '^(01|0[3-9]|1[0234789]|2[0-5])$');

ALTER TABLE shopit.products
    ADD COLUMN IF NOT EXISTS condition_score smallint CHECK (condition_score BETWEEN 1 AND 10);

CREATE OR REPLACE VIEW shopit.active_listings AS
SELECT l.id, l.product_id, p.school_id, p.title, p.description, p.category,
       p.image_url, p.quantity, l.price, l.created_at,
       l.created_at + interval '720 hours' AS expires_at,
       s.name AS school_name, s.city, s.county_code, p.condition_score
FROM shopit.listings l
JOIN shopit.products p ON p.id = l.product_id
JOIN shopit.schools s ON s.id = p.school_id
WHERE l.status = 'active'
  AND p.quantity > 0
  AND l.created_at <= now()
  AND l.created_at + interval '720 hours' > now();

COMMIT;
