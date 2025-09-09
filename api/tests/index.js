import app, { schemaReady } from '../../../server/index.js';

// /api/tests  (GET list, POST create)
export default async function handler(req, res){
  await schemaReady;
  // Normalizar la URL para que Express coincida (ya tiene /api/tests definido)
  if(!req.url.startsWith('/api/tests')){
    req.url = '/api/tests' + (req.url.startsWith('/')? req.url.slice(1) : req.url);
  }
  return app(req,res);
}
