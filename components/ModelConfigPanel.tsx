import React from 'react';
import { MODEL_CONFIGS } from '../modelConfigs';
import { GearIcon } from './icons/GearIcon';

interface ModelConfigPanelProps {
  activeModels: Record<string, boolean>;
  onToggle: (key: string) => void;
  open: boolean;
  onClose: () => void;
}

export const ModelConfigPanel: React.FC<ModelConfigPanelProps> = ({ activeModels, onToggle, open, onClose }) => {
  return (
    <div className={`fixed top-0 right-0 h-full w-80 md:w-80 sm:w-72 backdrop-blur-xl bg-gradient-to-b from-slate-950/95 to-slate-900/95 border-l border-slate-700/60 shadow-2xl shadow-black/50 transform transition-all duration-500 ease-out z-40 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      {/* banda luminosa para separar visualmente */}
      <div className="absolute top-0 left-0 h-full w-px bg-gradient-to-b from-transparent via-indigo-500/40 to-transparent" />
      <div className="relative flex items-center gap-3 px-6 py-4 border-b border-slate-700/60 bg-gradient-to-r from-indigo-600/20 to-purple-600/20">
        <div className="flex items-center gap-2">
          <GearIcon className="w-5 h-5 text-indigo-400" />
          <h3 className="text-slate-100 font-bold text-sm tracking-wide uppercase">Configuración de Modelos</h3>
        </div>
        <button
          onClick={onClose}
          className="ml-auto text-slate-400 hover:text-slate-200 text-xl leading-none transition-all duration-200 hover:rotate-90 p-2 rounded-full hover:bg-slate-700/50"
          aria-label="Cerrar panel"
        >
          ×
        </button>
      </div>
  <div className="p-4 space-y-3 overflow-y-auto flex-1 custom-scrollbar">
        {MODEL_CONFIGS.map(m => {
          const enabled = activeModels[m.key] ?? true;
          return (
            <label key={m.key} className={`group flex items-start gap-3 p-4 rounded-xl cursor-pointer border text-sm transition-all backdrop-blur-sm hover:scale-[1.02] ${enabled ? 'bg-[linear-gradient(135deg,rgba(99,102,241,0.3),rgba(139,92,246,0.2)_50%,rgba(168,85,247,0.15))] border-indigo-400/70 shadow-[0_0_0_1px_rgba(99,102,241,0.4),0_8px_25px_-8px_rgba(99,102,241,0.6)]' : 'bg-slate-800/50 border-slate-600/50 hover:border-slate-500/80 hover:bg-slate-700/60'}`}> 
              <input type="checkbox" checked={enabled} onChange={() => onToggle(m.key)} className="mt-1 accent-indigo-500 scale-125" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-100 leading-tight flex items-center gap-2 mb-1">
                  {m.nombre}
                  {enabled && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400/50" />}
                </div>
                <div className="text-xs text-slate-400 tracking-wide font-mono bg-slate-900/30 px-2 py-1 rounded-md">
                  {m.rpmLimit} RPM • máx {m.maxPerTest} peticiones
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <div className="px-4 py-3 border-t border-slate-700/60 text-xs text-slate-400 bg-slate-800/30">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <span>Se ejecuta automáticamente el máximo permitido por modelo.</span>
        </div>
      </div>
    </div>
  );
};