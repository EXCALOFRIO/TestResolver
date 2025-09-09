import app, { schemaReady } from '../../../../server/index.js';

// /api/ai/proxy/generate (POST)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/ai/proxy/generate')){
    req.url = '/api/ai/proxy/generate';
  }
  return app(req,res);
}
