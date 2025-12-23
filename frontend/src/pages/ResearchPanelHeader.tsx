import React from 'react';

interface ResearchPanelHeaderProps {
  loading: boolean;
  deepResearchLoading: boolean;
  cooldownSeconds: number;
  onLoadLogs: () => void;
  onHandleDeepResearch: () => void;
  coinsAvailable: boolean;
  hasSelectedCoin: boolean;
  selectedCoin: string | null;
  timeframe: string;
  onTimeframeChange: (timeframe: string) => void;
}

const ResearchPanelHeader: React.FC<ResearchPanelHeaderProps> = ({
  loading,
  deepResearchLoading,
  cooldownSeconds,
  onLoadLogs,
  onHandleDeepResearch,
  coinsAvailable,
  hasSelectedCoin,
  selectedCoin,
  timeframe,
  onTimeframeChange
}) => {
  const [timeframeDropdownOpen, setTimeframeDropdownOpen] = React.useState(false);
  return (
    <>
      {/* Mobile: Enhanced Header */}
      <div className="lg:hidden sticky top-16 z-40 -mx-2 px-4 py-6 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/60 mb-8 shadow-2xl shadow-slate-900/50">
        {/* Gradient accent line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500"></div>

        <div className="space-y-6 relative">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 mb-4">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent mb-2">
              Research Panel
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Advanced AI-powered market analysis with real-time data
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onHandleDeepResearch}
              disabled={deepResearchLoading || cooldownSeconds > 0 || !coinsAvailable}
              className="flex-1 px-6 py-4 bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-600 text-white font-semibold rounded-2xl hover:from-purple-500 hover:via-violet-500 hover:to-cyan-500 transition-all duration-300 shadow-xl shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-98 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-cyan-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div className="relative flex items-center justify-center gap-3">
                {deepResearchLoading ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span className="text-sm font-medium">Analyzing...</span>
                  </>
                ) : cooldownSeconds > 0 ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    <span className="text-sm font-medium">{cooldownSeconds}s</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-sm font-medium">
                      {hasSelectedCoin && selectedCoin 
                        ? `Run Research on ${selectedCoin.replace('USDT', '')}` 
                        : 'Auto Select Best Coin'}
                    </span>
                  </>
                )}
              </div>
            </button>
            <div className="relative">
              <button
                onClick={() => setTimeframeDropdownOpen(!timeframeDropdownOpen)}
                className="px-4 py-4 bg-slate-800/60 backdrop-blur-sm border border-slate-600/60 text-slate-300 rounded-2xl hover:bg-slate-700/60 hover:border-slate-500/60 transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg shadow-slate-900/20 flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium">{timeframe}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {timeframeDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setTimeframeDropdownOpen(false)}></div>
                  <div className="absolute right-0 mt-2 w-40 bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-20 overflow-hidden">
                    {['Default', '5M', '15M', '30M', '1H'].map((tf) => (
                      <button
                        key={tf}
                        onClick={() => {
                          onTimeframeChange(tf);
                          setTimeframeDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors ${
                          timeframe === tf
                            ? 'bg-purple-600/20 text-purple-300'
                            : 'text-slate-300 hover:bg-slate-700/60'
                        }`}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop Header */}
      <section className="hidden lg:block mb-16">
        <div className="relative">
          {/* Background gradient card */}
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900/40 via-slate-800/40 to-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-700/50 shadow-2xl shadow-slate-900/30"></div>

          {/* Gradient accent lines */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 via-cyan-500 to-blue-500 rounded-t-3xl"></div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 rounded-b-3xl"></div>

          <div className="relative p-8 rounded-3xl">
            <div className="flex items-center justify-between">
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600/20 to-cyan-600/20 flex items-center justify-center">
                    <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div>
                    <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-300 via-cyan-300 to-blue-300 bg-clip-text text-transparent mb-2">
                      Research Panel
                    </h1>
                    <p className="text-xl text-slate-300 max-w-lg leading-relaxed">
                      Advanced AI-powered market analysis with comprehensive real-time data integration
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="relative">
                  <button
                    onClick={() => setTimeframeDropdownOpen(!timeframeDropdownOpen)}
                    className="px-8 py-4 bg-slate-800/60 backdrop-blur-sm border border-slate-600/60 text-slate-300 rounded-2xl hover:bg-slate-700/60 hover:border-slate-500/60 transition-all duration-300 flex items-center gap-3 transform hover:scale-105 active:scale-95 shadow-lg shadow-slate-900/20"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-medium">{timeframe}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {timeframeDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setTimeframeDropdownOpen(false)}></div>
                      <div className="absolute right-0 mt-2 w-40 bg-slate-800 border border-slate-600 rounded-xl shadow-xl z-20 overflow-hidden">
                        {['Default', '5M', '15M', '30M', '1H'].map((tf) => (
                          <button
                            key={tf}
                            onClick={() => {
                              onTimeframeChange(tf);
                              setTimeframeDropdownOpen(false);
                            }}
                            className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors ${
                              timeframe === tf
                                ? 'bg-purple-600/20 text-purple-300'
                                : 'text-slate-300 hover:bg-slate-700/60'
                            }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={onHandleDeepResearch}
                  disabled={deepResearchLoading || cooldownSeconds > 0 || !coinsAvailable}
                  className="px-10 py-4 bg-gradient-to-r from-purple-600 via-violet-600 to-cyan-600 text-white font-semibold rounded-2xl hover:from-purple-500 hover:via-violet-500 hover:to-cyan-500 transition-all duration-300 shadow-xl shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 transform hover:scale-[1.02] active:scale-98 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400/20 to-cyan-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                  <div className="relative flex items-center gap-3">
                    {deepResearchLoading ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span className="font-medium">Analyzing Markets...</span>
                      </>
                    ) : cooldownSeconds > 0 ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        <span className="font-medium">Cooldown: {cooldownSeconds}s</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="font-medium">
                          {hasSelectedCoin && selectedCoin 
                            ? `Run Research on ${selectedCoin.replace('USDT', '')}` 
                            : 'Auto Select Best Coin'}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default ResearchPanelHeader;
