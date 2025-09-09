import React, { useState } from 'react';
import { createPortal } from 'react-dom';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareUrl?: string;
  testName: string;
  loading?: boolean;
  error?: string | null;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, shareUrl = '', testName, loading, error }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error copiando:', err);
    }
  };

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 animate-[fadeIn_.2s_ease]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            {loading && <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />}
            Compartir Test
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl leading-none p-1 rounded hover:bg-slate-700/50 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-300 mb-2">
              {error ? (
                <span className="text-red-400">No se pudo generar el enlace. Intenta de nuevo.</span>
              ) : (
                <>Comparte <span className="font-medium text-slate-100">"{testName}"</span> con este enlace:</>
              )}
            </p>

            {/* URL / Loading state */}
            <div className="bg-slate-900/60 border border-slate-600 rounded-lg p-3 mb-3 min-h-[48px] flex items-center">
              {loading && !error && !shareUrl && (
                <div className="flex items-center gap-2 text-indigo-300 text-sm">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generando enlace seguro...
                </div>
              )}
              {!loading && error && (
                <code className="text-xs text-red-400 break-all select-all">{error}</code>
              )}
              {!loading && !error && shareUrl && (
                <code className="text-sm text-slate-200 break-all select-all w-full">{shareUrl}</code>
              )}
            </div>

            {/* Copy Button */}
            <button
              disabled={!shareUrl || !!error || loading}
              onClick={handleCopy}
              className={`w-full px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-[1.02]'
              }`}
            >
              {copied ? (
                <span className="flex items-center justify-center gap-2">
                  <span>✓</span>
                  ¡Copiado!
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <span>📋</span>
                  Copiar enlace
                </span>
              )}
            </button>
          </div>

          <div className="text-xs text-slate-400 text-center pt-2 border-t border-slate-700">
            {error ? 'Vuelve a intentar en unos segundos.' : 'Cualquier persona con este enlace podrá ver el test.'}
          </div>
        </div>
      </div>
    </div>
  );

  // Portal para asegurarnos que el modal NO quede restringido por el panel lateral
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
};
