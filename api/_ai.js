import { GoogleGenAI } from '@google/genai';
import { pool } from './_db.js';

const ENV_KEY_REGEX = /^(VITE_)?GEMINI_API_KEY\d*$/;
const envKeyCache = new Map(); // keyValue -> { last:number, valid:boolean }
const ENV_CACHE_MS = 24 * 60 * 60 * 1000;

function getEnvKeys(){
  return Object.keys(process.env)
    .filter(k => ENV_KEY_REGEX.test(k))
    .map(k => ({ name:k, value: process.env[k] }))
    .filter(o=>!!o.value);
}

async function pingKey(apiKey){
  try {
    const client = new GoogleGenAI({ apiKey });
    const r = await client.models.generateContent({ model: 'models/gemma-3n-e2b-it', contents: 'ping' });
    return !!r;
  } catch { return false; }
}

async function validateEnvKey(entry){
  const now = Date.now();
  const c = envKeyCache.get(entry.value);
  if (c && (now - c.last) < ENV_CACHE_MS) return c.valid;
  const ok = await pingKey(entry.value);
  envKeyCache.set(entry.value, { last: now, valid: ok });
  return ok;
}

export async function buildKeyPool(maxKeys=20){
  const envKeys = getEnvKeys();
  const dbKeysRes = await pool.query('SELECT id, api_key, share_pool, last_checked_at, last_valid FROM api_keys WHERE share_pool = true');
  const dbKeys = dbKeysRes.rows;
  function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
  shuffle(envKeys); shuffle(dbKeys);
  const final=[];
  for (const ek of envKeys){
    if (final.length >= maxKeys) break;
    if (await validateEnvKey(ek)) final.push({ source:'env', value: ek.value, name: ek.name });
  }
  const NOW = Date.now();
  const STALE_MS = 24*60*60*1000;
  for (const row of dbKeys){
    if (final.length >= maxKeys) break;
    const isStale = !row.last_checked_at || (NOW - new Date(row.last_checked_at).getTime()) > STALE_MS;
    let valid = row.last_valid;
    if (isStale){
      valid = await pingKey(row.api_key);
      try { await pool.query('UPDATE api_keys SET last_checked_at=NOW(), last_valid=$2 WHERE id=$1',[row.id, valid]); } catch {}
    }
    if (valid) final.push({ source:'db', value: row.api_key, id: row.id });
  }
  return final.slice(0,maxKeys);
}

export async function getUserPrimaryKey(userId){
  const r = await pool.query('SELECT api_key, last_checked_at, last_valid, id FROM api_keys WHERE user_id=$1 ORDER BY id DESC LIMIT 1',[userId]);
  if (!r.rowCount) return null;
  const row = r.rows[0];
  let valid = row.last_valid;
  const isStale = !row.last_checked_at || (Date.now() - new Date(row.last_checked_at).getTime()) > 24*60*60*1000;
  if (!valid || isStale){
    valid = await pingKey(row.api_key);
    try { await pool.query('UPDATE api_keys SET last_checked_at=NOW(), last_valid=$2 WHERE id=$1',[row.id, valid]); } catch {}
  }
  if (!valid) {
    console.warn('[ai] primary key invalid or stale for user', userId);
  }
  return valid ? row.api_key : null;
}

export function makeRotator(list){ let i=0; return ()=> list[(i++) % list.length]; }
