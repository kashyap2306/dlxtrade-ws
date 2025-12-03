import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { autoTradeApi, marketApi, walletApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { usePolling } from '../hooks/usePerformance';
import Toast from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { suppressConsoleError } from '../utils/errorHandler';

interface AutoTradeConfig {
  enabled: boolean;
  maxConcurrentTrades: number;
  schedule: {
    start: string;
    end: string;
    days: number[];
  };
  maxDailyLoss: number;
  maxTradesPerDay: number;
  cooldownSeconds: number;
  consecutiveLossPauseCount: number;
  slippageBlocker: boolean;
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const isMountedRef = useRef(true);

  // Auto-trade state
  const [config, setConfig] = useState<AutoTradeConfig>({
    enabled: false,
    maxConcurrentTrades: 3,
    schedule: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    maxDailyLoss: 100,
    maxTradesPerDay: 50,
    cooldownSeconds: 30,
    consecutiveLossPauseCount: 3,
    slippageBlocker: false,
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
    enabled: false,
    maxConcurrentTrades: 3,
    maxTradesPerDay: 50,
  });

  const [scheduleConfig, setScheduleConfig] = useState({
    start: "09:00",
    end: "17:00",
    days: [1, 2, 3, 4, 5],
    run24_7: false,
  });

  const [safetyConfig, setSafetyConfig] = useState({
    cooldownSeconds: 30,
    consecutiveLossPauseCount: 3,
    slippageBlocker: false,
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

  const loadLiveData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const [tradesRes, activityRes, proposalsRes, logsRes] = await Promise.all([
        autoTradeApi.getActiveTrades(50),
        autoTradeApi.getActivity(50),
        autoTradeApi.getProposals(),
        autoTradeApi.getLogs(20),
      ]);

      if (isMountedRef.current) {
        setActiveTrades(Array.isArray(tradesRes.data) ? tradesRes.data : []);
        setActivityLogs(Array.isArray(activityRes.data) ? activityRes.data : []);
        setProposals(proposalsRes.data && typeof proposalsRes.data === 'object' ? proposalsRes.data : { recentProposals: [] });
        setAutoTradeLogs(Array.isArray(logsRes.data?.logs) ? logsRes.data.logs : []);
        // Update engine status based on config and current time
        updateEngineStatus();
      }
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
        setConfig(configRes.value.data);

        // Set local state from config
        setAutoTradeControls({
          enabled: configRes.value.data.enabled,
          maxConcurrentTrades: configRes.value.data.maxConcurrentTrades,
          maxTradesPerDay: configRes.value.data.maxTradesPerDay,
        });

        setScheduleConfig({
          start: configRes.value.data.schedule.start,
          end: configRes.value.data.schedule.end,
          days: configRes.value.data.schedule.days,
          run24_7: false, // Calculate from schedule
        });

        setSafetyConfig({
          cooldownSeconds: configRes.value.data.cooldownSeconds,
          consecutiveLossPauseCount: configRes.value.data.consecutiveLossPauseCount,
          slippageBlocker: configRes.value.data.slippageBlocker,
        });
      } else if (configRes.status === 'rejected') {
        suppressConsoleError(configRes.reason, 'loadAutoTradeConfig');
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

  // Use centralized polling for live data (30 second intervals when visible)
  usePolling(loadLiveData, 30000, !!user);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateEngineStatus = () => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    if (!config.enabled) {
      setEngineStatus('Stopped');
    } else if (scheduleConfig.run24_7) {
      setEngineStatus('Running');
    } else {
      const isInSchedule = isTimeInSchedule(currentTime, scheduleConfig.days, scheduleConfig.start, scheduleConfig.end);
      setEngineStatus(isInSchedule ? 'Running' : 'Outside Hours');
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
        await autoTradeApi.toggle(enabled);
        setAutoTradeControls(prev => ({ ...prev, enabled }));
        setConfig(prev => ({ ...prev, enabled }));
        showToast(`Auto-Trade ${enabled ? 'enabled' : 'disabled'}`, 'success');
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
        ...config,
        enabled: autoTradeControls.enabled,
        maxConcurrentTrades: autoTradeControls.maxConcurrentTrades,
        maxTradesPerDay: autoTradeControls.maxTradesPerDay,
      };
      await autoTradeApi.updateConfig(updatedConfig);
      setConfig(updatedConfig);
      showToast('Auto-trade controls saved', 'success');
    } catch (error: any) {
      showToast('Failed to save controls', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSaving(true);
    try {
      const updatedConfig = {
        ...config,
        schedule: scheduleConfig.run24_7 ? {
          start: "00:00",
          end: "23:59",
          days: [0, 1, 2, 3, 4, 5, 6]
        } : {
          start: scheduleConfig.start,
          end: scheduleConfig.end,
          days: scheduleConfig.days,
        }
      };
      await autoTradeApi.updateConfig(updatedConfig);
      setConfig(updatedConfig);
      showToast('Schedule saved', 'success');
    } catch (error: any) {
      showToast('Failed to save schedule', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSafety = async () => {
    setSaving(true);
    try {
      const updatedConfig = {
        ...config,
        cooldownSeconds: safetyConfig.cooldownSeconds,
        consecutiveLossPauseCount: safetyConfig.consecutiveLossPauseCount,
        slippageBlocker: safetyConfig.slippageBlocker,
      };
      await autoTradeApi.updateConfig(updatedConfig);
      setConfig(updatedConfig);
      showToast('Safety settings saved', 'success');
    } catch (error: any) {
      showToast('Failed to save safety settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerAutoTrade = useCallback(async (symbol?: string, dryRun: boolean = true) => {
    if (!user) return;
    setTriggering(true);
    try {
      const response = await autoTradeApi.trigger({ symbol, dryRun });
      const data = response.data;

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

  const handlePanicStop = async () => {
    if (confirm('Are you sure you want to activate emergency stop? This will immediately disable auto-trading.')) {
      setSaving(true);
      try {
        await autoTradeApi.panicStop('Emergency stop activated from UI');
        setAutoTradeControls(prev => ({ ...prev, enabled: false }));
        setConfig(prev => ({ ...prev, enabled: false }));
        showToast('Emergency stop activated', 'success');
      } catch (error: any) {
        showToast('Failed to activate emergency stop', 'error');
      } finally {
        setSaving(false);
      }
    }
  };

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

  const handleForceScan = async () => {
    setSaving(true);
    try {
      await autoTradeApi.forceScan();
      showToast('Market scan triggered', 'success');
    } catch (error: any) {
      showToast('Failed to trigger scan', 'error');
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

  const getNextScheduledRun = () => {
    if (scheduleConfig.run24_7) return 'Running 24/7';

    const now = new Date();
    const today = now.getDay();

    // Find next trading day
    let nextDay = today;
    let daysAhead = 0;
    while (!scheduleConfig.days.includes(nextDay) && daysAhead < 7) {
      nextDay = (nextDay + 1) % 7;
      daysAhead++;
    }

    if (daysAhead === 7) return 'No schedule set';

    const nextRun = new Date(now);
    nextRun.setDate(now.getDate() + daysAhead);
    nextRun.setHours(parseInt(scheduleConfig.start.split(':')[0]));
    nextRun.setMinutes(parseInt(scheduleConfig.start.split(':')[1]));

    return nextRun.toLocaleString();
  };


  if (!user) return null;

  // Show loading state
  if (loading && retryCount === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 smooth-scroll">
        <Sidebar onLogout={() => {}} />
        <main className="min-h-screen">
          <div className="container py-4 sm:py-8">
            <LoadingState message="Loading auto-trade data..." />
          </div>
        </main>
      </div>
    );
  }

  // Show error state with retry option
  if (error && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 smooth-scroll">
        <Sidebar onLogout={() => {}} />
        <main className="min-h-screen">
          <div className="container py-4 sm:py-8">
            <ErrorState
              error={error}
              onRetry={handleRetry}
              message={`Failed to load auto-trade data${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`}
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 smooth-scroll">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
      </div>

      <Sidebar onLogout={() => {}} />

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
                      onClick={() => setAutoTradeControls(prev => ({ ...prev, enabled: !prev.enabled }))}
                      className={`px-4 py-2 rounded-lg font-medium transition-all ${
                        autoTradeControls.enabled
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-gray-600 hover:bg-gray-700 text-white'
                      }`}
                    >
                      {autoTradeControls.enabled ? 'ON' : 'OFF'}
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
                      max="100"
                      value={autoTradeControls.maxTradesPerDay}
                      onChange={(e) => setAutoTradeControls(prev => ({ ...prev, maxTradesPerDay: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
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

              {/* Section B: Schedule */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Trading Schedule</h3>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="run24_7"
                      checked={scheduleConfig.run24_7}
                      onChange={(e) => setScheduleConfig(prev => ({ ...prev, run24_7: e.target.checked }))}
                      className="rounded"
                    />
                    <label htmlFor="run24_7" className="text-sm text-gray-300">Run 24/7</label>
                  </div>

                  {!scheduleConfig.run24_7 && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-gray-300 mb-2">Start Time</label>
                          <input
                            type="time"
                            value={scheduleConfig.start}
                            onChange={(e) => setScheduleConfig(prev => ({ ...prev, start: e.target.value }))}
                            className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-2">End Time</label>
                          <input
                            type="time"
                            value={scheduleConfig.end}
                            onChange={(e) => setScheduleConfig(prev => ({ ...prev, end: e.target.value }))}
                            className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm text-gray-300 mb-2">Trading Days</label>
                        <div className="grid grid-cols-7 gap-1">
                          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                            <button
                              key={index}
                              onClick={() => {
                                const newDays = scheduleConfig.days.includes(index)
                                  ? scheduleConfig.days.filter(d => d !== index)
                                  : [...scheduleConfig.days, index];
                                setScheduleConfig(prev => ({ ...prev, days: newDays.sort() }));
                              }}
                              className={`p-2 text-sm rounded ${
                                scheduleConfig.days.includes(index)
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-slate-700 text-gray-400'
                              }`}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  <div className="text-sm text-gray-400">
                    Next scheduled run: {getNextScheduledRun()}
                  </div>

                  <button
                    onClick={handleSaveSchedule}
                    className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Schedule'}
                  </button>
                </div>
              </div>

              {/* Section C: Safety & Risk Controls */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Safety & Risk Controls</h3>

                <div className="space-y-4">
                  <button
                    onClick={handlePanicStop}
                    className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all disabled:opacity-50"
                    disabled={saving}
                  >
                    🚨 PANIC STOP
                  </button>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Cooldown Seconds</label>
                    <input
                      type="number"
                      min="0"
                      max="300"
                      value={safetyConfig.cooldownSeconds}
                      onChange={(e) => setSafetyConfig(prev => ({ ...prev, cooldownSeconds: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-300 mb-2">Pause After N Losing Trades</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={safetyConfig.consecutiveLossPauseCount}
                      onChange={(e) => setSafetyConfig(prev => ({ ...prev, consecutiveLossPauseCount: parseInt(e.target.value) || 1 }))}
                      className="w-full px-3 py-2 bg-slate-900/50 border border-purple-500/30 rounded-lg text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="slippageBlocker"
                      checked={safetyConfig.slippageBlocker}
                      onChange={(e) => setSafetyConfig(prev => ({ ...prev, slippageBlocker: e.target.checked }))}
                      className="rounded"
                    />
                    <label htmlFor="slippageBlocker" className="text-sm text-gray-300">Slippage/Spread Blocker</label>
                  </div>

                  <button
                    onClick={handleSaveSafety}
                    className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50"
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Safety Settings'}
                  </button>
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

                  <button
                    onClick={handleForceScan}
                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                    disabled={saving}
                  >
                    Force Market Scan
                  </button>

                  <div className="text-xs text-gray-400 mt-4">
                    <div>Last scan: {new Date().toLocaleTimeString()}</div>
                    <div className="mt-1 text-yellow-400">
                      ⚠️ Trading involves risk. Use at your own discretion.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom - Recent Activity */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">Recent Activity</h2>

            {!Array.isArray(activityLogs) || activityLogs.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No recent activity
              </div>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {activityLogs.map((activity, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 bg-slate-900/30 rounded-lg border border-purple-500/10">
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
              </div>
            )}
          </div>

          {/* Section: Auto-Trade Proposals & Logs */}
          <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Auto-Trade Analysis</h3>
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

            {proposals && (
              <div className="mb-4 text-sm text-gray-300">
                <div>Last Cycle: {proposals.lastCycle ? new Date(proposals.lastCycle).toLocaleString() : 'Never'}</div>
                <div>Next Cycle: {proposals.nextCycle ? new Date(proposals.nextCycle).toLocaleString() : 'N/A'}</div>
              </div>
            )}

            {/* Recent Proposals */}
            {Array.isArray(proposals?.recentProposals) && proposals.recentProposals.length > 0 && (
              <div className="mb-6">
                <h4 className="text-md font-medium text-white mb-2">Recent Proposals</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {proposals.recentProposals.map((proposal: any, index: number) => (
                    <div key={index} className="bg-slate-700/50 rounded p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="text-sm text-white font-medium">
                            {proposal.symbol} {proposal.direction} @ ${proposal.entryPrice.toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-400">
                            Accuracy: {proposal.accuracy.toFixed(1)}% |
                            Size: {proposal.positionSize.toFixed(4)} |
                            SL: ${proposal.stopLoss.toFixed(2)} |
                            TP: ${proposal.takeProfit.toFixed(2)}
                          </div>
                        </div>
                        <div className={`text-xs px-2 py-1 rounded ${
                          proposal.executed ? 'bg-green-600' : 'bg-yellow-600'
                        }`}>
                          {proposal.executed ? 'Executed' : 'Proposed'}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(proposal.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-Trade Logs */}
            {Array.isArray(autoTradeLogs) && autoTradeLogs.length > 0 && (
              <div>
                <h4 className="text-md font-medium text-white mb-2">Activity Logs</h4>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {autoTradeLogs.slice(0, 10).map((log: any, index: number) => (
                    <div key={index} className="text-xs bg-slate-700/30 rounded p-2">
                      <div className="flex justify-between">
                        <span className="text-gray-300">{log.eventType?.replace(/_/g, ' ')}</span>
                        <span className="text-gray-500">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {log.data?.reason && (
                        <div className="text-gray-400 mt-1">{log.data.reason}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}
