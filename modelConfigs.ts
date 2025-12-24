import { ModelConfig } from './types';

// Configuración inicial de modelos soportados
export const MODEL_CONFIGS: ModelConfig[] = [
  // thinkingMode:
  //  - 'optional': se añade thinkingConfig en la mitad "con razonamiento" de las iteraciones.
  //  - 'required': siempre con thinking.
  //  - 'none': nunca.
  // IMPORTANTE: La extracción de preguntas usa SIEMPRE gemini-2.5-flash-lite sin thinking.

  // --- Gemini 3.0 (Preview) - RESOLVER ---
  { key: 'flash3', model: 'gemini-3-flash-preview', nombre: 'Gemini 3 Flash', rpmLimit: 10, maxPerTest: 5, enabledByDefault: true, weight: 1, thinkingMode: 'none' },
  { key: 'flash3_thinking', model: 'gemini-3-flash-preview', nombre: 'Gemini 3 Flash (Thinking)', rpmLimit: 5, maxPerTest: 5, enabledByDefault: false, weight: 3, thinkingMode: 'required', thinkingBudget: 8192 },

  // --- Gemini 2.5 (Opcionales) ---
  { key: 'flash25', model: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash', rpmLimit: 15, maxPerTest: 10, enabledByDefault: false, weight: 2, thinkingMode: 'none' },
  { key: 'flash25_thinking', model: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash (Thinking)', rpmLimit: 10, maxPerTest: 10, enabledByDefault: false, weight: 2, thinkingMode: 'required', thinkingBudget: 8192 },

  // --- Gemini 2.5 Flash Lite (SOLO EXTRACCIÓN - oculto en UI) ---
  { key: 'flash25lite', model: 'gemini-2.5-flash-lite', nombre: 'Gemini 2.5 Flash Lite', rpmLimit: 20, maxPerTest: 15, enabledByDefault: false, weight: 1, thinkingMode: 'none', hidden: true }
];

export const getModelConfig = (key: string) => MODEL_CONFIGS.find(m => m.key === key);