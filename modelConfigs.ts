import { ModelConfig } from './types';

// Configuración inicial de modelos soportados
export const MODEL_CONFIGS: ModelConfig[] = [
  // Mantener un único modelo activo por defecto
  { key: 'flash25lite', model: 'gemini-2.5-flash-lite', nombre: 'Gemini 2.5 Flash Lite', rpmLimit: 15, maxPerTest: 15, enabledByDefault: true, thinkingMode: 'optional', thinkingBudget: 8192 },
  // Otros modelos desactivados (se pueden reactivar manualmente)
  { key: 'flash25', model: 'gemini-2.5-flash', nombre: 'Gemini 2.5 Flash', rpmLimit: 10, maxPerTest: 10, enabledByDefault: false, thinkingMode: 'optional', thinkingBudget: 8192 },
  { key: 'pro25', model: 'gemini-2.5-pro', nombre: 'Gemini 2.5 Pro', rpmLimit: 5, maxPerTest: 3, enabledByDefault: false, thinkingMode: 'required', thinkingBudget: 8192 },
  { key: 'flash20', model: 'gemini-2.0-flash', nombre: 'Gemini 2.0 Flash', rpmLimit: 15, maxPerTest: 15, enabledByDefault: false, thinkingMode: 'none', thinkingBudget: 8192 },
  { key: 'flash20lite', model: 'gemini-2.0-flash-lite', nombre: 'Gemini 2.0 Flash Lite', rpmLimit: 30, maxPerTest: 30, enabledByDefault: false, thinkingMode: 'none', thinkingBudget: 8192 },
];

export const getModelConfig = (key: string) => MODEL_CONFIGS.find(m => m.key === key);