// ShopIT backend – entry point. Runs locally and serves both the API (/api)
// and the finished static frontend, so the whole demo lives on one origin.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiRouter, HttpError } from './routes.mjs';
import { closePool } from './db.mjs';

// dotenv is loaded by database/connection.mjs (imported through routes.mjs)
// before any handler runs; this call is a safety net for the static parts.
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(backendDir, '..');
const port = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use('/api', createApiRouter());

// Uploaded product images (served under /uploads/...).
app.use('/uploads', express.static(path.join(backendDir, 'uploads'), { fallthrough: false, maxAge: '7d' }));

// Static frontend (index.html, login.html, ... and /images).
app.use(express.static(root, { index: 'index.html' }));

// JSON error handler: HttpError keeps its status, everything else is 500.
app.use((error, _req, res, _next) => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'För stor anslutning.' });
  console.error(error);
  res.status(500).json({ error: 'Något gick fel på servern. Försök igen.' });
});

const server = app.listen(port, () => {
  console.log(`ShopIT backend körs på http://localhost:${port} (databas: ${process.env.NEON_BRANCH ?? 'okänd branch'})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // Express 5: the app is a request handler; only the http.Server can close.
    server.close(async () => {
      await closePool().catch(() => {});
      process.exit(0);
    });
  });
}
