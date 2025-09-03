import React, { useState, useMemo } from 'react';
import { parseQuestionsHeuristically } from './services/localParser';
import { multiModelBatchSolve } from './services/geminiService';
import { MODEL_CONFIGS } from './modelConfigs';
import { StrategyKey, Question } from './types';
import { STRATEGIES } from './constants';
import { LineChart, BarChart } from './components/Charts';

interface RunResultRow {
  model: string;
  iteration: number;
  strategy: StrategyKey;
  durationMs: number;
  answers: Record<number,string>; // última respuesta por pregunta en esa ejecución
}

interface StrategyLiftRow {
  model: string;
  strategy: StrategyKey;
  baseAccuracy: number;
  strategyAccuracy: number;
  delta: number; // strategy - base
  wins: number; // preguntas donde base falló y strategy acertó
  losses: number; // base acertó y strategy falló
}

export const EvaluationPage: React.FC = () => {
  const [raw, setRaw] = useState('');
  const [answerKeyRaw, setAnswerKeyRaw] = useState('');
  const [parsed, setParsed] = useState<Question[]>([]);
  const [runs, setRuns] = useState<RunResultRow[]>([]);
  const [iterations, setIterations] = useState(1);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [selectedStrategies, setSelectedStrategies] = useState<Record<StrategyKey, boolean>>(()=> ({
    [StrategyKey.BASE]: true,
    [StrategyKey.PERMUTATION_MIX]: true,
    [StrategyKey.PIVOT_LANGUAGE]: true,
    [StrategyKey.CHAIN_OF_THOUGHT]: false,
  }));

  const appendLog = (m: string) => setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ${m}`]);

  const loadQuestions = () => {
    const qs = parseQuestionsHeuristically(raw);
    setParsed(qs);
    appendLog(`Preguntas parseadas: ${qs.length}`);
  };

  const parsedAnswerKey: Record<number,string> = {};
  answerKeyRaw.split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^(\d+)\s*[=:\-]\s*([A-Za-z])/);
    if (m) parsedAnswerKey[Number(m[1])] = m[2].toUpperCase();
  });

  const run = async () => {
    if (!parsed.length) { appendLog('No hay preguntas.'); return; }
    setRunning(true); setRuns([]); setLog([]);
    // Sólo modelos activados por defecto ahora
    const activeModels = MODEL_CONFIGS.filter(m=>m.enabledByDefault).map(m=>m.key);
    const strategiesToRun = (Object.keys(selectedStrategies) as StrategyKey[]).filter(k=> selectedStrategies[k]);
    appendLog(`Modelos: ${activeModels.join(', ')} | Estrategias: ${strategiesToRun.join(', ')}`);
    for (let it=1; it<=iterations; it++) {
      for (const strat of strategiesToRun) {
        appendLog(`Iteración ${it} estrategia ${strat} inicio`);
        const t0 = performance.now();
        try {
          const res: any = await multiModelBatchSolve(parsed, strat, activeModels, undefined, { concurrent: true });
          const perModel = (res as any).__perModel as Record<string, Record<number,string[]>>;
          for (const mk of Object.keys(perModel)) {
            const lastAnswers: Record<number,string> = {};
            Object.entries(perModel[mk]).forEach(([qid, arr]) => { const a = (arr as string[])[(arr as string[]).length-1]; if (a) lastAnswers[Number(qid)] = a; });
            setRuns(r => [...r, { model: mk, iteration: it, strategy: strat as StrategyKey, durationMs: performance.now()-t0, answers: lastAnswers }]);
          }
        } catch(e:any) {
          appendLog(`Error iter ${it} strat ${strat}: ${e?.message||e}`);
        }
      }
    }
    setRunning(false);
  };

  const perModelAccuracy: Record<string, {correct: number; total: number}> = {};
  runs.filter(r=> r.strategy === StrategyKey.BASE).forEach(r => {
    if (!perModelAccuracy[r.model]) perModelAccuracy[r.model] = { correct:0, total:0 };
    Object.entries(r.answers).forEach(([qid, letter]) => {
      const gt = parsedAnswerKey[Number(qid)];
      if (gt) { perModelAccuracy[r.model].total++; if (gt === letter) perModelAccuracy[r.model].correct++; }
    });
  });

  // --- Métricas avanzadas ---
  const strategyLifts: StrategyLiftRow[] = useMemo(()=>{
    if (!Object.keys(parsedAnswerKey).length) return [];
    const out: StrategyLiftRow[] = [];
    const grouped: Record<string, RunResultRow[]> = {};
    runs.forEach(r => { const key = r.model + '::' + r.strategy; (grouped[key] ||= []).push(r); });
    const baseByModel: Record<string, RunResultRow[]> = {};
    runs.filter(r=> r.strategy===StrategyKey.BASE).forEach(r=> { (baseByModel[r.model] ||= []).push(r); });
    const strategies = Array.from(new Set(runs.map(r=> r.strategy)));
    for (const strat of strategies) {
      if (strat === StrategyKey.BASE) continue;
      for (const model of Object.keys(baseByModel)) {
        const baseRuns = baseByModel[model];
        const stratRuns = runs.filter(r=> r.model===model && r.strategy===strat);
        if (!stratRuns.length || !baseRuns.length) continue;
        let baseCorrect=0, baseTotal=0, stratCorrect=0, stratTotal=0, wins=0, losses=0;
        // Comparamos pregunta a pregunta usando todos los runs (emparejamos por iteración si existe)
        const maxIter = Math.max(...baseRuns.map(r=>r.iteration), ...stratRuns.map(r=>r.iteration));
        for (let it=1; it<=maxIter; it++) {
          const b = baseRuns.find(r=>r.iteration===it);
          const s = stratRuns.find(r=>r.iteration===it);
          if (!b || !s) continue;
          // Recorrer preguntas presentes en answer key
            Object.keys(parsedAnswerKey).forEach(qidStr => {
              const qid = Number(qidStr);
              const gt = parsedAnswerKey[qid];
              const ba = b.answers[qid];
              const sa = s.answers[qid];
              if (ba) { baseTotal++; if (ba===gt) baseCorrect++; }
              if (sa) { stratTotal++; if (sa===gt) stratCorrect++; }
              if (ba && sa) {
                const baseOk = ba===gt; const stratOk = sa===gt;
                if (!baseOk && stratOk) wins++;
                if (baseOk && !stratOk) losses++;
              }
            });
        }
        if (baseTotal>0 && stratTotal>0) {
          out.push({
            model,
            strategy: strat as StrategyKey,
            baseAccuracy: baseCorrect/baseTotal,
            strategyAccuracy: stratCorrect/stratTotal,
            delta: stratCorrect/stratTotal - baseCorrect/baseTotal,
            wins,
            losses,
          });
        }
      }
    }
    return out.sort((a,b)=> b.delta - a.delta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, answerKeyRaw]);

  // Acuerdo inter-modelo (agreement) para la estrategia base
  const agreementStats = useMemo(()=>{
    if (!parsed.length) return null;
    const baseRuns = runs.filter(r=> r.strategy===StrategyKey.BASE);
    if (!baseRuns.length) return null;
    const byIteration: Record<number, RunResultRow[]> = {};
    baseRuns.forEach(r=> (byIteration[r.iteration] ||= []).push(r));
    const perQuestion: Record<number, {totalModels:number; majorityShare:number; entropy:number; samples:number}> = {};
    for (const iter of Object.keys(byIteration).map(Number)) {
      const iterationRuns = byIteration[iter];
      // agrupar respuestas por pregunta
      const answerMap: Record<number, string[]> = {};
      iterationRuns.forEach(rr => {
        Object.entries(rr.answers).forEach(([qid, letter])=> {
          (answerMap[Number(qid)] ||= []).push(letter);
        });
      });
      Object.entries(answerMap).forEach(([qidStr, list])=>{
        const counts: Record<string, number> = {};
        list.forEach(l=> counts[l] = (counts[l]||0)+1);
        const max = Math.max(...Object.values(counts));
        const majorityShare = max / list.length;
        const entropy = - Object.values(counts).reduce((acc,c)=>{
          const p = c / list.length; return acc + (p? p * Math.log2(p) : 0);
        },0);
        const normEntropy = list.length>1 ? entropy / Math.log2(Math.min(5, list.length)) : 0; // normaliza máx en base num opciones aprox
        const qid = Number(qidStr);
        const ref = (perQuestion[qid] ||= {totalModels:0, majorityShare:0, entropy:0, samples:0});
        ref.totalModels = Math.max(ref.totalModels, list.length);
        ref.majorityShare += majorityShare;
        ref.entropy += normEntropy;
        ref.samples += 1;
      });
    }
    // Agregados globales
    const global = { avgMajority:0, avgEntropy:0 };
    const qids = Object.keys(perQuestion).map(Number);
    qids.forEach(q=> {
      const d = perQuestion[q];
      global.avgMajority += d.majorityShare / (d.samples||1);
      global.avgEntropy += d.entropy / (d.samples||1);
    });
    if (qids.length) {
      global.avgMajority /= qids.length;
      global.avgEntropy /= qids.length;
    }
    return { perQuestion, global };
  }, [runs, parsed]);

  const hardestQuestions = useMemo(()=>{
    if (!agreementStats || !Object.keys(parsedAnswerKey).length) return [];
    // dificultad = menor precisión base promedio entre modelos (última iter)
    const lastIter = Math.max(0, ...runs.filter(r=> r.strategy===StrategyKey.BASE).map(r=> r.iteration));
    const lastBaseRuns = runs.filter(r=> r.strategy===StrategyKey.BASE && r.iteration===lastIter);
    const byModelAnswer: Record<number, string[]> = {};
  lastBaseRuns.forEach(r=> { Object.entries(r.answers).forEach(([qid, a])=> { (byModelAnswer[Number(qid)] ||= []).push(a as string); }); });
    const rows: {qid:number; baseAccuracy:number; majorityShare:number}[] = [];
    Object.keys(parsedAnswerKey).forEach(qidStr => {
      const qid = Number(qidStr);
      const gt = parsedAnswerKey[qid];
      const answers = byModelAnswer[qid] || [];
      if (!answers.length) return;
      const correct = answers.filter(a=> a===gt).length;
      const counts: Record<string, number> = {};
      answers.forEach(a=> counts[a]=(counts[a]||0)+1);
      const majorityShare = Math.max(...Object.values(counts)) / answers.length;
      rows.push({ qid, baseAccuracy: correct/answers.length, majorityShare });
    });
    return rows.sort((a,b)=> a.baseAccuracy - b.baseAccuracy).slice(0,5);
  }, [runs, answerKeyRaw, agreementStats]);

  // Serie de accuracy acumulado por iteración y estrategia (promedio sobre modelos) usando answer key
  const accuracySeries = useMemo(()=>{
    if (!Object.keys(parsedAnswerKey).length) return [] as {label:string;color:string;points:number[]}[];
    const colors: Record<StrategyKey,string> = {
      [StrategyKey.BASE]: '#6366f1',
      [StrategyKey.PERMUTATION_MIX]: '#10b981',
      [StrategyKey.PIVOT_LANGUAGE]: '#f59e0b',
      [StrategyKey.CHAIN_OF_THOUGHT]: '#ec4899',
    };
    const result: {label:string;color:string;points:number[]}[] = [];
    const strategiesPresent = Array.from(new Set(runs.map(r=> r.strategy)));
  strategiesPresent.forEach(strat => {
      const perIter: number[] = [];
      const runsStrat = runs.filter(r=> r.strategy===strat);
      const maxIter = Math.max(0, ...runsStrat.map(r=> r.iteration));
      for (let it=1; it<=maxIter; it++) {
        const iterRuns = runsStrat.filter(r=> r.iteration===it);
        let correct=0,total=0;
        iterRuns.forEach(r=> {
          Object.entries(r.answers).forEach(([qid, letter])=>{
            const gt = parsedAnswerKey[Number(qid)];
            if (gt) { total++; if (gt===letter) correct++; }
          });
        });
        perIter.push(total? correct/total : 0);
      }
  if (perIter.length) result.push({ label: strat as string, color: colors[strat as StrategyKey], points: perIter });
    });
    return result;
  }, [runs, answerKeyRaw]);

  const barLiftData = useMemo(()=>{
    return strategyLifts.map(l => ({ label: l.model+':'+l.strategy, value: l.delta, color: l.delta>=0? '#10b981':'#ef4444' }));
  }, [strategyLifts]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <h1 className="text-2xl font-bold mb-4">Evaluación rápida</h1>
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Test</h2>
          <textarea value={raw} onChange={e=>setRaw(e.target.value)} placeholder="Pega tus preguntas..." className="w-full h-64 bg-slate-800/70 border border-slate-600 rounded p-3 text-sm font-mono" />
          <button onClick={loadQuestions} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold">Parsear</button>
          <div className="text-xs text-slate-400">Preguntas: {parsed.length}</div>
          <label className="flex flex-col text-xs gap-1 w-40">
            Iteraciones
            <input type="number" min={1} value={iterations} onChange={e=>setIterations(Math.max(1, Number(e.target.value)||1))} className="bg-slate-800 border border-slate-600 rounded px-2 py-1" />
          </label>
          <div className="space-y-2 text-xs">
            <div className="font-semibold text-slate-400 mt-4">Estrategias</div>
            {STRATEGIES.map(s => (
              <label key={s.key} className="flex items-center gap-2">
                <input type="checkbox" checked={!!selectedStrategies[s.key]} onChange={()=> setSelectedStrategies(p=> ({...p, [s.key]: !p[s.key]}))} />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
          <button disabled={running} onClick={run} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-sm font-semibold">{running? 'Ejecutando...' : 'Lanzar evaluación'}</button>
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-400">Answer Key (opcional)</h2>
          <textarea value={answerKeyRaw} onChange={e=>setAnswerKeyRaw(e.target.value)} placeholder="1=A\n2=C..." className="w-full h-40 bg-slate-800/70 border border-slate-600 rounded p-3 text-sm font-mono" />
          <div className="text-xs text-slate-400">Respuestas cargadas: {Object.keys(parsedAnswerKey).length}</div>
          <div className="bg-slate-900/60 border border-slate-700 rounded p-3 text-xs max-h-40 overflow-auto">
            {Object.entries(perModelAccuracy).map(([m, d]) => (
              <div key={m}>{m}: {d.total? ((d.correct/d.total)*100).toFixed(1):'0.0'}% ({d.correct}/{d.total})</div>
            ))}
          </div>
        </div>
      </div>
      <div className="mb-8 space-y-10">
        <div>
          <h2 className="text-sm font-semibold uppercase text-slate-400 mb-2">Resultados por iteración / estrategia</h2>
          <div className="overflow-x-auto border border-slate-700 rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-800/60">
                <tr>
                  <th className="p-2 text-left">Iter</th>
                  <th className="p-2 text-left">Estrategia</th>
                  <th className="p-2 text-left">Modelo</th>
                  <th className="p-2 text-left">Duración (ms)</th>
                  <th className="p-2 text-left">Respuestas</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r,i)=>(
                  <tr key={i} className="border-t border-slate-700/50">
                    <td className="p-2">{r.iteration}</td>
                    <td className="p-2 font-mono">{r.strategy}</td>
                    <td className="p-2 font-mono">{r.model}</td>
                    <td className="p-2">{r.durationMs.toFixed(0)}</td>
                    <td className="p-2 font-mono whitespace-pre">{Object.entries(r.answers).map(([q,a])=>`Q${q}:${a}`).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {!!strategyLifts.length && (
          <div>
            <h2 className="text-sm font-semibold uppercase text-slate-400 mb-2">Lift de estrategias (vs Base)</h2>
            <div className="overflow-x-auto border border-slate-700 rounded">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-800/60">
                  <tr>
                    <th className="p-2 text-left">Modelo</th>
                    <th className="p-2 text-left">Estrategia</th>
                    <th className="p-2 text-left">Base %</th>
                    <th className="p-2 text-left">Strat %</th>
                    <th className="p-2 text-left">Δ (puntos)</th>
                    <th className="p-2 text-left">Wins</th>
                    <th className="p-2 text-left">Losses</th>
                    <th className="p-2 text-left">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {strategyLifts.map((row,i)=>(
                    <tr key={i} className="border-t border-slate-700/50">
                      <td className="p-2 font-mono">{row.model}</td>
                      <td className="p-2 font-mono">{row.strategy}</td>
                      <td className="p-2">{(row.baseAccuracy*100).toFixed(1)}</td>
                      <td className="p-2">{(row.strategyAccuracy*100).toFixed(1)}</td>
                      <td className={`p-2 ${(row.delta>0?'text-emerald-400': row.delta<0?'text-rose-400':'')}`}>{(row.delta*100).toFixed(1)}</td>
                      <td className="p-2">{row.wins}</td>
                      <td className="p-2">{row.losses}</td>
                      <td className={`p-2 ${(row.wins-row.losses>0?'text-emerald-400': row.wins-row.losses<0?'text-rose-400':'')}`}>{row.wins-row.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {agreementStats && (
          <div>
            <h2 className="text-sm font-semibold uppercase text-slate-400 mb-2">Acuerdo inter-modelo (Base)</h2>
            <div className="text-xs text-slate-300 mb-2">Promedio majority share: {(agreementStats.global.avgMajority*100).toFixed(1)}% | Entropía normalizada media: {agreementStats.global.avgEntropy.toFixed(3)}</div>
            {!!hardestQuestions.length && (
              <div className="text-xs text-slate-400 mb-2">Preguntas más difíciles (Base):</div>
            )}
            {!!hardestQuestions.length && (
              <div className="overflow-x-auto border border-slate-700 rounded mb-4">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-800/60">
                    <tr>
                      <th className="p-2 text-left">QID</th>
                      <th className="p-2 text-left">Acc Base %</th>
                      <th className="p-2 text-left">Majority %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hardestQuestions.map(h => (
                      <tr key={h.qid} className="border-t border-slate-700/50">
                        <td className="p-2">{h.qid}</td>
                        <td className="p-2">{(h.baseAccuracy*100).toFixed(1)}</td>
                        <td className="p-2">{(h.majorityShare*100).toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {!!accuracySeries.length && (
          <div>
            <h2 className="text-sm font-semibold uppercase text-slate-400 mb-2">Curva de accuracy (promedio modelos)</h2>
            <div className="bg-slate-900/60 border border-slate-700 rounded p-4 overflow-x-auto">
              <LineChart series={accuracySeries} />
              <div className="flex flex-wrap gap-4 mt-2 text-[10px] text-slate-400">
                {accuracySeries.map(s => (
                  <div key={s.label} className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{background:s.color}}></span>{s.label}</div>
                ))}
              </div>
            </div>
          </div>
        )}
        {!!barLiftData.length && (
          <div>
            <h2 className="text-sm font-semibold uppercase text-slate-400 mb-2">Δ Accuracy estrategia vs Base</h2>
            <div className="bg-slate-900/60 border border-slate-700 rounded p-4 overflow-x-auto">
              <BarChart items={barLiftData} />
            </div>
          </div>
        )}
      </div>
      <div className="mb-8">
        <h2 className="text-sm font-semibold uppercase text-slate-400 mb-2">Log</h2>
        <div className="bg-slate-900/60 border border-slate-700 rounded p-3 text-[11px] h-40 overflow-auto font-mono whitespace-pre-wrap">
          {log.map((l,i)=>(<div key={i}>{l}</div>))}
        </div>
      </div>
    </div>
  );
};
