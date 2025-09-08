import app from '../server/index.js';

// Adaptador simple para Vercel: exporta una función que maneje la request.
export default async function handler(req, res) {
  // Express espera objetos req/res similares a Node. Reutilizamos el app.
  // `app` es un Express app; delegamos completamente en él.
  return app(req, res);
}
