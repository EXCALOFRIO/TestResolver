import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";
import { Question, StrategyKey, ModelConfig } from '../types';
import { MODEL_CONFIGS } from '../modelConfigs';
// Eliminado el parser local para forzar siempre extracción vía Gemini structured output.

// Provide a minimal declaration for process.env when running in a Vite/browser context.
// Vite inlines import.meta.env.*; adapt by mapping expected keys.
// We'll read from import.meta.env if process is unavailable at runtime.
// This keeps TypeScript happy without pulling full @types/node.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

// Helper to safely get env values (works both in node y build-time Vite)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getEnv = (k: string): string | undefined => (typeof process !== 'undefined' && process?.env?.[k]) || (import.meta as any)?.env?.[k];

// ---- Logging helper (niveles: error=0, warn=1, info=2, debug=3) ----
type LogLevel = 'error' | 'warn' | 'info' | 'debug';
const levelRank: Record<LogLevel, number> = { error:0, warn:1, info:2, debug:3 };
const configuredLevel = (() => {
    const raw = (getEnv('VITE_GEMINI_LOG_LEVEL') || getEnv('GEMINI_LOG_LEVEL') || 'info').toLowerCase();
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw as LogLevel;
    return 'info';
})();
const gLog = (lvl: LogLevel, msg: string, ...rest: unknown[]) => {
    if (levelRank[lvl] <= levelRank[configuredLevel]) {
        const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
        fn(msg, ...rest);
    }
};

// -------- API Key Rotation Logic (tracking nombre de variable) --------
const allEnvKeys: string[] = typeof process !== 'undefined' && process?.env ? Object.keys(process.env) : Object.keys((import.meta as any)?.env || {});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __GEMINI_EMBED_KEYS__: any;
interface KeyMeta { name: string; value: string; }
let geminiKeyMeta: KeyMeta[] = allEnvKeys
    .filter(k => /^(VITE_)?GEMINI_API_KEY\d*$/.test(k))
    .sort((a,b) => {
        const re = /^(?:VITE_)?GEMINI_API_KEY(\d*)$/;
        const ma = a.match(re); const mb = b.match(re);
        const na = ma && ma[1] ? parseInt(ma[1],10) : 0;
        const nb = mb && mb[1] ? parseInt(mb[1],10) : 0;
        return na - nb;
    })
    .map(k => ({ name: k.replace(/^VITE_/,''), value: getEnv(k)! }))
    .filter(o => !!o.value);
// Asegurar secuencia continua GEMINI_API_KEY0..N (renombrar si falta algún índice intermedio)
geminiKeyMeta = geminiKeyMeta.map((m,i) => ({ name: `GEMINI_API_KEY${i}`, value: m.value }));
let geminiKeys: string[] = geminiKeyMeta.map(m=>m.value);
// Embed fallback
if (typeof __GEMINI_EMBED_KEYS__ !== 'undefined' && Array.isArray(__GEMINI_EMBED_KEYS__) && __GEMINI_EMBED_KEYS__.length && geminiKeys.length === 0) {
    const emb = __GEMINI_EMBED_KEYS__.filter((x: unknown) => typeof x === 'string' && x) as string[];
    geminiKeyMeta = emb.map((v,i)=> ({ name: `EMBED_KEY_${i}`, value: v }));
    geminiKeys.push(...emb);
}
const legacyKey = getEnv('API_KEY');
if (geminiKeys.length === 0 && legacyKey) {
    geminiKeyMeta.push({ name: 'API_KEY', value: legacyKey });
    geminiKeys.push(legacyKey);
}
if (geminiKeys.length === 0) {
    const single = getEnv('GEMINI_API_KEY') || getEnv('VITE_GEMINI_API_KEY');
    if (single) { geminiKeyMeta.push({ name: 'GEMINI_API_KEY', value: single }); geminiKeys.push(single); }
}
if (geminiKeys.length === 0) {
    const viteKeys = allEnvKeys.filter(k => /^VITE_GEMINI_API_KEY\d*$/.test(k)).sort().map(k => getEnv(k)!).filter(Boolean);
    if (viteKeys.length) {
        geminiKeyMeta.push(...viteKeys.map((v,i)=> ({ name: `VITE_GEMINI_API_KEY${i||''}`, value: v })));
        geminiKeys.push(...viteKeys);
    }
}
// Deduplicar manteniendo primer nombre para cada valor
const seenVals = new Set<string>();
const dedupMeta: KeyMeta[] = [];
for (const m of geminiKeyMeta) {
    if (seenVals.has(m.value)) continue;
    seenVals.add(m.value);
    dedupMeta.push(m);
}
geminiKeyMeta = dedupMeta;
geminiKeys = geminiKeyMeta.map(m=>m.value);
const baseEnvKeyNames = geminiKeyMeta.map(m=>m.name);
const envKeyCount = baseEnvKeyNames.length; // guardar antes de añadir usuario
const verboseKeys = (getEnv('VITE_GEMINI_VERBOSE_KEYS') || getEnv('GEMINI_VERBOSE_KEYS') || '').toLowerCase() === 'true';
if (verboseKeys) {
    gLog('info', `[Gemini] API keys base (entorno): ${baseEnvKeyNames.length} -> ${baseEnvKeyNames.join(', ')} (orden numérico)`);
} else {
    gLog('info', `[Gemini] API keys base (entorno): ${baseEnvKeyNames.length}`);
}

let currentKeyIndex = 0;

// Inyectar claves de usuario desde localStorage (si estamos en browser)
try {
    const userKeysRaw = (typeof window !== 'undefined') ? window.localStorage.getItem('userKeys') : undefined;
    const extra = userKeysRaw ? JSON.parse(userKeysRaw) : [];
    if (Array.isArray(extra) && extra.length) {
        let added = 0;
        for (const k of extra) {
            // k puede ser string (legacy) o { id?, api_key }
            const val = (typeof k === 'string') ? k : (k && typeof k.api_key === 'string' ? k.api_key : null);
            const id = (k && typeof k === 'object' && typeof k.id !== 'undefined') ? k.id : undefined;
            if (val && !geminiKeys.includes(val)) {
                const name = typeof id !== 'undefined' ? `USER_DB_KEY_${id}` : 'USER_DB_KEY';
                geminiKeyMeta.push({ name, value: val });
                geminiKeys.push(val);
                added++;
            }
        }
        if (added > 0) {
            const userNames = geminiKeyMeta.filter(m=> m.name.startsWith('USER_DB_KEY')).length;
            if (verboseKeys) {
                gLog('info', `[Gemini] Claves de usuario añadidas: ${added}. Total: ${geminiKeys.length} (env=${baseEnvKeyNames.length}, usuario=${userNames}). Rotación=${geminiKeys.length>1?'ON':'OFF'} -> ${geminiKeyMeta.map(m=>m.name).join(', ')}`);
            } else {
                gLog('info', `[Gemini] Añadidas ${added} claves usuario. Env=${envKeyCount} Usuario=${userNames} Total=${geminiKeys.length}`);
            }
        } else {
            gLog('info', verboseKeys ? `[Gemini] Claves usuario sin cambios. Env=${envKeyCount} Total=${geminiKeys.length}.` : `[Gemini] Sin nuevas claves usuario. Env=${envKeyCount} Total=${geminiKeys.length}`);
        }
    } else {
        gLog('info', `[Gemini] No se encontraron claves de usuario en localStorage.`);
    }
} catch {}

// Permite refrescar dinámicamente las claves de usuario (e.g. tras login) sin recargar página
export function refreshUserKeys(){
    try {
        if (typeof window === 'undefined') return;
        const userKeysRaw = window.localStorage.getItem('userKeys');
        const arr = userKeysRaw ? JSON.parse(userKeysRaw) : [];
        if (!Array.isArray(arr)) return;
        let added = 0;
        for (const k of arr){
            const val = (typeof k === 'string') ? k : (k && typeof k.api_key === 'string' ? k.api_key : null);
            const id = (k && typeof k === 'object' && typeof k.id !== 'undefined') ? k.id : undefined;
            if (val && !geminiKeys.includes(val)) {
                const name = typeof id !== 'undefined' ? `USER_DB_KEY_${id}` : 'USER_DB_KEY';
                geminiKeyMeta.push({ name, value: val });
                geminiKeys.push(val);
                concurrentClients.push(new (GoogleGenAI as any)({ apiKey: val }));
                added++;
            }
        }
        if (added){
            if (verboseKeys) gLog('info', `[Gemini] refreshUserKeys añadió ${added} nuevas claves. Total ahora ${geminiKeys.length}.`); else gLog('info', `[Gemini] refreshUserKeys +${added}. Total=${geminiKeys.length}`);
        }
    } catch(e){ /* ignore */ }
}

const buildClient = () => new GoogleGenAI({ apiKey: geminiKeys[currentKeyIndex] });
let ai = buildClient();
// Pool de clientes para modo concurrente (round-robin)
const concurrentClients: GoogleGenAI[] = geminiKeys.map(k => new GoogleGenAI({ apiKey: k }));
let rrIndex = 0;
// ---- Selección de clave: round-robin balanceado ----
const pickKeyIndex = () => {
    if (geminiKeys.length <= 1) return 0;
    const idx = rrIndex % geminiKeys.length;
    rrIndex++;
    return idx;
};

const pickClient = () => {
    if (!concurrentClients.length) return ai;
    const idx = pickKeyIndex();
    (concurrentClients[idx] as any).__rrIdx = idx; // almacenar índice usado
    return concurrentClients[idx];
};

