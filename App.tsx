import React, { useState, useCallback, useMemo, useRef } from 'react';
import { AppState, Question, ResultsState, StrategyKey } from './types';
import { STRATEGIES } from './constants';
import { extractQuestionsFromFile, extractQuestionsFromText, getAndResetGeminiStats, multiModelBatchSolve } from './services/geminiService';
import { MODEL_CONFIGS } from './modelConfigs';
import { ModelConfigPanel } from './components/ModelConfigPanel';
import { InputArea } from './components/InputArea';
import { ResultsDashboard } from './components/ResultsDashboard';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { GearIcon } from './components/icons/GearIcon';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<ResultsState>({});
  const allStrategies: StrategyKey[] = STRATEGIES.map(s => s.key); // mantenido por compat
  const [activeModels, setActiveModels] = useState<Record<string, boolean>>(() => Object.fromEntries(MODEL_CONFIGS.map(m => [m.key, m.enabledByDefault !== false && m.enabledByDefault !== undefined ? m.enabledByDefault : false])));
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Buffer global para votos en streaming (evita renders excesivos)
  const pendingBatchRef = useRef<Record<number, { letter: string; label: string }[]>>({});
  const flushTimeoutRef = useRef<number | null>(null);
  
  const processTest = useCallback(async (getQuestions: () => Promise<Question[]>) => {
    setError(null);
    setAppState(AppState.PARSING);
    setQuestions([]);
    setResults({});

    try {
        const rawQuestions = await getQuestions();
        // Normalizar claves de opciones a letras para evitar desalineación (ej: '1','2' -> 'A','B')
        const parsedQuestions: Question[] = rawQuestions.map(q => {
          const keys = Object.keys(q.opciones);
          const allLetters = keys.every(k => /^[A-Z]$/.test(k));
          if (allLetters) return q;
          const sorted = [...keys];
          // si son números ordenamos numéricamente
            if (sorted.every(k => /^\d+$/.test(k))) {
              sorted.sort((a,b)=> parseInt(a,10)-parseInt(b,10));
            }
          const mapping: Record<string,string> = {};
          sorted.forEach((orig, idx) => {
            mapping[String.fromCharCode(65+idx)] = (q.opciones as any)[orig];
          });
          return { ...q, opciones: mapping };
        });
        if (!parsedQuestions || parsedQuestions.length === 0) {
            throw new Error("No questions could be extracted.");
        }
        setQuestions(parsedQuestions);

  const initialResults: ResultsState = {};
    const activeModelKeys = MODEL_CONFIGS.filter(m => activeModels[m.key]).map(m => m.key);
    // total esperado = suma de maxPerTest de cada modelo activo
    const totalExpected = MODEL_CONFIGS.filter(m => activeModels[m.key])
      .reduce((acc,m)=> acc + (m.maxPerTest || 0) * (m.weight || 1), 0);
    parsedQuestions.forEach(q => {
      initialResults[q.id] = { votes: {}, isResolved: false, expectedVotes: totalExpected, receivedVotes: 0 };
    });
        setResults(initialResults);
        
        setAppState(AppState.SOLVING);

  // activeModelKeys ya calculado arriba; evitar redeclaración

        // First run batch strategies to drastically cut API calls
        // siempre consumir máximos por modelo
        // Reset buffer antes de iniciar
        pendingBatchRef.current = {};
        const flush = () => {
          setResults(prev => {
            if (!Object.keys(pendingBatchRef.current).length) return prev;
            const next: ResultsState = { ...prev };
            for (const [qidStr, arrRaw] of Object.entries(pendingBatchRef.current)) {
              const arr = arrRaw as { letter: string; label: string }[];
              const qid = Number(qidStr);
              if (!next[qid]) continue;
              const qr: any = { ...next[qid] };
              qr.votes = { ...(qr.votes || {}) };
              let addedWeighted = 0;
              for (let i=0; i<arr.length; i++) {
                const { letter, label } = arr[i];
                if (!qr.votes[letter]) qr.votes[letter] = [];
                (qr.votes[letter] as string[]).push(label);
                // peso por modelo (label formato modelKey:iter)
                if (label === 'fallback') addedWeighted += 1; else {
                  const mk = label.split(':')[0];
                  const cfg = MODEL_CONFIGS.find(m=> m.key === mk);
                  addedWeighted += (cfg?.weight || 1);
                }
              }
              if (addedWeighted) {
                qr.receivedVotes = (qr.receivedVotes || 0) + addedWeighted; // ahora representa votos ponderados acumulados
                let leader=''; let leaderWeighted=-1;
                for (const [opt, list] of Object.entries(qr.votes)) {
                  const w = (list as string[]).reduce((s,l)=> {
                    if (l==='fallback') return s+1;
                    const mk = l.split(':')[0];
                    const cfg = MODEL_CONFIGS.find(m=> m.key === mk);
                    return s + (cfg?.weight || 1);
                  },0);
                  if (w>leaderWeighted) { leaderWeighted = w; leader = opt; }
                }
                qr.finalAnswer = leader || qr.finalAnswer;
                qr.confidence = (leaderWeighted / (qr.expectedVotes || 1)) * 100;
                if ((qr.receivedVotes || 0) >= (qr.expectedVotes || 0)) qr.isResolved = true;
                next[qid] = qr;
              }
            }
            pendingBatchRef.current = {};
            return next;
          });
          if (flushTimeoutRef.current !== null) {
            flushTimeoutRef.current = null;
          }
        };
        const scheduleFlush = () => {
          if (flushTimeoutRef.current !== null) return;
          flushTimeoutRef.current = window.setTimeout(flush, 80);
        };

        const answers = await multiModelBatchSolve(
          parsedQuestions,
          StrategyKey.BASE,
          activeModelKeys,
          ({ answers, modelKey, iteration }) => {
            Object.entries(answers).forEach(([idStr, letter]) => {
              const list = pendingBatchRef.current[idStr] || (pendingBatchRef.current[idStr] = []);
              list.push({ letter, label: `${modelKey || 'm'}:${iteration || 1}` });
            });
            scheduleFlush();
          },
          { concurrent: true }
        );
        // Asegurar flush final
  flush();

        // Finalize: garantizar que cada pregunta alcance expectedVotes añadiendo fallbacks si faltan
        setResults(prev => {
          const newResults = JSON.parse(JSON.stringify(prev));
          for (const q of parsedQuestions) {
            const qr = newResults[q.id]; if (!qr) continue;
            const expected: number = Number(qr.expectedVotes || 0);
            const weightOf = (lab: string): number => {
              if (lab==='fallback') return 1;
              const mk = lab.split(':')[0];
              const cfg = MODEL_CONFIGS.find(m=> m.key === mk);
              return cfg?.weight || 1;
            };
            let currentWeighted: number = Object.values(qr.votes).reduce<number>((acc, list) => {
              const arr = list as string[];
              const w = arr.reduce((s,l)=> s+weightOf(l),0);
              return acc + w;
            }, 0);
            if (expected > 0 && currentWeighted < expected) {
              const optionKeys = Object.keys(q.opciones);
              let i=0; // rellenar con fallbacks peso=1
              while (currentWeighted < expected && i < 10000) {
                const letter = optionKeys[i % optionKeys.length];
                qr.votes[letter] = qr.votes[letter] || [];
                (qr.votes[letter] as string[]).push('fallback');
                currentWeighted += 1; i++;
              }
            }
            qr.receivedVotes = currentWeighted; // reinterpretado como acumulado ponderado
            let leader=''; let leaderWeighted=-1;
            for (const [opt, arr] of Object.entries(qr.votes)) {
              const w = (arr as string[]).reduce((s,l)=> s+weightOf(l),0);
              if (w>leaderWeighted) { leaderWeighted = w; leader = opt; }
            }
            qr.finalAnswer = leader || undefined;
            qr.confidence = (leaderWeighted / (qr.expectedVotes || 1)) * 100;
            if (currentWeighted >= (qr.expectedVotes || 0)) qr.isResolved = true;
          }
          return newResults;
        });
        
  // Log stats (API usage) in terminal
  const stats = getAndResetGeminiStats();
  console.log('[Gemini Usage Summary]', stats);
  setAppState(AppState.RESULTS);

    } catch (err: any) {
        console.error("[ProcessTest] Error completo:", err);
        // Detección de rate limit / cuota
        const status = err?.error?.status || err?.status || err?.code;
        const rawMsg = (err instanceof Error ? err.message : (typeof err === 'string' ? err : '')) || '';
        const isQuota = status === 429 || status === 'RESOURCE_EXHAUSTED' || /quota|exceeded|RESOURCE_EXHAUSTED/i.test(rawMsg);
        if (isQuota) {
          // Intentar extraer delay sugerido del JSON si existe
          let retrySeconds = 20;
          try {
            const detail = err?.error?.details?.find((d: any)=> d['@type']?.includes('RetryInfo'));
            if (detail?.retryDelay) {
              const m = String(detail.retryDelay).match(/(\d+)s/);
              if (m) retrySeconds = parseInt(m[1],10) || retrySeconds;
            }
          } catch {}
          setError(`Límite temporal de la API alcanzado. Espera ~${retrySeconds}s y vuelve a intentarlo. (Se están rotando claves internamente).`);
        } else {
          // Sanitizar mensaje para evitar JSON gigante
          let sanitized = rawMsg.replace(/\s+/g,' ').trim();
          if (sanitized.length > 260) sanitized = sanitized.slice(0,260) + '…';
          if (!sanitized) sanitized = 'Ha ocurrido un error inesperado.';
          setError(sanitized);
        }
        setAppState(AppState.IDLE);
    }
  }, [activeModels]);

  const handleFileSubmit = useCallback((dataUrl: string) => {
    processTest(() => extractQuestionsFromFile(dataUrl));
  }, [processTest]);

  const handleTextSubmit = useCallback((text: string) => {
    processTest(() => extractQuestionsFromText(text));
  }, [processTest]);
  
  const isLoading = useMemo(() => appState === AppState.PARSING || appState === AppState.SOLVING, [appState]);
  
  const resetApp = () => {
    setAppState(AppState.IDLE);
    setQuestions([]);
    setResults({});
    setError(null);
  };

  // Router mínimo: rutas especiales (admin/evals eliminadas)
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    // rutas personalizadas eliminadas en esta rama
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-slate-100 relative overflow-hidden">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]"></div>
      <div className="absolute top-0 left-1/4 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl"></div>
      
      <div className="relative z-10 min-h-screen p-4 sm:p-6 lg:p-8">
  <main className={`container mx-auto max-w-6xl transition-all duration-300 ${menuOpen ? 'pr-0 md:pr-80' : ''}`}>
          <header className="text-center mb-8 lg:mb-12 pt-20">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 flex items-center justify-center gap-3 mb-2">
              <SparklesIcon className="w-10 h-10 lg:w-12 lg:h-12 text-indigo-400" />
              TestResolver
            </h1>
          </header>
        
        {error && (
            <div className="max-w-2xl mx-auto bg-gradient-to-r from-red-500/20 to-pink-500/20 border border-red-500/60 text-red-200 px-6 py-4 rounded-xl mb-8 text-center backdrop-blur-sm shadow-lg">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
                  <span className="font-semibold">Error</span>
                </div>
                {error}
            </div>
        )}

        {appState === AppState.IDLE && (
            <div className="space-y-8">
              <InputArea onFileSubmit={handleFileSubmit} onTextSubmit={handleTextSubmit} isLoading={isLoading}/>
            </div>
        )}
        
        {(appState === AppState.PARSING || appState === AppState.SOLVING) && (
            <div className="text-center py-16">
                <div className="inline-flex items-center justify-center mb-6">
                   <svg className="animate-spin -ml-1 mr-3 h-12 w-12 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                </div>
                <h2 className="text-2xl lg:text-3xl font-bold text-slate-200 mb-4">
                  {appState === AppState.PARSING ? 'Analizando y extrayendo preguntas...' : 'Resolviendo con modelos...'}
                </h2>
                <p className="text-slate-400 text-lg">Por favor espera mientras procesamos tu test...</p>
                <div className="mt-8 flex items-center justify-center gap-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                  <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                </div>
            </div>
        )}

        {questions.length > 0 && (appState === AppState.SOLVING || appState === AppState.RESULTS) && (
           <div className="space-y-8">
             <ResultsDashboard questions={questions} results={results} />
             {appState === AppState.RESULTS && (
                <div className="text-center">
                  <button
                    onClick={resetApp}
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold py-3 px-8 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg shadow-indigo-900/30"
                  >
                    Resolver otro test
                  </button>
                </div>
              )}
           </div>
        )}
        
        {!menuOpen && (
          <button 
            onClick={()=>setMenuOpen(true)} 
            className="fixed top-8 right-6 z-50 group bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white p-3 rounded-full shadow-2xl shadow-indigo-900/40 transition-all duration-300 hover:scale-110 backdrop-blur-sm border border-white/10"
            aria-label="Abrir configuración de modelos"
          >
            <GearIcon className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90" />
          </button>
        )}
        
        {/* Overlay semi-transparente cuando el menú está abierto */}
        {menuOpen && (
          <div 
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30" 
            onClick={() => setMenuOpen(false)}
          />
        )}
        
        <ModelConfigPanel 
          open={menuOpen} 
          onClose={()=>setMenuOpen(false)} 
          activeModels={activeModels} 
          onToggle={(k)=> setActiveModels(p=>({...p,[k]:!p[k]}))} 
        />
        </main>
      </div>
    </div>
  );
};

export default App;
