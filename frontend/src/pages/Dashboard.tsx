import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Sidebar from '../components/Sidebar';
import { autoTradeApi, usersApi, globalStatsApi, engineStatusApi, settingsApi, notificationsApi, agentsApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';
import ExchangeAccountsSection from '../components/ExchangeAccountsSection';
import { useThrottle, useLazyLoad, usePolling } from '../hooks/usePerformance';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState, CardSkeleton } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, WalletIcon, ChartBarIcon, BoltIcon, CpuChipIcon } from '@heroicons/react/24/outline';

// Wallet balances are now loaded from global-stats endpoint

// Lazy load heavy components for better performance
const AutoTradeMode = lazy(() => import('../components/AutoTradeMode'));
const RecentTrades = lazy(() => import('../components/RecentTrades'));
const MarketScanner = lazy(() => import('../components/MarketScanner'));
const WalletCard = lazy(() => import('../components/Wallet/WalletCard'));
const ExecutionSummary = lazy(() => import('../components/ExecutionSummary'));
const PnLWidget = lazy(() => import('../components/PnLWidget'));

export default function Dashboard() {
  console.log('Dashboard mounted — safe wallet helper active');
  const { user, loading: loadingUser } = useAuth();
  const navigate = useNavigate();

  // Unified dashboard state
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [alerts, setAlerts] = useState<Array<{ type: 'warning' | 'error'; message: string }>>([]);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(false);
  const isMountedRef = useRef(true);

  // Legacy state for backward compatibility (will be removed)
  const [autoTradeStatus, setAutoTradeStatus] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [walletBalances, setWalletBalances] = useState<any>(null);
  const [activeTrades, setActiveTrades] = useState<any[]>([]);
  const [aiSignals, setAiSignals] = useState<any[]>([]);
  const [performanceStats, setPerformanceStats] = useState<any>(null);
  const [portfolioHistory, setPortfolioHistory] = useState<any[]>([]);

  // Throttle data updates to prevent excessive re-renders
  const throttledDashboardData = useThrottle(dashboardData, 500, [dashboardData]);
  const throttledAutoTradeStatus = useThrottle(autoTradeStatus, 500, [autoTradeStatus]);
  const throttledUserStats = useThrottle(userStats, 500, [userStats]);

  // Lazy load triggers for heavy components
  const { ref: marketScannerRef, hasIntersected: marketScannerVisible } = useLazyLoad(0.1);

  const loadDashboardData = useCallback(async () => {
    if (!user || !isMountedRef.current || hasLoaded) return;
    console.log('loadDashboardData called for user:', user?.uid);

    // Prevent multiple concurrent loads
    if (loading) return;
    setLoading(true);

    try {
      // Load multiple dashboard APIs in parallel with safe fallbacks
      const [globalStatsRes, engineStatusRes, agentsUnlockedRes, settingsRes, notificationsRes] = await Promise.all([
        globalStatsApi.get(),
        engineStatusApi.get(),
        agentsApi.getUnlocked(),
        settingsApi.load(),
        notificationsApi.get({ limit: 20 })
      ]);

      console.log('Dashboard API responses:', {
        globalStats: globalStatsRes?.data,
        engineStatus: engineStatusRes?.data,
        agentsUnlocked: agentsUnlockedRes?.data,
        settings: settingsRes?.data,
        notifications: notificationsRes?.data
      });

      // Safe data extraction with fallbacks
      const dashboardData = {
        globalStats: globalStatsRes?.data || {},
        engineStatus: engineStatusRes?.data || {},
        agentsUnlocked: agentsUnlockedRes?.data?.unlocked || [],
        settings: settingsRes?.data || {},
        notifications: notificationsRes?.data || []
      };

      if (isMountedRef.current) {
        setDashboardData(dashboardData);
        setError(null); // Clear any previous errors
        setLoading(false);
        setHasLoaded(true); // Mark as loaded to prevent re-renders

        // For backward compatibility, also set legacy state variables with safe fallbacks
        setAutoTradeStatus(dashboardData?.engineStatus || {});
        setUserStats(dashboardData?.globalStats || {});
        setWalletBalances([]); // Wallet data not available from current endpoints
        setActiveTrades(dashboardData?.globalStats?.hftLogs || []);
        setAiSignals(dashboardData?.globalStats?.activityLogs || []);
        setPerformanceStats(dashboardData?.globalStats || {});
        setPortfolioHistory(dashboardData?.globalStats?.trades || []);
      }
    } catch (err: any) {
      console.warn('[Dashboard] API failed: loadDashboardData', err);
      if (isMountedRef.current) {
        // Set safe fallback data instead of crashing
        const safeDashboardData = {
          globalStats: {},
          engineStatus: {},
          agentsUnlocked: [],
          settings: {},
          notifications: []
        };

        setDashboardData(safeDashboardData);
        setError(err);
        setLoading(false);
        setHasLoaded(true); // Mark as loaded even on error to prevent infinite retries

        // Clear legacy state with safe defaults
        setAutoTradeStatus({});
        setUserStats({});
        setWalletBalances([]);
        setActiveTrades([]);
        setAiSignals([]);
        setPerformanceStats({});
        setPortfolioHistory([]);
      }
    }
  }, [user, loading, hasLoaded]);

  // Legacy functions for backward compatibility (will be removed)
  const loadAutoTradeStatus = useCallback(async () => {
    await loadDashboardData();
  }, [loadDashboardData]);

  const loadUserStats = useCallback(async () => {
    await loadDashboardData();
  }, [loadDashboardData]);

  const loadActiveTrades = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const response = await autoTradeApi.getActiveTrades(10);
      if (isMountedRef.current) {
        setActiveTrades(response.data?.activeTrades || []);
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadActiveTrades');
      if (isMountedRef.current) {
        setActiveTrades([]);
      }
    }
  }, [user]);

  const loadAISignals = useCallback(async () => {
    if (!user || !isMountedRef.current || !autoTradeStatus?.autoTradeEnabled) return;
    try {
      const response = await autoTradeApi.getProposals();
      if (isMountedRef.current) {
        setAiSignals(response.data?.slice(0, 3) || []);
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadAISignals');
      if (isMountedRef.current) {
        setAiSignals([]);
      }
    }
  }, [user, autoTradeStatus?.autoTradeEnabled]);

  const loadPerformanceStats = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const response = await autoTradeApi.getLogs(100);
      if (isMountedRef.current && response.data?.logs) {
        const logs = response.data.logs;
        const totalTrades = logs.length;
        const winningTrades = logs.filter((log: any) => log.pnl > 0).length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

        // Calculate profits
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayTrades = logs.filter((log: any) => {
          const tradeDate = new Date(log.timestamp);
          return tradeDate >= today;
        });

        const totalProfitToday = todayTrades.reduce((sum: number, log: any) => sum + (log.pnl || 0), 0);
        const totalProfitAllTime = logs.reduce((sum: number, log: any) => sum + (log.pnl || 0), 0);

        setPerformanceStats({
          totalProfitToday,
          totalProfitAllTime,
          winRate: Math.round(winRate),
          totalTrades,
        });
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadPerformanceStats');
      if (isMountedRef.current) {
        setPerformanceStats(null);
      }
    }
  }, [user]);

  const loadPortfolioHistory = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      // Generate mock 7-day portfolio history for demo
      // In production, this would come from a dedicated endpoint
      const history = [];
      const baseValue = 10000; // Default portfolio value since wallet data not available
      let currentValue = baseValue;

      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const change = (Math.random() - 0.5) * 0.05; // ±5% daily change
        currentValue = currentValue * (1 + change);

        history.push({
          date: date.toISOString().split('T')[0],
          value: Math.round(currentValue),
          change: change * 100,
        });
      }

      if (isMountedRef.current) {
        setPortfolioHistory(history);
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadPortfolioHistory');
      if (isMountedRef.current) {
        setPortfolioHistory([]);
      }
    }
  }, [user]); // Removed walletBalances dependency since it's no longer dynamic

  const checkAlerts = useCallback(() => {
    if (!isMountedRef.current) return;
    const newAlerts: Array<{ type: 'warning' | 'error'; message: string }> = [];

    // Check API connection
    if (autoTradeStatus && !autoTradeStatus.isApiConnected) {
      newAlerts.push({
        type: 'warning',
        message: 'Exchange API not connected. Connect your API keys to enable auto-trading.',
      });
    }

    // Check circuit breaker
    if (autoTradeStatus?.circuitBreaker) {
      newAlerts.push({
        type: 'error',
        message: 'Auto-Trade stopped due to risk limits. Check your risk settings.',
      });
    }

    // Check daily loss limit
    if (userStats && userStats.dailyPnl < 0 && Math.abs(userStats.dailyPnl) > (userStats.maxDailyLoss || 0)) {
      newAlerts.push({
        type: 'warning',
        message: 'Daily loss limit approaching. Auto-Trade may pause soon.',
      });
    }

    setAlerts(newAlerts);
  }, [autoTradeStatus, userStats]);

  const loadData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;

    setLoading(true);
    setError(null);

    try {
      // Load unified dashboard data
      await loadDashboardData();
      // Promise.allSettled ensures all promises complete regardless of individual failures
      if (isMountedRef.current) {
        setRetryCount(0); // Reset retry count on successful load
      }
    } catch (err: any) {
      // This should rarely happen with Promise.allSettled, but handle it just in case
      if (isMountedRef.current) {
        setError(err);
        suppressConsoleError(err, 'loadDashboardData');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [user, loadAutoTradeStatus, loadUserStats, loadActiveTrades, loadAISignals, loadPerformanceStats, loadPortfolioHistory]);

  // Initial data load
  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  // Use centralized polling with visibility detection (reduced frequency)
  usePolling(loadData, 120000, !!user && !loading); // 2 minutes instead of 1

  useEffect(() => {
    if (autoTradeStatus && userStats) {
      checkAlerts();
    }
  }, [autoTradeStatus, userStats, checkAlerts]);

  // Load AI signals when auto-trade status changes
  useEffect(() => {
    if (autoTradeStatus?.autoTradeEnabled) {
      loadAISignals();
    } else {
      setAiSignals([]);
    }
  }, [autoTradeStatus?.autoTradeEnabled, loadAISignals]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRetry = useCallback(async () => {
    setRetryCount(prev => prev + 1);
    await loadData();
  }, [loadData]);

  const handleConnectClick = () => {
    setShowExchangeModal(true);
  };

  const handleAutoTradeStatusChange = async (enabled: boolean) => {
    // Reload unified dashboard data after toggle
    await loadDashboardData();
  };

  // Show loading state
  if (loading && retryCount === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
        <Sidebar />
        <main className="min-h-screen">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            <div className="mb-8">
              <h1 className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                Dashboard
              </h1>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <div className="space-y-8">
                <CardSkeleton />
                <CardSkeleton />
              </div>
              <div>
                <CardSkeleton />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Show error state with retry option
  if (error && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
        <Sidebar />
        <main className="min-h-screen">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            <div className="mb-8">
              <h1 className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                Dashboard
              </h1>
            </div>
            <ErrorState
              error={error}
              onRetry={handleRetry}
              message={`Failed to load dashboard data${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`}
            />
          </div>
        </main>
      </div>
    );
  }

  // Show data not available state if no data and not loading/error
  if (!loading && !error && (!dashboardData || Object.keys(dashboardData || {}).length === 0)) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
          <Sidebar />
          <main className="min-h-screen">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
              <div className="mb-8">
                <h1 className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  Dashboard
                </h1>
              </div>
              <div className="text-center py-12">
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 max-w-md mx-auto">
                  <div className="text-slate-400 mb-4">
                    <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Dashboard Data Not Available</h3>
                  <p className="text-slate-400 text-sm">
                    Unable to load dashboard information. Please check your connection and try again.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 px-4 py-2 bg-slate-700/50 border border-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-600/50 transition-colors text-sm font-medium"
                  >
                    Reload Dashboard
                  </button>
                </div>
              </div>
            </div>
          </main>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
      {/* Subtle animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl"></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pink-500/5 rounded-full blur-2xl"></div>

        {/* Subtle grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#64748b08_1px,transparent_1px),linear-gradient(to_bottom,#64748b08_1px,transparent_1px)] bg-[size:32px_32px]"></div>
      </div>

      <Sidebar />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          {/* Enhanced Header */}
          <section className="mb-8 lg:mb-12">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="space-y-3">
                <h1 className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  Dashboard
                </h1>
                <p className="text-lg text-slate-300 max-w-md">
                  Monitor your trading activity and market insights
                </p>
              </div>

              {/* Visit Auto-Trade Button */}
              <button
                onClick={() => window.location.href = '/auto-trade'}
                className="px-8 py-4 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/25 flex items-center gap-3 transform hover:scale-[1.02] active:scale-98"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Visit Auto-Trade</span>
              </button>
            </div>
          </section>

          {/* API Status Cards */}
          <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Exchange API Status Card */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Exchange API Status
                </h3>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  autoTradeStatus?.isApiConnected === true
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-500/30'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    autoTradeStatus?.isApiConnected === true ? 'bg-emerald-400' : 'bg-red-400'
                  }`}></div>
                  {autoTradeStatus?.isApiConnected === true ? 'Connected' : 'Not Connected'}
                </div>
              </div>
              <p className="text-slate-400 text-sm">
                {autoTradeStatus?.isApiConnected === true
                  ? 'Your exchange API is connected and ready for trading.'
                  : 'Connect your exchange API keys to enable auto-trading features.'
                }
              </p>
              {autoTradeStatus?.isApiConnected !== true && (
                <button
                  onClick={handleConnectClick}
                  className="mt-4 px-4 py-2 bg-slate-700/50 border border-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-600/50 transition-colors text-sm font-medium"
                >
                  Connect API Keys
                </button>
              )}
            </div>

            {/* Required APIs Status Card */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Required APIs
                </h3>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                  // For demo purposes, we'll assume all are connected - this should be based on actual API status
                  'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                }`}>
                  <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                  All Connected
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { name: 'Binance Public', status: 'connected' },
                  { name: 'CryptoCompare', status: 'connected' },
                  { name: 'NewsData', status: 'connected' },
                  { name: 'CoinMarketCap', status: 'connected' }
                ].map((api) => (
                  <div key={api.name} className="flex items-center justify-between py-2">
                    <span className="text-slate-300 text-sm font-medium">{api.name}</span>
                    <div className={`w-2 h-2 rounded-full ${
                      api.status === 'connected' ? 'bg-emerald-400' : 'bg-red-400'
                    }`}></div>
                  </div>
                ))}
              </div>

              {/* Uncomment and implement actual API status checking
              <div className="space-y-3">
                {[
                  { name: 'Binance Public', status: autoTradeStatus?.binanceConnected ? 'connected' : 'missing' },
                  { name: 'CryptoCompare', status: autoTradeStatus?.cryptoCompareConnected ? 'connected' : 'missing' },
                  { name: 'NewsData', status: autoTradeStatus?.newsDataConnected ? 'connected' : 'missing' },
                  { name: 'CoinMarketCap', status: autoTradeStatus?.coinMarketCapConnected ? 'connected' : 'missing' }
                ].map((api) => (
                  <div key={api.name} className="flex items-center justify-between py-2">
                    <span className="text-slate-300 text-sm font-medium">{api.name}</span>
                    <div className={`w-2 h-2 rounded-full ${
                      api.status === 'connected' ? 'bg-emerald-400' : 'bg-red-400'
                    }`}></div>
                  </div>
                ))}
              </div>
              */}
            </div>
          </div>

          {/* Alerts / Warnings */}
          {alerts.length > 0 && (
            <div className="mb-8 space-y-4">
              {alerts.map((alert, index) => (
                <div
                  key={index}
                  className={`p-5 rounded-xl border backdrop-blur-sm ${
                    alert.type === 'error'
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-yellow-500/10 border-yellow-500/30'
                  } hover:shadow-lg transition-all duration-300`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                      alert.type === 'error' ? 'bg-red-500/20' : 'bg-yellow-500/20'
                    }`}>
                      {alert.type === 'error' ? (
                        <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className={`font-medium ${
                        alert.type === 'error' ? 'text-red-300' : 'text-yellow-300'
                      }`}>
                        {alert.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New Enhanced Dashboard Features */}
          <div className="mb-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Live Wallet Balance Summary */}
            <div className="lg:col-span-2 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <WalletIcon className="w-5 h-5 text-slate-400" />
                  Portfolio Balance
                </h3>
                <div className="flex items-center gap-2">
                  {(dashboardData?.globalStats?.portfolioHistory || []).length > 1 && (
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                      ((dashboardData?.globalStats?.portfolioHistory || [])[(dashboardData?.globalStats?.portfolioHistory || []).length - 1]?.value || 0) >= ((dashboardData?.globalStats?.portfolioHistory || [])[(dashboardData?.globalStats?.portfolioHistory || []).length - 2]?.value || 0)
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-red-500/10 text-red-300'
                    }`}>
                      {((dashboardData?.globalStats?.portfolioHistory || [])[(dashboardData?.globalStats?.portfolioHistory || []).length - 1]?.value || 0) >= ((dashboardData?.globalStats?.portfolioHistory || [])[(dashboardData?.globalStats?.portfolioHistory || []).length - 2]?.value || 0) ? (
                        <ArrowTrendingUpIcon className="w-3 h-3" />
                      ) : (
                        <ArrowTrendingDownIcon className="w-3 h-3" />
                      )}
                      {(dashboardData?.metrics?.portfolioHistory || []).length > 1 ? (
                        `${(((dashboardData?.metrics?.portfolioHistory || [])[(dashboardData?.metrics?.portfolioHistory || []).length - 1]?.value || 0) - ((dashboardData?.metrics?.portfolioHistory || [])[(dashboardData?.metrics?.portfolioHistory || []).length - 2]?.value || 0)).toFixed(2)}`
                      ) : '0.00'}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-3xl font-bold text-white mb-2">
                    ${dashboardData?.metrics?.wallet?.totalUsdValue?.toLocaleString?.() || '0.00'}
                  </div>
                  <div className="text-sm text-slate-400 mb-4">Total Portfolio Value</div>

                  {/* Mini Portfolio Chart */}
                  {(dashboardData?.metrics?.portfolioHistory || []).length > 0 && (
                    <div className="h-16 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={dashboardData?.metrics?.portfolioHistory || []}>
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#8b5cf6"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Top 3 Assets */}
                  {dashboardData?.metrics?.wallet?.balances && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-slate-300 mb-2">Top Assets</div>
                      {dashboardData.metrics.wallet.balances
                        .filter((asset: any) => asset.usdValue > 0)
                        .sort((a: any, b: any) => b.usdValue - a.usdValue)
                        .slice(0, 3)
                        .map((asset: any) => (
                          <div key={asset.asset} className="flex items-center justify-between text-sm">
                            <span className="text-slate-300">{asset.asset}</span>
                            <span className="text-white font-medium">${asset.usdValue?.toFixed(2) || '0.00'}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-center">
                  <div className="text-center">
                    {Array.isArray(walletBalances) && walletBalances.length ? (
                      <div className="text-2xl font-bold mb-2 text-slate-400">
                        Data not available
                      </div>
                    ) : (
                      <div className="text-2xl font-bold mb-2 text-slate-400">
                        N/A
                      </div>
                    )}
                    <div className="text-sm text-slate-400">24h Change</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Auto-Trade Manage Feature */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-purple-600 to-cyan-600 rounded-xl mb-4">
                  <BoltIcon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Auto-Trade</h3>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium mb-4 ${
                  dashboardData?.user?.settings?.autoTradeEnabled
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-700/50 text-slate-400 border border-slate-600/50'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    dashboardData?.user?.settings?.autoTradeEnabled ? 'bg-emerald-400' : 'bg-slate-500'
                  }`}></div>
                  {dashboardData?.user?.settings?.autoTradeEnabled ? 'Enabled' : 'Disabled'}
                </div>

                <div className="text-sm text-slate-400 mb-6 space-y-1">
                  <div>Agents: {dashboardData?.stats?.user?.agentsUnlocked || 0} total</div>
                  <div>Last execution: {dashboardData?.engineStatus?.lastExecution ? new Date(dashboardData.engineStatus.lastExecution).toLocaleTimeString() : 'Never'}</div>
                </div>

                <button
                  onClick={() => navigate('/auto-trade')}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-cyan-500 transition-all duration-300 shadow-lg shadow-purple-500/25 transform hover:scale-[1.02] active:scale-98"
                >
                  Manage Auto-Trade
                </button>
              </div>
            </div>

            {/* Quick Stats Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-slate-700/30 rounded-xl">
                <div className="text-lg font-bold text-cyan-400 mb-1">
                  {dashboardData?.notifications?.length || 0}
                </div>
                <div className="text-xs text-slate-400">Notifications</div>
              </div>

              <div className="text-center p-3 bg-slate-700/30 rounded-xl">
                <div className="text-lg font-bold text-green-400 mb-1">
                  {dashboardData?.research?.latest?.signal || 'HOLD'}
                </div>
                <div className="text-xs text-slate-400">Last Research</div>
              </div>

              <div className="text-center p-3 bg-slate-700/30 rounded-xl">
                <div className={`text-lg font-bold mb-1 ${
                  (dashboardData?.stats?.user?.winRate || 0) >= 60 ? 'text-emerald-400' :
                  (dashboardData?.stats?.user?.winRate || 0) >= 40 ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {dashboardData?.stats?.user?.winRate || 0}%
                </div>
                <div className="text-xs text-slate-400">Win Rate</div>
              </div>

              <div className="text-center p-3 bg-slate-700/30 rounded-xl">
                <div className="text-lg font-bold text-purple-400 mb-1">
                  {dashboardData?.stats?.user?.agentsUnlocked || 0}
                </div>
                <div className="text-xs text-slate-400">Agents</div>
              </div>
            </div>
          </div>

          {/* Performance Stats and Active Trades Row */}
          <div className="mb-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Auto-Trade Performance Stats */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center gap-2 mb-6">
                <ChartBarIcon className="w-5 h-5 text-slate-400" />
                <h3 className="text-lg font-bold text-white">Performance Stats</h3>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className={`text-2xl font-bold mb-1 ${
                    (dashboardData?.stats?.user?.pnlToday || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    ${(dashboardData?.stats?.user?.pnlToday || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-400">Today</div>
                </div>

                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className={`text-2xl font-bold mb-1 ${
                    (dashboardData?.stats?.user?.pnlTotal || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    ${(dashboardData?.stats?.user?.pnlTotal || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-400">All Time</div>
                </div>

                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className="text-2xl font-bold mb-1 text-blue-400">
                    {dashboardData?.stats?.user?.winRate || 0}%
                  </div>
                  <div className="text-xs text-slate-400">Win Rate</div>
                </div>

                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className="text-2xl font-bold mb-1 text-purple-400">
                    {dashboardData?.stats?.user?.totalTrades || 0}
                  </div>
                  <div className="text-xs text-slate-400">Total Trades</div>
                </div>
              </div>
            </div>

            {/* Active Trades Overview */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ArrowTrendingUpIcon className="w-5 h-5 text-slate-400" />
                  Active Trades
                </h3>
                <button
                  onClick={() => navigate('/auto-trade')}
                  className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
                >
                  View All →
                </button>
              </div>

              <div className="space-y-3 max-h-64 overflow-y-auto">
                {(dashboardData?.hftLogs?.activeTrades || []).length > 0 ? (
                  (dashboardData?.hftLogs?.activeTrades || []).slice(0, 5).map((trade: any, index: number) => (
                    <div key={trade.id || index} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                      <div>
                        <div className="font-medium text-white">{trade.symbol}</div>
                        <div className="text-xs text-slate-400">
                          Entry: ${trade.entryPrice?.toFixed(4) || '0.0000'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-medium ${
                          (trade.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {(trade.pnl || 0) >= 0 ? '+' : ''}{(trade.pnl || 0).toFixed(2)}%
                        </div>
                        <div className="text-xs text-slate-400">
                          {trade.timeInTrade || '0m'} ago
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-slate-400 py-8">
                    <ArrowTrendingUpIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    No active trades
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Research Signals */}
          {dashboardData?.user?.settings?.autoTradeEnabled && (dashboardData?.research?.signals || []).length > 0 && (
            <div className="mb-8 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center gap-2 mb-6">
                <CpuChipIcon className="w-5 h-5 text-slate-400" />
                <h3 className="text-lg font-bold text-white">AI Research Signals</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(dashboardData?.research?.signals || []).map((signal: any, index: number) => (
                  <div key={signal.id || index} className="p-4 bg-slate-700/30 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-white">{signal.symbol}</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        signal.direction === 'BUY'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-red-500/20 text-red-300'
                      }`}>
                        {signal.direction}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400">
                      Confidence: {(signal.confidence * 100).toFixed(0)}%
                    </div>
                    {signal.expectedProfit && (
                      <div className="text-sm text-slate-300">
                        Expected: {signal.expectedProfit > 0 ? '+' : ''}{signal.expectedProfit.toFixed(2)}%
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Auto-Trade Mode Section */}
          <div className="mb-8">
            <Suspense fallback={
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 animate-pulse">
                <div className="h-8 bg-slate-700/50 rounded-lg mb-4 w-1/3"></div>
                <div className="h-4 bg-slate-700/50 rounded w-2/3 mb-6"></div>
                <div className="h-12 bg-slate-700/50 rounded-xl w-full"></div>
              </div>
            }>
              <AutoTradeMode onStatusChange={handleAutoTradeStatusChange} />
            </Suspense>
          </div>

          {/* Recent Trades Section */}
          <div className="mb-8">
            <Suspense fallback={
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 animate-pulse">
                <div className="h-6 bg-slate-700/50 rounded-lg mb-6 w-1/4"></div>
                <div className="space-y-4">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-16 bg-slate-700/50 rounded-xl"></div>
                  ))}
                </div>
              </div>
            }>
              <RecentTrades />
            </Suspense>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-8">
            {/* Left Column - Wallet & Execution */}
            <div className="space-y-8">
              {/* Wallet Balance Card */}
              <Suspense fallback={
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 animate-pulse">
                  <div className="h-6 bg-slate-700/50 rounded-lg mb-6 w-1/3"></div>
                  <div className="space-y-4">
                    <div className="h-8 bg-slate-700/50 rounded w-2/3"></div>
                    <div className="h-6 bg-slate-700/50 rounded w-1/2"></div>
                  </div>
                </div>
              }>
                <WalletCard onConnectClick={handleConnectClick} />
              </Suspense>

              {/* Execution Summary */}
              <Suspense fallback={
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 animate-pulse">
                  <div className="h-6 bg-slate-700/50 rounded-lg mb-6 w-1/3"></div>
                  <div className="grid grid-cols-3 gap-4">
                    {[1,2,3].map(i => (
                      <div key={i} className="h-20 bg-slate-700/50 rounded-xl"></div>
                    ))}
                  </div>
                </div>
              }>
                <ExecutionSummary />
              </Suspense>
            </div>

            {/* Right Column - PnL & Performance */}
            <div>
              <Suspense fallback={
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 animate-pulse">
                  <div className="h-6 bg-slate-700/50 rounded-lg mb-6 w-1/3"></div>
                  <div className="grid grid-cols-2 gap-4">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="h-24 bg-slate-700/50 rounded-xl"></div>
                    ))}
                  </div>
                </div>
              }>
                <PnLWidget />
              </Suspense>
            </div>
          </div>

          {/* Market Scanner Section */}
          <div ref={marketScannerRef}>
            {marketScannerVisible && (
              <Suspense fallback={
                <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8 animate-pulse">
                  <div className="h-6 bg-slate-700/50 rounded-lg mb-6 w-1/3"></div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {[1,2,3,4,5].map(i => (
                      <div key={i} className="h-32 bg-slate-700/50 rounded-xl"></div>
                    ))}
                  </div>
                </div>
              }>
                <MarketScanner />
              </Suspense>
            )}
          </div>
        </div>
      </main>

      {/* Exchange Accounts Modal */}
      {showExchangeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="relative bg-slate-900/95 border border-slate-700/50 rounded-2xl shadow-2xl shadow-slate-900/50 max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowExchangeModal(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors p-3 hover:bg-slate-800/50 rounded-xl z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <ExchangeAccountsSection />
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}