const rotateKey = () => {
    if (geminiKeys.length <= 1) return false;
    // En modo random la rotación explícita no cambia nada, retornamos true para contabilidad.
    return true;
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

const modelCallHistory: Record<string, number[]> = {};
const acquireModelSlot = async (model: string) => {
    const cfg = MODEL_CONFIGS.find(m => m.model === model);
    const perKeyRpm = cfg?.rpmLimit || 6;
    const aggregateLimit = perKeyRpm * Math.max(1, geminiKeys.length);
    if (!modelCallHistory[model]) modelCallHistory[model] = [];
    while (true) {
        const now = Date.now();
        const arr = modelCallHistory[model];
        while (arr.length && now - arr[0] > 60000) arr.shift();
        if (arr.length < aggregateLimit) {
            arr.push(now);
            return;
        }
        const waitMs = 60000 - (now - arr[0]) + 150;
        console.log(`[RateLimit][agg] Esperando ${(waitMs/1000).toFixed(1)}s para modelo ${model} (agregado ${arr.length}/${aggregateLimit})`);
        await delay(waitMs);
    }
};

const withRetry = async <T>(fn: () => Promise<T>, operationLabel: string, modelName?: string): Promise<T> => {
    const maxAttempts = geminiKeys.length * 2;
    let attempt = 0;
    let backoff = 750;
    while (true) {
        try {
            attempt++;
            if (modelName) await acquireModelSlot(modelName);
            geminiStats.apiRequests++;
            if (modelName) geminiStats.perModel[modelName] = (geminiStats.perModel[modelName] || 0) + 1;
            geminiStats.operations[operationLabel] = (geminiStats.operations[operationLabel] || 0) + 1;
            try {
                if (USE_PROXY && modelName) {
                    // Ejecutar vía proxy (sin exponer claves) y devolver resultado adaptando a la firma esperada.
                    return await fn(); // fn internamente deberá llamar ai.* pero en modo proxy adaptaremos abajo
                } else {
                    // Round-robin local
                    let usedIndex = pickKeyIndex();
                    const client = concurrentClients[usedIndex];
                    const metaName = geminiKeyMeta[usedIndex]?.name || `KEY_${usedIndex}`;
                    geminiStats.perKey = geminiStats.perKey || {};
                    geminiStats.perKey[metaName] = (geminiStats.perKey[metaName] || 0) + 1;
                    if (configuredLevel === 'debug') {
                        const rawKey = geminiKeys[usedIndex] || '';
                        const tail = rawKey.slice(-4);
                        gLog('debug', `[Gemini][call] op=${operationLabel} model=${modelName || '-'} keyIndex=${usedIndex}/${geminiKeys.length} mode=balanced var=${metaName} tail=...${tail}`);
                    }
                    const prev = ai; ai = client; try { return await fn(); } finally { ai = prev; }
                }
            } catch(e) {}
        } catch (err: any) {
            const status = err?.error?.status || err?.status || err?.code;
            const isRateLimit = status === 429 || status === 'RESOURCE_EXHAUSTED' || err?.error?.status === 'RESOURCE_EXHAUSTED';
            if (isRateLimit) {
                gLog('debug', `[Gemini][${operationLabel}] Rate limit recibido (intento ${attempt}/${maxAttempts}). Reintentando con posible rotación...`);
                const rotated = rotateKey();
                if (rotated) geminiStats.rotations++;
                if (attempt >= maxAttempts) throw err;
                await delay(backoff);
                backoff = Math.min(backoff * 1.8, 8000);
                continue;
            }
            throw err;
        }
    }
};

const withRetryConcurrent = async <T>(fnBuilder: (client: GoogleGenAI) => Promise<T>, operationLabel: string, modelName?: string): Promise<T> => {
    const keysCount = Math.max(1, geminiKeys.length);
    const maxCycles = Math.max(2, keysCount * 3);
    let cycle = 0;
    let backoff = 500;
    while (cycle < maxCycles) {
        cycle++;
        for (let i = 0; i < keysCount; i++) {
    const client = pickClient();
            try {
                if (modelName) await acquireModelSlot(modelName);
                geminiStats.apiRequests++;
                if (modelName) geminiStats.perModel[modelName] = (geminiStats.perModel[modelName] || 0) + 1;
                geminiStats.operations[operationLabel] = (geminiStats.operations[operationLabel] || 0) + 1;
                try {
                    if (!USE_PROXY) {
                        const usedIdx = (client as any).__rrIdx ?? ((rrIndex - 1 + concurrentClients.length) % concurrentClients.length);
                        const metaName = geminiKeyMeta[usedIdx]?.name || `KEY_${usedIdx}`;
                        geminiStats.perKey = geminiStats.perKey || {};
                        geminiStats.perKey[metaName] = (geminiStats.perKey[metaName] || 0) + 1;
                        if (configuredLevel === 'debug') gLog('debug', `[Gemini][call-conc] op=${operationLabel} model=${modelName || '-'} clientIdx=${usedIdx} mode=balanced var=${metaName}`);
                        return await fnBuilder(client);
                    } else {
                        // Proxy: builder recibe client pero ignoramos y dejamos que internamente use proxyGenerate si se solicitó.
                        return await fnBuilder(client);
                    }
                } catch(_) {}
            } catch (err: any) {
                const status = err?.error?.status || err?.status || err?.code;
                const isRate = status === 429 || status === 'RESOURCE_EXHAUSTED';
                if (isRate) {
                    geminiStats.rateLimitHits++;
                    continue;
                }
                throw err;
            }
        }
        await delay(backoff);
        backoff = Math.min(backoff * 1.8, 7000);
    }
    throw new Error(`[withRetryConcurrent] Exhausted retries (${maxCycles} cycles) for ${operationLabel}`);
};

// ---------- Stats ----------
export const geminiStats: { apiRequests: number; rotations: number; rateLimitHits: number; operations: Record<string, number>; perStrategy: Record<string, number>; perModel: Record<string, number>; perKey?: Record<string, number>; } = {
    apiRequests: 0,
    rotations: 0,
    rateLimitHits: 0,
    operations: {},
    perStrategy: {},
    perModel: {},
    perKey: {}
};

export const getAndResetGeminiStats = () => {
    const snapshot = { ...geminiStats, operations: { ...geminiStats.operations }, perStrategy: { ...geminiStats.perStrategy }, perModel: { ...geminiStats.perModel }, perKey: { ...(geminiStats.perKey||{}) } };
    geminiStats.apiRequests = 0;
    geminiStats.rotations = 0;
    geminiStats.rateLimitHits = 0;
    geminiStats.operations = {};
    geminiStats.perStrategy = {};
    geminiStats.perModel = {};
    geminiStats.perKey = {};
    return snapshot;
};

const questionSchema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.INTEGER, description: 'Sequential question id starting at 1 (NO reuse, strictly increasing).'},
            pregunta: { type: Type.STRING, description: 'Clean question statement WITHOUT leading number or word Número.'},
            opciones: { type: Type.OBJECT, description: 'Map of options. Keys MUST be contiguous capital letters starting at A. Values are option texts (trimmed).', properties: { A: { type: Type.STRING } }, additionalProperties: { type: Type.STRING } },
            meta: { type: Type.OBJECT, properties: { multi: { type: Type.BOOLEAN }, negative: { type: Type.BOOLEAN }, assertionReason: { type: Type.BOOLEAN }, matching: { type: Type.BOOLEAN } }, required: [], propertyOrdering: ["multi","negative","assertionReason","matching"], description: 'Optional flags: multi (multiple answers), negative (EXCEPTO/INCORRECTA), assertionReason (Aserción y Razón), matching (column matching). If not applicable omit or set false.' }
        },
        required: ["id","pregunta","opciones"],
        propertyOrdering: ["id","pregunta","opciones","meta"],
    }
};

// Nuevo: schema simplificado para extracción sin meta
const extractionSchema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.INTEGER },
      pregunta: { type: Type.STRING },
      opciones: { type: Type.OBJECT, properties: { A: { type: Type.STRING } }, additionalProperties: { type: Type.STRING }, description: 'Opciones A.. con al menos 2 entradas' }
    },
    required: ["id","pregunta","opciones"],
    propertyOrdering: ["id","pregunta","opciones"],
  }
};

// Nuevo esquema solicitado por el usuario: { titulo: string, preguntas: [ { enunciado, respuestas[] } ] }
const plainExtractionSchema = {
    type: Type.OBJECT,
    properties: {
        titulo: { type: Type.STRING, description: 'Título corto (<=5 palabras) tipo "Test <TemaPrincipal> <SubtemaOpcional>" sin comillas.' },
        preguntas: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    enunciado: { type: Type.STRING, description: 'Texto limpio del enunciado sin numeración inicial.' },
                    respuestas: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Array ordenado de opciones (mínimo 2). El índice 0 corresponde a la opción A.' }
                },
                required: ['enunciado','respuestas'],
                propertyOrdering: ['enunciado','respuestas']
            },
            description: 'Lista de preguntas extraídas.'
        }
    },
    required: ['preguntas'],
    propertyOrdering: ['titulo','preguntas']
};

export interface ExtractionWithTitle { questions: Question[]; title?: string }

