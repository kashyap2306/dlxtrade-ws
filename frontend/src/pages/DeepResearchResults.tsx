import React from 'react';
import DeepResearchCore from './DeepResearchCore';
import DeepResearchAnalysis from './DeepResearchAnalysis';
import DeepResearchNews from './DeepResearchNews';

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
    <div className="relative bg-gradient-to-br from-slate-900/60 via-slate-800/60 to-slate-900/60 backdrop-blur-xl border border-slate-700/60 rounded-3xl p-8 lg:p-10 shadow-2xl shadow-slate-900/40 hover:shadow-slate-900/50 transition-all duration-500 overflow-hidden group">
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

        {deepResearchLoading ? (
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
        ) : deepResearchResults.length === 0 ? (
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
        ) : (
          <div className="space-y-6 animate-fade-in">
            {deepResearchResults.map((result, idx) => (
              <div key={result.id || idx} className="space-y-6 animate-stagger">
                <DeepResearchCore result={result} settings={settings} />
                <DeepResearchAnalysis result={result} />
                <DeepResearchNews result={result} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DeepResearchResults;