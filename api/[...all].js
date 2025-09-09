import app from '../server/index.js';

// Catch-all para cualquier ruta /api/* y delegar en Express.
export default function handler(req, res) {
  try {
    const originalUrl = req.url;
    // En Vercel para un archivo api/[...all].js la url que recibe suele incluir
    // SOLO la parte capturada (ej: '/tests/4') y NO el prefijo '/api'.
    // Nuestras rutas en Express están definidas con prefijo '/api/...'.
    // Normalizamos añadiendo el prefijo si falta.
    if (!originalUrl.startsWith('/api/')) {
      req.url = '/api' + (originalUrl.startsWith('/') ? originalUrl : '/' + originalUrl);
    }
    console.log('[api catch-all] method=%s url=%s (original=%s)', req.method, req.url, originalUrl);
  } catch {}
  res.setHeader('x-api-catchall', '1');
  return app(req, res);
}
