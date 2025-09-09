import app, { schemaReady } from '../../../server/index.js';

// /api/ai/extract (POST)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/ai/extract')){
    req.url = '/api/ai/extract';
  }
  return app(req,res);
}