export const extractQuestionsFromText = async (text: string): Promise<ExtractionWithTitle> => {
    const plano = await extraerPreguntasPlano(text);
    return { questions: plainToQuestions(plano.preguntas), title: plano.titulo };
};

// NUEVA FUNCIÓN: devuelve el formato pedido por el usuario { preguntas: [ { enunciado, respuestas[] } ] }
// Además reutiliza internamente la lógica de limpieza para mejorar segmentación.
export interface PreguntaPlano { enunciado: string; respuestas: string[] }
export interface PreguntasPlanoResult { preguntas: PreguntaPlano[]; titulo?: string }

export const extraerPreguntasPlano = async (texto: string): Promise<PreguntasPlanoResult> => {
    const basePrompt = (instruccionesExtra = '') => `EXTRACCIÓN ESTRUCTURA SIMPLE\nAnaliza el siguiente texto y extrae TODAS las preguntas tipo test.\nReglas clave:\n- No combines varias preguntas en un solo enunciado.\n- Cada pregunta termina antes de que empiece un patrón de nueva numeración (número + ) o letra + paréntesis) o un salto claro de contexto.\n- Elimina numeración inicial del enunciado.\n- Mínimo 2 opciones por pregunta.\n- Genera también un título corto (<=5 palabras) siguiendo el formato: Test <TemaPrincipal> <SubtemaOpcional>. Sin símbolos ni comillas.\n- Devuelve SOLO JSON con el formato: {"titulo":"...","preguntas":[{"enunciado":"...","respuestas":["opción A","opción B", ...]}]}\n- NO incluyas letras (A), (B) dentro del texto de cada respuesta; sólo el contenido limpio.\n- Mantén el orden original A,B,C,...\n${instruccionesExtra}\nTexto:\n-----\n${texto}\n-----`;
    const models = ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite'];
    let lastErr: any = null;
    for (const model of models) {
        try {
            const prompt = basePrompt(model !== models[0] ? `(Reintento con modelo alternativo: ${model})` : '');
            const response: any = await withRetry(() => ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema } }), `extract-text-plain-${model}`, model);
            let parsed: any;
            try { parsed = JSON.parse(response.text); } catch { throw new Error('JSON inválido'); }
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.preguntas)) throw new Error('Formato inesperado');
            const clean: PreguntaPlano[] = [];
            parsed.preguntas.forEach((p: any) => {
                if (!p || typeof p !== 'object') return;
                let enunciado = String(p.enunciado || '').trim();
                enunciado = enunciado.replace(/^(?:\d+|\([A-Z]\)|[A-Z]\))\s*[).:-]?\s*/,'').trim();
                const respuestasRaw: string[] = Array.isArray(p.respuestas) ? p.respuestas : [];
                const respuestas = respuestasRaw.map(r => String(r).trim().replace(/^[A-Z]\)?\s*/,'')).filter(r => r.length>0);
                if (enunciado && respuestas.length >= 2) clean.push({ enunciado, respuestas });
            });
            const tituloRaw: string | undefined = typeof parsed.titulo === 'string' ? parsed.titulo.trim() : undefined;
            return { preguntas: clean, titulo: tituloRaw };
        } catch (err) {
            lastErr = err;
            continue; // intentar siguiente modelo
        }
    }
    console.error('[extraerPreguntasPlano] Fallaron todos los modelos', lastErr);
    throw new Error('No se pudo extraer en formato plano.');
};

export const extractQuestionsFromFile = async (dataUrl: string): Promise<ExtractionWithTitle> => {
  const m = dataUrl.match(/^data:(.+?);base64,(.+)$/); if (!m) throw new Error('Formato data URL inválido');
  const mimeType = m[1]; const base64Data = m[2];
  const part = { inlineData: { mimeType, data: base64Data } };
    const models = ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite'];
    let lastErr: any = null;
    for (const model of models) {
        try {
            const promptPlano = 'EXTRACCIÓN MCQ FORMATO PLANO -> JSON {"titulo":"...","preguntas":[{"enunciado":"...","respuestas":["..."]}] } (modelo '+model+')';
            const respPlano: any = await withRetry(() => ai.models.generateContent({ model, contents: { parts: [part, { text: promptPlano }] }, config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema } }), `extract-file-plain-${model}`, model);
            const parsedPlano = JSON.parse(respPlano.text);
            if (parsedPlano?.preguntas) {
                return { questions: plainToQuestions(parsedPlano.preguntas), title: typeof parsedPlano.titulo==='string'? parsedPlano.titulo.trim(): undefined };
            }
        } catch(e) { lastErr = e; }
    }
    console.error('[extractQuestionsFromFile] Fallaron todos los modelos', lastErr);
    throw new Error('No se pudieron extraer preguntas del archivo.');
};

// Utilidades de post-procesado
function postProcessExtraction(raw: any): Question[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((q:any, idx:number) => {
    const id = typeof q.id === 'number' ? q.id : idx+1;
    let pregunta = String(q.pregunta||'').trim().replace(/^(?:n[úu]mero|numero|pregunta)\s+\d+[\.):]?\s*/i,'').trim();
    const opcionesObj = q.opciones && typeof q.opciones==='object' ? q.opciones : {};
    const vals = Object.values(opcionesObj).map(v=>String(v).trim()).filter(Boolean);
    const opciones: Record<string,string> = {};
    vals.forEach((v,i)=> opciones[String.fromCharCode(65+i)] = v);
    return { id, pregunta, opciones, meta: deriveMeta(pregunta) } as Question;
  }).filter(q=> q.pregunta && Object.keys(q.opciones).length>=2);
}
function deriveMeta(stmt: string) { const lower = stmt.toLowerCase(); return { multi: /(todas las que|marque dos|seleccione las correctas|varias respuestas)/i.test(lower), negative: /(incorrecta|excepto|\bno\b|falsa)/i.test(lower), assertionReason: /aserci[óo]n.*raz[óo]n|raz[óo]n:/.test(lower), matching: /(relaciona|empareja|columnas|haga corresponder)/i.test(lower) }; }
function needsRetry(list: Question[]): boolean { return list.some(q => Object.keys(q.opciones).length < 2); }

// ---- Extracción desde archivos (PDF(s) + imágenes múltiples) ----
// Entrada genérica: array de recursos con base64 (sin encabezado data:) y mimeType.
// Si el tamaño total inline supera ~20MB se sube cada PDF/imagen grande vía Files API.

