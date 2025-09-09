import app from '../../../server/index.js';

// /api/tests/:id  (+ PATCH/DELETE) y /api/tests/:id/share (POST)
export default function handler(req, res){
  const original = req.url;
  // Casos esperados que Vercel puede pasar: '/7', '/7/share'
  if(/^\/\d+(?:\/share)?$/.test(original)){
    req.url = '/api/tests' + original; // '/api/tests/7' o '/api/tests/7/share'
  } else if(!original.startsWith('/api/tests/')) {
    // Si llega algo distinto, normalizamos intentando preservar el resto
    req.url = '/api/tests' + (original.startsWith('/')? original : '/' + original);
  }
  return app(req,res);
}
