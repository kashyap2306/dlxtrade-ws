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
      // Fetch from backend API which uses market data providers
      const response = await api.get('market/top-movers');
      const data = response.data || [];
      
      // Transform backend data to our format
      const topCoins = data
        .map((coin: any) => ({
          symbol: coin.symbol || '',
          price: parseFloat(coin.price || 0),
          priceChange24h: parseFloat(coin.priceChangePercent24h || 0),
          volume24h: parseFloat(coin.volume24h || 0),
          pumpPercent: parseFloat(coin.priceChangePercent24h || 0),
        }))
        .filter((coin: CoinData) => coin.price > 0) // Filter out invalid data
        .sort((a: CoinData, b: CoinData) => Math.abs(b.pumpPercent) - Math.abs(a.pumpPercent)) // Sort by absolute change
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
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-white mb-1">Market Scanner</h3>
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Top 5 Movers (24h)
          </p>
        </div>
        <button
          onClick={fetchTopCoins}
          disabled={loading}
          className="px-3 py-2 text-sm bg-slate-700/50 hover:bg-slate-700/70 text-slate-300 rounded-lg transition-all disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-slate-400/30 border-t-slate-400 rounded-full animate-spin"></div>
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
            <div key={i} className="h-16 bg-slate-700/30 rounded-lg animate-pulse"></div>
          ))}
        </div>
      ) : coins.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-400 text-sm">No market data available</p>
          <p className="text-slate-500 text-xs mt-2">Check your API connections</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Table Header - Desktop */}
          <div className="hidden md:grid grid-cols-4 gap-4 px-4 py-3 bg-slate-700/30 rounded-lg text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">
            <div>Asset</div>
            <div className="text-right">Price</div>
            <div className="text-right">24h Change</div>
            <div className="text-right">Volume</div>
          </div>

          {/* Coin List */}
          {coins.map((coin, index) => (
            <div
              key={coin.symbol}
              className="bg-slate-800/30 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4 hover:bg-slate-800/50 transition-all duration-200 mb-3"
            >
              <div className="flex items-center justify-between">
                {/* Asset Info */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-700/50 text-slate-300 font-bold text-sm">
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{coin.symbol.replace('USDT', '')}</div>
                    <div className="text-xs text-slate-400">{coin.symbol}</div>
                  </div>
                </div>

                {/* Price & Change */}
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-semibold text-white">${coin.price.toFixed(coin.price < 1 ? 4 : 2)}</div>
                    <div className={`text-sm ${coin.pumpPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {coin.pumpPercent >= 0 ? '+' : ''}{coin.pumpPercent.toFixed(2)}%
                    </div>
                  </div>
                  <div className="text-right hidden md:block">
                    <div className="font-semibold text-white">${(coin.volume24h / 1000000).toFixed(1)}M</div>
                    <div className="text-xs text-slate-400">Volume</div>
                  </div>
                </div>
              </div>

              {/* Mobile-only volume */}
              <div className="md:hidden mt-3 pt-3 border-t border-slate-700/50">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">24h Volume</span>
                  <span className="text-white font-semibold">${(coin.volume24h / 1000000).toFixed(1)}M</span>
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

