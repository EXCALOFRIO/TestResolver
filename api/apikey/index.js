import app, { schemaReady } from '../../../server/index.js';

// /api/apikey (GET, POST)
export default async function handler(req, res){
  await schemaReady;
  if(!req.url.startsWith('/api/apikey')){
    req.url = '/api/apikey';
  }
  return app(req,res);
}
