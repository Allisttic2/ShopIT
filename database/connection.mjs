import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';

// Explicit alternate file makes branch testing possible without replacing production env.
const envFile = process.env.SHOPIT_ENV_FILE;
if (envFile && !existsSync(envFile)) {
  throw new Error('SHOPIT_ENV_FILE does not exist.');
}
dotenv.config({ path: envFile ? [envFile] : ['.env.local', '.env'], quiet: true });

export function createDatabasePool({ direct = false } = {}) {
  const key = direct ? 'DATABASE_URL_UNPOOLED' : 'DATABASE_URL';
  const connectionString = process.env[key];
  if (!connectionString) throw new Error(`${key} is missing. Run neon deploy first.`);
  const url = new URL(connectionString);
  if (direct && url.hostname.includes('-pooler')) {
    throw new Error('Migrations require DATABASE_URL_UNPOOLED with a direct hostname.');
  }
  // pg currently treats require as verify-full. Make verification explicit so
  // a future pg major version cannot silently weaken this TLS connection.
  if (url.searchParams.get('sslmode') === 'require') {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return new pg.Pool({
    connectionString: url.toString(),
    max: 3,
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 10000,
  });
}
