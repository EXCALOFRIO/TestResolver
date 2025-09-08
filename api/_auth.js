import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './_db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user){
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

export function parseAuth(req){
  const hdr = req.headers['authorization'] || req.headers['Authorization'];
  const cookie = req.headers['cookie'];
  let token = null;
  if (hdr && typeof hdr === 'string' && hdr.startsWith('Bearer ')) token = hdr.slice(7);
  if (!token && cookie) {
    const m = /(?:^|; )token=([^;]+)/.exec(cookie);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

export async function hashPassword(pwd){
  return bcrypt.hash(pwd, 10);
}

export async function verifyPassword(raw, hash){
  return bcrypt.compare(raw, hash);
}

export async function getUserByEmail(email){
  const r = await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1', [email]);
  return r.rows[0];
}
