import app from '../../../server/index.js';

// /api/ai/extract (POST)
export default function handler(req, res){
  if(!req.url.startsWith('/api/ai/extract')){
    req.url = '/api/ai/extract';
  }
  return app(req,res);
}
