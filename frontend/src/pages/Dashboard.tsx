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
    <div className="min-h-screen bg-slate-900 relative overflow-hidden">
      {/* Clean modern background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
      </div>

      <Sidebar />

      <main className="min-h-screen smooth-scroll">
        <div className="container py-4 sm:py-8">
          {/* Header */}
          <section className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-4xl font-bold text-white mb-2">
                  Trading Dashboard
                </h1>
                <p className="text-slate-400">
                  Real-time market insights and portfolio performance
                </p>
              </div>
              <div className="hidden md:flex items-center gap-4">
                <div className="px-4 py-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="text-xs text-green-400 font-medium">LIVE</div>
                </div>
              </div>
            </div>
          </section>

          {/* Alerts / Warnings */}
          {alerts.length > 0 && (
            <div className="mb-6 space-y-3">
              {alerts.map((alert, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-xl border backdrop-blur-sm ${
                    alert.type === 'error'
                      ? 'bg-red-500/10 border-red-500/30'
                      : 'bg-yellow-500/10 border-yellow-500/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
                      alert.type === 'error' ? 'bg-red-500/20' : 'bg-yellow-500/20'
                    }`}>
                      {alert.type === 'error' ? (
                        <svg className="w-3 h-3 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <p className={`text-sm ${
                      alert.type === 'error' ? 'text-red-300' : 'text-yellow-300'
                    }`}>
                      {alert.message}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Main Dashboard Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Left Column - Primary Actions & Status */}
            <div className="lg:col-span-2 space-y-6">
              {/* Auto-Trade Control */}
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                <Suspense fallback={
                  <div className="animate-pulse">
                    <div className="h-6 bg-slate-700 rounded w-48 mb-4"></div>
                    <div className="h-32 bg-slate-700 rounded"></div>
                  </div>
                }>
                  <AutoTradeMode onStatusChange={handleAutoTradeStatusChange} />
                </Suspense>
              </div>

              {/* Recent Trades */}
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                <Suspense fallback={
                  <div className="animate-pulse">
                    <div className="h-6 bg-slate-700 rounded w-32 mb-4"></div>
                    <div className="h-48 bg-slate-700 rounded"></div>
                  </div>
                }>
                  <RecentTrades />
                </Suspense>
              </div>
            </div>

            {/* Right Column - Analytics & Performance */}
            <div className="space-y-6">
              {/* Wallet Balance */}
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                <Suspense fallback={
                  <div className="animate-pulse">
                    <div className="h-6 bg-slate-700 rounded w-24 mb-4"></div>
                    <div className="h-24 bg-slate-700 rounded"></div>
                  </div>
                }>
                  <WalletCard onConnectClick={handleConnectClick} />
                </Suspense>
              </div>

              {/* Execution Summary */}
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                <Suspense fallback={
                  <div className="animate-pulse">
                    <div className="h-6 bg-slate-700 rounded w-36 mb-4"></div>
                    <div className="h-20 bg-slate-700 rounded"></div>
                  </div>
                }>
                  <ExecutionSummary />
                </Suspense>
              </div>
            </div>
          </div>

          {/* Bottom Section - Performance & Market Data */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8">
            {/* PnL Chart - Full Width on Mobile, 2/3 on Desktop */}
            <div className="xl:col-span-2">
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                <Suspense fallback={
                  <div className="animate-pulse">
                    <div className="h-6 bg-slate-700 rounded w-28 mb-4"></div>
                    <div className="h-64 bg-slate-700 rounded"></div>
                  </div>
                }>
                  <PnLWidget />
                </Suspense>
              </div>
            </div>

            {/* Market Scanner - Sidebar on Desktop */}
            <div ref={marketScannerRef}>
              {marketScannerVisible && (
                <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                  <Suspense fallback={
                    <div className="animate-pulse">
                      <div className="h-6 bg-slate-700 rounded w-32 mb-4"></div>
                      <div className="h-48 bg-slate-700 rounded"></div>
                    </div>
                  }>
                    <MarketScanner />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Exchange Accounts Modal */}
      {showExchangeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowExchangeModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors p-2 hover:bg-slate-700 rounded-lg z-10"
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
