import { GoogleGenAI, Type, createPartFromUri } from "@google/genai";
import { Question, StrategyKey, ModelConfig, PdfAnalysis } from '../types';
import {
    GlobalAnalysisResult,
    GlobalWorkChunk,
    globalPreAnalysisSchema as globalSchemaRaw,
    GLOBAL_PRE_ANALYSIS_PROMPT,
    slicePdf,
    getPdfPageCount
} from './pdfSplitService';
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
const levelRank: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
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
    .sort((a, b) => {
        const re = /^(?:VITE_)?GEMINI_API_KEY(\d*)$/;
        const ma = a.match(re); const mb = b.match(re);
        const na = ma && ma[1] ? parseInt(ma[1], 10) : 0;
        const nb = mb && mb[1] ? parseInt(mb[1], 10) : 0;
        return na - nb;
    })
    .map(k => ({ name: k.replace(/^VITE_/, ''), value: getEnv(k)! }))
    .filter(o => !!o.value);
// Asegurar secuencia continua GEMINI_API_KEY0..N (renombrar si falta algún índice intermedio)
geminiKeyMeta = geminiKeyMeta.map((m, i) => ({ name: `GEMINI_API_KEY${i}`, value: m.value }));
let geminiKeys: string[] = geminiKeyMeta.map(m => m.value);
// Embed fallback
if (typeof __GEMINI_EMBED_KEYS__ !== 'undefined' && Array.isArray(__GEMINI_EMBED_KEYS__) && __GEMINI_EMBED_KEYS__.length && geminiKeys.length === 0) {
    const emb = __GEMINI_EMBED_KEYS__.filter((x: unknown) => typeof x === 'string' && x) as string[];
    geminiKeyMeta = emb.map((v, i) => ({ name: `EMBED_KEY_${i}`, value: v }));
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
        geminiKeyMeta.push(...viteKeys.map((v, i) => ({ name: `VITE_GEMINI_API_KEY${i || ''}`, value: v })));
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
geminiKeys = geminiKeyMeta.map(m => m.value);
const baseEnvKeyNames = geminiKeyMeta.map(m => m.name);
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
            const userNames = geminiKeyMeta.filter(m => m.name.startsWith('USER_DB_KEY')).length;
            if (verboseKeys) {
                gLog('info', `[Gemini] Claves de usuario añadidas: ${added}. Total: ${geminiKeys.length} (env=${baseEnvKeyNames.length}, usuario=${userNames}). Rotación=${geminiKeys.length > 1 ? 'ON' : 'OFF'} -> ${geminiKeyMeta.map(m => m.name).join(', ')}`);
            } else {
                gLog('info', `[Gemini] Añadidas ${added} claves usuario. Env=${envKeyCount} Usuario=${userNames} Total=${geminiKeys.length}`);
            }
        } else {
            gLog('info', verboseKeys ? `[Gemini] Claves usuario sin cambios. Env=${envKeyCount} Total=${geminiKeys.length}.` : `[Gemini] Sin nuevas claves usuario. Env=${envKeyCount} Total=${geminiKeys.length}`);
        }
    } else {
        gLog('info', `[Gemini] No se encontraron claves de usuario en localStorage.`);
    }
} catch { }

// Permite refrescar dinámicamente las claves de usuario (e.g. tras login) sin recargar página
export function refreshUserKeys() {
    try {
        if (typeof window === 'undefined') return;
        const userKeysRaw = window.localStorage.getItem('userKeys');
        const arr = userKeysRaw ? JSON.parse(userKeysRaw) : [];
        if (!Array.isArray(arr)) return;
        let added = 0;
        for (const k of arr) {
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
        if (added) {
            if (verboseKeys) gLog('info', `[Gemini] refreshUserKeys añadió ${added} nuevas claves. Total ahora ${geminiKeys.length}.`); else gLog('info', `[Gemini] refreshUserKeys +${added}. Total=${geminiKeys.length}`);
        }
    } catch (e) { /* ignore */ }
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

// ---- KeySlotPool: Gestión de claves para procesamiento paralelo verdadero ----
class KeySlotPool {
    private slots: { keyIndex: number; busy: boolean; cooldownUntil: number; }[];
    private waitQueue: Array<(slotIndex: number) => void> = [];

    constructor(keyCount: number) {
        this.slots = Array.from({ length: keyCount }, (_, i) => ({
            keyIndex: i,
            busy: false,
            cooldownUntil: 0
        }));
    }

    async acquire(): Promise<{ slotIndex: number; keyIndex: number; client: GoogleGenAI }> {
        while (true) {
            const now = Date.now();
            // Buscar un slot libre y no en cooldown
            for (let i = 0; i < this.slots.length; i++) {
                const slot = this.slots[i];
                if (!slot.busy && slot.cooldownUntil <= now) {
                    slot.busy = true;
                    return { slotIndex: i, keyIndex: slot.keyIndex, client: concurrentClients[slot.keyIndex] };
                }
            }
            // Si todos están ocupados o en cooldown, esperar un poco
            await delay(50);
        }
    }

    release(slotIndex: number) {
        if (this.slots[slotIndex]) {
            this.slots[slotIndex].busy = false;
        }
    }

    setCooldown(slotIndex: number, durationMs: number) {
        if (this.slots[slotIndex]) {
            this.slots[slotIndex].cooldownUntil = Date.now() + durationMs;
            this.slots[slotIndex].busy = false; // Liberamos pero con cooldown
        }
    }

    getAvailableCount(): number {
        const now = Date.now();
        return this.slots.filter(s => !s.busy && s.cooldownUntil <= now).length;
    }

    getTotalCount(): number {
        return this.slots.length;
    }
}

// Pool global para operaciones paralelas
const keySlotPool = new KeySlotPool(geminiKeys.length);

// Export para uso externo
export const getKeyPoolStats = () => ({
    total: keySlotPool.getTotalCount(),
    available: keySlotPool.getAvailableCount()
});

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
        console.log(`[RateLimit][agg] Esperando ${(waitMs / 1000).toFixed(1)}s para modelo ${model} (agregado ${arr.length}/${aggregateLimit})`);
        await delay(waitMs);
    }
};

