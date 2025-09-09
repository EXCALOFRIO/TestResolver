import { pool, ensureSchema } from './_db.js';
import { send } from './_http.js';

export default async function handler(_req, res){
  await ensureSchema();
  if (!pool){
    return send(res, 200, { ok:true, db:false, reason:'NO_DATABASE_URL' });
  }
  try {
    await pool.query('SELECT 1');
    return send(res, 200, { ok:true, db:true });
  } catch {
    return send(res, 200, { ok:true, db:false });
  }
}
