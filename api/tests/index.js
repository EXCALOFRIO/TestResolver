import app from '../../../server/index.js';

// /api/tests  (GET list, POST create)
export default function handler(req, res){
  if(!req.url.startsWith('/api/tests')){
    req.url = '/api/tests';
  } else if(req.url === '/api/tests/' ){ req.url = '/api/tests'; }
  return app(req,res);
}
import app from '../../server/index.js';

// Endpoint: /api/tests  (GET list, POST create)
export default function handler(req, res){
  // Normalizar la URL para que Express coincida (ya tiene /api/tests definido)
  if(!req.url.startsWith('/api/tests')){
    req.url = '/api/tests' + (req.url.startsWith('/')? req.url.slice(1) : req.url);
  }
  return app(req,res);
}