const withRetry = async <T>(fn: () => Promise<T>, operationLabel: string, modelName?: string, pinnedIndex?: number): Promise<T> => {
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
                    return await fn();
                } else {
                    // Si se pasó pinnedIndex lo usamos, sino pickKeyIndex
                    let usedIndex = pinnedIndex !== undefined ? (pinnedIndex % geminiKeys.length) : pickKeyIndex();
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
            } catch (e) { }
        } catch (err: any) {
            const status = err?.error?.status || err?.status || err?.code;
            const isRateLimit = status === 429 || status === 'RESOURCE_EXHAUSTED' || err?.error?.status === 'RESOURCE_EXHAUSTED';
            if (isRateLimit) {
                gLog('debug', `[Gemini][${operationLabel}] Rate limit recibido (intento ${attempt}/${maxAttempts}). Reintentando...`);
                if (pinnedIndex !== undefined) {
                    // Si estamos anclados, no podemos rotar, así que fallamos tras intentos o esperamos backoff prolongado
                } else {
                    const rotated = rotateKey();
                    if (rotated) geminiStats.rotations++;
                }
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
                } catch (_) { }
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
    const snapshot = { ...geminiStats, operations: { ...geminiStats.operations }, perStrategy: { ...geminiStats.perStrategy }, perModel: { ...geminiStats.perModel }, perKey: { ...(geminiStats.perKey || {}) } };
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
            id: { type: Type.INTEGER, description: 'Sequential question id starting at 1 (NO reuse, strictly increasing).' },
            pregunta: { type: Type.STRING, description: 'Clean question statement WITHOUT leading number or word Número.' },
            opciones: { type: Type.OBJECT, description: 'Map of options. Keys MUST be contiguous capital letters starting at A. Values are option texts (trimmed).', properties: { A: { type: Type.STRING } }, additionalProperties: { type: Type.STRING } },
            meta: { type: Type.OBJECT, properties: { multi: { type: Type.BOOLEAN }, negative: { type: Type.BOOLEAN }, assertionReason: { type: Type.BOOLEAN }, matching: { type: Type.BOOLEAN } }, required: [], propertyOrdering: ["multi", "negative", "assertionReason", "matching"], description: 'Optional flags: multi (multiple answers), negative (EXCEPTO/INCORRECTA), assertionReason (Aserción y Razón), matching (column matching). If not applicable omit or set false.' }
        },
        required: ["id", "pregunta", "opciones"],
        propertyOrdering: ["id", "pregunta", "opciones", "meta"],
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
        required: ["id", "pregunta", "opciones"],
        propertyOrdering: ["id", "pregunta", "opciones"],
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
                    respuestas: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Array ordenado de opciones (mínimo 2). El índice 0 corresponde a la opción A.' },
                    imagenDescripcion: { type: Type.STRING, description: 'Si la pregunta hace referencia a una figura, imagen o gráfico (ej: "ver figura 1", "según la imagen"), describe aquí el contenido visual relevante para resolver la pregunta. Dejar vacío si no hay imagen.' }
                },
                required: ['enunciado', 'respuestas'],
                propertyOrdering: ['enunciado', 'respuestas', 'imagenDescripcion']
            },
            description: 'Lista de preguntas extraídas.'
        }
    },
    required: ['preguntas'],
    propertyOrdering: ['titulo', 'preguntas']
};

export interface ExtractionWithTitle { questions: Question[]; title?: string }

export const extractQuestionsFromText = async (text: string): Promise<ExtractionWithTitle> => {
    const plano = await extraerPreguntasPlano(text);
    return { questions: plainToQuestions(plano.preguntas), title: plano.titulo };
};

// NUEVA FUNCIÓN: devuelve el formato pedido por el usuario { preguntas: [ { enunciado, respuestas[] } ] }
// Además reutiliza internamente la lógica de limpieza para mejorar segmentación.
export interface PreguntaPlano { enunciado: string; respuestas: string[]; imagenDescripcion?: string }
export interface PreguntasPlanoResult { preguntas: PreguntaPlano[]; titulo?: string }

