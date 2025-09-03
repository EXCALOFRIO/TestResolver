
import React from 'react';
import { Question, QuestionResult } from '../types';
import { CheckIcon } from './icons/CheckIcon';

interface QuestionCardProps {
  question: Question;
  result: QuestionResult;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({ question, result }) => {
  const totalVotes = Object.values(result.votes).flat().length;
  const currentProgress = Math.min((totalVotes / (result.expectedVotes || 1)) * 100, 100);
  
  const getOptionStats = (optionKey: string) => {
    const votes = result.votes[optionKey] || [];
    const percentage = result.expectedVotes ? (votes.length / result.expectedVotes) * 100 : 0;
    return { count: votes.length, percentage };
  };

  const isHighConfidence = (result.confidence || 0) > 50;

  return (
    <div className="bg-slate-800/40 backdrop-blur-sm border border-slate-700/60 rounded-xl p-4 lg:p-6 shadow-xl hover:shadow-2xl transition-all duration-300 hover:border-slate-600/80">
      <div className="flex flex-wrap items-start justify-between mb-3 gap-3">
        <div>
          <h3 className="text-base lg:text-lg font-semibold text-slate-200 leading-tight mb-1">
            Pregunta {question.id}
          </h3>
          {question.meta && (
            <div className="flex flex-wrap gap-2">
              {question.meta.multi && <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold tracking-wide border border-indigo-500/40">MULTI</span>}
              {/* Badge NEGATIVA: pregunta redactada en negativo ("EXCEPTO", "NO es", etc.) */}
              {question.meta.negative && <span className="px-2 py-0.5 rounded bg-pink-500/20 text-pink-300 text-[10px] font-semibold tracking-wide border border-pink-500/40">NEGATIVA</span>}
              {question.meta.assertionReason && <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold tracking-wide border border-amber-500/40">ASERCIÓN-RAZÓN</span>}
              {question.meta.matching && <span className="px-2 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 text-[10px] font-semibold tracking-wide border border-fuchsia-500/40">RELACIÓN</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {result.isResolved && (
            <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
              isHighConfidence 
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
            }`}>
              <CheckIcon className="w-3 h-3" />
              {Math.round(result.confidence || 0)}%
            </div>
          )}
        </div>
      </div>
      
      <p className="text-slate-300 mb-6 leading-relaxed text-sm lg:text-base">
        {question.pregunta}
      </p>
      
      <div className="space-y-3">
        {Object.entries(question.opciones).map(([key, option]) => {
          const stats = getOptionStats(key);
          const isSelected = result.finalAnswer === key;
          
          return (
            <div
              key={key}
              className={`relative p-3 lg:p-4 rounded-lg border transition-all duration-300 ${
                isSelected && isHighConfidence
                  ? 'bg-gradient-to-r from-emerald-500/20 to-emerald-600/10 border-emerald-500/60 shadow-lg shadow-emerald-900/20'
                  : isSelected
                  ? 'bg-gradient-to-r from-amber-500/20 to-amber-600/10 border-amber-500/60'
                  : 'bg-slate-700/30 border-slate-600/50 hover:border-slate-500/70'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-slate-200 text-sm lg:text-base">
                  {key}) {option}
                </span>
                {stats.count > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-mono">
                      {stats.count} votos
                    </span>
                    <span className={`text-xs font-semibold ${
                      isSelected && isHighConfidence ? 'text-emerald-300' : 'text-slate-400'
                    }`}>
                      {Math.round(stats.percentage)}%
                    </span>
                  </div>
                )}
              </div>
              
              {stats.count > 0 && (
                <div className="w-full bg-slate-600/50 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${
                      isSelected && isHighConfidence
                        ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                        : isSelected
                        ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                        : 'bg-gradient-to-r from-slate-500 to-slate-400'
                    }`}
                    style={{ width: `${Math.min(stats.percentage, 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      <div className="mt-4 pt-4 border-t border-slate-700/50">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span>Progreso del análisis</span>
          <span>{Math.round(currentProgress)}%</span>
        </div>
        <div className="w-full bg-slate-700/50 rounded-full h-2">
          <div
            className="h-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
            style={{ width: `${currentProgress}%` }}
          />
        </div>
      </div>
    </div>
  );
};