interface SourceFileInput { base64: string; mimeType: string; displayName?: string; }

const MAX_INLINE_BYTES = 20 * 1024 * 1024; // Límite recomendado para datos intercalados

function estimateBytesFromBase64(b64: string) {
    // base64 length ~ 4/3 * bytes -> bytes ≈ len * 0.75
    return Math.floor(b64.length * 0.75);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    try {
        const binary = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mimeType });
    } catch (e) {
        throw new Error('Error convirtiendo base64 a Blob: ' + (e as any)?.message);
    }
}

function normalizeQuestionsArray(parsedJson: any): Question[] {
    if (Array.isArray(parsedJson)) {
        parsedJson.forEach((q: any, idx: number) => {
            if (typeof q.id !== 'number') q.id = idx + 1;
            if (!q.meta) q.meta = {};
            ['multi','negative','assertionReason','matching'].forEach(k => { if (q.meta[k] === undefined) q.meta[k] = false; });
            if (q.opciones) {
                const vals = Object.values(q.opciones);
                const remapped: Record<string,string> = {};
                vals.forEach((v,i)=> { remapped[String.fromCharCode(65+i)] = String(v); });
                q.opciones = remapped;
            }
        });
    }
    return parsedJson as Question[];
}

export const extractQuestionsFromFiles = async (files: SourceFileInput[]): Promise<ExtractionWithTitle> => {
    if (!files.length) return { questions: [] };
    console.log(`[GeminiFiles] Extrayendo preguntas de ${files.length} archivo(s) ...`);
    const parts: any[] = [];
    for (const f of files) {
        const bytes = estimateBytesFromBase64(f.base64);
        if (bytes < MAX_INLINE_BYTES) {
            parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
        } else {
            try {
                const blob = base64ToBlob(f.base64, f.mimeType);
                const uploaded: any = await withRetry(() => ai.files.upload({ file: blob, config: { displayName: f.displayName || 'input-file' } }), 'file-upload');
                let fileInfo: any = uploaded; let safetyCounter = 0;
                while (fileInfo.state === 'PROCESSING' && safetyCounter < 40) {
                    await delay(1000);
                    fileInfo = await withRetry(() => ai.files.get({ name: uploaded.name }), 'file-get');
                    safetyCounter++;
                }
                if (fileInfo.state === 'FAILED') { console.warn('[GeminiFiles] Falló procesar archivo:', f.displayName || f.mimeType); continue; }
                if (fileInfo.uri && fileInfo.mimeType) parts.push(createPartFromUri(fileInfo.uri, fileInfo.mimeType));
            } catch(e) { console.error('[GeminiFiles] Error subiendo archivo grande:', e); }
        }
    }
    if (!parts.length) throw new Error('No se pudo preparar ningún archivo para extracción.');
    const models = ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite'];
    let lastErr: any = null;
    for (const model of models) {
        try {
            const promptPlano = 'EXTRACCIÓN MCQ PLANO (MULTI) -> JSON {"titulo":"...","preguntas":[{"enunciado":"...","respuestas":["..."]}]}';
            const respPlano: any = await withRetry(() => ai.models.generateContent({ model, contents: [ { text: promptPlano }, ...parts ], config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema } }), `extract-files-plain-${model}`, model);
            const parsedPlano = JSON.parse(respPlano.text);
            if (parsedPlano?.preguntas) return { questions: plainToQuestions(parsedPlano.preguntas), title: typeof parsedPlano.titulo==='string'? parsedPlano.titulo.trim(): undefined };
        } catch(e){ lastErr = e; }
    }
    console.error('[extractQuestionsFromFiles] Fallaron todos los modelos', lastErr);
    throw new Error('No se pudo extraer preguntas de los archivos.');
};

// NUEVO: extracción combinada TEXTO + ARCHIVOS (imágenes/PDF)
export const extractQuestionsFromMixed = async (
    text: string,
    files: SourceFileInput[]
): Promise<ExtractionWithTitle> => {
    const trimmed = (text || '').trim();
    // Atajos por si llega solo un tipo
    if (!files?.length && trimmed) return await extractQuestionsFromText(trimmed);
    if (files?.length && !trimmed) return await extractQuestionsFromFiles(files);
    if (!files?.length && !trimmed) return { questions: [] };

    // Preparar parts de archivos (como en extractQuestionsFromFiles)
    const parts: any[] = [];
    for (const f of files) {
        const bytes = estimateBytesFromBase64(f.base64);
        if (bytes < MAX_INLINE_BYTES) {
            parts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
        } else {
            try {
                const blob = base64ToBlob(f.base64, f.mimeType);
                const uploaded: any = await withRetry(() => ai.files.upload({ file: blob, config: { displayName: f.displayName || 'input-file' } }), 'file-upload');
                let fileInfo: any = uploaded; let safetyCounter = 0;
                while (fileInfo.state === 'PROCESSING' && safetyCounter < 40) {
                    await delay(1000);
                    fileInfo = await withRetry(() => ai.files.get({ name: uploaded.name }), 'file-get');
                    safetyCounter++;
                }
                if (fileInfo.state === 'FAILED') { console.warn('[GeminiMixed] Falló procesar archivo:', f.displayName || f.mimeType); continue; }
                if (fileInfo.uri && fileInfo.mimeType) parts.push(createPartFromUri(fileInfo.uri, fileInfo.mimeType));
            } catch(e) { console.error('[GeminiMixed] Error subiendo archivo grande:', e); }
        }
    }
    if (!parts.length) {
        // Si por algún motivo no se pudo preparar archivos, vuelca a texto solo
    return await extractQuestionsFromText(trimmed);
    }

    // SOLO UNA PETICIÓN: formato PLANO
    const promptPlano = `EXTRACCIÓN COMBINADA (TEXTO + ARCHIVOS)\nDevuelve JSON {"preguntas":[{"enunciado":"...","respuestas":["..."]}]}.\nReglas: no mezclar preguntas, quitar numeración, mínimo 2 opciones.`;
    const contents: any[] = [ { text: promptPlano }, { text: trimmed } , ...parts ];
    const models = ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite'];
    let lastErr: any = null;
    for (const model of models) {
        try {
            const respPlano: any = await withRetry(() => ai.models.generateContent({ model, contents, config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema } }), `extract-mixed-plain-${model}`, model);
            const parsedPlano = JSON.parse(respPlano.text);
            if (parsedPlano?.preguntas) return { questions: plainToQuestions(parsedPlano.preguntas), title: typeof parsedPlano.titulo==='string'? parsedPlano.titulo.trim(): undefined };
        } catch(e){ lastErr = e; }
    }
    console.error('[extractQuestionsFromMixed] Fallaron todos los modelos', lastErr);
    throw new Error('No se pudieron extraer preguntas (mixto).');
};
// Conversión plano -> formato interno Question
function plainToQuestions(pregs: PreguntaPlano[]): Question[] {
    return pregs.map((p, idx) => {
        const opciones: Record<string,string> = {};
        p.respuestas.forEach((r,i)=> opciones[String.fromCharCode(65+i)] = r);
        return { id: idx+1, pregunta: p.enunciado, opciones, meta: deriveMeta(p.enunciado) } as Question;
    });
}
// fin extracción multi-archivo refactorizada