export const extraerPreguntasPlano = async (texto: string): Promise<PreguntasPlanoResult> => {
    const basePrompt = (instruccionesExtra = '') => `EXTRACCIÓN ESTRUCTURA SIMPLE\nAnaliza el siguiente texto y extrae TODAS las preguntas tipo test.\nReglas clave:\n- No combines varias preguntas en un solo enunciado.\n- Cada pregunta termina antes de que empiece un patrón de nueva numeración (número + ) o letra + paréntesis) o un salto claro de contexto.\n- Elimina numeración inicial del enunciado.\n- Mínimo 2 opciones por pregunta.\n- Genera también un título corto (<=5 palabras) siguiendo el formato: Test <TemaPrincipal> <SubtemaOpcional>. Sin símbolos ni comillas.\n- Devuelve SOLO JSON con el formato: {"titulo":"...","preguntas":[{"enunciado":"...","respuestas":["opción A","opción B", ...]}]}\n- NO incluyas letras (A), (B) dentro del texto de cada respuesta; sólo el contenido limpio.\n- Mantén el orden original A,B,C,...\n${instruccionesExtra}\nTexto:\n-----\n${texto}\n-----`;
    const models = ['gemini-3-flash-preview', 'gemini-2.5-flash-lite'];
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
                enunciado = enunciado.replace(/^(?:\d+|\([A-Z]\)|[A-Z]\))\s*[).:-]?\s*/, '').trim();
                const respuestasRaw: string[] = Array.isArray(p.respuestas) ? p.respuestas : [];
                const respuestas = respuestasRaw.map(r => String(r).trim().replace(/^[A-Z]\)?\s*/, '')).filter(r => r.length > 0);
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

// ========== PRE-ANÁLISIS DE PDF CON FLASH LITE ==========
// Analiza el PDF para crear un "mapa de trabajo" con anclas de texto reales

const globalAnalysisSchemaGeminiFixed = {
    type: Type.OBJECT,
    properties: {
        t: { type: Type.STRING, description: 'Título del examen' },
        annex_file_index: { type: Type.INTEGER, description: 'Índice del archivo que contiene los anexos/imágenes (normalmente el último o el mismo que el texto).' },
        annex_start_page: { type: Type.INTEGER, description: 'Página donde empiezan las imágenes en ese archivo. 0 si no hay.' },
        c: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    file_index: { type: Type.INTEGER, description: 'Índice del archivo (0 para el primero, 1 para el segundo, etc).' },
                    r_start: { type: Type.INTEGER, description: 'ID de la primera pregunta del bloque.' },
                    r_end: { type: Type.INTEGER, description: 'ID de la última pregunta del bloque.' },
                    p: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: 'Lista o RANGO [inicio, fin] de páginas físicas.' },
                },
                required: ['file_index', 'r_start', 'r_end', 'p']
            }
        }
    },
    required: ['c']
};

export const preAnalyzeGlobal = async (parts: any[], pIdx?: number): Promise<GlobalAnalysisResult | null> => {
    const MODEL = 'gemini-2.5-flash-lite';
    const keyIdx = pIdx !== undefined ? pIdx : pickKeyIndex();
    const client = concurrentClients[keyIdx];

    console.log(`[PreAnalysis] Iniciando análisis GLOBAL con clave #${keyIdx}...`);
    try {
        const response: any = await client.models.generateContent({
            model: MODEL,
            contents: [...parts, { text: GLOBAL_PRE_ANALYSIS_PROMPT }],
            config: { responseMimeType: 'application/json', responseSchema: globalAnalysisSchemaGeminiFixed }
        });
        return JSON.parse(response.text) as any;
    } catch (err) {
        console.warn('[PreAnalysis] Fallo análisis global:', err);
        return null;
    }
};

// ========== PARALELIZACIÓN Y DISTRIBUCIÓN ==========


