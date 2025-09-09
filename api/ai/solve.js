import app, { schemaReady } from '../../../server/index.js';

// /api/ai/solve (POST)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/ai/solve')){
    req.url = '/api/ai/solve';
  }
  return app(req,res);
}
