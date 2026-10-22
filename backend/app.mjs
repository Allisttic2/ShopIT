import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter, HttpError } from './routes.mjs';
import { requireAuth, requirePageAuth, validateAuthConfig } from './auth.mjs';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(backendDir, '..');

export function createApp() {
  validateAuthConfig();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter());

  const noStore = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  };
  app.use('/uploads', noStore, requireAuth, express.static(path.join(backendDir, 'uploads'), {
    fallthrough: false, cacheControl: false,
    setHeaders(res) {
      // Uploaded SVGs must not run scripts with the viewer's session.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));

  // Only the assets needed by the login page are anonymous.
  const publicFiles = new Set([
    '/login.html', '/login.css', '/main.css', '/api.js', '/auth.js',
    '/images/logo.png', '/images/hero.png',
  ]);
  const protectedFiles = new Set([
    '/', '/index.html', '/profil.html', '/checkout.html', '/help.html',
    '/help.css', '/images/product-placeholder.svg',
  ]);
  const frontend = express.static(root, { index: 'index.html', cacheControl: false });
  app.use((req, res, next) => {
    if (publicFiles.has(req.path)) return frontend(req, res, next);
    if (!protectedFiles.has(req.path)) return next();
    noStore(req, res, () => {
      const guard = req.path === '/' || req.path.endsWith('.html') ? requirePageAuth : requireAuth;
      guard(req, res, () => frontend(req, res, next));
    });
  });

  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error?.code === '23505' && error.constraint === 'schools_contact_email_unique') return res.status(409).json({ error: 'Det finns redan en skola med den e-postadressen.' });
    if (error instanceof multer.MulterError) {
      return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'Bilden får vara högst 5 MB.' : 'Ogiltig bilduppladdning. Använd bildfältet image.',
      });
    }
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'För stor anslutning.' });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'Ogiltig JSON.' });
    if (error?.status === 404) return res.status(404).json({ error: 'Filen hittades inte.' });
    console.error(error);
    res.status(500).json({ error: 'Något gick fel på servern. Försök igen.' });
  });
  return app;
}
