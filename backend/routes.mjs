// ShopIT backend – API-rutter under /api.
import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import multer from 'multer';
import { query, withTransaction } from './db.mjs';
import { signToken, requireAuth, requireSameOrigin, setSessionCookie, clearSessionCookie } from './auth.mjs';
import { buildInvoiceHtml, invoiceNumber } from './invoices.mjs';
import { buildInvoicePdf } from './invoice-pdf.mjs';
import { sendMail, mailDeliveryMode } from './mail.mjs';
import { positiveInt, nonNegativeInt, priceValue, MAX_QUANTITY } from './validation.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = ['Datorer', 'Laddare', 'Kablar', 'Skärmar', 'Switchar', 'Router'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function demoPassword() {
  return process.env.DEMO_PASSWORD || '';
}

function requireDemoMode(_req, res, next) {
  if (process.env.DEMO_AUTH_ENABLED !== 'true' || process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'SchoolSoft-inloggningen är inte konfigurerad. Demo-inloggning är avstängd.' });
  }
  if (demoPassword().length < 8) {
    return res.status(503).json({ error: 'Demo-inloggningen saknar ett konfigurerat lösenord.' });
  }
  next();
}

function matchesDemoPassword(password) {
  const expected = Buffer.from(demoPassword());
  const given = Buffer.from(password);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

// Authenticated listing feed. The view handles the 30-day expiry.
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
  const rows = await query('SELECT * FROM shopit.schools WHERE lower(btrim(contact_email)) = lower(btrim($1)) ORDER BY created_at', [email]);
  return rows[0] || null;
}