// ---- Batch Solving ----
// We'll support solving multiple questions at once for BASE, EXPERT_PERSONA, CHAIN_OF_THOUGHT (reduced reasoning), PERMUTATION_QUESTIONS.
// Some strategies (like PERMUTATION_OPTIONS or PIVOT_LANGUAGE) apply per-question transforms; keep per-question path for them.

interface BatchSolveRequest {
    questions: Question[];
    strategyKey: StrategyKey;
}

export const solveQuestionsBatch = async ({ questions, strategyKey }: BatchSolveRequest): Promise<Record<number, string>> => {
        if (questions.length === 0) return {};

    // Build a single prompt containing all questions.
        const serialized = questions.map(q => {
            const opts = Object.entries(q.opciones).map(([k,v]) => `${k}) ${v}`).join('\n');
            return `QID:${q.id}\n${q.pregunta}\n${opts}`;
        }).join('\n\n===\n\n');

    let header = 'Answer the following multiple-choice questions. For each question respond ONLY with a line of the form "QID:<id> <LETTER>". No explanations.';
        if (strategyKey === StrategyKey.CHAIN_OF_THOUGHT) {
        header = 'Solve each question. Think privately. Output ONLY final answers lines: "QID:<id> <LETTER>" with no extra text.';
        } else if (strategyKey === StrategyKey.PERMUTATION_MIX) {
            // Shuffle questions and within each question shuffle options before serializing
            questions = [...questions].sort(() => Math.random() - 0.5);
            const transformed = questions.map(q => {
                const keys = Object.keys(q.opciones);
                const shuffled = [...keys].sort(() => Math.random() - 0.5);
                const mapping: Record<string,string> = {};
                shuffled.forEach((k,i) => mapping[String.fromCharCode(65+i)] = q.opciones[k]);
                return { original: q, transformed: { id: q.id, pregunta: q.pregunta, opciones: mapping }, reverse: Object.fromEntries(shuffled.map((orig, i) => [String.fromCharCode(65+i), orig])) };
            });
            const serializedLocal = transformed.map(t => {
                const opts = Object.entries(t.transformed.opciones).map(([k,v]) => `${k}) ${v}`).join('\n');
                return `QID:${t.transformed.id}\n${t.transformed.pregunta}\n${opts}`;
            }).join('\n\n===\n\n');
            const promptLocal = `${header}\n\n${serializedLocal}\n\nRecuerda: SOLO líneas "QID:<id> <LETRA>".`;
            const response: any = await withRetry(() => ai.models.generateContent({ model: 'gemini-2.5-flash', contents: promptLocal, config: buildModelConfig('gemini-2.5-flash') }), `batch-solve-${strategyKey}`, 'gemini-2.5-flash');
            const text = (response.text || '').trim();
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const answers: Record<number,string> = {};
            for (const line of lines) {
                const match = line.match(/^QID:(\d+)\s+([A-Z])/i);
                if (match) {
                    const qid = parseInt(match[1],10);
                    const letter = match[2].toUpperCase();
                    const entry = transformed.find(t => t.transformed.id === qid);
                    if (entry) {
                        const orig = entry.reverse[letter];
                            if (orig) answers[qid] = orig;
                    }
                }
            }
            for (const t of transformed) {
                if (!answers[t.transformed.id]) answers[t.transformed.id] = Object.keys(t.original.opciones)[0];
            }
            return answers;
    }

        const prompt = `${header}\n\n${serialized}\n\nRecuerda: SOLO líneas "QID:<id> <LETRA>".`;

            const response: any = await withRetry(() => ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: buildModelConfig('gemini-2.5-flash') }), `batch-solve-${strategyKey}`, 'gemini-2.5-flash');
        const text = (response.text || '').trim();

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const answers: Record<number,string> = {};
    const validLetters = /^[A-Z]$/;
    for (const line of lines) {
        const match = line.match(/^QID:(\d+)\s+([A-Z])/i);
        if (match) {
            const qid = parseInt(match[1],10);
            const letter = match[2].toUpperCase();
            if (validLetters.test(letter)) answers[qid] = letter;
        }
    }
    // Fallback: ensure each question has some answer
    for (const q of questions) {
            const validKeys = Object.keys(q.opciones);
            const current = answers[q.id];
            if (!current || !validKeys.includes(current)) {
                answers[q.id] = validKeys[0];
            }
    }
    return answers;
};

