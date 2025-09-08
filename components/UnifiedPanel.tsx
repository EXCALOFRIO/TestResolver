import React from 'react';
import { MODEL_CONFIGS } from '../modelConfigs';
import { GearIcon } from './icons/GearIcon';

interface UnifiedPanelProps {
  activeModels: Record<string, boolean>;
  onToggle: (key: string) => void;
  open: boolean;
  onClose: () => void;
  userEmail: string;
  onLogout: () => void;
}

export const UnifiedPanel: React.FC<UnifiedPanelProps> = ({ 
  activeModels, 
  onToggle, 
  open, 
  onClose, 
  userEmail, 
  onLogout 
}) => {
  return (
    <div className={`fixed top-0 right-0 h-full w-80 md:w-80 sm:w-72 backdrop-blur-xl bg-gradient-to-b from-slate-950/95 to-slate-900/95 border-l border-slate-700/60 shadow-2xl shadow-black/50 transform transition-all duration-500 ease-out z-40 flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      {/* Banda luminosa lateral */}
      <div className="absolute top-0 left-0 h-full w-px bg-gradient-to-b from-transparent via-indigo-500/40 to-transparent" />
      
      {/* Header con perfil */}
      <div className="relative px-6 py-4 border-b border-slate-700/60 bg-gradient-to-r from-indigo-600/20 to-purple-600/20">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-100 font-bold text-sm tracking-wide uppercase">Panel de Control</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl leading-none transition-all duration-200 hover:rotate-90 p-2 rounded-full hover:bg-slate-700/50"
            aria-label="Cerrar panel"
          >
            ×
          </button>
        </div>
        
        {/* Info del perfil */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 border-2 border-slate-600 flex items-center justify-center font-bold text-white">
            {userEmail?.trim()?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="truncate">
            <div className="text-slate-200 text-sm font-semibold">{userEmail || 'usuario@ejemplo.com'}</div>
            <div className="text-slate-400 text-xs">{userEmail ? 'Sesión activa' : 'No identificado'}</div>
          </div>
        </div>
      </div>

      {/* Configuración de modelos */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-700/30">
          <div className="flex items-center gap-2 mb-3">
            <GearIcon className="w-4 h-4 text-indigo-400" />
            <h4 className="text-slate-200 font-semibold text-sm">Configuración de Modelos</h4>
          </div>
          <p className="text-xs text-slate-400">Selecciona qué modelos usar para resolver tests</p>
        </div>

        <div className="p-4 space-y-3 custom-scrollbar">
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
      </div>

      {/* Footer con acciones */}
      <div className="px-4 py-3 border-t border-slate-700/60 bg-slate-800/30 space-y-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></div>
          <span>Se ejecuta automáticamente el máximo permitido por modelo.</span>
        </div>
        
        <button
          onClick={onLogout}
          className="w-full inline-flex items-center justify-center px-3 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium transition-colors"
        >
          Cerrar sesión
        </button>
        
        <div className="text-center text-[11px] text-slate-500">v0.0.0</div>
      </div>
    </div>
  );
};
