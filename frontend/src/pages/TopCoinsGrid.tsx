import React, { useState } from 'react';

interface Coin {
  symbol: string;
  name: string;
  logo?: string;
}

interface TopCoinsGridProps {
  topCoins: Coin[];
  onSelectCoin: (symbol: string) => void;
  maxVisible?: number;
  showSelection?: boolean;
  selectedSymbol?: string | null;
}

const TopCoinsGrid: React.FC<TopCoinsGridProps> = ({
  topCoins,
  onSelectCoin,
  maxVisible = 5,
  showSelection = false,
  selectedSymbol = null
}) => {
  const [showAll, setShowAll] = useState(false);

  if (topCoins.length === 0) {
    return null;
  }

  const visibleCoins = showAll ? topCoins : topCoins.slice(0, maxVisible);
  const hasMore = topCoins.length > maxVisible;

  return (
    <div className="mt-6">
      <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 transition-all duration-300 ${showAll ? 'max-h-none' : 'max-h-96'}`}>
        {visibleCoins.map((coin, index) => {
          const isSelected = showSelection && selectedSymbol === coin.symbol;
          return (
            <div
              key={coin.symbol}
              className={`flex items-center gap-2 bg-slate-800/40 px-3 py-2 rounded-lg border transition-all duration-200 cursor-pointer transform hover:scale-105 ${
                isSelected
                  ? 'border-purple-500 bg-purple-500/20 shadow-lg shadow-purple-500/20'
                  : 'border-slate-700 hover:bg-slate-700/50 hover:border-slate-600'
              }`}
              onClick={() => onSelectCoin(coin.symbol)}
            >
              {/* Show logo only for top 20 */}
              {index < 20 && coin.logo && (
                <img
                  src={coin.logo}
                  className="w-6 h-6 rounded-full"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
              <div className="flex-1 min-w-0">
                <span className="text-white text-sm font-semibold block truncate">{coin.symbol.replace('USDT', '')}</span>
                <span className="text-slate-300 text-xs block truncate">{coin.name}</span>
              </div>
              {isSelected && (
                <div className="w-5 h-5 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs">✓</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="px-6 py-2 bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 text-slate-300 rounded-xl hover:bg-slate-700/60 hover:border-slate-600/60 transition-all duration-300 transform hover:scale-105 active:scale-95 flex items-center gap-2"
          >
            <span>{showAll ? 'Show Less' : `View All (${topCoins.length} coins)`}</span>
            <svg
              className={`w-4 h-4 transition-transform duration-300 ${showAll ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default TopCoinsGrid;
