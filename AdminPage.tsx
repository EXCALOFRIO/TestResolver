import React from 'react';

export const AdminPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-10 flex flex-col items-center justify-center">
      <h1 className="text-3xl font-bold mb-4">Panel Admin</h1>
      <p className="text-slate-400">Se ha limpiado todo el módulo de pruebas y gráficas. Aquí puedes implementar futuras herramientas básicas.</p>
    </div>
  );
};

// ---- Accuracy Charts ----
const AccuracyCharts: React.FC<{ data: { iteration: number; model: string; acc: number; global: number }[] }> = ({ data }) => {
  const width = 600; const height = 160; const pad = 40;
  const maxIter = Math.max(...data.map(d=>d.iteration));
  const models = Array.from(new Set(data.map(d=> String(d.model)))) as string[];
  models.sort();
  const colorMap: Record<string,string> = {};
  const palette = ['#0ea5e9','#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#ef4444','#14b8a6'];
  models.forEach((m: string,i)=> { colorMap[m] = palette[i%palette.length]; });
  // global line
  const globalByIter: Record<number, number> = {};
  data.forEach(d => { globalByIter[d.iteration] = d.global; });
  const globalPts = Object.entries(globalByIter).sort((a,b)=> Number(a[0])-Number(b[0])).map(([it,val]) => {
    const x = pad + (Number(it)/maxIter)*(width-pad*2);
    const y = pad + (1 - val) * (height - pad*2);
    return `${x},${y}`;
  }).join(' ');
  // per model polylines
  const byModel: Record<string, { iteration: number; acc: number }[]> = {};
  data.forEach(d=> { if(!byModel[d.model]) byModel[d.model] = []; byModel[d.model].push({ iteration: d.iteration, acc: d.acc }); });
  Object.values(byModel).forEach(arr => arr.sort((a,b)=> a.iteration - b.iteration));
  const modelLines = Object.entries(byModel).map(([m, arr]) => {
    const pts = arr.map(d => {
      const x = pad + (d.iteration / maxIter)*(width - pad*2);
      const y = pad + (1 - d.acc) * (height - pad*2);
      return `${x},${y}`;
    }).join(' ');
    return <polyline key={m} points={pts} fill="none" stroke={colorMap[m]} strokeWidth={1.5} />;
  });
  const yLabels = [0,0.25,0.5,0.75,1];
  return (
    <div className="mb-12 bg-slate-900/60 border border-slate-700/60 rounded-xl p-5">
      <h2 className="text-sm font-semibold tracking-wide uppercase text-indigo-300 mb-3">Accuracy Global y por Modelo</h2>
      <svg width={width} height={height} className="w-full max-w-full">
        <rect width={width} height={height} rx={8} fill="#1e293b" />
        <text x={pad} y={14} fontSize={11} fill="#94a3b8">Accuracy</text>
        <polyline points={globalPts} fill="none" stroke="#fbbf24" strokeWidth={2} />
        {modelLines}
        <line x1={pad} y1={pad} x2={pad} y2={height-pad} stroke="#475569" />
        <line x1={pad} y1={height-pad} x2={width-pad} y2={height-pad} stroke="#475569" />
        {yLabels.map(v=> {
          const y = pad + (1 - v) * (height - pad*2);
          return <g key={v}>
            <line x1={pad-5} x2={pad} y1={y} y2={y} stroke="#64748b" />
            <text x={6} y={y+3} fontSize={9} fill="#64748b">{Math.round(v*100)}%</text>
          </g>;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-3 text-[10px] items-center">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#fbbf24]" />Global</span>
        {models.map(m=> <span key={m} className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{background:colorMap[m]}} />{m}</span>)}
      </div>
    </div>
  );
};