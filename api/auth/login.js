import app, { schemaReady } from '../../../server/index.js';

// /api/auth/login (POST)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/auth/login')){
    req.url = '/api/auth/login';
  }
  return app(req,res);
}
