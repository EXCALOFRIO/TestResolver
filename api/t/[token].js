import app, { schemaReady } from '../../../server/index.js';

// /t/:token  (redirect o JSON dependiendo de query) -> Express ya lo maneja
export default async function handler(req, res){
  await schemaReady;
  const original = req.url; // '/abc123'
  if(/^\/[^\/]+$/.test(original)){
    req.url = '/t' + original; // '/t/abc123'
  } else if(!original.startsWith('/t/')){
    req.url = '/t' + (original.startsWith('/')? original : '/' + original);
  }
  return app(req,res);
}
