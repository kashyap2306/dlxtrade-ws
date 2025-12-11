import React from 'react';
import ProviderBadge from './ProviderBadge';

interface CoinResearchHeaderProps {
  selectedCoinSymbol: string;
  selectedCoinData: any;
}

const CoinResearchHeader: React.FC<CoinResearchHeaderProps> = ({
  selectedCoinSymbol,
  selectedCoinData
}) => {
  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          {selectedCoinData.coinImages?.[0] && (
            <img
              src={selectedCoinData.coinImages[0]}
              alt={selectedCoinSymbol}
              className="w-10 h-10 rounded-full"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div>
            <h3 className="text-xl font-bold text-white">{selectedCoinSymbol.replace('USDT', '')}</h3>
            <p className="text-slate-400 text-sm">{selectedCoinData.metadata?.description?.substring(0, 80)}...</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-slate-400">Price</span>
            <div className="text-lg font-bold text-white">
              ${selectedCoinData.marketData?.currentPrice?.toLocaleString() || 'N/A'}
            </div>
          </div>
          <div>
            <span className="text-xs text-slate-400">24h Change</span>
            <div className={`text-sm font-semibold ${
              selectedCoinData.marketData?.priceChangePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {selectedCoinData.marketData?.priceChangePercent24h >= 0 ? '+' : ''}
              {selectedCoinData.marketData?.priceChangePercent24h?.toFixed(2)}%
            </div>
          </div>
        </div>
        <ProviderBadge
          providerUsage={selectedCoinData.providerUsage}
          className="mt-3 flex-wrap"
        />
      </div>

      {/* Desktop Header */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-600/30 rounded-xl p-6">
        <div className="flex items-center gap-4 mb-4">
          {selectedCoinData.coinImages?.[0] && (
            <img
              src={selectedCoinData.coinImages[0]}
              alt={selectedCoinSymbol}
              className="w-12 h-12 rounded-full"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <div>
            <h3 className="text-2xl font-bold text-white">{selectedCoinSymbol.replace('USDT', '')}</h3>
            <p className="text-slate-400">{selectedCoinData.metadata?.description?.substring(0, 100)}...</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div>
            <span className="text-sm text-slate-400">Price</span>
            <div className="text-2xl font-bold text-white">
              ${selectedCoinData.marketData?.currentPrice?.toLocaleString() || 'N/A'}
            </div>
          </div>
          <div>
            <span className="text-sm text-slate-400">24h Change</span>
            <div className={`text-xl font-semibold ${
              selectedCoinData.marketData?.priceChangePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {selectedCoinData.marketData?.priceChangePercent24h >= 0 ? '+' : ''}
              {selectedCoinData.marketData?.priceChangePercent24h?.toFixed(2)}%
            </div>
          </div>
          <ProviderBadge providerUsage={selectedCoinData.providerUsage} />
        </div>
      </div>
    </>
  );
};

export default CoinResearchHeader;
