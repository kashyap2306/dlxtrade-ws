import React from 'react';

interface CoinResearchLoadingProps {
  selectedCoinSymbol: string | null;
  coinResearchLoading: boolean;
}

const CoinResearchLoading: React.FC<CoinResearchLoadingProps> = ({
  selectedCoinSymbol,
  coinResearchLoading
}) => {
  if (coinResearchLoading && selectedCoinSymbol) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-8">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-xl font-semibold text-white mb-2">Analyzing {selectedCoinSymbol.replace('USDT', '')}</h3>
          <p className="text-slate-400">Fetching comprehensive market data...</p>
        </div>
      </div>
    );
  }

  if (!selectedCoinSymbol) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-8 text-center">
        <p className="text-slate-400">Select a coin to view detailed research</p>
      </div>
    );
  }

  // If coin is selected but not loading and no data, show waiting state
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-8 text-center">
      <p className="text-slate-400">Loading research data...</p>
    </div>
  );
};

export default CoinResearchLoading;
