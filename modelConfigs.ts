import { ModelConfig } from './types';

// Configuración inicial de modelos soportados
export const MODEL_CONFIGS: ModelConfig[] = [
  // thinkingMode:
  //  - 'optional': se añade thinkingConfig (razonamiento corto) en la mitad "con razonamiento" de las iteraciones.
  //  - 'required': siempre con thinking.
  //  - 'none': nunca.
  // IMPORTANTE: La extracción de preguntas (texto / archivo) fuerza NO thinking aunque aquí esté 'optional' o 'required'.
  { key: 'flash25lite', model: 'gemini-2.5-flash-lite', nombre: 'Gemini 2.5 Flash Lite', rpmLimit: 15, maxPerTest: 15, enabledByDefault: true, weight: 1, thinkingMode: 'optional', thinkingBudget: 8192 },
  { key: 'flash25', model: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash', rpmLimit: 10, maxPerTest: 10, enabledByDefault: false, weight: 2, thinkingMode: 'optional', thinkingBudget: 8192 },
  { key: 'pro25', model: 'gemini-2.5-pro', nombre: 'Gemini 2.5 Pro', rpmLimit: 5, maxPerTest: 5, enabledByDefault: false, weight: 5, thinkingMode: 'required', thinkingBudget: 8192 }
];

export const getModelConfig = (key: string) => MODEL_CONFIGS.find(m => m.key === key);