// NUEVO: Función genérica para extracción PARALELA por lotes (máxima velocidad)
async function iterativeExtractionBatch(
    parts: any[],
    operationLabelPrefix: string,
    pIdx?: number
): Promise<ExtractionWithTitle> {
    const BATCH_SIZE = 50; // 50 preguntas por lote (más manejable para el modelo)
    const MAX_PARALLEL_WORKERS = Math.min(geminiKeys.length * 2, 8); // 2 tareas por clave, máximo 8 workers
    const MAX_TOTAL_QUESTIONS = 300; // Límite de seguridad

    const allQuestions: Question[] = [];
    let finalTitle: string | undefined = undefined;
    // EXTRACCIÓN: Siempre usar 2.5-flash-lite (rápido, sin thinking, alta cuota)
    const EXTRACTION_MODEL = 'gemini-2.5-flash-lite';

    console.log(`[ParallelExtract] Iniciando extracción con lotes de ${BATCH_SIZE} preguntas...`);
    const startTime = Date.now();

    // IMPORTANTE: Usar UNA SOLA clave para toda la operación (evita 403 en File API)
    // Usamos pIdx si fue proporcionado, o pickKeyIndex() para obtener un índice fijo
    const pinnedKeyIndex = pIdx !== undefined ? pIdx : pickKeyIndex();
    const pinnedClient = concurrentClients[pinnedKeyIndex];

    console.log(`[ParallelExtract] Usando clave fija #${pinnedKeyIndex} para toda la extracción.`);

    // Fase 1: Extracción inicial para determinar el título y primeras preguntas
    try {
        const initialPrompt = `EXTRACCIÓN MCQ COMPLETA - PRIMERA PARTE
Extrae las PRIMERAS ${BATCH_SIZE} preguntas del documento.
REGLAS:
- Formato JSON: {"titulo":"...", "preguntas":[{"id":1, "enunciado":"...", "respuestas":["A)...", "B)...", ...]}]}
- Genera un título corto (máx 5 palabras) siguiendo: Test <Tema> <Subtema>
- IDs empiezan en 1
- Si hay MENOS de ${BATCH_SIZE} preguntas, extrae todas las que haya`;

        const response: any = await pinnedClient.models.generateContent({
            model: EXTRACTION_MODEL,
            contents: [...parts, { text: initialPrompt }],
            config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema }
        });

        const parsed = JSON.parse(response.text);
        const batchRaw = Array.isArray(parsed.preguntas) ? parsed.preguntas : [];
        const batchQuestions = plainToQuestions(batchRaw);
        batchQuestions.forEach((q, i) => { q.id = i + 1; });
        allQuestions.push(...batchQuestions);
        if (parsed.titulo) finalTitle = String(parsed.titulo).trim();

        // Si obtuvimos menos de BATCH_SIZE, probablemente ya terminamos
        if (batchQuestions.length < BATCH_SIZE * 0.8) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[ParallelExtract] Completado en ${elapsed}s. ${allQuestions.length} preguntas extraídas.`);
            return { questions: allQuestions, title: finalTitle };
        }
    } catch (err) {
        console.error('[ParallelExtract] Error en extracción inicial:', err);
        throw err;
    }

    // Fase 2: Extracción secuencial de rangos adicionales (con la MISMA clave)
    // NOTA: No podemos paralelizar con diferentes claves porque el archivo es privado a pinnedClient
    const extractRange = async (startFrom: number): Promise<Question[]> => {
        try {
            const rangePrompt = `EXTRACCIÓN MCQ - CONTINUACIÓN
Ya hemos extraído ${startFrom - 1} preguntas (IDs 1 a ${startFrom - 1}).
Extrae las SIGUIENTES ${BATCH_SIZE} preguntas (empezando desde la pregunta número ${startFrom}).
REGLAS:
- IDs deben continuar desde ${startFrom}
- Formato JSON: {"preguntas":[{"id":${startFrom}, "enunciado":"...", "respuestas":["..."]}]}
- Si NO quedan más preguntas, devuelve {"preguntas":[]}`;

            const response: any = await pinnedClient.models.generateContent({
                model: EXTRACTION_MODEL,
                contents: [...parts, { text: rangePrompt }],
                config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema }
            });

            const parsed = JSON.parse(response.text);
            const batchRaw = Array.isArray(parsed.preguntas) ? parsed.preguntas : [];
            const batchQuestions = plainToQuestions(batchRaw);
            batchQuestions.forEach((q, i) => { q.id = startFrom + i; });
            return batchQuestions;
        } catch (err: any) {
            console.warn(`[ParallelExtract] Error extrayendo rango desde ${startFrom}:`, err);
            return [];
        }
    };

    // Extraer rangos adicionales secuencialmente (usando la misma clave)
    let currentStart = allQuestions.length + 1;
    let consecutiveEmpty = 0;

    while (currentStart <= MAX_TOTAL_QUESTIONS && consecutiveEmpty < 2) {
        const batchQuestions = await extractRange(currentStart);

        if (batchQuestions.length === 0) {
            consecutiveEmpty++;
        } else {
            allQuestions.push(...batchQuestions);
            consecutiveEmpty = 0;
        }

        currentStart += BATCH_SIZE;
    }

    // Ordenar y re-numerar IDs para garantizar secuencia correcta
    allQuestions.sort((a, b) => a.id - b.id);
    allQuestions.forEach((q, i) => { q.id = i + 1; });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ParallelExtract] Completado en ${elapsed}s. ${allQuestions.length} preguntas extraídas con ${MAX_PARALLEL_WORKERS} workers.`);

    return { questions: allQuestions, title: finalTitle };
}

export const extractQuestionsFromFile = async (dataUrl: string): Promise<ExtractionWithTitle> => {
    const m = dataUrl.match(/^data:(.+?);base64,(.+)$/); if (!m) throw new Error('Format data URL inválido');
    const mimeType = m[1]; const base64Data = m[2];
    const part = { inlineData: { mimeType, data: base64Data } };
    const pIdx = pickKeyIndex();
    return await iterativeExtractionBatch([part], 'extract-file-iterative', pIdx);
};

// Utilidades de post-procesado
function postProcessExtraction(raw: any): Question[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((q: any, idx: number) => {
        const id = typeof q.id === 'number' ? q.id : idx + 1;
        let pregunta = String(q.pregunta || '').trim().replace(/^(?:n[úu]mero|numero|pregunta)\s+\d+[\.):]?\s*/i, '').trim();
        const opcionesObj = q.opciones && typeof q.opciones === 'object' ? q.opciones : {};
        const vals = Object.values(opcionesObj).map(v => String(v).trim()).filter(Boolean);
        const opciones: Record<string, string> = {};
        vals.forEach((v, i) => opciones[String.fromCharCode(65 + i)] = v);
        return { id, pregunta, opciones, meta: deriveMeta(pregunta) } as Question;
    }).filter(q => q.pregunta && Object.keys(q.opciones).length >= 2);
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

// Helper para expandir rangos de páginas (ej: [3, 10] -> [2, 3, 4, 5, 6, 7, 8, 9] en base 0)
function getPageIndices(p: number[]): number[] {
    if (!p || p.length === 0) return [];
    // Si solo hay un número, devolvemos ese índice (base 0)
    if (p.length === 1) return [p[0] - 1];

    // Si hay 2 números y parecen un rango (el segundo es mayor), expandimos
    const start = p[0];
    const end = p[p.length - 1];
    if (end > start) {
        // Crear array con todos los números intermedios
        // Restamos 1 porque pdf-lib usa base 0, pero el modelo nos da base 1
        return Array.from({ length: (end - start) + 1 }, (_, i) => (start + i) - 1);
    }

    // Fallback: si es una lista desordenada, solo restamos 1 a cada uno
    return p.map(n => n - 1);
}

