
import React from 'react';
import { STRATEGIES } from '../constants';
import { Strategy, StrategyKey } from '../types';
import { CheckIcon } from './icons/CheckIcon';

interface StrategySelectorProps {
  selectedStrategies: StrategyKey[];
  onStrategyToggle: (strategyKey: StrategyKey) => void;
}

const StrategyCard: React.FC<{
  strategy: Strategy;
  isSelected: boolean;
  onToggle: () => void;
}> = ({ strategy, isSelected, onToggle }) => (
  <div
    onClick={onToggle}
    className={`relative p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
      isSelected
        ? 'bg-slate-700 border-indigo-500 shadow-lg scale-105'
        : 'bg-slate-800 border-slate-700 hover:border-slate-500'
    }`}
  >
    {isSelected && (
      <div className="absolute top-2 right-2 bg-indigo-500 text-white rounded-full p-1">
        <CheckIcon className="w-3 h-3" />
      </div>
    )}
    <h3 className="font-bold text-white">{strategy.name}</h3>
    <p className="text-sm text-slate-400 mt-1">{strategy.description}</p>
    <div className="text-xs text-indigo-400 mt-2 font-mono">
      Cost: {strategy.cost} request{strategy.cost > 1 ? 's' : ''}
    </div>
  </div>
);

export const StrategySelector: React.FC<StrategySelectorProps> = ({ selectedStrategies, onStrategyToggle }) => {
  return (
    <div className="w-full max-w-4xl mx-auto mt-8">
      <h2 className="text-xl font-bold text-center mb-4 text-slate-300">
        Selecciona estrategias
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {STRATEGIES.map((strategy) => (
          <StrategyCard
            key={strategy.key}
            strategy={strategy}
            isSelected={selectedStrategies.includes(strategy.key)}
            onToggle={() => onStrategyToggle(strategy.key)}
          />
        ))}
      </div>
    </div>
  );
};
