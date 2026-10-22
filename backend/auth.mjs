// Session verification shared by API requests, pages and uploaded images.
import crypto from 'node:crypto';
import { query } from './db.mjs';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'shopit_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAuthConfig() {
  secret();
}

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error('AUTH_SECRET måste vara en slumpmässig hemlighet på minst 32 byte.');
  }
  return value;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function signToken(schoolId) {
  if (!UUID.test(schoolId)) throw new Error('Invalid school ID.');
  const payload = Buffer.from(JSON.stringify({ sid: schoolId, mode: 'demo', exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // Legacy/shared-password sessions must not survive disabling demo mode.
    if (data.mode !== 'demo' || process.env.DEMO_AUTH_ENABLED !== 'true' || process.env.NODE_ENV === 'production') return null;
    return typeof data.sid === 'string' && UUID.test(data.sid) &&
      Number.isSafeInteger(data.exp) && data.exp > Date.now() ? data.sid : null;
  } catch {
    return null;
  }
}

function cookieToken(req) {
  const value = (req.get('cookie') || '').split(';').find(cookie => cookie.trim().startsWith(`${COOKIE_NAME}=`));
  if (!value) return null;
  try { return decodeURIComponent(value.trim().slice(COOKIE_NAME.length + 1)); }
  catch { return null; }
}

export function tokenFromRequest(req) {
  const header = req.get('authorization');
  // Explicit invalid credentials must not fall back to a different identity.
  if (header !== undefined) return /^Bearer\s+(\S+)$/i.exec(header)?.[1] || null;
  return cookieToken(req);
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!(req.secure || process.env.NODE_ENV === 'production' || process.env.PUBLIC_BASE_URL?.startsWith('https://')),
    path: '/',
  };
}

export function setSessionCookie(req, res, token) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(req), maxAge: TOKEN_TTL_MS });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

// Cookie authentication also requires protection against cross-origin writes.
export function requireSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  const allowed = new Set([`${req.protocol}://${req.get('host')}`]);
  if (process.env.PUBLIC_BASE_URL) allowed.add(new URL(process.env.PUBLIC_BASE_URL).origin);
  if ((origin && !allowed.has(origin)) || req.get('sec-fetch-site') === 'cross-site' ||
      (!origin && cookieToken(req) && req.get('x-shopit-request') !== '1')) {
    return res.status(403).json({ error: 'Begäran måste komma från ShopIT.' });
  }
  next();
}

async function authenticate(req, res, next, redirect) {
  try {
    const schoolId = verifyToken(tokenFromRequest(req));
    const rows = schoolId ? await query('SELECT id, name, city, visiting_address, billing_address, billing_reference, contact_email FROM shopit.schools WHERE id = $1', [schoolId]) : [];
    if (!rows.length) {
      if (!redirect) return res.status(401).json({ error: 'Ingen eller ogiltig session. Logga in först.' });
      clearSessionCookie(req, res);
      const page = req.path === '/' ? 'index.html' : req.path.slice(1);
      return res.redirect(303, `/login.html?next=${encodeURIComponent(page)}`);
    }
    req.school = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

// The same verified school is used for API authorization and page navigation.
export function requireAuth(req, res, next) {
  return authenticate(req, res, next, false);
}

export function requirePageAuth(req, res, next) {
  return authenticate(req, res, next, true);
}
