import app from '../../../server/index.js';

// /api/auth/register (POST)
export default function handler(req, res){
  if(!req.url.startsWith('/api/auth/register')){
    req.url = '/api/auth/register';
  }
  return app(req,res);
}
