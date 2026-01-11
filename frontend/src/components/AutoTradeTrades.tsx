import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { autoTradeApi, researchApi } from '../services/api';

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


interface ResearchHistoryEntry {
  id: string;
  symbol: string;
  signal: string;
  accuracy: number;
  price: number;
  source: string;
  status: string;
  decision: string;
  executionStatus?: string;
  timestamp: string;
  skipReason?: string;
  tradePlan?: any;
}

interface AutoTradeTradesProps {
  activeTrades: ActiveTrade[];
  loadLiveData: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'error') => void;
}

export const AutoTradeTrades: React.FC<AutoTradeTradesProps> = ({
  activeTrades,
  loadLiveData,
  showToast,
}) => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [researchHistory, setResearchHistory] = useState<ResearchHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fetch research history on component mount
  // CRITICAL: Research history is the SINGLE SOURCE OF TRUTH for auto-trade decisions
  // NEVER use activityLogs or execution logs - they contain different data (trade execution vs research decisions)
  useEffect(() => {
    const fetchResearchHistory = async () => {
      setLoadingHistory(true);
      try {
        const response = await researchApi.deepResearch.getHistory(20); // Get last 20 entries
        const historyData = response.data || [];
        setResearchHistory(historyData);
      } catch (error: any) {
        console.error('Failed to fetch research history:', error);
        setResearchHistory([]);
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchResearchHistory();
  }, []);


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

        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-blue-700 scrollbar-track-blue-900">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b border-blue-500/20">
                  <th className="text-left text-blue-100/60 py-2">SR</th>
                  <th className="text-left text-blue-100/60 py-2">Coin</th>
                  <th className="text-left text-blue-100/60 py-2">Signal</th>
                  <th className="text-left text-blue-100/60 py-2">Accuracy</th>
                  <th className="text-left text-blue-100/60 py-2">Price</th>
                  <th className="text-left text-blue-100/60 py-2">Status</th>
                  <th className="text-left text-blue-100/60 py-2">Decision</th>
                  <th className="text-left text-blue-100/60 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {Array.isArray(researchHistory) && researchHistory.length > 0 ? (
                  researchHistory
                    // CRITICAL: Only show AUTO_TRADE entries - research history contains other sources (manual, telegram)
                    // NEVER show non-AUTO_TRADE entries as they represent different research types
                    .filter(entry => entry.source === 'AUTO_TRADE')
                    // CRITICAL: Show ALL AUTO_TRADE entries including SKIPPED ones with null/empty fields
                    // SKIPPED entries must remain visible to show when/why auto-trade cycles didn't execute
                    .slice(0, 5)
                    .map((entry, index) => {
                      // Always render accuracy directly from API response
                      const isExecuted = entry.decision === 'EXECUTED';
                      const isSkipped = entry.decision === 'SKIPPED';
                      const accuracy = typeof entry.accuracy === 'number' ? entry.accuracy : 0;

                      return (
                        <tr key={entry.id} className={`border-b border-blue-500/10 ${index % 2 === 0 ? 'bg-[#0d1421]' : 'bg-[#0b0f18]'} hover:bg-blue-900/20`}>
                          <td className="py-3 text-blue-100">{index + 1}</td>
                          <td className="py-3 text-blue-100 font-medium">{entry.symbol}</td>
                          <td className="py-3 text-blue-100">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              entry.signal === 'BUY' ? 'bg-green-600/20 text-green-300' :
                              entry.signal === 'SELL' ? 'bg-red-600/20 text-red-300' :
                              'bg-gray-600/20 text-gray-300'
                            }`}>
                              {entry.signal || 'HOLD'}
                            </span>
                          </td>
                          <td className="py-3 text-blue-100">
                            <span className={`font-medium ${
                              accuracy >= 80 ? 'text-green-400' :
                              accuracy >= 60 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {accuracy.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 text-blue-100">
                            {entry.price ? `$${entry.price.toFixed(4)}` : 'N/A'}
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              isExecuted ? 'bg-green-600/20 text-green-300' :
                              isSkipped ? 'bg-yellow-600/20 text-yellow-300' :
                              'bg-gray-600/20 text-gray-300'
                            }`}>
                              {entry.status || 'UNKNOWN'}
                            </span>
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              isExecuted ? 'bg-green-600/20 text-green-300' :
                              isSkipped ? 'bg-orange-600/20 text-orange-300' :
                              'bg-gray-600/20 text-gray-300'
                            }`}>
                              {entry.decision || 'UNKNOWN'}
                            </span>
                          </td>
                          <td className="py-3 text-blue-100/60">
                            {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'N/A'}
                          </td>
                        </tr>
                      );
                    })
                ) : (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-blue-100/60">
                      No auto-trade history available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
