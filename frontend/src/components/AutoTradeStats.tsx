import React, { useEffect } from 'react';
import { usePolling } from '../hooks/usePerformance';

interface AutoTradeStatsProps {
  performanceStats: any;
  tradeAccuracy: {accuracy: number, totalTrades: number, winTrades: number};
  loadPerformanceStats: () => Promise<void>;
  calculateTradeAccuracy: () => void;
  calculateTodayTrades: () => void;
  activityLogs: any[];
}

export const AutoTradeStats: React.FC<AutoTradeStatsProps> = ({
  performanceStats,
  tradeAccuracy,
  loadPerformanceStats,
  calculateTradeAccuracy,
  calculateTodayTrades,
  activityLogs,
}) => {
  // Calculate trade accuracy and today's trades when activity logs change
  useEffect(() => {
    calculateTradeAccuracy();
    calculateTodayTrades();
  }, [calculateTradeAccuracy, calculateTodayTrades]);

  // Load performance stats with polling (30 second intervals when visible)
  usePolling(loadPerformanceStats, 30000, true); // 30 seconds

  return (
    <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-blue-200">Performance Stats</h2>
        {/* Trade Accuracy Badge */}
        {tradeAccuracy.totalTrades > 0 && (
          <div className={`px-4 py-2 rounded-lg border font-medium text-sm ${
            tradeAccuracy.accuracy >= 70
              ? 'bg-green-600/40 text-green-300 border-green-500/50 shadow-lg shadow-green-500/20'
              : tradeAccuracy.accuracy >= 40
              ? 'bg-blue-600/40 text-blue-300 border-blue-500/50 shadow-lg shadow-blue-500/20'
              : 'bg-red-600/40 text-red-300 border-red-500/50 shadow-lg shadow-red-500/20'
          }`}>
            {tradeAccuracy.accuracy >= 70 ? '🔥 HOT' :
             tradeAccuracy.accuracy >= 40 ? '⚡ STABLE' : '❄ COLD'} – {tradeAccuracy.accuracy}% Win Rate
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-sm text-blue-100/60">Today</div>
          <div className={`text-xl font-bold ${performanceStats?.dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${performanceStats?.dailyPnL?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div>
          <div className="text-sm text-blue-100/60">All Time</div>
          <div className={`text-xl font-bold ${performanceStats?.allTimePnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${performanceStats?.allTimePnL?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div>
          <div className="text-sm text-blue-100/60">Win Rate</div>
          <div className="text-xl font-bold text-blue-400">
            {performanceStats?.winRate?.toFixed(1) || '0.0'}%
          </div>
        </div>
        <div>
          <div className="text-sm text-blue-100/60">Total Trades</div>
          <div className="text-xl font-bold text-purple-400">
            {performanceStats?.totalTrades || 0}
          </div>
        </div>
      </div>
    </div>
  );
};