function normalizeQuestionsArray(parsedJson: any): Question[] {
    if (Array.isArray(parsedJson)) {
        parsedJson.forEach((q: any, idx: number) => {
            if (typeof q.id !== 'number') q.id = idx + 1;
            if (!q.meta) q.meta = {};
            ['multi', 'negative', 'assertionReason', 'matching'].forEach(k => { if (q.meta[k] === undefined) q.meta[k] = false; });
            if (q.opciones) {
                const vals = Object.values(q.opciones);
                const remapped: Record<string, string> = {};
                vals.forEach((v, i) => { remapped[String.fromCharCode(65 + i)] = String(v); });
                q.opciones = remapped;
            }
        });
    }
    return parsedJson as Question[];
}

export const extractQuestionsFromMixed = async (
    text: string,
    files: SourceFileInput[]
): Promise<ExtractionWithTitle> => {
    const trimmed = (text || '').trim();
    if (!files?.length && !trimmed) return { questions: [] };

    console.log(`[MixedExtract] Preparando ${files.length} archivos para análisis...`);
    const pIdx = pickKeyIndex();
    const pinnedClient = concurrentClients[pIdx];

    // 1. Preparar Parts para Análisis Global
    const analysisParts: any[] = [];
    const uploadedFileNames: string[] = [];

    for (const [idx, f] of files.entries()) {
        // Etiquetamos visualmente para que el modelo sepa cuál es el índice 0, 1, etc.
        analysisParts.push({ text: `[ARCHIVO ÍNDICE ${idx}]: ${f.displayName || 'Documento principal'}` });

        const bytes = estimateBytesFromBase64(f.base64);
        if (bytes < MAX_INLINE_BYTES) {
            analysisParts.push({ inlineData: { mimeType: f.mimeType, data: f.base64 } });
        } else {
            const name = `file_${Date.now()}_${idx}`;
            const blob = base64ToBlob(f.base64, f.mimeType);
            const uploaded: any = await withRetry(() =>
                pinnedClient.files.upload({ file: blob, config: { displayName: name } }),
                'upload-analysis', undefined, pIdx
            );

            let fileInfo = uploaded;
            while (fileInfo.state === 'PROCESSING') {
                await delay(1000);
                fileInfo = await pinnedClient.files.get({ name: uploaded.name });
            }
            uploadedFileNames.push(uploaded.name);
            analysisParts.push(createPartFromUri(uploaded.uri, uploaded.mimeType));
        }
    }

    if (trimmed) analysisParts.push({ text: `CONTEXTO TEXTO ADICIONAL:\n${trimmed}` });

    try {
        // 2. Pre-Análisis Global (VERSIÓN ESTRICTA)
        console.log(`[PreAnalysis] Ejecutando análisis estructural de ${files.length} archivos...`);

        const promptAnalysis = `ANALIZA LOS ${files.length} ARCHIVOS ADJUNTOS.
        
        Objetivo: Crear un mapa preciso para extraer las 210 preguntas del examen MEDICINA.
        
        1. Identifica el título.
        2. Detecta ANEXOS (Imágenes): Indica en 'annex_file_index' qué archivo las tiene y en 'annex_start_page' en qué página empiezan.
        
        3. Divide las preguntas en bloques de ~30-40 preguntas. Para cada bloque genera un objeto en la lista 'c':
           - 'file_index': Índice del archivo donde leer (0, 1, etc).
           - 'r_start' / 'r_end': Primera y última pregunta del bloque.
           - 'p': ARRAY EXACTO de las páginas físicas que contienen SOLO esas preguntas.
             EJEMPLO: Si las preguntas 1-30 están en las páginas 3, 4, 5 y 6, pon "p": [3, 4, 5, 6]. 
             NO pongas [3, ..., 30]. Sé preciso y quirúrgico.
             
        IMPORTANTE: Cubre desde la pregunta 1 hasta la 210 sin huecos.`;

        const response: any = await withRetry(() => pinnedClient.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [...analysisParts, { text: promptAnalysis }],
            config: {
                responseMimeType: 'application/json',
                responseSchema: globalAnalysisSchemaGeminiFixed
            }
        }), 'pre-analysis', 'gemini-2.5-flash-lite', pIdx);

        const globalMap = JSON.parse(response.text);

        for (const fileName of uploadedFileNames) {
            try { await pinnedClient.files.delete({ name: fileName }); } catch { }
        }

        if (!globalMap || !globalMap.c || !globalMap.c.length) {
            throw new Error("Fallo en mapa global");
        }

        // 3. Estrategia de Anexos (Imágenes)
        let annexPart: any = null;
        const annexFileIdx = globalMap.annex_file_index ?? (files.length - 1); // Por defecto el último archivo
        const annexStartPage = globalMap.annex_start_page ?? 0;

        if (annexStartPage > 0 && files[annexFileIdx] && files[annexFileIdx].mimeType === 'application/pdf') {
            const annexFile = files[annexFileIdx];
            const totalPages = await getPdfPageCount(base64ToUint8(annexFile.base64));

            if (annexStartPage <= totalPages) {
                const annexIndices = Array.from(
                    { length: (totalPages - annexStartPage) + 1 },
                    (_, i) => (annexStartPage + i) - 1
                );

                console.log(`[MixedExtract] Anexos en archivo ${annexFileIdx}, páginas ${annexIndices.map(x => x + 1).join(',')}.`);

                const annexBytes = await slicePdf(base64ToUint8(annexFile.base64), annexIndices);
                annexPart = {
                    inlineData: {
                        mimeType: 'application/pdf',
                        data: uint8ToBase64(annexBytes)
                    }
                };
            }
        }

        // 4. Extracción Paralela con SUB-LOTES
        const extractionTasks = globalMap.c.map(async (chunk: any, chunkIdx: number) => {
            const fileIdx = (files[chunk.file_index]) ? chunk.file_index : 0;
            const sourceFile = files[fileIdx];

            if (!sourceFile) return [];

            const startQ = chunk.r_start;
            const endQ = chunk.r_end;

            if (!startQ || !endQ || endQ < startQ) return [];

            // A) Preparar el PDF recortado para este bloque
            let contextPart: any;
            if (sourceFile.mimeType === 'application/pdf') {
                const pageIndices = getPageIndices(chunk.p);
                try {
                    // Límite de seguridad: no enviar más de 20 páginas por trozo para evitar 413
                    const safeIndices = pageIndices.slice(0, 20);
                    const pdfSubset = await slicePdf(base64ToUint8(sourceFile.base64), safeIndices);
                    contextPart = {
                        inlineData: {
                            mimeType: 'application/pdf',
                            data: uint8ToBase64(pdfSubset)
                        }
                    };
                } catch (e) {
                    contextPart = { text: `Error slicing PDF en bloque ${startQ}-${endQ}` };
                }
            } else {
                contextPart = { inlineData: { mimeType: sourceFile.mimeType, data: sourceFile.base64 } };
            }

            // B) Sub-lotes de 20 preguntas
            const subBatches = [];
            for (let q = startQ; q <= endQ; q += 20) {
                subBatches.push([q, Math.min(q + 19, endQ)]);
            }

            const chunkQuestions: Question[] = [];

            for (const [subStart, subEnd] of subBatches) {
                const prompt = `EXTRAE PREGUNTAS DEL RANGO ${subStart} A ${subEnd}.
                - El primer documento adjunto contiene el TEXTO de las preguntas.
                - El segundo documento (si existe) contiene las IMÁGENES/ANEXOS referenciados.
                - Si una pregunta dice "ver imagen X", BUSCA esa imagen en el anexo y describe brevemente lo que ves en el campo 'imagenDescripcion'.
                - Formato JSON estricto.`;

                const chunkPayload = [contextPart];
                if (annexPart) {
                    chunkPayload.push({ text: "REFERENCIA VISUAL (ANEXO DE IMÁGENES):" });
                    chunkPayload.push(annexPart);
                }

                const keyIdx = (chunkIdx + subStart) % geminiKeys.length;
                const client = concurrentClients[keyIdx];

                try {
                    const resp: any = await withRetry(() => client.models.generateContent({
                        model: 'gemini-2.5-flash-lite',
                        contents: [...chunkPayload, { text: prompt }],
                        config: { responseMimeType: 'application/json', responseSchema: plainExtractionSchema }
                    }), `extract-subchunk-${subStart}`, 'gemini-2.5-flash-lite', keyIdx);

                    const parsed = JSON.parse(resp.text);
                    const qs = plainToQuestions(parsed.preguntas || []);
                    // Ajustamos IDs si el modelo no los devolvió correctamente
                    qs.forEach((q, i) => {
                        if (typeof q.id !== 'number' || q.id < subStart || q.id > subEnd) {
                            q.id = subStart + i;
                        }
                    });
                    chunkQuestions.push(...qs);
                } catch (e) {
                    console.error(`[Chunk ${chunkIdx}] Error en sub-lote ${subStart}-${subEnd}:`, e);
                }
            }

            return chunkQuestions;
        });

        const results = await Promise.all(extractionTasks);
        const allQuestions = results.flat().sort((a, b) => a.id - b.id);

        // Limpieza final de duplicados y re-numeración
        const uniqueQuestions: Question[] = [];
        const seenIds = new Set<number>();
        for (const q of allQuestions) {
            if (!seenIds.has(q.id)) {
                uniqueQuestions.push(q);
                seenIds.add(q.id);
            }
        }

        uniqueQuestions.forEach((q, i) => q.id = i + 1);

        return { questions: uniqueQuestions, title: globalMap.t };

    } catch (error) {
        console.error("[MixedExtract] Error fatal, intentando fallback iterativo...", error);
        return iterativeExtractionBatch(analysisParts, 'fallback-error', pIdx);
    }
};

