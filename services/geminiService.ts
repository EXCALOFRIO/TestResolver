import { GoogleGenAI, Type } from "@google/genai";
import { Question, StrategyKey, ModelConfig } from '../types';
import { MODEL_CONFIGS } from '../modelConfigs';
import { parseQuestionsHeuristically } from './localParser';

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
const configuredLevel = ((): LogLevel => {
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

// -------- API Key Rotation Logic --------
// Collect keys GEMINI_API_KEY0..9 (flexible) from env.
const allEnvKeys: string[] = typeof process !== 'undefined' && process?.env ? Object.keys(process.env) : Object.keys((import.meta as any)?.env || {});
// Acepta GEMINI_API_KEY, GEMINI_API_KEY0..9 y prefijos VITE_. Además, si el build embebió
// un array global __GEMINI_EMBED_KEYS__ (caso variables sin prefijo en Vercel) lo usamos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __GEMINI_EMBED_KEYS__: any;
let geminiKeys: string[] = allEnvKeys
    .filter(k => /^(VITE_)?GEMINI_API_KEY\d*$/.test(k))
    .sort()
    .map(k => getEnv(k)!)
    .filter(v => !!v);
// Fallback embed (inyección desde vite.config) solo si no se recogieron claves directas
if (typeof __GEMINI_EMBED_KEYS__ !== 'undefined' && Array.isArray(__GEMINI_EMBED_KEYS__) && __GEMINI_EMBED_KEYS__.length && geminiKeys.length === 0) {
    geminiKeys.push(...__GEMINI_EMBED_KEYS__.filter((x: unknown) => typeof x === 'string' && x));
}

const legacyKey = getEnv('API_KEY');
if (geminiKeys.length === 0 && legacyKey) {
    geminiKeys.push(legacyKey);
}
// Fallback adicional: si no hay keys pero existe GEMINI_API_KEY directo
if (geminiKeys.length === 0) {
    const single = getEnv('GEMINI_API_KEY') || getEnv('VITE_GEMINI_API_KEY');
    if (single) geminiKeys.push(single);
}
if (geminiKeys.length === 0) {
    const viteKeys = allEnvKeys.filter(k => /^VITE_GEMINI_API_KEY\d*$/.test(k)).sort().map(k => getEnv(k)!).filter(Boolean);
    if (viteKeys.length) geminiKeys.push(...viteKeys);
}
// Deduplicar y log limpio (evitamos mostrar conteo bruto para no confundir)
geminiKeys = Array.from(new Set(geminiKeys));
gLog('info', `[Gemini] API keys activas: ${geminiKeys.length} | Rotación=${geminiKeys.length > 1 ? 'ON' : 'OFF'}`);

let currentKeyIndex = 0;

const buildClient = () => new GoogleGenAI({ apiKey: geminiKeys[currentKeyIndex] });
let ai = buildClient();
// Pool de clientes para modo concurrente (round-robin)
const concurrentClients: GoogleGenAI[] = geminiKeys.map(k => new GoogleGenAI({ apiKey: k }));
let rrIndex = 0;
const pickClient = () => {
    if (!concurrentClients.length) return ai;
    const c = concurrentClients[rrIndex % concurrentClients.length];
    rrIndex++;
    return c;
};

const rotateKey = () => {
    if (geminiKeys.length <= 1) return false;
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;
    ai = buildClient();
    gLog('debug', `[Gemini] Rotación de clave -> índice activo ${currentKeyIndex}`);
    return true;
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Generic wrapper with retry + rotation on 429
// Rate limiting por modelo: un registro de timestamps por modelName
const modelCallHistory: Record<string, number[]> = {};
const acquireModelSlot = async (model: string) => {
    const cfg = MODEL_CONFIGS.find(m => m.model === model);
    const rpmLimit = cfg?.rpmLimit || 6; // fallback prudente
    if (!modelCallHistory[model]) modelCallHistory[model] = [];
    while (true) {
        const now = Date.now();
        const arr = modelCallHistory[model];
        while (arr.length && now - arr[0] > 60000) arr.shift();
        if (arr.length < rpmLimit) {
            arr.push(now);
            return;
        }
        const waitMs = 60000 - (now - arr[0]) + 150; // buffer
        console.log(`[RateLimit] Esperando ${(waitMs/1000).toFixed(1)}s para modelo ${model} (ventana RPM)`);
        await delay(waitMs);
    }
};

const withRetry = async <T>(fn: () => Promise<T>, operationLabel: string, modelName?: string): Promise<T> => {
    const maxAttempts = geminiKeys.length * 2; // allow 2 attempts per key
    let attempt = 0;
    let backoff = 750; // initial backoff ms
    while (true) {
        try {
            attempt++;
    if (modelName) await acquireModelSlot(modelName);
            geminiStats.apiRequests++;
            if (modelName) geminiStats.perModel[modelName] = (geminiStats.perModel[modelName] || 0) + 1;
            geminiStats.operations[operationLabel] = (geminiStats.operations[operationLabel] || 0) + 1;
            return await fn();
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
            // Non-rate error -> rethrow
            throw err;
        }
    }
};

// Variante para concurrencia mejorada: intenta rotación inmediata por todas las keys antes de hacer backoff
const withRetryConcurrent = async <T>(fnBuilder: (client: GoogleGenAI) => Promise<T>, operationLabel: string, modelName?: string): Promise<T> => {
    const keysCount = Math.max(1, geminiKeys.length);
    const maxCycles = Math.max(2, keysCount * 3); // cada "cycle" = un barrido de keys
    let cycle = 0;
    let backoff = 500;
    while (cycle < maxCycles) {
        cycle++;
        // Barrido rápido de todas las keys disponibles sin esperar (fail-fast ante 429)
        for (let i = 0; i < keysCount; i++) {
            const client = pickClient();
            try {
                if (modelName) await acquireModelSlot(modelName);
                geminiStats.apiRequests++;
                if (modelName) geminiStats.perModel[modelName] = (geminiStats.perModel[modelName] || 0) + 1;
                geminiStats.operations[operationLabel] = (geminiStats.operations[operationLabel] || 0) + 1;
                return await fnBuilder(client);
            } catch (err: any) {
                const status = err?.error?.status || err?.status || err?.code;
                const isRate = status === 429 || status === 'RESOURCE_EXHAUSTED';
                if (isRate) {
                    geminiStats.rateLimitHits++;
                    continue; // probamos siguiente key inmediatamente
                }
                // Error no recuperable -> lanzar
                throw err;
            }
        }
        // Si todas las keys dieron rate limit, aplicamos backoff exponencial y reintentamos otro ciclo
        await delay(backoff);
        backoff = Math.min(backoff * 1.8, 7000);
    }
    throw new Error(`[withRetryConcurrent] Exhausted retries (${maxCycles} cycles) for ${operationLabel}`);
};

// ---------- Stats ----------
export const geminiStats: { apiRequests: number; rotations: number; rateLimitHits: number; operations: Record<string, number>; perStrategy: Record<string, number>; perModel: Record<string, number>; } = {
    apiRequests: 0,
    rotations: 0,
    rateLimitHits: 0,
    operations: {},
    perStrategy: {},
    perModel: {}
};

export const getAndResetGeminiStats = () => {
    const snapshot = { ...geminiStats, operations: { ...geminiStats.operations }, perStrategy: { ...geminiStats.perStrategy }, perModel: { ...geminiStats.perModel } };
    geminiStats.apiRequests = 0;
    geminiStats.rotations = 0;
    geminiStats.rateLimitHits = 0;
    geminiStats.operations = {};
    geminiStats.perStrategy = {};
    geminiStats.perModel = {};
    return snapshot;
};

const questionSchema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.INTEGER,
          description: 'A unique sequential number for the question, starting from 1.',
        },
        pregunta: {
          type: Type.STRING,
          description: 'The text of the question.',
        },
        opciones: {
          type: Type.OBJECT,
          description: 'An object containing the answer options, where keys are "A", "B", "C", etc., and values are the option texts.',
           // HACK: The API requires a non-empty `properties` field for objects.
          // We provide a dummy property 'A' and use `additionalProperties` for the rest.
          // 'A' is not required, so it's fine if it's not present in the output.
          properties: {
              A: { type: Type.STRING }
          },
          additionalProperties: {
              type: Type.STRING
          }
        },
      },
      required: ["id", "pregunta", "opciones"],
    },
};

