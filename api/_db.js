import { Pool } from 'pg';

// Pool compartido entre invocaciones (Vercel mantiene en caliente).
const DATABASE_URL = process.env.DATABASE_URL;
export const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

let schemaEnsured = false;

export async function ensureSchema(){
  if (!pool || schemaEnsured) return;
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    console.warn('[db] conexión fallida (lazy) =>', e?.code || e?.message);
    return;
  }
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS api_keys (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      api_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      share_pool BOOLEAN DEFAULT true,
      last_checked_at TIMESTAMP NULL,
      last_valid BOOLEAN NULL
    )`);
    schemaEnsured = true;
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[schema] error', e);
  } finally {
    client.release();
  }
}
