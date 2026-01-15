import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi, usersApi, settingsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import { agentKeyToSlug } from '../utils/agentKeyToSlug';

export default function TradingAgentControl() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState<any[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agentAccessChecked, setAgentAccessChecked] = useState(false);
  const [hasAgentAccess, setHasAgentAccess] = useState(false);
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);

  const [exchangeConfig, setExchangeConfig] = useState<any | null>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [togglingAutoTrade, setTogglingAutoTrade] = useState(false);
  const [skippedTrades, setSkippedTrades] = useState<any[]>([]);
  const [agentConfig, setAgentConfig] = useState<any | null>(null);

  // Check Firestore approval (users/{uid}.approvedAgents) and resolve agent ID
  useEffect(() => {
    const checkAgentAccess = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
        const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes('TRADING_AGENT');
        console.debug({ from: 'TradingAgentControl', agentKey: 'TRADING_AGENT', hasAccess });
        setHasAgentAccess(hasAccess);

        if (hasAccess) {
          // Use canonical slug for Trading Agent
          setResolvedAgentId('trading-agent');
        }

        setAgentAccessChecked(true);
      } catch (error) {
        console.error('Error checking agent access:', error);
        setHasAgentAccess(false);
        setAgentAccessChecked(true);
      }
    };

    checkAgentAccess();
  }, [user]);

  // Load exchange config independently of agent status
  useEffect(() => {
    if (!user) return;

    const loadExchangeConfig = async () => {
      try {
        const exchangeResp = await settingsApi.loadExchangeConfig(user.uid);
        console.log('[TRADING_AGENT] Exchange config loaded:', exchangeResp.data);
        setExchangeConfig(exchangeResp.data || {});
      } catch (err) {
        console.warn('[TRADING_AGENT] Failed to load exchange config:', err);
        setExchangeConfig({});
      }
    };

    loadExchangeConfig();
  }, [user]);

  // Clear loading state when agent access check is complete but no agent is resolved
  useEffect(() => {
    if (agentAccessChecked && !resolvedAgentId) {
      setLoading(false);
    }
  }, [agentAccessChecked, resolvedAgentId]);

  // Load data when access is confirmed and agent ID is resolved
  useEffect(() => {
    if (!user || !hasAgentAccess || !resolvedAgentId) return;

    loadData();
  }, [user, hasAgentAccess, resolvedAgentId]);

  const loadData = async () => {
    if (!user || !resolvedAgentId) {
      console.warn('loadData: Skipping API calls - agentId not resolved yet');
      setLoading(false); // Always clear loading state
      return;
    }
    const slug = agentKeyToSlug('TRADING_AGENT');
    setLoading(true);
    try {
      // Load agent status and config
      const agentResp = await agentsApi.getTradingAgentControl(slug);
      setAutoTradeEnabled(agentResp.data?.status === 'ACTIVE');
      setAgentConfig(agentResp.data?.config || null);

      // Load trades from the trading agent
      const tradesResp = await agentsApi.getTradingAgentTrades(slug, 20);
      setTrades(tradesResp.data?.trades || []);

      // Load diagnostics/skipped trades
      const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 20);
      setSkippedTrades(diagnosticsResp.data?.diagnostics || []);

    } catch (err: any) {
      console.error('Error loading data:', err);
      showToast('Failed to load data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isExchangeConnected = (cfg: any): { connected: boolean; exchange?: string } => {
    // Use the same simple exchange connection check as Settings and Dashboard
    const connected = Boolean(cfg && cfg.exchange);
    const exchange = cfg?.exchange || undefined;
    return { connected, exchange };
  };

  const handleToggleAutoTrade = async (nextEnabled: boolean) => {
    if (!resolvedAgentId) {
      console.warn('handleToggleAutoTrade: Skipping API call - agentId not resolved yet');
      showToast('Agent not ready yet', 'error');
      return;
    }
    const slug = agentKeyToSlug('TRADING_AGENT');
    // Validate exchange connection before starting trading
    if (nextEnabled) {
      const exchangeStatus = isExchangeConnected(exchangeConfig);
      if (!exchangeStatus.connected) {
        showToast('Exchange not connected. Please connect your exchange in Settings first.', 'error');
        return;
      }
    }

    setTogglingAutoTrade(true);
    try {
      if (nextEnabled) {
        await agentsApi.startTradingAgent(slug);
        setAutoTradeEnabled(true);
        showToast('Auto trading started', 'success');
      } else {
        await agentsApi.stopTradingAgent(slug);
        setAutoTradeEnabled(false);
        showToast('Auto trading stopped', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update auto trade', 'error');
      // Don't change the state if the API call failed
    } finally {
      setTogglingAutoTrade(false);
    }
  };

  // Strict render guards: Wait for auth and agent access check
  if (!authReady || !agentAccessChecked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-blue-200">Loading...</p>
        </div>
      </div>
    );
  }

  // Check user-agent linkage document directly
  if (!hasAgentAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-lg mb-4">Access Denied</div>
          <div className="text-gray-400">You don't have access to Trading Agent</div>
        </div>
      </div>
    );
  }

  // Check if user has access to trading agent (document exists)
  if (agentAccessChecked && !hasAgentAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Agent access not granted yet</h2>
          <p className="text-gray-400 mb-6">Trading Agent access not granted yet</p>
          <button
            onClick={() => navigate('/agents')}
            className="btn btn-primary"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }


  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-blue-200">Loading trading agent...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
        <div className="p-6 max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white">Trading Agent</h1>
              <div className="text-sm text-gray-400">
                BTC/USDT • ETH/USDT • RSI + Bollinger Bands Strategy
              </div>
            </div>
            <button onClick={() => navigate('/agents')} className="btn btn-secondary">Back</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-800/40 border border-purple-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-400">Exchange Connection</div>
                  {(() => {
                    const s = isExchangeConnected(exchangeConfig);
                    return (
                      <div className="text-white font-medium mt-1">
                        {s.connected ? `Connected${s.exchange ? ` • ${s.exchange}` : ''}` : 'Not Connected'}
                      </div>
                    );
                  })()}
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/settings#exchange-connection')}
                >
                  Manage
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">Uses Settings → Exchange. You can’t connect a second exchange here.</div>
            </div>

            <div className="bg-slate-800/40 border border-purple-500/20 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-400">Auto Trade</div>
                  <div className="text-white font-medium mt-1">
                    {resolvedAgentId ? (autoTradeEnabled ? 'Running' : 'Stopped') : 'Agent Not Ready'}
                  </div>
                  {agentConfig?.dryRun && (
                    <div className="text-yellow-400 text-xs mt-1 font-medium">
                      DRY RUN MODE - No real trades
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  disabled={togglingAutoTrade || !resolvedAgentId || !isExchangeConnected(exchangeConfig).connected}
                  onClick={() => handleToggleAutoTrade(!autoTradeEnabled)}
                >
                  {togglingAutoTrade ? 'Updating…' : autoTradeEnabled ? 'Stop Trading' : 'Start Trading'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/40 border border-purple-500/20 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Trades History</h2>
              <button
                className="btn btn-secondary"
                onClick={() => loadData()}
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {trades.length === 0 ? (
              <div className="text-sm text-gray-400">No trades yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-purple-500/20">
                      <th className="text-left py-2 pr-4 font-medium">Pair</th>
                      <th className="text-left py-2 pr-4 font-medium">Side</th>
                      <th className="text-left py-2 pr-4 font-medium">Entry Price</th>
                      <th className="text-left py-2 pr-4 font-medium">SL</th>
                      <th className="text-left py-2 pr-4 font-medium">TP</th>
                      <th className="text-left py-2 pr-4 font-medium">Result</th>
                      <th className="text-left py-2 pr-4 font-medium">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade) => (
                      <tr key={trade.id} className="border-b border-purple-500/10">
                        <td className="py-2 pr-4 text-gray-300">{trade.symbol || 'BTC/USDT'}</td>
                        <td className={`py-2 pr-4 ${trade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{trade.direction || 'BUY'}</td>
                        <td className="py-2 pr-4 text-gray-300">{typeof trade.entryPrice === 'number' ? `$${trade.entryPrice.toFixed(2)}` : '-'}</td>
                        <td className="py-2 pr-4 text-gray-300">{typeof trade.stopLoss === 'number' ? `$${trade.stopLoss.toFixed(2)}` : '-'}</td>
                        <td className="py-2 pr-4 text-gray-300">{typeof trade.takeProfit === 'number' ? `$${trade.takeProfit.toFixed(2)}` : '-'}</td>
                        <td className={`py-2 pr-4 ${trade.result === 'WIN' ? 'text-green-400' : trade.result === 'LOSS' ? 'text-red-400' : 'text-gray-400'}`}>
                          {trade.result || (trade.status === 'OPEN' ? 'OPEN' : 'CLOSED')}
                        </td>
                        <td className="py-2 pr-4 text-gray-300">{trade.entryTime ? new Date(trade.entryTime).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Diagnostics / Skipped Trades */}
          <div className="bg-slate-800/40 border border-purple-500/20 rounded-xl p-5">
            <h2 className="text-lg font-semibold text-white mb-4">Diagnostics / Skipped Trades</h2>

            {skippedTrades.length === 0 ? (
              <div className="text-sm text-gray-400">No skipped trades</div>
            ) : (
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
                    {skippedTrades.map((skipped, index) => (
                      <tr key={index} className="border-b border-purple-500/10">
                        <td className="py-2 pr-4 text-white font-medium">
                          {skipped.tradingPair || skipped.pair || 'BTC/USDT'}
                        </td>
                        <td className={`py-2 pr-4 font-medium ${
                          skipped.signal?.direction === 'LONG' || skipped.direction === 'LONG'
                            ? 'text-green-400'
                            : 'text-red-400'
                        }`}>
                          {skipped.signal?.direction || skipped.direction || 'LONG'}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-1 rounded text-xs ${
                            skipped.decision?.reason?.includes('SR') ? 'bg-purple-500/20 text-purple-400' :
                            skipped.decision?.reason?.includes('RR') ? 'bg-orange-500/20 text-orange-400' :
                            skipped.decision?.reason?.includes('session') ? 'bg-blue-500/20 text-blue-400' :
                            skipped.decision?.reason?.includes('candle') ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {skipped.decision?.reason || skipped.reason || 'NO_SIGNAL'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-gray-300">
                          {skipped.timestamp ? new Date(skipped.timestamp).toLocaleString() : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}