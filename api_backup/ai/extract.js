import { ensureSchema } from '../_db.js';
import { parseAuth } from '../_auth.js';
import { getUserPrimaryKey } from '../_ai.js';
import { readJson, send, unauthorized, methodNotAllowed } from '../_http.js';
import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res){
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  await ensureSchema();
  const auth = parseAuth(req);
  if (!auth) return unauthorized(res);
  const { text } = await readJson(req);
  if (!text || !text.trim()) return send(res, 400, { error:'NO_TEXT' });
  try {
    const userKey = await getUserPrimaryKey(auth.uid);
    if (!userKey) return send(res, 400, { error:'USER_KEY_INVALID' });
    const client = new GoogleGenAI({ apiKey: userKey });
    try {
      const resp = await client.models.generateContent({ model: 'gemini-2.5-pro', contents: text.slice(0,30000) });
      const raw = resp?.text?.() || resp?.text || '';
      return send(res, 200, { ok:true, raw });
    } catch (e){
      const status = e?.error?.status || e?.status || e?.code;
      if (status === 429 || status === 'RESOURCE_EXHAUSTED') return send(res, 429, { error:'RATE_LIMIT', message:'Recurso temporalmente agotado' });
      throw e;
    }
  } catch (e){
    console.error('[ai.extract] error', e); return send(res, 500, { error:'SERVER_ERROR' });
  }
}
