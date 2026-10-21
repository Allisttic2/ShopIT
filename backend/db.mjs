// ShopIT backend – small helpers around the shared pg pool.
import { createDatabasePool } from '../database/connection.mjs';

let pool = null;

export function getPool() {
  if (!pool) pool = createDatabasePool({ direct: false });
  return pool;
}

export async function query(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

// Runs fn(client) inside a single transaction: COMMIT on success, ROLLBACK on error.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
