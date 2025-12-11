import React from 'react';
import AnalysisDisplay from './AnalysisDisplay';

interface CoinResearchAnalysisProps {
  selectedCoinData: any;
  mobileSectionsOpen: {
    analysis: boolean;
    metrics: boolean;
    news: boolean;
    images: boolean;
  };
  setMobileSectionsOpen: React.Dispatch<React.SetStateAction<{
    analysis: boolean;
    metrics: boolean;
    news: boolean;
    images: boolean;
  }>>;
}

const CoinResearchAnalysis: React.FC<CoinResearchAnalysisProps> = ({
  selectedCoinData,
  mobileSectionsOpen,
  setMobileSectionsOpen
}) => {
  return (
    <>
      {/* Mobile Analysis Section */}
      <div className="lg:hidden bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl">
        <button
          onClick={() => setMobileSectionsOpen(prev => ({ ...prev, analysis: !prev.analysis }))}
          className="w-full p-4 flex items-center justify-between text-left"
        >
          <h4 className="text-lg font-semibold text-white">Analysis Summary</h4>
          <svg
            className={`w-5 h-5 text-slate-400 transition-transform ${mobileSectionsOpen.analysis ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {mobileSectionsOpen.analysis && (
          <div className="px-4 pb-4 space-y-3">
            <AnalysisDisplay analysisSummary={selectedCoinData.analysisSummary} />
          </div>
        )}
      </div>

      {/* Desktop Analysis Summary */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
        <h4 className="text-lg font-semibold text-white mb-4">Analysis Summary</h4>
        <div className="space-y-3">
          <AnalysisDisplay analysisSummary={selectedCoinData.analysisSummary} />
        </div>
      </div>
    </>
  );
};

export default CoinResearchAnalysis;
