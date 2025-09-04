
import React, { useState, useCallback } from 'react';
import { ImageIcon } from './icons/ImageIcon';
import { TextIcon } from './icons/TextIcon';

interface InputAreaProps {
  onFileSubmit: (dataUrl: string) => void;
  onTextSubmit: (text: string) => void;
  isLoading: boolean;
}

export const InputArea: React.FC<InputAreaProps> = ({ onFileSubmit, onTextSubmit, isLoading }) => {
  const [inputType, setInputType] = useState<'file' | 'text'>('file');
  const [textValue, setTextValue] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = useCallback((file: File | null) => {
    if (!file) return;
    // Aceptamos imágenes o PDFs
    const isSupported = file.type.startsWith('image/') || file.type === 'application/pdf';
    if (!isSupported) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      onFileSubmit(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, [onFileSubmit]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  }, [handleFileChange]);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  
  const onDragLeave = () => setDragOver(false);

  return (
    <div className="w-full max-w-4xl mx-auto bg-slate-800/30 backdrop-blur-md rounded-2xl p-6 lg:p-8 border border-slate-700/60 shadow-2xl">
      <div className="flex mb-6 border-b border-slate-700/50">
        <button
          onClick={() => setInputType('file')}
          className={`px-6 py-3 text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
            inputType === 'file' 
              ? 'text-indigo-400 border-b-2 border-indigo-400 bg-indigo-500/10' 
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
          } rounded-t-lg`}
        >
          <ImageIcon className="w-4 h-4" />
          Subir Archivo (Imagen/PDF)
        </button>
        <button
          onClick={() => setInputType('text')}
          className={`px-6 py-3 text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${
            inputType === 'text' 
              ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-500/10' 
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
          } rounded-t-lg`}
        >
          <TextIcon className="w-4 h-4" />
          Pegar Texto
        </button>
      </div>

  {inputType === 'file' ? (
        <div 
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`relative flex flex-col items-center justify-center w-full h-56 lg:h-64 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-300 ${dragOver ? 'border-indigo-400 bg-indigo-500/10 scale-[1.01]' : 'border-slate-600 hover:bg-slate-700/30 hover:border-slate-500'}`}
        >
          <input
            type="file"
            id="file-upload"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            onChange={(e) => handleFileChange(e.target.files ? e.target.files[0] : null)}
            accept="image/*,application/pdf"
            disabled={isLoading}
          />
          <div className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-200">
                <span className="text-indigo-400">Haz clic para subir</span> o arrastra y suelta
              </p>
              <p className="text-sm text-slate-400 mt-2">Imágenes (PNG/JPG) o PDF hasta 20MB</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <textarea
            className="w-full h-48 lg:h-56 p-4 lg:p-6 bg-slate-900/50 border border-slate-600 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 text-slate-100 placeholder-slate-400 backdrop-blur-sm"
            placeholder="Pega aquí el contenido del test con preguntas y opciones..."
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            disabled={isLoading}
          />
          <div className="flex justify-center">
            <button 
              onClick={() => onTextSubmit(textValue)} 
              disabled={isLoading || !textValue.trim()}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-xl transition-all duration-300 hover:scale-105 disabled:scale-100 shadow-lg shadow-purple-900/30"
            >
              {isLoading ? 'Procesando...' : 'Analizar Texto'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
