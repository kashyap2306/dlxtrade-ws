import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { tradesApi, usersApi, executionApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';

export default function PnLWidget() {
  const { user } = useAuth();
  const [pnlData, setPnlData] = useState<any[]>([]);
  const [dailyPnL, setDailyPnL] = useState<number>(0);
  const [weeklyPnL, setWeeklyPnL] = useState<number>(0);
  const [winRate, setWinRate] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  const loadPnL = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch recent trades to calculate PnL
      const tradesResponse = await tradesApi.get({ uid: user.uid, limit: 1000 });
      const trades = tradesResponse.data?.trades || [];
      
      // Calculate daily PnL
      const today = new Date().toISOString().split('T')[0];
      const dailyPnLValue = trades
        .filter((trade: any) => {
          const tradeDate = trade.timestamp ? new Date(trade.timestamp).toISOString().split('T')[0] : '';
          return tradeDate === today;
        })
        .reduce((sum: number, trade: any) => sum + (trade.pnl || 0), 0);
      setDailyPnL(dailyPnLValue);

      // Calculate weekly PnL (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weeklyPnLValue = trades
        .filter((trade: any) => {
          const tradeDate = trade.timestamp ? new Date(trade.timestamp) : new Date(0);
          return tradeDate >= weekAgo;
        })
        .reduce((sum: number, trade: any) => sum + (trade.pnl || 0), 0);
      setWeeklyPnL(weeklyPnLValue);

      // Calculate win rate
      const executedTrades = trades.filter((trade: any) => trade.pnl !== undefined && trade.pnl !== null);
      if (executedTrades.length > 0) {
        const winningTrades = executedTrades.filter((trade: any) => trade.pnl > 0).length;
        setWinRate((winningTrades / executedTrades.length) * 100);
      }

      // Calculate average accuracy from execution logs
      try {
        const execResponse = await executionApi.getLogs({ limit: 100 });
        const execLogs = execResponse.data || [];
        const executedLogs = execLogs.filter((log: any) => log.action === 'EXECUTED' && log.accuracyUsed);
        if (executedLogs.length > 0) {
          const avgAccuracy = executedLogs.reduce((sum: number, log: any) => sum + (log.accuracyUsed || 0), 0) / executedLogs.length;
          setAccuracy(avgAccuracy * 100);
        }
      } catch (err: any) {
        suppressConsoleError(err, 'loadAccuracy');
      }

      // Create chart data from last 30 days of trades
      const last30Days = Array.from({ length: 30 }, (_, i) => {
        const date = new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const dayPnL = trades
          .filter((trade: any) => {
            const tradeDate = trade.timestamp ? new Date(trade.timestamp).toISOString().split('T')[0] : '';
            return tradeDate === dateStr;
          })
          .reduce((sum: number, trade: any) => sum + (trade.pnl || 0), 0);
        return {
          date: dateStr.split('-').slice(1).join('/'), // Format as MM/DD
          pnl: dayPnL,
        };
      });
      
      setPnlData(last30Days);
    } catch (err: any) {
      suppressConsoleError(err, 'loadPnL');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadPnL();
      // Reduced polling interval to 60 seconds to improve performance
      const interval = setInterval(loadPnL, 60000);
      return () => clearInterval(interval);
    }
  }, [user, loadPnL]);

  if (loading && pnlData.length === 0) {
    return (
      <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10">
        <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-4">
          PnL & Performance
        </h2>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400">Loading PnL data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6 shadow-2xl shadow-purple-500/10 hover:shadow-purple-500/20 transition-all duration-300 overflow-hidden">
      <h2 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-6">
        PnL & Performance
      </h2>
      
      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-black/40 rounded-xl p-4 border border-purple-500/20">
            <div className="text-xs text-gray-400 mb-1">Daily PnL</div>
            <div className={`text-2xl font-bold ${dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${dailyPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-black/40 rounded-xl p-4 border border-purple-500/20">
            <div className="text-xs text-gray-400 mb-1">Weekly PnL</div>
            <div className={`text-2xl font-bold ${weeklyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${weeklyPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-black/40 rounded-xl p-4 border border-purple-500/20">
            <div className="text-xs text-gray-400 mb-1">Win Rate</div>
            <div className={`text-2xl font-bold ${
              winRate >= 50 ? 'text-green-400' : winRate >= 30 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {winRate.toFixed(1)}%
            </div>
          </div>
          <div className="bg-black/40 rounded-xl p-4 border border-purple-500/20">
            <div className="text-xs text-gray-400 mb-1">Accuracy</div>
            <div className={`text-2xl font-bold ${
              accuracy >= 85 ? 'text-green-400' : accuracy >= 70 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {accuracy.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-48">
          {pnlData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pnlData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" opacity={0.3} />
                <XAxis 
                  dataKey="date" 
                  stroke="#9ca3af" 
                  fontSize={12}
                  tick={{ fill: '#9ca3af' }}
                />
                <YAxis 
                  stroke="#9ca3af" 
                  fontSize={12}
                  tick={{ fill: '#9ca3af' }}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#0a0f1c', 
                    border: '1px solid #7c3aed', 
                    borderRadius: '8px', 
                    color: '#e5e7eb',
                    padding: '8px'
                  }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="pnl" 
                  stroke="#a855f7" 
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#a855f7' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              No PnL data available yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

