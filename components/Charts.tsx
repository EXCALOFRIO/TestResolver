import React from 'react';

interface LineSeries { label: string; color: string; points: number[]; }
interface LineChartProps { series: LineSeries[]; height?: number; width?: number; }

export const LineChart: React.FC<LineChartProps> = ({ series, height=160, width=420 }) => {
  const maxIter = Math.max(0, ...series.map(s=> s.points.length));
  const pad = 24;
  const innerW = width - pad*2;
  const innerH = height - pad*2;
  const yTicks = [0,0.25,0.5,0.75,1];
  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* axes */}
      <g transform={`translate(${pad},${pad})`}>
        {yTicks.map(t => (
          <g key={t}>
            <line x1={0} x2={innerW} y1={innerH - t*innerH} y2={innerH - t*innerH} stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
            <text x={-6} y={innerH - t*innerH + 4} textAnchor="end" fontSize={10} fill="#64748b">{Math.round(t*100)}%</text>
          </g>
        ))}
        {series.map(s => {
          const d = s.points.map((v,i)=> {
            const x = (i/(Math.max(1,s.points.length-1))) * innerW;
            const y = innerH - (v * innerH);
            return `${i===0?'M':'L'}${x},${y}`;
          }).join(' ');
          return <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
        })}
        {series.map(s => s.points.map((v,i)=> {
          const x = (i/(Math.max(1,s.points.length-1))) * innerW;
            const y = innerH - (v * innerH);
            return <circle key={s.label+':'+i} cx={x} cy={y} r={3} fill={s.color} />;
        }))}
      </g>
    </svg>
  );
};

interface BarItem { label: string; value: number; color: string; }
interface BarChartProps { items: BarItem[]; height?: number; width?: number; }

export const BarChart: React.FC<BarChartProps> = ({ items, height=160, width=420 }) => {
  const pad = 24;
  const innerW = width - pad*2;
  const innerH = height - pad*2;
  const maxAbs = Math.max(0.01, ...items.map(i=> Math.abs(i.value)));
  const zeroY = innerH/2;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <g transform={`translate(${pad},${pad})`}>
        <line x1={0} x2={innerW} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth={1} />
        {items.map((it, idx) => {
          const barW = innerW / (items.length * 1.4);
          const gap = barW * 0.4;
          const x = idx * (barW + gap);
          const scaled = (it.value / maxAbs) * (innerH/2 - 10);
          const y = scaled < 0 ? zeroY : zeroY - scaled;
          const h = Math.abs(scaled);
          return (
            <g key={it.label}>
              <rect x={x} y={y} width={barW} height={h} rx={3} fill={it.color} />
              <text x={x + barW/2} y={y - 4} textAnchor="middle" fontSize={10} fill="#94a3b8">{(it.value*100).toFixed(1)}%</text>
              <text x={x + barW/2} y={innerH + 10} textAnchor="middle" fontSize={10} fill="#64748b">{it.label}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
};