export const extractQuestionsFromFiles = async (files: SourceFileInput[]): Promise<ExtractionWithTitle> => {
    return extractQuestionsFromMixed('', files);
};


// Helpers de conversión base64
function base64ToUint8(base64: string): Uint8Array {
    const binary = typeof atob !== 'undefined' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
    if (typeof btoa !== 'undefined') {
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    return Buffer.from(bytes).toString('base64');
}

// Conversión plano -> formato interno Question
function plainToQuestions(pregs: PreguntaPlano[]): Question[] {
    return pregs.map((p, idx) => {
        const opciones: Record<string, string> = {};
        p.respuestas.forEach((r, i) => opciones[String.fromCharCode(65 + i)] = r);
        const q: Question = { id: idx + 1, pregunta: p.enunciado, opciones, meta: deriveMeta(p.enunciado) };
        if (p.imagenDescripcion && p.imagenDescripcion.trim()) {
            q.imagenDescripcion = p.imagenDescripcion.trim();
        }
        return q;
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
        const opts = Object.entries(q.opciones).map(([k, v]) => `${k}) ${v}`).join('\n');
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
            const mapping: Record<string, string> = {};
            shuffled.forEach((k, i) => mapping[String.fromCharCode(65 + i)] = q.opciones[k]);
            return { original: q, transformed: { id: q.id, pregunta: q.pregunta, opciones: mapping }, reverse: Object.fromEntries(shuffled.map((orig, i) => [String.fromCharCode(65 + i), orig])) };
        });
        const serializedLocal = transformed.map(t => {
            const opts = Object.entries(t.transformed.opciones).map(([k, v]) => `${k}) ${v}`).join('\n');
            return `QID:${t.transformed.id}\n${t.transformed.pregunta}\n${opts}`;
        }).join('\n\n===\n\n');
        const promptLocal = `${header}\n\n${serializedLocal}\n\nRecuerda: SOLO líneas "QID:<id> <LETRA>".`;
        const response: any = await withRetry(() => ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: promptLocal, config: buildModelConfig('gemini-3-flash-preview') }), `batch-solve-${strategyKey}`, 'gemini-3-flash-preview');
        const text = (response.text || '').trim();
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const answers: Record<number, string> = {};
        for (const line of lines) {
            const match = line.match(/^QID:(\d+)\s+([A-Z])/i);
            if (match) {
                const qid = parseInt(match[1], 10);
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

    const response: any = await withRetry(() => ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: buildModelConfig('gemini-3-flash-preview') }), `batch-solve-${strategyKey}`, 'gemini-3-flash-preview');
    const text = (response.text || '').trim();

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const answers: Record<number, string> = {};
    const validLetters = /^[A-Z]$/;
    for (const line of lines) {
        const match = line.match(/^QID:(\d+)\s+([A-Z])/i);
        if (match) {
            const qid = parseInt(match[1], 10);
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

    switch (strategyKey) {
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

    const response: any = await withRetry(() => ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { ...buildModelConfig('gemini-3-flash-preview'), ...config } }), `solve-${strategyKey}`, 'gemini-3-flash-preview');
    const answer = (response.text || '').trim().toUpperCase().charAt(0);
    console.log(`[${strategyKey}] solved question ${question.id}. Chose: ${answer}.`);

    if (!geminiStats.perStrategy[strategyKey]) geminiStats.perStrategy[strategyKey] = 0;
    geminiStats.perStrategy[strategyKey]++;

    if (Object.keys(question.opciones).includes(answer)) return answer;
    console.warn(`[${strategyKey}] returned an invalid option '${answer}'. Falling back.`);
    return Object.keys(question.opciones)[0];
};

