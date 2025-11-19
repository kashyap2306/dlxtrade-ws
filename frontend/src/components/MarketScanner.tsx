import { useState, useEffect, useCallback } from 'react';
import { suppressConsoleError } from '../utils/errorHandler';
import api from '../services/api';

interface CoinData {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  pumpPercent: number;
}

export default function MarketScanner() {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTopCoins = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch from backend API which uses CoinMarketCap
      const response = await api.get('/market/top-coins');
      const data = response.data || [];
      
      // Transform CoinMarketCap data to our format
      const topCoins = data
        .map((coin: any) => ({
          symbol: coin.symbol || '',
          price: parseFloat(coin.price || 0),
          priceChange24h: parseFloat(coin.percent_change_24h || 0),
          volume24h: parseFloat(coin.volume_24h || 0),
          pumpPercent: parseFloat(coin.percent_change_24h || 0),
        }))
        .sort((a: CoinData, b: CoinData) => b.pumpPercent - a.pumpPercent)
        .slice(0, 5);
      
      setCoins(topCoins);
    } catch (err: any) {
      suppressConsoleError(err, 'fetchTopCoins');
      // Fallback to empty array on error
      setCoins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only fetch once on mount, then let user refresh manually
    fetchTopCoins();
    // Removed auto-refresh interval to prevent performance issues
    // User can click refresh button to update
  }, [fetchTopCoins]);

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
            Market Scanner
          </h2>
          <p className="text-xs sm:text-sm text-gray-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Top 5 Gainers (24h)
          </p>
        </div>
        <button
          onClick={fetchTopCoins}
          disabled={loading}
          className="px-4 py-2 text-xs sm:text-sm bg-black/40 backdrop-blur-sm border border-purple-500/40 text-gray-200 rounded-xl hover:bg-purple-500/20 hover:border-purple-400/60 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2 transform hover:scale-105 active:scale-95"
        >
          {loading ? (
            <>
              <span className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></span>
              Loading...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </>
          )}
        </button>
      </div>

      {loading && coins.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-gray-700/30 rounded-lg animate-pulse"></div>
          ))}
        </div>
      ) : coins.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">No market data available</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Exchange-style Header */}
          <div className="hidden md:grid grid-cols-5 gap-4 px-4 py-3 bg-black/40 rounded-lg border border-purple-500/20 mb-2">
            <div className="text-xs font-bold text-purple-300 uppercase tracking-wider">#</div>
            <div className="text-xs font-bold text-purple-300 uppercase tracking-wider">Symbol</div>
            <div className="text-xs font-bold text-purple-300 uppercase tracking-wider text-right">Price</div>
            <div className="text-xs font-bold text-purple-300 uppercase tracking-wider text-right">24h %</div>
            <div className="text-xs font-bold text-purple-300 uppercase tracking-wider text-right">Volume</div>
          </div>

          {/* Coin Cards */}
          {coins.map((coin, index) => (
            <div
              key={coin.symbol}
              className="relative bg-gradient-to-r from-black/50 to-black/30 backdrop-blur-sm border border-purple-500/30 rounded-lg p-3 md:p-4 hover:border-purple-400/60 hover:from-purple-500/10 hover:to-black/40 transition-all duration-300 overflow-hidden group cursor-pointer"
            >
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
                {/* Rank & Symbol */}
                <div className="flex items-center gap-3 md:gap-4 flex-1">
                  <div className="flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-lg bg-gradient-to-br from-purple-500/30 to-pink-500/30 text-purple-300 font-bold text-xs md:text-sm border border-purple-400/40">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base md:text-lg font-bold text-white truncate">{coin.symbol}</span>
                    </div>
                    <div className="md:hidden flex items-center gap-3 text-xs text-gray-400">
                      <span>${coin.price.toFixed(2)}</span>
                      <span className={`font-semibold ${
                        coin.pumpPercent >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {coin.pumpPercent >= 0 ? '+' : ''}{coin.pumpPercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Desktop Grid Layout */}
                <div className="hidden md:grid md:grid-cols-4 gap-4 flex-1">
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">${coin.price.toFixed(2)}</div>
                    <div className="text-xs text-gray-400">Price</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${
                      coin.pumpPercent >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {coin.pumpPercent >= 0 ? '+' : ''}{coin.pumpPercent.toFixed(2)}%
                    </div>
                    <div className="text-xs text-gray-400">24h Change</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">${(coin.volume24h / 1000000).toFixed(1)}M</div>
                    <div className="text-xs text-gray-400">24h Volume</div>
                  </div>
                  <div className="text-right">
                    <div className={`inline-flex items-center px-2 py-1 rounded text-xs font-semibold ${
                      coin.pumpPercent >= 0
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : 'bg-red-500/20 text-red-300 border border-red-400/30'
                    }`}>
                      {coin.pumpPercent >= 0 ? '↑' : '↓'} {Math.abs(coin.pumpPercent).toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Mobile Layout */}
              <div className="md:hidden mt-2 pt-2 border-t border-purple-500/20">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-gray-400">Volume</div>
                    <div className="text-white font-semibold">${(coin.volume24h / 1000000).toFixed(1)}M</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

