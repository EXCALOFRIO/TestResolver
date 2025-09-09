import React from 'react';
import { createPortal } from 'react-dom';

interface ConfirmModalProps {
  open: boolean;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title = 'Confirmar',
  description = '¿Estás seguro?',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  loading = false,
  danger = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={loading ? undefined : onCancel} />
      <div className="relative w-full max-w-sm rounded-2xl border border-slate-700/70 bg-gradient-to-b from-slate-800/90 to-slate-900/90 shadow-2xl shadow-black/40 p-6 animate-[fadeIn_.18s_ease]">
        <div className="flex items-start gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl font-semibold select-none ${danger ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'}`}>!</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-slate-100 leading-tight mb-1">{title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed whitespace-pre-line">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-2 pt-4 border-t border-slate-700/60">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-700/60 hover:bg-slate-600/60 text-slate-200 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded-lg text-sm font-semibold shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed ${danger ? 'bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white'}`}
          >
            {loading ? (
              <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span><span>Procesando…</span></span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
};
