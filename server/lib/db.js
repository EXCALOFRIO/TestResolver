import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
export const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000
}) : null;

if (!DATABASE_URL) {
  console.warn('[db] DATABASE_URL ausente: no habrá persistencia de claves de usuario');
}

async function testOnce(){
  if (!pool) return;
  try { await pool.query('SELECT 1'); }
  catch(e){ console.error('[db] test inicial falló', e?.code, e?.message); }
}
testOnce();

let schemaEnsured = false;
export async function ensureSchema(){
  if (!pool || schemaEnsured) return;
  let client;
  try { client = await pool.connect(); } catch (e) { console.warn('[db] conexión fallida (ensureSchema) =>', e?.code || e?.message); return; }
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
    await client.query(`CREATE TABLE IF NOT EXISTS test_runs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      auto_name BOOLEAN DEFAULT true,
      questions JSONB NOT NULL,
      results JSONB NOT NULL,
      total_questions INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      share_token TEXT UNIQUE
    )`);
    await client.query('CREATE INDEX IF NOT EXISTS idx_test_runs_user_created ON test_runs(user_id, created_at DESC)');
    await client.query('ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_test_runs_share_token ON test_runs(share_token)');
    schemaEnsured = true;
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[schema] error', e);
  } finally { client.release(); }
}
