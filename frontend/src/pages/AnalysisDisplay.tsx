import React from 'react';

const AnalysisDisplay: React.FC<any> = ({
  result
}) => {
  const analysis = (result as any)?.analysis;
  const indicators = analysis?.technicalIndicators || {};
  const priceAction = analysis?.priceAction || {};
  const volatility = analysis?.volatility || {};

  // Defensive fallback helper based on stage status
  const getFallback = (val: any, stageName: string = '') => {
    if (val !== null && val !== undefined) return val;

    const stages = (result as any)?.stages || {};
    const stage = stageName ? stages[stageName] : null;

    // If research is done (completed/partial) OR the root result says partial, show N/A
    const isDone = stage?.status === "completed" || stage?.status === "partial" || (result as any)?.partial;

    if (isDone) return "N/A";

    if (stage?.status === "running" || stage?.status === "started") {
      return "Processing...";
    }

    return "N/A";
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between">
        <span className="text-slate-400">RSI</span>
        <span className={`font-semibold ${indicators.rsi?.value !== undefined && indicators.rsi.value >= 70 ? 'text-red-400' :
          indicators.rsi?.value !== undefined && indicators.rsi.value <= 30 ? 'text-green-400' :
            'text-yellow-400'
          }`}>
          {indicators.rsi?.value ? indicators.rsi.value.toFixed(1) : getFallback(null, 'Analyze trend & RSI')}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">MA Signal</span>
        <span className={`font-semibold ${priceAction.ma50?.smaTrend === 'bullish' ? 'text-green-400' :
          priceAction.ma50?.smaTrend === 'bearish' ? 'text-red-400' :
            'text-slate-400'
          }`}>
          {priceAction.ma50?.smaTrend ? (priceAction.ma50.smaTrend.charAt(0).toUpperCase() + priceAction.ma50.smaTrend.slice(1)) : getFallback(null, 'Analyze trend & RSI')}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-slate-400">Volatility</span>
        <span className="font-semibold text-white">
          {volatility?.atrPct ? `${volatility.atrPct.toFixed(2)}%` : getFallback(null, 'Calculate MACD & volume')}
        </span>
      </div>
      <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
        <p className="text-sm text-slate-300">
          {result.explanation || 'Analysis summary is currently being generated...'}
        </p>
      </div>
    </div>
  );
};

export default AnalysisDisplay;
