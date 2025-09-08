# TestResolver 🚀

Aplicación web inteligente para resolver exámenes de opción múltiple usando estrategias avanzadas y la API de Gemini.

Descripción breve
------------------
`TestResolver` ayuda a extraer preguntas de imágenes o texto y a agregar respuestas usando varios modelos y estrategias. Muestra resultados consolidados y métricas en un panel para comparar precisión entre estrategias y modelos.

Características principales
- Subida de imagen o pegado de texto para extraer preguntas.
- Ejecución contra múltiples modelos y estrategias (batching y concurrencia).
- Panel de resultados con métricas agregadas, curvas y comparativas de estrategias.

Estado actual
------------
- Funcionalidad principal de extracción y resolución está implementada.
 - Funcionalidad principal de extracción y resolución está implementada.

Requisitos
----------
- Node 18+ y npm (o yarn/pnpm).

Instalación rápida
------------------
1. Instala dependencias:

```powershell
npm install
```

2. Ejecutar en modo desarrollo:

```powershell
npm run dev
```

3. Construir para producción:

```powershell
npm run build
```

4. Vista previa del build:

```powershell
npm run preview
```

Scripts disponibles (desde `package.json`)
- `dev` — inicia Vite en modo desarrollo.
- `build` — genera los assets de producción.
- `preview` — sirve el build de producción para pruebas locales.

Configuración de API (Gemini / @google/genai)
-------------------------------------------
El proyecto usa `@google/genai` para llamadas al modelo. Proporciona las credenciales según la documentación de `@google/genai` o tu proveedor (por ejemplo, variables de entorno o fichero de credenciales). No se incluyen claves en el repositorio.

Despliegue en Vercel
--------------------
Ahora todas las rutas backend son funciones serverless puras (sin Express):

```
api/health.js
api/auth/register.js
api/auth/login.js
api/apikey/index.js (GET/POST)
api/ai/extract.js
api/ai/solve.js
```

Código común reutilizable en `api/_*.js`.

No existe ya un catch-all; Vercel asigna cada archivo a `/api/...` automáticamente.

Variables de entorno necesarias en el panel de Vercel (Production / Preview / Development):

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `DATABASE_URL` | Sí | Cadena completa de conexión Postgres (sslmode=require recomendado). |
| `JWT_SECRET` | Sí | Secreto aleatorio para firmar JWT. |
| `VITE_GEMINI_API_KEY` | Opcional | Clave Gemini primaria para pruebas. |
| `VITE_GEMINI_API_KEY2..n` | Opcional | Claves adicionales para el pool. |

Solución a 404 en `/api/auth/register`
--------------------------------------
Si en producción obtienes `404 Not Found` pero en local funciona:

1. Asegura que el deployment contiene la carpeta `api/` y el archivo `[...all].js`.
2. Comprueba logs de la función: deberías ver `[api catch-all] incoming POST /api/auth/register`.
3. Si no aparece, revisa `vercel.json` y limpia cache de build (Redeploy > Clear cache).
4. Verifica que no tienes un rewrite que consuma `/api/(.*)` antes del catch‑all.
5. Llama a `/api/health` para confirmar que la función responde (y para ver estado de la base de datos: `{ ok:true, db:true/false }`).

Notas sobre base de datos
-------------------------
`ensureSchema()` crea tablas idempotentemente en arranques fríos. Si la BD no está accesible, verás warnings y las rutas que la usan fallarán con `SERVER_ERROR`, pero otras rutas pueden seguir respondiendo.

Licencia
--------
Revisa `LICENSE` en el repositorio.

Contacto
-------
Si necesitas que adapte el README (más visual, más técnico, o en otro tono), dime qué prefieres y lo actualizo.
