import React, { useState, useCallback, useMemo } from 'react';
import { AppState, Question, ResultsState, StrategyKey } from './types';
import { STRATEGIES } from './constants';
import { extractQuestionsFromImage, extractQuestionsFromText, getAndResetGeminiStats, multiModelBatchSolve } from './services/geminiService';
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
  
  const processTest = useCallback(async (getQuestions: () => Promise<Question[]>) => {
    setError(null);
    setAppState(AppState.PARSING);
    setQuestions([]);
    setResults({});

    try {
        const parsedQuestions = await getQuestions();
        if (!parsedQuestions || parsedQuestions.length === 0) {
            throw new Error("No questions could be extracted.");
        }
        setQuestions(parsedQuestions);

    const initialResults: ResultsState = {};
  const activeModelKeys = MODEL_CONFIGS.filter(m => activeModels[m.key]).map(m => m.key);
  // total esperado = nº de llamadas agregado (una respuesta por llamada por pregunta)
  const totalExpected = MODEL_CONFIGS.filter(m => activeModels[m.key]).reduce((acc,m)=> acc + Math.max(m.maxPerTest || 0, 0), 0);
    parsedQuestions.forEach(q => {
      initialResults[q.id] = { votes: {}, isResolved: false, expectedVotes: totalExpected };
    });
        setResults(initialResults);
        
        setAppState(AppState.SOLVING);

  // activeModelKeys ya calculado arriba; evitar redeclaración

        // First run batch strategies to drastically cut API calls
        // siempre consumir máximos por modelo
        const answers = await multiModelBatchSolve(
          parsedQuestions,
          StrategyKey.BASE,
          activeModelKeys,
          ({ answers }) => {
            // actualización incremental
            Object.entries(answers).forEach(([idStr, letter]) => {
              const id = Number(idStr);
              setResults(prev => {
                if (!prev[id]) return prev; // guard: si llega id desconocido
                const newResults = JSON.parse(JSON.stringify(prev));
                const qr = newResults[id];
                qr.votes = qr.votes || {}; // guard extra
                if (!qr.votes[letter]) qr.votes[letter] = [];
                qr.votes[letter].push('v');
                // recalcular provisional
                const totalVotes = Object.values(qr.votes).reduce((acc: number, v: any)=> acc + v.length, 0);
                let maxVotes = 0; let leader = '';
                for (const [k,vArr] of Object.entries(qr.votes)) {
                  if ((vArr as string[]).length > maxVotes) { maxVotes = (vArr as string[]).length; leader = k; }
                }
                qr.finalAnswer = leader || undefined;
                qr.confidence = (maxVotes / (qr.expectedVotes || 1)) * 100;
                if (totalVotes === qr.expectedVotes) qr.isResolved = true;
                return newResults;
              });
            });
          },
          { concurrent: true }
        );
        // Al terminar (answers contiene arrays completos) aplicamos consolidación final por si falta algo
        Object.entries(answers).forEach(([idStr, voteList]) => {
          const id = Number(idStr);
          const arr: string[] = Array.isArray(voteList) ? (voteList as any) : [voteList as any];
          setResults(prev => {
            if (!prev[id]) return prev; // guard contra id inexistente
            const newResults = JSON.parse(JSON.stringify(prev));
            const qr = newResults[id];
            qr.votes = qr.votes || {};
            const existingCount = Object.values(qr.votes).reduce<number>((acc, v: any)=> acc + (v as string[]).length, 0);
            if (existingCount < arr.length) {
              const deficit = arr.length - existingCount;
              for (let i=0; i<deficit; i++) {
                const letter = arr[i % arr.length];
                if (!qr.votes[letter]) qr.votes[letter] = [];
                qr.votes[letter].push('v');
              }
            }
            const totalVotes = Object.values(qr.votes).reduce((acc: number, v: any)=> acc + v.length, 0);
            if (totalVotes === qr.expectedVotes) {
              qr.isResolved = true;
              let maxVotes = 0; let finalAnswer = '';
              for (const [k,vArr] of Object.entries(qr.votes)) {
                if ((vArr as string[]).length > maxVotes) { maxVotes = (vArr as string[]).length; finalAnswer = k; }
              }
              qr.finalAnswer = finalAnswer;
              qr.confidence = (maxVotes / (qr.expectedVotes || 1)) * 100;
            }
            return newResults;
          });
        });

        // Finalize each question's aggregated result
        setResults(prev => {
          const newResults = JSON.parse(JSON.stringify(prev));
          for (const q of parsedQuestions) {
            const qr = newResults[q.id];
            if (!qr) continue; // guard adicional
            const totalVotes = Object.values(qr.votes).reduce((acc: number, v)=> acc + (v as string[]).length, 0);
            if (totalVotes === (qr.expectedVotes || 0)) {
              qr.isResolved = true;
              let maxVotes = 0; let finalAnswer = '';
              for (const [key, voters] of Object.entries(qr.votes)) {
        if ((voters as string[]).length > maxVotes) { maxVotes = (voters as string[]).length; finalAnswer = key; }
              }
              qr.finalAnswer = finalAnswer;
              qr.confidence = (maxVotes / (qr.expectedVotes || 1)) * 100;
            } else {
              // progreso parcial: tomar líder / total esperado
              let maxVotes = 0; let leader = '';
              for (const [key, voters] of Object.entries(qr.votes)) {
                if ((voters as string[]).length > maxVotes) { maxVotes = (voters as string[]).length; leader = key; }
              }
              qr.finalAnswer = leader || undefined;
              qr.confidence = (maxVotes / (qr.expectedVotes || 1)) * 100;
            }
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

  const handleImageSubmit = useCallback((imageData: string) => {
    processTest(() => extractQuestionsFromImage(imageData));
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
              <InputArea onImageSubmit={handleImageSubmit} onTextSubmit={handleTextSubmit} isLoading={isLoading}/>
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