// ---- NUEVO: Resolver preguntas en paralelo usando todas las claves disponibles ----
interface ParallelSolveOptions {
    model?: string;
    onProgress?: (completed: number, total: number, answers: Record<number, string>) => void;
}

export const parallelSolveQuestions = async (
    questions: Question[],
    options?: ParallelSolveOptions
): Promise<Record<number, string>> => {
    if (questions.length === 0) return {};

    const model = options?.model || 'gemini-3-flash-preview';
    const answers: Record<number, string> = {};
    let completed = 0;

    console.log(`[ParallelSolve] Iniciando resolución paralela de ${questions.length} preguntas con ${keySlotPool.getTotalCount()} claves...`);
    const startTime = Date.now();

    // Función para resolver una pregunta individual con una clave dedicada
    const solveOne = async (question: Question): Promise<{ id: number; answer: string }> => {
        const slot = await keySlotPool.acquire();
        try {
            const optionsString = Object.entries(question.opciones)
                .map(([key, value]) => `${key}) ${value}`)
                .join('\\n');

            // Incluir contexto de imagen si existe
            let imageContext = '';
            if (question.imagenDescripcion) {
                imageContext = `\\n\\n[IMAGEN ADJUNTA]: ${question.imagenDescripcion}`;
            }

            const prompt = `Solve the following MCQ. Respond ONLY with the capital letter of the correct option.\\n\\nQuestion: ${question.pregunta}${imageContext}\\n\\nOptions:\\n${optionsString}\\n\\nAnswer:`;

            const response: any = await slot.client.models.generateContent({
                model,
                contents: prompt,
                config: buildModelConfig(model)
            });

            const rawAnswer = (response.text || '').trim().toUpperCase().charAt(0);
            const validKeys = Object.keys(question.opciones);
            const answer = validKeys.includes(rawAnswer) ? rawAnswer : validKeys[0];

            keySlotPool.release(slot.slotIndex);
            return { id: question.id, answer };
        } catch (err: any) {
            const status = err?.error?.status || err?.status || err?.code;
            const isRateLimit = status === 429 || status === 'RESOURCE_EXHAUSTED';

            if (isRateLimit) {
                // Cooldown de 10 segundos para esta clave
                keySlotPool.setCooldown(slot.slotIndex, 10000);
                console.warn(`[ParallelSolve] Clave ${slot.keyIndex} en cooldown (rate limit)`);
            } else {
                keySlotPool.release(slot.slotIndex);
            }

            // Fallback a primera opción
            const fallback = Object.keys(question.opciones)[0];
            return { id: question.id, answer: fallback };
        }
    };

    // Lanzar todas las preguntas en paralelo
    const promises = questions.map(q => solveOne(q).then(result => {
        answers[result.id] = result.answer;
        completed++;
        if (options?.onProgress) {
            options.onProgress(completed, questions.length, { ...answers });
        }
        return result;
    }));

    await Promise.allSettled(promises);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[ParallelSolve] Completado en ${elapsed}s. ${questions.length} preguntas resueltas.`);

    geminiStats.apiRequests += questions.length;

    return answers;
};

// Nuevo: función para lanzar varias rondas por diferentes modelos y fusionar votos
type PartialUpdate = { modelKey: string; iteration: number; answers: Record<number, string>; };
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
                            const optsStr = Object.entries(q.opciones).map(([k, v]) => `${k}) ${v}`).join('\n');
                            return `QID:${q.id}\n${q.pregunta}\n${optsStr}`;
                        }).join('\n\n===\n\n');
                        const prompt = `Responde cada pregunta devolviendo SOLO lineas "QID:<id> <LETRA>".\n\n${serialized}`;
                        const useReasoning = i >= halfNoReason; // segunda mitad con reasoning
                        try {
                            const response: any = await withRetryConcurrent(c => c.models.generateContent({ model: cfg.model, contents: prompt, config: useReasoning ? buildModelConfig(cfg.model, questions.length) : {} }), `mm-batch-conc-${strategyKey}-${cfg.key}`, cfg.model);
                            const text = (response.text || '').trim();
                            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                            const partialAnswers: Record<number, string> = {};
                            const seen: Set<number> = new Set();
                            for (const line of lines) {
                                const m = line.match(/^QID:(\d+)\s+([A-Z])/i);
                                if (m) {
                                    const qid = parseInt(m[1], 10); const letter = m[2].toUpperCase();
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
                                    votes.forEach(v => counts[v] = (counts[v] || 0) + 1);
                                    const max = Math.max(...Object.values(counts));
                                    const conf = (max / votes.length) * 100;
                                    if (conf < threshold) { allReached = false; break; }
                                }
                                if (allReached) {
                                    // Cancelar tareas restantes descartando iteraciones futuras
                                    tasks.length = 0; // vaciamos cola
                                }
                            }
                        } catch (e: any) {
                            console.warn('[multiModel][conc] fallo', cfg.model, e);
                            // En fallo total: asignar fallback a todas las preguntas de esta iteración
                            const partialAnswers: Record<number, string> = {};
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
        const finalConcurrent: Record<number, string[]> = {};
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
                const opts = Object.entries(q.opciones).map(([k, v]) => `${k}) ${v}`).join('\n');
                return `QID:${q.id}\n${q.pregunta}\n${opts}`;
            }).join('\n\n===\n\n');
            const prompt = `Responde cada pregunta devolviendo SOLO lineas "QID:<id> <LETRA>".\n\n${serialized}`;
            const useReasoning = i >= halfNoReason;
            try {
                const response: any = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents: prompt, config: useReasoning ? buildModelConfig(cfg.model, questions.length) : {} }), `mm-batch-${strategyKey}-${cfg.key}`, cfg.model);
                const text = (response.text || '').trim();
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                const partialAnswers: Record<number, string> = {};
                for (const line of lines) {
                    const m = line.match(/^QID:(\d+)\s+([A-Z])/i);
                    if (m) {
                        const qid = parseInt(m[1], 10); const letter = m[2].toUpperCase();
                        if (answersAggregate[qid]) answersAggregate[qid].push(letter);
                        if (perModelAnswers[cfg.key] && perModelAnswers[cfg.key][qid]) perModelAnswers[cfg.key][qid].push(letter);
                        partialAnswers[qid] = letter;
                    }
                }
                if (onPartial) onPartial({ modelKey: cfg.key, iteration: i + 1, answers: partialAnswers });
            } catch (e: any) {
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
                        const partialAnswers: Record<number, string> = {};
                        for (const line of lines2) {
                            const m = line.match(/^QID:(\d+)\s+([A-Z])/i);
                            if (m) {
                                const qid = parseInt(m[1], 10); const letter = m[2].toUpperCase();
                                if (answersAggregate[qid]) answersAggregate[qid].push(letter);
                                if (perModelAnswers[cfg.key] && perModelAnswers[cfg.key][qid]) perModelAnswers[cfg.key][qid].push(letter);
                                partialAnswers[qid] = letter;
                            }
                        }
                        if (onPartial) onPartial({ modelKey: cfg.key, iteration: i + 1, answers: partialAnswers });
                    } catch (_) { }
                    break; // salir de bucle de llamadas para este modelo
                } else {
                    break; // otros errores: no insistir
                }
            }
        }
    }
    // Devolver array de votos crudo para cómputo posterior en la UI
    const final: Record<number, string[]> = {};
    for (const [idStr, arr] of Object.entries(answersAggregate)) final[Number(idStr)] = arr.length ? arr : ['A'];
    (final as any).__perModel = perModelAnswers;
    return final;
};

// ---- Helper de configuración según modelo ----
function buildModelConfig(modelName: string, questionCount?: number): any {
    const cfg = MODEL_CONFIGS.find(m => m.model === modelName);
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
        gLog('info', '[Gemini] Modo PROXY habilitado: las llamadas se enviarán al backend para rotación segura.');
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