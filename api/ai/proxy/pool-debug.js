import app, { schemaReady } from '../../../../server/index.js';

// /api/ai/proxy/pool-debug (GET)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/ai/proxy/pool-debug')){
    req.url = '/api/ai/proxy/pool-debug';
  }
  return app(req,res);
}
