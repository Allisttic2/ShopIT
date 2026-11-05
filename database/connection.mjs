import { existsSync } from 'node:fs';
import dns from 'node:dns';
import dotenv from 'dotenv';
import pg from 'pg';

// Windows can keep querying a dead local DNS server (e.g. Tailscale's) that
// answers NXDOMAIN for public names, so getaddrinfo fails with ENOTFOUND even
// though the router's DNS works. Fall back to a public resolver before giving up.
const osLookup = dns.lookup;
const fallbackResolvers = [
  new dns.Resolver({ nameserver: '8.8.8.8' }),
  new dns.Resolver({ nameserver: '1.1.1.1' }),
];
dns.lookup = (hostname, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (options?.all) return osLookup(hostname, options, callback);
  const family = Number(options?.hints) === 6 ? 6 : 4;
  osLookup(hostname, options, (err, address, fam) => {
    if (!err) return callback(null, address, fam);
    const dnsFailure = ['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EHOSTUNREACH'].includes(err.code);
    if (!dnsFailure) return callback(err, address, fam);
    const method = family === 6 ? 'resolve6' : 'resolve4';
    const attempt = (i) => {
      if (i >= fallbackResolvers.length) return callback(err);
      fallbackResolvers[i][method](hostname, (err2, addrs) => {
        if (err2 || !addrs?.length) return attempt(i + 1);
        callback(null, addrs[0], family);
      });
    };
    attempt(0);
  });
};

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
