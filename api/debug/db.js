import { pool, ensureSchema } from '../_db.js';
import { send } from '../_http.js';

export default async function handler(_req, res){
  await ensureSchema();
  if (!pool) return send(res, 200, { ok:true, db:false, reason:'NO_POOL' });
  try {
    const users = await pool.query('SELECT COUNT(*)::int AS c FROM users');
    const keys = await pool.query('SELECT COUNT(*)::int AS c FROM api_keys');
    const sample = await pool.query('SELECT id, email, created_at FROM users ORDER BY id DESC LIMIT 3');
    const sampleKeys = await pool.query('SELECT id, user_id, LEFT(api_key,6)||"..." AS api_key, share_pool, last_valid FROM api_keys ORDER BY id DESC LIMIT 3');
    return send(res, 200, { ok:true, db:true, users:users.rows[0].c, api_keys:keys.rows[0].c, sampleUsers: sample.rows, sampleKeys: sampleKeys.rows });
  } catch (e){
    console.error('[debug/db] error', e);
    return send(res, 500, { ok:false, error:'QUERY_FAIL', message:e?.message });
  }
}
