
export interface QuestionMeta {
  multi?: boolean;          // multi-respuesta
  negative?: boolean;       // enunciado en negativo / EXCEPTO
  assertionReason?: boolean;// formato Aserción-Razón
  matching?: boolean;       // relación de columnas
}

export interface Question {
  id: number;
  pregunta: string;
  opciones: Record<string, string>;
  meta?: QuestionMeta;      // metadatos heurísticos
}

export enum StrategyKey {
  BASE = "BASE",
  PERMUTATION_MIX = "PERMUTATION_MIX",
  PIVOT_LANGUAGE = "PIVOT_LANGUAGE",
  CHAIN_OF_THOUGHT = "CHAIN_OF_THOUGHT",
}

export interface Strategy {
  key: StrategyKey;
  name: string;
  description: string;
  cost: number; // Represents number of requests
}

export interface Vote {
  strategyKey: StrategyKey;
  answerKey: string;
}

export interface QuestionResult {
  votes: Record<string, string[]>; // e.g., { 'A': ['flash25', 'pro25'] }
  finalAnswer?: string;
  confidence?: number;
  isResolved: boolean;
  expectedVotes?: number; // total esperado = estrategias * iteraciones
  receivedVotes?: number; // votos realmente recibidos (para progreso robusto)
}

// Métricas por iteración para análisis en /admin
export interface IterationStats {
  iteration: number;                // número de vuelta (1..N)
  modelKey: string;                 // modelo
  questionId: number;               // id de pregunta
  distribution: Record<string, number>; // conteo de letras en esa iteración acumulado
  leader?: string;                  // opción líder tras esta iteración
  leaderShare?: number;             // proporción líder / total votos acumulados
  entropy?: number;                 // entropía normalizada (0..1)
  concentration?: number;           // suma de p^2 (1/k .. 1)
}

export interface ConvergenceSeries { [questionId: number]: IterationStats[]; }

// Mapa de respuestas correctas proporcionado por el usuario (id -> letra)
export type AnswerKey = Record<number, string>;

// ---- Nuevo soporte de modelos ----
export interface ModelConfig {
  key: string;            // identificador interno (e.g., 'flash25', 'pro25')
  model: string;          // nombre exacto del modelo para la API
  nombre: string;         // nombre amigable en UI
  rpmLimit: number;       // solicitudes por minuto permitidas
  maxPerTest: number;     // máximo de llamadas por test (por lote) (0 = sin límite específico más allá de rpm)
  enabledByDefault: boolean;
  weight?: number;        // reservado para ponderaciones futuras
  thinkingMode?: 'none' | 'optional' | 'required'; // control granular de thinkingConfig
  thinkingBudget?: number; // override explícito (e.g. 8192)
}

export interface ModelUsageSnapshot {
  key: string;
  calls: number;
}

export type ResultsState = Record<number, QuestionResult>;

export enum AppState {
  IDLE = "IDLE",
  PARSING = "PARSING",
  SOLVING = "SOLVING",
  RESULTS = "RESULTS",
}

// ---- Historial ----
export interface TestRunSummary {
  id: number;
  name: string;
  auto_name: boolean;
  total_questions: number;
  created_at: string;
  share_token?: string | null;
  share_url?: string; // calculado en el front cuando exista token
}
export interface TestRunDetail extends TestRunSummary {
  questions: Question[];
  results: ResultsState;
}
