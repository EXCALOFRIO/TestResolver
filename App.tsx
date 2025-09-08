import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { AppState, Question, ResultsState, StrategyKey } from './types';
import { STRATEGIES } from './constants';
import { extractQuestionsFromFile, extractQuestionsFromFiles, extractQuestionsFromText, extractQuestionsFromMixed, getAndResetGeminiStats, multiModelBatchSolve } from './services/geminiService';
import { MODEL_CONFIGS } from './modelConfigs';
import { UnifiedPanel } from './components/UnifiedPanel';
import { InputArea } from './components/InputArea';
import { ResultsDashboard } from './components/ResultsDashboard';
import { SparklesIcon } from './components/icons/SparklesIcon';
import { ApiKeyGate } from './components/ApiKeyGate';
import { validateAnyStoredUserKey } from './services/keyUtils';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<ResultsState>({});
  const allStrategies: StrategyKey[] = STRATEGIES.map(s => s.key); // mantenido por compat
  const [activeModels, setActiveModels] = useState<Record<string, boolean>>(() => Object.fromEntries(MODEL_CONFIGS.map(m => [m.key, m.enabledByDefault !== false && m.enabledByDefault !== undefined ? m.enabledByDefault : false])));
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [needsKeyGate, setNeedsKeyGate] = useState<boolean>(false);
  const [gateError, setGateError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Buffer global para votos en streaming (evita renders excesivos)
  const pendingBatchRef = useRef<Record<number, { letter: string; label: string }[]>>({});
  const flushTimeoutRef = useRef<number | null>(null);
  
  // Gate de autenticación/API Key al montar: si falta token o email, mostrar gate inmediatamente.
  useEffect(() => {
    try {
      const token = localStorage.getItem('authToken');
      const email = localStorage.getItem('authEmail') || '';
      if (email) setUserEmail(email);
      if (!token || !email) {
        // No autenticado -> mostrar gate (paso 1 UI)
        setNeedsKeyGate(true);
        return;
      }
      // Autenticado; si no hay ninguna key almacenada aún, mostrar gate para step 3 (API key)
      let hasKeys = false;
      try {
        const raw = localStorage.getItem('userKeys') || '[]';
        const arr = JSON.parse(raw);
        hasKeys = Array.isArray(arr) && arr.length > 0;
      } catch {}
      setNeedsKeyGate(!hasKeys);
    } catch {
      setNeedsKeyGate(true);
    }
  }, []);

  const ensureValidKeyOrGate = async (): Promise<boolean> => {
    const ok = await validateAnyStoredUserKey();
    if (!ok) {
      setGateError('Tu API key no es válida o ha expirado. Por favor, añade una clave válida.');
      setNeedsKeyGate(true);
      return false;
    }
    return true;
  };

  const processTest = useCallback(async (getQuestions: () => Promise<Question[]>) => {
    const hasKey = await ensureValidKeyOrGate();
    if (!hasKey) return;
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

  const handleFilesSubmit = useCallback((dataUrls: string[]) => {
    // Convertir dataUrls a formato { base64, mimeType }
    const toSource = (du: string) => {
      const m = du.match(/^data:(.+?);base64,(.+)$/);
      if (!m) return null;
      return { mimeType: m[1], base64: m[2] };
    };
    processTest(async () => {
      const sources = dataUrls.map(toSource).filter(Boolean) as { base64: string; mimeType: string }[];
      // Reusar extractQuestionsFromFiles (ya maneja subida/grandes)
      return await extractQuestionsFromFiles(sources);
    });
  }, [processTest]);

  const handleTextSubmit = useCallback((text: string) => {
    processTest(() => extractQuestionsFromText(text));
  }, [processTest]);

  // Nuevo: manejo mixto (texto + imágenes/PDF simultáneamente)
  const handleMixedSubmit = useCallback((payload: { text: string; dataUrls: string[] }) => {
    const toSource = (du: string) => {
      const m = du.match(/^data:(.+?);base64,(.+)$/);
      if (!m) return null;
      return { mimeType: m[1], base64: m[2] };
    };
    processTest(async () => {
      const sources = (payload.dataUrls || []).map(toSource).filter(Boolean) as { base64: string; mimeType: string }[];
      return await extractQuestionsFromMixed(payload.text || '', sources);
    });
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

  const handleAuthenticated = () => {
    const email = localStorage.getItem('authEmail') || '';
    if (email) setUserEmail(email);
    // Comprobar si ya existe alguna key guardada para decidir si cerrar
    let hasKeys = false;
    try {
      const raw = localStorage.getItem('userKeys') || '[]';
      const arr = JSON.parse(raw);
      hasKeys = Array.isArray(arr) && arr.length > 0;
    } catch {}
    setNeedsKeyGate(!hasKeys);
  };

  return (
  <div className="min-h-screen text-slate-100 relative overflow-hidden flex flex-col bg-[radial-gradient(1200px_600px_at_50%_-200px,rgba(120,119,198,0.6),transparent)] from-slate-800 to-slate-900 bg-gradient-to-b">
      
      {/* Header fijo */}
    <header className="relative z-10 flex-shrink-0 pt-8 pb-4 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 flex items-center gap-2">
            <SparklesIcon className="w-6 h-6 sm:w-8 sm:h-8 lg:w-10 lg:h-10 text-indigo-400" />
            TestSolver
          </h1>
          <button
            onClick={() => setMenuOpen(v=>!v)}
            className="relative inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-800 border border-slate-600 shadow hover:bg-slate-700 transition-colors"
            aria-label="Perfil"
          >
            <span className="text-sm font-bold text-slate-200">{userEmail?.trim()?.charAt(0)?.toUpperCase() || 'U'}</span>
            {needsKeyGate && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 border border-slate-900 rounded-full" />
            )}
          </button>
        </div>
      </header>
      {needsKeyGate && (
        <ApiKeyGate onAuthenticated={handleAuthenticated} initialError={gateError} />
      )}
      
      {/* Contenido scrolleable */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <main className={`container mx-auto max-w-6xl transition-all duration-300 ${menuOpen ? 'pr-0 md:pr-80' : ''} px-4 sm:px-6 lg:px-8`}>
          
          {error && (
              <div className="max-w-2xl mx-auto bg-gradient-to-r from-red-500/20 to-pink-500/20 border border-red-500/60 text-red-200 px-4 py-3 rounded-xl my-4 text-center backdrop-blur-sm shadow-lg">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse"></div>
                    <span className="font-semibold text-sm">Error</span>
                  </div>
                  <div className="text-sm">{error}</div>
              </div>
          )}

          {/* Banner inicial eliminado para dejar el área superior limpia */}
          
          {(appState === AppState.PARSING || appState === AppState.SOLVING) && (
              <div className="flex items-center justify-center min-h-[50vh] text-center">
                  <div className="space-y-6">
                      <div className="inline-flex items-center justify-center">
                         <svg className="animate-spin h-12 w-12 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                      </div>
                      <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-200 mb-2">
                          {appState === AppState.PARSING ? 'Analizando preguntas...' : 'Resolviendo test...'}
                        </h2>
                        <p className="text-slate-400 text-sm sm:text-base">Por favor espera mientras procesamos tu contenido</p>
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                        <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                      </div>
                  </div>
              </div>
          )}

          {questions.length > 0 && (appState === AppState.SOLVING || appState === AppState.RESULTS) && (
             <div className="py-4 space-y-6">
               <ResultsDashboard questions={questions} results={results} />
               {appState === AppState.RESULTS && (
                  <div className="text-center pb-6">
                    <button
                      onClick={resetApp}
                      className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-medium py-3 px-6 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg text-sm sm:text-base"
                    >
                      Resolver otro test
                    </button>
                  </div>
               )}
             </div>
          )}
        </main>
      </div>

      {/* Input fijo en la parte inferior - solo en IDLE (sin banda de fondo) */}
      {appState === AppState.IDLE && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-2 sm:p-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] pointer-events-none">
          <div className="max-w-4xl mx-auto pointer-events-auto">
            <InputArea onFileSubmit={handleFileSubmit} onFilesSubmit={handleFilesSubmit} onTextSubmit={handleTextSubmit} onMixedSubmit={handleMixedSubmit} isLoading={isLoading}/>
          </div>
        </div>
      )}
      
      {/* Overlay para panel */}
      {menuOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30" 
          onClick={() => setMenuOpen(false)}
        />
      )}
      
      <UnifiedPanel
        open={menuOpen} 
        onClose={()=>setMenuOpen(false)} 
        activeModels={activeModels} 
        onToggle={(k)=> setActiveModels(p=>({...p,[k]:!p[k]}))}
        userEmail={userEmail}
        onLogout={() => { 
          localStorage.removeItem('authToken');
          localStorage.removeItem('authEmail');
          localStorage.removeItem('userKeys');
          setUserEmail('');
          setNeedsKeyGate(true); 
          setMenuOpen(false); 
        }}
      />
    </div>
  );
};

export default App;
