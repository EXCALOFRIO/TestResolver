import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
  // Recoger todas las GEMINI_API_KEY (con o sin sufijo numérico)
  const geminiKeyValues = Object.keys(env)
    .filter(k => /^GEMINI_API_KEY\d*$/.test(k))
    .sort()
    .map(k => env[k])
    .filter(Boolean);
    // Construir objeto define con todas las GEMINI_API_KEY* mapeadas a process.env y también a variantes VITE_
    const define: Record<string,string> = {
      '__GEMINI_EMBED_KEYS__': JSON.stringify(geminiKeyValues)
    };
    // Legacy single
    if (env.GEMINI_API_KEY) {
      define['process.env.API_KEY'] = JSON.stringify(env.GEMINI_API_KEY);
      define['process.env.GEMINI_API_KEY'] = JSON.stringify(env.GEMINI_API_KEY);
      define['import.meta.env.VITE_GEMINI_API_KEY'] = JSON.stringify(env.GEMINI_API_KEY);
    }
    // Cada una numerada
    geminiKeyValues.forEach((val, idx) => {
      define[`process.env.GEMINI_API_KEY${idx}`] = JSON.stringify(val);
      define[`import.meta.env.VITE_GEMINI_API_KEY${idx}`] = JSON.stringify(val);
    });
    return {
      define,
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      server: {
        proxy: {
          '/api': {
            target: process.env.VITE_API_URL || 'http://localhost:8787',
            changeOrigin: true,
            secure: false,
            // reescribir por si en el futuro servimos bajo prefijo
            rewrite: (path) => path
          }
          ,
          // Proxy adicional para acceder a la página/JSON público del backend en dev
          '/t/': {
            target: process.env.VITE_API_URL || 'http://localhost:8787',
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path // no cambiar
          }
        }
      }
    };
});