const singleQuestionSchema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.INTEGER },
        pregunta: { type: Type.STRING },
        opciones: {
            type: Type.OBJECT,
            // HACK: The API requires a non-empty `properties` field for objects.
            properties: {
                A: { type: Type.STRING }
            },
            additionalProperties: {
                type: Type.STRING
            }
        },
    },
    required: ["id", "pregunta", "opciones"],
};

export const extractQuestionsFromImage = async (imageDataBase64: string): Promise<Question[]> => {
    console.log("Calling Gemini API to extract questions from image...");
  
    const base64Data = imageDataBase64.split(',')[1];
    const imagePart = {
        inlineData: {
          mimeType: 'image/jpeg', // Assuming jpeg, can be other types
          data: base64Data,
        },
    };

    const prompt = `Analiza la siguiente imagen que contiene un examen tipo test. Tu tarea es identificar cada pregunta con su enunciado y sus opciones de respuesta (generalmente A, B, C, D...). Extrae toda esta información y devuélvela exclusivamente en formato JSON, sin ningún texto introductorio, explicaciones o comentarios. El JSON debe ser un array de objetos, donde cada objeto representa una pregunta.
      
      Formato de Salida Requerido:
      [
        {
          "id": 1,
          "pregunta": "¿Enunciado de la primera pregunta extraído de la imagen?",
          "opciones": { "A": "Texto de la opción A.", "B": "Texto de la opción B." }
        }
      ]
      
      Asegúrate de que el JSON esté perfectamente formado y listo para ser parseado. Si una parte del texto es ilegible, usa null como valor. Enumera las preguntas secuencialmente empezando por id: 1.`;
      
    const response: any = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, { text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: questionSchema,
        }
    }), 'extract-image');

    try {
        const parsedJson = JSON.parse(response.text);
        console.log("Extraction complete. Parsed questions:", parsedJson);
        return parsedJson;
    } catch (e) {
        console.error("Failed to parse JSON from Gemini response:", response.text, e);
        throw new Error("Could not parse the questions from the image.");
    }
};

