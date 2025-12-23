import React from 'react';
import DeepResearchCore from './DeepResearchCore';
import DeepResearchAnalysis from './DeepResearchAnalysis';
import DeepResearchNews from './DeepResearchNews';

interface DeepResearchResult {
  id?: string;
  symbol?: string;
  result?: {
    signal?: 'BUY' | 'SELL' | 'HOLD' | 'ANALYZING' | 'PENDING';
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
    isFinal?: boolean;
    tradePlan?: any;
  };
  news?: {
    articles?: any[];
  };
  metadata?: any;
  error?: string;
  isGlobalResearch?: boolean;
  explanation?: string;
  isFinal?: boolean;
  analysis?: any;
  partial?: boolean;
  timeout?: boolean;
}

interface DeepResearchResultsProps {
  deepResearchLoading: boolean;
  deepResearchResults: DeepResearchResult[];
  settings?: any;
}

const DeepResearchResults: React.FC<DeepResearchResultsProps> = ({
  deepResearchLoading,
  deepResearchResults,
  settings
}) => {
  return (
    <div className="relative w-full backdrop-blur-xl border-y sm:border border-slate-700/60 sm:rounded-3xl p-4 sm:p-8 lg:p-10 shadow-2xl shadow-slate-900/40 hover:shadow-slate-900/50 transition-all duration-500 overflow-hidden group">
      {/* Animated gradient borders */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500"></div>
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500"></div>

      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

      <div className="relative">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8 mb-10">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center">
                <svg className="w-7 h-7 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent">
                  Deep Research Report
                </h2>
                <p className="text-slate-400 flex items-center gap-2 mt-1">
                  <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></span>
                  <span className="text-sm">AI-powered market analysis results</span>
                </p>
              </div>
            </div>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-3 px-6 py-3 bg-slate-800/40 backdrop-blur-sm border border-slate-600/40 rounded-2xl">
            <div className="w-3 h-3 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full animate-pulse"></div>
            <span className="text-sm text-slate-300 font-medium">Analysis Engine Active</span>
          </div>
        </div>

        {/* CRITICAL: Loading UI must show ONLY if isFinal === false AND result is null or empty */}
        {/* If isFinal === true → loading UI MUST NEVER render */}
        {(() => {
          // Check if any result is FINAL
          const hasFinalResult = deepResearchResults.some(r => r.isFinal === true || (r as any)?.result?.isFinal === true);
          
          // CRITICAL: If FINAL exists, NEVER show loading UI
          if (hasFinalResult) {
            return null; // Don't render loading - FINAL results exist
          }
          
          // Only show loading if no FINAL results and loading is active
          if (deepResearchLoading) {
            return (
              <div className="text-center py-20">
                <div className="relative mb-8">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center mx-auto">
                    <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                  </div>
                  <div className="absolute inset-0 w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/10 to-cyan-500/10 mx-auto animate-pulse"></div>
                </div>
                <h3 className="text-2xl font-bold bg-gradient-to-r from-purple-300 to-cyan-300 bg-clip-text text-transparent mb-3">
                  Analyzing Markets
                </h3>
                <p className="text-slate-400 text-lg">Processing real-time data and generating insights</p>
                <div className="mt-6 flex justify-center">
                  <div className="px-4 py-2 bg-slate-800/40 backdrop-blur-sm border border-slate-600/40 rounded-full">
                    <span className="text-sm text-slate-300">This may take 10-15 seconds...</span>
                  </div>
                </div>
              </div>
            );
          }
          
          // Show empty state if no results and not loading
          if (deepResearchResults.length === 0) {
            return (
              <div className="text-center py-20">
                <div className="relative mb-8">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-slate-700/30 to-slate-600/30 flex items-center justify-center mx-auto">
                    <svg className="w-12 h-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="absolute inset-0 w-24 h-24 rounded-full bg-gradient-to-br from-slate-500/10 to-slate-400/10 mx-auto"></div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-2xl font-bold text-slate-300">Ready for Analysis</h3>
                  <p className="text-slate-500 text-lg max-w-lg mx-auto leading-relaxed">
                    Click "Run Deep Research" to generate comprehensive market analysis with real-time data from multiple exchanges and sentiment sources
                  </p>
                  <div className="flex justify-center mt-6">
                    <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20 rounded-full">
                      <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm text-purple-300">Powered by AI & Real-time APIs</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          
          return null; // Should not reach here if logic is correct
        })()}
        
        {/* CRITICAL: Render results - FINAL results are rendered immediately */}
        {deepResearchResults.length > 0 && (
          <div className="space-y-6 animate-fade-in">
            {deepResearchResults.map((result, idx) => {
              // CRITICAL: Check for analysis data FIRST - this is the primary success indicator
              const hasAnalysis = !!(result as any).analysis && typeof (result as any).analysis === 'object' && Object.keys((result as any).analysis || {}).length > 0;
              const signalValue = (result.result?.signal as any);
              const hasSignal = !!(signalValue && signalValue !== 'ANALYZING' && signalValue !== 'PENDING');
              const hasAccuracy = typeof result.result?.accuracy === 'number';

              // If we have analysis, signal, or accuracy, treat as SUCCESS regardless of provider status
              const hasResearchData = hasAnalysis || hasSignal || hasAccuracy;

              // Check provider status - treat as SUCCESS if at least ONE provider succeeded OR if we have data
              const providersUsed = (result as any).providersMetadata?.providersUsed;
              const isPartial = (result.result as any)?.partial === true || (result as any).partial === true;

              // Key data checks
              const hasMarketData = !!(result.result?.raw?.marketData || (result.result?.indicators && Object.keys(result.result.indicators || {}).length > 0));
              const hasNews = !!(result.news?.articles && result.news.articles.length > 0);

              // Count successful providers
              const successfulProviders = providersUsed ?
                (providersUsed.marketData || 0) + (providersUsed.metadata || 0) + (providersUsed.news || 0) : 0;

              // Valid result if: We have research data (analysis/signal/accuracy), OR provider success, OR explicit market data, OR confirmed partial result
              const isValidResult = hasResearchData || successfulProviders > 0 || hasMarketData || isPartial;

              // Only show error if result is NOT valid AND we don't have research data
              const allProvidersFailed = !isValidResult && !hasResearchData;

              // Show warning if some providers failed but at least one succeeded (or we have partial data)
              // Partial flag explicitly enables this warning state instead of error
              const hasPartialData = isPartial || (providersUsed && successfulProviders > 0 && successfulProviders < 3);

              // Show error state only if completely failed (no research data, no providers, not partial)
              // CRITICAL: If we have analysis/signal/accuracy, NEVER show error - render the analysis instead
              if (allProvidersFailed && !hasResearchData) {
                return (
                  <div key={result.id || idx} className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 backdrop-blur-sm">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-white mb-2">Data Unavailable</h3>
                        <p className="text-slate-300 leading-relaxed mb-4">
                          No data providers were available for this research and no cached data could be retrieved.
                        </p>
                        <div className="mt-3 text-sm text-slate-400">
                          {providersUsed && (
                            <>
                              <p>Market Data: {providersUsed.marketData === 0 ? '❌ Unavailable' : '✅ Available'}</p>
                              <p>Metadata: {providersUsed.metadata === 0 ? '❌ Unavailable' : '✅ Available'}</p>
                              <p>News: {providersUsed.news === 0 ? '❌ Unavailable' : '✅ Available'}</p>
                            </>
                          )}
                          {!providersUsed && <p>Unable to retrieve research data. Please try again.</p>}
                        </div>
                        <button
                          onClick={() => window.location.reload()}
                          className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-300 hover:bg-red-500/30 transition-colors"
                        >
                          Retry Research
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={result.id || idx} className="space-y-6 animate-stagger">
                  {/* Warning banner for partial data - show if some providers failed but research succeeded */}
                  {hasPartialData && (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-2xl p-6 backdrop-blur-sm">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                          <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-white mb-2">Partial Data Available</h3>
                          <p className="text-slate-300 leading-relaxed mb-4">
                            Research completed successfully, but some data providers were unavailable. Analysis is based on available data sources.
                          </p>
                          <div className="mt-3 text-sm text-slate-400 space-y-1">
                            {providersUsed ? (
                              <>
                                <p>Market Data: {providersUsed.marketData === 0 ? '⚠️ Unavailable' : '✅ Available'}</p>
                                <p>Metadata: {providersUsed.metadata === 0 ? '⚠️ Unavailable' : '✅ Available'}</p>
                                <p>News: {providersUsed.news === 0 ? '⚠️ Unavailable' : '✅ Available'}</p>
                              </>
                            ) : (
                              <p>Partial data available from research analysis</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Global Research Explanation */}
                  {result.isGlobalResearch && result.explanation && (
                    <div className="bg-gradient-to-r from-purple-500/10 via-violet-500/10 to-cyan-500/10 border border-purple-500/20 rounded-2xl p-6 backdrop-blur-sm">
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center flex-shrink-0">
                          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-white mb-2">Auto-Selected Best Opportunity</h3>
                          <p className="text-slate-300 leading-relaxed">{result.explanation}</p>
                          {result.symbol && (
                            <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg">
                              <span className="text-sm font-semibold text-purple-300">Selected Coin:</span>
                              <span className="text-sm font-bold text-white">{result.symbol}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* CURRENT PRICE HEADER */}
                  {((result as any)?.analysis?.priceAction?.currentPrice) && (
                    <div className="flex items-center justify-between p-6 backdrop-blur-md border border-slate-700/50 rounded-2xl shadow-xl shadow-slate-900/50">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-600/20 to-blue-600/20 flex items-center justify-center">
                          <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Current Market Price</p>
                          <h4 className="text-3xl font-black text-white tracking-tighter">
                            ${(result as any).analysis.priceAction.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                          </h4>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Asset Symbol</div>
                        <div className="text-lg font-bold text-cyan-400">{result.symbol}</div>
                      </div>
                    </div>
                  )}

                  {(() => {
                    // CRITICAL: Check isFinal FIRST - if FINAL, ALWAYS render FINAL payload
                    // Frontend must trust FINAL backend verdict - do NOT wait for stages
                    // WHY: Backend FINAL payload is authoritative - once isFinal === true, analysis is complete
                    const isFinal = !!(result.isFinal || (result as any)?.result?.isFinal);
                    
                    // CRITICAL: HARD EARLY RETURN - If isFinal === true, render FINAL UI immediately
                    // IGNORE COMPLETELY: safeDefault, fallback objects, loading state, stages, indicators, news
                    // The UI MUST use ONLY result.result (backend FINAL payload)
                    if (isFinal) {
                      console.log("[UI_FINAL_RENDER]", result);
                      console.log(`[UI_FINAL_RENDER] FINAL result for ${result.symbol}: signal=${result.result?.signal}, accuracy=${result.result?.accuracy}, isFinal=${isFinal}`);
                      // CRITICAL: Use ONLY result.result (backend FINAL payload) - no fallbacks, no defaults
                      return (
                        <>
                          <DeepResearchCore result={result as any} settings={settings} />
                          <DeepResearchAnalysis result={result} />
                        </>
                      );
                    }
                    
                    const hasResultData = !!(result.result || result.analysis || result.news);
                    
                    // If we have any result data (even if not explicitly marked final), render it
                    // This handles cases where backend completed but didn't set isFinal flag
                    if (hasResultData) {
                      return (
                        <>
                          <DeepResearchCore result={result as any} settings={settings} />
                          <DeepResearchAnalysis result={result} />
                        </>
                      );
                    }

                    // Only show processing if we truly have no data at all
                    return (
                      <div className="p-10 border border-slate-700/50 bg-slate-900/40 rounded-3xl backdrop-blur-xl animate-pulse">
                        <div className="flex flex-col items-center justify-center text-center">
                          <div className="w-20 h-20 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin mb-6"></div>
                          <h3 className="text-xl font-bold text-white mb-2">Analyzing Markets...</h3>
                          <p className="text-slate-400 text-sm mb-4">Processing deep research for {result.symbol}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeepResearchResults;