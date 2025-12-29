import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePerformance';
import { useAutoTradeConfig } from '../hooks/useAutoTradeConfig';
import { AutoTradeEngineControls } from '../components/AutoTradeEngineControls';
import { AutoTradeDiagnostics } from '../components/AutoTradeDiagnostics';
import { AutoTradeStats } from '../components/AutoTradeStats';
import { AutoTradeTrades } from '../components/AutoTradeTrades';
import { AutoTradeDiagnosticModal } from '../components/AutoTradeDiagnosticModal';
import Toast from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import api, { usersApi, autoTradeApi, researchApi } from '../services/api';
import PendingTradeConfirmationModal from '../components/PendingTradeConfirmationModal';
import { NotificationDiagnosticsSection } from '../components/NotificationDiagnostics';
import TradeSkipPopup from '../components/TradeSkipPopup';

const PageLoader = () => (
  <div className="min-h-screen bg-gradient-to-b from-[#0d1421] to-[#05070c] flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
      <p className="text-blue-200">Loading Auto-Trade configuration...</p>
    </div>
  </div>
);

export default function AutoTrade() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false); // Never show global loading like Research page
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const isMountedRef = useRef(true);
  const configsLoadedWarnedRef = useRef(false);

  // Use the custom hook for all auto-trade configuration and state
  const {
    config,
    setConfig,
    activeTrades,
    activityLogs,
    performanceStats,
    engineStatus,
    cooldownRemaining,
    setCooldownRemaining,
    todayTrades,
    tradeAccuracy,
    exchangeConfig,
    setExchangeConfig,
    providerConfig,
    setProviderConfig,
    autoTradeStatus,
    setAutoTradeStatus,
    configsLoaded,
    exchangeLoaded,
    loadAllData,
    loadLiveData,
    loadAutoTradeStatus,
    loadPerformanceStats,
    calculateTradeAccuracy: calculateTradeAccuracyFn,
    calculateTodayTrades: calculateTodayTradesFn,
    isExchangeConnected,
    resolveExchangeName,
    decryptKeyIfNeeded,
    updateEngineStatus,
    backendDiagnostics,
  } = useAutoTradeConfig(user);

  // Removed provider config dependency checks - no longer blocking UI

  // Memoized toast function
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // State for diagnostics and modals (moved from hook to keep in main component)
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<any>(null);

  // State for pending trades confirmation
  const [pendingTrades, setPendingTrades] = useState<any[]>([]);
  const [currentPendingTrade, setCurrentPendingTrade] = useState<any | null>(null);
  const [isProcessingTrade, setIsProcessingTrade] = useState(false);

  // State for Auto-Trade research history modal
  const [showAutoTradeHistoryModal, setShowAutoTradeHistoryModal] = useState(false);
  const [autoTradeHistory, setAutoTradeHistory] = useState<any[]>([]);
  const [loadingAutoTradeHistory, setLoadingAutoTradeHistory] = useState(false);

  // Balance Proof State
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceData, setBalanceData] = useState<any>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Trade Skip Popup State
  const [skipPopupData, setSkipPopupData] = useState<{
    isOpen: boolean;
    symbol: string;
    accuracy: number;
    accuracyTrigger: number;
    skipReasons: string[];
    timestamp: string;
  } | null>(null);
  const shownSkipHistoryIdsRef = useRef<Set<string>>(new Set());

  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true);
    setBalanceData(null);
    try {
      const response = await api.get('/exchange/balance');
      if (response.data?.success) {
        setBalanceData(response.data.data);
      } else {
        setBalanceData({ error: response.data?.message?.error || "Failed to fetch balance" });
      }
    } catch (e: any) {
      console.error("Balance fetch error:", e);
      setBalanceData({ error: e.response?.data?.message?.error || e.message || "Network error" });
    } finally {
      setLoadingBalance(false);
    }
  }, []);
  const runSelfTest = async () => {
    console.log("[RUN SELF TEST CLICKED] - Refreshing diagnostics (with local config fallback)");

    setDiagnosticsVisible(true);
    setIsRunningDiagnostics(true);

    try {
      // Simply reload fresh auto-trade status from backend
      // Backend handles all diagnostic logic now
      await loadAutoTradeStatus();

      // No need to set diagnosticResults anymore - component uses backendDiagnostics prop
      return {
        success: true,
        message: 'Backend diagnostics loaded successfully'
      };
    } catch (err: any) {
      console.error('[RUN SELF TEST ERROR]', err);
      return {
        success: false,
        error: err?.message || 'Failed to load backend diagnostics'
      };
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  // Removed auto-enable logic - backend is source of truth for exchange connection
  // Auto-enable would require backend exchangeConnected check, not frontend exchangeConfig

  // Load all data when user changes
  useEffect(() => {
    if (user) {
      loadAllData();
    }
  }, [user, loadAllData]);

  // Emergency timeout: force loading=false after 3 seconds
  useEffect(() => {
    if (loading) {
      const timeout = setTimeout(() => {
        console.log('[AutoTrade] EMERGENCY: Forcing loading=false after 3 seconds');
        if (isMountedRef.current) {
          setLoading(false);
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [loading]);

  // CONSOLIDATED POLLING: Single polling mechanism for live data AND status
  // CRITICAL: Only poll when auto-trade is enabled to prevent unnecessary API calls
  // Combines loadLiveData + loadAutoTradeStatus into one controlled polling loop
  const consolidatedPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingEnabledRef = useRef(false);

  useEffect(() => {
    // Clear any existing interval first
    if (consolidatedPollRef.current) {
      clearInterval(consolidatedPollRef.current);
      consolidatedPollRef.current = null;
    }

    const shouldPoll = !!user && config.autoTradeEnabled && !backendDiagnostics?.blocked;
    isPollingEnabledRef.current = shouldPoll;

    console.log("[AT_POLLING] Polling state changed", {
      hasUser: !!user,
      autoTradeEnabled: config.autoTradeEnabled,
      blocked: backendDiagnostics?.blocked,
      shouldPoll
    });

    if (!user) {
      console.log("[AT_POLLING] No user, skipping all polling");
      return;
    }

    // Always load status once on mount/user change to get initial state
    loadAutoTradeStatus();

    if (shouldPoll) {
      console.log("[AT_POLLING] Starting consolidated polling (60s interval)");

      // Single interval for all polling - minimum 60 seconds
      consolidatedPollRef.current = setInterval(() => {
        if (isPollingEnabledRef.current) {
          loadAutoTradeStatus();
          loadLiveData();
        }
      }, 60000); // 60 seconds minimum
    } else {
      console.log("[AT_POLLING] Auto-trade disabled/blocked, polling stopped");
    }

    return () => {
      if (consolidatedPollRef.current) {
        clearInterval(consolidatedPollRef.current);
        consolidatedPollRef.current = null;
      }
    };
    // CRITICAL: Stable dependencies only - loadAutoTradeStatus is now stable (user-only dep)
  }, [user, config.autoTradeEnabled, backendDiagnostics?.blocked]);

  // Load pending trades when Auto-Trade is enabled
  const loadPendingTrades = useCallback(async () => {
    if (!user || !config.autoTradeEnabled || isProcessingTrade) return;

    try {
      const response = await autoTradeApi.getPendingTrades();
      const trades = response.data?.pendingTrades || [];

      if (isMountedRef.current) {
        setPendingTrades(trades);

        // Show the first pending trade if we have one and no modal is currently open
        if (trades.length > 0 && !currentPendingTrade) {
          setCurrentPendingTrade(trades[0]);
        }
      }
    } catch (err: any) {
      console.warn('[PENDING_TRADES] Failed to load pending trades:', err?.message);
      // Silently fail - don't spam errors
    }
  }, [user, config.autoTradeEnabled, isProcessingTrade, currentPendingTrade]);

  // Load pending trades when Auto-Trade is enabled
  // CONSOLIDATED: Uses same enable condition, no separate polling interval
  // Pending trades are loaded once on enable and then on demand (trade actions)
  useEffect(() => {
    if (!user || !config.autoTradeEnabled || backendDiagnostics?.blocked) {
      setPendingTrades([]);
      setCurrentPendingTrade(null);
      return;
    }

    // Load immediately once when enabled
    loadPendingTrades();

    // REMOVED: Separate polling interval - consolidated into main polling loop above
    // Pending trades will be refreshed via the consolidated polling or on user action
  }, [user, config.autoTradeEnabled, backendDiagnostics?.blocked]);

  // Handle trade approval
  const handleApproveTrade = useCallback(async (requestId: string) => {
    if (isProcessingTrade) return;

    setIsProcessingTrade(true);
    try {
      await autoTradeApi.approveTrade(requestId);
      showToast('Trade approved and executed successfully', 'success');

      // Remove the approved trade from the list
      setPendingTrades(prev => prev.filter(t => (t.requestId || t.id) !== requestId));
      setCurrentPendingTrade(null);

      // Reload pending trades to get updated list
      setTimeout(() => {
        loadPendingTrades();
      }, 1000);
    } catch (err: any) {
      console.error('[APPROVE_TRADE] Error:', err);
      showToast(err?.response?.data?.error || 'Failed to approve trade', 'error');
    } finally {
      setIsProcessingTrade(false);
    }
  }, [isProcessingTrade, showToast, loadPendingTrades]);

  // Handle trade rejection
  const handleRejectTrade = useCallback(async (requestId: string) => {
    if (isProcessingTrade) return;

    setIsProcessingTrade(true);
    try {
      await autoTradeApi.rejectTrade(requestId);
      showToast('Trade rejected successfully', 'success');

      // Remove the rejected trade from the list
      setPendingTrades(prev => prev.filter(t => (t.requestId || t.id) !== requestId));
      setCurrentPendingTrade(null);

      // Reload pending trades to get updated list
      setTimeout(() => {
        loadPendingTrades();
      }, 1000);
    } catch (err: any) {
      console.error('[REJECT_TRADE] Error:', err);
      showToast(err?.response?.data?.error || 'Failed to reject trade', 'error');
    } finally {
      setIsProcessingTrade(false);
    }
  }, [isProcessingTrade, showToast, loadPendingTrades]);

  // Update current pending trade when list changes
  useEffect(() => {
    if (pendingTrades.length > 0) {
      // If we don't have a current trade, or the current trade is no longer in the list, show the first one
      const currentId = currentPendingTrade?.requestId || currentPendingTrade?.id;
      const isCurrentTradeStillPending = pendingTrades.some(
        t => (t.requestId || t.id) === currentId
      );

      if (!currentPendingTrade || !isCurrentTradeStillPending) {
        setCurrentPendingTrade(pendingTrades[0]);
      }
    } else {
      setCurrentPendingTrade(null);
    }
  }, [pendingTrades, currentPendingTrade]);

  // Load Auto-Trade research history
  const loadAutoTradeHistory = useCallback(async () => {
    if (!user) return;

    setLoadingAutoTradeHistory(true);
    try {
      const response = await researchApi.deepResearch.getHistory(100);
      const allHistory = response.data?.data || response.data || [];

      // Filter for AUTO_TRADE source only - include all entries (executed trades may have symbols, skipped cycles have null symbols)
      const autoTradeOnly = allHistory.filter((entry: any) =>
        entry.source === 'AUTO_TRADE'
      );

      // Sort by timestamp DESC (latest first) - no grouping
      const sortedHistory = autoTradeOnly.sort((a: any, b: any) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeB - timeA;
      });

      setAutoTradeHistory(sortedHistory);

      // Check for new skipped trades that should show popup (use grouped history)
      if (config.autoTradeEnabled) {
        // Use default accuracy trigger (simplified)
        const accuracyTrigger = 75;

        for (const entry of sortedHistory) {
          // Only show popup for SKIPPED entries with accuracy >= trigger
          // Normalize accuracy to 0-100 range
          const normalizedAccuracy = typeof entry.accuracy === 'number'
            ? (entry.accuracy > 1 ? entry.accuracy : entry.accuracy * 100)
            : 0;

          if (entry.decision === 'SKIPPED' &&
            normalizedAccuracy >= accuracyTrigger &&
            entry.skipReason &&
            entry.id &&
            !shownSkipHistoryIdsRef.current.has(entry.id)) {

            // Parse skip reasons (can be string or array)
            const skipReasons = entry.skipReasons || (entry.skipReason ? [entry.skipReason] : []);

            setSkipPopupData({
              isOpen: true,
              symbol: entry.symbol || 'UNKNOWN',
              accuracy: normalizedAccuracy,
              accuracyTrigger: 75, // Use default
              skipReasons: Array.isArray(skipReasons) ? skipReasons : [skipReasons],
              timestamp: entry.timestamp || new Date().toISOString()
            });

            // Mark as shown to prevent duplicate popups
            shownSkipHistoryIdsRef.current.add(entry.id);
            break; // Only show one popup at a time
          }
        }
      }
    } catch (err: any) {
      console.warn('[AUTO_TRADE_HISTORY] Failed to load history:', err?.message);
      setAutoTradeHistory([]);
    } finally {
      setLoadingAutoTradeHistory(false);
    }
  }, [user, config.autoTradeEnabled]);

  // Load history when modal opens
  useEffect(() => {
    if (showAutoTradeHistoryModal) {
      loadAutoTradeHistory();
    }
  }, [showAutoTradeHistoryModal, loadAutoTradeHistory]);

  // Load research history ONLY when tab/section is opened (not on interval polling)
  // Removed continuous polling to prevent over-polling

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // CRITICAL: Exchange readiness MUST come ONLY from backend diagnostics
  // NO fallback to local config - backend is the SINGLE source of truth
  // Backend uses resolveExchangeConnector() - same logic as trading engine
  const backendExchangeConnected = backendDiagnostics?.diagnostics?.exchangeConnected;
  const backendDiagnosticsLoaded = backendDiagnostics !== null && backendDiagnostics !== undefined;

  // isExchangeReady:
  // - true ONLY if backend explicitly returns exchangeConnected === true
  // - false if backend explicitly returns exchangeConnected === false
  // - false if backend diagnostics are still loading (will update once loaded)
  const isExchangeReady = useMemo(() => {
    // CRITICAL: Backend is ONLY source of truth - NO local config fallback
    if (backendExchangeConnected === true) return true;
    // Explicitly false from backend OR still loading = not ready
    return false;
  }, [backendExchangeConnected]);

  // Exchange status for UI display (shows "Checking..." while loading)
  const exchangeStatus = useMemo(() => {
    if (!backendDiagnosticsLoaded) return 'loading'; // Still loading backend data
    if (backendExchangeConnected === true) return 'connected';
    return 'disconnected'; // Backend explicitly said false
  }, [backendDiagnosticsLoaded, backendExchangeConnected]);

  // Providers readiness - NON-BLOCKING for Auto-Trade
  // Market Data and News providers MUST NEVER block Auto-Trade
  const isProvidersReady = backendDiagnostics?.providersReady !== false;

  // Overall Auto‑Trade readiness
  // CRITICAL: Only user authentication and exchange connection can block
  // Providers are NON-BLOCKING - they show warnings but don't prevent Auto-Trade
  const isAutoTradeReady = !!user && isExchangeReady;

  // Debug log - Backend is ONLY source of truth (no local config fallback)
  // Use JSON.stringify for proper object display in console
  console.log('[AT_READINESS]', JSON.stringify({
    user: !!user,
    isExchangeReady,
    exchangeStatus, // 'loading' | 'connected' | 'disconnected'
    source: 'Backend Diagnostics (ONLY)', // Always backend - no fallback
    backendExchangeConnected,
    backendExchangeReason: backendDiagnostics?.diagnostics?.exchangeReason,
    backendDiagnosticsLoaded,
    isProvidersReady, // NON-BLOCKING - for display only
    backendProvidersReady: backendDiagnostics?.providersReady,
    backendProviderTimeout: backendDiagnostics?.providerConfigTimeout,
    ready: isAutoTradeReady,
    // Note: Providers are NON-BLOCKING - only user + exchange can block
    blockingFactors: { user: !!user, exchange: isExchangeReady },
    nonBlockingFactors: { providers: isProvidersReady },
  }, null, 2));


  // Memoized component props to prevent unnecessary re-renders
  const engineControlsProps = useMemo(() => ({
    config,
    engineStatus,
    cooldownRemaining,
    setCooldownRemaining,
    exchangeConfig,
    providerConfig,
    isExchangeConnected: () => isExchangeReady, // Use local check
    updateEngineStatus,
    setAutoTradeStatus,
    setConfig,
    runSelfTest,
    isRunningDiagnostics,
    showToast,
    configsLoaded,
    isReady: isAutoTradeReady,
    autoTradeStatus,
    user, // Pass user for modal
  }), [config, engineStatus, cooldownRemaining, setCooldownRemaining, exchangeConfig, providerConfig, updateEngineStatus, setAutoTradeStatus, setConfig, runSelfTest, isRunningDiagnostics, showToast, configsLoaded, isAutoTradeReady, autoTradeStatus, isExchangeReady, user]);

  const statsProps = useMemo(() => ({
    performanceStats,
    tradeAccuracy,
    loadPerformanceStats,
    calculateTradeAccuracy: calculateTradeAccuracyFn,
    calculateTodayTrades: calculateTodayTradesFn,
    activityLogs,
    activeTrades,
  }), [performanceStats, tradeAccuracy, loadPerformanceStats, calculateTradeAccuracyFn, calculateTodayTradesFn, activityLogs, activeTrades]);

  const tradesProps = useMemo(() => ({
    activeTrades,
    activityLogs,
    loadLiveData,
    showToast,
  }), [activeTrades, activityLogs, loadLiveData, showToast]);

  const diagnosticsProps = useMemo(() => {
    // CRITICAL: Backend is SINGLE SOURCE OF TRUTH - NO frontend overrides
    // Use backendDiagnostics directly - it contains exchangeConnected computed using same logic as trading engine
    // If backend diagnostics not loaded yet, use safe defaults that indicate LOADING (not failed)

    const safeDiagnostics = backendDiagnostics || {
      providersReady: null, // null = unknown (loading), not false (failed)
      providerConfigTimeout: false,
      diagnostics: {
        marketDataReady: null, // null = unknown
        newsReady: null, // null = unknown
        // CRITICAL: undefined means LOADING, not failed
        exchangeConnected: undefined, // Backend hasn't responded yet
        exchangeReason: 'Checking exchange status...', // Show loading message
        userAuthenticated: !!user,
      },
    };

    // DEBUG: Log diagnostics state for troubleshooting (use JSON.stringify for console clarity)
    console.log("[AT_DIAGNOSTICS_PROPS]", JSON.stringify({
      backendDiagnosticsLoaded,
      providersReady: safeDiagnostics.providersReady,
      providerConfigTimeout: safeDiagnostics.providerConfigTimeout,
      exchangeConnected: safeDiagnostics.diagnostics.exchangeConnected,
      exchangeReason: safeDiagnostics.diagnostics.exchangeReason,
      source: backendDiagnosticsLoaded ? 'Backend (Authoritative)' : 'Loading...',
      // NO local config fallback
      noLocalFallback: true,
    }, null, 2));

    return {
      visible: diagnosticsVisible,
      onClose: () => setDiagnosticsVisible(false),
      results: safeDiagnostics, // Pass backend diagnostics directly
      backendDiagnostics: safeDiagnostics, // Pass backend diagnostics directly
      // REMOVED: isExchangeReadyByConfig - no local config fallback
      isConfigLoaded: backendDiagnosticsLoaded, // True once backend has responded
      runSelfTest,
      isRunning: isRunningDiagnostics,
      showToast,
    };
  }, [diagnosticsVisible, runSelfTest, isRunningDiagnostics, showToast, backendDiagnostics, user, backendDiagnosticsLoaded]);

  // Always render content like Research page - no global loading/error states

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-b from-[#0d1421] to-[#05070c] overflow-y-auto">
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 border-b border-blue-500/20 pb-3">
              <h1 className="text-4xl font-extrabold text-blue-200">
                Auto-Trade Engine
              </h1>

              <div className="flex items-center gap-3">
                {/* Auto-Trade Research History Icon - Only visible when autoTradeEnabled === true */}
                {config.autoTradeEnabled && (
                  <button
                    onClick={() => setShowAutoTradeHistoryModal(true)}
                    className="flex items-center gap-2 px-3 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-500/50 rounded-lg transition-colors text-green-200 font-medium"
                    title="View Auto-Trade research history"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <span className="text-sm">Research History</span>
                  </button>
                )}

                <button
                  onClick={async () => {
                    setIsRunningDiagnostics(true);
                    try {
                      const response = await autoTradeApi.runDiagnosticCheck();
                      setDiagnosticResults(response.data);
                      setDiagnosticsVisible(true);
                    } catch (err: any) {
                      showToast(err?.response?.data?.error || 'Failed to run diagnostic check', 'error');
                    } finally {
                      setIsRunningDiagnostics(false);
                    }
                  }}
                  disabled={isRunningDiagnostics}
                  className="flex items-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/50 rounded-lg transition-colors text-purple-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Run diagnostic check"
                >
                  {isRunningDiagnostics ? (
                    <>
                      <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-sm">Checking...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm">Diagnostic</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    setShowBalanceModal(true);
                    fetchBalance();
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 rounded-lg transition-colors text-blue-200 font-medium"
                >
                  <span className="text-xl">💰</span>
                  <span>Connect Proof</span>
                </button>
              </div>
            </div>

            {/* Engine Controls */}
            {/* UI is NEVER blocked - buttons are always clickable when exchange is connected */}
            <AutoTradeEngineControls {...engineControlsProps} />

            {/* Performance Stats */}
            <AutoTradeStats {...statsProps} />

            {/* Active Trades and History */}
            <AutoTradeTrades {...tradesProps} />

            {/* Auto-Trade Status */}
            <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
              <h2 className="text-xl font-semibold text-blue-200 mb-4">Auto-Trade Status</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-blue-100">Auto-Trade Status</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${autoTradeStatus?.enabled === true
                    ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                    : 'bg-red-600/40 text-red-300 border border-red-500/30'
                    }`}>
                    {autoTradeStatus?.enabled === true ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-blue-100">Background Research Loop</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.autoTradeEnabled
                    ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                    : 'bg-red-600/40 text-red-300 border border-red-500/30'
                    }`}>
                    {config.autoTradeEnabled ? 'Running' : 'Stopped'}
                  </span>
                </div>

                {/* Notification Settings Diagnostic */}
                <NotificationDiagnosticsSection config={config} />

                <div className="pt-2 border-t border-blue-500/20">
                  <p className="text-xs text-blue-100/60">
                    Research runs every 5 minutes when enabled.
                  </p>
                </div>
              </div>
            </div>

            {/* Cooldown / Limits Status */}
            {config.cooldownSeconds > 0 && (
              <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8 shadow-lg">
                <h2 className="text-xl font-semibold text-blue-200 mb-4">Cooldown & Limits</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-100">Cooldown Status</span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${cooldownRemaining > 0
                      ? 'bg-yellow-600/40 text-yellow-300 border border-yellow-500/30'
                      : 'bg-green-600/40 text-green-300 border border-green-500/30'
                      }`}>
                      {cooldownRemaining > 0 ? `${cooldownRemaining}s remaining` : 'Ready'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-blue-100">Daily Trades</span>
                    <span className="text-blue-100 text-sm">
                      {todayTrades}/{config.maxTradesPerDay || 50}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-blue-100">Concurrent Trades</span>
                    <span className="text-blue-100 text-sm">
                      {activeTrades.length}/{config.maxConcurrentTrades || 3}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Diagnostics Component */}
        <AutoTradeDiagnostics {...diagnosticsProps} />

        {/* Diagnostic Check Modal */}
        <AutoTradeDiagnosticModal
          visible={diagnosticsVisible}
          onClose={() => setDiagnosticsVisible(false)}
          results={diagnosticResults}
          isRunning={isRunningDiagnostics}
        />

        {/* Trade Skip Popup */}
        {skipPopupData && (
          <TradeSkipPopup
            isOpen={skipPopupData.isOpen}
            onClose={() => setSkipPopupData(prev => prev ? { ...prev, isOpen: false } : null)}
            data={{
              symbol: skipPopupData.symbol,
              accuracy: skipPopupData.accuracy,
              accuracyTrigger: skipPopupData.accuracyTrigger,
              skipReasons: skipPopupData.skipReasons,
              timestamp: skipPopupData.timestamp
            }}
          />
        )}

        <PendingTradeConfirmationModal
          isOpen={!!currentPendingTrade && config.autoTradeEnabled}
          trade={currentPendingTrade}
          onApprove={handleApproveTrade}
          onReject={handleRejectTrade}
          isProcessing={isProcessingTrade}
        />

        {/* Balance Proof Modal */}
        {showBalanceModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-[#1a1f2e] border border-blue-500/30 rounded-xl p-6 max-w-sm w-full shadow-2xl relative">
              <button
                onClick={() => setShowBalanceModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>

              <h3 className="text-xl font-bold text-blue-100 mb-6 flex items-center gap-2">
                <span className="text-2xl">💰</span> Real Exchange Balance
              </h3>

              {loadingBalance ? (
                <div className="flex flex-col items-center py-8">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-4"></div>
                  <p className="text-blue-200 text-sm animate-pulse">Fetching live balance from exchange...</p>
                </div>
              ) : balanceData?.error ? (
                <div className="text-red-300 bg-red-900/20 border border-red-500/30 p-4 rounded-lg mb-2">
                  <div className="font-semibold mb-1">Fetch Failed</div>
                  <div className="text-sm opacity-80">{balanceData.error}</div>
                </div>
              ) : balanceData ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center border-b border-gray-700/50 pb-3">
                    <span className="text-gray-400">Exchange</span>
                    <span className="text-white font-bold capitalize bg-blue-600/20 px-2 py-1 rounded text-sm border border-blue-500/30">{balanceData.exchange}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-gray-700/50 pb-3">
                    <span className="text-gray-400">Market Type</span>
                    <span className="text-blue-300 font-medium text-sm">{balanceData.marketType}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-gray-700/50 pb-3 bg-green-900/10 p-2 rounded -mx-2">
                    <span className="text-gray-300">Available ({balanceData.currency})</span>
                    <span className="text-green-400 font-bold text-xl">{balanceData.availableBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center border-b border-gray-700/50 pb-3">
                    <span className="text-gray-400">Total Equity</span>
                    <span className="text-white font-mono">{balanceData.totalBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-4 text-center font-mono">
                    VERIFIED LIVE • {new Date(balanceData.timestamp).toLocaleString()}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Auto-Trade Research History Modal */}
        {showAutoTradeHistoryModal && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
            <div className="bg-[#0a0f1a] border border-blue-500/20 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-blue-200">Auto-Trade Research History</h3>
                <button
                  onClick={() => setShowAutoTradeHistoryModal(false)}
                  className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {loadingAutoTradeHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
                  <span className="ml-3 text-blue-200">Loading research history...</span>
                </div>
              ) : autoTradeHistory.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400">No Auto-Trade research runs found.</p>
                  <p className="text-sm text-gray-500 mt-2">Research history will appear here once Auto-Trade executes research cycles.</p>
                </div>
              ) : (
                <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-blue-700 scrollbar-track-blue-900">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead>
                      <tr className="border-b border-blue-500/20">
                        <th className="text-left text-blue-100/60 py-2">SR</th>
                        <th className="text-left text-blue-100/60 py-2">Coin</th>
                        <th className="text-left text-blue-100/60 py-2">Accuracy</th>
                        <th className="text-left text-blue-100/60 py-2">Result / Trigger Status</th>
                        <th className="text-left text-blue-100/60 py-2">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autoTradeHistory.map((entry, index) => {
                        // TIME DISPLAY: Use timestamp from backend
                        const timestamp = entry.timestamp ? new Date(entry.timestamp) : null;
                        const timeAgo = timestamp
                          ? (() => {
                            const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
                            if (seconds < 60) return `${seconds}s ago`;
                            const minutes = Math.floor(seconds / 60);
                            if (minutes < 60) return `${minutes}m ago`;
                            const hours = Math.floor(minutes / 60);
                            if (hours < 24) return `${hours}h ago`;
                            const days = Math.floor(hours / 24);
                            return `${days}d ago`;
                          })()
                          : '--';
                        const absoluteTime = timestamp ? timestamp.toLocaleString() : '--';

                        // COIN (SYMBOL) DISPLAY RULES - Handle AUTO_TRADE records correctly
                        let coinDisplay = '--';
                        if (entry.source === 'AUTO_TRADE') {
                          // For AUTO_TRADE records: show symbol if non-empty, otherwise "—" or "N/A"
                          if (entry.symbol && typeof entry.symbol === 'string' && entry.symbol.trim().length > 0) {
                            coinDisplay = entry.symbol;
                          } else {
                            coinDisplay = '—'; // Never display cycleType or source as Coin name
                          }
                        } else {
                          // TELEGRAM logic (unchanged)
                          if (entry.symbol && entry.symbol.trim().length > 0) {
                            coinDisplay = entry.symbol;
                          }
                        }

                        // ACCURACY DISPLAY RULES - Handle AUTO_TRADE records correctly
                        let accuracyDisplay = '--';
                        const rawAccuracy = typeof entry.accuracy === 'number' ? entry.accuracy : null;
                        if (entry.source === 'AUTO_TRADE') {
                          // For AUTO_TRADE records, show accuracy whenever it's a valid number
                          // If skipped before accuracy calculation, show "0%" explicitly
                          if (rawAccuracy !== null) {
                            const normalizedAccuracy = rawAccuracy > 1 ? rawAccuracy : rawAccuracy * 100;
                            accuracyDisplay = `${normalizedAccuracy.toFixed(1)}%`;
                          } else {
                            accuracyDisplay = '0%';
                          }
                        } else {
                          // TELEGRAM logic (unchanged)
                          if (rawAccuracy !== null && rawAccuracy > 0) {
                            const normalizedAccuracy = rawAccuracy > 1 ? rawAccuracy : rawAccuracy * 100;
                            accuracyDisplay = `${normalizedAccuracy.toFixed(1)}%`;
                          } else if (rawAccuracy === 0 && entry.decision === 'SKIPPED') {
                            accuracyDisplay = 'Not Calculated';
                          } else if (rawAccuracy === 0 && entry.executionStatus === 'FAILED') {
                            accuracyDisplay = '0%';
                          }
                        }

                        // RESULT / STATUS COLUMN - Handle AUTO_TRADE vs TELEGRAM records correctly
                        let resultStatus = 'Completed'; // Default for entries without specific status

                        if (entry.source === 'AUTO_TRADE') {
                          // Quick display of backend text as requested
                          if (entry.status === 'SKIPPED') {
                            resultStatus = entry.skipReason || 'SKIPPED';
                          } else {
                            resultStatus = entry.status || 'UNKNOWN';
                          }
                        } else {
                          // TELEGRAM logic (unchanged)
                          if (entry.executionStatus === 'SUCCESS') {
                            resultStatus = 'Trade Executed';
                          } else if (entry.executionStatus === 'FAILED') {
                            resultStatus = 'Execution Failed';
                          } else if (entry.decision === 'SKIPPED') {
                            // Use skipReason to derive meaningful label
                            const skipReason = entry.skipReason || '';
                            switch (skipReason) {
                              case 'BACKGROUND_TASKS_PAUSED':
                                resultStatus = 'System Paused';
                                break;
                              case 'DUPLICATE_CYCLE':
                                resultStatus = 'Duplicate Cycle Skipped';
                                break;
                              case 'EXCHANGE_NOT_USABLE':
                                resultStatus = 'Exchange Not Usable';
                                break;
                              case 'ACCURACY_BELOW_THRESHOLD':
                                resultStatus = 'Accuracy Not Triggered';
                                break;
                              case 'NO_RESEARCH_RESULTS':
                                resultStatus = 'No Research Data';
                                break;
                              case 'CONFIG_LOAD_FAILED':
                                resultStatus = 'Config Load Failed';
                                break;
                              case 'AUTO_TRADE_DISABLED':
                                resultStatus = 'Auto-Trade Disabled';
                                break;
                              case 'NO_RESEARCH_KEYS':
                                resultStatus = 'Research Keys Missing';
                                break;
                              case 'NO_USABLE_PROVIDERS':
                                resultStatus = 'No Providers Available';
                                break;
                              case 'RESEARCH_FAILED':
                                resultStatus = 'Research Failed';
                                break;
                              case 'SYMBOL_OUTSIDE_TOP_25':
                                resultStatus = 'Symbol Outside Top 25';
                                break;
                              case 'INVALID_ACCURACY':
                                resultStatus = 'Invalid Accuracy';
                                break;
                              case 'SYSTEM_RISK_FAILURE':
                                resultStatus = 'Risk Limits Exceeded';
                                break;
                              case 'INVALID_SIGNAL':
                                resultStatus = 'Invalid Signal';
                                break;
                              case 'DYNAMIC_PARAMS_SKIP':
                                resultStatus = 'Params Calculation Failed';
                                break;
                              case 'EXECUTION_BLOCKED':
                                resultStatus = 'Execution Blocked';
                                break;
                              case 'MODE_VALIDATION_FAILED':
                                resultStatus = 'Mode Validation Failed';
                                break;
                              case 'LOW_RR_PRE_EXECUTION':
                                resultStatus = 'Low Risk-Reward';
                                break;
                              case 'INVALID_TP_LOGIC':
                                resultStatus = 'Invalid TP Logic';
                                break;
                              case 'TRADE_EXECUTION_FAILED':
                                resultStatus = 'Trade Execution Failed';
                                break;
                              case 'MISSING_FINAL_RESULT':
                                resultStatus = 'Missing Final Result';
                                break;
                              case 'RESEARCH_EXECUTION_FAILED':
                                resultStatus = 'Research Execution Failed';
                                break;
                              case 'RESEARCH_RESULT_MISSING':
                                resultStatus = 'Research Result Missing';
                                break;
                              case 'FINAL_GUARD_CACHED':
                                resultStatus = 'Cached Result';
                                break;
                              default:
                                resultStatus = 'Skipped';
                            }
                          } else if (entry.executionStatus === 'SUCCESS' || entry.decision === 'EXECUTED') {
                            resultStatus = 'Trade Executed';
                          }
                        }

                        // Ensure result status is never empty (use default if needed)
                        if (!resultStatus) {
                          resultStatus = 'Completed';
                        }

                        return (
                          <tr key={entry.id || index} className={`border-b border-blue-500/10 ${index % 2 === 0 ? 'bg-[#0d1421]' : 'bg-[#0b0f18]'} hover:bg-blue-900/20`}>
                            <td className="py-1 text-blue-100">{index + 1}</td>
                            <td className="py-1 text-blue-100 font-medium">{coinDisplay}</td>
                            <td className="py-1 text-blue-100">{accuracyDisplay}</td>
                            <td className="py-1 text-blue-100">{resultStatus}</td>
                            <td className="py-1 text-blue-100" title={absoluteTime}>{timeAgo}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowAutoTradeHistoryModal(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-blue-100 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}