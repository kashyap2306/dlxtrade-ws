import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePerformance';
import { useAutoTradeConfig } from '../hooks/useAutoTradeConfig';
import { AutoTradeEngineControls } from '../components/AutoTradeEngineControls';
import { AutoTradeDiagnostics } from '../components/AutoTradeDiagnostics';
import { AutoTradeStats } from '../components/AutoTradeStats';
import { AutoTradeTrades } from '../components/AutoTradeTrades';
import Toast from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { usersApi } from '../services/api';

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
  } = useAutoTradeConfig(user);

  useEffect(() => {
    console.log("[AT_RERENDER] configsLoaded changed:", configsLoaded);
  }, [configsLoaded]);

  // Memoized toast function
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // State for diagnostics and modals (moved from hook to keep in main component)
  const [diagnosticResults, setDiagnosticResults] = useState<any>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);

  const runDiagnostics = async () => {
    const timestamp = new Date().toISOString();

    const fallback = {
      timestamp,
      exchange: { status: 'FAIL', reason: 'Missing exchange configuration' },
      marketData: { status: 'FAIL', reason: 'Missing market data provider' },
      news: { status: 'FAIL', reason: 'Missing news provider' },
    };

    try {
      const currentExchangeConfig = exchangeConfig || {};
      const resolvedExchange = resolveExchangeName(currentExchangeConfig);
      const exchangeConnected = isExchangeConnected(currentExchangeConfig);

      let verifiedExchange = currentExchangeConfig;
      if (!exchangeConnected && user?.uid) {
        try {
          const latest = await usersApi.getExchangeConfig(user.uid);
          verifiedExchange = latest?.data || currentExchangeConfig;
        } catch {
          // silent fallback
        }
      }

      const finalExchangeConnected = isExchangeConnected(verifiedExchange);

      const resolveFirstEnabledProvider = (bucket: Record<string, any>) => {
        const values = Object.values(bucket || {});
        return values.find((p: any) => p && p.enabled && typeof p.apiKey === 'string' && p.apiKey.trim().length > 0) as any;
      };

      const marketProvider = resolveFirstEnabledProvider(providerConfig?.marketData || {});
      const marketKey = (marketProvider as any)?.apiKey as string | undefined;
      const marketPass = !!(marketProvider && (marketProvider as any).enabled && typeof marketKey === 'string' && marketKey.trim().length > 0);

      const newsProvider = resolveFirstEnabledProvider(providerConfig?.news || {});
      const newsKey = (newsProvider as any)?.apiKey as string | undefined;
      const newsPass = !!(newsProvider && (newsProvider as any).enabled && typeof newsKey === 'string' && newsKey.trim().length > 0);

      console.log("PROVIDER_CONFIG_FINAL", providerConfig);
      console.log("MARKET_DATA_KEYS", Object.keys(providerConfig?.marketData || {}));

      return {
        timestamp,
        exchange: {
          status: finalExchangeConnected ? 'PASS' : 'FAIL',
          exchange: resolveExchangeName(verifiedExchange),
          reason: finalExchangeConnected ? 'Configuration detected' : 'No valid exchange configuration',
        },
        marketData: {
          status: marketPass ? 'PASS' : 'FAIL',
          provider: (marketProvider as any)?.providerName || 'N/A',
          reason: marketPass ? 'API key present' : 'Missing or disabled market data key',
        },
        news: {
          status: newsPass ? 'PASS' : 'FAIL',
          provider: (newsProvider as any)?.providerName || 'N/A',
          reason: newsPass ? 'API key present' : 'Missing or disabled news key',
        },
      };
    } catch (err: any) {
      return {
        ...fallback,
        error: err?.message,
      };
    }
  };

  const runSelfTest = async () => {
    console.log("[RUN SELF TEST CLICKED]");
    setDiagnosticsVisible(true);
    setDiagnosticResults(null);
    setIsRunningDiagnostics(true);
    try {
      const result = await runDiagnostics();
      setDiagnosticResults(result);
      return result;
    } catch (err: any) {
      const fallback = {
        timestamp: new Date().toISOString(),
        exchange: { status: 'FAIL', reason: err?.message || 'Diagnostics failed' },
        marketData: { status: 'FAIL', reason: err?.message || 'Diagnostics failed' },
        news: { status: 'FAIL', reason: err?.message || 'Diagnostics failed' },
      };
      setDiagnosticResults(fallback);
      return fallback;
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  // Auto-enable when exchange is connected
  useEffect(() => {
    if (user && exchangeConfig && config) {
      const canEnableAutoTrade = exchangeConfig?.apiKey === "[ENCRYPTED]"
          || exchangeConfig?.secret === "[ENCRYPTED]"
          || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);

      if (canEnableAutoTrade && !config.autoTradeEnabled) {
        // Auto-enable logic would go here, but we moved it to the component
      }
    }
  }, [user, exchangeConfig, config]);

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

  // Use centralized polling for live data (30 second intervals when visible)
  usePolling(loadLiveData, 60000, !!user); // Reduced to 1 minute

  // Load auto-trade status on mount and periodically
  useEffect(() => {
    if (user) {
      loadAutoTradeStatus();
      // Refresh status every 30 seconds
      const interval = setInterval(loadAutoTradeStatus, 60000); // Reduced to 1 minute
      return () => clearInterval(interval);
    }
  }, [user, loadAutoTradeStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // DEBUG: Log all state values at render time
  // Determine readiness based on provider keys and exchange connectivity
  const isReady = true;

  console.log("[DEBUG] AutoTrade runtime state", {
    configsLoaded,
    providerConfig,
    exchangeConfig,
    user: !!user,
  });

  console.log("[AT] Runtime state:", { configsLoaded, providerConfig, exchangeConfig, user });
  console.log("[AT_RUNTIME_STATE]", {
    configsLoaded,
  });
  console.log("CURRENT PROVIDER CONFIG FULL:", JSON.stringify(providerConfig, null, 2));
  console.log("[AUTO-TRADE READY - FINAL VERIFICATION]", {
    configsLoaded,
    providerConfig,
    exchangeConfig,
    user: !!user,
    ready: isReady,
  });

  // Memoized component props to prevent unnecessary re-renders
  const engineControlsProps = useMemo(() => ({
    config,
    engineStatus,
    cooldownRemaining,
    setCooldownRemaining,
    exchangeConfig,
    providerConfig,
    isExchangeConnected,
    updateEngineStatus,
    setAutoTradeStatus,
    setConfig,
    runSelfTest,
    isRunningDiagnostics,
    showToast,
  }), [config, engineStatus, cooldownRemaining, setCooldownRemaining, exchangeConfig, providerConfig, isExchangeConnected, updateEngineStatus, setAutoTradeStatus, setConfig, runSelfTest, isRunningDiagnostics, showToast]);

  const statsProps = useMemo(() => ({
    performanceStats,
    tradeAccuracy,
    loadPerformanceStats,
    calculateTradeAccuracy: calculateTradeAccuracyFn,
    calculateTodayTrades: calculateTodayTradesFn,
    activityLogs,
  }), [performanceStats, tradeAccuracy, loadPerformanceStats, calculateTradeAccuracyFn, calculateTodayTradesFn, activityLogs]);

  const tradesProps = useMemo(() => ({
    activeTrades,
    activityLogs,
    loadLiveData,
    showToast,
  }), [activeTrades, activityLogs, loadLiveData, showToast]);

  const diagnosticsProps = useMemo(() => ({
    visible: diagnosticsVisible,
    onClose: () => setDiagnosticsVisible(false),
    results: diagnosticResults,
    runSelfTest,
    isRunning: isRunningDiagnostics,
    showToast,
  }), [diagnosticsVisible, diagnosticResults, runSelfTest, isRunningDiagnostics, showToast]);

  // Always render content like Research page - no global loading/error states

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-gradient-to-b from-[#0d1421] to-[#05070c] overflow-y-auto">
      <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <h1 className="text-4xl font-extrabold text-blue-200 mb-10 border-b border-blue-500/20 pb-3">
            Auto-Trade Engine
          </h1>

            {/* Engine Controls */}
            {!configsLoaded && (
              <div className="p-2 text-yellow-400 text-sm">Loading core configuration…</div>
            )}
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
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  (() => {
                    const isAutoTradeEnabled = () => {
                      return exchangeConfig?.apiKey === "[ENCRYPTED]"
                          || exchangeConfig?.secret === "[ENCRYPTED]"
                          || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);
                    };
                    const canEnable = isAutoTradeEnabled();
                    return canEnable
                      ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                      : 'bg-red-600/40 text-red-300 border border-red-500/30';
                  })()
                }`}>
                  {(() => {
                    const isAutoTradeEnabled = () => {
                      return exchangeConfig?.apiKey === "[ENCRYPTED]"
                          || exchangeConfig?.secret === "[ENCRYPTED]"
                          || (exchangeConfig?.apiKeyEncrypted && exchangeConfig?.secretEncrypted);
                    };
                    return isAutoTradeEnabled() ? 'ENABLED' : 'DISABLED';
                  })()}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-blue-100">Background Research Loop</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  config.autoTradeEnabled
                    ? 'bg-green-600/40 text-green-300 border border-green-500/30'
                    : 'bg-red-600/40 text-red-300 border border-red-500/30'
                }`}>
                  {config.autoTradeEnabled ? 'Running' : 'Stopped'}
                </span>
              </div>

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
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    cooldownRemaining > 0
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

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
    </ErrorBoundary>
  );
}