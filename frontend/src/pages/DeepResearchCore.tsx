import React from 'react';

interface DeepResearchResult {
  id?: string;
  result?: {
    signal?: 'BUY' | 'SELL' | 'HOLD';
    accuracy?: number;
    indicators?: any;
    raw?: {
      marketData?: {
        price?: number;
      };
    };
    providers?: {
      marketData?: { success?: boolean };
      metadata?: { success?: boolean };
      news?: { success?: boolean };
    };
  };
  news?: {
    articles?: any[];
  };
  metadata?: any;
  error?: string;
}

interface DeepResearchCoreProps {
  result: DeepResearchResult;
  settings?: any;
}

const DeepResearchCore: React.FC<DeepResearchCoreProps> = ({
  result,
  settings
}) => {
  return (
    <div className="space-y-6 animate-stagger">
      {/* PRICE HEADER BANNER */}
      <div className="bg-slate-800 p-4 rounded">
        <div>Price Header</div>
      </div>

      {/* SIGNAL PANEL - Temporarily commented out due to adjacent JSX elements issue */}
      {/* <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden"> */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-cyan-500/5"></div>
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500"></div>

      <div className="relative">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Signal Panel
          </h3>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-sm text-slate-300">Live Analysis</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Signal */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
            <div className="text-sm text-slate-400 mb-2">Signal</div>
            <div className={`text-2xl font-bold ${result.result?.signal === 'BUY' ? 'text-green-400' :
              result.result?.signal === 'SELL' ? 'text-red-400' :
                'text-slate-400'
              }`}>
              {result.result?.signal || 'HOLD'}
            </div>
          </div>

          {/* Accuracy */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
            <div className="text-sm text-slate-400 mb-2">Accuracy</div>
            <div className={`text-2xl font-bold ${((result.result?.accuracy || 0) * 100) >= 70 ? 'text-green-400' :
              ((result.result?.accuracy || 0) * 100) >= 50 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
              {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(1) : 0}%
            </div>
          </div>


          {/* Market Regime */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
            <div className="text-sm text-slate-400 mb-2">Market Regime</div>
            <div className={`text-lg font-bold ${(() => {
              const indicators = result.result?.indicators || {};
              let bullishSignals = 0;
              let bearishSignals = 0;

              // MACD signal
              if (indicators.macd?.value > 0) bullishSignals++;
              else if (indicators.macd?.value < 0) bearishSignals++;

              // RSI signal
              if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
              else if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++;

              // Moving averages
              const price = result.result?.raw?.marketData?.price || 0;
              if (indicators.ma50?.value && indicators.ma200?.value) {
                if (price > indicators.ma50.value && indicators.ma50.value > indicators.ma200.value) bullishSignals++;
                else if (price < indicators.ma200.value) bearishSignals++;
              }

              // Volume
              if (indicators.volume?.score && indicators.volume.score > 60) bullishSignals++;
              else if (indicators.volume?.score && indicators.volume.score < 40) bearishSignals++;

              if (bullishSignals > bearishSignals) return 'text-green-400';
              else if (bearishSignals > bullishSignals) return 'text-red-400';
              else return 'text-slate-400';
            })()
              }`}>
              {(() => {
                const indicators = result.result?.indicators || {};
                let bullishSignals = 0;
                let bearishSignals = 0;

                if (indicators.macd?.value > 0) bullishSignals++;
                else if (indicators.macd?.value < 0) bearishSignals++;

                if (indicators.rsi?.value && indicators.rsi.value > 70) bearishSignals++;
                else if (indicators.rsi?.value && indicators.rsi.value < 30) bullishSignals++;

                const price = result.result?.raw?.marketData?.price || 0;
                if (indicators.ma50?.value && indicators.ma200?.value) {
                  if (price > indicators.ma50.value && indicators.ma50.value > indicators.ma200.value) bullishSignals++;
                  else if (price < indicators.ma200.value) bearishSignals++;
                }

                if (indicators.volume?.score && indicators.volume.score > 60) bullishSignals++;
                else if (indicators.volume?.score && indicators.volume.score < 40) bearishSignals++;

                if (bullishSignals > bearishSignals) return 'Bullish';
                else if (bearishSignals > bullishSignals) return 'Bearish';
                else return 'Neutral';
              })()}
            </div>
          </div>

          {/* Trend Summary */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
            <div className="text-sm text-slate-400 mb-2">Trend Summary</div>
            <div className="text-lg font-bold text-white">
              {result.result?.signal === 'BUY' ? 'Bullish' :
                result.result?.signal === 'SELL' ? 'Bearish' : 'Neutral'}
            </div>
          </div>
        </div>
      </div>


      {/* SUPPORT and RESISTANCE CARD */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-green-500/5 to-teal-500/5"></div>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500"></div>

        <div className="relative">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Support & Resistance
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
            {/* Resistance Levels */}
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-white mb-4">Resistance Levels</h4>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Major Resistance</span>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400">
                    Strong
                  </span>
                </div>
                <div className="text-xl font-bold text-white">
                  ${(() => {
                    const indicators = result.result?.indicators || {};
                    const price = result.result?.raw?.marketData?.price || 0;

                    // Major resistance: highest of recent highs or MA200 if price is below it
                    if (indicators.ma200?.value && price < indicators.ma200.value) {
                      return indicators.ma200.value.toFixed(2);
                    }
                    // Use MA50 as resistance if price is below it
                    if (indicators.ma50?.value && price < indicators.ma50.value) {
                      return indicators.ma50.value.toFixed(2);
                    }
                    // Calculate based on ATR for resistance level
                    if (indicators.atr?.value && price) {
                      return (price + (indicators.atr.value * 2)).toFixed(2);
                    }
                    return 'N/A';
                  })()}
                </div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Minor Resistance</span>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-orange-500/20 text-orange-400">
                    Moderate
                  </span>
                </div>
                <div className="text-xl font-bold text-white">
                  ${(() => {
                    const indicators = result.result?.indicators || {};
                    const price = result.result?.raw?.marketData?.price || 0;

                    // Minor resistance: EMA20 or MA50 if above current price
                    if (indicators.ema20?.value && price < indicators.ema20.value) {
                      return indicators.ema20.value.toFixed(2);
                    }
                    if (indicators.ma50?.value && price < indicators.ma50.value) {
                      return indicators.ma50.value.toFixed(2);
                    }
                    // Calculate based on ATR for minor resistance
                    if (indicators.atr?.value && price) {
                      return (price + indicators.atr.value).toFixed(2);
                    }
                    return 'N/A';
                  })()}
                </div>
              </div>
            </div>

            {/* Support Levels */}
            <div className="space-y-4">
              <h4 className="text-lg font-semibold text-white mb-4">Support Levels</h4>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Major Support</span>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                    Strong
                  </span>
                </div>
                <div className="text-xl font-bold text-white">
                  ${(() => {
                    const indicators = result.result?.indicators || {};
                    const price = result.result?.raw?.marketData?.price || 0;

                    // Major support: lowest of recent lows or MA200 if price is above it
                    if (indicators.ma200?.value && price > indicators.ma200.value) {
                      return indicators.ma200.value.toFixed(2);
                    }
                    // Use MA50 as support if price is above it
                    if (indicators.ma50?.value && price > indicators.ma50.value) {
                      return indicators.ma50.value.toFixed(2);
                    }
                    // Calculate based on ATR for support level
                    if (indicators.atr?.value && price) {
                      return (price - (indicators.atr.value * 2)).toFixed(2);
                    }
                    return 'N/A';
                  })()}
                </div>
              </div>

              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Minor Support</span>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                    Moderate
                  </span>
                </div>
                <div className="text-xl font-bold text-white">
                  ${(() => {
                    const indicators = result.result?.indicators || {};
                    const price = result.result?.raw?.marketData?.price || 0;

                    // Minor support: EMA20 or MA50 if below current price
                    if (indicators.ema20?.value && price > indicators.ema20.value) {
                      return indicators.ema20.value.toFixed(2);
                    }
                    if (indicators.ma50?.value && price > indicators.ma50.value) {
                      return indicators.ma50.value.toFixed(2);
                    }
                    // Calculate based on ATR for minor support
                    if (indicators.atr?.value && price) {
                      return (price - indicators.atr.value).toFixed(2);
                    }
                    return 'N/A';
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AUTO-TRADE READINESS CARD */}
      {settings?.autoTradeEnabled && (
        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 via-pink-500/5 to-purple-500/5"></div>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-rose-500 via-pink-500 to-purple-500"></div>

          <div className="relative">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Auto-Trade Readiness
              </h3>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-sm text-slate-300">Active</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Status */}
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="text-sm text-slate-400 mb-2">Auto-Trade Status</div>
                <div className="text-lg font-bold text-green-400">Enabled</div>
                <div className="text-xs text-slate-400 mt-1">System is active</div>
              </div>

              {/* Next Evaluation */}
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="text-sm text-slate-400 mb-2">Next Evaluation</div>
                <div className="text-lg font-bold text-white">Every 5 min</div>
                <div className="text-xs text-slate-400 mt-1">Continuous monitoring</div>
              </div>

              {/* Accuracy Threshold */}
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="text-sm text-slate-400 mb-2">Accuracy Threshold</div>
                <div className={`text-lg font-bold ${(settings.minAccuracyThreshold || 0.85) >= 0.75 ? 'text-green-400' :
                  (settings.minAccuracyThreshold || 0.85) >= 0.65 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                  {(settings.minAccuracyThreshold || 0.85) * 100}%
                </div>
                <div className="text-xs text-slate-400 mt-1">Minimum for execution</div>
              </div>

              {/* Current Eligibility */}
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
                <div className="text-sm text-slate-400 mb-2">Current Eligibility</div>
                <div className={`text-lg font-bold ${((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'text-green-400' : 'text-red-400'
                  }`}>
                  {((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'Eligible' : 'Not Eligible'}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Current: {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(0) : 0}%
                </div>
              </div>
            </div>

            {/* Trade Execution Condition */}
            <div className="mt-6 bg-slate-800/30 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-300">Trade Execution Condition</h4>
                <div className={`px-3 py-1 rounded-full text-xs font-semibold ${((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                  }`}>
                  {((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ? '✓ Ready to Execute' : '⏸ Below Threshold'}
                </div>
              </div>
              <div className="text-sm text-slate-400">
                Auto-trading will {((result.result?.accuracy || 0) * 100) >= ((settings.minAccuracyThreshold || 0.85) * 100) ?
                  'execute trades when signals are generated' : 'skip trades until accuracy improves'}.
                Next evaluation in approximately 5 minutes.
              </div>
            </div>

            {/* Warnings */}
            {(!result.result?.providers?.marketData?.success ||
              !result.result?.providers?.metadata?.success ||
              !result.result?.providers?.news?.success) && (
                <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <div className="flex items-center gap-2 text-yellow-400 text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <span>Some data providers are unavailable. Auto-trading may be limited.</span>
                  </div>
                </div>
              )}
          </div>
        </div>
      )}

      {/* AI FINAL VERDICT */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
        <div className={`absolute inset-0 ${result.result?.signal === 'BUY' ? 'bg-gradient-to-br from-green-500/10 via-emerald-500/5 to-teal-500/10' :
          result.result?.signal === 'SELL' ? 'bg-gradient-to-br from-red-500/10 via-rose-500/5 to-pink-500/10' :
            'bg-gradient-to-br from-yellow-500/10 via-amber-500/5 to-orange-500/10'
          }`}></div>
        <div className={`absolute top-0 left-0 right-0 h-1 ${result.result?.signal === 'BUY' ? 'bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500' :
          result.result?.signal === 'SELL' ? 'bg-gradient-to-r from-red-500 via-rose-500 to-pink-500' :
            'bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-500'
          }`}></div>

        <div className="relative">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI Final Verdict
            </h3>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full animate-pulse ${result.result?.signal === 'BUY' ? 'bg-green-400' :
                result.result?.signal === 'SELL' ? 'bg-red-400' :
                  'bg-yellow-400'
                }`}></div>
              <span className="text-sm text-slate-300">Analysis Complete</span>
            </div>
          </div>

          <div className="space-y-4">
            {/* Verdict & Confidence */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`text-4xl font-bold ${result.result?.signal === 'BUY' ? 'text-green-400' :
                  result.result?.signal === 'SELL' ? 'text-red-400' :
                    'text-yellow-400'
                  }`}>
                  {result.result?.signal || 'HOLD'}
                </div>
                <div className="text-center">
                  <div className="text-sm text-slate-400">Confidence</div>
                  <div className={`text-2xl font-bold ${((result.result?.accuracy || 0) * 100) >= 70 ? 'text-green-400' :
                    ((result.result?.accuracy || 0) * 100) >= 50 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                    {result.result?.accuracy ? (result.result.accuracy * 100).toFixed(0) : 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* Why Section */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <div className="text-sm font-medium text-slate-300 mb-2">Why?</div>
              <div className="text-sm text-slate-400 leading-relaxed">
                {(() => {
                  const signal = result.result?.signal;
                  const indicators = result.result?.indicators || {};
                  const news = result.news?.articles || [];
                  const reasons = [];

                  // Indicator-based reasons
                  if (indicators.macd?.value > 0 && signal === 'BUY') reasons.push('MACD shows bullish momentum');
                  if (indicators.macd?.value < 0 && signal === 'SELL') reasons.push('MACD indicates bearish momentum');

                  if (indicators.rsi?.value < 30 && signal === 'BUY') reasons.push('RSI suggests oversold conditions');
                  if (indicators.rsi?.value > 70 && signal === 'SELL') reasons.push('RSI indicates overbought conditions');

                  const price = result.result?.raw?.marketData?.price || 0;
                  if (indicators.ma50?.value && price > indicators.ma50.value && signal === 'BUY') reasons.push('Price above key moving averages');
                  if (indicators.ma50?.value && price < indicators.ma50.value && signal === 'SELL') reasons.push('Price below key moving averages');

                  // News sentiment reasons
                  const positiveArticles = news.filter((a: any) => a.sentiment === 'positive').length;
                  const negativeArticles = news.filter((a: any) => a.sentiment === 'negative').length;

                  if (positiveArticles > negativeArticles && signal === 'BUY') reasons.push('Positive news sentiment supports bullish outlook');
                  if (negativeArticles > positiveArticles && signal === 'SELL') reasons.push('Negative news sentiment aligns with bearish signal');

                  // Volume reasons
                  if (indicators.volume?.score && indicators.volume.score > 60 && signal === 'BUY') reasons.push('Strong volume confirms upward momentum');
                  if (indicators.volume?.score && indicators.volume.score < 40 && signal === 'SELL') reasons.push('Low volume suggests continued downward pressure');

                  return reasons.length > 0 ? reasons.slice(0, 3).join('. ') + '.' : 'Signal based on comprehensive technical analysis.';
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MARKET REGIME CARD */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-blue-500/5 to-purple-500/5"></div>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-blue-500 to-purple-500"></div>

        <div className="relative">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
            Market Regime
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Trend 1h */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <div className="text-sm text-slate-400 mb-2">Trend 1h</div>
              <div className={`text-lg font-bold ${(() => {
                // Derive from short-term indicators like EMA20 vs price
                const indicators = result.result?.indicators || {};
                const price = result.result?.raw?.marketData?.price || 0;
                if (indicators.ema20?.value) {
                  return price > indicators.ema20.value ? 'text-green-400' : 'text-red-400';
                }
                return 'text-slate-400';
              })()
                }`}>
                {(() => {
                  const indicators = result.result?.indicators || {};
                  const price = result.result?.raw?.marketData?.price || 0;
                  if (indicators.ema20?.value) {
                    return price > indicators.ema20.value ? 'Bullish' : 'Bearish';
                  }
                  return 'Neutral';
                })()}
              </div>
            </div>

            {/* Trend 1d */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <div className="text-sm text-slate-400 mb-2">Trend 1d</div>
              <div className={`text-lg font-bold ${(() => {
                // Derive from daily indicators like MA50 vs price
                const indicators = result.result?.indicators || {};
                const price = result.result?.raw?.marketData?.price || 0;
                if (indicators.ma50?.value) {
                  return price > indicators.ma50.value ? 'text-green-400' : 'text-red-400';
                }
                return 'text-slate-400';
              })()
                }`}>
                {(() => {
                  const indicators = result.result?.indicators || {};
                  const price = result.result?.raw?.marketData?.price || 0;
                  if (indicators.ma50?.value) {
                    return price > indicators.ma50.value ? 'Bullish' : 'Bearish';
                  }
                  return 'Neutral';
                })()}
              </div>
            </div>

            {/* Confirmation Signal */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <div className="text-sm text-slate-400 mb-2">Confirmation Signal</div>
              <div className={`text-lg font-bold ${result.result?.signal === 'BUY' ? 'text-green-400' :
                result.result?.signal === 'SELL' ? 'text-red-400' :
                  'text-slate-400'
                }`}>
                {result.result?.signal || 'HOLD'}
              </div>
            </div>

            {/* Overall Regime */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
              <div className="text-sm text-slate-400 mb-2">Overall Regime</div>
              <div className={`text-lg font-bold ${(() => {
                const indicators = result.result?.indicators || {};
                let bullishCount = 0;
                let bearishCount = 0;
                const price = result.result?.raw?.marketData?.price || 0;

                // Check multiple indicators
                if (indicators.macd?.value > 0) bullishCount++; else if (indicators.macd?.value < 0) bearishCount++;
                if (indicators.rsi?.value && indicators.rsi.value < 30) bullishCount++; else if (indicators.rsi?.value && indicators.rsi.value > 70) bearishCount++;
                if (indicators.ema20?.value && price > indicators.ema20.value) bullishCount++; else if (indicators.ema20?.value && price < indicators.ema20.value) bearishCount++;
                if (indicators.ma50?.value && price > indicators.ma50.value) bullishCount++; else if (indicators.ma50?.value && price < indicators.ma50.value) bearishCount++;
                if (indicators.volume?.score && indicators.volume.score > 60) bullishCount++; else if (indicators.volume?.score && indicators.volume.score < 40) bearishCount++;

                const total = bullishCount + bearishCount;
                if (total === 0) return 'text-slate-400';

                const bullishRatio = bullishCount / total;

                if (bullishRatio >= 0.8) return 'text-green-400';
                else if (bullishRatio >= 0.6) return 'text-emerald-400';
                else if (bullishRatio <= 0.2) return 'text-red-400';
                else if (bullishRatio <= 0.4) return 'text-red-300';
                else return 'text-slate-400';
              })()
                }`}>
                {(() => {
                  const indicators = result.result?.indicators || {};
                  let bullishCount = 0;
                  let bearishCount = 0;
                  const price = result.result?.raw?.marketData?.price || 0;

                  if (indicators.macd?.value > 0) bullishCount++; else if (indicators.macd?.value < 0) bearishCount++;
                  if (indicators.rsi?.value && indicators.rsi.value < 30) bullishCount++; else if (indicators.rsi?.value && indicators.rsi.value > 70) bearishCount++;
                  if (indicators.ema20?.value && price > indicators.ema20.value) bullishCount++; else if (indicators.ema20?.value && price < indicators.ema20.value) bearishCount++;
                  if (indicators.ma50?.value && price > indicators.ma50.value) bullishCount++; else if (indicators.ma50?.value && price < indicators.ma50.value) bearishCount++;
                  if (indicators.volume?.score && indicators.volume.score > 60) bullishCount++; else if (indicators.volume?.score && indicators.volume.score < 40) bearishCount++;

                  const total = bullishCount + bearishCount;
                  if (total === 0) return 'Neutral';

                  const bullishRatio = bullishCount / total;

                  if (bullishRatio >= 0.8) return 'Strong Bullish';
                  else if (bullishRatio >= 0.6) return 'Weak Bullish';
                  else if (bullishRatio <= 0.2) return 'Strong Bearish';
                  else if (bullishRatio <= 0.4) return 'Weak Bearish';
                  else return 'Neutral';
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RAW DATA TOGGLE */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 via-slate-500/5 to-gray-500/5"></div>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gray-500 via-slate-500 to-gray-500"></div>

        <div className="relative">
          <details className="group">
            <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-slate-300 hover:text-white transition-colors" aria-label="Toggle raw data display">
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Show Raw Data
              </span>
              <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="mt-4 p-4 bg-slate-800/50 rounded-lg border border-slate-600/30 max-h-96 overflow-auto">
              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-all">
                {JSON.stringify({
                  providers: result.result?.providers,
                  indicators: result.result?.indicators,
                  metadata: result.metadata,
                  news: result.news,
                  signals: {
                    signal: result.result?.signal,
                    accuracy: result.result?.accuracy,
                    price: result.result?.raw?.marketData?.price
                  },
                  raw: result.result?.raw
                }, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      </div>

      {/* FREE MODE Analysis v1.5 */}
      <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg p-4 border border-purple-500/30">
        <h4 className="text-sm font-semibold text-purple-300 mb-2">FREE MODE Analysis v1.5</h4>
        <div className="text-sm text-gray-200">
          Analysis completed using CryptoCompare market data, CoinGecko metadata, and NewsData sentiment with comprehensive backup provider support.
        </div>
      </div>

      {result.error && (
        <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
          <p className="text-sm text-red-300">Error: {result.error}</p>
        </div>
      )}
    </div>
  );
};

export default DeepResearchCore;
