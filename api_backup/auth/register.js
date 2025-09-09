import { pool, ensureSchema } from '../_db.js';
import { readJson, send, methodNotAllowed } from '../_http.js';
import { hashPassword, signToken } from '../_auth.js';

export default async function handler(req, res){
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  await ensureSchema();
  const { email, password } = await readJson(req);
  if (!email || !password) return send(res, 400, { error:'MISSING_FIELDS' });
  const hash = await hashPassword(password);
  try {
    const r = await pool.query('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id,email',[email, hash]);
    const user = r.rows[0];
    const token = signToken(user);
    res.setHeader('Set-Cookie', `token=${encodeURIComponent(token)}; Path=/; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);
    return send(res, 200, { token, user });
  } catch (e){
    if (e.code === '23505') return send(res, 409, { error:'EMAIL_EXISTS' });
    console.error('[register] error', e);
    return send(res, 500, { error:'SERVER_ERROR' });
  }
}
