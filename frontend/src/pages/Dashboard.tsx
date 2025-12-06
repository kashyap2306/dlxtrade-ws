import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react';
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
import TradeConfirmationModal from '../components/TradeConfirmationModal';

// Wallet balances are now loaded from global-stats endpoint

// Lazy load heavy components for better performance
const AutoTradeMode = lazy(() => import('../components/AutoTradeMode'));
const RecentTrades = lazy(() => import('../components/RecentTrades'));
const MarketScanner = lazy(() => import('../components/MarketScanner'));
const WalletCard = lazy(() => import('../components/Wallet/WalletCard'));
const ExecutionSummary = lazy(() => import('../components/ExecutionSummary'));
const PnLWidget = lazy(() => import('../components/PnLWidget'));

// Debounce utility for API calls
function useDebounce<T extends (...args: any[]) => any>(callback: T, delay: number): T {
  const timeoutRef = useRef<NodeJS.Timeout>();

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]) as T;
}

// Simplified loader - just use external loading state directly
function SafeAsyncLoader({ children, loading: externalLoading, error: externalError }: {
  children: React.ReactNode;
  loading?: boolean;
  error?: any;
}) {
  // If loading is explicitly true or there's an error, show the respective full-page state
  if (externalLoading === true || externalError) {
    const content = externalLoading === true ? (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-8">
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div>
          <CardSkeleton />
        </div>
      </div>
    ) : (
      <ErrorState
        error={externalError}
        onRetry={() => window.location.reload()}
        message="Failed to load dashboard data"
      />
    );

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
            {content}
          </div>
        </main>
      </div>
    );
  }

  // Otherwise, show content
  return <>{children}</>;
}

