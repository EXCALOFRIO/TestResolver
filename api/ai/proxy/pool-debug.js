import app from '../../../../server/index.js';

// /api/ai/proxy/pool-debug (GET)
export default function handler(req, res){
  if(!req.url.startsWith('/api/ai/proxy/pool-debug')){
    req.url = '/api/ai/proxy/pool-debug';
  }
  return app(req,res);
}
