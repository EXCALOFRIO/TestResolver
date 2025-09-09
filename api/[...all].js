import app, { schemaReady } from '../server/index.js';

// Catch-all para cualquier ruta /api/* y delegar en Express.
export default async function handler(req, res) {
  try {
    await schemaReady; // evitar condiciones de carrera en cold starts
    const originalUrl = req.url;
    
    // En Vercel para un archivo api/[...all].js la url que recibe suele incluir
    // SOLO la parte capturada (ej: '/tests/4') y NO el prefijo '/api'.
    // Nuestras rutas en Express están definidas con prefijo '/api/...'.
    // Normalizamos añadiendo el prefijo si falta.
    
    // Si la URL empieza con /t/ la dejamos como está porque es una ruta especial
    // que no necesita el prefijo /api/
    if (originalUrl.startsWith('/t/')) {
      req.url = originalUrl;
    } else if (!originalUrl.startsWith('/api/')) {
      req.url = '/api' + (originalUrl.startsWith('/') ? originalUrl : '/' + originalUrl);
    }
    
    console.log('[api catch-all] method=%s url=%s (original=%s)', req.method, req.url, originalUrl);
  } catch (e){ console.error('[api catch-all]', e); }
  res.setHeader('x-api-catchall', '1');
  return app(req, res);
}
