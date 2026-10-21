import { readFile } from 'node:fs/promises';
import { createDatabasePool } from './connection.mjs';

const action = process.argv[2];
if (!['status', 'migrate', 'seed', 'verify'].includes(action)) {
  console.error('Usage: node database/manage.mjs status|migrate|seed|verify');
  process.exit(1);
}

// Use the app's pooled URL for status; direct connections for SQL administration.
let pool;
try {
  pool = createDatabasePool({ direct: action !== 'status' });
  const client = await pool.connect();
  try {
    if (action === 'status') {
      await client.query('BEGIN READ ONLY');
      const tables = await client.query(`SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'shopit' AND table_type = 'BASE TABLE' ORDER BY table_name`);
      console.log(`PostgreSQL connection: OK (branch ${process.env.NEON_BRANCH ?? 'unspecified'})`);
      console.log(`ShopIT tables: ${tables.rows.map(row => row.table_name).join(', ') || 'not installed'}`);
      if (tables.rows.length) {
        const counts = await client.query(`SELECT
          (SELECT count(*)::int FROM shopit.schools) AS schools,
          (SELECT count(*)::int FROM shopit.products) AS products,
          (SELECT count(*)::int FROM shopit.active_listings) AS active_listings,
          (SELECT count(*)::int FROM shopit.orders) AS orders`);
        console.log(JSON.stringify(counts.rows[0]));
      }
      await client.query('ROLLBACK');
    } else {
      if (action === 'verify' && process.env.NEON_BRANCH === 'production') {
        throw new Error('Run verification on a separate test branch, not production.');
      }
      if (action === 'migrate') {
        const { rows } = await client.query("SELECT to_regnamespace('shopit') IS NOT NULL AS exists");
        if (rows[0].exists) {
          throw new Error('Schema shopit already exists. Preserved it; inspect before applying further migrations.');
        }
      }
      const file = { migrate: '001_schema.sql', seed: '002_seed.sql', verify: '003_verify.sql' }[action];
      await client.query(await readFile(new URL(file, import.meta.url), 'utf8'));
      console.log(`${file}: OK (branch ${process.env.NEON_BRANCH ?? 'unspecified'})`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  // Connection failures can embed credentials/hostnames: only print known safe text.
  if (error.message.startsWith('Schema shopit') || error.message.startsWith('Run verification') ||
      error.message.startsWith('Migrations require') || error.message.startsWith('SHOPIT_ENV_FILE') ||
      /^(DATABASE_URL|DATABASE_URL_UNPOOLED) is missing/.test(error.message)) {
    console.error(error.message);
  } else {
    console.error(`Database ${action} failed (${error.code ?? error.name}). No credentials printed.`);
  }
  process.exitCode = 1;
} finally {
  await pool?.end();
}
