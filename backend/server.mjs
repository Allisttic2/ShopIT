// ShopIT backend – entry point. Runs locally and serves both the API (/api)
// and the finished static frontend, so the whole demo lives on one origin.
import { createApp } from './app.mjs';
import { closePool } from './db.mjs';

// database/connection.mjs loads the selected env file before createApp runs.

const port = Number(process.env.PORT || 3000);

const app = createApp();

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
