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

Licencia
--------
Revisa `LICENSE` en el repositorio.

Contacto
-------
Si necesitas que adapte el README (más visual, más técnico, o en otro tono), dime qué prefieres y lo actualizo.
