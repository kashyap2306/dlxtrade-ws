import React from 'react';

interface Coin {
  symbol: string;
  name: string;
  logo?: string;
}

interface TopCoinsGridProps {
  topCoins: Coin[];
  onSelectCoin: (symbol: string) => void;
}

const TopCoinsGrid: React.FC<TopCoinsGridProps> = ({
  topCoins,
  onSelectCoin
}) => {
  if (topCoins.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {topCoins.map((coin, index) => (
        <div
          key={coin.symbol}
          className="flex items-center gap-2 bg-slate-800/40 px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-700/50 cursor-pointer transition"
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
          <span className="text-white text-sm font-semibold">{coin.symbol.replace('USDT', '')}</span>
          <span className="text-slate-300 text-xs">{coin.name}</span>
        </div>
      ))}
    </div>
  );
};

export default TopCoinsGrid;
