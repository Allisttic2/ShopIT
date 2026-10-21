-- Fictional demo data only. Safe to run again: existing rows are not overwritten.
-- Never use this script to reset purchases or refill stock in a shared demo.
BEGIN;

INSERT INTO shopit.schools
    (id, name, city, visiting_address, billing_address, billing_reference, contact_email)
VALUES
    ('10000000-0000-4000-8000-000000000001', 'Demo NTI Stockholm', 'Stockholm',
     'Exempelgatan 1', 'Exempelgatan 1, Stockholm', 'DEMO-STH', 'stockholm@example.test'),
    ('10000000-0000-4000-8000-000000000002', 'Demo NTI Göteborg', 'Göteborg',
     'Testgatan 2', 'Testgatan 2, Göteborg', 'DEMO-GBG', 'goteborg@example.test'),
    ('10000000-0000-4000-8000-000000000003', 'Demo NTI Malmö', 'Malmö',
     'Demogatan 3', 'Demogatan 3, Malmö', 'DEMO-MAL', 'malmo@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO shopit.products
    (id, school_id, title, description, category, image_url, quantity)
VALUES
    ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
     'Lenovo ThinkPad – demo', 'Begagnad skoldator, återställd inför överlämning.', 'Datorer', '/images/product-placeholder.svg', 3),
    ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
     'USB-C-laddare 65 W', 'Laddare med USB-C-kabel.', 'Laddare', '/images/product-placeholder.svg', 8),
    ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002',
     'HDMI-kabel 2 meter', 'Fungerande HDMI-kabel för klassrum.', 'Kablar', '/images/product-placeholder.svg', 12),
    ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002',
     'Dell-skärm 24 tum', 'Skärm med stativ och strömkabel.', 'Skärmar', '/images/product-placeholder.svg', 4),
    ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003',
     'Nätverksswitch 8 portar', 'Gigabitswitch för mindre labb.', 'Switchar', '/images/product-placeholder.svg', 2),
    ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000003',
     'Router för nätverkslabb', 'Router återställd till fabriksinställningar.', 'Router', '/images/product-placeholder.svg', 2),
    ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001',
     'Inventariedator utan annons', 'Visas bara i skolans inventarie.', 'Datorer', '/images/product-placeholder.svg', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO shopit.listings (id, product_id, price)
VALUES
    ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1500.00),
    ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 150.00),
    ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 25.00),
    ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000004', 500.00),
    ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000005', 300.00),
    ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000006', 0.00)
ON CONFLICT (id) DO NOTHING;

COMMIT;
