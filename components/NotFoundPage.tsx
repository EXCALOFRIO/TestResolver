import React from 'react';
import { SparklesIcon } from './icons/SparklesIcon';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(1200px_600px_at_50%_-200px,rgba(120,119,198,0.55),transparent)] from-slate-800 to-slate-900 text-slate-100">
      <header className="relative z-10 flex-shrink-0 pt-10 pb-4 px-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 flex items-center gap-2">
            <SparklesIcon className="w-8 h-8 text-indigo-400" />
            TestSolver
          </h1>
          <a href="/" className="text-sm px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-600 hover:border-slate-500 hover:bg-slate-700 transition-colors">Inicio</a>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 pb-24">
        <div className="w-full max-w-xl mx-auto text-center relative">
          <div className="absolute inset-0 -z-10 blur-3xl opacity-30 bg-gradient-to-br from-indigo-600/40 via-purple-600/40 to-pink-600/30 rounded-full" />
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium bg-indigo-500/10 border border-indigo-400/30 text-indigo-200 mb-6">
            Error 404
          </div>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 mb-6">
            Página no encontrada
          </h2>
          <p className="text-slate-300 leading-relaxed max-w-prose mx-auto mb-8">
            La ruta que intentas abrir no existe o fue movida. Puede que el enlace esté desactualizado.
            Vuelve al panel principal para crear o resolver tests.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/" className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 font-semibold shadow-lg shadow-indigo-800/30 transition-colors">
              Volver al inicio
            </a>
            <button onClick={() => window.history.back()} className="px-6 py-3 rounded-xl bg-slate-800/70 border border-slate-600 hover:bg-slate-700 hover:border-slate-500 font-medium transition-colors">
              Volver atrás
            </button>
          </div>
          {/* Tarjetas informativas eliminadas para una 404 más minimalista */}
        </div>
      </main>
    </div>
  );
};