export const extractQuestionsFromText = async (text: string): Promise<Question[]> => {
    // First attempt local heuristic parsing to avoid an API call.
    const local = parseQuestionsHeuristically(text);
    if (local.length > 0) {
        console.log(`[LocalParser] Parsed ${local.length} questions without API call.`);
        return local;
    }
    console.log("[Fallback] Calling Gemini API to extract questions from text...");

        const prompt = `Analiza el siguiente texto que contiene un examen tipo test de formato potencialmente heterogéneo. Extrae cada pregunta con:
            - id (secuencial empezando en 1)
            - pregunta (enunciado limpio SIN repetir número)
            - opciones (mapa {"A": "..."}) admitiendo 2 a 10 opciones.
            NO respondas soluciones.

            Detecta además (si aplica) y añade un subobjeto meta con flags booleanos: {"multi":true|false, "negative":true|false, "assertionReason":true|false, "matching":true|false}.
            multi si el enunciado pide seleccionar varias o dice "todas las que". negative si contiene EXCEPTO/NO/INCORRECTA/FALSA. assertionReason si incluye Aserción y Razón. matching si es relación de columnas.
            Devuelve SOLO JSON válido.
      
      Texto a analizar:
      ---
      ${text}
      ---

            Formato de Salida Requerido:
            [
                {
                    "id": 1,
                    "pregunta": "Enunciado limpio...",
                    "opciones": { "A": "Texto opción A", "B": "Texto opción B" },
                    "meta": { "multi": false, "negative": false }
                }
            ]
      
    Asegúrate de que el JSON esté perfectamente formado y listo para ser parseado. Enumera las preguntas secuencialmente empezando por id: 1.`;
      
    const response: any = await withRetry(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: questionSchema,
        }
    }), 'extract-text');

    try {
        const parsedJson = JSON.parse(response.text);
        console.log("Extraction complete. Parsed questions:", parsedJson);
        return parsedJson;
    } catch (e) {
        console.error("Failed to parse JSON from Gemini response:", response.text, e);
        throw new Error("Could not parse the questions from the text.");
    }
};

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
            for (let i = 0; i < maxCalls; i++) {
                const iteration = i + 1;
                tasks.push({
                    run: async () => {
                        const serialized = questions.map(q => {
                            const optsStr = Object.entries(q.opciones).map(([k,v]) => `${k}) ${v}`).join('\n');
                            return `QID:${q.id}\n${q.pregunta}\n${optsStr}`;
                        }).join('\n\n===\n\n');
                        const prompt = `Responde cada pregunta devolviendo SOLO lineas "QID:<id> <LETRA>".\n\n${serialized}`;
                        try {
                            const response: any = await withRetryConcurrent(c => c.models.generateContent({ model: cfg.model, contents: prompt, config: buildModelConfig(cfg.model, questions.length) }), `mm-batch-conc-${strategyKey}-${cfg.key}`, cfg.model);
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
    for (let i = 0; i < maxCalls; i++) {
            // usamos batch prompts independientes por modelo para recolección.
            const serialized = questions.map(q => {
                const opts = Object.entries(q.opciones).map(([k,v]) => `${k}) ${v}`).join('\n');
                return `QID:${q.id}\n${q.pregunta}\n${opts}`;
            }).join('\n\n===\n\n');
            const prompt = `Responde cada pregunta devolviendo SOLO lineas "QID:<id> <LETRA>".\n\n${serialized}`;
            try {
                const response: any = await withRetry(() => ai.models.generateContent({ model: cfg.model, contents: prompt, config: buildModelConfig(cfg.model, questions.length) }), `mm-batch-${strategyKey}-${cfg.key}`, cfg.model);
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
    // Regla dinámica: 8192 por cada bloque (ceil) de 20 preguntas, mínimo 8192.
    const blocks = Math.max(1, Math.ceil((questionCount || 0) / 20));
    const dynamicBudget = 8192 * blocks;
    const baseBudget = cfg.thinkingBudget || 8192;
    // Máximo absoluto 24576
    const budget = Math.min(24576, Math.max(baseBudget, dynamicBudget));
    return { thinkingConfig: { thinkingBudget: budget, includeThoughts: false } };
}