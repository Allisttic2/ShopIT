-- ShopIT classroom walkthrough. Run the whole file: read-only, no saved changes.
BEGIN READ ONLY;

-- 1. Overview. Initial seed: 3 schools, 7 products, 6 listings, 0 orders.
SELECT
    (SELECT count(*) FROM shopit.schools) AS skolor,
    (SELECT count(*) FROM shopit.products) AS produkter,
    (SELECT count(*) FROM shopit.listings) AS annonser,
    (SELECT count(*) FROM shopit.active_listings) AS synliga_annonser,
    (SELECT count(*) FROM shopit.orders) AS bestallningar;

-- 2. Data for the homepage.
SELECT title, category, price, quantity, school_name, city
FROM shopit.active_listings
ORDER BY price, title;

-- 3. Inventory, including a product with no listing.
SELECT
    p.title AS produkt,
    s.name AS skola,
    p.quantity AS antal_kvar,
    l.price AS annonspris,
    CASE WHEN l.id IS NULL THEN 'Nej' ELSE 'Ja' END AS har_annons
FROM shopit.products p
JOIN shopit.schools s ON s.id = p.school_id
LEFT JOIN shopit.listings l ON l.product_id = p.id
ORDER BY s.name, p.title;

-- 4. A price filter.
SELECT title, price, school_name
FROM shopit.active_listings
WHERE price <= 500
ORDER BY price, title;

-- 5. Listing age and visibility without changing dates or stock.
SELECT
    p.title,
    l.status,
    l.created_at AS skapad,
    l.created_at + interval '720 hours' AS slutar_visas,
    EXISTS (
        SELECT 1 FROM shopit.active_listings a WHERE a.id = l.id
    ) AS synlig_nu
FROM shopit.listings l
JOIN shopit.products p ON p.id = l.product_id
ORDER BY p.title;

-- 6. Invoice data. Empty is expected before there are any purchases.
SELECT
    o.id AS order_id,
    o.buyer_name AS kopare,
    i.seller_name AS saljare,
    i.product_title AS produkt,
    i.quantity AS antal,
    i.unit_price AS styckpris,
    i.line_total AS radsumma
FROM shopit.orders o
JOIN shopit.order_items i ON i.order_id = o.id
ORDER BY o.created_at, i.id;

-- 7. Practice answer: computers, cheapest first.
SELECT title, price, school_name
FROM shopit.active_listings
WHERE category = 'Datorer'
ORDER BY price, title;

ROLLBACK;
