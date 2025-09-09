import app from '../../server/index.js';

// Endpoint: /api/tests/:id  (GET, PATCH, DELETE, share subroute)
export default function handler(req, res){
  // Vercel pasa sólo la parte capturada, reconstruimos la ruta completa para Express.
  // Ej: req.url = '/4'  -> queremos '/api/tests/4'
  const original = req.url;
  if(/^\/\d+/.test(original)){
    req.url = '/api/tests' + original; // '/api/tests/4'
  } else if(!original.startsWith('/api/tests')) {
    req.url = '/api/tests' + (original.startsWith('/')? original : '/'+original);
  }
  return app(req,res);
}
