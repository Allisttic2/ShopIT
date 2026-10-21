-- ShopIT demo, PostgreSQL 14+. Run once in an empty database/branch.
-- No DROP statements: future changes belong in new numbered migrations.
BEGIN;

CREATE SCHEMA shopit;

CREATE TABLE shopit.schools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (btrim(name) <> ''),
    city text NOT NULL CHECK (btrim(city) <> ''),
    visiting_address text NOT NULL,
    billing_address text NOT NULL,
    billing_reference text NOT NULL DEFAULT '',
    contact_email text NOT NULL CHECK (btrim(contact_email) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Inventory belongs to a school even before it has a listing.
-- quantity is the only stock counter; listings never duplicate that counter.
CREATE TABLE shopit.products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES shopit.schools(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL DEFAULT '',
    category text NOT NULL CHECK (category IN
        ('Datorer', 'Laddare', 'Kablar', 'Skärmar', 'Switchar', 'Router')),
    image_url text,
    quantity integer NOT NULL CHECK (quantity >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Demo decision: one listing per inventory product; all remaining stock is offered.
-- Withdraw instead of deleting, so order history can keep its references.
CREATE TABLE shopit.listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL UNIQUE REFERENCES shopit.products(id) ON DELETE RESTRICT,
    price numeric(12,2) NOT NULL CHECK (price >= 0 AND price <> 'NaN'::numeric),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'withdrawn', 'sold')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Buyer details are snapshots, copied from schools by the backend at checkout.
CREATE TABLE shopit.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_school_id uuid NOT NULL REFERENCES shopit.schools(id) ON DELETE RESTRICT,
    buyer_name text NOT NULL CHECK (btrim(buyer_name) <> ''),
    buyer_email text NOT NULL CHECK (btrim(buyer_email) <> ''),
    buyer_billing_address text NOT NULL,
    buyer_billing_reference text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- A cart may contain products from several schools: seller belongs on each line.
-- Snapshot columns preserve invoice data after product/school/price changes.
CREATE TABLE shopit.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES shopit.orders(id) ON DELETE RESTRICT,
    listing_id uuid NOT NULL REFERENCES shopit.listings(id) ON DELETE RESTRICT,
    seller_school_id uuid NOT NULL REFERENCES shopit.schools(id) ON DELETE RESTRICT,
    seller_name text NOT NULL CHECK (btrim(seller_name) <> ''),
    seller_billing_address text NOT NULL,
    seller_billing_reference text NOT NULL DEFAULT '',
    product_title text NOT NULL CHECK (btrim(product_title) <> ''),
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price numeric(12,2) NOT NULL
        CHECK (unit_price >= 0 AND unit_price <> 'NaN'::numeric),
    line_total numeric(22,2) GENERATED ALWAYS AS (quantity::numeric * unit_price) STORED,
    UNIQUE (order_id, listing_id)
);

CREATE INDEX products_school_idx ON shopit.products(school_id);
CREATE INDEX products_category_idx ON shopit.products(category);
CREATE INDEX listings_created_idx ON shopit.listings(created_at);
CREATE INDEX orders_buyer_idx ON shopit.orders(buyer_school_id);
CREATE INDEX order_items_listing_idx ON shopit.order_items(listing_id);
CREATE INDEX order_items_seller_idx ON shopit.order_items(seller_school_id);

-- 30 days = 720 elapsed hours, independent of daylight-saving changes.
-- Expired/withdrawn/sold/out-of-stock listings disappear without a scheduled job.
CREATE VIEW shopit.active_listings AS
SELECT l.id, l.product_id, p.school_id, p.title, p.description, p.category,
       p.image_url, p.quantity, l.price, l.created_at,
       l.created_at + interval '720 hours' AS expires_at,
       s.name AS school_name, s.city
FROM shopit.listings l
JOIN shopit.products p ON p.id = l.product_id
JOIN shopit.schools s ON s.id = p.school_id
WHERE l.status = 'active'
  AND p.quantity > 0
  AND l.created_at <= now()
  AND l.created_at + interval '720 hours' > now();

CREATE VIEW shopit.order_totals AS
SELECT o.id AS order_id, COALESCE(sum(i.line_total), 0)::numeric AS total_sek
FROM shopit.orders o
LEFT JOIN shopit.order_items i ON i.order_id = o.id
GROUP BY o.id;

COMMIT;
