import app, { schemaReady } from '../../../server/index.js';

// /api/auth/register (POST)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/auth/register')){
    req.url = '/api/auth/register';
  }
  return app(req,res);
}
