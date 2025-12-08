import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { autoTradeApi, marketApi, settingsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePerformance';
import Toast from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { suppressConsoleError } from '../utils/errorHandler';

interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  maxConcurrentTrades: number;
  maxTradesPerDay: number;
  cooldownSeconds: number;
  panicStopEnabled: boolean;
  slippageBlocker: boolean;
  lastResearchAt: string | null;
  nextResearchAt: string | null;
}

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

interface PortfolioSnapshot {
  equity: number;
  freeMargin: number;
  usedMargin: number;
  todayPnL: number;
  totalPnL: number;
}

export default function AutoTrade() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false); // Never show global loading like Research page
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const isMountedRef = useRef(true);

  // Auto-trade state
  const [config, setConfig] = useState<AutoTradeConfig>({
    autoTradeEnabled: false,
    maxConcurrentTrades: 3,
    maxTradesPerDay: 50,
    cooldownSeconds: 30,
    panicStopEnabled: false,
    slippageBlocker: false,
    lastResearchAt: null,
    nextResearchAt: null,
  });

  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot>({
    equity: 0,
    freeMargin: 0,
    usedMargin: 0,
    todayPnL: 0,
    totalPnL: 0,
  });

  const [symbols, setSymbols] = useState<any[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [isExchangeConnected, setIsExchangeConnected] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'Running' | 'Paused' | 'Stopped' | 'Outside Hours'>('Stopped');

  // New auto-trade proposals and logs state
  const [proposals, setProposals] = useState<{ recentProposals?: any[] } | null>(null);
  const [autoTradeLogs, setAutoTradeLogs] = useState<any[]>([]);
  const [triggering, setTriggering] = useState(false);

  // Control sections state
  const [autoTradeControls, setAutoTradeControls] = useState({
    autoTradeEnabled: false,
    maxConcurrentTrades: 3,
    maxTradesPerDay: 50,
    perTradeRiskPct: 1.0,
    maxDailyLossPct: 5.0,
    stopLossPct: 2.0,
    takeProfitPct: 4.0,
    manualOverride: false,
    mode: 'AUTO' as 'AUTO' | 'MANUAL',
  });

  // Auto-trade loop status
  const [autoTradeStatus, setAutoTradeStatus] = useState({
    enabled: false,
    lastResearchAt: null as string | null,
    nextScheduledAt: null as string | null,
  });

  const loadProposals = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const response = await autoTradeApi.getProposals();
      if (isMountedRef.current) {
        setProposals(response.data && typeof response.data === 'object' ? response.data : { recentProposals: [] });
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadProposals');
    }
  }, [user]);

  const loadAutoTradeLogs = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const response = await autoTradeApi.getLogs(20);
      if (isMountedRef.current) {
        setAutoTradeLogs(Array.isArray(response.data?.logs) ? response.data.logs : []);
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeLogs');
    }
  }, [user]);

  const loadAutoTradeStatus = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const response = await settingsApi.trading.autotrade.status();
      if (isMountedRef.current) {
        setAutoTradeStatus(response?.data ?? {});
        // Also update the controls state to match
        setAutoTradeControls(prev => ({ ...prev, autoTradeEnabled: response?.data?.enabled ?? false }));
        setConfig(prev => ({ ...prev, autoTradeEnabled: response?.data?.enabled ?? false }));
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  }, [user]);

  const loadLiveData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      // Load all data asynchronously without Promise.all - no blocking
      const loadPromises = [
        autoTradeApi.getActiveTrades(50).then(tradesRes => {
          if (isMountedRef.current) {
            setActiveTrades(Array.isArray(tradesRes.data) ? tradesRes.data : []);
          }
        }).catch(err => {
          console.warn('Failed to load active trades:', err);
          if (isMountedRef.current) setActiveTrades([]);
        }),

        autoTradeApi.getActivity(50).then(activityRes => {
          if (isMountedRef.current) {
            setActivityLogs(Array.isArray(activityRes.data) ? activityRes.data : []);
          }
        }).catch(err => {
          console.warn('Failed to load activity logs:', err);
          if (isMountedRef.current) setActivityLogs([]);
        }),

        autoTradeApi.getProposals().then(proposalsRes => {
          if (isMountedRef.current) {
            setProposals(proposalsRes.data && typeof proposalsRes.data === 'object' ? proposalsRes.data : { recentProposals: [] });
          }
        }).catch(err => {
          console.warn('Failed to load proposals:', err);
          if (isMountedRef.current) setProposals({ recentProposals: [] });
        }),

        autoTradeApi.getLogs(20).then(logsRes => {
          if (isMountedRef.current) {
            setAutoTradeLogs(Array.isArray(logsRes.data?.logs) ? logsRes.data.logs : []);
          }
        }).catch(err => {
          console.warn('Failed to load logs:', err);
          if (isMountedRef.current) setAutoTradeLogs([]);
        }),
      ];

      // Fire all promises asynchronously without waiting
      loadPromises.forEach(promise => {
        promise.catch(err => {
          console.warn('[AUTOTRADE] Non-critical data load failed:', err);
        });
      });

      // Update engine status based on config and current time
      updateEngineStatus();
    } catch (error: any) {
      // Silent fail for live data to avoid spam
    }
  }, [user]);

  const loadAllData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      // Load config, symbols, and initial data in parallel with Promise.allSettled
      const [configRes, symbolsRes] = await Promise.allSettled([
        autoTradeApi.getConfig(),
        marketApi.getSymbols(),
      ]);

      // Handle results - continue even if some APIs fail
      if (configRes.status === 'fulfilled' && isMountedRef.current) {
        const configData = configRes.value.data;

        // DEFENSIVE: Check if backend returned success: false (database error)
        if (configData && configData.success === false) {
          console.warn('Auto-trade config load failed:', configData.message);
          // Show non-blocking warning toast but keep UI functional with defaults
          setToast({
            message: 'Auto-trade settings temporarily unavailable - using defaults',
            type: 'error'
          });
          setTimeout(() => setToast(null), 5000);
        }

        // DEFENSIVE: Fallback to defaults for any undefined/null values
        const safeConfig = {
          autoTradeEnabled: configData?.autoTradeEnabled ?? false,
          maxConcurrentTrades: configData?.maxConcurrentTrades ?? 3,
          maxTradesPerDay: configData?.maxTradesPerDay ?? 50,
          cooldownSeconds: configData?.cooldownSeconds ?? 30,
          panicStopEnabled: configData?.panicStopEnabled ?? false,
          slippageBlocker: configData?.slippageBlocker ?? false,
          lastResearchAt: configData?.lastResearchAt ?? null,
          nextResearchAt: configData?.nextResearchAt ?? null,
        };

        setConfig(safeConfig);

        // Set local state from safe config
        setAutoTradeControls({
          autoTradeEnabled: safeConfig.autoTradeEnabled,
          maxConcurrentTrades: safeConfig.maxConcurrentTrades,
          maxTradesPerDay: safeConfig.maxTradesPerDay,
          perTradeRiskPct: configData?.perTradeRiskPct ?? 1.0,
          maxDailyLossPct: configData?.maxDailyLossPct ?? 5.0,
          stopLossPct: configData?.stopLossPct ?? 2.0,
          takeProfitPct: configData?.takeProfitPct ?? 4.0,
          manualOverride: configData?.manualOverride ?? false,
          mode: configData?.mode ?? 'AUTO',
        });

        // Update auto-trade status
        setAutoTradeStatus({
          enabled: safeConfig.autoTradeEnabled,
          lastResearchAt: safeConfig.lastResearchAt,
          nextScheduledAt: safeConfig.nextResearchAt,
        });
      } else if (configRes.status === 'rejected') {
        suppressConsoleError(configRes.reason, 'loadAutoTradeConfig');
        // DEFENSIVE: On API failure, show warning but keep UI functional with defaults
        setToast({
          message: 'Unable to load auto-trade settings - check connection',
          type: 'error'
        });
        setTimeout(() => setToast(null), 5000);

        // Set safe defaults so UI doesn't break
        const defaultConfig = {
          autoTradeEnabled: false,
          maxConcurrentTrades: 3,
          maxTradesPerDay: 50,
          cooldownSeconds: 30,
          panicStopEnabled: false,
          slippageBlocker: false,
          lastResearchAt: null,
          nextResearchAt: null,
        };
        setConfig(defaultConfig);
        setAutoTradeControls({
          autoTradeEnabled: false,
          maxConcurrentTrades: 3,
          maxTradesPerDay: 50,
        });
        setAutoTradeStatus({
          enabled: false,
          lastResearchAt: null,
          nextScheduledAt: null,
        });
      }

      if (symbolsRes.status === 'fulfilled' && isMountedRef.current) {
        setSymbols(symbolsRes.value.data);
      } else if (symbolsRes.status === 'rejected') {
        suppressConsoleError(symbolsRes.reason, 'loadMarketSymbols');
        setSymbols([]); // Fallback to empty array
      }

      // Set default portfolio data since wallet API is not available
      if (isMountedRef.current) {
        setPortfolio({ equity: 0, freeMargin: 0, usedMargin: 0, todayPnL: 0, totalPnL: 0 });
      }

      // Try to load initial live data, but don't fail the whole load if it fails
      try {
        await loadLiveData();
      } catch (liveDataError) {
        suppressConsoleError(liveDataError, 'loadInitialLiveData');
      }

      setRetryCount(0); // Reset retry count on successful load

    } catch (error: any) {
      suppressConsoleError(error, 'loadAutoTradeData');
      if (isMountedRef.current) {
        setError(error);
        showToast('Failed to load auto-trade data', 'error');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, loadLiveData]);

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

  const updateEngineStatus = () => {
    if (!config.autoTradeEnabled) {
      setEngineStatus('Stopped');
    } else {
      setEngineStatus('Running');
    }
  };

  const isTimeInSchedule = (currentTime: string, days: number[], start: string, end: string) => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

    if (!days.includes(dayOfWeek)) return false;

    return currentTime >= start && currentTime <= end;
  };

  const handleAutoTradeToggle = async (enabled: boolean) => {
    if (!enabled || isExchangeConnected) {
      setSaving(true);
      try {
        const response = await settingsApi.trading.autotrade.toggle({ enabled });
        setAutoTradeStatus(prev => ({ ...prev, enabled: response?.data?.enabled ?? enabled }));
        setAutoTradeControls(prev => ({ ...prev, autoTradeEnabled: response?.data?.enabled ?? enabled }));
        setConfig(prev => ({ ...prev, autoTradeEnabled: response?.data?.enabled ?? enabled }));
        showToast(`Auto-Trade ${enabled ? 'started' : 'stopped'}`, 'success');
      } catch (error: any) {
        showToast('Failed to toggle auto-trade', 'error');
      } finally {
        setSaving(false);
      }
    } else {
      showToast('Exchange connection required', 'error');
    }
  };

  const handleSaveAutoTradeControls = async () => {
    setSaving(true);
    try {
      const updatedConfig = {
        // Basic controls
        autoTradeEnabled: autoTradeControls.autoTradeEnabled,
        maxConcurrentTrades: autoTradeControls.maxConcurrentTrades,
        maxTradesPerDay: autoTradeControls.maxTradesPerDay,
        cooldownSeconds: config.cooldownSeconds,
        panicStopEnabled: config.panicStopEnabled,
        slippageBlocker: config.slippageBlocker,

        // Risk management settings (with defaults)
        perTradeRiskPct: autoTradeControls.perTradeRiskPct || 1.0,
        maxDailyLossPct: autoTradeControls.maxDailyLossPct || 5.0,
        stopLossPct: autoTradeControls.stopLossPct || 2.0,
        takeProfitPct: autoTradeControls.takeProfitPct || 4.0,

        // Mode settings
        manualOverride: autoTradeControls.manualOverride || false,
        mode: autoTradeControls.mode || 'AUTO',
      };
      await autoTradeApi.updateConfig(updatedConfig);
      setConfig(prev => ({ ...prev, ...updatedConfig }));
      showToast('Auto-trade controls saved', 'success');
    } catch (error: any) {
      showToast('Failed to save controls', 'error');
    } finally {
      setSaving(false);
    }
  };


  const handleTriggerAutoTrade = useCallback(async (symbol?: string, dryRun: boolean = true) => {
    if (!user) return;
    setTriggering(true);
    try {
      const response = await autoTradeApi.trigger({ symbol, dryRun });
      const data = response?.data ?? {};

      if (data.success) {
        setToast({
          message: symbol
            ? `Auto-trade triggered for ${symbol} (${dryRun ? 'dry run' : 'live'})`
            : `Auto-trade cycle completed (${data.tradesExecuted || 0} trades executed)`,
          type: 'success'
        });
      } else {
        setToast({
          message: data.reason || 'Auto-trade failed',
          type: 'error'
        });
      }

      // Reload data
      await loadLiveData();
    } catch (err: any) {
      setToast({
        message: err.response?.data?.error || 'Failed to trigger auto-trade',
        type: 'error'
      });
    } finally {
      setTriggering(false);
    }
  }, [user, loadLiveData]);


  const handleCloseTrade = async (tradeId: string) => {
    setSaving(true);
    try {
      await autoTradeApi.closeTrade(tradeId);
      showToast('Trade close requested', 'success');
      // Refresh active trades
      const tradesRes = await autoTradeApi.getActiveTrades(50);
      setActiveTrades(tradesRes.data);
    } catch (error: any) {
      showToast('Failed to close trade', 'error');
    } finally {
      setSaving(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleRetry = useCallback(async () => {
    setRetryCount(prev => prev + 1);
    await loadAllData();
  }, [loadAllData]);

  const handleManageExchange = () => {
    navigate('/settings');
  };


  if (!user) return null;

  // Always render content like Research page - no global loading/error states

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 smooth-scroll">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      <main className="min-h-screen">
        <div className="container py-4 sm:py-8">
          {/* Header */}
          <section className="mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Auto-Trade
                </h1>
                <p className="text-gray-300">Advanced automated trading system</p>
              </div>
            </div>
          </section>

          {/* Top Row - Engine Status & Portfolio */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Engine & Connection Status */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Engine Status</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Status</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    engineStatus === 'Running' ? 'bg-green-500/20 text-green-300 border border-green-400/30' :
                    engineStatus === 'Outside Hours' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30' :
                    'bg-gray-500/20 text-gray-300 border border-gray-400/30'
                  }`}>
                    {engineStatus}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Auto-Trade</span>
                  <button
                    onClick={() => handleAutoTradeToggle(!autoTradeControls.enabled)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      autoTradeControls.enabled
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-gray-600 hover:bg-gray-700 text-white'
                    }`}
                    disabled={saving}
                  >
                    {autoTradeControls.enabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-gray-300">Exchange</span>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isExchangeConnected ? 'bg-green-400' : 'bg-red-400'}`}></span>
                    <button
                      onClick={handleManageExchange}
                      className="text-purple-400 hover:text-purple-300 text-sm underline"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Portfolio Snapshot */}
            <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-white mb-4">Portfolio Snapshot</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-400">Equity</div>
                  <div className="text-xl font-bold text-white">${portfolio.equity.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Free Margin</div>
                  <div className="text-xl font-bold text-green-400">${portfolio.freeMargin.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Used Margin</div>
                  <div className="text-xl font-bold text-orange-400">${portfolio.usedMargin.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Today's P&L</div>
                  <div className={`text-xl font-bold ${portfolio.todayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${portfolio.todayPnL.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content - Active Trades & Controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Left Column - Active Trades */}
            <div className="lg:col-span-2">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">Active Trades ({activeTrades.length})</h2>

                {loading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
                  </div>
                ) : !Array.isArray(activeTrades) || activeTrades.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    No active trades
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {activeTrades.map((trade) => (
                      <div key={trade.id} className="bg-slate-900/50 rounded-lg p-4 border border-purple-500/20">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 items-center">
                          <div>
                            <div className="text-sm text-gray-400">Symbol</div>
                            <div className="font-medium text-white">{trade.symbol}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-400">Side</div>
                            <div className={`font-medium ${trade.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                              {trade.side}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-400">Entry</div>
                            <div className="font-medium text-white">${trade.entryPrice.toFixed(4)}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-400">Current</div>
                            <div className="font-medium text-white">${trade.currentPrice.toFixed(4)}</div>
                          </div>
                          <div>
                            <div className="text-sm text-gray-400">P&L</div>
                            <div className={`font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              ${trade.pnl.toFixed(2)} ({trade.pnlPercent.toFixed(2)}%)
                            </div>
                          </div>
                          <div className="text-right">
                            <button
                              onClick={() => handleCloseTrade(trade.id)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                              disabled={saving}
                            >
                              Close
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 mt-3 pt-3 border-t border-purple-500/20">
                          <div>
                            <div className="text-xs text-gray-400">Accuracy</div>
                            <div className="text-sm text-white">{(trade.accuracyAtEntry * 100).toFixed(1)}%</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">Time</div>
                            <div className="text-sm text-white">{new Date(trade.entryTime).toLocaleTimeString()}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">Status</div>
                            <div className="text-sm text-green-400">{trade.status}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Controls */}
            <div className="space-y-6">
              {/* Section A: Auto-Trade Controls */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Auto-Trade Controls</h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Enable Auto-Trade</span>
                    <button
                      onClick={() => handleAutoTradeToggle(!autoTradeControls.autoTradeEnabled)}
                      disabled={saving}
                      className={`px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        autoTradeControls.autoTradeEnabled
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-gray-600 hover:bg-gray-700 text-white'
                      }`}
                    >
                      {saving ? '...' : (autoTradeControls.autoTradeEnabled ? 'ON' : 'OFF')}
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Max Concurrent Trades</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={autoTradeControls.maxConcurrentTrades}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, maxConcurrentTrades: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Max Trades Per Day</label>
                    <input
                      type="number"
                      min="1"
                      max="500"
                      value={autoTradeControls.maxTradesPerDay}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, maxTradesPerDay: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  {/* Risk Management Controls */}
                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Per Trade Risk (%)</label>
                    <input
                      type="number"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={autoTradeControls.perTradeRiskPct}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, perTradeRiskPct: parseFloat(e.target.value) || 1.0 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Max Daily Loss (%)</label>
                    <input
                      type="number"
                      min="0.5"
                      max="50"
                      step="0.5"
                      value={autoTradeControls.maxDailyLossPct}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, maxDailyLossPct: parseFloat(e.target.value) || 5.0 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Stop Loss (%)</label>
                    <input
                      type="number"
                      min="0.5"
                      max="10"
                      step="0.1"
                      value={autoTradeControls.stopLossPct}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, stopLossPct: parseFloat(e.target.value) || 2.0 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Take Profit (%)</label>
                    <input
                      type="number"
                      min="0.5"
                      max="20"
                      step="0.1"
                      value={autoTradeControls.takeProfitPct}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, takeProfitPct: parseFloat(e.target.value) || 4.0 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Cooldown Seconds</label>
                    <input
                      type="number"
                      min="0"
                      max="300"
                      value={config.cooldownSeconds}
                      onChange={(e) => setConfig(prev => ({ ...prev, cooldownSeconds: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="panicStopEnabled"
                      checked={config.panicStopEnabled}
                      onChange={(e) => setConfig(prev => ({ ...prev, panicStopEnabled: e.target.checked }))}
                      className="rounded"
                    />
                    <label htmlFor="panicStopEnabled" className="text-sm text-gray-300">Panic Stop Enabled</label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="slippageBlocker"
                      checked={config.slippageBlocker}
                      onChange={(e) => setConfig(prev => ({ ...prev, slippageBlocker: e.target.checked }))}
                      className="rounded"
                    />
                    <label htmlFor="slippageBlocker" className="text-sm text-gray-300">Slippage Blocker</label>
                  </div>

                  <button
                    onClick={handleSaveAutoTradeControls}
                    className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Controls'}
                  </button>
                </div>
              </div>

              {/* Section B: Auto-Trade Status */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-blue-500/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Auto-Trade Status</h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300">Background Research Loop</span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      config.autoTradeEnabled
                        ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                        : 'bg-red-500/20 text-red-300 border border-red-500/30'
                    }`}>
                      {config.autoTradeEnabled ? 'RUNNING' : 'STOPPED'}
                    </span>
                  </div>

                  {config.lastResearchAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300">Last Research</span>
                      <span className="text-sm text-blue-300">
                        {new Date(config.lastResearchAt).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {config.nextResearchAt && config.autoTradeEnabled && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-300">Next Research</span>
                      <span className="text-sm text-purple-300">
                        {new Date(config.nextResearchAt).toLocaleString()}
                      </span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/10">
                    <p className="text-xs text-gray-400">
                      Research runs every 5 minutes when auto-trade is enabled, using your trading settings.
                    </p>
                  </div>
                </div>
              </div>


              {/* Section D: Manual Overrides & Info */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Manual Controls</h3>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleAutoTradeToggle(true)}
                      className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
                      disabled={saving}
                    >
                      Start
                    </button>
                    <button
                      onClick={() => handleAutoTradeToggle(false)}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                      disabled={saving}
                    >
                      Stop
                    </button>
                  </div>

                  <div className="text-xs text-gray-400 mt-4">
                    <div className="text-yellow-400">
                      ⚠️ Trading involves risk. Use at your own discretion.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity - Combined Section */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Recent Activity</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => handleTriggerAutoTrade(undefined, true)}
                  disabled={triggering}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
                >
                  {triggering ? 'Running...' : 'Test Cycle'}
                </button>
                <button
                  onClick={() => handleTriggerAutoTrade(selectedSymbol || undefined, true)}
                  disabled={triggering || !selectedSymbol}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:opacity-50"
                >
                  {triggering ? 'Testing...' : `Test ${selectedSymbol || 'Symbol'}`}
                </button>
              </div>
            </div>

            {/* Cycle Info */}
            {proposals && (
              <div className="mb-4 text-sm text-gray-300 bg-slate-700/30 rounded p-3">
                <div>Last Cycle: {proposals.lastCycle ? new Date(proposals.lastCycle).toLocaleString() : 'Never'}</div>
                <div>Next Cycle: {proposals.nextCycle ? new Date(proposals.nextCycle).toLocaleString() : 'N/A'}</div>
              </div>
            )}

            {/* Combined Activity Feed */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {/* Recent Proposals */}
              {Array.isArray(proposals?.recentProposals) && proposals.recentProposals.length > 0 && (
                <>
                  {proposals.recentProposals.slice(0, 5).map((proposal: any, index: number) => (
                    <div key={`proposal-${index}`} className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg border border-purple-500/10">
                      <div className="w-8 h-8 rounded-lg bg-blue-600/50 flex items-center justify-center text-sm">
                        💡
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-white font-medium">
                          Trade Proposal: {proposal.symbol} {proposal.direction}
                        </div>
                        <div className="text-xs text-gray-400">
                          Entry: ${proposal.entryPrice.toFixed(2)} | Accuracy: {proposal.accuracy.toFixed(1)}% |
                          Size: {proposal.positionSize.toFixed(4)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(proposal.timestamp).toLocaleString()} |
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            proposal.executed ? 'bg-green-600/20 text-green-400' : 'bg-yellow-600/20 text-yellow-400'
                          }`}>
                            {proposal.executed ? 'Executed' : 'Proposed'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Activity Logs */}
              {Array.isArray(activityLogs) && activityLogs.length > 0 && (
                <>
                  {activityLogs.slice(0, 10).map((activity, index) => (
                    <div key={`activity-${index}`} className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg border border-purple-500/10">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-sm">
                        {activity.type.includes('TRADE_OPENED') && '📈'}
                        {activity.type.includes('TRADE_CLOSED') && '📉'}
                        {activity.type.includes('START') && '▶️'}
                        {activity.type.includes('STOP') && '⏹️'}
                        {activity.type.includes('PANIC') && '🚨'}
                        {!activity.type.includes('TRADE') && !activity.type.includes('START') && !activity.type.includes('STOP') && !activity.type.includes('PANIC') && '📝'}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-white">{activity.text}</div>
                        <div className="text-xs text-gray-400">{new Date(activity.ts).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Auto-Trade Logs */}
              {Array.isArray(autoTradeLogs) && autoTradeLogs.length > 0 && (
                <>
                  {autoTradeLogs.slice(0, 5).map((log: any, index: number) => (
                    <div key={`log-${index}`} className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg border border-purple-500/10">
                      <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-sm">
                        📊
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-white">{log.eventType?.replace(/_/g, ' ') || 'System Event'}</div>
                        {log.data?.reason && (
                          <div className="text-xs text-gray-400 mt-1">{log.data.reason}</div>
                        )}
                        <div className="text-xs text-gray-500">{new Date(log.timestamp).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* Empty State */}
              {(!Array.isArray(proposals?.recentProposals) || proposals.recentProposals.length === 0) &&
               (!Array.isArray(activityLogs) || activityLogs.length === 0) &&
               (!Array.isArray(autoTradeLogs) || autoTradeLogs.length === 0) && (
                <div className="text-center py-8 text-gray-400">
                  No recent activity
                </div>
              )}
            </div>
          </div>

          {/* Execution Summary */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Execution Summary</h2>

            {/* Active Trades Summary */}
            {Array.isArray(activeTrades) && activeTrades.length > 0 && (
              <div className="mb-6">
                <h3 className="text-md font-medium text-white mb-3">Active Positions</h3>
                <div className="space-y-3">
                  {activeTrades.slice(0, 5).map((trade, index) => (
                    <div key={index} className="bg-slate-700/50 rounded p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-sm text-white font-medium">
                            {trade.symbol} {trade.side} @ ${trade.entryPrice.toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-400">
                            P&L: ${trade.pnl.toFixed(2)} ({trade.pnlPercent.toFixed(2)}%) |
                            Current: ${trade.currentPrice.toFixed(2)}
                          </div>
                        </div>
                        <div className={`text-xs px-2 py-1 rounded ${
                          trade.pnl >= 0 ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                        }`}>
                          {trade.status}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(trade.entryTime).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Portfolio Summary */}
            <div className="bg-slate-700/30 rounded-lg p-4">
              <h3 className="text-md font-medium text-white mb-3">Portfolio Overview</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-lg font-bold text-white">${portfolio.equity.toFixed(2)}</div>
                  <div className="text-xs text-gray-400">Equity</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-white">${portfolio.freeMargin.toFixed(2)}</div>
                  <div className="text-xs text-gray-400">Free Margin</div>
                </div>
                <div>
                  <div className={`text-lg font-bold ${portfolio.todayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${portfolio.todayPnL.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400">Today's P&L</div>
                </div>
                <div>
                  <div className={`text-lg font-bold ${portfolio.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${portfolio.totalPnL.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400">Total P&L</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}
