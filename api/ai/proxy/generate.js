import app from '../../../../server/index.js';

// /api/ai/proxy/generate (POST)
export default function handler(req, res){
  if(!req.url.startsWith('/api/ai/proxy/generate')){
    req.url = '/api/ai/proxy/generate';
  }
  return app(req,res);
}