export const solveQuestion = async (question: Question, strategyKey: StrategyKey): Promise<string> => {
    const optionsString = Object.entries(question.opciones)
        .map(([key, value]) => `${key}) ${value}`)
        .join('\n');

    let prompt = `Solve the following multiple-choice question. Analyze it carefully and provide the single best answer.\n\nQuestion: ${question.pregunta}\n\nOptions:\n${optionsString}\n\nRespond with only the capital letter of the correct option (e.g., A, B, C, or D). Do not provide any explanation or other text.`;
    
    const config: any = {};

    switch(strategyKey) {
        case StrategyKey.CHAIN_OF_THOUGHT:
            prompt = `For the following multiple-choice question, first, think step-by-step to analyze the question and options. Then, based on your reasoning, provide the final answer.\n\nQuestion: ${question.pregunta}\n\nOptions:\n${optionsString}\n\nYour step-by-step thinking process (private): ...\n\nFinal Answer: [Respond with only the capital letter of the correct option]`;
            break;
    case StrategyKey.PIVOT_LANGUAGE:
            // Simplificado: indicamos que traduzca internamente al inglés y responda solo la letra
            prompt = `Internally translate the following MCQ to English, reason briefly (hidden), then output ONLY the correct option letter.\n\nQuestion (Spanish): ${question.pregunta}\n\nOptions:\n${optionsString}\n\nAnswer: `;
            break;
    case StrategyKey.BASE:
    default:
        // Ya se aplicará el presupuesto global del modelo en buildModelConfig
        break;
    }

    const response: any = await withRetry(() => ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt, config: { ...buildModelConfig('gemini-2.5-flash'), ...config } }), `solve-${strategyKey}`, 'gemini-2.5-flash');
    const answer = (response.text || '').trim().toUpperCase().charAt(0);
    console.log(`[${strategyKey}] solved question ${question.id}. Chose: ${answer}.`);

    if (!geminiStats.perStrategy[strategyKey]) geminiStats.perStrategy[strategyKey] = 0;
    geminiStats.perStrategy[strategyKey]++;

    if (Object.keys(question.opciones).includes(answer)) return answer;
    console.warn(`[${strategyKey}] returned an invalid option '${answer}'. Falling back.`);
    return Object.keys(question.opciones)[0];
};

// Nuevo: función para lanzar varias rondas por diferentes modelos y fusionar votos
type PartialUpdate = { modelKey: string; iteration: number; answers: Record<number,string>; };
interface MultiModelOptions { concurrent?: boolean; concurrencyLimit?: number; earlyStopConfidence?: number }
export const multiModelBatchSolve = async (
    questions: Question[],
    strategyKey: StrategyKey,
    activeModelKeys: string[],
    onPartial?: (data: PartialUpdate) => void,
    opts?: MultiModelOptions
) => {
    const answersAggregate: Record<number, string[]> = {};
    for (const q of questions) answersAggregate[q.id] = [];
    const perModelAnswers: Record<string, Record<number, string[]>> = {};
    for (const mk of activeModelKeys) {
        perModelAnswers[mk] = {};
        for (const q of questions) perModelAnswers[mk][q.id] = [];
    }
    // Rama concurrente
    if (opts?.concurrent) {
        interface Task { run: () => Promise<void>; }
        const tasks: Task[] = [];
    for (const modelKey of activeModelKeys) {
            const cfg = MODEL_CONFIGS.find(m => m.key === modelKey); if (!cfg) continue;
            const maxCalls = cfg.maxPerTest || 1;
            const halfNoReason = Math.floor(maxCalls / 2); // primera mitad sin razonamiento
            for (let i = 0; i < maxCalls; i++) {
                const iteration = i + 1;
                tasks.push({
                    run: async () => {
                        const serialized = questions.map(q => {
                            const optsStr = Object.entries(q.opciones).map(([k,v]) => `${k}) ${v}`).join('\n');
                            return `QID:${q.id}\n${q.pregunta}\n${optsStr}`;
                        }).join('\n\n===\n\n');
                        const prompt = `Responde cada pregunta devolviendo SOLO lineas "QID:<id> <LETRA>".\n\n${serialized}`;
                        const useReasoning = i >= halfNoReason; // segunda mitad con reasoning
                        try {
                            const response: any = await withRetryConcurrent(c => c.models.generateContent({ model: cfg.model, contents: prompt, config: useReasoning ? buildModelConfig(cfg.model, questions.length) : {} }), `mm-batch-conc-${strategyKey}-${cfg.key}`, cfg.model);
                            const text = (response.text || '').trim();
                            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                            const partialAnswers: Record<number,string> = {};
                            const seen: Set<number> = new Set();
                            for (const line of lines) {
                                const m = line.match(/^QID:(\d+)\s+([A-Z])/i);
                                if (m) {
                                    const qid = parseInt(m[1],10); const letter = m[2].toUpperCase();
                                    if (answersAggregate[qid]) answersAggregate[qid].push(letter);
                                    if (perModelAnswers[cfg.key] && perModelAnswers[cfg.key][qid]) perModelAnswers[cfg.key][qid].push(letter);
                                    partialAnswers[qid] = letter;
                                    seen.add(qid);
                                }
                            }
                            // Fallback por cada pregunta sin respuesta en esta iteración
                            for (const q of questions) {
                                if (!seen.has(q.id)) {
                                    const fallback = Object.keys(q.opciones)[0];
                                    answersAggregate[q.id].push(fallback);
                                    perModelAnswers[cfg.key][q.id].push(fallback);
                                    partialAnswers[q.id] = fallback;
                                }
                            }
                            if (onPartial) onPartial({ modelKey: cfg.key, iteration, answers: partialAnswers });
                            // Early stop check: si todas las preguntas alcanzan confianza
                            if (opts?.earlyStopConfidence) {
                                const threshold = opts.earlyStopConfidence;
                                let allReached = true;
                                for (const q of questions) {
                                    const votes = answersAggregate[q.id];
                                    if (!votes.length) { allReached = false; break; }
                                    // calcular líder
                                    const counts: Record<string, number> = {};
                                    votes.forEach(v => counts[v] = (counts[v]||0)+1);
                                    const max = Math.max(...Object.values(counts));
                                    const conf = (max / votes.length) * 100;
                                    if (conf < threshold) { allReached = false; break; }
                                }
                                if (allReached) {
                                    // Cancelar tareas restantes descartando iteraciones futuras
                                    tasks.length = 0; // vaciamos cola
                                }
                            }
                        } catch (e:any) {
                            console.warn('[multiModel][conc] fallo', cfg.model, e);
                            // En fallo total: asignar fallback a todas las preguntas de esta iteración
                            const partialAnswers: Record<number,string> = {};
                            for (const q of questions) {
                                const fallback = Object.keys(q.opciones)[0];
                                answersAggregate[q.id].push(fallback);
                                perModelAnswers[cfg.key][q.id].push(fallback);
                                partialAnswers[q.id] = fallback;
                            }
                            if (onPartial) onPartial({ modelKey: cfg.key, iteration, answers: partialAnswers });
                        }
                    }
                });
            }
        }
        const limit = Math.max(1, opts.concurrencyLimit || concurrentClients.length || 4);
        let index = 0; let running = 0;
        await new Promise<void>(resolve => {
            const launch = () => {
                if (index >= tasks.length && running === 0) return resolve();
                while (running < limit && index < tasks.length) {
                    const t = tasks[index++];
                    running++;
                    t.run().finally(() => { running--; launch(); });
                }
            };
            launch();
        });
        const finalConcurrent: Record<number,string[]> = {};
        for (const [idStr, arr] of Object.entries(answersAggregate)) finalConcurrent[Number(idStr)] = arr.length ? arr : ['A'];
    (finalConcurrent as any).__perModel = perModelAnswers;
    return finalConcurrent;
    }
    for (const modelKey of activeModelKeys) {
        const cfg = MODEL_CONFIGS.find(m => m.key === modelKey);
        if (!cfg) continue;
    const maxCalls = cfg.maxPerTest || 1; // siempre máximo permitido
    const halfNoReason = Math.floor(maxCalls / 2);
    for (let i = 0; i < maxCalls; i++) {
            // usamos batch prompts independientes por modelo para recolección.
            const serialized = questions.map(q => {
                const opts = Object.entries(q.opciones).map(([k,v]) => `${k}) ${v}`).join('\n');
                return `QID:${q.id}\n${q.pregunta}\n${opts}`;
            }).join('\n\n===\n\n');
            const prompt = `Responde cada pregunta devolviendo SOLO lineas "QID:<id> <LETRA>".\n\n${serialized}`;
            const useReasoning = i >= halfNoReason;
            try {
                const response: any = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents: prompt, config: useReasoning ? buildModelConfig(cfg.model, questions.length) : {} }), `mm-batch-${strategyKey}-${cfg.key}`, cfg.model);
                const text = (response.text || '').trim();
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const partialAnswers: Record<number,string> = {};
                for (const line of lines) {
                    const m = line.match(/^QID:(\d+)\s+([A-Z])/i);
                    if (m) {
                        const qid = parseInt(m[1],10); const letter = m[2].toUpperCase();
            if (answersAggregate[qid]) answersAggregate[qid].push(letter);
            if (perModelAnswers[cfg.key] && perModelAnswers[cfg.key][qid]) perModelAnswers[cfg.key][qid].push(letter);
            partialAnswers[qid] = letter;
                    }
                }
        if (onPartial) onPartial({ modelKey: cfg.key, iteration: i+1, answers: partialAnswers });
            } catch(e: any) {
                console.warn(`[multiModel] fallo modelo ${cfg.model}:`, e);
                // Si rate limit -> continuar después de pequeña espera simulada (omitimos sleep real por simplicidad)
                if (e?.error?.status === 'RESOURCE_EXHAUSTED' || /rate/i.test(String(e))) {
                    continue;
                } else if (e?.error?.status === 'INVALID_ARGUMENT') {
                    // No soporta config -> intentar sin config especial una sola vez
                    try {
                        const fallbackResp: any = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents: prompt }), `mm-batch-fallback-${strategyKey}-${cfg.key}`, cfg.model);
                        const text2 = (fallbackResp.text || '').trim();
                        const lines2 = text2.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            const partialAnswers: Record<number,string> = {};
                        for (const line of lines2) {
                            const m = line.match(/^QID:(\d+)\s+([A-Z])/i);
                            if (m) {
                                const qid = parseInt(m[1],10); const letter = m[2].toUpperCase();
                if (answersAggregate[qid]) answersAggregate[qid].push(letter);
                if (perModelAnswers[cfg.key] && perModelAnswers[cfg.key][qid]) perModelAnswers[cfg.key][qid].push(letter);
                partialAnswers[qid] = letter;
                            }
                        }
            if (onPartial) onPartial({ modelKey: cfg.key, iteration: i+1, answers: partialAnswers });
                    } catch(_) {}
                    break; // salir de bucle de llamadas para este modelo
                } else {
                    break; // otros errores: no insistir
                }
            }
        }
    }
    // Devolver array de votos crudo para cómputo posterior en la UI
    const final: Record<number,string[]> = {};
    for (const [idStr, arr] of Object.entries(answersAggregate)) final[Number(idStr)] = arr.length ? arr : ['A'];
    (final as any).__perModel = perModelAnswers;
    return final;
};

