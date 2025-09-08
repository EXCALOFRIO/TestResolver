import app from '../server/index.js';

// Catch-all para cualquier ruta /api/* y delegar en Express.
export default function handler(req, res) {
  // Pequeño log para Vercel (aparecerá en logs de función) para depurar 404.
  try {
    console.log('[api catch-all] incoming', req.method, req.url, 'headers.host=', req.headers.host);
  } catch {}
  // Cabecera de trazabilidad opcional (no sensible)
  res.setHeader('x-api-catchall', '1');
  return app(req, res);
}
