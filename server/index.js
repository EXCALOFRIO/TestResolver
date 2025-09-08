import dotenv from 'dotenv';
// Carga prioritaria de .env.local; si no existe, cae a .env por defecto
const loaded = dotenv.config({ path: '.env.local' });
if (loaded.error) {
  dotenv.config();
}
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('[server] DATABASE_URL no está definido. Configúralo en .env.local');
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// Healthcheck simple
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, db: true });
  } catch {
    return res.json({ ok: true, db: false });
  }
});

async function ensureSchema() {
  let client;
  try {
    client = await pool.connect();
  } catch (e) {
    console.error('[db] No se pudo conectar a la base de datos:', e?.code || e?.message || e);
    console.error('[db] El servidor seguirá arrancando, pero las rutas que requieren BD fallarán.');
    return; // salir sin lanzar para no tumbar el proceso
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
    // ALTERs idempotentes (ignorar errores si ya existen)
    try { await client.query('ALTER TABLE api_keys ADD COLUMN share_pool BOOLEAN DEFAULT true'); } catch {}
    try { await client.query('ALTER TABLE api_keys ADD COLUMN last_checked_at TIMESTAMP NULL'); } catch {}
    try { await client.query('ALTER TABLE api_keys ADD COLUMN last_valid BOOLEAN NULL'); } catch {}
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[schema] Error creando tablas', e);
  } finally {
    client.release();
  }
}