export default function Dashboard() {
  const { user, loading: loadingUser } = useAuth();
  const navigate = useNavigate();

  // Trade confirmation modal state
  const [tradeConfirmation, setTradeConfirmation] = useState<{
    isOpen: boolean;
    coin: string;
    accuracy: number;
    tradeData?: any;
  }>({
    isOpen: false,
    coin: '',
    accuracy: 0
  });

  // Unified dashboard state - consolidated to reduce re-renders
  const [dashboardState, setDashboardState] = useState({
    data: null as any,
    alerts: [] as Array<{ type: 'warning' | 'error'; message: string }>,
    loading: true,
    error: null as any,
    retryCount: 0,
    hasLoaded: false,
    // Legacy state consolidated
    autoTradeStatus: null as any,
    userStats: null as any,
    walletBalances: [] as any[],
    activeTrades: [] as any[],
    aiSignals: [] as any[],
    performanceStats: null as any,
    portfolioHistory: [] as any[],
  });

  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const isMountedRef = useRef(true);
  const loadingRef = useRef(false); // Prevent concurrent API calls

  // Lazy load triggers for heavy components
  const { ref: marketScannerRef, hasIntersected: marketScannerVisible } = useLazyLoad(0.1);

  // Memoized state getters to prevent unnecessary re-renders
  const dashboardData = useMemo(() => dashboardState.data, [dashboardState.data]);
  const alerts = useMemo(() => dashboardState.alerts, [dashboardState.alerts]);
  const loading = useMemo(() => dashboardState.loading, [dashboardState.loading]);
  const error = useMemo(() => dashboardState.error, [dashboardState.error]);
  const hasLoaded = useMemo(() => dashboardState.hasLoaded, [dashboardState.hasLoaded]);
  const autoTradeStatus = useMemo(() => dashboardState.autoTradeStatus, [dashboardState.autoTradeStatus]);
  const userStats = useMemo(() => dashboardState.userStats, [dashboardState.userStats]);
  const activeTrades = useMemo(() => dashboardState.activeTrades, [dashboardState.activeTrades]);
  const aiSignals = useMemo(() => dashboardState.aiSignals, [dashboardState.aiSignals]);

  // Debounced dashboard data loading (200ms debounce as requested)
  const debouncedLoadDashboardData = useDebounce(useCallback(async () => {
    if (!user || !isMountedRef.current || dashboardState.hasLoaded || loadingRef.current) {
      console.log('[Dashboard] Skipping loadDashboardData - conditions not met:', {
        user: !!user,
        isMounted: isMountedRef.current,
        hasLoaded: dashboardState.hasLoaded,
        loadingRef: loadingRef.current
      });
      return;
    }

    loadingRef.current = true;

    try {
      // Load multiple dashboard APIs in parallel with individual error handling
      const results = await Promise.allSettled([
        globalStatsApi.get().catch(err => ({ error: err, data: {} })),
        engineStatusApi.get().catch(err => ({ error: err, data: {} })),
        agentsApi.getUnlocked().catch(err => ({ error: err, data: { unlocked: [] } })),
        settingsApi.load().catch(err => ({ error: err, data: {} })),
        notificationsApi.get({ limit: 20 }).catch(err => ({ error: err, data: [] }))
      ]);

      // Extract data with safe fallbacks
      const dashboardData = {
        globalStats: results[0].status === 'fulfilled' ? results[0].value?.data || {} : {},
        engineStatus: results[1].status === 'fulfilled' ? results[1].value?.data || {} : {},
        agentsUnlocked: results[2].status === 'fulfilled' ? results[2].value?.data?.unlocked || [] : [],
        settings: results[3].status === 'fulfilled' ? results[3].value?.data || {} : {},
        notifications: results[4].status === 'fulfilled' ? results[4].value?.data || [] : []
      };

      if (isMountedRef.current) {
        setDashboardState(prev => ({
          ...prev,
          data: dashboardData,
          error: null,
          loading: false,
          hasLoaded: true,
          // Legacy state
          autoTradeStatus: dashboardData?.engineStatus || {},
          userStats: dashboardData?.globalStats || {},
          walletBalances: [],
          activeTrades: dashboardData?.globalStats?.hftLogs || [],
          aiSignals: dashboardData?.globalStats?.activityLogs || [],
          performanceStats: dashboardData?.globalStats || {},
          portfolioHistory: dashboardData?.globalStats?.trades || [],
        }));
      }
    } catch (err: any) {
      console.warn('[Dashboard] API failed: loadDashboardData', err);
      if (isMountedRef.current) {
        const safeDashboardData = {
          globalStats: {},
          engineStatus: {},
          agentsUnlocked: [],
          settings: {},
          notifications: []
        };

        setDashboardState(prev => ({
          ...prev,
          data: safeDashboardData,
          error: err,
          loading: false,
          hasLoaded: true,
          // Safe defaults
          autoTradeStatus: {},
          userStats: {},
          walletBalances: [],
          activeTrades: [],
          aiSignals: [],
          performanceStats: {},
          portfolioHistory: [],
        }));
      }
    } finally {
      loadingRef.current = false;
    }
  }, [user]), 200);

  // Stable reference for loadDashboardData
  const loadDashboardData = useCallback(() => {
    debouncedLoadDashboardData();
  }, [debouncedLoadDashboardData]);

  const loadAISignals = useCallback(async () => {
    if (!user || !isMountedRef.current || !autoTradeStatus?.autoTradeEnabled) return;
    try {
      const response = await autoTradeApi.getProposals();
      if (isMountedRef.current) {
        setDashboardState(prev => ({ ...prev, aiSignals: response.data?.slice(0, 3) || [] }));
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadAISignals');
      if (isMountedRef.current) {
        setDashboardState(prev => ({ ...prev, aiSignals: [] }));
      }
    }
  }, [user, autoTradeStatus?.autoTradeEnabled]);

  const checkAlerts = useCallback(() => {
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

    return newAlerts;
  }, [autoTradeStatus, userStats]);

  const loadData = useCallback(async () => {
    if (!user || !isMountedRef.current || dashboardState.hasLoaded || dashboardState.loading) return;

    setDashboardState(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Load unified dashboard data
      await loadDashboardData();
      if (isMountedRef.current) {
        setDashboardState(prev => ({ ...prev, retryCount: 0, loading: false, hasLoaded: true }));
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setDashboardState(prev => ({ ...prev, error: err, loading: false, hasLoaded: true }));
        suppressConsoleError(err, 'loadDashboardData');
      }
    }
  }, [user, loadDashboardData]);

  // Initial data load - prevent multiple calls
  useEffect(() => {
    if (user && !dashboardState.hasLoaded) {
      loadData();
    }
  }, [user, dashboardState.hasLoaded, loadData]);

  // Emergency timeout: force loading=false after 3 seconds
  useEffect(() => {
    if (dashboardState.loading) {
      const timeout = setTimeout(() => {
        console.log('[Dashboard] EMERGENCY: Forcing loading=false after 3 seconds');
        if (isMountedRef.current) {
          setDashboardState(prev => ({ ...prev, loading: false, hasLoaded: true }));
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [dashboardState.loading]);

  // Use centralized polling with visibility detection (reduced frequency)
  // Only poll if data is loaded and not currently loading
  usePolling(loadData, 120000, !!user && dashboardState.hasLoaded && !dashboardState.loading);

  useEffect(() => {
    if (autoTradeStatus && userStats) {
      const newAlerts = checkAlerts();
      setDashboardState(prev => ({ ...prev, alerts: newAlerts }));
    }
  }, [autoTradeStatus, userStats]);

  // Listen for trade confirmation events
  useEffect(() => {
    const handleTradeConfirmation = (event: CustomEvent) => {
      const { coin, accuracy, tradeData } = event.detail;
      setTradeConfirmation({
        isOpen: true,
        coin,
        accuracy,
        tradeData
      });
    };

    window.addEventListener('tradeConfirmationRequired', handleTradeConfirmation as EventListener);

    return () => {
      window.removeEventListener('tradeConfirmationRequired', handleTradeConfirmation as EventListener);
    };
  }, []);

  // Handle trade confirmation
  const handleTradeConfirm = async (tradeData: any) => {
    try {
      // Execute the trade via API
      const result = await autoTradeApi.execute({
        requestId: `manual-${Date.now()}`,
        signal: {
          symbol: tradeConfirmation.coin,
          action: 'BUY', // Default to BUY, could be enhanced
          size: tradeData.tradeSize,
          leverage: tradeData.leverage,
          stopLoss: tradeData.maxLoss,
          // Note: takeProfit not implemented in current API
        }
      });

      // Show success message
      // You might want to add a toast notification here

    } catch (error: any) {
      console.error('Trade execution failed:', error);
      // Show error message
    }

    // Close modal
    setTradeConfirmation(prev => ({ ...prev, isOpen: false }));
  };

  // Handle trade cancellation
  const handleTradeCancel = () => {
    setTradeConfirmation(prev => ({ ...prev, isOpen: false }));
  };

  // Load AI signals when auto-trade status changes
  useEffect(() => {
    if (autoTradeStatus?.autoTradeEnabled) {
      loadAISignals();
    } else {
      setDashboardState(prev => ({ ...prev, aiSignals: [] }));
    }
  }, [autoTradeStatus?.autoTradeEnabled, loadAISignals]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleRetry = useCallback(async () => {
    setDashboardState(prev => ({ ...prev, retryCount: prev.retryCount + 1, hasLoaded: false, error: null }));
    await loadData();
  }, [loadData]);

  const handleConnectClick = () => {
    setShowExchangeModal(true);
  };

  const handleAutoTradeStatusChange = async (enabled: boolean) => {
    // Reload unified dashboard data after toggle
    await loadDashboardData();
  };


  return (
    <SafeAsyncLoader loading={loading} error={error}>
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
                onClick={() => navigate('/auto-trade')}
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
                  autoTradeStatus?.isApiConnected && autoTradeStatus?.apiStatus === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-400/30'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    autoTradeStatus?.isApiConnected && autoTradeStatus?.apiStatus === 'connected'
                      ? 'bg-emerald-400' : 'bg-red-400'
                  }`}></div>
                  {autoTradeStatus?.isApiConnected && autoTradeStatus?.apiStatus === 'connected' ? 'Connected' : 'Not Connected'}
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { name: 'Exchange API', key: 'isApiConnected', status: autoTradeStatus?.isApiConnected ? 'connected' : 'disconnected' },
                  { name: 'Market Data', key: 'marketData', status: 'connected' }, // Assume connected for now
                  { name: 'News API', key: 'news', status: 'connected' }, // Assume connected for now
                  { name: 'Metadata API', key: 'metadata', status: 'connected' } // Assume connected for now
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
              <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-8">
                <div className="h-8 bg-slate-700/50 rounded-lg mb-4 w-1/3"></div>
                <div className="h-4 bg-slate-700/50 rounded w-2/3 mb-6"></div>
                <div className="h-12 bg-slate-700/50 rounded-xl w-full"></div>
                <div className="text-slate-400 text-sm mt-4">Loading Auto-Trade Mode...</div>
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

      {/* Trade Confirmation Modal */}
      <TradeConfirmationModal
        isOpen={tradeConfirmation.isOpen}
        coin={tradeConfirmation.coin}
        accuracy={tradeConfirmation.accuracy}
        onConfirm={handleTradeConfirm}
        onCancel={handleTradeCancel}
        soundEnabled={dashboardState.settings?.notificationSettings?.soundEnabled}
      />
      </div>
      </ErrorBoundary>
    </SafeAsyncLoader>
  );
}