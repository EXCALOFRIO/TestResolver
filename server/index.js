import dotenv from 'dotenv';
const loaded = dotenv.config({ path: '.env.local' });
if (loaded.error) dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { GoogleGenAI } from '@google/genai';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 8787;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) console.warn('[server] DATABASE_URL no definido');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

// Healthcheck
app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); return res.json({ ok:true, db:true }); } catch { return res.json({ ok:true, db:false }); }
});

async function ensureSchema(){
  let client; try { client = await pool.connect(); } catch (e){ console.error('[db] conexión falló', e?.message); return; }
  try {
    // Usar IF NOT EXISTS para que sea idempotente sin romper la transacción.
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
    // Reforzar columnas opcionales (por si la tabla venía de una versión vieja)
    await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS share_pool BOOLEAN DEFAULT true');
    await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP NULL');
    await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_valid BOOLEAN NULL');

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
    await client.query('ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE');
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_test_runs_share_token ON test_runs(share_token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_test_runs_user_created ON test_runs(user_id, created_at DESC)');
    await client.query('COMMIT');
  } catch (e){
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[schema]', e);
  } finally { client.release(); }
}

// ---------- Utilidades de nombrado inteligente de tests ----------
function buildQuestionsTextForNaming(questions){
  try {
    return questions.map((q,i)=>`Q${i+1}: ${(q.pregunta||'').replace(/\s+/g,' ').slice(0,240)}`).join('\n').slice(0,12000);
  } catch { return ''; }
}
function sanitizeName(raw){
  let t = (raw||'').replace(/\n+/g,' ').trim();
  t = t.replace(/^["'«»`]+|["'«»`]+$/g,'');
  // Eliminar caracteres no deseados
  t = t.replace(/[^\p{L}0-9\-\s]/gu,' ').replace(/\s+/g,' ').trim();
  if(!t) return '';
  // Limitar a 5 palabras y 60 chars
  const words = t.split(/\s+/).slice(0,5);
  return words.join(' ').slice(0,60).trim();
}
function heuristicName(questions){
  try {
    const text = questions.map(q=>q.pregunta||'').join(' ').toLowerCase();
    const tokens = text.split(/[^a-zA-Záéíóúüñ0-9]+/).filter(t=>t.length>3);
    const stop = new Set(['para','entre','sobre','donde','cuando','desde','hasta','esto','estas','este','esta','solo','cada','cual','cuales','haber','dicho','mismo','segun','esta','estan','entre','pero','porque','donde','cual']);
    const freq = {};
    for(const tk of tokens){ if(stop.has(tk)) continue; freq[tk]=(freq[tk]||0)+1; }
    const top = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([w])=>w.charAt(0).toUpperCase()+w.slice(1));
    if(!top.length) return 'Test';
    return 'Test ' + top.join(' ');
  } catch { return 'Test'; }
}
async function aiGenerateName(questions, userKey){
  const modelsTry = [ 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash' ];
  const qt = buildQuestionsTextForNaming(questions);
  const basePrompt = `Analiza las preguntas de un test técnico y genera un NOMBRE CORTO Y CONCRETO. Requisitos estrictos:\n- Formato: Test <TemaPrincipal> <SubtemaOpcional>\n- Máx 5 palabras, sin signos, sin comillas, sin hashtags.\n- Incluir tecnología, campo, materia o lenguaje si es evidente.\n- Evita palabras genéricas (Evaluación, Examen, Preguntas, Múltiple, Selección, Practica).\n- Capitaliza cada palabra relevante.\n- Si es de medicina utiliza término clínico clave.\n- Si es de programación indica lenguaje (Java, Python, SQL, Redes, Algoritmos, etc).\n- SOLO devuelve el nombre final.\n\nPreguntas:\n${qt}`;
  for(const model of modelsTry){
    try {
      if(!userKey) break;
      const client = new GoogleGenAI({ apiKey: userKey });
      const r = await client.models.generateContent({ model, contents: basePrompt });
      const raw = r?.text?.() || r?.text || '';
      const sanitized = sanitizeName(raw);
      if(sanitized && sanitized.toLowerCase() !== 'test') return { name: sanitized, modelUsed: model };
    } catch (e){ /* intentar siguiente modelo */ }
  }
  return { name: '', modelUsed: null };
}

function signToken(user){ return jwt.sign({ uid:user.id, email:user.email }, JWT_SECRET, { expiresIn:'7d' }); }
function auth(req,res,next){
  const hdr = req.headers.authorization || ''; const token = (hdr.startsWith('Bearer ')?hdr.slice(7):null) || req.cookies['token'];
  if (!token) return res.status(401).json({ error:'UNAUTHENTICATED' });
  try { req.user = jwt.verify(token, JWT_SECRET); return next(); } catch { return res.status(401).json({ error:'INVALID_TOKEN' }); }
}

// Auth
app.post('/api/auth/register', async (req,res)=>{
  const { email, password } = req.body || {}; if(!email||!password) return res.status(400).json({ error:'MISSING_FIELDS' });
  const hash = await bcrypt.hash(password,10);
  try { const r = await pool.query('INSERT INTO users (email,password_hash) VALUES ($1,$2) RETURNING id,email',[email,hash]); const user=r.rows[0]; const token=signToken(user); res.cookie('token',token,{httpOnly:false,sameSite:'lax'}); return res.json({ token, user }); } catch(e){ if(e.code==='23505') return res.status(409).json({ error:'EMAIL_EXISTS' }); console.error('[register]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
app.post('/api/auth/login', async (req,res)=>{
  const { email,password } = req.body||{}; if(!email||!password) return res.status(400).json({ error:'MISSING_FIELDS' });
  try { const r=await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1',[email]); const u=r.rows[0]; if(!u) return res.status(401).json({ error:'INVALID_CREDENTIALS' }); const ok=await bcrypt.compare(password,u.password_hash); if(!ok) return res.status(401).json({ error:'INVALID_CREDENTIALS' }); const token=signToken(u); res.cookie('token',token,{httpOnly:false,sameSite:'lax'}); return res.json({ token, user:{ id:u.id,email:u.email } }); } catch(e){ console.error('[login]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});

// API Keys
app.get('/api/apikey', auth, async (req,res)=>{
  try {
    const r = await pool.query('SELECT id, api_key FROM api_keys WHERE user_id=$1 ORDER BY id DESC',[req.user.uid]);
    return res.json({ keys: r.rows.map(x => ({ id: x.id, api_key: x.api_key })) });
  } catch(e){ console.error('[apikey:list]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
// Nuevo: obtener TODAS las claves compartidas (share_pool=true) para rotación colaborativa en el cliente
app.post('/api/apikey', auth, async (req,res)=>{
  const { apiKey } = req.body||{}; if(!apiKey) return res.status(400).json({ error:'MISSING_API_KEY' });
  try { const exists=await pool.query('SELECT 1 FROM api_keys WHERE api_key=$1 LIMIT 1',[apiKey]); if(exists.rowCount) return res.status(409).json({ error:'KEY_ALREADY_EXISTS' }); await pool.query('INSERT INTO api_keys (user_id,api_key,share_pool) VALUES ($1,$2,true)',[req.user.uid, apiKey]); return res.status(201).json({ ok:true }); } catch(e){ console.error('[apikey]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});

// Key pool helpers
const ENV_KEY_REGEX = /^(VITE_)?GEMINI_API_KEY\d*$/;
function getEnvKeys(){ return Object.keys(process.env).filter(k=>ENV_KEY_REGEX.test(k)).map(k=>({name:k,value:process.env[k]})).filter(o=>!!o.value); }
async function pingKey(apiKey){ try { const client=new GoogleGenAI({ apiKey }); await client.models.generateContent({ model:'models/gemma-3n-e2b-it', contents:'ping' }); return true; } catch { return false; } }
const envKeyCache = new Map();
const ENV_CACHE_MS = 24*60*60*1000;
async function validateEnvKey(entry){ const now=Date.now(); const c=envKeyCache.get(entry.value); if(c && (now-c.last)<ENV_CACHE_MS) return c.valid; const ok=await pingKey(entry.value); envKeyCache.set(entry.value,{ last:now, valid:ok }); return ok; }
async function buildKeyPool(maxKeys=60){
  const envKeys = getEnvKeys();
  const dbKeysRes = await pool.query('SELECT id,api_key,share_pool,last_checked_at,last_valid FROM api_keys WHERE share_pool=true');
  const dbKeys = dbKeysRes.rows;
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
  shuffle(envKeys); shuffle(dbKeys);
  const final = [];
  let envAdded = 0, dbAdded = 0;
  for (const ek of envKeys){ if(final.length>=maxKeys) break; if(await validateEnvKey(ek)){ final.push({ source:'env', value: ek.value, name: ek.name }); envAdded++; } }
  const NOW=Date.now(); const STALE=24*60*60*1000;
  for (const row of dbKeys){ if(final.length>=maxKeys) break; const stale=!row.last_checked_at || (NOW - new Date(row.last_checked_at).getTime())>STALE; let valid=row.last_valid; if(stale){ valid=await pingKey(row.api_key); try { await pool.query('UPDATE api_keys SET last_checked_at=NOW(), last_valid=$2 WHERE id=$1',[row.id,valid]); } catch{} }
    if(valid){ final.push({ source:'db', value: row.api_key, dbId: row.id }); dbAdded++; } }
  const poolLog = process.env.POOL_LOG || process.env.POOL_LOGGING;
  if (poolLog){
    const tails = final.map((k,i)=> `${i}:${k.source==='env'? (k.name||'ENV') : 'DB#'+k.dbId}::..${k.value.slice(-6)}`);
    console.log(`[keyPool] built size=${final.length} env=${envAdded} db=${dbAdded} -> ${tails.join(' | ')}`);
  }
  return final.slice(0,maxKeys);
}
async function getUserPrimaryKey(userId){ const r=await pool.query('SELECT api_key,last_checked_at,last_valid,id FROM api_keys WHERE user_id=$1 ORDER BY id DESC LIMIT 1',[userId]); if(!r.rowCount) return null; const row=r.rows[0]; let valid=row.last_valid; const stale=!row.last_checked_at || (Date.now()-new Date(row.last_checked_at).getTime())>24*60*60*1000; if(!valid||stale){ valid=await pingKey(row.api_key); try{ await pool.query('UPDATE api_keys SET last_checked_at=NOW(), last_valid=$2 WHERE id=$1',[row.id,valid]); } catch{} } return valid?row.api_key:null; }
function makeRotator(list){ let i=0; return ()=> list[(i++)%list.length]; }

// AI extract (placeholder)
app.post('/api/ai/extract', auth, async (req,res)=>{
  const { text } = req.body||{}; if(!text||!text.trim()) return res.status(400).json({ error:'NO_TEXT' });
  try { const key=await getUserPrimaryKey(req.user.uid); if(!key) return res.status(400).json({ error:'USER_KEY_INVALID' }); const client=new GoogleGenAI({ apiKey:key }); const resp=await client.models.generateContent({ model:'gemini-2.5-pro', contents:text.slice(0,30000) }); const raw=resp?.text?.()||resp?.text||''; return res.json({ ok:true, raw }); } catch(e){ console.error('[ai.extract]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});

// AI solve (simplificado)
app.post('/api/ai/solve', auth, async (req,res)=>{
  const { questions } = req.body||{}; if(!Array.isArray(questions)||!questions.length) return res.status(400).json({ error:'NO_QUESTIONS' });
  try { const poolKeys=await buildKeyPool(20); if(!poolKeys.length) return res.status(400).json({ error:'NO_POOL_KEYS' }); const rot=makeRotator(poolKeys.map(k=>k.value)); const answers=questions.map(q=>({ id:q.id, answer:'A' })); return res.json({ ok:true, answers, poolSize:poolKeys.length }); } catch(e){ console.error('[ai.solve]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});

// ---- Proxy seguro para generateContent ----
// Permite usar TODA la pool (env + db share_pool) sin exponer claves al frontend.
// Body: { model, prompt?, contents?, config? }
// Nota: contents tiene prioridad sobre prompt; se reintenta rotando claves ante 429.
app.post('/api/ai/proxy/generate', auth, async (req,res)=>{
  const { model, prompt, contents, config } = req.body || {};
  if(!model || (!prompt && !contents)) return res.status(400).json({ error:'INVALID_PAYLOAD' });
  try {
    const poolEntries = await buildKeyPool(60);
    if(!poolEntries.length) return res.status(400).json({ error:'NO_POOL_KEYS' });
    const rotate = makeRotator(poolEntries);
    let lastErr = null;
    const maxAttempts = Math.min(poolEntries.length * 2, 120);
    const startedAt = Date.now();
    console.log(`[proxy.generate] uid=${req.user?.uid} model=${model} poolSize=${poolEntries.length} attemptsAllowed=${maxAttempts}`);
    for(let attempt=1; attempt<=maxAttempts; attempt++){
      const entry = rotate();
      const key = entry.value;
      try {
        const client = new GoogleGenAI({ apiKey: key });
        const payload = contents ? { model, contents, config } : { model, contents: prompt, config };
        const resp = await client.models.generateContent(payload);
        const text = typeof resp.text === 'function' ? resp.text() : resp.text;
        const ms = Date.now() - startedAt;
        const tail = key.slice(-6);
        const origin = entry.source === 'env' ? (entry.name || 'ENV') : `DB#${entry.dbId}`;
        console.log(`[proxy.generate][SUCCESS] uid=${req.user?.uid} model=${model} attempt=${attempt} origin=${origin} tail=...${tail} ms=${ms}`);
        return res.json({ ok:true, text, model, attempts: attempt, poolSize: poolEntries.length, ms, origin });
      } catch(e){
        const status = e?.error?.status || e?.status || e?.code;
        const isRate = status === 429 || status === 'RESOURCE_EXHAUSTED';
        const tail = key.slice(-6);
        const origin = entry.source === 'env' ? (entry.name || 'ENV') : `DB#${entry.dbId}`;
        if(isRate){ console.log(`[proxy.generate][RATE_LIMIT] uid=${req.user?.uid} model=${model} attempt=${attempt} origin=${origin} tail=...${tail}`); }
        if(!isRate){ lastErr = e; console.warn(`[proxy.generate][FATAL] uid=${req.user?.uid} attempt=${attempt} origin=${origin} tail=...${tail} err=${status||e?.message}`); break; }
        // continuar probando siguiente clave
      }
    }
    console.error('[proxy.generate] Fallo tras reintentos', lastErr);
    return res.status(502).json({ error:'UPSTREAM_FAILED' });
  } catch(e){
    console.error('[proxy.generate] error', e);
    return res.status(500).json({ error:'SERVER_ERROR' });
  }
});

// Debug seguro del pool (no expone claves completas) sólo para usuarios autenticados
app.get('/api/ai/proxy/pool-debug', auth, async (req,res)=>{
  try {
    const poolEntries = await buildKeyPool(60);
    const summary = poolEntries.map((e,i)=> ({ idx:i, source:e.source, id: e.dbId || null, tail: e.value.slice(-6) }));
    return res.json({ ok:true, size: poolEntries.length, entries: summary });
  } catch(e){ console.error('[proxy.pool-debug]', e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});

// ---------- Historial de tests ----------
app.post('/api/tests', auth, async (req,res)=>{
  const { name, questions, results } = req.body || {}; if(!Array.isArray(questions)||!questions.length|| typeof results !== 'object') return res.status(400).json({ error:'INVALID_PAYLOAD' });
  let safeQ, safeR; try { safeQ=JSON.parse(JSON.stringify(questions)); } catch { safeQ=questions; } try { safeR=JSON.parse(JSON.stringify(results)); } catch { safeR=results; }
  let finalName=(name||'').trim().slice(0,60); let auto=false;
  try { if(!finalName){
    const keyRow=await pool.query('SELECT api_key FROM api_keys WHERE user_id=$1 ORDER BY id DESC LIMIT 1',[req.user.uid]);
    const userKey=keyRow.rows[0]?.api_key || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    let generated = { name: '', modelUsed: null };
    if(userKey){ generated = await aiGenerateName(safeQ, userKey); }
    if(!generated.name){
      // Fallback heurístico local
      generated.name = heuristicName(safeQ);
    }
    finalName = generated.name || 'Test';
    auto = true;
  }} catch { finalName='Test'; auto=true; }
  try { const total=safeQ.length; const ins=await pool.query('INSERT INTO test_runs (user_id,name,auto_name,questions,results,total_questions) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,auto_name,created_at,total_questions,questions,results,share_token',[req.user.uid, finalName, auto, JSON.stringify(safeQ), JSON.stringify(safeR), total]); return res.status(201).json({ ok:true, run:ins.rows[0] }); } catch(e){ console.error('[tests:create]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
app.get('/api/tests', auth, async (req,res)=>{
  const limit=Math.min(50, Math.max(1, parseInt(req.query.limit,10)||20)); const offset=Math.max(0, parseInt(req.query.offset,10)||0);
  try { const r=await pool.query('SELECT id,name,auto_name,total_questions,created_at,share_token FROM test_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',[req.user.uid, limit, offset]); return res.json({ ok:true, runs:r.rows }); } catch(e){ console.error('[tests:list]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
app.get('/api/tests/:id', auth, async (req,res)=>{
  const id=parseInt(req.params.id,10); if(!id) return res.status(400).json({ error:'INVALID_ID' });
  try { const r=await pool.query('SELECT id,name,auto_name,questions,results,total_questions,created_at,share_token FROM test_runs WHERE id=$1 AND user_id=$2',[id, req.user.uid]); if(!r.rowCount) return res.status(404).json({ error:'NOT_FOUND' }); return res.json({ ok:true, run:r.rows[0] }); } catch(e){ console.error('[tests:detail]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
app.patch('/api/tests/:id', auth, async (req,res)=>{
  const id=parseInt(req.params.id,10); const { name } = req.body||{}; if(!id||!name||!String(name).trim()) return res.status(400).json({ error:'INVALID_PAYLOAD' });
  try { const r=await pool.query('UPDATE test_runs SET name=$1, auto_name=false WHERE id=$2 AND user_id=$3 RETURNING id,name,auto_name,share_token',[String(name).trim().slice(0,60), id, req.user.uid]); if(!r.rowCount) return res.status(404).json({ error:'NOT_FOUND' }); return res.json({ ok:true, run:r.rows[0] }); } catch(e){ console.error('[tests:rename]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
app.post('/api/tests/:id/share', auth, async (req,res)=>{
  const id=parseInt(req.params.id,10); if(!id) return res.status(400).json({ error:'INVALID_ID' });
  try {
    const r=await pool.query('SELECT share_token FROM test_runs WHERE id=$1 AND user_id=$2',[id, req.user.uid]);
    if(!r.rowCount) return res.status(404).json({ error:'NOT_FOUND' });
    let token=r.rows[0].share_token;
    if(!token){
      token = crypto.randomBytes(18).toString('hex');
      try { await pool.query('UPDATE test_runs SET share_token=$1 WHERE id=$2',[token,id]); } catch {
        token = crypto.randomBytes(20).toString('hex');
        await pool.query('UPDATE test_runs SET share_token=$1 WHERE id=$2',[token,id]);
      }
    }
    // Determinar base pública preferentemente desde cabeceras (soporta Vercel / proxies / dev con distinto puerto front)
    // Prioridad: PUBLIC_BASE_URL > X-Client-Origin (enviado por front) > X-Forwarded-* > Referer > request host
    let base = process.env.PUBLIC_BASE_URL;
    if(!base){
      const clientOrigin = req.get('x-client-origin');
      if(clientOrigin){
        try { const u = new URL(clientOrigin); base = `${u.protocol}//${u.host}`; } catch {}
      }
    }
    if(!base){
      const xfProto = req.get('x-forwarded-proto');
      const xfHost = req.get('x-forwarded-host');
      if (xfProto && xfHost) base = `${xfProto}://${xfHost}`;
    }
    if(!base){
      // Intentar Referer para capturar puerto del front en dev (ej: 5173)
      const ref = req.get('referer');
      if(ref){
        try { const u = new URL(ref); base = `${u.protocol}//${u.host}`; } catch {}
      }
    }
    if(!base){
      base = `${req.protocol}://${req.get('host')}`;
    }
    return res.json({ ok:true, token, url: `${base.replace(/\/$/,'')}/t/${token}` });
  } catch(e){ console.error('[tests:share]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
app.delete('/api/tests/:id', auth, async (req,res)=>{
  const id=parseInt(req.params.id,10); if(!id) return res.status(400).json({ error:'INVALID_ID' });
  try { const r=await pool.query('DELETE FROM test_runs WHERE id=$1 AND user_id=$2 RETURNING id',[id, req.user.uid]); if(!r.rowCount) return res.status(404).json({ error:'NOT_FOUND' }); return res.json({ ok:true }); } catch(e){ console.error('[tests:delete]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});
// Página pública compartible del test.
// - Visita directa /t/:token -> redirección a la SPA con query ?t=token
// - Visita con ?format=json (o ?json=1) -> devuelve JSON con los datos del test
app.get('/t/:token', async (req,res)=>{
  const token = String(req.params.token||'').trim();
  if(!token) return res.status(400).json({ error:'INVALID_TOKEN' });
  const wantsJson = (req.query.format === 'json') || (req.query.json === '1');
  if(!wantsJson){
    return res.redirect(302, '/?t='+encodeURIComponent(token));
  }
  try {
    const r=await pool.query('SELECT name,questions,results,total_questions,created_at FROM test_runs WHERE share_token=$1 LIMIT 1',[token]);
    if(!r.rowCount) return res.status(404).json({ error:'NOT_FOUND' });
    return res.json({ ok:true, run: r.rows[0] });
  } catch(e){
    console.error('[tests:public:json]',e);
    return res.status(500).json({ error:'SERVER_ERROR' });
  }
});

// Nuevo endpoint JSON explícito para consumo del front React sin heurísticas de Accept.
app.get('/api/public/tests/:token', async (req,res)=>{
  const token=String(req.params.token||'').trim(); if(!token) return res.status(400).json({ error:'INVALID_TOKEN' });
  try {
    const r=await pool.query('SELECT name,questions,results,total_questions,created_at FROM test_runs WHERE share_token=$1 LIMIT 1',[token]);
    if(!r.rowCount) return res.status(404).json({ error:'NOT_FOUND' });
    return res.json({ ok:true, run:r.rows[0] });
  } catch(e){ console.error('[tests:public:api]',e); return res.status(500).json({ error:'SERVER_ERROR' }); }
});

// Debug: listar rutas registradas (solo en desarrollo)
if (!process.env.VERCEL) {
  app.get('/api/debug/routes', (req,res)=>{
    try {
      const routes = [];
      app._router.stack.forEach(l=>{ if(l.route && l.route.path){ const methods=Object.keys(l.route.methods).join(','); routes.push({ path:l.route.path, methods }); }});
      res.json({ ok:true, routes });
    } catch (e){ res.status(500).json({ error:'NO_ROUTES' }); }
  });
}

// Debug DB (antes era una función serverless separada). No requiere auth, solo estado.
app.get('/api/debug/db', async (_req, res) => {
  try {
    await ensureSchema();
    const users = await pool.query('SELECT COUNT(*)::int AS c FROM users');
    const keys = await pool.query('SELECT COUNT(*)::int AS c FROM api_keys');
    const sample = await pool.query('SELECT id, email, created_at FROM users ORDER BY id DESC LIMIT 3');
    const sampleKeys = await pool.query('SELECT id, user_id, LEFT(api_key,6)||"..." AS api_key, share_pool, last_valid FROM api_keys ORDER BY id DESC LIMIT 3');
    return res.json({ ok:true, db:true, users:users.rows[0].c, api_keys:keys.rows[0].c, sampleUsers: sample.rows, sampleKeys: sampleKeys.rows });
  } catch (e){
    console.error('[debug/db]', e);
    return res.status(500).json({ ok:false, error:'QUERY_FAIL', message:e?.message });
  }
});

ensureSchema().then(()=>{ if(!process.env.VERCEL){ app.listen(PORT, ()=> console.log(`[server] http://localhost:${PORT}`)); } else { console.log('[server] vercel mode'); } });

export default app;
