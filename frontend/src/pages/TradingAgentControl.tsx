import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi, settingsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import { agentKeyToSlug } from '../utils/agentKeyToSlug';

export default function TradingAgentControl() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isLiquiditySweepAgent = (location.pathname || '').includes('liquidity_sniper_arbitrage');
  const approvalKey = isLiquiditySweepAgent ? 'LIQUIDITY_SWEEP_AGENT' : 'TRADING_AGENT';
  const slug = agentKeyToSlug(approvalKey);
  const pageTitle = isLiquiditySweepAgent ? 'Liquidity Sweep Agent' : 'Trading Agent';
  const pageSubtitle = isLiquiditySweepAgent
    ? 'Liquidity Sweep • Unified Execution'
    : 'BTC/USDT • ETH/USDT • RSI + Bollinger Bands Strategy';

  const [trades, setTrades] = useState<any[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agentAccessChecked, setAgentAccessChecked] = useState(false);
  const [hasAgentAccess, setHasAgentAccess] = useState(false);
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);
  const [realAgentDocId, setRealAgentDocId] = useState<string | null>(null);
  const [exchangeConfigLoaded, setExchangeConfigLoaded] = useState(false);

  const [exchangeConfig, setExchangeConfig] = useState<any | null>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [togglingAutoTrade, setTogglingAutoTrade] = useState(false);
  const [skippedTrades, setSkippedTrades] = useState<any[]>([]);
  const [agentConfig, setAgentConfig] = useState<any | null>(null);
  const [scheduler, setScheduler] = useState<any | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Check Firestore approval (users/{uid}.approvedAgents) and resolve agent ID
  useEffect(() => {
    const checkAgentAccess = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
        const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes(approvalKey);
        console.debug({ from: 'TradingAgentControl', agentKey: approvalKey, hasAccess });
        setHasAgentAccess(hasAccess);

        if (hasAccess) {
          setResolvedAgentId(slug);
        }

        setAgentAccessChecked(true);
      } catch (error) {
        console.error('Error checking agent access:', error);
        setHasAgentAccess(false);
        setAgentAccessChecked(true);
      }
    };

    checkAgentAccess();
  }, [user, approvalKey, slug]);

  // Load exchange config independently of agent status
  useEffect(() => {
    if (!user) return;

    const loadExchangeConfig = async () => {
      try {
        const exchangeResp = await settingsApi.loadExchangeConfig(user.uid);
        console.log(`[${slug}] Exchange config loaded:`, exchangeResp.data);
        setExchangeConfig(exchangeResp.data || {});
      } catch (err) {
        console.warn(`[${slug}] Failed to load exchange config:`, err);
        setExchangeConfig({});
      } finally {
        setExchangeConfigLoaded(true);
      }
    };

    loadExchangeConfig();
  }, [user]);

  // Load data when ALL prerequisites are met
  const pageReady = hasAgentAccess && agentAccessChecked && exchangeConfigLoaded && resolvedAgentId;

  useEffect(() => {
    if (!user || !pageReady) {
      return;
    }

    loadData();
  }, [user, pageReady]);

  const loadData = async () => {
    if (!user || !resolvedAgentId) {
      console.warn('loadData: Skipping API calls - prerequisites not met');
      return;
    }
    setLoadingData(true);
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
      setScheduler(diagnosticsResp.data?.scheduler || null);

    } catch (err: any) {
      console.error('Error loading data:', err);
      showToast('Failed to load data', 'error');
    } finally {
      setLoadingData(false);
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
    // Validate prerequisites before API call
    if (!hasAgentAccess) {
      showToast('Agent not approved. Please request approval from admin first.', 'error');
      return;
    }
    
    if (!resolvedAgentId) {
      showToast('Agent not configured. Please contact admin.', 'error');
      return;
    }
    
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
        showToast('Auto trading started', 'success');
        await loadData();
      } else {
        await agentsApi.stopTradingAgent(slug);
        showToast('Auto trading stopped', 'success');
        await loadData();
      }
    } catch (err: any) {
      const errorCode = err.response?.data?.code;
      const errorMessage = err.response?.data?.error;
      
      if (errorCode === 'AGENT_NOT_APPROVED') {
        showToast('Please request agent approval from admin first.', 'error');
      } else if (errorCode === 'AGENT_DOCUMENT_MISSING') {
        showToast('Agent configuration missing. Please contact admin.', 'error');
      } else if (errorCode === 'EXCHANGE_NOT_CONNECTED') {
        showToast('Please connect your exchange in Settings first.', 'error');
      } else {
        showToast(errorMessage || 'Failed to update auto trade', 'error');
      }
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
          <div className="text-gray-400">You don't have access to {pageTitle}</div>
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
              <h1 className="text-2xl font-semibold text-white">{pageTitle}</h1>
              <div className="text-sm text-gray-400">
                {pageSubtitle}
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
                  disabled={
                    togglingAutoTrade || 
                    !resolvedAgentId || 
                    !hasAgentAccess ||
                    !isExchangeConnected(exchangeConfig).connected
                  }
                  onClick={() => handleToggleAutoTrade(!autoTradeEnabled)}
                  title={
                    !hasAgentAccess ? 'Request approval from admin first' :
                    !resolvedAgentId ? 'Agent not configured' :
                    !isExchangeConnected(exchangeConfig).connected ? 'Connect exchange in Settings first' :
                    autoTradeEnabled ? 'Stop trading' : 'Start trading'
                  }
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
                disabled={loadingData}
              >
                {loadingData ? 'Loading...' : 'Refresh'}
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
            <h2 className="text-lg font-semibold text-white mb-4">Diagnostics</h2>

            {/* Scheduler Status */}
            <div className="mb-4 p-3 bg-slate-900/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">Scheduler</div>
                <div className={`text-sm font-medium ${scheduler?.isRunning ? 'text-green-400' : 'text-red-400'}`}>
                  {scheduler?.isRunning ? 'RUNNING' : 'NOT RUNNING'}
                </div>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Last scan: {scheduler?.lastExecutionAt ? new Date(scheduler.lastExecutionAt).toLocaleString() : '—'}
              </div>
              <div className="text-xs text-gray-500">
                Next scan: {scheduler?.nextExecutionAt ? new Date(scheduler.nextExecutionAt).toLocaleString() : '—'}
              </div>
              {scheduler?.lastExecutionError && (
                <div className="mt-1 text-xs text-red-400">Last error: {scheduler.lastExecutionError}</div>
              )}
            </div>

            <h3 className="text-md font-medium text-white mb-3">Recent Cycle Results</h3>

            {skippedTrades.length === 0 ? (
              <div className="text-sm text-gray-400">No diagnostics yet</div>
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