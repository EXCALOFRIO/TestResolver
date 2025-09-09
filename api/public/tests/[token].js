import app from '../../../../server/index.js';

// /api/public/tests/:token  (GET)
export default function handler(req, res){
  const original = req.url;
  if(/^\/[^\/]+$/.test(original)){ // '/abc123'
    req.url = '/api/public/tests' + original;
  } else if(!original.startsWith('/api/public/tests/')){
    req.url = '/api/public/tests' + (original.startsWith('/')? original : '/' + original);
  }
  return app(req,res);
}
