import app from '../../../server/index.js';

// /api/auth/login (POST)
export default function handler(req, res){
  if(!req.url.startsWith('/api/auth/login')){
    req.url = '/api/auth/login';
  }
  return app(req,res);
}
