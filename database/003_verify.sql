-- Run in a test/development branch after schema + seed.
-- All fixture changes roll back. Any failed assertion raises an error.
BEGIN;

DO $$
DECLARE
    seller uuid;
    buyer uuid;
    product uuid;
    listing uuid;
    purchase uuid;
    old_quantity integer;
    changed integer;
BEGIN
    IF (SELECT count(*) FROM shopit.active_listings) < 5 THEN
        RAISE EXCEPTION 'Expected at least five active seed listings in a fresh demo branch';
    END IF;

    INSERT INTO shopit.schools (name, city, visiting_address, billing_address, contact_email)
    VALUES ('Verification seller', 'Test', 'Test 1', 'Seller billing', 'seller@example.test')
    RETURNING id INTO seller;
    INSERT INTO shopit.schools (name, city, visiting_address, billing_address, contact_email)
    VALUES ('Verification buyer', 'Test', 'Test 2', 'Buyer billing', 'buyer@example.test')
    RETURNING id INTO buyer;
    INSERT INTO shopit.products (school_id, title, category, quantity)
    VALUES (seller, 'Verification screen', 'Skärmar', 1) RETURNING id INTO product;
    INSERT INTO shopit.listings (product_id, price)
    VALUES (product, 12.50) RETURNING id INTO listing;

    BEGIN
        UPDATE shopit.products SET quantity = -1 WHERE id = product;
        RAISE EXCEPTION 'Negative stock was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO shopit.listings (product_id, price) VALUES (product, -1);
        RAISE EXCEPTION 'Negative price was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO shopit.products (school_id, title, category, quantity)
        VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Invalid owner', 'Kablar', 1);
        RAISE EXCEPTION 'Missing school was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO shopit.listings (product_id, price) VALUES (product, 1);
        RAISE EXCEPTION 'Duplicate listing for inventory was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    UPDATE shopit.listings SET created_at = now() - interval '720 hours' WHERE id = listing;
    IF EXISTS (SELECT 1 FROM shopit.active_listings WHERE id = listing) THEN
        RAISE EXCEPTION 'Listing still visible at the 30-day boundary';
    END IF;
    UPDATE shopit.listings SET created_at = now() - interval '719 hours' WHERE id = listing;
    IF NOT EXISTS (SELECT 1 FROM shopit.active_listings WHERE id = listing) THEN
        RAISE EXCEPTION 'Unexpired listing is missing';
    END IF;
    UPDATE shopit.listings SET status = 'withdrawn' WHERE id = listing;
    IF EXISTS (SELECT 1 FROM shopit.active_listings WHERE id = listing) THEN
        RAISE EXCEPTION 'Withdrawn listing still visible';
    END IF;
    UPDATE shopit.listings SET status = 'active' WHERE id = listing;

    INSERT INTO shopit.orders
        (buyer_school_id, buyer_name, buyer_email, buyer_billing_address, buyer_billing_reference)
    SELECT id, name, contact_email, billing_address, billing_reference
    FROM shopit.schools WHERE id = buyer RETURNING id INTO purchase;

    UPDATE shopit.products SET quantity = quantity - 1
    WHERE id = product AND quantity >= 1;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION 'First purchase failed'; END IF;

    INSERT INTO shopit.order_items
        (order_id, listing_id, seller_school_id, seller_name, seller_billing_address,
         seller_billing_reference, product_title, quantity, unit_price)
    SELECT purchase, l.id, s.id, s.name, s.billing_address,
           s.billing_reference, p.title, 1, l.price
    FROM shopit.listings l
    JOIN shopit.products p ON p.id = l.product_id
    JOIN shopit.schools s ON s.id = p.school_id
    WHERE l.id = listing;

    -- A second guarded stock update must affect zero rows.
    UPDATE shopit.products SET quantity = quantity - 1
    WHERE id = product AND quantity >= 1;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'Sold the final item twice'; END IF;
    IF EXISTS (SELECT 1 FROM shopit.active_listings WHERE id = listing) THEN
        RAISE EXCEPTION 'Out-of-stock listing still visible';
    END IF;

    UPDATE shopit.listings SET price = 999.00 WHERE id = listing;
    UPDATE shopit.products SET title = 'Changed title' WHERE id = product;
    UPDATE shopit.schools SET name = 'Changed seller' WHERE id = seller;
    IF NOT EXISTS (
        SELECT 1 FROM shopit.order_items WHERE order_id = purchase
        AND unit_price = 12.50 AND line_total = 12.50
        AND product_title = 'Verification screen' AND seller_name = 'Verification seller'
    ) THEN RAISE EXCEPTION 'Invoice snapshots changed'; END IF;
    IF (SELECT total_sek FROM shopit.order_totals WHERE order_id = purchase) <> 12.50 THEN
        RAISE EXCEPTION 'Order total is incorrect';
    END IF;

    BEGIN
        UPDATE shopit.order_items SET quantity = 0 WHERE order_id = purchase;
        RAISE EXCEPTION 'Zero order quantity was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        DELETE FROM shopit.listings WHERE id = listing;
        RAISE EXCEPTION 'Deleting purchased listing was accepted';
    EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN NULL;
    END;

    -- Simulate checkout failing after stock was changed: the whole block rolls back.
    SELECT quantity INTO old_quantity FROM shopit.products WHERE id = product;
    BEGIN
        UPDATE shopit.products SET quantity = 5 WHERE id = product;
        UPDATE shopit.order_items SET quantity = -1 WHERE order_id = purchase;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    IF (SELECT quantity FROM shopit.products WHERE id = product) <> old_quantity THEN
        RAISE EXCEPTION 'Failed checkout did not roll stock back';
    END IF;
    RAISE NOTICE 'ShopIT database checks passed';
END $$;

ROLLBACK;
