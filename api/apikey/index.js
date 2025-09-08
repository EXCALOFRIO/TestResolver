import { ensureSchema, pool } from '../_db.js';
import { parseAuth } from '../_auth.js';
import { readJson, send, methodNotAllowed, unauthorized } from '../_http.js';

export default async function handler(req, res){
  await ensureSchema();
  const user = parseAuth(req);
  if (!user) return unauthorized(res);
  const uid = user.uid;
  if (req.method === 'GET'){
    try {
      const r = await pool.query('SELECT api_key FROM api_keys WHERE user_id=$1 ORDER BY id DESC',[uid]);
      return send(res, 200, { keys: r.rows.map(r=>r.api_key) });
    } catch (e){ console.error('[apikey:list]', e); return send(res, 500, { error:'SERVER_ERROR' }); }
  }
  if (req.method === 'POST'){
    const { apiKey } = await readJson(req);
    if (!apiKey) return send(res, 400, { error:'MISSING_API_KEY' });
    try {
      const exists = await pool.query('SELECT 1 FROM api_keys WHERE api_key=$1 LIMIT 1',[apiKey]);
      if (exists.rowCount) return send(res, 409, { error:'KEY_ALREADY_EXISTS' });
      await pool.query('INSERT INTO api_keys (user_id, api_key, share_pool) VALUES ($1,$2,true)', [uid, apiKey]);
      return send(res, 201, { ok:true });
    } catch (e){ console.error('[apikey:add]', e); return send(res, 500, { error:'SERVER_ERROR' }); }
  }
  return methodNotAllowed(res, 'GET, POST');
}
