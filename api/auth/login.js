import { ensureSchema } from '../_db.js';
import { readJson, send, methodNotAllowed } from '../_http.js';
import { getUserByEmail, verifyPassword, signToken } from '../_auth.js';

export default async function handler(req, res){
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  await ensureSchema();
  const { email, password } = await readJson(req);
  if (!email || !password) return send(res, 400, { error:'MISSING_FIELDS' });
  try {
    const user = await getUserByEmail(email);
    if (!user) return send(res, 401, { error:'INVALID_CREDENTIALS' });
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return send(res, 401, { error:'INVALID_CREDENTIALS' });
    const token = signToken(user);
    res.setHeader('Set-Cookie', `token=${encodeURIComponent(token)}; Path=/; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`);
    return send(res, 200, { token, user: { id: user.id, email: user.email } });
  } catch (e){
    console.error('[login] error', e); return send(res, 500, { error:'SERVER_ERROR' });
  }
}
