
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ImageIcon } from './icons/ImageIcon';
import { PaperclipIcon } from './icons/PaperclipIcon.tsx';

interface InputAreaProps {
  onFileSubmit?: (dataUrl: string) => void; // compat
  onFilesSubmit?: (dataUrls: string[]) => void; // múltiples
  onTextSubmit: (text: string) => void;
  // Nuevo: envío mixto
  onMixedSubmit?: (payload: { text: string; dataUrls: string[] }) => void;
  isLoading: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onFileSubmit, onFilesSubmit, onTextSubmit, onMixedSubmit, isLoading }) => {
  const [textValue, setTextValue] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [fileDataUrls, setFileDataUrls] = useState<string[]>([]); // cola de archivos/imágenes
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Forzar no expandido en pantallas móviles (<640px) para evitar recorte
  useEffect(() => {
    const check = () => {
      try {
        const w = window.innerWidth;
        if (w < 640) setExpanded(false);
      } catch {}
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const readFileToDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const MAX_FILES = 9;
  const enqueueFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (!list.length) return;
    const remaining = MAX_FILES - fileDataUrls.length;
    if (remaining <= 0) return;
    const allowed = list.slice(0, remaining);
    const dataUrls = await Promise.all(allowed.map(readFileToDataUrl));
    setFileDataUrls(prev => {
      const already = new Set(prev);
      const merged = [...prev];
      for (const d of dataUrls) {
        if (merged.length >= MAX_FILES) break;
        if (!already.has(d)) merged.push(d);
      }
      return merged;
    });
  }, [fileDataUrls.length]);

  const handleFileChange = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    enqueueFiles(fileList);
  }, [enqueueFiles]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      enqueueFiles(e.dataTransfer.files);
    }
  }, [enqueueFiles]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  
  const onDragLeave = () => setDragOver(false);
  // Soporte pegar imágenes desde portapapeles (Ctrl+V)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items || []);
      const imgItems = items.filter(it => it.type && it.type.startsWith('image/'));
      if (imgItems.length) {
        e.preventDefault();
        const blobs = await Promise.all(imgItems.map(it => new Promise<Blob>((res) => res(it.getAsFile() as Blob))));
        const files = blobs.map((b, i) => new File([b], `pasted-${Date.now()}-${i}.png`, { type: b.type || 'image/png' }));
        enqueueFiles(files);
      }
    };
    el.addEventListener('paste', onPaste as any);
    return () => el.removeEventListener('paste', onPaste as any);
  }, [enqueueFiles]);

  const handleSend = useCallback(() => {
    if (isLoading) return;
    const txt = textValue.trim();
    const hasFiles = fileDataUrls.length > 0;
    const hasTxt = txt.length > 0;
    // Si hay ambos tipos y hay handler mixto, usarlo
    if (hasFiles && hasTxt && onMixedSubmit) {
      onMixedSubmit({ text: txt, dataUrls: fileDataUrls });
      return;
    }
    // Solo archivos
    if (hasFiles) {
      if (onFilesSubmit) onFilesSubmit(fileDataUrls);
      else if (onFileSubmit) onFileSubmit(fileDataUrls[0]);
      return;
    }
    // Solo texto
    if (hasTxt) onTextSubmit(txt);
  }, [fileDataUrls, isLoading, onFilesSubmit, onFileSubmit, onTextSubmit, onMixedSubmit, textValue]);

  const clearFiles = useCallback(() => setFileDataUrls([]), []);
  const removeFileAt = useCallback((idx: number) => setFileDataUrls(prev => prev.filter((_,i)=>i!==idx)), []);

  // Bloquear scroll de la página cuando el área está expandida
  useEffect(() => {
    if (!expanded) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [expanded]);

  const hasText = textValue.trim().length > 0;
  // Ajuste de alturas más conservador para móviles pequeños
  const contentHeight = expanded
    ? 'min-h-[40vh] sm:min-h-[48vh] max-h-[70vh] sm:max-h-[82vh]'
    : hasText
      ? 'min-h-[18vh] sm:min-h-[20vh] max-h-[50vh] sm:max-h-[60vh]'
      : 'min-h-[80px] sm:min-h-[104px] max-h-[50vh] sm:max-h-[60vh]';
  // Determinar si el área está vacía (sin texto ni archivos)
  const isEmpty = !hasText && fileDataUrls.length === 0;

  return (
    <div
      ref={containerRef}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`w-full max-w-7xl mx-auto rounded-3xl border transition-all duration-300 ${dragOver ? 'border-violet-400/60 shadow-violet-500/20 shadow-2xl scale-[1.01]' : 'border-slate-700/40 shadow-xl'} bg-slate-900/30 backdrop-blur-xl p-3 sm:p-6 space-y-3 sm:space-y-4`}
    >
      {/* Thumbnails first - above input on mobile */}
      {fileDataUrls.length > 0 && (
        <div className="flex gap-3 flex-wrap p-3 sm:p-4 bg-slate-800/30 rounded-2xl border border-slate-700/40 w-full max-h-64 sm:max-h-72 overflow-y-auto thin-scroll pr-2">
          {fileDataUrls.map((du, idx) => {
            const m = du.match(/^data:(.+?);base64/);
            const mime = m ? m[1] : '';
            const isImg = mime.startsWith('image/');
            return (
              <div key={idx} className="relative group">
                    <div className="relative border-2 border-slate-600/40 rounded-2xl overflow-hidden bg-slate-900/30 hover:border-violet-400/50 transition-all duration-300 hover:scale-105">
                  {isImg ? (
                    <img src={du} alt={`img-${idx}`} className="w-14 h-14 sm:w-16 sm:h-16 object-cover" />
                  ) : (
                    <div className="w-14 h-14 sm:w-16 sm:h-16 flex flex-col items-center justify-center text-[9px] sm:text-[11px] text-slate-300 bg-gradient-to-br from-red-500/20 to-red-600/20">
                      <ImageIcon className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5" />
                      PDF
                    </div>
                  )}
                </div>
                <button
                  onClick={() => removeFileAt(idx)}
                  className="absolute -top-2 -right-2 bg-red-500/90 hover:bg-red-500 text-white text-sm w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-110 shadow-lg border-2 border-white/20"
                  aria-label="Eliminar"
                >
                  <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
          {/* Clear all button for mobile when files present */}
          <button 
            onClick={clearFiles} 
            className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-slate-700/50 hover:bg-slate-600/60 text-slate-300 hover:text-slate-200 rounded-2xl border border-slate-600/40 hover:border-slate-500/60 transition-all duration-300"
            title="Limpiar todo"
            aria-label="Limpiar archivos"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}

  {/* Input row - centered (botones dentro del cuadro) */}
  <div className="flex items-stretch justify-center w-full">
        {/* Input oculto para archivos */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,application/pdf"
          multiple
          onChange={(e)=>handleFileChange(e.target.files)}
        />

        {/* Content area con barra superior y botones internos */}
        <div
          className={`relative flex-1 max-w-none transition-all duration-300 ${contentHeight} overflow-hidden rounded-2xl bg-slate-800/40 backdrop-blur-md border border-slate-600/40 px-4 pt-6 pb-14 sm:px-8 sm:pt-8 sm:pb-18 focus-within:border-violet-400/60 focus-within:bg-slate-800/50 w-full`}
        >
          {/* Botón expandir en esquina superior derecha */}
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            title={expanded ? 'Reducir' : 'Ampliar'}
            // oculto en pantallas < sm y muestro en sm+
            className="absolute top-3 right-3 z-10 w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-slate-900/50 hover:bg-slate-800/60 text-slate-300 hover:text-white border border-slate-600/50 hover:border-violet-400/60 shadow-md flex items-center justify-center transition-all duration-200 hidden sm:flex"
          >
            {expanded ? (
              <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 14h6v6M20 10h-6V4" />
              </svg>
            ) : (
              <svg className="w-3 h-3 sm:w-4 sm:h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6v6M10 20H4v-6" />
              </svg>
            )}
          </button>

          {/* Barra inferior con botones dentro del cuadro */}
            <div className="absolute bottom-2 left-4 right-4 sm:left-6 sm:right-6 flex items-center justify-between gap-3 sm:gap-4 z-10 pointer-events-none">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="pointer-events-auto w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-slate-900/60 hover:bg-slate-800/70 text-violet-200 hover:text-white border border-slate-600/50 hover:border-violet-400/60 shadow-md flex items-center justify-center transition-all duration-200"
              title="Adjuntar (imagen/PDF)"
            >
              <PaperclipIcon className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <div className="flex-1" />

            {/* El botón de expandir ya está arriba, quitado de la barra inferior */}

            <button
              onClick={handleSend}
              disabled={isLoading || (fileDataUrls.length === 0 && !textValue.trim())}
              className="pointer-events-auto w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-500 hover:via-purple-500 hover:to-indigo-500 text-white flex items-center justify-center shadow-lg transition-all duration-200 border border-white/10"
              title="Enviar"
            >
              {isLoading ? (
                <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 transform translate-x-0.5">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                </svg>
              )}
            </button>
          </div>
          {/* Sin scrollbar del contenedor; el textarea manejará su propio overflow */}
          {/* Text input */}
          <textarea
            value={textValue}
            onChange={(e)=>setTextValue(e.target.value)}
            placeholder="Escribe o pega aquí las preguntas"
            className="w-full resize-none bg-transparent outline-none text-slate-100 placeholder-slate-400/60 text-base sm:text-lg leading-relaxed tracking-wide"
            rows={hasText ? (expanded ? 12 : 6) : 4}
            disabled={isLoading}
            style={{ minHeight: hasText ? (expanded ? '35vh' : '16vh') : '80px' }}
          />
        </div>
      </div>

      {/* Footer info - centered and minimal */}
      <div className="flex items-center justify-center text-xs text-slate-400/60">
        <span className="text-[10px] sm:text-xs">
          {fileDataUrls.length > 0
            ? `${fileDataUrls.length}/${MAX_FILES} archivo${fileDataUrls.length > 1 ? 's' : ''}${fileDataUrls.length >= MAX_FILES ? ' (máximo)' : ''}`
            : 'Ctrl+V para pegar imágenes'}
        </span>
      </div>
    </div>
  );
};
