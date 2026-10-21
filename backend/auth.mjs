// ShopIT backend – demo session tokens for school accounts.
//
// The real integration (SchoolSoft) is not available yet, so demo accounts
// are the schools themselves: each school logs in with its contact e-mail
// and a shared demo password (DEMO_PASSWORD). Tokens are HMAC-signed
// base64url payloads – no JWT library needed for a demo.
import crypto from 'node:crypto';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) console.warn('[auth] AUTH_SECRET ej satt – använd en hemlig env i produktion/demo.');
  return value || 'shopit-dev-only-secret';
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function signToken(schoolId) {
  const payload = Buffer.from(JSON.stringify({ sid: schoolId, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp >= Date.now() ? data.sid : null;
  } catch {
    return null;
  }
}

export function tokenFromRequest(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

// Express middleware: attaches req.school (full school row) or responds 401.
export async function requireAuth(req, res, next) {
  const schoolId = verifyToken(tokenFromRequest(req));
  if (!schoolId) return res.status(401).json({ error: 'Ingen eller ogiltig session. Logga in först.' });
  try {
    const { query } = await import('./db.mjs');
    const rows = await query('SELECT id, name, city, visiting_address, billing_address, billing_reference, contact_email FROM shopit.schools WHERE id = $1', [schoolId]);
    if (!rows.length) return res.status(401).json({ error: 'Skolan för denna session finns inte längre.' });
    req.school = rows[0];
    next();
  } catch (error) {
    next(error);
  }
}
