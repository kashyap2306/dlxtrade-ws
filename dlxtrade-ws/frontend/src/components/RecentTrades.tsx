import { useState, useEffect, useCallback, useMemo } from 'react';
import { tradesApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';

export default function RecentTrades() {
  const { user } = useAuth();
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTrades = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await tradesApi.get({ uid: user.uid, limit: 100 });
      const allTrades = response.data?.trades || [];
      
      // Filter only today's trades
      const today = new Date().toISOString().split('T')[0];
      const todayTrades = allTrades
        .filter((trade: any) => {
          const tradeDate = trade.timestamp ? new Date(trade.timestamp).toISOString().split('T')[0] : '';
          return tradeDate === today;
        })
        .sort((a: any, b: any) => {
          const timeA = new Date(a.timestamp || 0).getTime();
          const timeB = new Date(b.timestamp || 0).getTime();
          return timeB - timeA; // Newest first
        })
        .slice(0, 10); // Show max 10 trades
      
      setTrades(todayTrades);
    } catch (err: any) {
      suppressConsoleError(err, 'loadRecentTrades');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadTrades();
      // Reduced polling interval to 60 seconds to improve performance
      const interval = setInterval(loadTrades, 60000);
      return () => clearInterval(interval);
    }
  }, [user, loadTrades]);

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-1">
            Recent Trades
          </h2>
          <p className="text-xs sm:text-sm text-gray-400">Today's executed trades by agent</p>
        </div>
        <button
          onClick={loadTrades}
          disabled={loading}
          className="px-4 py-2 text-xs sm:text-sm bg-black/40 backdrop-blur-sm border border-purple-500/40 text-gray-200 rounded-xl hover:bg-purple-500/20 hover:border-purple-400/60 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <span className="w-3 h-3 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin"></span>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      </div>

      {loading && trades.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-700/30 rounded-lg animate-pulse"></div>
          ))}
        </div>
      ) : trades.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm">No trades executed today</p>
        </div>
      ) : (
        <div className="space-y-3">
          {trades.map((trade) => (
            <div
              key={trade.id || trade.timestamp}
              className="relative bg-black/40 backdrop-blur-sm border border-purple-500/30 rounded-xl p-4 hover:border-purple-400/50 transition-all duration-300 overflow-hidden group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-sm ${
                    trade.side === 'BUY' || trade.side === 'buy'
                      ? 'bg-green-500/20 text-green-400 border border-green-400/30'
                      : 'bg-red-500/20 text-red-400 border border-red-400/30'
                  }`}>
                    {trade.side === 'BUY' || trade.side === 'buy' ? 'BUY' : 'SELL'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg font-bold text-white">{trade.symbol || 'N/A'}</span>
                      {trade.strategy && (
                        <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-400/30">
                          {trade.strategy}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span>Price: <span className="text-white font-medium">${trade.price?.toFixed(2) || 'N/A'}</span></span>
                      <span>Size: <span className="text-white font-medium">{trade.size?.toFixed(4) || 'N/A'}</span></span>
                      <span className="text-gray-500 font-mono">
                        {trade.timestamp ? new Date(trade.timestamp).toLocaleTimeString() : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${
                    (trade.pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    ${(trade.pnl || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400">P/L</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

