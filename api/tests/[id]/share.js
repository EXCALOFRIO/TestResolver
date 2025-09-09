import app from '../../../../server/index.js';

// Endpoint serverless dedicado para /api/tests/:id/share (POST)
// Vercel necesita un archivo explícito porque /api/tests/:id/share no lo cubre tests/[id].js.
export default function handler(req, res) {
  try {
    const original = req.url || '';
    // Normalizar para que Express encuentre la ruta /api/tests/:id/share
    if (!original.startsWith('/api/tests/')) {
      // Casos posibles que Vercel pueda entregar: '/7/share' o '/share'
      if (/^\/\d+\/share/.test(original)) {
        req.url = '/api/tests' + original; // '/api/tests/7/share'
      } else {
        // Fallback: asegurar prefijo '/api'
        req.url = '/api' + (original.startsWith('/') ? original : '/' + original);
      }
    }
    // Seguridad: sólo aceptar POST aquí (Express también valida, pero devolvemos 405 rápido si no)
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      return res.end('Method Not Allowed');
    }
  } catch (e) {
    console.warn('[tests:share:shim] normalización falló', e?.message);
  }
  return app(req, res);
}
