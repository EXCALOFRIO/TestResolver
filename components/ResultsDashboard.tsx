
import React from 'react';
import { Question, ResultsState, QuestionResult } from '../types';
import { QuestionCard } from './QuestionCard';

interface ResultsDashboardProps {
  questions: Question[];
  results: ResultsState;
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({ questions, results }) => {
  const resolvedCount = Object.values(results).filter((r: QuestionResult) => r.isResolved).length;
  const totalQuestions = questions.length;
  const overallProgress = totalQuestions > 0 ? (resolvedCount / totalQuestions) * 100 : 0;

  return (
    <div id="results-export-root" className="w-full max-w-6xl mx-auto space-y-6 lg:space-y-8">
      <div className="text-center space-y-4">
        
        <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/60 rounded-xl p-4 lg:p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="text-left">
              <p className="text-sm text-slate-400">Progreso General</p>
              <p className="text-xl lg:text-2xl font-bold text-slate-200">
                {resolvedCount} de {totalQuestions} completadas
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400">Precisión</p>
              <p className="text-xl lg:text-2xl font-bold text-indigo-400">
                {Math.round(overallProgress)}%
              </p>
            </div>
          </div>
          
          <div className="w-full bg-slate-700/50 rounded-full h-3">
            <div
              className="h-3 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-full transition-all duration-700"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>
      </div>
      
      <div className="space-y-6">
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            result={results[question.id] || { votes: {}, isResolved: false, expectedVotes: 0 }}
          />
        ))}
      </div>
    </div>
  );
};
