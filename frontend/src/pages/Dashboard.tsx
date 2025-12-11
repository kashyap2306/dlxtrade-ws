import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { autoTradeApi, usersApi, globalStatsApi, engineStatusApi, settingsApi, notificationsApi, agentsApi, exchangeApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';
import { SettingsExchangeSection } from './SettingsExchangeSection';
import { useThrottle, useLazyLoad, usePolling } from '../hooks/usePerformance';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState, CardSkeleton } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, WalletIcon, ChartBarIcon, BoltIcon, CpuChipIcon } from '@heroicons/react/24/outline';
import TradeConfirmationModal from '../components/TradeConfirmationModal';
import { EXCHANGES } from '../constants/exchanges';

// Helper function to get exchange logo component
const getExchangeLogo = (exchangeName: string) => {
  const exchange = EXCHANGES.find(ex => ex.id === exchangeName);
  return exchange?.logo || null;
};

// Wallet balances are now loaded from global-stats endpoint

// Lazy load heavy components for better performance
const MarketScanner = lazy(() => import('../components/MarketScanner'));

// Debounce utility for API calls
function useDebounce<T extends (...args: any[]) => any>(callback: T, delay: number): T {
  const timeoutRef = useRef<number>();

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]) as T;
}

// Direct render - no loading wrapper needed like Research page
function DirectRenderer({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export default function Dashboard() {
  const { user } = useAuth();
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
    settings: null as any, // Fix 1: Add missing settings property
    alerts: [] as Array<{ type: 'warning' | 'error'; message: string }>,
    loading: false, // Never show global loading like Research page
    error: null as any,
    retryCount: 0,
    hasLoaded: true, // Always consider loaded like Research page
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
  const [selectedExchange, setSelectedExchange] = useState<string>('');
  const [exchangeForm, setExchangeForm] = useState({ apiKey: '', secretKey: '', passphrase: '' });
  const [exchangeTestResult, setExchangeTestResult] = useState<{ status: 'success' | 'error' | null; message: string } | undefined>(undefined);
  const [savingExchange, setSavingExchange] = useState(false);
  const [exchangeConfig, setExchangeConfig] = useState<any>(null);
  const isMountedRef = useRef(true);
  const loadingRef = useRef(false); // Prevent concurrent API calls
  const prevShowModalRef = useRef(false);

  // Lazy load triggers for heavy components
  const { ref: marketScannerRef, hasIntersected: marketScannerVisible } = useLazyLoad(0.1);

  // Fix 7: Remove useMemo wrappers and use direct state values
  const {
    data: dashboardData,
    alerts,
    loading,
    error,
    autoTradeStatus,
    userStats,
    activeTrades,
    aiSignals,
    settings,
    performanceStats
  } = dashboardState;

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
      // Load all dashboard data asynchronously without Promise.all - no blocking
      const loadPromises = [
        globalStatsApi.get().then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, userStats: result.data || {} }));
          }
        }).catch(err => {
          console.warn('Failed to load global stats:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, userStats: {} }));
          }
        }),

        engineStatusApi.get().then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, autoTradeStatus: result.data || {} }));
          }
        }).catch(err => {
          console.warn('Failed to load engine status:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, autoTradeStatus: {} }));
          }
        }),

        agentsApi.getUnlocked().then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, agentsUnlocked: result.data?.unlocked || [] }));
          }
        }).catch(err => {
          console.warn('Failed to load unlocked agents:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, agentsUnlocked: [] }));
          }
        }),

        settingsApi.load().then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, settings: result.data || {} }));
          }
        }).catch(err => {
          console.warn('Failed to load settings:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, settings: {} }));
          }
        }),

        notificationsApi.get({ limit: 20 }).then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, notifications: result.data || [] }));
          }
        }).catch(err => {
          console.warn('Failed to load notifications:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, notifications: [] }));
          }
        }),

        usersApi.getPerformanceStats(user.uid).then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, performanceStats: result.data || {} }));
          }
        }).catch(err => {
          console.warn('Failed to load performance stats:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, performanceStats: {} }));
          }
        }),

        usersApi.getActiveTrades(user.uid).then(result => {
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, activeTrades: result.data || [] }));
          }
        }).catch(err => {
          console.warn('Failed to load active trades:', err);
          if (isMountedRef.current) {
            setDashboardState(prev => ({ ...prev, activeTrades: [] }));
          }
        }),
      ];

      // Fire all promises asynchronously without waiting
      loadPromises.forEach(promise => {
        promise.catch(err => {
          console.warn('[DASHBOARD] Non-critical data load failed:', err);
        });
      });

      // Set initial safe state - individual promises will update state as they resolve
      if (isMountedRef.current) {
        setDashboardState(prev => ({
          ...prev,
          data: {
            globalStats: {},
            engineStatus: {},
            agentsUnlocked: [],
            settings: {},
            notifications: []
          },
          settings: {},
          error: null,
          loading: false,
          hasLoaded: true,
          // Legacy state
          autoTradeStatus: {},
          userStats: {},
          walletBalances: [],
          activeTrades: [],
          aiSignals: [],
          performanceStats: {},
          portfolioHistory: [],
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
          settings: {},
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

  // Fix 6: Correct auto-trade status detection
  const isAutoTradeEnabled = autoTradeStatus?.status?.autoTradeEnabled ?? autoTradeStatus?.autoTradeEnabled;

  const loadAISignals = useCallback(async () => {
    if (!user || !isMountedRef.current || !isAutoTradeEnabled) return;
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
  }, [user, isAutoTradeEnabled]);

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
    if (!user || !isMountedRef.current) return;

    try {
      // Load unified dashboard data - no loading state management like Research page
      await loadDashboardData();
    } catch (err: any) {
      suppressConsoleError(err, 'loadDashboardData');
    }
  }, [user, loadDashboardData]);

  // Initial data load - always load like Research page
  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  // No emergency timeout needed - no global loading state like Research page

  // Load exchange config on mount
  useEffect(() => {
    refreshExchangeConfig();
  }, [user]);

  // Refresh exchange config when modal closes
  useEffect(() => {
    if (prevShowModalRef.current && !showExchangeModal) {
      // Modal just closed, refresh the exchange config
      refreshExchangeConfig();
    }
    prevShowModalRef.current = showExchangeModal;
  }, [showExchangeModal]);

  // Use centralized polling with visibility detection (reduced frequency to 5 minutes)
  // Always poll if user exists like Research page
  usePolling(loadData, 300000, !!user);

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
    if (isAutoTradeEnabled) {
      loadAISignals();
    } else {
      setDashboardState(prev => ({ ...prev, aiSignals: [] }));
    }
  }, [isAutoTradeEnabled, loadAISignals]);

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

  // Function to refresh exchange config
  const refreshExchangeConfig = async () => {
    if (user) {
      try {
        const config = await settingsApi.loadExchangeConfig(user.uid);
        setExchangeConfig(config.data);
      } catch (err) {
        console.warn('Failed to refresh exchange config:', err);
        setExchangeConfig(null);
      }
    }
  };

  // Exchange Handlers
  const handleExchangeSelect = (exchangeId: string) => {
    setSelectedExchange(exchangeId);
    // Reset form for new selection
    setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
  };

  const handleExchangeFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExchangeForm({ ...exchangeForm, [e.target.name]: e.target.value });
  };

  const handleTestExchange = async () => {
    if (!selectedExchange) return;
    setSavingExchange(true);
    try {
      const response = await exchangeApi.testExchangeConnection(selectedExchange);
      setExchangeTestResult({
        status: response.data.success ? 'success' : 'error',
        message: response.data.message
      });
    } catch (err: any) {
      setExchangeTestResult({
        status: 'error',
        message: err.response?.data?.message || 'Connection test failed'
      });
    } finally {
      setSavingExchange(false);
    }
  };

  const handleSaveExchange = async () => {
    if (!selectedExchange || !user) return;
    setSavingExchange(true);
    try {
      const exchangeData = EXCHANGES.find((e: any) => e.id === selectedExchange);
      if (!exchangeData) throw new Error('Invalid exchange selected');

      // Validation: Check required fields for the selected exchange
      if (exchangeData.fields.includes('apiKey') && !exchangeForm.apiKey) {
        console.error('API Key is required.');
        return;
      }
      if (exchangeData.fields.includes('secretKey') && !exchangeForm.secretKey) {
        console.error('Secret Key is required.');
        return;
      }
      if (exchangeData.fields.includes('passphrase') && !exchangeForm.passphrase) {
        console.error('Passphrase is required for this exchange.');
        return;
      }

      // Send the exact payload structure requested
      const exchangeConfigPayload = {
        exchangeConfig: {
          exchange: selectedExchange,
          apiKey: exchangeForm.apiKey,
          secretKey: exchangeForm.secretKey,
          passphrase: exchangeForm.passphrase || null,
        }
      };

      await settingsApi.saveExchangeConfig(user.uid, exchangeConfigPayload);

      // Refresh exchangeConfig state
      await refreshExchangeConfig();

      setExchangeTestResult({
        status: 'success',
        message: 'Exchange connected successfully!'
      });

      // Close modal after short delay
      setTimeout(() => setShowExchangeModal(false), 2000);

    } catch (err: any) {
      console.error('Save exchange error:', err);
      setExchangeTestResult({
        status: 'error',
        message: err.response?.data?.message || 'Failed to save exchange configuration'
      });
    } finally {
      setSavingExchange(false);
    }
  };

  const handleDisconnectExchange = async () => {
    if (!user) return;
    setSavingExchange(true);
    try {
      // Send empty exchangeConfig to disconnect
      const exchangeConfigPayload = {
        exchangeConfig: {
          exchange: '',
          apiKey: '',
          secretKey: '',
          passphrase: null,
        }
      };

      await settingsApi.saveExchangeConfig(user.uid, exchangeConfigPayload);

      // Refresh exchangeConfig state
      setExchangeConfig(null);
      setSelectedExchange('');
      setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });

    } catch (err: any) {
      console.error('Disconnect exchange error:', err);
    } finally {
      setSavingExchange(false);
    }
  };

  return (
    <DirectRenderer>
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
                  exchangeConfig && exchangeConfig.exchange
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-500/30'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    exchangeConfig && exchangeConfig.exchange ? 'bg-emerald-400' : 'bg-red-400'
                  }`}></div>
                  {exchangeConfig && exchangeConfig.exchange ? 'Connected' : 'Not Connected'}
                </div>
              </div>
              <p className="text-slate-400 text-sm">
                {exchangeConfig && exchangeConfig.exchange
                  ? 'Your exchange API is connected and ready for trading.'
                  : 'Connect your exchange API keys to enable auto-trading features.'
                }
              </p>
              {!(exchangeConfig && exchangeConfig.exchange) && (
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
                  exchangeConfig && exchangeConfig.exchange
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-400/30'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    exchangeConfig && exchangeConfig.exchange ? 'bg-emerald-400' : 'bg-red-400'
                  }`}></div>
                  {exchangeConfig && exchangeConfig.exchange ? 'Connected' : 'Not Connected'}
                </div>
              </div>

              <div className="space-y-3">
                {[
                  { name: 'Exchange API', key: 'isApiConnected', status: (exchangeConfig && exchangeConfig.exchange) ? 'connected' : 'disconnected' },
                  { name: 'Market Data', key: 'marketData', status: 'connected' },
                  { name: 'News API', key: 'news', status: 'connected' },
                  { name: 'Metadata API', key: 'metadata', status: 'connected' }
                ].map((api) => (
                  <div key={api.name} className="flex items-center justify-between py-2">
                    <span className="text-slate-300 text-sm font-medium">{api.name}</span>
                    <div className={`w-2 h-2 rounded-full ${
                      api.status === 'connected' ? 'bg-emerald-400' : 'bg-red-400'
                    }`}></div>
                  </div>
                ))}
              </div>
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
                    (performanceStats?.dailyPnL || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    ${(performanceStats?.dailyPnL || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-400">Today</div>
                </div>

                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className={`text-2xl font-bold mb-1 ${
                    (performanceStats?.allTimePnL || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    ${(performanceStats?.allTimePnL || 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-slate-400">All Time</div>
                </div>

                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className="text-2xl font-bold mb-1 text-blue-400">
                    {performanceStats?.winRate || 0}%
                  </div>
                  <div className="text-xs text-slate-400">Win Rate</div>
                </div>

                <div className="text-center p-4 bg-slate-700/30 rounded-xl">
                  <div className="text-2xl font-bold mb-1 text-purple-400">
                    {performanceStats?.totalTrades || 0}
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
                {activeTrades.length > 0 ? (
                  activeTrades.slice(0, 5).map((trade: any, index: number) => {
                    const ExchangeLogoComponent = exchangeConfig?.exchange ? getExchangeLogo(exchangeConfig.exchange) : null;
                    const tradeTime = new Date(trade.timestamp);
                    const timeAgo = Math.floor((Date.now() - tradeTime.getTime()) / (1000 * 60)); // minutes ago

                    return (
                      <div key={trade.tradeId || index} className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                        <div className="flex items-center gap-3">
                          {ExchangeLogoComponent && (
                            <ExchangeLogoComponent className="w-6 h-6" />
                          )}
                          <div>
                            <div className="font-medium text-white">{trade.pair}</div>
                            <div className="text-xs text-slate-400">
                              Entry: ${trade.entryPrice?.toFixed(4) || '0.0000'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`font-medium text-sm ${
                            trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {trade.side?.toUpperCase() || 'BUY'}
                          </div>
                          <div className="text-xs text-slate-400">
                            {timeAgo}m ago
                          </div>
                        </div>
                      </div>
                    );
                  })
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
          {/* Fix 4 & 5: Fix visibility condition and data source */}
          {dashboardData?.settings?.autoTradeEnabled && aiSignals.length > 0 && (
            <div className="mb-8 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 hover:shadow-lg hover:shadow-slate-900/20 transition-all duration-300">
              <div className="flex items-center gap-2 mb-6">
                <CpuChipIcon className="w-5 h-5 text-slate-400" />
                <h3 className="text-lg font-bold text-white">AI Research Signals</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {aiSignals.map((signal: any, index: number) => (
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

      {/* Exchange Connection Modal/Drawer */}
      {showExchangeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end justify-center p-0 md:items-center md:p-4">
          <div className="relative bg-slate-900/95 border border-slate-700/50 rounded-t-2xl md:rounded-2xl shadow-2xl shadow-slate-900/50 w-full h-full md:max-w-4xl md:w-full md:max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowExchangeModal(false)}
              className="absolute top-4 right-4 md:top-6 md:right-6 text-slate-400 hover:text-white transition-colors p-3 hover:bg-slate-800/50 rounded-xl z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="p-4 md:p-6">
              <SettingsExchangeSection
                exchangeConfig={exchangeConfig}
                selectedExchange={selectedExchange}
                handleExchangeSelect={handleExchangeSelect}
                exchangeForm={exchangeForm}
                handleExchangeFormChange={handleExchangeFormChange}
                exchangeTestResult={exchangeTestResult}
                handleTestExchange={handleTestExchange}
                handleSaveExchange={handleSaveExchange}
                handleDisconnectExchange={handleDisconnectExchange}
                savingExchange={savingExchange}
              />
            </div>
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
        // Fix 8: Correct prop access for settings
        soundEnabled={dashboardData?.settings?.notificationSettings?.soundEnabled}
      />
      </div>
      </ErrorBoundary>
    </DirectRenderer>
  );
}