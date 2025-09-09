import app from '../../../server/index.js';

// /api/ai/solve (POST)
export default function handler(req, res){
  if(!req.url.startsWith('/api/ai/solve')){
    req.url = '/api/ai/solve';
  }
  return app(req,res);
}
