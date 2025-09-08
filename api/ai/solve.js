import { ensureSchema } from '../_db.js';
import { parseAuth } from '../_auth.js';
import { buildKeyPool, makeRotator } from '../_ai.js';
import { readJson, send, unauthorized, methodNotAllowed } from '../_http.js';

export default async function handler(req, res){
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  await ensureSchema();
  const auth = parseAuth(req);
  if (!auth) return unauthorized(res);
  const { questions } = await readJson(req);
  if (!Array.isArray(questions) || !questions.length) return send(res, 400, { error:'NO_QUESTIONS' });
  try {
    const poolKeys = await buildKeyPool(20);
    if (!poolKeys.length) return send(res, 400, { error:'NO_POOL_KEYS' });
    const rot = makeRotator(poolKeys.map(k=>k.value));
    // Placeholder answers
    const answers = questions.map(q => ({ id: q.id, answer: 'A' }));
    return send(res, 200, { ok:true, answers, poolSize: poolKeys.length });
  } catch (e){
    console.error('[ai.solve] error', e); return send(res, 500, { error:'SERVER_ERROR' });
  }
}
