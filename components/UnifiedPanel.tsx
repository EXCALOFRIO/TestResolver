import React, { useEffect, useState, useRef } from 'react';
import { MODEL_CONFIGS } from '../modelConfigs';
import { GearIcon } from './icons/GearIcon';
import { ShareIcon } from './icons/ShareIcon';
import { listTestRuns, renameTestRun, shareTestRun, deleteTestRun } from '../services/historyService';
import { TestRunSummary } from '../types';
import { ShareModal } from './ShareModal';
import { ConfirmModal } from './ConfirmModal';

interface UnifiedPanelProps {
  activeModels: Record<string, boolean>;
  onToggle: (key: string) => void;
  open: boolean;
  onClose: () => void;
  userEmail: string;
  onLogout: () => void;
  onLoadRun: (id: number) => void;
  currentRunId: number | null;
}

export const UnifiedPanel: React.FC<UnifiedPanelProps> = ({ 
  activeModels, 
  onToggle, 
  open, 
  onClose, 
  userEmail, 
  onLogout,
  onLoadRun,
  currentRunId
}) => {
  const [runs, setRuns] = useState<TestRunSummary[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [tempName, setTempName] = useState('');
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [shareModal, setShareModal] = useState<{ isOpen: boolean; url?: string; testName: string; loading?: boolean; error?: string | null }>({
    isOpen: false,
    url: '',
    testName: '',
    loading: false,
    error: null
  });
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setLoadingRuns(true);
      listTestRuns(20,0).then(r => setRuns(r)).finally(()=> setLoadingRuns(false));
    }
  }, [open]);

  // Cerrar el menú si se hace click/tap fuera del mismo
  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (!openMenuId) return;
      const t = (e.target as Node);
      if (menuRef.current && !menuRef.current.contains(t)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [openMenuId]);

  const startEdit = (r: TestRunSummary) => { setEditingId(r.id); setTempName(r.name); };
  const commitEdit = async () => {
    if (!editingId) return;
    const trimmed = tempName.trim();
    if (!trimmed) { setEditingId(null); return; }
    const updated = await renameTestRun(editingId, trimmed);
    if (updated) setRuns(prev => prev.map(x => x.id===updated.id ? { ...x, name: updated.name, auto_name: updated.auto_name } : x));
    setEditingId(null);
  };

  const handleShare = async (id: number, testName: string) => {
    // Abrir modal inmediatamente
    setShareModal({ isOpen: true, url: '', testName, loading: true, error: null });
    try {
      const res = await shareTestRun(id);
      if (res) {
        setRuns(prev => prev.map(r => r.id===id ? { ...r, share_token: res.token } : r));
        setShareModal({ isOpen: true, url: res.url, testName, loading: false, error: null });
      } else {
        setShareModal({ isOpen: true, url: '', testName, loading: false, error: 'No se pudo generar el enlace.' });
      }
    } catch (e) {
      console.error('[share] error', e);
      setShareModal({ isOpen: true, url: '', testName, loading: false, error: 'Error inesperado al compartir.' });
    } finally {
      setOpenMenuId(null);
    }
  };

  const requestDelete = (r: TestRunSummary) => {
    setDeleteTarget({ id: r.id, name: r.name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const ok = await deleteTestRun(deleteTarget.id);
    if (ok) setRuns(prev => prev.filter(r => r.id !== deleteTarget.id));
    setDeleting(false);
    setDeleteTarget(null);
  };

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

      {/* Configuración de modelos + historial */}
      <div className="flex-1 overflow-y-auto">
        {!showModelConfig ? (
          /* Vista Historial por defecto */
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <h4 className="text-slate-200 font-semibold text-lg">Historial Reciente</h4>
            </div>
            <div className="space-y-3">
              {loadingRuns && <div className="text-sm text-slate-400 text-center py-8">Cargando...</div>}
              {!loadingRuns && runs.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-slate-500 text-sm mb-2">Sin tests aún</div>
                  <div className="text-xs text-slate-600">Los tests resueltos aparecerán aquí</div>
                </div>
              )}
              {runs.map(r => {
                const active = r.id === currentRunId;
                const editing = editingId === r.id;
                const menuOpen = openMenuId === r.id;
                return (
                  <div key={r.id} className={`p-3 rounded-lg border text-sm transition-colors relative ${active ? 'border-indigo-400/70 bg-indigo-500/10 shadow-lg' : 'border-slate-600/40 bg-slate-800/50'}`}> 
                    <div className="flex items-center gap-3">
                      <button onClick={() => onLoadRun(r.id)} className="flex-1 text-left min-w-0">
                        {editing ? (
                          <input autoFocus value={tempName} onChange={e=>setTempName(e.target.value)} onBlur={commitEdit} onKeyDown={e=>{ if(e.key==='Enter') commitEdit(); if(e.key==='Escape'){ setEditingId(null);} }} className="w-full bg-slate-900/60 border border-slate-600 rounded px-2 py-1 text-slate-100" />
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-200 truncate">{r.name}</div>
                              <div className="text-xs text-slate-400 flex items-center gap-1 flex-wrap">
                                <span className="bg-slate-700/50 px-1.5 py-0.5 rounded">{r.total_questions} preguntas</span>
                                <span>•</span>
                                <span className="whitespace-nowrap">{new Date(r.created_at).toLocaleDateString()}</span>
                                {r.share_token && (
                                  <>
                                    <span>•</span>
                                    <span className="text-emerald-400 whitespace-nowrap">Compartido</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </button>
                      {!editing && (
                        <div ref={menuOpen ? menuRef : undefined} className="relative">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : r.id); }}
                            className="text-slate-400 hover:text-slate-200 transition-colors p-2 rounded hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:ring-offset-1 focus:ring-offset-slate-800"
                            title="Opciones"
                            aria-haspopup="menu"
                            aria-expanded={menuOpen}
                          >
                            ⋮
                          </button>
                          {menuOpen && (
                            <div className="absolute right-0 top-8 z-[9999] bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-40 pointer-events-auto">
                                <button onClick={() => { startEdit(r); setOpenMenuId(null); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">✎ Renombrar</button>
                                <button onClick={() => { handleShare(r.id, r.name); setOpenMenuId(null); }} className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors">
                                  <ShareIcon className="w-4 h-4 inline mr-2" />
                                  Compartir
                                </button>
                                <button
                                  onClick={() => { 
                                    // Cargar el test y luego emitir evento para exportar
                                    onLoadRun(r.id);
                                    setOpenMenuId(null);
                                    setTimeout(()=> { window.dispatchEvent(new CustomEvent('export-pdf-request')); }, 350);
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                                >📄 Exportar PDF</button>
                                {r.share_token && (
                                  <button 
                                    onClick={async () => { 
                                      const url=`${window.location.origin}/t/${r.share_token}`; 
                                      try { 
                                        await navigator.clipboard.writeText(url); 
                                        setCopySuccess(true);
                                        setTimeout(() => setCopySuccess(false), 2000);
                                      } catch {}; 
                                      setOpenMenuId(null); 
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm text-emerald-400 hover:bg-slate-700 transition-colors"
                                  >
                                    {copySuccess ? '✓ Copiado' : '📋 Copiar enlace'}
                                  </button>
                                )}
                                <hr className="border-slate-600 my-1" />
                                <button onClick={() => { requestDelete(r); setOpenMenuId(null); }} className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-slate-700 transition-colors">🗑 Eliminar</button>
                              </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {openMenuId && (
                <div className="fixed inset-0 z-[9998]" onClick={() => setOpenMenuId(null)} />
              )}
            </div>
          </div>
        ) : (
          /* Vista Configuración de Modelos */
          <>
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
          </>
        )}
      </div>

      {/* Footer con acciones */}
      <div className="px-4 py-3 border-t border-slate-700/60 bg-slate-800/30 space-y-3">
        <button
          onClick={() => setShowModelConfig(!showModelConfig)}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
        >
          <GearIcon className="w-4 h-4" />
          {showModelConfig ? 'Ver Historial' : 'Configuración de Modelos'}
        </button>

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
      
      <ShareModal
        isOpen={shareModal.isOpen}
        shareUrl={shareModal.url}
        testName={shareModal.testName}
        loading={shareModal.loading}
        error={shareModal.error}
        onClose={() => setShareModal({ isOpen: false, url: '', testName: '', loading: false, error: null })}
      />
      <ConfirmModal
        open={!!deleteTarget}
        title="Eliminar test"
        description={deleteTarget ? `¿Seguro que deseas eliminar "${deleteTarget.name}"?\nEsta acción no se puede deshacer.` : ''}
        confirmText="Eliminar"
        cancelText="Cancelar"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => { if(!deleting) setDeleteTarget(null); }}
      />
    </div>
  );
};
