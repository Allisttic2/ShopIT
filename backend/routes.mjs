// ShopIT backend – API-rutter under /api.
import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import multer from 'multer';
import { query, withTransaction } from './db.mjs';
import { signToken, requireAuth } from './auth.mjs';
import { buildInvoiceHtml, invoiceNumber } from './invoices.mjs';
import { sendMail, mailDeliveryMode } from './mail.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['Datorer', 'Laddare', 'Kablar', 'Skärmar', 'Switchar', 'Router'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function demoPassword() {
  return process.env.DEMO_PASSWORD || 'demo1234';
}

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function priceValue(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

// Public listing data (home grid). The view handles the 30-day expiry.
const ACTIVE_LISTING_SQL = `SELECT id, product_id, title, description, category, image_url,
       quantity, price, created_at, expires_at, school_name, city
FROM shopit.active_listings`;

// Fetches a listing with product and school; computes a display status so the
// client can show "Såld"/"Utgången" without a scheduled cleanup job.
const LISTING_BY_ID_SQL = `SELECT l.id, l.price, l.created_at,
       l.created_at + interval '720 hours' AS expires_at,
       CASE WHEN l.status = 'active' AND l.created_at + interval '720 hours' <= now()
            THEN 'expired' ELSE l.status END AS status,
       p.id AS product_id, p.title, p.description, p.category, p.image_url, p.quantity,
       s.name AS school_name, s.city, s.id AS school_id
FROM shopit.listings l
JOIN shopit.products p ON p.id = l.product_id
JOIN shopit.schools s ON s.id = p.school_id
WHERE l.id = $1`;

function schoolSummary(school) {
  return {
    id: school.id,
    name: school.name,
    city: school.city,
    visiting_address: school.visiting_address,
    billing_address: school.billing_address,
    billing_reference: school.billing_reference,
    contact_email: school.contact_email,
  };
}

async function fetchSchoolByContactEmail(email) {
  const rows = await query('SELECT * FROM shopit.schools WHERE lower(contact_email) = lower($1) ORDER BY created_at', [email]);
  return rows[0] || null;
}

// Creates the order + order lines and decrements stock atomically.
// items: [{ listing_id, quantity }] – duplicate listings are merged.
async function placeOrder(buyer, items) {
  return withTransaction(async (client) => {
    const orderRes = await client.query(
      `INSERT INTO shopit.orders (buyer_school_id, buyer_name, buyer_email, buyer_billing_address, buyer_billing_reference)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [buyer.id, buyer.name, buyer.contact_email, buyer.billing_address, buyer.billing_reference]
    );
    const orderId = orderRes.rows[0].id;

    const placed = [];
    for (const item of items) {
      const res = await client.query(
        `SELECT l.id, l.status, l.price, l.created_at,
                l.created_at + interval '720 hours' AS expires_at,
                p.id AS product_id, p.school_id AS seller_school_id, p.title, p.quantity,
                s.name AS seller_name, s.billing_address AS seller_billing_address,
                s.billing_reference AS seller_billing_reference
         FROM shopit.listings l
         JOIN shopit.products p ON p.id = l.product_id
         JOIN shopit.schools s ON s.id = p.school_id
         WHERE l.id = $1
         FOR UPDATE`,
        [item.listing_id]
      );
      const row = res.rows[0];
      if (!row) throw new HttpError(400, `Annonsen ${item.listing_id} finns inte.`);
      const available = row.status === 'active' && row.expires_at > new Date() && row.quantity > 0;
      if (!available || row.quantity < item.quantity) {
        throw new HttpError(409, `'${row.title}' är inte tillgänglig i den valda mängden.`);
      }

      await client.query('UPDATE shopit.products SET quantity = quantity - $2 WHERE id = $1', [row.product_id, item.quantity]);
      const itemRes = await client.query(
        `INSERT INTO shopit.order_items
           (order_id, listing_id, seller_school_id, seller_name, seller_billing_address, seller_billing_reference, product_title, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [orderId, row.id, row.seller_school_id, row.seller_name, row.seller_billing_address, row.seller_billing_reference, row.title, item.quantity, row.price]
      );
      placed.push(itemRes.rows[0]);

      if (row.quantity - item.quantity === 0) {
        await client.query(`UPDATE shopit.listings SET status = 'sold' WHERE id = $1`, [row.id]);
      }
    }
    return { order: { id: orderId, created_at: orderRes.rows[0].created_at }, items: placed };
  });
}

// Generates the invoice and sends the confirmation e-mail. Failures here are
// logged and reported in the response, but the order itself stays committed.
async function deliverOrderConfirmation({ order, items, buyer }) {
  const html = buildInvoiceHtml({ order, items });
  try {
    const delivery = await sendMail({
      to: buyer.contact_email,
      subject: `Ordern är genomförd – faktura ${invoiceNumber(order.id)} (NTI-T Shopp)`,
      html,
    });
    return { invoice_number: invoiceNumber(order.id), email_sent: true, email_delivery: delivery };
  } catch (error) {
    console.error('[orders] Kunde inte skicka orderbekräftelse:', error.message);
    return { invoice_number: invoiceNumber(order.id), email_sent: false, email_delivery: mailDeliveryMode() };
  }
}

export function createApiRouter() {
  const router = Router();

  // --- Health -------------------------------------------------------------
  router.get('/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true, mail_delivery: mailDeliveryMode() });
  });

  // --- Public listings ----------------------------------------------------
  router.get('/listings', async (_req, res, next) => {
    try {
      res.json({ listings: await query(`${ACTIVE_LISTING_SQL} ORDER BY created_at DESC`) });
    } catch (error) { next(error); }
  });

  router.get('/listings/:id', async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new HttpError(404, 'Annonsen hittades inte.');
      const rows = await query(LISTING_BY_ID_SQL, [req.params.id]);
      if (!rows.length) throw new HttpError(404, 'Annonsen hittades inte.');
      res.json({ listing: rows[0] });
    } catch (error) { next(error); }
  });

  // --- Auth (demo: school contact e-mail + shared demo password) ----------
  router.post('/auth/login', async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const school = await fetchSchoolByContactEmail(email);
      const expected = Buffer.from(demoPassword());
      const given = Buffer.from(password);
      const ok = school && expected.length === given.length && crypto.timingSafeEqual(expected, given);
      if (!ok) throw new HttpError(401, 'E-postadressen eller lösenordet stämmer inte.');
      res.json({ token: signToken(school.id), school: schoolSummary(school) });
    } catch (error) { next(error); }
  });

  router.post('/auth/register', async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!name) throw new HttpError(400, 'Ange ett namn eller skolans namn.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Ange en giltig e-postadress.');
      if (password.length < 8) throw new HttpError(400, 'Lösenordet måste innehålla minst 8 tecken.');
      if (await fetchSchoolByContactEmail(email)) {
        throw new HttpError(409, 'Det finns redan en skola med den e-postadressen. Logga in i stället.');
      }
      const rows = await query(
        `INSERT INTO shopit.schools (name, city, visiting_address, billing_address, billing_reference, contact_email)
         VALUES ($1, $2, $3, $4, '', $5) RETURNING *`,
        [name, 'Anges senare', 'Anges senare', 'Anges senare', email]
      );
      res.status(201).json({ token: signToken(rows[0].id), school: schoolSummary(rows[0]) });
    } catch (error) { next(error); }
  });

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ school: schoolSummary(req.school) });
  });

  // --- Min sida: school info, own listings, inventory ---------------------
  router.get('/school/me', requireAuth, (req, res) => {
    res.json({ school: schoolSummary(req.school) });
  });

  router.get('/school/me/inventory', requireAuth, async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT p.id, p.title, p.description, p.category, p.image_url, p.quantity, p.created_at,
                l.id AS listing_id, l.price, l.status AS listing_status
         FROM shopit.products p
         LEFT JOIN shopit.listings l ON l.product_id = p.id
         WHERE p.school_id = $1
         ORDER BY p.created_at DESC`,
        [req.school.id]
      );
      res.json({ products: rows });
    } catch (error) { next(error); }
  });

  router.get('/school/me/listings', requireAuth, async (req, res, next) => {
    try {
      const rows = await query(
        `SELECT l.id, l.price, l.created_at, l.created_at + interval '720 hours' AS expires_at,
                CASE WHEN l.status = 'active' AND l.created_at + interval '720 hours' <= now()
                     THEN 'expired' ELSE l.status END AS status,
                p.id AS product_id, p.title, p.category, p.image_url, p.quantity
         FROM shopit.listings l
         JOIN shopit.products p ON p.id = l.product_id
         WHERE p.school_id = $1
         ORDER BY l.created_at DESC`,
        [req.school.id]
      );
      res.json({ listings: rows });
    } catch (error) { next(error); }
  });

  // New listing = new inventory product + active listing (demo rule: one
  // listing per product, offered at the given price for all remaining stock).
  router.post('/school/me/listings', requireAuth, async (req, res, next) => {
    try {
      const body = req.body || {};
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const category = body.category;
      const quantity = nonNegativeInt(body.quantity);
      const price = priceValue(body.price);
      if (!title) throw new HttpError(400, 'Ange en titel.');
      if (!CATEGORIES.includes(category)) throw new HttpError(400, `Kategorin måste vara en av: ${CATEGORIES.join(', ')}.`);
      if (quantity === null) throw new HttpError(400, 'Ange ett antal (heltal, minst 0).');
      if (price === null) throw new HttpError(400, 'Ange ett pris (0 eller högre).');

      const created = await withTransaction(async (client) => {
        const productRes = await client.query(
          `INSERT INTO shopit.products (school_id, title, description, category, image_url, quantity)
           VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6) RETURNING id`,
          [req.school.id, title, description, category, typeof body.image_url === 'string' ? body.image_url : '', quantity]
        );
        const listingRes = await client.query(
          `INSERT INTO shopit.listings (product_id, price) VALUES ($1, $2) RETURNING id`,
          [productRes.rows[0].id, price]
        );
        return { productId: productRes.rows[0].id, listingId: listingRes.rows[0].id };
      });

      const rows = await query(LISTING_BY_ID_SQL, [created.listingId]);
      res.status(201).json({ listing: rows[0] });
    } catch (error) { next(error); }
  });

  // Edit one of the school's own listings (and its product).
  router.patch('/listings/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new HttpError(404, 'Annonsen hittades inte.');
      const body = req.body || {};
      const fields = {};
      if (typeof body.title === 'string') {
        if (!body.title.trim()) throw new HttpError(400, 'Titeln får inte vara tom.');
        fields.title = body.title.trim();
      }
      if (typeof body.description === 'string') fields.description = body.description.trim();
      if (body.category !== undefined) {
        if (!CATEGORIES.includes(body.category)) throw new HttpError(400, `Kategorin måste vara en av: ${CATEGORIES.join(', ')}.`);
        fields.category = body.category;
      }
      if (body.quantity !== undefined) {
        const quantity = nonNegativeInt(body.quantity);
        if (quantity === null) throw new HttpError(400, 'Ange ett antal (heltal, minst 0).');
        fields.quantity = quantity;
      }
      if (body.price !== undefined) {
        const price = priceValue(body.price);
        if (price === null) throw new HttpError(400, 'Ange ett pris (0 eller högre).');
        fields.price = price;
      }
      if (body.image_url !== undefined) {
        fields.image_url = typeof body.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null;
      }
      if (!Object.keys(fields).length) throw new HttpError(400, 'Inga fält att uppdatera.');

      await withTransaction(async (client) => {
        const res2 = await client.query(
          `SELECT p.id FROM shopit.listings l JOIN shopit.products p ON p.id = l.product_id
           WHERE l.id = $1 AND p.school_id = $2`,
          [req.params.id, req.school.id]
        );
        if (!res2.rows.length) throw new HttpError(404, 'Annonsen hittades inte eller tillhör inte din skola.');
        const productId = res2.rows[0].id;

        const productSets = ['title', 'description', 'category', 'quantity', 'image_url'].filter(key => key in fields);
        if (productSets.length) {
          const params = productSets.map(key => fields[key]);
          params.push(productId);
          await client.query(
            `UPDATE shopit.products SET ${productSets.map((key, i) => `${key} = $${i + 1}`).join(', ')} WHERE id = $${productSets.length + 1}`,
            params
          );
        }
        if ('price' in fields) {
          await client.query('UPDATE shopit.listings SET price = $1 WHERE id = $2', [fields.price, req.params.id]);
        }
      });

      const rows = await query(LISTING_BY_ID_SQL, [req.params.id]);
      res.json({ listing: rows[0] });
    } catch (error) { next(error); }
  });

  // "Radera" = ta ner: the listing is withdrawn so order history stays intact.
  router.delete('/listings/:id', requireAuth, async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new HttpError(404, 'Annonsen hittades inte.');
      const result = await query(
        `UPDATE shopit.listings l SET status = 'withdrawn'
         FROM shopit.products p
         WHERE l.product_id = p.id AND l.id = $1 AND p.school_id = $2 AND l.status <> 'sold'
         RETURNING l.id`,
        [req.params.id, req.school.id]
      );
      if (!result.length) throw new HttpError(404, 'Annonsen hittades inte eller tillhör inte din skola.');
      res.json({ ok: true });
    } catch (error) { next(error); }
  });

  // --- Image upload (file picker or mobile camera) -------------------------
  const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');
  const storage = multer.diskStorage({
    // multer does not create the destination directory itself.
    destination: (_req, _file, cb) => {
      mkdir(uploadDir, { recursive: true }).then(() => cb(null, uploadDir), cb);
    },
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.bin').toLowerCase().slice(0, 8);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(jpeg|png|webp|gif|svg\+xml)$/.test(file.mimetype)) cb(null, true);
      else cb(new HttpError(415, 'Bara bildfiler (JPEG, PNG, WebP, GIF, SVG) är tillåtna.'));
    },
  });

  router.post('/uploads', requireAuth, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) return next(err);
      if (!req.file) return next(new HttpError(400, 'Bilda en bildfil med fältnamnet "image".'));
      res.status(201).json({ url: `/uploads/${req.file.filename}` });
    });
  });

  // --- Orders: "Köp direkt" och varukorgsköp går genom samma endpoint ------
  // "Köp direkt" = en rad; varukorgen = flera rader (eventuellt flera säljare).
  async function handlePlaceOrder(req, res, next) {
    try {
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : (req.body?.listing_id ? [{ listing_id: req.body.listing_id, quantity: req.body.quantity ?? 1 }] : []);
      const byListing = new Map();
      for (const raw of rawItems) {
        if (!raw || !isUuid(raw.listing_id)) throw new HttpError(400, 'Varje varukorgsrad behöver en giltig listing_id.');
        const quantity = positiveInt(raw.quantity ?? 1);
        if (quantity === null) throw new HttpError(400, 'Antalet måste vara ett positivt heltal.');
        byListing.set(raw.listing_id, (byListing.get(raw.listing_id) || 0) + quantity);
      }
      if (!byListing.size) throw new HttpError(400, 'Inga produkter att köpa.');
      const items = [...byListing].map(([listing_id, quantity]) => ({ listing_id, quantity }));

      const placed = await placeOrder(req.school, items);
      const total = placed.items.reduce((sum, item) => sum + Number(item.line_total), 0);
      const confirmation = await deliverOrderConfirmation({ order: placed.order, items: placed.items, buyer: req.school });
      res.status(201).json({
        order: {
          id: placed.order.id,
          created_at: placed.order.created_at,
          total_sek: total,
          ...confirmation,
          items: placed.items.map(item => ({
            listing_id: item.listing_id,
            product_title: item.product_title,
            seller_name: item.seller_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
          })),
        },
      });
    } catch (error) { next(error); }
  }

  router.post('/orders', requireAuth, handlePlaceOrder);
  router.post('/orders/direct', requireAuth, handlePlaceOrder);
  router.post('/orders/checkout', requireAuth, handlePlaceOrder);

  router.get('/school/me/orders', requireAuth, async (req, res, next) => {
    try {
      const orders = await query(
        `SELECT o.id, o.created_at, COALESCE(t.total_sek, 0) AS total_sek
         FROM shopit.orders o
         LEFT JOIN shopit.order_totals t ON t.order_id = o.id
         WHERE o.buyer_school_id = $1
         ORDER BY o.created_at DESC`,
        [req.school.id]
      );
      if (!orders.length) return res.json({ orders: [] });
      const items = await query(
        `SELECT order_id, listing_id, product_title, seller_name, quantity, unit_price, line_total
         FROM shopit.order_items
         WHERE order_id = ANY($1)
         ORDER BY seller_name, product_title`,
        [orders.map(o => o.id)]
      );
      const byOrder = new Map();
      for (const item of items) {
        if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
        byOrder.get(item.order_id).push(item);
      }
      res.json({ orders: orders.map(o => ({ ...o, items: byOrder.get(o.id) || [] })) });
    } catch (error) { next(error); }
  });

  return router;
}
