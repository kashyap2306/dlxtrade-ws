import React from 'react';

interface AnalysisDisplayProps {
  analysisSummary: {
    rsi?: number;
    maSignal?: string;
    volatility?: string;
    summary?: string;
  };
}

const AnalysisDisplay: React.FC<AnalysisDisplayProps> = ({
  analysisSummary
}) => {
  return (
    <>
      <div className="flex justify-between">
        <span className="text-slate-400">RSI</span>
        <span className={`font-semibold ${
          analysisSummary.rsi >= 70 ? 'text-red-400' :
          analysisSummary.rsi <= 30 ? 'text-green-400' :
          'text-yellow-400'
        }`}>
          {analysisSummary.rsi?.toFixed(1)}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">MA Signal</span>
        <span className={`font-semibold ${
          analysisSummary.maSignal === 'bullish' ? 'text-green-400' :
          analysisSummary.maSignal === 'bearish' ? 'text-red-400' :
          'text-slate-400'
        }`}>
          {analysisSummary.maSignal}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Volatility</span>
        <span className="font-semibold text-white">
          {analysisSummary.volatility}
        </span>
      </div>
      <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
        <p className="text-sm text-slate-300">
          {analysisSummary.summary}
        </p>
      </div>
    </>
  );
};

export default AnalysisDisplay;
