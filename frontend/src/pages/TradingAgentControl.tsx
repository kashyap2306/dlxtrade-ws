import { useState, useEffect, useRef } from 'react';
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

  useEffect(() => {
    console.log('[HTF_DIAGNOSTICS] diagnosticsEntries state updated, length:', diagnosticsEntries.length);
  }, [diagnosticsEntries]);

  const [agentConfig, setAgentConfig] = useState<any | null>(null);
  const [scheduler, setScheduler] = useState<any | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [showExecutionCriteria, setShowExecutionCriteria] = useState(false);
  const [, setTimerTick] = useState(0); // Force re-render for countdown
  const [selectedDiagnosticDetails, setSelectedDiagnosticDetails] = useState<any>(null);
  const [diagnosticsLimit, setDiagnosticsLimit] = useState(10); // Start with exactly 10

  // In-flight request guards to prevent parallel/overlapping API calls
  const [isLoadingControl, setIsLoadingControl] = useState(false);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const [controlDataLoaded, setControlDataLoaded] = useState(false); // Track if control was loaded once
  const hasFetchedOnceRef = useRef(false); // ONE-SHOT GUARD: Prevent multiple fetches on mount/refresh

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
    console.log('[HTF_DIAGNOSTICS] Agent changed, resetting diagnostics state', { slug, resolvedAgentId });
    hasFetchedOnceRef.current = false; // ONE-SHOT GUARD RESET: Allow fresh fetch for new agent
    setDiagnosticsEntries([]);
    setSkippedTrades([]);
    setDiagnosticsLimit(10); // Reset to initial limit
  }, [slug, resolvedAgentId]);

  // Helper function: Process HTF diagnostics
  // STRICTLY groups by schedulerCycleId to ensure one row per cycle
  // FIXED: Accept ALL diagnostics including SKIP actions with empty/placeholder pairs
  const processDiagnostics = (rawEntries: any[]): any[] => {
    if (!rawEntries || !Array.isArray(rawEntries) || rawEntries.length === 0) return [];

    // 1. Accept ALL HTF diagnostics - ZERO filtering
    // 2. Sort all entries by createdAt DESC initially
    const validEntries = [...rawEntries].sort((a: any, b: any) => {
      const tA = new Date(a.createdAt || a.timestamp || 0).getTime() || 0;
      const tB = new Date(b.createdAt || b.timestamp || 0).getTime() || 0;
      return tB - tA;
    });

    // 3. Deduplicate by schedulerCycleId
    const seenCycles = new Set<string>();
    const uniqueCycles: any[] = [];

    for (const entry of validEntries) {
      // Primary Key: schedulerCycleId
      // Fallback: cycleBucketTs -> id -> timestamp
      let timestampVal = 0;
      try {
        const d = new Date(entry.createdAt || entry.timestamp || 0);
        timestampVal = isNaN(d.getTime()) ? 0 : d.getTime();
      } catch (e) {
        timestampVal = 0;
      }

      const cycleKey = String(entry.schedulerCycleId || entry.cycleBucketTs || entry.id || timestampVal);

      if (!seenCycles.has(cycleKey)) {
        seenCycles.add(cycleKey);

        // Safe ISO string conversion to prevent crashes
        let isoTimestamp = new Date(0).toISOString();
        try {
          const d = new Date(timestampVal);
          if (!isNaN(d.getTime())) {
            isoTimestamp = d.toISOString();
          }
        } catch (e) {
          // Fallback to epoch
        }

        uniqueCycles.push({
          ...entry,
          timestamp: isoTimestamp,
          // Stable key for React rendering
          _uiKey: cycleKey
        });
      }
    }

    return uniqueCycles;
  };

  // Load additional diagnostics for "View more"
  const loadMoreDiagnostics = async () => {
    if (isLoadingDiagnostics) return;

    setIsLoadingDiagnostics(true);
    try {
      // Requirement: Slice EXACTLY 50 unique cycles for "View More"
      const newLimit = 50;
      console.log('[HTF_VIEW_MORE] Setting limit to EXACTLY', newLimit);

      // Requirement: For View More (50 cycles) fetch AT LEAST 150 raw entries
      const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 150);
      const entries = diagnosticsResp.data?.diagnostics || [];

      console.log('[HTF_VIEW_MORE] Received', entries.length, 'raw entries from API');

      // Process diagnostics into unique cycles (one per 5-min bucket)
      const processedBuckets = processDiagnostics(entries);

      // Slice to EXACTLY the requested limit of 50 unique cycles
      const finalEntries = processedBuckets.slice(0, newLimit);

      console.log('[HTF_VIEW_MORE] Resulting unique cycles:', finalEntries.length);

      // Update state with new entries
      setDiagnosticsEntries(finalEntries);
      setDiagnosticsLimit(newLimit);
    } catch (err) {
      console.error('Error loading more diagnostics:', err);
    } finally {
      setIsLoadingDiagnostics(false);
    }
  };

  // NOTE: Diagnostics hash logic removed to preserve full rolling history and ensure state is always updated

  // 1. Initial Data Load - Always fetch on mount/agent change
  useEffect(() => {
    if (!user || !pageReady) {
      return;
    }
    // but the safest way to fix the "not rendering" bug is to ensure loadData() runs at least once when ready.
    console.log('[HTF_DIAGNOSTICS] Initial load triggered for:', slug);
    loadData();
  }, [user, pageReady, slug]);

  // 2. Continuous Polling - Ensures UI updates regardless of initial load state
  useEffect(() => {
    if (!user || !pageReady) {
      return;
    }

    // Determine polling interval - every 5 minutes (300,000ms)
    const intervalMs = 300000;

    console.log('[HTF_DIAGNOSTICS] Polling interval setup', { autoTradeEnabled });

    const intervalId = setInterval(() => {
      console.log('[HTF_DIAGNOSTICS] Polling tick');
      loadDiagnosticsAndTrades();
    }, intervalMs);

    return () => {
      console.log('[HTF_DIAGNOSTICS] Cleaning up polling interval');
      clearInterval(intervalId);
    };
  }, [user, pageReady, slug, autoTradeEnabled]); // Re-setup if agent status or identity changes

  // REMOVED: Redundant effect that caused double-fetches on initial status load
  // autoTradeEnabled is handled manually in handleToggleAutoTrade and loadDiagnosticsAndTrades

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
    if (!user || !resolvedAgentId || loadingData) {
      return;
    }

    setLoadingData(true);

    try {
      // For HTF Trend Filter Agent, we strictly use ONLY the diagnostics endpoint
      // for both data and status, satisfying the "ONLY GET /diagnostics" requirement.
      if (isHTFTrendFilterAgent) {
        await loadDiagnosticsAndTrades();
        return;
      }

      // Load agent status and config ONCE (with guard) - Non-HTF agents only
      if (!isLoadingControl && !controlDataLoaded) {
        setIsLoadingControl(true);
        try {
          const agentResp = await agentsApi.getTradingAgentControl(slug);
          setAutoTradeEnabled(agentResp.data?.status === 'ACTIVE');
          setAgentConfig(agentResp.data?.config || null);
          setControlDataLoaded(true);
        } catch (err) {
          console.error('Error loading agent control:', err);
        } finally {
          setIsLoadingControl(false);
        }
      }

      // Load diagnostics and trades
      await loadDiagnosticsAndTrades();

    } catch (err: any) {
      console.error('Error loading data:', err);
      showToast('Failed to load data', 'error');
    } finally {
      setLoadingData(false);
    }
  };

  const loadDiagnosticsAndTrades = async () => {
    if (!user || !resolvedAgentId) {
      return;
    }

    try {
      // For HTF, skip loading trades from explicit trades endpoint to minimize API surface
      // HTF trades are either shown via diagnostics or as a separate section if needed
      if (!isHTFTrendFilterAgent) {
        // Load trades
        setIsLoadingTrades(true);
        try {
          const tradesResp = await agentsApi.getTradingAgentTrades(slug, 20);
          setTrades(tradesResp.data?.trades || []);
        } catch (err) {
          console.error('Error loading trades:', err);
        } finally {
          setIsLoadingTrades(false);
        }
      }

      // CRITICAL: HTF agents use diagnostics, not research_history
      if (isHTFTrendFilterAgent) {
        // Load diagnostics - ALWAYS fetch to ensure fresh data
        setIsLoadingDiagnostics(true);
        try {
          // Requirement: For main table (10 cycles) fetch AT LEAST 60 raw entries to ensure 10 unique cycles.
          // For View More (50 cycles) fetch AT LEAST 150 raw entries.
          const rawFetchLimit = diagnosticsLimit === 10 ? 60 : 150;
          const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, rawFetchLimit);
          console.log(
            "[HTF_DEBUG] API diagnostics length:",
            diagnosticsResp?.data?.diagnostics?.length,
            diagnosticsResp?.data?.diagnostics
          );
          setScheduler(diagnosticsResp.data?.scheduler || null);

          // SYNC AGENT STATE: Update status and config from diagnostics response
          if (diagnosticsResp.data?.agentStatus) {
            setAutoTradeEnabled(diagnosticsResp.data.agentStatus === 'ACTIVE');
          }
          if (diagnosticsResp.data?.agentConfig) {
            setAgentConfig(diagnosticsResp.data.agentConfig);
          }
          setControlDataLoaded(true);

          // Extract diagnostics entries for Recent Cycle Results
          const entries = diagnosticsResp.data?.diagnostics || [];
          console.log('[HTF_DIAGNOSTICS] Raw entries:', entries);

          // Process diagnostics into unique cycles (one per 5-min bucket)
          // Threshold slicing to EXACTLY the requested limit (10 or 50) of unique cycles
          const aggregatedBuckets = processDiagnostics(entries);
          console.log('[HTF_DIAGNOSTICS] processed unique cycles:', aggregatedBuckets.length);

          const finalEntries = aggregatedBuckets.slice(0, diagnosticsLimit);
          console.log('[HTF_DIAGNOSTICS] final entries after limit slicing:', finalEntries.length);

          // Set processed entries - ALWAYS REPLACE, NEVER APPEND
          console.log(
            "[HTF_DEBUG] setting diagnostics entries length:",
            finalEntries.length,
            finalEntries
          );
          setDiagnosticsEntries(finalEntries);
          setTimeout(() => {
            console.log(
              "[HTF_DEBUG] state AFTER setDiagnosticsEntries:",
              diagnosticsEntries.length,
              diagnosticsEntries
            );
          }, 0);
        } catch (err) {
          console.error('Error loading diagnostics:', err);
        } finally {
          setIsLoadingDiagnostics(false);
        }
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
        if (!isLoadingDiagnostics) {
          setIsLoadingDiagnostics(true);
          try {
            const diagnosticsResp = await agentsApi.getTradingAgentDiagnostics(slug, 20);
            setScheduler(diagnosticsResp.data?.scheduler || null);
          } catch (err) {
            console.error('Error loading scheduler:', err);
          } finally {
            setIsLoadingDiagnostics(false);
          }
        }
      }

    } catch (err: any) {
      console.error('Error loading diagnostics and trades:', err);
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

      // CRITICAL: Refetch status from backend after API call (with guard)
      if (!isLoadingControl) {
        setIsLoadingControl(true);
        try {
          const updatedStatusRes = await agentsApi.getTradingAgentControl(slug);
          setAutoTradeEnabled(updatedStatusRes.data?.status === 'ACTIVE');
          setAgentConfig(updatedStatusRes.data?.config || null);
        } finally {
          setIsLoadingControl(false);
        }
      }

      // Refresh diagnostics and trades (uses guards internally)
      await loadDiagnosticsAndTrades();

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
                      <tr key={trade.id || `trade_${trade.entryTime || Math.random()}`} className="border-b border-purple-500/10 hover:bg-slate-700/30 transition-colors">
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
              <h3 className="text-xl font-bold text-white">Recent Diagnostic Entries</h3>
              {isHTFTrendFilterAgent && diagnosticsEntries.length >= diagnosticsLimit && (
                <button
                  onClick={loadMoreDiagnostics}
                  disabled={isLoadingDiagnostics}
                  className="text-purple-400 hover:text-purple-300 transition-colors text-sm disabled:opacity-50"
                >
                  {isLoadingDiagnostics ? 'Loading...' : 'View More'}
                </button>
              )}
            </div>
            <div className="text-sm text-gray-400 mb-6 leading-relaxed">
              Shows one diagnostic per 5-minute scheduler cycle
              {isHTFTrendFilterAgent && diagnosticsEntries.length > 0 && (
                <span className="text-purple-400">
                  {' • '}
                  Showing latest {diagnosticsEntries.length} entries
                </span>
              )}
            </div>

            {/* CRITICAL: HTF agents use diagnostics, non-HTF use research_history */}
            {console.log('[HTF_DIAGNOSTICS] Rendering HTF block, diagnosticsEntries.length:', diagnosticsEntries.length)}
            {console.log(
              "[HTF_DEBUG_RENDER]",
              "diagnosticsEntries.length =",
              diagnosticsEntries.length,
              "pageReady =",
              pageReady,
              "isHTF =",
              isHTFTrendFilterAgent
            )}
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
                        <th className="text-left py-3 px-4 font-semibold">Cycle Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagnosticsEntries.map((entry, idx) => {
                        const displayPair = entry.tradingPair || entry.pair || '—';
                        const htfBias = entry.runtimeState?.htfBias || entry.htfBias || entry.direction;
                        const displayDirection = htfBias === 'NO_TRADE' ? 'NO TRADE' : (htfBias || '—');
                        const displayDecision = entry.decision?.action || '—';

                        // Build skip reason - ONLY show for SKIP decisions
                        let shortSkipReason = '—';

                        if (displayDecision === 'SKIP') {
                          const runtimeState = entry.runtimeState;
                          const executionState = runtimeState?.executionState;

                          if (executionState?.executionBlockedReason) {
                            const blockedReason = executionState.executionBlockedReason;
                            if (blockedReason.includes('AGENT_STOPPED')) {
                              shortSkipReason = 'Agent stopped';
                            } else if (blockedReason.includes('AGENT_PAUSED')) {
                              shortSkipReason = 'Agent paused';
                            } else if (blockedReason.includes('EXCHANGE')) {
                              shortSkipReason = 'Exchange issue';
                            } else if (blockedReason.includes('SESSION')) {
                              shortSkipReason = 'Session invalid';
                            } else {
                              shortSkipReason = 'Condition not met';
                            }
                          } else if (entry.execution?.blockDetails) {
                            shortSkipReason = 'Execution blocked';
                          } else if (runtimeState?.indicators?.results) {
                            const results = runtimeState.indicators.results;
                            const rejectedCount = Object.values(results).filter(
                              (r: any) => r?.status === 'rejected'
                            ).length;

                            if (rejectedCount === 1) {
                              shortSkipReason = 'Condition not met';
                            } else if (rejectedCount > 1) {
                              shortSkipReason = 'Indicators not aligned';
                            } else {
                              shortSkipReason = 'Condition not met';
                            }
                          } else {
                            const rawReason = runtimeState?.skipDetails ||
                              runtimeState?.skipReason ||
                              entry.decision?.reason ||
                              '';

                            if (rawReason.includes('NO_TRADE') || rawReason.includes('NO TRADE')) {
                              shortSkipReason = 'Trend rejected';
                            } else if (rawReason.includes('RR_FAIL') || rawReason.includes('risk')) {
                              shortSkipReason = 'Risk/reward poor';
                            } else if (rawReason.includes('STRUCTURE') || rawReason.includes('structure')) {
                              shortSkipReason = 'Structure invalid';
                            } else if (rawReason.includes('rejected')) {
                              shortSkipReason = 'Condition not met';
                            } else {
                              shortSkipReason = 'Condition not met';
                            }
                          }
                        }

                        let reasonColor = 'bg-gray-500/20 text-gray-400';
                        if (displayDecision === 'TRADE') {
                          reasonColor = 'bg-green-500/20 text-green-400';
                        } else if (displayDecision === 'SKIP') {
                          reasonColor = 'bg-yellow-500/20 text-yellow-400';
                        }

                        // Display cycle time
                        const cycleTime = entry.timestamp
                          ? new Date(entry.timestamp).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false
                          })
                          : '—';

                        return (
                          <tr
                            key={entry._uiKey || entry.schedulerCycleId || `htf_cycle_${entry.bucketId || Math.random()}`}
                            className="border-b border-purple-500/10 hover:bg-slate-800/50 transition-colors"
                          >
                            <td className="py-3 px-4 text-white font-semibold">
                              {displayPair}
                            </td>
                            <td className="py-3 px-4 text-gray-400 font-bold">
                              {displayDirection}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${reasonColor}`}>
                                  {displayDecision}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDiagnosticDetails(entry);
                                  }}
                                  className="flex-shrink-0 text-purple-400 hover:text-purple-300 transition-colors"
                                  title="View full diagnostic breakdown"
                                >
                                  <InformationCircleIcon className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-gray-400 text-sm">
                              {shortSkipReason}
                            </td>
                            <td className="py-3 px-4 text-gray-400 text-sm font-mono">
                              {cycleTime}
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
                    ? 'Waiting for first diagnostic entries...'
                    : 'No diagnostic entries yet. Start the agent to begin analysis.'}
                </div>
              )
            ) : (
              // Non-HTF Agent: Use research_history (AUTO_TRADE cycles)
              skippedTrades.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-slate-800/30 rounded-lg border border-purple-500/10">
                  {autoTradeEnabled
                    ? 'Waiting for first analysis cycle...'
                    : 'No analysis results yet. Start the agent to begin.'}
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
                      {skippedTrades.map((entry) => {
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
                          <tr key={entry.id || `skipped_${entry.timestamp || Math.random()}`} className="border-b border-purple-500/10 hover:bg-slate-800/50 transition-colors">
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
          <div className="bg-slate-900 border border-purple-500/20 rounded-xl p-6 max-w-3xl mx-4 max-h-[85vh] overflow-y-auto w-full">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white">
                HTF Trend Filter Diagnostic Details
              </h3>
              <button
                onClick={() => setSelectedDiagnosticDetails(null)}
                className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-slate-800 rounded"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-6">
              {/* Source Badge - Show HTF or AUTO_TRADE source */}
              {selectedDiagnosticDetails.source && (
                <div className="flex items-center gap-2 p-2 bg-slate-800/50 rounded-lg w-fit">
                  <span className="text-xs font-semibold text-gray-400">Source:</span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${selectedDiagnosticDetails.source === 'HTF_TREND_FILTER_AGENT'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-orange-500/20 text-orange-400'
                    }`}>
                    {selectedDiagnosticDetails.source === 'HTF_TREND_FILTER_AGENT' ? 'HTF Trend Filter' : 'Auto-Trade Engine'}
                  </span>
                </div>
              )}

              {/* Summary Section */}
              <div className="bg-slate-800/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-medium">Trading Pair</span>
                  <span className="font-bold text-white text-lg">
                    {selectedDiagnosticDetails.tradingPair || selectedDiagnosticDetails.symbol || '—'}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-medium">Direction</span>
                  <span className={`font-bold text-lg ${selectedDiagnosticDetails.direction === 'LONG' ? 'text-green-400' :
                    selectedDiagnosticDetails.direction === 'SHORT' ? 'text-red-400' :
                      'text-gray-300'
                    }`}>{selectedDiagnosticDetails.direction || '—'}</span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-gray-400 font-medium">Final Decision</span>
                  <span className={`px-4 py-2 rounded-lg text-base font-bold ${selectedDiagnosticDetails.decision?.action === 'TRADE'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    }`}>
                    {selectedDiagnosticDetails.decision?.action || 'SKIP'}
                  </span>
                </div>

                <div className="flex justify-between items-start pt-2 border-t border-slate-700">
                  <span className="text-gray-500 text-sm">Timestamp</span>
                  <span className="text-gray-400 text-sm">
                    {selectedDiagnosticDetails.timestamp
                      ? new Date(selectedDiagnosticDetails.timestamp).toLocaleString()
                      : '—'}
                  </span>
                </div>
              </div>

              {/* HTF Skip Reason Summary - Visual Checklist */}
              <div className="bg-slate-800/50 rounded-lg p-4 border-l-4 border-blue-500/50">
                <div className="text-sm font-semibold text-blue-400 mb-3">HTF Filter Analysis</div>
                {(() => {
                  const analysisText = selectedDiagnosticDetails.runtimeState?.skipDetails ||
                    selectedDiagnosticDetails.runtimeState?.skipReason ||
                    selectedDiagnosticDetails.decision?.reason ||
                    'No detailed reason provided';

                  // Parse the analysis string for condition keywords
                  const conditions = [
                    { name: 'VWAP', keyword: 'VWAP' },
                    { name: 'EMA', keyword: 'EMA' },
                    { name: 'RSI', keyword: 'RSI' },
                    { name: 'SR', keyword: 'SR' },
                    { name: 'Volume', keyword: 'Volume' }
                  ];

                  // Check if the text contains structured condition info
                  const hasStructuredConditions = conditions.some(c =>
                    analysisText.includes(`${c.keyword} confirmed`) ||
                    analysisText.includes(`${c.keyword} rejected`)
                  );

                  if (hasStructuredConditions) {
                    // Parse and display as visual checklist
                    return (
                      <div className="space-y-2">
                        {conditions.map(condition => {
                          const confirmedPattern = new RegExp(`${condition.keyword}\\s+confirmed`, 'i');
                          const rejectedPattern = new RegExp(`${condition.keyword}\\s+rejected`, 'i');

                          const isConfirmed = confirmedPattern.test(analysisText);
                          const isRejected = rejectedPattern.test(analysisText);

                          // Only show conditions that are mentioned in the text
                          if (!isConfirmed && !isRejected) return null;

                          return (
                            <div
                              key={condition.name}
                              className="flex items-center gap-3 py-2 px-3 bg-slate-800/30 rounded-lg"
                            >
                              {isConfirmed ? (
                                <svg
                                  className="w-5 h-5 flex-shrink-0"
                                  fill="none"
                                  stroke="#22c55e"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2.5}
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  className="w-5 h-5 flex-shrink-0"
                                  fill="none"
                                  stroke="#ef4444"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2.5}
                                    d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                              )}
                              <span className={`font-medium ${isConfirmed ? 'text-green-400' : 'text-red-400'
                                }`}>
                                {condition.name}
                              </span>
                              <span className="text-gray-400 text-sm ml-auto">
                                {isConfirmed ? 'Confirmed' : 'Rejected'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  } else {
                    // Fallback: show plain text if no structured conditions found
                    return (
                      <div className="text-gray-300 leading-relaxed">
                        {analysisText}
                      </div>
                    );
                  }
                })()}
              </div>

              {/* AUTO_TRADE Skip Reason (if present in same cycle) */}
              {selectedDiagnosticDetails.autoTradeDetails && selectedDiagnosticDetails.autoTradeSkipReason && (
                <div className="bg-slate-800/50 rounded-lg p-4 border-l-4 border-orange-500/50">
                  <div className="text-sm font-semibold text-orange-400 mb-2">Auto-Trade Engine Skip Reason</div>
                  <div className="text-gray-300 leading-relaxed">
                    {selectedDiagnosticDetails.autoTradeSkipReason}
                  </div>
                </div>
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