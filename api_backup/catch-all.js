import app, { schemaReady } from '../server/index.js';

// Backup of api/[...all].js
export default async function handler(req, res) {
  try {
    await schemaReady;
    const originalUrl = req.url;
    if (!originalUrl.startsWith('/api/')) {
      req.url = '/api' + (originalUrl.startsWith('/') ? originalUrl : '/' + originalUrl);
    }
  } catch (e){ console.error('[api catch-all backup]', e); }
  return app(req, res);
}