// Creates the order + order lines and decrements stock atomically.
// items: [{ listing_id, quantity }] – duplicate listings are merged.
async function placeOrder(buyer, items) {
  return withTransaction(async (client) => {
    const orderRes = await client.query(
      `INSERT INTO shopit.orders (buyer_school_id, buyer_name, buyer_email, buyer_billing_address, buyer_billing_reference)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [buyer.id, buyer.name, buyer.contact_email, buyer.billing_address, buyer.billing_reference]
    );
    const orderId = orderRes.rows[0].id;

    const placed = [];
    for (const item of items) {
      const res = await client.query(
        `SELECT l.id, l.status, l.price, l.created_at,
                l.created_at + interval '720 hours' AS expires_at,
                l.created_at <= now() AND l.created_at + interval '720 hours' > now() AS within_window,
                p.id AS product_id, p.school_id AS seller_school_id, p.title, p.quantity,
                s.name AS seller_name, s.billing_address AS seller_billing_address,
                s.billing_reference AS seller_billing_reference
         FROM shopit.listings l
         JOIN shopit.products p ON p.id = l.product_id
         JOIN shopit.schools s ON s.id = p.school_id
         WHERE l.id = $1
         FOR UPDATE OF l, p`,
        [item.listing_id]
      );
      const row = res.rows[0];
      if (!row) throw new HttpError(400, `Annonsen ${item.listing_id} finns inte.`);
      const available = row.status === 'active' && row.within_window && row.quantity > 0;
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
    return { order: orderRes.rows[0], items: placed };
  });
}

// Generates the invoice and sends the confirmation e-mail. Failures here are
// logged and reported in the response, but the order itself stays committed.
async function deliverOrderConfirmation({ order, items, buyer }) {
  const number = invoiceNumber(order.id, order.created_at);
  try {
    const html = buildInvoiceHtml({ order, items });
    const pdf = await buildInvoicePdf({ order, items });
    const delivery = await sendMail({
      to: buyer.contact_email,
      subject: `Ordern är genomförd – faktura ${number} (NTI-T Shopp)`,
      html,
      attachments: [{ filename: `${number}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
    return { invoice_number: number, invoice_url: `/api/orders/${order.id}/invoice.pdf`, email_sent: true, email_delivery: delivery };
  } catch (error) {
    console.error('[orders] Kunde inte skicka orderbekräftelse:', error.message);
    return { invoice_number: number, invoice_url: `/api/orders/${order.id}/invoice.pdf`, email_sent: false, email_delivery: mailDeliveryMode() };
  }
}

export function createApiRouter() {
  const router = Router();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(requireSameOrigin);
  // Only the sign-in entry points are public. New API routes are protected by default.
  router.use((req, res, next) => {
    if (req.method === 'POST' && ['/auth/login', '/auth/register', '/auth/logout'].includes(req.path)) return next();
    return requireAuth(req, res, next);
  });

  router.post('/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // --- Health -------------------------------------------------------------
  router.get('/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ ok: true, mail_delivery: mailDeliveryMode() });
  });

  // --- Listings for authenticated schools ---------------------------------
  router.get('/listings', async (req, res, next) => {
    try {
      const conditions = [], params = [];
      const parameter = value => { params.push(value); return `$${params.length}`; };
      const input = key => {
        const value = req.query[key];
        if (value === undefined) return '';
        if (typeof value !== 'string' || value.length > 200) throw new HttpError(400, 'Ogiltigt sökfilter.');
        return value.trim();
      };
      const pattern = value => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
      const search = input('q');
      if (search) { const p = parameter(pattern(search)); conditions.push(`(title ILIKE ${p} OR description ILIKE ${p})`); }
      const category = input('category');
      if (category) {
        if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Ogiltig kategori.');
        conditions.push(`category = ${parameter(category)}`);
      }
      const city = input('city');
      if (city) conditions.push(`lower(city) = lower(${parameter(city)})`);
      const location = input('location');
      if (location) { const p = parameter(pattern(location)); conditions.push(`(city ILIKE ${p} OR school_name ILIKE ${p})`); }
      const schoolId = input('school_id');
      if (schoolId) {
        if (!isUuid(schoolId)) throw new HttpError(400, 'Ogiltigt skol-ID.');
        conditions.push(`school_id = ${parameter(schoolId)}`);
      }
      const min = input('min_price'), max = input('max_price');
      if (min && priceValue(min) === null || max && priceValue(max) === null) throw new HttpError(400, 'Ogiltigt prisfilter.');
      if (min && max && priceValue(min) > priceValue(max)) throw new HttpError(400, 'Lägsta pris får inte vara högre än högsta pris.');
      if (min) conditions.push(`price >= ${parameter(priceValue(min))}`);
      if (max) conditions.push(`price <= ${parameter(priceValue(max))}`);
      const sorts = { newest: 'created_at DESC', oldest: 'created_at ASC', 'date-desc': 'created_at DESC', 'date-asc': 'created_at ASC', 'price-asc': 'price ASC', 'price-desc': 'price DESC', price_asc: 'price ASC', price_desc: 'price DESC' };
      const sort = input('sort') || 'newest';
      if (!Object.hasOwn(sorts, sort)) throw new HttpError(400, 'Ogiltig sortering.');
      res.json({ listings: await query(`${ACTIVE_LISTING_SQL}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ${sorts[sort]}, id ASC`, params) });
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
  router.post('/auth/login', requireDemoMode, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const school = await fetchSchoolByContactEmail(email);
      const ok = school && matchesDemoPassword(password);
      if (!ok) throw new HttpError(401, 'E-postadressen eller lösenordet stämmer inte.');
      const token = signToken(school.id);
      setSessionCookie(req, res, token);
      res.json({ token, school: schoolSummary(school) });
    } catch (error) { next(error); }
  });

  router.post('/auth/register', requireDemoMode, async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!name || name.length > 200) throw new HttpError(400, 'Ange skolans namn (högst 200 tecken).');
      if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Ange en giltig e-postadress.');
      if (password.length < 8) throw new HttpError(400, 'Lösenordet måste innehålla minst 8 tecken.');
      if (!matchesDemoPassword(password)) {
        throw new HttpError(400, 'Alla skolor använder projektets gemensamma demolösenord, även vid registrering. Ange demolösenordet och försök igen.');
      }
      if (await fetchSchoolByContactEmail(email)) {
        throw new HttpError(409, 'Det finns redan en skola med den e-postadressen. Logga in i stället.');
      }
      const rows = await query(
        `INSERT INTO shopit.schools (name, city, visiting_address, billing_address, billing_reference, contact_email)
         VALUES ($1, $2, $3, $4, '', $5) RETURNING *`,
        [name, 'Anges senare', 'Anges senare', 'Anges senare', email]
      );
      const token = signToken(rows[0].id);
      setSessionCookie(req, res, token);
      res.status(201).json({ token, school: schoolSummary(rows[0]) });
    } catch (error) { next(error); }
  });

  router.get('/auth/me', (req, res) => {
    res.json({ school: schoolSummary(req.school) });
  });

  // --- Min sida: school info, own listings, inventory ---------------------
  router.get('/school/me', (req, res) => {
    res.json({ school: schoolSummary(req.school) });
  });

  router.patch('/school/me', async (req, res, next) => {
    try {
      const allowed = { name: 200, city: 120, visiting_address: 1000, billing_address: 1000, billing_reference: 200, contact_email: 254 };
      const body = req.body || {}, values = [], sets = [];
      for (const [key, value] of Object.entries(body)) {
        if (!Object.hasOwn(allowed, key) || typeof value !== 'string' || value.trim().length > allowed[key]) throw new HttpError(400, 'Ogiltiga skoluppgifter.');
        const text = key === 'contact_email' ? value.trim().toLowerCase() : value.trim();
        if (['name', 'city', 'contact_email'].includes(key) && !text) throw new HttpError(400, 'Namn, ort och e-post får inte vara tomma.');
        if (key === 'contact_email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) throw new HttpError(400, 'Ange en giltig e-postadress.');
        values.push(text); sets.push(`${key} = $${values.length}`);
      }
      if (!sets.length) throw new HttpError(400, 'Inga skoluppgifter att uppdatera.');
      values.push(req.school.id);
      const rows = await query(`UPDATE shopit.schools SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
      res.json({ school: schoolSummary(rows[0]) });
    } catch (error) { next(error); }
  });

  router.get('/school/me/inventory', async (req, res, next) => {
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

  function productInput(body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!title || title.length > 200) throw new HttpError(400, 'Ange en titel (högst 200 tecken).');
    if (description.length > 5000) throw new HttpError(400, 'Beskrivningen får vara högst 5000 tecken.');
    if (!CATEGORIES.includes(body.category)) throw new HttpError(400, 'Ogiltig kategori.');
    const quantity = nonNegativeInt(body.quantity);
    if (quantity === null) throw new HttpError(400, 'Ange ett antal (heltal, minst 0).');
    return { title, description, category: body.category, quantity, image_url: typeof body.image_url === 'string' ? body.image_url.trim() : '' };
  }

  router.post('/school/me/inventory', async (req, res, next) => {
    try {
      const product = productInput(req.body || {});
      const rows = await query(`INSERT INTO shopit.products (school_id,title,description,category,quantity,image_url)
        VALUES ($1,$2,$3,$4,$5,NULLIF($6,'')) RETURNING *`,
      [req.school.id, product.title, product.description, product.category, product.quantity, product.image_url]);
      res.status(201).json({ product: rows[0] });
    } catch (error) { next(error); }
  });

  async function publishInventory(req, res, next) {
    try {
      const productId = req.params.id || req.body?.product_id;
      if (!isUuid(productId)) throw new HttpError(404, 'Inventariet hittades inte.');
      const price = priceValue(req.body?.price);
      if (price === null) throw new HttpError(400, 'Ange ett giltigt pris (0 eller högre).');
      const listingId = await withTransaction(async client => {
        const products = await client.query('SELECT id,quantity FROM shopit.products WHERE id=$1 AND school_id=$2 FOR UPDATE', [productId, req.school.id]);
        if (!products.rows.length) throw new HttpError(404, 'Inventariet hittades inte.');
        if (products.rows[0].quantity < 1) throw new HttpError(409, 'Det finns inga exemplar att sälja.');
        const existing = await client.query('SELECT id FROM shopit.listings WHERE product_id=$1', [productId]);
        if (existing.rows.length) throw new HttpError(409, 'Inventariet har redan en annons.');
        const result = await client.query('INSERT INTO shopit.listings (product_id,price) VALUES ($1,$2) RETURNING id', [productId, price]);
        return result.rows[0].id;
      });
      res.status(201).json({ listing: (await query(LISTING_BY_ID_SQL, [listingId]))[0] });
    } catch (error) { next(error); }
  }
  router.post('/school/me/inventory/:id/listing', publishInventory);

  router.get('/school/me/listings', async (req, res, next) => {
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
  router.post('/school/me/listings', async (req, res, next) => {
    if (req.body?.product_id !== undefined) return publishInventory(req, res, next);
    try {
      const body = req.body || {};
      const { title, description, category, quantity, image_url } = productInput(body);
      const price = priceValue(body.price);
      if (price === null) throw new HttpError(400, 'Ange ett pris (0 eller högre).');

      const created = await withTransaction(async (client) => {
        const productRes = await client.query(
          `INSERT INTO shopit.products (school_id, title, description, category, image_url, quantity)
           VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6) RETURNING id`,
          [req.school.id, title, description, category, image_url, quantity]
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
  router.patch('/listings/:id', async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new HttpError(404, 'Annonsen hittades inte.');
      const body = req.body || {};
      const fields = {};
      if (typeof body.title === 'string') {
        if (!body.title.trim() || body.title.trim().length > 200) throw new HttpError(400, 'Ange en titel (högst 200 tecken).');
        fields.title = body.title.trim();
      }
      if (typeof body.description === 'string') {
        if (body.description.length > 5000) throw new HttpError(400, 'Beskrivningen får vara högst 5000 tecken.');
        fields.description = body.description.trim();
      }
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
  router.delete('/listings/:id', async (req, res, next) => {
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

  router.post('/uploads', (req, res, next) => {
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
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : (req.body?.listing_id ? [{ listing_id: req.body.listing_id, quantity: req.body.quantity === undefined ? 1 : req.body.quantity }] : []);
      const byListing = new Map();
      for (const raw of rawItems) {
        if (!raw || !isUuid(raw.listing_id)) throw new HttpError(400, 'Varje varukorgsrad behöver en giltig listing_id.');
        const quantity = positiveInt(raw.quantity === undefined ? 1 : raw.quantity);
        if (quantity === null) throw new HttpError(400, 'Antalet måste vara ett positivt heltal.');
        const merged = (byListing.get(raw.listing_id) || 0) + quantity;
        if (merged > MAX_QUANTITY) throw new HttpError(400, 'För stort antal i varukorgen.');
        byListing.set(raw.listing_id, merged);
      }
      if (!byListing.size) throw new HttpError(400, 'Inga produkter att köpa.');
      const items = [...byListing].map(([listing_id, quantity]) => ({ listing_id, quantity }))
        .sort((a, b) => a.listing_id.localeCompare(b.listing_id));

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

  router.post('/orders', handlePlaceOrder);
  router.post('/orders/direct', handlePlaceOrder);
  router.post('/orders/checkout', handlePlaceOrder);

  router.get('/orders/:id/invoice.pdf', async (req, res, next) => {
    try {
      if (!isUuid(req.params.id)) throw new HttpError(404, 'Beställningen hittades inte.');
      const orders = await query('SELECT * FROM shopit.orders WHERE id=$1 AND buyer_school_id=$2', [req.params.id, req.school.id]);
      if (!orders.length) throw new HttpError(404, 'Beställningen hittades inte.');
      const items = await query('SELECT * FROM shopit.order_items WHERE order_id=$1 ORDER BY seller_school_id, product_title', [req.params.id]);
      const pdf = await buildInvoicePdf({ order: orders[0], items });
      res.type('pdf').attachment(`${invoiceNumber(orders[0].id, orders[0].created_at)}.pdf`).send(pdf);
    } catch (error) { next(error); }
  });

  router.get('/school/me/orders', async (req, res, next) => {
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
