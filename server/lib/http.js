export async function readJson(req){ const chunks=[]; for await (const c of req) chunks.push(c); if(!chunks.length) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; } }
export function send(res,status,data,headers={}){ const body=JSON.stringify(data); res.statusCode=status; res.setHeader('Content-Type','application/json'); for(const k of Object.keys(headers)) res.setHeader(k,headers[k]); res.end(body); }
export function methodNotAllowed(res,allow){ res.setHeader('Allow',allow); send(res,405,{ error:'METHOD_NOT_ALLOWED' }); }
export function unauthorized(res){ send(res,401,{ error:'UNAUTHENTICATED' }); }
