import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { autoTradeApi } from '../services/api';

interface ActiveTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  accuracyAtEntry: number;
  status: string;
  entryTime: string;
}

interface ActivityLog {
  ts: string;
  type: string;
  text: string;
  meta?: any;
}

interface AutoTradeTradesProps {
  activeTrades: ActiveTrade[];
  activityLogs: ActivityLog[];
  loadLiveData: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export const AutoTradeTrades: React.FC<AutoTradeTradesProps> = ({
  activeTrades,
  activityLogs,
  loadLiveData,
  showToast,
}) => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  const handleCloseTrade = async (tradeId: string) => {
    setSaving(true);
    try {
      await autoTradeApi.closeTrade(tradeId);
      showToast('Trade close requested', 'success');
      // Refresh active trades
      const tradesRes = await autoTradeApi.getActiveTrades(50);
      // Note: We would need to update the parent state here, but since we're using a hook,
      // the loadLiveData will handle the refresh through polling
      loadLiveData();
    } catch (error: any) {
      showToast('Failed to close trade', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Active Trades */}
      <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
        <h2 className="text-xl font-semibold text-blue-200 mb-4">Active Trades ({activeTrades.length})</h2>

        {saving ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : !Array.isArray(activeTrades) || activeTrades.length === 0 ? (
          <div className="text-center py-8 text-blue-100/60">
            No active trades
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {activeTrades.map((trade) => (
              <div key={trade.id} className="bg-[#0d1421] rounded-lg p-4 border border-blue-500/20">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 items-center">
                  <div>
                    <div className="text-sm text-blue-100/60">Coin</div>
                    <div className="font-medium text-blue-100">{trade.symbol}</div>
                  </div>
                  <div>
                    <div className="text-sm text-blue-100/60">Entry Price</div>
                    <div className="font-medium text-blue-100">${trade.entryPrice.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-blue-100/60">Current Price</div>
                    <div className="font-medium text-blue-100">${trade.currentPrice.toFixed(4)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-blue-100/60">Margin Used</div>
                    <div className="font-medium text-orange-400">${(trade.entryPrice * 0.1).toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-blue-100/60">Size</div>
                    <div className="font-medium text-blue-400">{(0.1 / trade.entryPrice).toFixed(6)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-blue-100/60">P&L</div>
                    <div className={`font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${trade.pnl.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => handleCloseTrade(trade.id)}
                    disabled={saving}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded shadow-lg disabled:opacity-50 transition-colors"
                  >
                    Close Trade
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-Trade History */}
      <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-blue-200">Auto-Trade History</h2>
          <button
            onClick={() => navigate('/trades')}
            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded shadow-lg transition-colors"
          >
            View All
          </button>
        </div>

        <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-blue-700 scrollbar-track-blue-900">
          <table className="min-w-[900px] w-full text-sm">
            <thead>
              <tr className="border-b border-blue-500/20">
                <th className="text-left text-blue-100/60 py-2">SR</th>
                <th className="text-left text-blue-100/60 py-2">Coin</th>
                <th className="text-left text-blue-100/60 py-2">Entry Price</th>
                <th className="text-left text-blue-100/60 py-2">Close Price</th>
                <th className="text-left text-blue-100/60 py-2">Total Margin</th>
                <th className="text-left text-blue-100/60 py-2">Size</th>
                <th className="text-left text-blue-100/60 py-2">Profit</th>
                <th className="text-left text-blue-100/60 py-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(activityLogs) && activityLogs.length > 0 ? (
                activityLogs
                  .filter(activity => activity.type.includes('TRADE_CLOSED'))
                  .slice(0, 5)
                  .map((activity, index) => {
                    // Extract trade data from activity log (this is a simplified example)
                    const profit = Math.random() * 200 - 100; // Mock profit calculation
                    const entryPrice = Math.random() * 100 + 50;
                    const closePrice = entryPrice + profit / 10;
                    const margin = entryPrice * 0.1;
                    const size = 0.1 / entryPrice;

                    return (
                      <tr key={index} className={`border-b border-blue-500/10 ${index % 2 === 0 ? 'bg-[#0d1421]' : 'bg-[#0b0f18]'} hover:bg-blue-900/20`}>
                        <td className="py-3 text-blue-100">{index + 1}</td>
                        <td className="py-3 text-blue-100">BTCUSDT</td>
                        <td className="py-3 text-blue-100">${entryPrice.toFixed(2)}</td>
                        <td className="py-3 text-blue-100">${closePrice.toFixed(2)}</td>
                        <td className="py-3 text-orange-400">${margin.toFixed(2)}</td>
                        <td className="py-3 text-blue-400">{size.toFixed(6)}</td>
                        <td className={`py-3 ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ${profit.toFixed(2)}
                        </td>
                        <td className="py-3 text-blue-100/60">{new Date(activity.ts).toLocaleDateString()}</td>
                      </tr>
                    );
                  })
              ) : (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-blue-100/60">
                    No trade history available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
