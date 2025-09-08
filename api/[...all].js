import app from '../server/index.js';

// Catch-all para cualquier ruta /api/* y delegar en Express.
export default function handler(req, res) {
  return app(req, res);
}
