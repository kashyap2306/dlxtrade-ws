import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';

interface CrowdConsensusTrade {
  id: string;
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rrRatio: number;
  status: 'OPEN' | 'WIN' | 'LOSS';
  executedAt: Date;
}

interface SkippedTrade {
  id: string;
  pair: 'BTCUSDT' | 'ETHUSDT';
  direction: 'LONG' | 'SHORT';
  reason: 'NO_CONSENSUS' | 'RR_TOO_LOW' | 'ENTRY_LATE' | 'SR_BLOCKED' | 'DAILY_LIMIT_REACHED' | 'EXCHANGE_ERROR';
  timestamp: Date;
}

interface ExchangeConnection {
  connected: boolean;
  exchange?: string;
  message?: string;
}

interface AutoTradeStatus {
  autoTradeEnabled: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  lastUpdated?: Date;
  dryRun?: boolean;
}

export default function CrowdConsensus() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<CrowdConsensusTrade[]>([]);
  const [skippedTrades, setSkippedTrades] = useState<SkippedTrade[]>([]);
  const [exchangeConnection, setExchangeConnection] = useState<ExchangeConnection>({ connected: false });
  const [autoTradeStatus, setAutoTradeStatus] = useState<AutoTradeStatus>({ autoTradeEnabled: false, status: 'INACTIVE' });
  const [togglingAutoTrade, setTogglingAutoTrade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agentAccessChecked, setAgentAccessChecked] = useState(false);
  const [hasAgentAccess, setHasAgentAccess] = useState(false);

  // Check Firestore approval (users/{uid}.approvedAgents)
  useEffect(() => {
    const checkAgentAccess = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
        const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes('COPY_TRADING_AGENT');
        console.debug({ from: 'CrowdConsensus', agentKey: 'COPY_TRADING_AGENT', hasAccess });
        setHasAgentAccess(hasAccess);
        setAgentAccessChecked(true);
      } catch (error) {
        console.error('Error checking agent access:', error);
        setHasAgentAccess(false);
        setAgentAccessChecked(true);
      }
    };

    checkAgentAccess();
  }, [user]);

  // Load data when access is confirmed
  useEffect(() => {
    if (!user || !hasAgentAccess) return;

    loadAllData();

    // Set up polling for live updates
    const interval = setInterval(() => {
      loadTrades();
      loadSkippedTrades();
      loadAutoTradeStatus();
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [user, hasAgentAccess]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadExchangeConnection(),
        loadAutoTradeStatus(),
        loadTrades(),
        loadSkippedTrades()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadExchangeConnection = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusExchangeStatus();
      setExchangeConnection(response.data?.exchangeStatus || { connected: false });
    } catch (error: any) {
      console.error('Error loading exchange connection:', error);
      setExchangeConnection({ connected: false, message: 'Error checking exchange connection' });
    }
  };

  const loadAutoTradeStatus = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusStatus();
      const data = response.data || { autoTradeEnabled: false, status: 'INACTIVE' };

      // Also load settings to get dryRun status
      const settingsResponse = await agentsApi.getCrowdConsensusSettings();
      const settings = settingsResponse.data || {};

      setAutoTradeStatus({
        ...data,
        dryRun: settings.dryRun || false
      });
    } catch (error: any) {
      console.error('Error loading auto trade status:', error);
      setAutoTradeStatus({ autoTradeEnabled: false, status: 'INACTIVE', dryRun: false });
    }
  };

  const loadTrades = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusSignals(50);
      const signals = response.data?.signals || [];
      // Transform signals to match CrowdConsensusTrade interface
      const transformedTrades: CrowdConsensusTrade[] = signals.map((signal: any) => ({
        id: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        rrRatio: signal.rrRatio,
        status: signal.status || 'OPEN',
        executedAt: new Date(signal.executedAt || signal.timestamp)
      }));
      setTrades(transformedTrades);
    } catch (error: any) {
      console.error('Error loading trades:', error);
      if (error.response?.status === 403) {
        setError('Access denied: Crowd Consensus Copy Trade not approved');
      }
    }
  };

  const loadSkippedTrades = async () => {
    if (!user) return;

    try {
      const response = await agentsApi.getCrowdConsensusSkippedTrades(50);
      setSkippedTrades(response.data?.skippedTrades || []);
    } catch (error: any) {
      console.error('Error loading skipped trades:', error);
      setSkippedTrades([]);
    }
  };

  const toggleAutoTrade = async () => {
    if (togglingAutoTrade) return;

    setTogglingAutoTrade(true);
    setError(null);

    try {
      if (autoTradeStatus.autoTradeEnabled) {
        // Stop auto trade
        await agentsApi.stopCrowdConsensusAutoTrade();
        setAutoTradeStatus({ autoTradeEnabled: false, status: 'INACTIVE', lastUpdated: new Date() });
      } else {
        // Start auto trade
        await agentsApi.startCrowdConsensusAutoTrade();
        setAutoTradeStatus({ autoTradeEnabled: true, status: 'ACTIVE', lastUpdated: new Date() });
      }
    } catch (error: any) {
      console.error('Error toggling auto trade:', error);
      setError(error.response?.data?.error || 'Failed to toggle auto trade');
    } finally {
      setTogglingAutoTrade(false);
    }
  };

  // Strict render guards: Wait for auth and agent access check
  if (!authReady || !agentAccessChecked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  // Check user-agent linkage document directly
  if (!hasAgentAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-lg mb-4">Access Denied</div>
          <div className="text-gray-400">You don't have access to Crowd Consensus Copy Trade</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-xl border-b border-purple-500/20">
          <div className="container mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                👥 Crowd Consensus Copy Trade
              </h1>
              <div className="flex items-center gap-2">
                <button onClick={loadAllData} className="btn btn-secondary" disabled={loading}>Refresh</button>
                <button onClick={() => navigate('/agents')} className="btn btn-secondary">Back</button>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-6">
          {/* Error Banner */}
          {error && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
              <div className="text-red-400 text-sm font-medium mb-1">Error</div>
              <div className="text-gray-300 text-sm">{error}</div>
            </div>
          )}

          {/* Exchange Connection Status */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Exchange Connection</h2>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${exchangeConnection.connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <div>
                <div className="text-white font-medium">
                  {exchangeConnection.connected
                    ? `Connected to ${exchangeConnection.exchange}`
                    : 'Exchange not connected'
                  }
                </div>
                <div className="text-gray-400 text-sm">
                  {exchangeConnection.message || (exchangeConnection.connected ? 'Ready for trading' : 'Go to Settings to connect an exchange')}
                </div>
              </div>
            </div>
          </div>

          {/* Auto Trade Toggle */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-white mb-2">Auto Trade</h2>
                  <div className="text-gray-400 text-sm">
                    {autoTradeStatus.autoTradeEnabled
                      ? 'Crowd Consensus auto trading is active'
                      : 'Enable to start Crowd Consensus auto trading'
                    }
                  </div>
                  {autoTradeStatus.dryRun && (
                    <div className="text-yellow-400 text-sm font-medium mt-1">
                      DRY RUN MODE - No real trades executed
                    </div>
                  )}
                  {autoTradeStatus.lastUpdated && (
                    <div className="text-gray-500 text-xs mt-1">
                      Last updated: {new Date(autoTradeStatus.lastUpdated).toLocaleString()}
                    </div>
                  )}
                </div>
              <button
                onClick={toggleAutoTrade}
                disabled={togglingAutoTrade || !exchangeConnection.connected}
                className={`btn ${autoTradeStatus.autoTradeEnabled ? 'btn-danger' : 'btn-success'} ${togglingAutoTrade ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {togglingAutoTrade ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    {autoTradeStatus.autoTradeEnabled ? 'Stopping...' : 'Starting...'}
                  </div>
                ) : (
                  autoTradeStatus.autoTradeEnabled ? 'Stop Auto Trade' : 'Start Auto Trade'
                )}
              </button>
            </div>
          </div>

          {/* Live Trade History */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Live Trade History</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-purple-500/20">
                    <th className="text-left py-2 pr-4 font-medium">Pair</th>
                    <th className="text-left py-2 pr-4 font-medium">Direction</th>
                    <th className="text-left py-2 pr-4 font-medium">Entry Price</th>
                    <th className="text-left py-2 pr-4 font-medium">Stop Loss</th>
                    <th className="text-left py-2 pr-4 font-medium">Take Profit</th>
                    <th className="text-left py-2 pr-4 font-medium">RR</th>
                    <th className="text-left py-2 pr-4 font-medium">Status</th>
                    <th className="text-left py-2 pr-4 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        No executed trades yet
                      </td>
                    </tr>
                  ) : (
                    trades.map((trade) => (
                      <tr key={trade.id} className="border-b border-purple-500/10">
                        <td className="py-2 pr-4 text-white font-medium">{trade.pair}</td>
                        <td className={`py-2 pr-4 font-medium ${trade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.direction}
                        </td>
                        <td className="py-2 pr-4 text-gray-300">${trade.entryPrice?.toFixed(2) || '-'}</td>
                        <td className="py-2 pr-4 text-gray-300">${trade.stopLoss?.toFixed(2) || '-'}</td>
                        <td className="py-2 pr-4 text-gray-300">${trade.takeProfit?.toFixed(2) || '-'}</td>
                        <td className="py-2 pr-4 text-green-400 font-medium">
                          {trade.rrRatio ? `${trade.rrRatio.toFixed(1)}:1` : '-'}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            trade.status === 'WIN' ? 'bg-green-500/20 text-green-400' :
                            trade.status === 'LOSS' ? 'bg-red-500/20 text-red-400' :
                            trade.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {trade.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-gray-300">
                          {trade.executedAt ? new Date(trade.executedAt).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Skipped / Rejected Trade Diagnostics */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Diagnostics / Skipped Trades</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-purple-500/20">
                    <th className="text-left py-2 pr-4 font-medium">Pair</th>
                    <th className="text-left py-2 pr-4 font-medium">Direction</th>
                    <th className="text-left py-2 pr-4 font-medium">Reason</th>
                    <th className="text-left py-2 pr-4 font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {skippedTrades.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-gray-400">
                        No skipped trades
                      </td>
                    </tr>
                  ) : (
                    skippedTrades.map((skippedTrade) => (
                      <tr key={skippedTrade.id} className="border-b border-purple-500/10">
                        <td className="py-2 pr-4 text-white font-medium">{skippedTrade.pair}</td>
                        <td className={`py-2 pr-4 font-medium ${skippedTrade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                          {skippedTrade.direction}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            skippedTrade.reason === 'NO_CONSENSUS' ? 'bg-gray-500/20 text-gray-400' :
                            skippedTrade.reason === 'RR_TOO_LOW' ? 'bg-orange-500/20 text-orange-400' :
                            skippedTrade.reason === 'ENTRY_LATE' ? 'bg-yellow-500/20 text-yellow-400' :
                            skippedTrade.reason === 'SR_BLOCKED' ? 'bg-purple-500/20 text-purple-400' :
                            skippedTrade.reason === 'DAILY_LIMIT_REACHED' ? 'bg-red-500/20 text-red-400' :
                            skippedTrade.reason === 'EXCHANGE_ERROR' ? 'bg-red-500/20 text-red-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {skippedTrade.reason.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-gray-300">
                          {skippedTrade.timestamp ? new Date(skippedTrade.timestamp).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
