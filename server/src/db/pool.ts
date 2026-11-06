import pg from 'pg';
import { env } from '../config/env.js';

// Return NUMERIC as number. Values stored here (spend, ratios) fit safely in a double.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