// ---- Helper de configuración según modelo ----
 function buildModelConfig(modelName: string, questionCount?: number): any {
     const cfg = MODEL_CONFIGS.find(m=>m.model === modelName);
     if (!cfg) return {};
     if (cfg.thinkingMode === 'none') return {};
     const blocks = Math.max(1, Math.ceil((questionCount || 0) / 20));
     const dynamicBudget = 8192 * blocks;
     const baseBudget = cfg.thinkingBudget || 8192;
     const budget = Math.min(24576, Math.max(baseBudget, dynamicBudget));
     return { thinkingConfig: { thinkingBudget: budget, includeThoughts: false } };
 }

// Cliente proxy (server-side pooling). Si está definido VITE_USE_PROXY se usará para las operaciones generativas.
const USE_PROXY = (getEnv('VITE_USE_PROXY') || '').toLowerCase() === 'true';

if (USE_PROXY) {
    try {
        gLog('info','[Gemini] Modo PROXY habilitado: las llamadas se enviarán al backend para rotación segura.');
        // Reemplazar metadatos de claves para evitar exponer conteo real.
        geminiKeys = ['PROXY'];
        geminiKeyMeta = [{ name: 'PROXY', value: '_' } as any];
        // Vaciar clientes concurrentes (serán inútiles en proxy)
        (concurrentClients as any).length = 0;
        // Monkey patch de generateContent para redirigir
        (ai as any).models = { generateContent: ({ model, contents, config }: any) => proxyGenerate(model, { contents, config }) };
    } catch (e) {
        console.warn('[Gemini][proxy] No se pudo inicializar el modo proxy', e);
    }
}

async function proxyGenerate(model: string, payload: { prompt?: string; contents?: any; config?: any }): Promise<any> {
  const body: any = { model };
  if (payload.contents) body.contents = payload.contents; else body.prompt = payload.prompt;
  if (payload.config) body.config = payload.config;
  const resp = await fetch('/api/ai/proxy/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('authToken') ? `Bearer ${localStorage.getItem('authToken')}` : '' }, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error('Proxy response invalid');
  return { text: data.text } as any;
}