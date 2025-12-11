import React from 'react';

interface DeepResearchAnalysisProps {
  result: {
    result?: {
      indicators?: any;
    };
  };
}

const DeepResearchAnalysis: React.FC<DeepResearchAnalysisProps> = ({
  result
}) => {
  return (
    <>
      {/* INDICATORS PANEL */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 sm:p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-indigo-500/5 to-purple-500/5"></div>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>

        <div className="relative">
          <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Technical Indicators
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
            {/* RSI */}
            {result.result?.indicators?.rsi && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">RSI</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.rsi?.value || 0) > 70 ? 'bg-red-500/20 text-red-400' :
                    (result.result?.indicators?.rsi?.value || 0) < 30 ? 'bg-green-500/20 text-green-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                    {(result.result?.indicators?.rsi?.value || 0) > 70 ? 'Overbought' :
                      (result.result?.indicators?.rsi?.value || 0) < 30 ? 'Oversold' :
                        'Neutral'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-white">{result.result?.indicators?.rsi?.value?.toFixed(1) || 'N/A'}</div>
              </div>
            )}

            {/* SMA50 */}
            {result.result?.indicators?.ma50 && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">SMA50</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ma50?.value || 0) > (result.result?.indicators?.ma50?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                    }`}>
                    {(result.result?.indicators?.ma50?.value || 0) > (result.result?.indicators?.ma50?.price || 0) ? 'Resistance' : 'Support'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">${result.result?.indicators?.ma50?.value?.toFixed(2) || 'N/A'}</div>
              </div>
            )}

            {/* SMA200 */}
            {result.result?.indicators?.ma200 && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">SMA200</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ma200?.value || 0) > (result.result?.indicators?.ma200?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                    }`}>
                    {(result.result?.indicators?.ma200?.value || 0) > (result.result?.indicators?.ma200?.price || 0) ? 'Resistance' : 'Support'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">${result.result?.indicators?.ma200?.value?.toFixed(2) || 'N/A'}</div>
              </div>
            )}

            {/* EMA20 */}
            {result.result?.indicators?.ema20 && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">EMA20</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ema20?.value || 0) > (result.result?.indicators?.ema20?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                    }`}>
                    {(result.result?.indicators?.ema20?.value || 0) > (result.result?.indicators?.ema20?.price || 0) ? 'Resistance' : 'Support'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">${result.result?.indicators?.ema20?.value?.toFixed(2) || 'N/A'}</div>
              </div>
            )}

            {/* EMA50 - Note: may not be available, using ema20 as fallback or skip */}
            {result.result?.indicators?.ema50 && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">EMA50</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.ema50?.value || 0) > (result.result?.indicators?.ema50?.price || 0) ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                    }`}>
                    {(result.result?.indicators?.ema50?.value || 0) > (result.result?.indicators?.ema50?.price || 0) ? 'Resistance' : 'Support'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">${result.result?.indicators?.ema50?.value?.toFixed(2) || 'N/A'}</div>
              </div>
            )}

            {/* MACD */}
            {result.result?.indicators?.macd && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">MACD</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.macd?.value || 0) > 0 ? 'bg-green-500/20 text-green-400' :
                    (result.result?.indicators?.macd?.value || 0) < 0 ? 'bg-red-500/20 text-red-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                    {(result.result?.indicators?.macd?.value || 0) > 0 ? 'Bullish' :
                      (result.result?.indicators?.macd?.value || 0) < 0 ? 'Bearish' :
                        'Neutral'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">{(result.result?.indicators?.macd?.value || 0).toFixed(4)}</div>
              </div>
            )}

            {/* VWAP */}
            {result.result?.indicators?.vwap && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">VWAP</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${result.result?.indicators?.vwap?.signal === 'bullish' ? 'bg-green-500/20 text-green-400' :
                    result.result?.indicators?.vwap?.signal === 'bearish' ? 'bg-red-500/20 text-red-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                    {result.result?.indicators?.vwap?.signal === 'bullish' ? 'Bullish' :
                      result.result?.indicators?.vwap?.signal === 'bearish' ? 'Bearish' :
                        'Neutral'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">
                  {result.result?.indicators?.vwap?.signal || 'N/A'}
                </div>
              </div>
            )}

            {/* ATR (Volatility Score) */}
            {result.result?.indicators?.atr && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Volatility</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.atr?.atrPct || 0) > 3 ? 'bg-red-500/20 text-red-400' :
                    (result.result?.indicators?.atr?.atrPct || 0) > 1.5 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-green-500/20 text-green-400'
                    }`}>
                    {(result.result?.indicators?.atr?.atrPct || 0) > 3 ? 'High' :
                      (result.result?.indicators?.atr?.atrPct || 0) > 1.5 ? 'Moderate' : 'Low'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">{result.result?.indicators?.atr?.atrPct?.toFixed(2) || 'N/A'}%</div>
              </div>
            )}

            {/* Support/Resistance - derived from indicators */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-300">Key Level</span>
                <span className="px-2 py-1 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                  Dynamic
                </span>
              </div>
              <div className="text-lg font-bold text-white">
                {(() => {
                  const indicators = result.result?.indicators || {};
                  const price = result.result?.raw?.marketData?.price || 0;

                  if (indicators.ma50?.value && Math.abs(price - indicators.ma50.value) < Math.abs(price - (indicators.ma200?.value || 0))) {
                    return `$${indicators.ma50.value.toFixed(2)}`;
                  } else if (indicators.ma200?.value) {
                    return `$${indicators.ma200.value.toFixed(2)}`;
                  }
                  return 'N/A';
                })()}
              </div>
            </div>

            {/* Volume Score */}
            {result.result?.indicators?.volume && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Volume Score</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.volume?.score || 0) > 60 ? 'bg-green-500/20 text-green-400' :
                    (result.result?.indicators?.volume?.score || 0) < 40 ? 'bg-red-500/20 text-red-400' :
                      'bg-yellow-500/20 text-yellow-400'
                    }`}>
                    {(result.result?.indicators?.volume?.score || 0) > 60 ? 'Strong' :
                      (result.result?.indicators?.volume?.score || 0) < 40 ? 'Weak' : 'Moderate'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">{result.result?.indicators?.volume?.score?.toFixed(0) || 'N/A'}</div>
              </div>
            )}

            {/* Pattern Recognition */}
            {result.result?.indicators?.pattern && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Pattern</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.pattern?.confidence || 0) > 70 ? 'bg-green-500/20 text-green-400' :
                    (result.result?.indicators?.pattern?.confidence || 0) > 50 ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                    {(result.result?.indicators?.pattern?.confidence || 0) > 70 ? 'Strong' :
                      (result.result?.indicators?.pattern?.confidence || 0) > 50 ? 'Moderate' : 'Weak'}
                  </span>
                </div>
                <div className="text-lg font-bold text-white">{result.result?.indicators?.pattern?.pattern || 'N/A'}</div>
                <div className="text-xs text-slate-400 mt-1">Confidence: {result.result?.indicators?.pattern?.confidence?.toFixed(1) || 'N/A'}%</div>
              </div>
            )}

            {/* Momentum */}
            {result.result?.indicators?.momentum && (
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 hover:bg-slate-800/70 transition-all duration-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-300">Momentum Score</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${(result.result?.indicators?.momentum?.direction || '').toLowerCase() === 'bullish' ? 'bg-green-500/20 text-green-400' :
                    (result.result?.indicators?.momentum?.direction || '').toLowerCase() === 'bearish' ? 'bg-red-500/20 text-red-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                    {result.result?.indicators?.momentum?.direction || 'Neutral'}
                  </span>
                </div>
                <div className="text-xl font-bold text-white">{result.result?.indicators?.momentum?.score?.toFixed(1) || 'N/A'}</div>
                <div className="text-xs text-slate-400 mt-1">Momentum Score</div>
              </div>
            )}
          </div>

          {!result.result?.indicators && (
            <div className="text-center py-8">
              <p className="text-slate-400">No indicators available</p>
            </div>
          )}
        </div>
      </div>

      {/* MARKET SENTIMENT GAUGE */}
      {result.news?.articles && result.news.articles.length > 0 && (
        <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-blue-500/5 to-indigo-500/5"></div>
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500"></div>

          <div className="relative">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Market Sentiment Gauge
              </h3>
              <div className="text-right">
                <div className="text-sm text-slate-400">Articles Analyzed</div>
                <div className="text-lg font-bold text-white">{result.news.articles.length}</div>
              </div>
            </div>

            {/* Sentiment Counts */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-400">{result.news.articles.filter((article: any) => article.sentiment === 'positive').length}</div>
                <div className="text-sm text-slate-400">Positive</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-400">{result.news.articles.filter((article: any) => article.sentiment === 'neutral').length}</div>
                <div className="text-sm text-slate-400">Neutral</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-400">{result.news.articles.filter((article: any) => article.sentiment === 'negative').length}</div>
                <div className="text-sm text-slate-400">Negative</div>
              </div>
            </div>

            {/* Sentiment Gauge */}
            <div className="space-y-4">
              <div className="flex justify-between text-sm text-slate-400">
                <span>Fear</span>
                <span>Neutral</span>
                <span>Greed</span>
              </div>

              {/* Gauge Bar */}
              <div className="relative">
                <div className="w-full h-4 bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full overflow-hidden">
                  <div className="absolute inset-0 bg-slate-900/30 rounded-full"></div>
                </div>

                {/* Pointer */}
                <div
                  className="absolute top-0 w-1 h-4 bg-white rounded-full shadow-lg transform -translate-x-0.5 transition-all duration-500"
                  style={{
                    left: `${(() => {
                      const articles = result.news.articles;
                      const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                      const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                      const total = articles.length;

                      if (total === 0) return '50';

                      const score = (positive - negative) / total; // -1 to 1
                      return ((score + 1) / 2) * 100; // 0 to 100
                    })()}%`
                  }}
                ></div>
              </div>

              {/* Current Sentiment Value */}
              <div className="text-center">
                <div className="text-lg font-bold text-white mb-1">
                  {(() => {
                    const articles = result.news.articles;
                    const positive = articles.filter((a: any) => a.sentiment === 'positive').length;
                    const negative = articles.filter((a: any) => a.sentiment === 'negative').length;
                    const total = articles.length;

                    if (total === 0) return 'Neutral';

                    const score = (positive - negative) / total;
                    if (score > 0.3) return 'Very Bullish';
                    else if (score > 0.1) return 'Bullish';
                    else if (score > -0.1) return 'Neutral';
                    else if (score > -0.3) return 'Bearish';
                    else return 'Very Bearish';
                  })()}
                </div>
                <div className="text-sm text-slate-400">
                  Based on {result.news.articles.length} news articles
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRICE ACTION SNAPSHOT */}
      <div className="relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl shadow-slate-900/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-amber-500/5 to-yellow-500/5"></div>
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500"></div>

        <div className="relative">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
              Price Action Snapshot
            </h3>
            <div className="text-right">
              <div className="text-sm text-slate-400">Current Price</div>
              <div className="text-lg font-bold text-white">
                ${result.result?.raw?.marketData?.price ? result.result.raw.marketData.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Price vs MA20 */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
              <div className="text-sm text-slate-400 mb-2">vs EMA20</div>
              <div className={`text-lg font-bold flex items-center justify-center gap-1 ${(() => {
                const price = result.result?.raw?.marketData?.price || 0;
                const ema20 = result.result?.indicators?.ema20?.value || 0;
                if (!price || !ema20) return 'text-slate-400';
                return price > ema20 ? 'text-green-400' : 'text-red-400';
              })()
                }`}>
                <span>
                  {(() => {
                    const price = result.result?.raw?.marketData?.price || 0;
                    const ema20 = result.result?.indicators?.ema20?.value || 0;
                    if (!price || !ema20) return 'N/A';
                    const diff = ((price - ema20) / ema20) * 100;
                    return (diff > 0 ? '+' : '') + diff.toFixed(2) + '%';
                  })()}
                </span>
              </div>
            </div>

            {/* Price vs MA50 */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
              <div className="text-sm text-slate-400 mb-2">vs SMA50</div>
              <div className={`text-lg font-bold flex items-center justify-center gap-1 ${(() => {
                const price = result.result?.raw?.marketData?.price || 0;
                const ma50 = result.result?.indicators?.ma50?.value || 0;
                if (!price || !ma50) return 'text-slate-400';
                return price > ma50 ? 'text-green-400' : 'text-red-400';
              })()
                }`}>
                <span>
                  {(() => {
                    const price = result.result?.raw?.marketData?.price || 0;
                    const ma50 = result.result?.indicators?.ma50?.value || 0;
                    if (!price || !ma50) return 'N/A';
                    const diff = ((price - ma50) / ma50) * 100;
                    return (diff > 0 ? '+' : '') + diff.toFixed(2) + '%';
                  })()}
                </span>
              </div>
            </div>

            {/* Price vs MA200 */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
              <div className="text-sm text-slate-400 mb-2">vs SMA200</div>
              <div className={`text-lg font-bold flex items-center justify-center gap-1 ${(() => {
                const price = result.result?.raw?.marketData?.price || 0;
                const ma200 = result.result?.indicators?.ma200?.value || 0;
                if (!price || !ma200) return 'text-slate-400';
                return price > ma200 ? 'text-green-400' : 'text-red-400';
              })()
                }`}>
                <span>
                  {(() => {
                    const price = result.result?.raw?.marketData?.price || 0;
                    const ma200 = result.result?.indicators?.ma200?.value || 0;
                    if (!price || !ma200) return 'N/A';
                    const diff = ((price - ma200) / ma200) * 100;
                    return (diff > 0 ? '+' : '') + diff.toFixed(2) + '%';
                  })()}
                </span>
              </div>
            </div>

            {/* ATR Volatility */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
              <div className="text-sm text-slate-400 mb-2">Volatility (ATR)</div>
              <div className={`text-lg font-bold ${(() => {
                const atrPct = result.result?.indicators?.atr?.atrPct || 0;
                if (atrPct > 3) return 'text-red-400';
                if (atrPct > 1.5) return 'text-yellow-400';
                return 'text-green-400';
              })()
                }`}>
                {result.result?.indicators?.atr?.atrPct?.toFixed(2) || 'N/A'}%
              </div>
            </div>
          </div>

          {/* Probability Distribution */}
          {result.result?.indicators?.distribution && (
            <div className="mt-6">
              <h4 className="text-lg font-semibold text-white mb-4">Probability Distribution</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                  <div className="text-sm text-slate-400 mb-2">Uptrend</div>
                  <div className="text-2xl font-bold text-green-400">
                    {(() => {
                      const distribution = result.result?.indicators?.distribution;
                      if (!distribution) return 'N/A';
                      const totalScore = distribution.uptrendScore + distribution.downtrendScore;
                      if (totalScore === 0) return '100';

                      const uptrendProb = (distribution.uptrendScore / totalScore) * 100;
                      return uptrendProb.toFixed(0);
                    })()}%
                  </div>
                </div>
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                  <div className="text-sm text-slate-400 mb-2">Sideways</div>
                  <div className="text-2xl font-bold text-yellow-400">
                    {(() => {
                      const distribution = result.result?.indicators?.distribution;
                      if (!distribution) return 'N/A';
                      const totalScore = distribution.uptrendScore + distribution.downtrendScore;
                      if (totalScore === 0) return '0';

                      const uptrendProb = (distribution.uptrendScore / totalScore) * 70;
                      const downtrendProb = (distribution.downtrendScore / totalScore) * 70;
                      return (100 - uptrendProb - downtrendProb).toFixed(0);
                    })()}%
                  </div>
                </div>
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4 text-center">
                  <div className="text-sm text-slate-400 mb-2">Downtrend</div>
                  <div className="text-2xl font-bold text-red-400">
                    {(() => {
                      const distribution = result.result?.indicators?.distribution;
                      if (!distribution) return 'N/A';
                      const totalScore = distribution.uptrendScore + distribution.downtrendScore;
                      if (totalScore === 0) return '0';

                      const downtrendProb = (distribution.downtrendScore / totalScore) * 100;
                      return downtrendProb.toFixed(0);
                    })()}%
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default DeepResearchAnalysis;
