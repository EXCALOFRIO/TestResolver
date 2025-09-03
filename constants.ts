import { Strategy, StrategyKey } from './types';

export const STRATEGIES: Strategy[] = [
  {
    key: StrategyKey.BASE,
    name: "Básica",
    description: "Pregunta directa al modelo (rápida).",
    cost: 1,
  },
  {
    key: StrategyKey.PERMUTATION_MIX,
    name: "Permutaciones Mixtas",
    description: "Baraja orden de preguntas y opciones para reducir sesgos.",
    cost: 1,
  },
  {
    key: StrategyKey.PIVOT_LANGUAGE,
    name: "Traducción Interna",
    description: "Traduce mentalmente al inglés y responde la letra final.",
    cost: 1,
  },
  {
    key: StrategyKey.CHAIN_OF_THOUGHT,
    name: "Razonamiento (CoT)",
    description: "Fuerza razonamiento interno antes de responder.",
    cost: 1,
  },
];