function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = (hdr.startsWith('Bearer ') ? hdr.slice(7) : null) || req.cookies['token'];
  if (!token) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'MISSING_FIELDS' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id,email', [email, hash]);
    const user = r.rows[0];
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: false, sameSite: 'lax' });
  return res.json({ token, user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'EMAIL_EXISTS' });
    console.error('[register] error', e); return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'MISSING_FIELDS' });
  try {
    const r = await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1', [email]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: false, sameSite: 'lax' });
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('[login] error', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.get('/api/apikey', auth, async (req, res) => {
  const uid = req.user.uid;
  try {
    const r = await pool.query('SELECT api_key FROM api_keys WHERE user_id=$1 ORDER BY id DESC', [uid]);
    return res.json({ keys: r.rows.map((x) => x.api_key) });
  } catch (e) {
    console.error('[apikey:list] error', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.post('/api/apikey', auth, async (req, res) => {
  const uid = req.user.uid;
  const { apiKey } = req.body || {};
  if (!apiKey) return res.status(400).json({ error: 'MISSING_API_KEY' });
  try {
    const exists = await pool.query('SELECT 1 FROM api_keys WHERE api_key=$1 LIMIT 1', [apiKey]);
    if (exists.rowCount) return res.status(409).json({ error: 'KEY_ALREADY_EXISTS' });
    await pool.query('INSERT INTO api_keys (user_id, api_key, share_pool) VALUES ($1,$2,true)', [uid, apiKey]);
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[apikey] error', e); return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// ---------- Pool de claves y validación backend ----------
const ENV_KEY_REGEX = /^(VITE_)?GEMINI_API_KEY\d*$/;
function getEnvKeys() {
  return Object.keys(process.env)
    .filter(k => ENV_KEY_REGEX.test(k))
    .map(k => ({ name: k, value: process.env[k] }))
    .filter(o => !!o.value);
}

async function pingKey(apiKey) {
  try {
    const client = new GoogleGenAI({ apiKey });
    const r = await client.models.generateContent({ model: 'models/gemma-3n-e2b-it', contents: 'ping' });
    return !!r;
  } catch { return false; }
}

// Cache en memoria para env keys (validación diaria)
const envKeyCache = new Map(); // keyValue -> { last:number, valid:boolean }
const ENV_CACHE_MS = 24 * 60 * 60 * 1000; // 24 horas

async function validateEnvKey(entry){
  const now = Date.now();
  const c = envKeyCache.get(entry.value);
  if (c && (now - c.last) < ENV_CACHE_MS) return c.valid;
  const ok = await pingKey(entry.value);
  envKeyCache.set(entry.value, { last: now, valid: ok });
  return ok;
}

async function buildKeyPool(maxKeys = 20) {
  // 1. Obtener claves de entorno
  const envKeys = getEnvKeys();
  // 2. Obtener claves de usuarios (share_pool=true)
  const dbKeysRes = await pool.query('SELECT id, api_key, share_pool, last_checked_at, last_valid FROM api_keys WHERE share_pool = true');
  const dbKeys = dbKeysRes.rows;
  // 3. Barajar (Fisher-Yates) para aleatoriedad
  function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()* (i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
  shuffle(envKeys); shuffle(dbKeys);
  const final = [];
  // Validar env keys primero
  for (const ek of envKeys) {
    if (final.length >= maxKeys) break;
    if (await validateEnvKey(ek)) final.push({ source:'env', value: ek.value, name: ek.name });
  }
  const NOW = Date.now();
  const STALE_MS = 24 * 60 * 60 * 1000; // revalidar cada 24h
  for (const row of dbKeys) {
    if (final.length >= maxKeys) break;
    const isStale = !row.last_checked_at || (NOW - new Date(row.last_checked_at).getTime()) > STALE_MS;
    let valid = row.last_valid;
    if (isStale) {
      valid = await pingKey(row.api_key);
      try { await pool.query('UPDATE api_keys SET last_checked_at=NOW(), last_valid=$2 WHERE id=$1', [row.id, valid]); } catch {}
    }
    if (valid) final.push({ source:'db', value: row.api_key, id: row.id });
  }
  return final.slice(0, maxKeys);
}

async function getUserPrimaryKey(userId){
  const r = await pool.query('SELECT api_key, last_checked_at, last_valid, id FROM api_keys WHERE user_id=$1 ORDER BY id DESC LIMIT 1', [userId]);
  if (!r.rowCount) return null;
  const row = r.rows[0];
  let valid = row.last_valid;
  // Revalidar clave primaria cada 24h por defecto
  const isStale = !row.last_checked_at || (Date.now() - new Date(row.last_checked_at).getTime()) > (24*60*60*1000);
  if (!valid || isStale) {
    valid = await pingKey(row.api_key);
    try { await pool.query('UPDATE api_keys SET last_checked_at=NOW(), last_valid=$2 WHERE id=$1', [row.id, valid]); } catch {}
  }
  return valid ? row.api_key : null;
}

// Round-robin sencillo para solving
function makeRotator(list){ let i=0; return ()=> list[(i++) % list.length]; }

// ---------- Endpoints AI ----------
app.post('/api/ai/extract', auth, async (req, res) => {
  const uid = req.user.uid;
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'NO_TEXT' });
  try {
    const userKey = await getUserPrimaryKey(uid);
    if (!userKey) return res.status(400).json({ error: 'USER_KEY_INVALID' });
    const client = new GoogleGenAI({ apiKey: userKey });
    try {
      const resp = await client.models.generateContent({ model: 'gemini-2.5-pro', contents: text.slice(0, 30000) });
      const raw = resp?.text?.() || resp?.text || '';
      // Placeholder: devolver texto bruto (el front seguirá parseando / adaptaremos luego a schema real)
      return res.json({ ok: true, raw });
    } catch (e) {
      const status = e?.error?.status || e?.status || e?.code;
      if (status === 429 || status === 'RESOURCE_EXHAUSTED') return res.status(429).json({ error: 'RATE_LIMIT', message: 'Recurso temporalmente agotado. Espera un poco.' });
      throw e;
    }
  } catch (e) {
    console.error('[ai.extract] error', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

app.post('/api/ai/solve', auth, async (req, res) => {
  const { questions } = req.body || {};
  if (!Array.isArray(questions) || !questions.length) return res.status(400).json({ error: 'NO_QUESTIONS' });
  try {
    const poolKeys = await buildKeyPool(20);
    if (!poolKeys.length) return res.status(400).json({ error: 'NO_POOL_KEYS' });
    const rot = makeRotator(poolKeys.map(k=>k.value));
    // Simplificación: responder estructura dummy por ahora
    const answers = questions.map(q => ({ id: q.id, answer: 'A' }));
    return res.json({ ok: true, answers, poolSize: poolKeys.length });
  } catch (e) {
    console.error('[ai.solve] error', e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

// En entornos serverless (Vercel) no arrancamos un listener; exportamos la app
// Vercel expone las funciones bajo /api/*; tendremos un handler que delega en `app`.
ensureSchema().then(() => {
  if (!process.env.VERCEL) {
    app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
  } else {
    console.log('[server] running in Vercel serverless mode - not starting http listener');
  }
});

export default app;
