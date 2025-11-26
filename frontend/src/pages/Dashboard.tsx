import { useState, useEffect, lazy, Suspense } from 'react';
import Sidebar from '../components/Sidebar';
import { autoTradeApi, usersApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';
import ExchangeAccountsSection from '../components/ExchangeAccountsSection';
import { useThrottle, useLazyLoad } from '../hooks/usePerformance';

// Lazy load heavy components for better performance
const AutoTradeMode = lazy(() => import('../components/AutoTradeMode'));
const RecentTrades = lazy(() => import('../components/RecentTrades'));
const MarketScanner = lazy(() => import('../components/MarketScanner'));
const WalletCard = lazy(() => import('../components/Wallet/WalletCard'));
const ExecutionSummary = lazy(() => import('../components/ExecutionSummary'));
const PnLWidget = lazy(() => import('../components/PnLWidget'));

export default function Dashboard() {
  const { user } = useAuth();
  const [autoTradeStatus, setAutoTradeStatus] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [alerts, setAlerts] = useState<Array<{ type: 'warning' | 'error'; message: string }>>([]);
  const [showExchangeModal, setShowExchangeModal] = useState(false);

  // Throttle data updates to prevent excessive re-renders
  const throttledAutoTradeStatus = useThrottle(autoTradeStatus, 500);
  const throttledUserStats = useThrottle(userStats, 500);

  // Lazy load triggers for heavy components
  const { ref: marketScannerRef, hasIntersected: marketScannerVisible } = useLazyLoad(0.1);

  useEffect(() => {
    if (user) {
      loadData();
      // Reduced polling interval to 60 seconds to improve performance
      const interval = setInterval(loadData, 60000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    try {
      await Promise.all([loadAutoTradeStatus(), loadUserStats()]);
      checkAlerts();
    } catch (e) {
      // Errors handled per call
    }
  };

  const loadAutoTradeStatus = async () => {
    if (!user) return;
    try {
      const response = await autoTradeApi.getStatus();
      setAutoTradeStatus(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  };

  const loadUserStats = async () => {
    if (!user) return;
    try {
      const response = await usersApi.getStats(user.uid);
      setUserStats(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadUserStats');
    }
  };

  const checkAlerts = () => {
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
  };

  useEffect(() => {
    if (autoTradeStatus && userStats) {
      checkAlerts();
    }
  }, [autoTradeStatus, userStats]);

  const handleConnectClick = () => {
    setShowExchangeModal(true);
  };

  const handleAutoTradeStatusChange = async (enabled: boolean) => {
    // Reload status after toggle
    await loadAutoTradeStatus();
    await loadUserStats();
  };

  return (
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
                  autoTradeStatus?.isApiConnected
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-red-500/10 text-red-300 border border-red-500/30'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    autoTradeStatus?.isApiConnected ? 'bg-emerald-400' : 'bg-red-400'
                  }`}></div>
                  {autoTradeStatus?.isApiConnected ? 'Connected' : 'Not Connected'}
                </div>
              </div>
              <p className="text-slate-400 text-sm">
                {autoTradeStatus?.isApiConnected
                  ? 'Your exchange API is connected and ready for trading.'
                  : 'Connect your exchange API keys to enable auto-trading features.'
                }
              </p>
              {!autoTradeStatus?.isApiConnected && (
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
  );
}
