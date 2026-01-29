import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi, settingsApi, researchApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase-config';
import { agentKeyToSlug } from '../utils/agentKeyToSlug';
import { InformationCircleIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/24/outline';
import ExchangeHealthCheck from '../components/ExchangeHealthCheck';
import ManualTradeTrigger from '../components/ManualTradeTrigger';

export default function TradingAgentControl() {
  const { user, authReady } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isLiquiditySweepAgent = (location.pathname || '').includes('liquidity_sniper_arbitrage');
  const isHTFTrendFilterAgent = (location.pathname || '').includes('htf-trend-filter-agent');
  const approvalKey = isLiquiditySweepAgent ? 'LIQUIDITY_SWEEP_AGENT' : 
                      isHTFTrendFilterAgent ? 'HTF_TREND_FILTER_AGENT' : 
                      'TRADING_AGENT';
  const slug = agentKeyToSlug(approvalKey);
  const pageTitle = isLiquiditySweepAgent ? 'Liquidity Sweep Agent' : 
                    isHTFTrendFilterAgent ? 'HTF Trend Filter Scalping Agent' :
                    'Trading Agent';
  const pageSubtitle = isLiquiditySweepAgent
    ? 'Liquidity Sweep • Unified Execution'
    : isHTFTrendFilterAgent
    ? 'BTC/USDT • ETH/USDT • HTF Trend Filter + EMA Pullback + RSI + Bollinger Bands'
    : 'BTC/USDT • ETH/USDT • Automated Trading Strategy';

  const [trades, setTrades] = useState<any[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [agentAccessChecked, setAgentAccessChecked] = useState(false);
  const [hasAgentAccess, setHasAgentAccess] = useState(false);
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);
  const [exchangeConfigLoaded, setExchangeConfigLoaded] = useState(false);

  const [exchangeConfig, setExchangeConfig] = useState<any | null>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [togglingAutoTrade, setTogglingAutoTrade] = useState(false);
  const [skippedTrades, setSkippedTrades] = useState<any[]>([]);
  const [diagnosticsEntries, setDiagnosticsEntries] = useState<any[]>([]); // HTF diagnostics
  const [agentConfig, setAgentConfig] = useState<any | null>(null);
  const [scheduler, setScheduler] = useState<any | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [showExecutionCriteria, setShowExecutionCriteria] = useState(false);
  const [, setTimerTick] = useState(0); // Force re-render for countdown
  const [selectedDiagnosticDetails, setSelectedDiagnosticDetails] = useState<any>(null);
  const [showMoreDiagnostics, setShowMoreDiagnostics] = useState(false);

  // Check Firestore approval (users/{uid}.approvedAgents) and resolve agent ID
  useEffect(() => {
    const checkAgentAccess = async () => {
      if (!user) return;

      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const approvedAgents: string[] = (userDoc.data() as any)?.approvedAgents || [];
        const hasAccess = Array.isArray(approvedAgents) && approvedAgents.includes(approvalKey);
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

  // CRITICAL STATE RESET: Clear diagnostics when agentId changes
  // This prevents stale data from previous agent being shown
  useEffect(() => {
    console.log('[HTF_DIAGNOSTICS] Agent changed, resetting diagnostics state');
    setDiagnosticsEntries([]);
    setSkippedTrades([]);
  }, [slug, resolvedAgentId]);

  useEffect(() => {
    if (!user || !pageReady) {
      return;
    }

    loadData();

    // Auto-refresh other data every 5 minutes when agent is running
    let intervalId: number | null = null;
    if (autoTradeEnabled) {
      intervalId = setInterval(() => {
        loadData();
      }, 300000); // 5 minutes
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [user, pageReady, autoTradeEnabled]);

  // Update countdown display every second (based on backend timestamps)
  useEffect(() => {
    if (!scheduler?.nextExecutionAt || !autoTradeEnabled) {
      return;
    }

    const timerId = setInterval(() => {
      setTimerTick(prev => prev + 1); // Force re-render
    }, 1000);

    return () => clearInterval(timerId);
  }, [scheduler?.nextExecutionAt, autoTradeEnabled]);

  const loadData = async () => {
    if (!user || !resolvedAgentId) {
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

      // CRITICAL: HTF agents use diagnostics, not research_history
      if (isHTFTrendFilterAgent) {
        // Load diagnostics for HTF agent (request 50 to support View More)
        const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 50);
        setScheduler(diagnosticsResp.data?.scheduler || null);
        
        // Extract diagnostics entries for Recent Cycle Results
        const entries = diagnosticsResp.data?.diagnostics || [];
        
        console.log('[HTF_DIAGNOSTICS] Received entries:', entries.length);
        console.log('[HTF_DIAGNOSTICS] Raw entries:', entries);
        
        // Sort by timestamp descending (latest first)
        entries.sort((a: any, b: any) => {
          const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return bTime - aTime;
        });
        
        // CRITICAL FIX: Robust deduplication that doesn't remove valid entries
        // Use cycleId if available, otherwise use Firestore document ID, otherwise use timestamp+index
        const seen = new Set<string>();
        const deduplicated = entries.filter((entry: any, index: number) => {
          // Try multiple fallback keys to ensure we don't filter out valid diagnostics
          const cycleId = entry.runtimeState?.cycleId || entry.cycleId;
          const docId = entry.id;
          const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
          
          // Build dedup key: prefer cycleId, fallback to docId, fallback to timestamp+index
          let dedupKey = '';
          if (cycleId) {
            dedupKey = `cycle_${cycleId}`;
          } else if (docId) {
            dedupKey = `doc_${docId}`;
          } else {
            dedupKey = `ts_${timestamp}_${index}`;
          }
          
          if (seen.has(dedupKey)) {
            return false;
          }
          
          seen.add(dedupKey);
          return true;
        });
        
        console.log('[HTF_DIAGNOSTICS] After deduplication:', deduplicated.length);
        
        // FORCE STATE UPDATE: Always set diagnostics, never skip this step
        setDiagnosticsEntries(deduplicated);
      } else {
        // Load research history for AUTO_TRADE cycles ONLY (non-HTF agents)
        const researchResp = await researchApi.deepResearch.getHistory(50);
        if (researchResp.data?.success) {
          const researchHistory = researchResp.data.data || [];
          // SAFE filtering: ONLY by AUTO_TRADE source (no agentId filtering)
          const autoTradeCycles = researchHistory.filter((entry: any) => 
            entry.source === "AUTO_TRADE"
          );
          // Sort by timestamp descending (latest first)
          autoTradeCycles.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          setSkippedTrades(autoTradeCycles);
        }

        // Load scheduler info
        const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 20);
        setScheduler(diagnosticsResp.data?.scheduler || null);
      }

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

  // Calculate time remaining until next scheduler execution
  const getNextExecutionTime = () => {
    if (!scheduler?.nextExecutionAt) {
      return null;
    }
    
    const now = new Date().getTime();
    const nextExecution = new Date(scheduler.nextExecutionAt).getTime();
    const remainingMs = Math.max(0, nextExecution - now);
    const remainingSeconds = Math.floor(remainingMs / 1000);
    
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const isExchangeConnected = (cfg: any): { connected: boolean; exchange?: string } => {
    // CRITICAL: Check disconnected flag first - this is the single source of truth
    // If disconnected === true, exchange MUST be treated as disconnected
    const connected = Boolean(cfg && cfg.exchange && cfg.disconnected !== true);
    const exchange = cfg?.exchange || undefined;
    return { connected, exchange };
  };

  const handleToggleAutoTrade = async () => {
    if (!hasAgentAccess) {
      showToast('Agent not approved. Please request approval from admin first.', 'error');
      return;
    }
    
    if (!resolvedAgentId) {
      showToast('Agent not configured. Please contact admin.', 'error');
      return;
    }

    setTogglingAutoTrade(true);
    try {
      // Use current UI state to decide action - no status fetch
      if (autoTradeEnabled) {
        await agentsApi.stopTradingAgent(slug);
        showToast('Auto trading stopped', 'success');
      } else {
        await agentsApi.startTradingAgent(slug);
        showToast('Auto trading started', 'success');
      }
      
      // CRITICAL: Refetch status from backend after API call
      const updatedStatusRes = await agentsApi.getTradingAgentControl(slug);
      setAutoTradeEnabled(updatedStatusRes.data?.status === 'ACTIVE');
      setAgentConfig(updatedStatusRes.data?.config || null);
      
      // Refresh trades immediately
      const tradesResp = await agentsApi.getTradingAgentTrades(slug, 20);
      setTrades(tradesResp.data?.trades || []);
      
      // CRITICAL: HTF agents use diagnostics, not research_history
      if (isHTFTrendFilterAgent) {
        // Refresh diagnostics for HTF agent (request 50 to support View More)
        const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 50);
        setScheduler(diagnosticsResp.data?.scheduler || null);
        
        // Extract diagnostics entries for Recent Cycle Results
        const entries = diagnosticsResp.data?.diagnostics || [];
        
        console.log('[HTF_DIAGNOSTICS] Toggle - Received entries:', entries.length);
        console.log('[HTF_DIAGNOSTICS] Toggle - Raw entries:', entries);
        
        // Sort by timestamp descending (latest first)
        entries.sort((a: any, b: any) => {
          const aTime = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const bTime = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return bTime - aTime;
        });
        
        // CRITICAL FIX: Robust deduplication that doesn't remove valid entries
        // Use cycleId if available, otherwise use Firestore document ID, otherwise use timestamp+index
        const seen = new Set<string>();
        const deduplicated = entries.filter((entry: any, index: number) => {
          // Try multiple fallback keys to ensure we don't filter out valid diagnostics
          const cycleId = entry.runtimeState?.cycleId || entry.cycleId;
          const docId = entry.id;
          const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
          
          // Build dedup key: prefer cycleId, fallback to docId, fallback to timestamp+index
          let dedupKey = '';
          if (cycleId) {
            dedupKey = `cycle_${cycleId}`;
          } else if (docId) {
            dedupKey = `doc_${docId}`;
          } else {
            dedupKey = `ts_${timestamp}_${index}`;
          }
          
          if (seen.has(dedupKey)) {
            return false;
          }
          
          seen.add(dedupKey);
          return true;
        });
        
        console.log('[HTF_DIAGNOSTICS] Toggle - After deduplication:', deduplicated.length);
        
        // FORCE STATE UPDATE: Always set diagnostics, never skip this step
        setDiagnosticsEntries(deduplicated);
        
        // FORCE STATE UPDATE: Always set diagnostics, never skip this step
        setDiagnosticsEntries(deduplicated);
      } else {
        // Refresh research history for AUTO_TRADE cycles ONLY (non-HTF agents)
        const researchResp = await researchApi.deepResearch.getHistory(50);
        if (researchResp.data?.success) {
          const researchHistory = researchResp.data.data || [];
          // SAFE filtering: ONLY by AUTO_TRADE source (no agentId filtering)
          const autoTradeCycles = researchHistory.filter((entry: any) => 
            entry.source === "AUTO_TRADE"
          );
          // Sort by timestamp descending (latest first)
          autoTradeCycles.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          setSkippedTrades(autoTradeCycles);
        }
        
        // Refresh scheduler info
        const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 20);
        setScheduler(diagnosticsResp.data?.scheduler || null);
      }
    } catch (err: any) {
      console.error('[TradingAgentControl] API error:', err);
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
      {/* Normal document flow - let page scroll naturally */}
      <div className="bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-2">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">{pageTitle}</h1>
              <div className="text-sm text-gray-400 leading-relaxed">
                {pageSubtitle}
              </div>
            </div>
            <button onClick={() => navigate('/agents')} className="btn btn-secondary px-6 py-2.5 self-start sm:self-auto">Back</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-xl p-6 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Exchange Connection</div>
                  {(() => {
                    const s = isExchangeConnected(exchangeConfig);
                    return (
                      <div className={`text-lg font-semibold ${s.connected ? 'text-green-400' : 'text-gray-300'}`}>
                        {s.connected ? `Connected${s.exchange ? ` • ${s.exchange}` : ''}` : 'Not Connected'}
                      </div>
                    );
                  })()}
                </div>
                <button
                  className="btn btn-secondary ml-4"
                  onClick={() => navigate('/settings#exchange-connection')}
                >
                  Manage
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">Uses Settings → Exchange. You can’t connect a second exchange here.</div>
            </div>

            <div className="bg-slate-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-xl p-6 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-400 mb-2">Auto Trade</div>
                  <div className={`text-lg font-semibold ${autoTradeEnabled ? 'text-green-400' : 'text-gray-300'}`}>
                    {resolvedAgentId ? (autoTradeEnabled ? 'Running' : 'Stopped') : 'Agent Not Ready'}
                  </div>
                  {agentConfig?.dryRun && (
                    <div className="text-yellow-400 text-xs mt-2 font-medium">
                      DRY RUN MODE - No real trades
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-primary ml-4"
                  disabled={togglingAutoTrade || !resolvedAgentId || !hasAgentAccess}
                  onClick={handleToggleAutoTrade}
                  title={
                    !hasAgentAccess ? 'Request approval from admin first' :
                    !resolvedAgentId ? 'Agent not configured' :
                    autoTradeEnabled ? 'Stop trading' : 'Start trading'
                  }
                >
                  {togglingAutoTrade ? 'Updating…' : autoTradeEnabled ? 'Stop Trading' : 'Start Trading'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-xl p-6 transition-colors">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Trades History</h2>
              <button
                className="btn btn-secondary px-5 py-2"
                onClick={() => loadData()}
                disabled={loadingData}
              >
                {loadingData ? 'Loading...' : 'Refresh'}
              </button>
            </div>

            {trades.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-400 text-base">No trades yet</div>
                <div className="text-gray-500 text-sm mt-2">Trades will appear here once the agent executes</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 border-b border-purple-500/20">
                      <th className="text-left py-3 pr-6 font-semibold">Pair</th>
                      <th className="text-left py-3 pr-6 font-semibold">Side</th>
                      <th className="text-left py-3 pr-6 font-semibold">Entry Price</th>
                      <th className="text-left py-3 pr-6 font-semibold">SL</th>
                      <th className="text-left py-3 pr-6 font-semibold">TP</th>
                      <th className="text-left py-3 pr-6 font-semibold">Result</th>
                      <th className="text-left py-3 pr-6 font-semibold">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((trade) => (
                      <tr key={trade.id} className="border-b border-purple-500/10 hover:bg-slate-700/30 transition-colors">
                        <td className="py-3 pr-6 text-gray-300">{trade.symbol || 'BTC/USDT'}</td>
                        <td className={`py-3 pr-6 font-medium ${trade.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>{trade.direction || 'BUY'}</td>
                        <td className="py-3 pr-6 text-gray-300">{typeof trade.entryPrice === 'number' ? `$${trade.entryPrice.toFixed(2)}` : '-'}</td>
                        <td className="py-3 pr-6 text-gray-300">{typeof trade.stopLoss === 'number' ? `$${trade.stopLoss.toFixed(2)}` : '-'}</td>
                        <td className="py-3 pr-6 text-gray-300">{typeof trade.takeProfit === 'number' ? `$${trade.takeProfit.toFixed(2)}` : '-'}</td>
                        <td className={`py-3 pr-6 font-medium ${trade.result === 'WIN' ? 'text-green-400' : trade.result === 'LOSS' ? 'text-red-400' : 'text-gray-400'}`}>
                          <div className="flex items-center gap-2">
                            {/* Show info icon for failed trades with exchange error */}
                            {(trade.status === 'FAILED' || trade.error || trade.exchangeErrorReason) && (
                              <div className="relative group">
                                <InformationCircleIcon className="w-5 h-5 text-red-400 cursor-help" />
                                <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-3 bg-slate-900 border border-red-500/30 rounded-lg shadow-xl">
                                  <div className="text-xs font-semibold text-red-400 mb-1">Exchange Rejection Reason:</div>
                                  <div className="text-xs text-gray-300 leading-relaxed">
                                    {trade.exchangeErrorReason || trade.error || 'Exchange rejected the order (no details provided)'}
                                  </div>
                                </div>
                              </div>
                            )}
                            <span>{trade.result || (trade.status === 'OPEN' ? 'OPEN' : trade.status === 'FAILED' ? 'FAILED' : 'CLOSED')}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-6 text-gray-300">{trade.entryTime ? new Date(trade.entryTime).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Diagnostics / Skipped Trades */}
          <div className="bg-slate-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-xl p-6 transition-colors">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold text-white">Diagnostics</h2>
              <button
                onClick={() => setShowExecutionCriteria(!showExecutionCriteria)}
                className="text-purple-400 hover:text-purple-300 transition-colors"
                title="View execution criteria checklist"
              >
                <InformationCircleIcon className="w-6 h-6" />
              </button>
            </div>

            {/* Execution Criteria Checklist */}
            {showExecutionCriteria && (
              <div className="mb-6 p-5 bg-slate-900/50 rounded-lg border border-purple-500/20">
                <h3 className="text-base font-bold text-white mb-4">Execution Criteria Checklist</h3>
                <div className="space-y-3">
                  {/* Exchange API Connected */}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm text-gray-300">Exchange API Connected</span>
                    {(() => {
                      const s = isExchangeConnected(exchangeConfig);
                      return s.connected ? (
                        <div className="flex items-center gap-2 text-green-400">
                          <CheckCircleIcon className="w-5 h-5" />
                          <span className="text-xs font-semibold">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-yellow-400" title="Exchange not connected">
                          <ClockIcon className="w-5 h-5" />
                          <span className="text-xs font-semibold">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* API Key Present */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">API Key Present</span>
                    {(() => {
                      const s = isExchangeConnected(exchangeConfig);
                      return s.connected ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="API key not configured">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Secret Present */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Secret Present</span>
                    {(() => {
                      const s = isExchangeConnected(exchangeConfig);
                      return s.connected ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Secret not configured">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Passphrase Present (conditional) */}
                  {exchangeConfig?.exchange && ['kucoin', 'okx', 'bitget'].includes(exchangeConfig.exchange.toLowerCase()) && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">Passphrase Present</span>
                      {(() => {
                        const s = isExchangeConnected(exchangeConfig);
                        return s.connected ? (
                          <div className="flex items-center gap-1 text-green-400">
                            <CheckCircleIcon className="w-4 h-4" />
                            <span className="text-xs font-medium">DONE</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-yellow-400" title="Passphrase not configured">
                            <ClockIcon className="w-4 h-4" />
                            <span className="text-xs font-medium">PENDING</span>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Exchange Supported */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Exchange Supported</span>
                    {(() => {
                      const s = isExchangeConnected(exchangeConfig);
                      return s.connected && s.exchange ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Exchange not configured or not supported">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Auto Trade Enabled */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Auto Trade Enabled</span>
                    {autoTradeEnabled ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Auto trade is disabled">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Agent Approved */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Agent Approved</span>
                    {hasAgentAccess ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Agent not approved for this user">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Agent Engine Running */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Agent Engine Running</span>
                    {scheduler?.isRunning ? (
                      <div className="flex items-center gap-1 text-green-400">
                        <CheckCircleIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">DONE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-yellow-400" title="Scheduler not running">
                        <ClockIcon className="w-4 h-4" />
                        <span className="text-xs font-medium">PENDING</span>
                      </div>
                    )}
                  </div>

                  {/* Session Time Valid */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Session Time Valid</span>
                    {(() => {
                      // Check if within trading sessions (London 8:00-16:59 UTC or NY 14:30-21:29 UTC)
                      const now = new Date();
                      const utcHour = now.getUTCHours();
                      const utcMinute = now.getUTCMinutes();
                      const isLondon = utcHour >= 8 && utcHour < 17;
                      const isNY = (utcHour === 14 && utcMinute >= 30) || (utcHour >= 15 && utcHour < 21) || (utcHour === 21 && utcMinute < 30);
                      const isValid = isLondon || isNY;
                      return isValid ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Outside trading session (London 8-17 UTC or NY 14:30-21:30 UTC)">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Strategy Conditions Met */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Strategy Conditions Met</span>
                    {(() => {
                      const hasNoSignal = skippedTrades.some(t => 
                        t.decision?.reason?.includes('NO_SIGNAL') || 
                        t.decision?.reason?.includes('Invalid indicators')
                      );
                      return !hasNoSignal ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="RSI + Bollinger Bands conditions not met">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* No SR Block */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">No SR Block</span>
                    {(() => {
                      const hasSRBlock = skippedTrades.some(t => 
                        t.decision?.reason?.includes('SR') || 
                        t.decision?.reason?.includes('support') ||
                        t.decision?.reason?.includes('resistance')
                      );
                      return !hasSRBlock ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Entry blocked by support/resistance level">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Entry Not Late */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Entry Not Late</span>
                    {(() => {
                      const hasEntryLate = skippedTrades.some(t => 
                        t.decision?.reason?.includes('late') || 
                        t.decision?.reason?.includes('already processed')
                      );
                      return !hasEntryLate ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Entry timing missed or candle already processed">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* RR Ratio Acceptable */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">RR Ratio Acceptable</span>
                    {(() => {
                      const hasRRTooLow = skippedTrades.some(t => 
                        t.decision?.reason?.includes('RR') || 
                        t.decision?.reason?.includes('risk')
                      );
                      return !hasRRTooLow ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Risk/reward ratio too low">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Risk Check Passed */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300">Risk Check Passed</span>
                    {(() => {
                      const hasRiskFailure = skippedTrades.some(t => 
                        t.decision?.reason?.includes('daily') || 
                        t.decision?.reason?.includes('limit') ||
                        t.decision?.reason?.includes('consecutive')
                      );
                      return !hasRiskFailure ? (
                        <div className="flex items-center gap-1 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">DONE</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-yellow-400" title="Daily limit or consecutive losses reached">
                          <ClockIcon className="w-4 h-4" />
                          <span className="text-xs font-medium">PENDING</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}

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
              {scheduler?.nextExecutionAt && autoTradeEnabled && (
                <div className="text-xs text-purple-400 mt-1">
                  Time remaining: {getNextExecutionTime() || '—'}
                </div>
              )}
              {scheduler?.lastExecutionError && (
                <div className="mt-1 text-xs text-red-400">Last error: {scheduler.lastExecutionError}</div>
              )}
            </div>

            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-white">Recent Cycle Results</h3>
              {isHTFTrendFilterAgent && diagnosticsEntries.length > 10 && (
                <button
                  onClick={() => setShowMoreDiagnostics(!showMoreDiagnostics)}
                  className="text-purple-400 hover:text-purple-300 transition-colors text-sm"
                >
                  {showMoreDiagnostics ? 'View Less' : `View More (${Math.min(diagnosticsEntries.length - 10, 40)} more)`}
                </button>
              )}
            </div>
            <div className="text-sm text-gray-400 mb-6 leading-relaxed">
              Shows execution/skip decisions from recent scheduler cycles (~5 min intervals)
              {isHTFTrendFilterAgent && !showMoreDiagnostics && diagnosticsEntries.length > 10 && (
                <span className="text-purple-400"> • Showing latest 10 cycles</span>
              )}
              {isHTFTrendFilterAgent && showMoreDiagnostics && (
                <span className="text-purple-400"> • Showing latest {Math.min(diagnosticsEntries.length, 50)} cycles</span>
              )}
            </div>

            {/* CRITICAL: HTF agents use diagnostics, non-HTF use research_history */}
            {isHTFTrendFilterAgent ? (
              // HTF Agent: Use diagnostics entries ONLY
              // Show table if ANY diagnostic exists (even SKIP entries)
              diagnosticsEntries.length > 0 ? (
                <div className="overflow-x-auto bg-slate-800/30 rounded-lg border border-purple-500/10">
                  <table className="min-w-full">
                    <thead>
                      <tr className="text-gray-300 border-b border-purple-500/20 bg-slate-800/50">
                        <th className="text-left py-3 px-4 font-semibold">Pair</th>
                        <th className="text-left py-3 px-4 font-semibold">Direction</th>
                        <th className="text-left py-3 px-4 font-semibold">Decision</th>
                        <th className="text-left py-3 px-4 font-semibold">Skip Reason</th>
                        <th className="text-left py-3 px-4 font-semibold">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!showMoreDiagnostics 
                        ? diagnosticsEntries.slice(0, 10) 
                        : diagnosticsEntries.slice(0, 50)
                      ).map((entry, index) => {
                        // Map diagnostics to table columns
                        const displayPair = entry.tradingPair || entry.symbol || '—';
                        const displayDirection = entry.direction || '—';
                        const displayDecision = entry.decision?.action || '—';
                        
                        // Check if full diagnostics data exists for info icon
                        const hasFullDiagnostics = !!(entry.runtimeState?.indicators?.results);
                        
                        // Build clean, SHORT skip reason (3-4 words max)
                        let shortSkipReason = '';
                        const runtimeState = entry.runtimeState;
                        
                        // Check if we have indicator results for breakdown
                        if (runtimeState?.indicators?.results) {
                          const results = runtimeState.indicators.results;
                          
                          // CRITICAL FIX: Show ONLY FIRST rejected indicator (3-4 words max)
                          if (results.ema?.status === 'rejected') {
                            shortSkipReason = 'EMA rejected';
                          } else if (results.rsi?.status === 'rejected') {
                            shortSkipReason = 'RSI rejected';
                          } else if (results.vwap?.status === 'rejected') {
                            shortSkipReason = 'VWAP rejected';
                          } else if (results.sr?.status === 'rejected') {
                            shortSkipReason = 'SR rejected';
                          } else if (results.volume?.status === 'rejected') {
                            shortSkipReason = 'Volume rejected';
                          } else {
                            // All confirmed - show success message
                            shortSkipReason = 'All conditions met';
                          }
                        } else {
                          // No indicator breakdown - use strict fallback chain (max 30 chars)
                          if (displayDecision === 'TRADE') {
                            shortSkipReason = 'All conditions met';
                          } else {
                            // Get raw reason and trim to max 30 chars
                            let rawReason = runtimeState?.skipDetails || 
                                          runtimeState?.skipReason || 
                                          entry.decision?.reason || 
                                          'Skipped';
                            
                            // Trim to max 30 chars
                            if (rawReason.length > 30) {
                              shortSkipReason = rawReason.substring(0, 27) + '...';
                            } else {
                              shortSkipReason = rawReason;
                            }
                          }
                        }
                        
                        const displayTimestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—';
                        
                        let reasonColor = 'bg-gray-500/20 text-gray-400';
                        if (displayDecision === 'TRADE') {
                          reasonColor = 'bg-green-500/20 text-green-400';
                        } else if (displayDecision === 'SKIP') {
                          reasonColor = 'bg-yellow-500/20 text-yellow-400';
                        }
                        
                        return (
                          <tr key={entry.id || index} className="border-b border-purple-500/10 hover:bg-slate-800/50 transition-colors">
                            <td className="py-3 px-4 text-white font-semibold">
                              {displayPair}
                            </td>
                            <td className="py-3 px-4 text-gray-400 font-bold text-base">
                              {displayDirection}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                {/* Info icon at the VERY START of Decision column */}
                                {hasFullDiagnostics && (
                                  <button
                                    onClick={() => setSelectedDiagnosticDetails(entry)}
                                    className="flex-shrink-0 text-purple-400 hover:text-purple-300 transition-colors"
                                    title="View full diagnostic breakdown"
                                  >
                                    <InformationCircleIcon className="w-5 h-5" />
                                  </button>
                                )}
                                <span className={`px-2 py-1 rounded text-xs font-medium ${reasonColor}`}>
                                  {displayDecision}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-gray-400 text-sm">
                              <span className="leading-tight">{shortSkipReason}</span>
                            </td>
                            <td className="py-3 px-4 text-gray-400 text-sm">
                              {displayTimestamp}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400 bg-slate-800/30 rounded-lg border border-purple-500/10">
                  {autoTradeEnabled 
                    ? 'Waiting for first cycle...'
                    : 'No cycle results yet'}
                </div>
              )
            ) : (
              // Non-HTF Agent: Use research_history (AUTO_TRADE cycles)
              skippedTrades.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-slate-800/30 rounded-lg border border-purple-500/10">
                  {autoTradeEnabled 
                    ? 'Waiting for first cycle...'
                    : 'No cycle results yet'}
                </div>
              ) : (
                <div className="overflow-x-auto bg-slate-800/30 rounded-lg border border-purple-500/10">
                  <table className="min-w-full">
                    <thead>
                      <tr className="text-gray-300 border-b border-purple-500/20 bg-slate-800/50">
                        <th className="text-left py-3 px-4 font-semibold">Pair</th>
                        <th className="text-left py-3 px-4 font-semibold">Direction</th>
                        <th className="text-left py-3 px-4 font-semibold">Decision</th>
                        <th className="text-left py-3 px-4 font-semibold">Execution Status</th>
                        <th className="text-left py-3 px-4 font-semibold">Skip Reason</th>
                        <th className="text-left py-3 px-4 font-semibold">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skippedTrades.map((entry, index) => {
                        // Use research_history schema directly - ONLY AUTO_TRADE entries
                        const displayPair = "AUTO_TRADE";
                        const displayDirection = "-";
                        const displayDecision = entry.decision ?? entry.status;
                        const displayExecutionStatus = entry.executionStatus ?? entry.status;
                        // Enhanced skip reason with safe fallback logic - prioritize skipDetails for human-readable text
                        const displaySkipReason = entry.skipDetails ?? entry.skipReason ?? entry.reason ?? "No reason provided";
                        const displayTimestamp = new Date(entry.timestamp).toLocaleString();
                        
                        let reasonColor = 'bg-gray-500/20 text-gray-400';
                        if (displayDecision && displayDecision.includes('FINAL')) {
                          reasonColor = 'bg-green-500/20 text-green-400';
                        } else if (displayDecision && displayDecision.includes('SKIPPED')) {
                          reasonColor = 'bg-yellow-500/20 text-yellow-400';
                        }

                        let executionColor = 'bg-gray-500/20 text-gray-400';
                        if (displayExecutionStatus === 'EXECUTED') {
                          executionColor = 'bg-green-500/20 text-green-400';
                        } else if (displayExecutionStatus === 'FAILED') {
                          executionColor = 'bg-red-500/20 text-red-400';
                        }
                        
                        return (
                          <tr key={entry.id || index} className="border-b border-purple-500/10 hover:bg-slate-800/50 transition-colors">
                            <td className="py-3 px-4 text-white font-semibold">
                              {displayPair}
                            </td>
                            <td className="py-3 px-4 text-gray-400 font-bold text-base">
                              {displayDirection}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${reasonColor}`}>
                                {displayDecision || "SKIPPED"}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${executionColor}`}>
                                {displayExecutionStatus || "SKIPPED"}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-400 text-sm">
                              {displaySkipReason}
                            </td>
                            <td className="py-3 px-4 text-gray-400 text-sm">
                              {displayTimestamp}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>

          {/* HTF Agent Features - Exchange Health Check & Manual Trade Trigger */}
          {isHTFTrendFilterAgent && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Feature 1: Exchange Execution Health Check */}
              <div className="bg-slate-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-xl p-6 transition-colors">
                <h3 className="text-xl font-bold text-white mb-4">Exchange Health Check</h3>
                <div className="text-sm text-gray-400 mb-4">
                  Test exchange order execution endpoint without placing real trades
                </div>
                
                <ExchangeHealthCheck agentId={slug} />
              </div>

              {/* Feature 2: Manual Trade Trigger */}
              <div className="bg-slate-800/50 border border-purple-500/20 hover:border-purple-500/30 rounded-xl p-6 transition-colors">
                <h3 className="text-xl font-bold text-white mb-4">Manual Test Trade</h3>
                <div className="text-sm text-gray-400 mb-4">
                  Execute a test trade using the same execution path as the agent
                </div>
                
                <ManualTradeTrigger agentId={slug} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic Details Modal - Full Indicator Breakdown */}
      {selectedDiagnosticDetails && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-slate-900 border border-purple-500/20 rounded-xl p-6 max-w-2xl mx-4 max-h-[80vh] overflow-y-auto w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">
                Full Diagnostic Breakdown
              </h3>
              <button
                onClick={() => setSelectedDiagnosticDetails(null)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Trading Pair */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Trading Pair</span>
                <span className="font-bold text-white">
                  {selectedDiagnosticDetails.tradingPair || selectedDiagnosticDetails.symbol || '—'}
                </span>
              </div>
              
              {/* Direction */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Direction</span>
                <span className={`font-bold ${
                  selectedDiagnosticDetails.direction === 'LONG' ? 'text-green-400' : 
                  selectedDiagnosticDetails.direction === 'SHORT' ? 'text-red-400' : 
                  'text-gray-300'
                }`}>{selectedDiagnosticDetails.direction || '—'}</span>
              </div>
              
              {/* Final Decision */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Final Decision</span>
                <span className={`px-3 py-1 rounded text-sm font-bold ${
                  selectedDiagnosticDetails.decision?.action === 'TRADE' 
                    ? 'bg-green-500/20 text-green-400' 
                    : 'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {selectedDiagnosticDetails.decision?.action || 'SKIP'}
                </span>
              </div>
              
              {/* Indicator Breakdown - ONLY if indicators.results exists */}
              {selectedDiagnosticDetails.runtimeState?.indicators?.results && (
                <>
                  <div className="border-t border-purple-500/20 pt-4 mt-4">
                    <div className="text-sm font-semibold text-purple-400 mb-3">Indicator Analysis</div>
                    <div className="space-y-3">
                      {/* EMA */}
                      {selectedDiagnosticDetails.runtimeState.indicators.results.ema && (
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-gray-300">EMA (Exponential Moving Average)</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {selectedDiagnosticDetails.runtimeState.indicators.results.ema.reason || 'Trend alignment check'}
                            </div>
                          </div>
                          <span className={`flex items-center gap-1.5 text-sm font-bold ml-4 ${
                            selectedDiagnosticDetails.runtimeState.indicators.results.ema.status === 'confirmed' 
                              ? 'text-green-400' 
                              : 'text-red-400'
                          }`}>
                            {selectedDiagnosticDetails.runtimeState.indicators.results.ema.status === 'confirmed' ? (
                              <>
                                <CheckCircleIcon className="w-5 h-5" />
                                <span>Confirmed</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span>Rejected</span>
                              </>
                            )}
                          </span>
                        </div>
                      )}
                      
                      {/* RSI */}
                      {selectedDiagnosticDetails.runtimeState.indicators.results.rsi && (
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-gray-300">RSI (Relative Strength Index)</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {selectedDiagnosticDetails.runtimeState.indicators.results.rsi.reason || 'Momentum check'}
                            </div>
                          </div>
                          <span className={`flex items-center gap-1.5 text-sm font-bold ml-4 ${
                            selectedDiagnosticDetails.runtimeState.indicators.results.rsi.status === 'confirmed' 
                              ? 'text-green-400' 
                              : 'text-red-400'
                          }`}>
                            {selectedDiagnosticDetails.runtimeState.indicators.results.rsi.status === 'confirmed' ? (
                              <>
                                <CheckCircleIcon className="w-5 h-5" />
                                <span>Confirmed</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span>Rejected</span>
                              </>
                            )}
                          </span>
                        </div>
                      )}
                      
                      {/* VWAP */}
                      {selectedDiagnosticDetails.runtimeState.indicators.results.vwap && (
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-gray-300">VWAP (Volume Weighted Average Price)</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {selectedDiagnosticDetails.runtimeState.indicators.results.vwap.reason || 'Price position check'}
                            </div>
                          </div>
                          <span className={`flex items-center gap-1.5 text-sm font-bold ml-4 ${
                            selectedDiagnosticDetails.runtimeState.indicators.results.vwap.status === 'confirmed' 
                              ? 'text-green-400' 
                              : 'text-red-400'
                          }`}>
                            {selectedDiagnosticDetails.runtimeState.indicators.results.vwap.status === 'confirmed' ? (
                              <>
                                <CheckCircleIcon className="w-5 h-5" />
                                <span>Confirmed</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span>Rejected</span>
                              </>
                            )}
                          </span>
                        </div>
                      )}
                      
                      {/* Volume */}
                      {selectedDiagnosticDetails.runtimeState.indicators.results.volume && (
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-gray-300">Volume</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {selectedDiagnosticDetails.runtimeState.indicators.results.volume.reason || 'Volume confirmation check'}
                            </div>
                          </div>
                          <span className={`flex items-center gap-1.5 text-sm font-bold ml-4 ${
                            selectedDiagnosticDetails.runtimeState.indicators.results.volume.status === 'confirmed' 
                              ? 'text-green-400' 
                              : 'text-red-400'
                          }`}>
                            {selectedDiagnosticDetails.runtimeState.indicators.results.volume.status === 'confirmed' ? (
                              <>
                                <CheckCircleIcon className="w-5 h-5" />
                                <span>Confirmed</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span>Rejected</span>
                              </>
                            )}
                          </span>
                        </div>
                      )}
                      
                      {/* Support/Resistance */}
                      {selectedDiagnosticDetails.runtimeState.indicators.results.sr && (
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="font-medium text-gray-300">Support/Resistance</div>
                            <div className="text-xs text-gray-500 mt-1">
                              {selectedDiagnosticDetails.runtimeState.indicators.results.sr.reason || 'Key level check'}
                            </div>
                          </div>
                          <span className={`flex items-center gap-1.5 text-sm font-bold ml-4 ${
                            selectedDiagnosticDetails.runtimeState.indicators.results.sr.status === 'confirmed' 
                              ? 'text-green-400' 
                              : 'text-red-400'
                          }`}>
                            {selectedDiagnosticDetails.runtimeState.indicators.results.sr.status === 'confirmed' ? (
                              <>
                                <CheckCircleIcon className="w-5 h-5" />
                                <span>Confirmed</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                <span>Rejected</span>
                              </>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
              
              {/* Skip Reason - Show if no indicators or as summary */}
              <div className="border-t border-purple-500/20 pt-4 mt-4">
                <div className="flex justify-between items-start">
                  <span className="text-gray-400 font-medium">Skip Reason</span>
                  <span className="text-gray-300 text-right max-w-md leading-relaxed">
                    {selectedDiagnosticDetails.runtimeState?.skipDetails || 
                     selectedDiagnosticDetails.runtimeState?.skipReason || 
                     selectedDiagnosticDetails.decision?.reason || 
                     'No reason provided'}
                  </span>
                </div>
              </div>
              
              {/* Timestamp */}
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Timestamp</span>
                <span className="text-gray-400">
                  {selectedDiagnosticDetails.timestamp 
                    ? new Date(selectedDiagnosticDetails.timestamp).toLocaleString() 
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <Toast message={toast.message} type={toast.type} />
      )}
    </ErrorBoundary>
  );
}