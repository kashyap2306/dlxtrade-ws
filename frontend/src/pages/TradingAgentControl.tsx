import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { agentsApi, settingsApi } from '../services/api';
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

  // HTF Diagnostics Aggregation Logic - STRICT 5-minute cycle enforcement
  const aggregateHTFDiagnostics = (diagnostics: any[]) => {
    if (!isHTFTrendFilterAgent || !diagnostics.length) {
      return diagnostics;
    }

    // Group diagnostics by STRICT 5-minute research cycle
    const cycleGroups = new Map<string, any[]>();
    
    diagnostics.forEach((diagnostic) => {
      // Skip system-level diagnostics completely
      if (diagnostic.symbol === 'AUTO_TRADE_CYCLE' || 
          diagnostic.agentId === 'AUTO_TRADE_AGENT' ||
          diagnostic.pair === 'AUTO_TRADE_CYCLE' ||
          diagnostic.tradingPair === 'AUTO_TRADE_CYCLE') {
        return;
      }

      // STRICT 5-minute cycle definition
      const timestamp = new Date(diagnostic.timestamp || Date.now()).getTime();
      const cycleBucket = Math.floor(timestamp / (5 * 60 * 1000)); // 5-minute buckets
      
      // Extract pair/symbol for grouping
      const pair = diagnostic.pair || diagnostic.tradingPair || diagnostic.symbol || 'UNKNOWN';
      const agentId = diagnostic.agentId || 'HTF_TREND_FILTER_AGENT';
      
      // Create stable cycle key
      const cycleKey = `${cycleBucket}-${pair}-${agentId}`;

      if (!cycleGroups.has(cycleKey)) {
        cycleGroups.set(cycleKey, []);
      }
      cycleGroups.get(cycleKey)!.push(diagnostic);
    });

    // Process each cycle group - EXACTLY ONE ROW per cycle
    const aggregatedDiagnostics: any[] = [];
    
    cycleGroups.forEach((group, cycleKey) => {
      // STRICT primary selection priority - real SKIP reasons override EXECUTION_STARTED
      // PART B FIX: EXECUTION_STARTED with action="INFO" should be treated as execution, not skip
      const hasUsableExchange = group.some((d) =>
        d?.exchangeUsable === true ||
        d?.exchangeStatus === 'USABLE' ||
        d?.decision?.reason === 'EXCHANGE_USABLE'
      );

      const isStaleExchangeError = (d: any) =>
        hasUsableExchange &&
        (d?.decision?.reason === 'EXCHANGE_CORRUPTED' ||
          d?.decision?.reason === 'EXCHANGE_KEYS_NOT_DECRYPTED' ||
          d?.decision?.reason === 'CREDENTIALS_DECRYPT_FAILED');

      let primary = group.find(d => d.execution?.status === 'EXECUTED') ||
                   group.find(d => d.decision?.action === 'INFO' && d.decision?.reason === 'EXECUTION_STARTED') ||
                   group.find(d => d.status === 'SKIPPED' && d.decision?.reason && 
                     !['EXECUTION_STARTED', 'FORCE_CREATE_DIAGNOSTIC', 'CREDENTIALS_DECRYPT_FAILED'].includes(d.decision.reason)) ||
                   group.find(d => d.decision?.action === 'SKIP' && d.decision?.reason && 
                     !['EXECUTION_STARTED', 'FORCE_CREATE_DIAGNOSTIC'].includes(d.decision.reason)) ||
                   group[group.length - 1]; // Latest as fallback

      if (primary && isStaleExchangeError(primary)) {
        primary = group.find(d => !isStaleExchangeError(d)) || primary;
      }

      // ALL other diagnostics become details (including system entries)
      const details = group.filter(d => d !== primary);

      // STRICT pair extraction - NEVER allow "--"
      let normalizedPair = null;
      let normalizedDirection = null;

      // Search ALL diagnostics in cycle for valid pair/direction - prioritize non-EXECUTION_STARTED
      for (const d of group.filter(d => d.decision?.reason !== 'EXECUTION_STARTED')) {
        if (!normalizedPair) {
          normalizedPair = d.pair || d.tradingPair || (d.symbol && d.symbol !== 'AUTO_TRADE_CYCLE' ? d.symbol : null);
        }
        if (!normalizedDirection) {
          normalizedDirection = d.direction || d.signal?.direction || (typeof d.signal === 'string' ? d.signal : null);
        }
        if (normalizedPair && normalizedDirection) break;
      }

      // If no direction found from real diagnostics, check EXECUTION_STARTED
      if (!normalizedDirection) {
        for (const d of group.filter(d => d.decision?.reason === 'EXECUTION_STARTED')) {
          if (d.direction && d.direction !== 'NO_TRADE') {
            normalizedDirection = d.direction;
            break;
          }
        }
      }

      // Ensure proper symbol format
      if (!normalizedPair) {
        for (const d of group) {
          if (d.symbol && /^[A-Z0-9]+USDT$/.test(d.symbol) && d.symbol !== 'AUTO_TRADE_CYCLE') {
            normalizedPair = d.symbol;
            break;
          }
        }
      }

      // Map BUY/SELL to LONG/SHORT
      if (normalizedDirection === 'BUY') {
        normalizedDirection = 'LONG';
      } else if (normalizedDirection === 'SELL') {
        normalizedDirection = 'SHORT';
      }

      // FORCE direction for HTF - NEVER "--"
      if (!normalizedDirection || normalizedDirection === '--') {
        // Check if any diagnostic has signal
        const hasSignal = group.some(d => d.signal?.direction || (d.direction && d.direction !== '--'));
        if (hasSignal) {
          normalizedDirection = group.find(d => d.signal?.direction)?.signal?.direction || 
                               group.find(d => d.direction && d.direction !== '--')?.direction || 'NO_TRADE';
        } else {
          normalizedDirection = 'NO_TRADE';
        }
      }

      // FORCE pair for HTF - NEVER "--"
      if (!normalizedPair || normalizedPair === '--') {
        normalizedPair = 'BTCUSDT'; // Default for HTF agent
      }

      // Create aggregated diagnostic entry
      const aggregated = {
        ...primary,
        pair: normalizedPair,
        direction: normalizedDirection,
        details: details,
        hasDetails: details.length > 0,
        cycleKey: cycleKey,
        cycleBucket: Math.floor(new Date(primary.timestamp || Date.now()).getTime() / (5 * 60 * 1000)),
        aggregatedCount: group.length
      };

      aggregatedDiagnostics.push(aggregated);
    });

    // Sort by cycle bucket (most recent first)
    const sortedDiagnostics = aggregatedDiagnostics.sort((a, b) => b.cycleBucket - a.cycleBucket);
    
    // PART D FIX: Return sorted diagnostics - frontend will handle limiting to 3/10
    return sortedDiagnostics;
  };

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

  useEffect(() => {
    if (!user || !pageReady) {
      return;
    }

    loadData();

    // Auto-refresh diagnostics every 5 minutes when agent is running
    if (autoTradeEnabled) {
      const intervalId = setInterval(() => {
        loadData();
      }, 300000); // 5 minutes

      return () => clearInterval(intervalId);
    }
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

      // Load diagnostics/skipped trades
      const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 20);
      const diagnosticsData = diagnosticsResp.data?.diagnostics || [];
      
      // DEBUG: Log diagnostics data for HTF agent to understand the structure
      if (isHTFTrendFilterAgent && diagnosticsData.length > 0) {
        console.log('[HTF DIAGNOSTICS DEBUG] First diagnostic entry:', JSON.stringify(diagnosticsData[0], null, 2));
        console.log('[HTF DIAGNOSTICS DEBUG] All diagnostic pairs:', diagnosticsData.map(d => ({
          pair: d.pair,
          tradingPair: d.tradingPair,
          symbol: d.symbol,
          direction: d.direction,
          signal: d.signal?.direction,
          agentId: d.agentId
        })));
      }
      
      // Apply HTF diagnostics aggregation
      const processedDiagnostics = aggregateHTFDiagnostics(diagnosticsData);
      setSkippedTrades(processedDiagnostics);
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
      
      // Refresh trades and diagnostics immediately
      const tradesResp = await agentsApi.getTradingAgentTrades(slug, 20);
      setTrades(tradesResp.data?.trades || []);
      
      const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 20);
      const diagnosticsData = diagnosticsResp.data?.diagnostics || [];
      
      // DEBUG: Log diagnostics data for HTF agent to understand the structure
      if (isHTFTrendFilterAgent && diagnosticsData.length > 0) {
        console.log('[HTF DIAGNOSTICS DEBUG] Refresh - First diagnostic entry:', JSON.stringify(diagnosticsData[0], null, 2));
      }
      
      // Apply HTF diagnostics aggregation
      const processedDiagnostics = aggregateHTFDiagnostics(diagnosticsData);
      setSkippedTrades(processedDiagnostics);
      setScheduler(diagnosticsResp.data?.scheduler || null);
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
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
              {isHTFTrendFilterAgent && skippedTrades.length > 3 && (
                <button
                  onClick={() => setShowMoreDiagnostics(!showMoreDiagnostics)}
                  className="text-purple-400 hover:text-purple-300 transition-colors text-sm"
                >
                  {showMoreDiagnostics ? 'View Less' : `View More (${skippedTrades.length - 3} more)`}
                </button>
              )}
            </div>
            <div className="text-sm text-gray-400 mb-6 leading-relaxed">
              Shows execution/skip decisions from recent scheduler cycles (~5 min intervals)
              {isHTFTrendFilterAgent && !showMoreDiagnostics && skippedTrades.length > 3 && (
                <span className="text-purple-400"> • Showing latest 3 cycles</span>
              )}
              {isHTFTrendFilterAgent && showMoreDiagnostics && (
                <span className="text-purple-400"> • Showing latest {Math.min(skippedTrades.length, 10)} cycles</span>
              )}
            </div>

            {skippedTrades.length === 0 ? (
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
                      <th className="text-left py-3 px-4 font-semibold">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(isHTFTrendFilterAgent && !showMoreDiagnostics 
                      ? skippedTrades.slice(0, 3) 
                      : isHTFTrendFilterAgent && showMoreDiagnostics 
                      ? skippedTrades.slice(0, 10)
                      : skippedTrades
                    ).map((diagnostic) => {
                      // Use stable cycle key for React rendering
                      const stableKey = diagnostic.cycleKey || `${diagnostic.cycleBucket}-${diagnostic.pair}-${diagnostic.agentId || 'HTF'}`;
                      
                      // Use aggregated data directly (already processed)
                      const displayPair = diagnostic.pair || 'BTCUSDT'; // Never "--" for HTF
                      const displayDirection = diagnostic.direction || 'NO_TRADE'; // Never "--" for HTF
                      
                      // Enhanced decision display
                      const rawReason = diagnostic.decision?.reason || diagnostic.reason || 'NO_SIGNAL';
                      const executionStatus = diagnostic.execution?.status || 'SKIPPED';
                      
                      // STRICT RULE: Show (i) icon ONLY for executionStatus === "SKIPPED" AND NOT for EXECUTION_STARTED
                      const shouldShowPopup = (
                        executionStatus === 'SKIPPED' && 
                        rawReason !== 'EXECUTION_STARTED' && 
                        diagnostic.decision?.action !== 'INFO'
                      );
                      
                      let displayReason = rawReason;
                      let reasonColor = 'bg-gray-500/20 text-gray-400';

                      // Map to clear, human-readable reasons
                      if (rawReason.includes('confirmed') || rawReason.includes('rejected')) {
                        displayReason = rawReason;
                        reasonColor = rawReason.includes('rejected') ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400';
                      } else if (rawReason.includes('STOPPED') || rawReason.includes('PAUSED')) {
                        displayReason = 'AGENT STOPPED';
                        reasonColor = 'bg-gray-500/20 text-gray-400';
                      } else if (rawReason.includes('candles') || rawReason.includes('Insufficient')) {
                        displayReason = 'INSUFFICIENT DATA';
                        reasonColor = 'bg-yellow-500/20 text-yellow-400';
                      } else if (rawReason.includes('HTF') || rawReason.includes('LTF') || rawReason.includes('trend')) {
                        displayReason = 'HTF BLOCKED';
                        reasonColor = 'bg-purple-500/20 text-purple-400';
                      } else if (rawReason.includes('session') || rawReason.includes('SESSION')) {
                        displayReason = 'SESSION INVALID';
                        reasonColor = 'bg-blue-500/20 text-blue-400';
                      } else if (rawReason.includes('NO_SIGNAL') || rawReason.includes('Invalid indicators')) {
                        displayReason = 'NO SIGNAL';
                        reasonColor = 'bg-gray-500/20 text-gray-400';
                      } else if (rawReason.includes('EXCHANGE') || rawReason.includes('credentials')) {
                        displayReason = 'EXCHANGE ERROR';
                        reasonColor = 'bg-red-500/20 text-red-400';
                      } else if (rawReason === 'EXECUTION_STARTED') {
                        displayReason = 'EXECUTION_STARTED';
                        reasonColor = 'bg-blue-500/20 text-blue-400';
                      }

                      // Execution status (already declared above)
                      const executionReason = diagnostic.execution?.reason;
                      let executionColor = 'bg-gray-500/20 text-gray-400';
                      
                      if (executionStatus === 'EXECUTED') {
                        executionColor = 'bg-green-500/20 text-green-400';
                      } else if (executionStatus === 'FAILED') {
                        executionColor = 'bg-red-500/20 text-red-400';
                      }
                      
                      return (
                        <tr key={stableKey} className="border-b border-purple-500/10 hover:bg-slate-800/50 transition-colors">
                          <td className="py-3 px-4 text-white font-semibold">
                            {displayPair}
                          </td>
                          <td className={`py-3 px-4 font-bold text-base ${
                            displayDirection === 'LONG' ? 'text-green-400' : 
                            displayDirection === 'SHORT' ? 'text-red-400' :
                            'text-gray-400'
                          }`}>
                            {displayDirection}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {/* STRICT RULE: Show (i) icon ONLY for executionStatus === "SKIPPED" */}
                              {executionStatus === 'SKIPPED' && (
                                <div className="relative">
                                  <span 
                                    className={`cursor-pointer text-sm mr-1 ${
                                      (diagnostic.failure?.reasonCode?.includes('EXCHANGE') || 
                                       diagnostic.failure?.reasonCode?.includes('CREDENTIALS') ||
                                       rawReason.includes('EXCHANGE') || rawReason.includes('credentials')) ? 'text-red-400' : 
                                      'text-yellow-400'
                                    }`} 
                                    title="Click for details"
                                    onClick={() => setSelectedDiagnosticDetails(diagnostic)}
                                  >ⓘ</span>
                                </div>
                              )}
                              
                              <span className={`px-2 py-1 rounded text-xs font-medium ${reasonColor}`}>
                                {displayReason}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              {executionStatus === 'FAILED' && executionReason && (
                                <div className="relative group">
                                  <InformationCircleIcon className="w-4 h-4 text-red-400 cursor-help" />
                                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-64 p-3 bg-slate-900 border border-red-500/30 rounded-lg shadow-xl">
                                    <div className="text-xs font-semibold text-red-400 mb-1">Exchange Error:</div>
                                    <div className="text-xs text-gray-300">{executionReason}</div>
                                  </div>
                                </div>
                              )}
                              <span className={`px-2 py-1 rounded text-xs font-medium ${executionColor}`}>
                                {executionStatus}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-400 text-sm">
                            {new Date(diagnostic.timestamp).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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

      {/* Diagnostic Details Modal - STRICT RULES COMPLIANT */}
      {selectedDiagnosticDetails && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-slate-900 border border-purple-500/20 rounded-xl p-6 max-w-lg mx-4 max-h-[80vh] overflow-y-auto w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">
                Trade Diagnostic
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
            
            <div className="space-y-3">
              {/* Direction */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Direction</span>
                <span className={`font-bold ${
                  selectedDiagnosticDetails.direction === 'LONG' ? 'text-green-400' : 
                  selectedDiagnosticDetails.direction === 'SHORT' ? 'text-red-400' : 
                  'text-gray-300'
                }`}>{selectedDiagnosticDetails.direction}</span>
              </div>
              
              {/* Final Decision */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Final Decision</span>
                <span className="font-bold text-yellow-400">SKIPPED</span>
              </div>
              
              {/* Exact Reason */}
              <div className="flex justify-between items-start">
                <span className="text-gray-400 font-medium">Exact Reason</span>
                <span className="text-gray-300 text-right max-w-64 leading-relaxed">
                  {(() => {
                    const reasonText = selectedDiagnosticDetails.failure?.reasonText;
                    if (!reasonText) return 'Reason not available';
                    
                    // Backend mapping according to strict rules
                    if (reasonText.includes('Exchange credentials could not be decrypted')) {
                      return 'Exchange API keys could not be decrypted';
                    } else if (reasonText.includes('No exchange connected')) {
                      return 'Exchange not connected';
                    } else if (reasonText.includes('Insufficient futures balance') || reasonText.includes('LOW_FUTURES_BALANCE')) {
                      return 'Insufficient futures balance';
                    } else if (reasonText.includes('Risk/reward') || reasonText.includes('RR_INVALID')) {
                      return 'Risk–Reward conditions failed';
                    } else if (reasonText.includes('Outside trading hours')) {
                      return 'Outside trading hours';
                    } else if (reasonText.includes('Insufficient market data') || reasonText.includes('candle data')) {
                      return 'Insufficient market data';
                    } else if (reasonText.includes('No trading signal') || reasonText.includes('market conditions not met')) {
                      return 'No trading signal generated';
                    } else if (reasonText.includes('Daily trade limit')) {
                      return 'Daily trade limit reached';
                    } else if (reasonText.includes('Consecutive losses')) {
                      return 'Consecutive losses limit reached';
                    } else if (reasonText.includes('Agent was manually stopped')) {
                      return 'Agent manually stopped';
                    } else if (reasonText.includes('Agent was manually paused')) {
                      return 'Agent manually paused';
                    } else {
                      return reasonText.length > 80 ? reasonText.substring(0, 80) + '...' : reasonText;
                    }
                  })()}
                </span>
              </div>
              
              {/* Failure Category */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 font-medium">Failure Category</span>
                <span className="text-gray-300 font-bold">
                  {selectedDiagnosticDetails.failure?.failureCategory || 'OTHER'}
                </span>
              </div>
              
              {/* Exchange Details - ONLY if exchangeFailure exists */}
              {selectedDiagnosticDetails.exchangeFailure && (
                <>
                  <div className="border-t border-gray-600 pt-3 mt-3">
                    <div className="text-sm font-semibold text-red-400 mb-2">Exchange Details</div>
                    
                    {/* Exchange name */}
                    {selectedDiagnosticDetails.exchangeFailure.exchange && (
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-gray-400 font-medium">Exchange</span>
                        <span className="text-red-400 font-bold capitalize">
                          {selectedDiagnosticDetails.exchangeFailure.exchange}
                        </span>
                      </div>
                    )}
                    
                    {/* Exact exchange failure */}
                    <div className="flex justify-between items-start">
                      <span className="text-gray-400 font-medium">Exchange Error</span>
                      <span className="text-red-400 text-right max-w-48 leading-relaxed">
                        {(() => {
                          const failureType = selectedDiagnosticDetails.exchangeFailure.failureType;
                          const exchange = selectedDiagnosticDetails.exchangeFailure.exchange || 'Exchange';
                          
                          if (failureType === 'NOT_CONNECTED') {
                            return `${exchange.charAt(0).toUpperCase() + exchange.slice(1)} not connected`;
                          } else if (failureType === 'LOW_FUTURES_BALANCE') {
                            return 'Low futures balance';
                          } else if (failureType === 'DECRYPT_FAILED') {
                            return 'API key decryption failed';
                          } else if (failureType === 'INVALID_KEYS') {
                            return 'Invalid API keys';
                          } else {
                            return selectedDiagnosticDetails.exchangeFailure.rawError || 'Exchange error';
                          }
                        })()}
                      </span>
                    </div>
                  </div>
                </>
              )}
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