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
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#101726] to-[#0a0f1c] pb-20 lg:pb-0 relative overflow-hidden smooth-scroll">
      {/* Modern animated background with grid pattern - Performance optimized */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none gpu-accelerated">
        {/* Animated gradient orbs - Reduced count on mobile */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="hidden sm:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-pink-500/20 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-4000"></div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] opacity-40"></div>

        {/* Glowing lines effect - Hidden on mobile */}
        <div className="hidden lg:block absolute top-0 left-1/4 w-px h-full bg-gradient-to-b from-transparent via-purple-500/20 to-transparent"></div>
        <div className="hidden lg:block absolute top-0 right-1/4 w-px h-full bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent"></div>
      </div>

      <Sidebar />

      <main className="min-h-screen smooth-scroll">
        <div className="container py-4 sm:py-8">
          {/* Header */}
          <section className="mb-6 sm:mb-8">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                Dashboard
              </h1>
              <p className="text-sm sm:text-base text-gray-300">
                Monitor your trading activity and market insights
              </p>
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

          {/* 1. Auto-Trade Mode Section (TOP PRIORITY) - Always visible */}
          <div className="mb-4 sm:mb-6">
            <Suspense fallback={<div className="h-32 bg-slate-800/50 rounded-xl animate-pulse"></div>}>
              <AutoTradeMode onStatusChange={handleAutoTradeStatusChange} />
            </Suspense>
          </div>

          {/* 2. Recent Trades (After Auto-Trade) - High priority */}
          <div className="mb-4 sm:mb-6">
            <Suspense fallback={<div className="h-48 bg-slate-800/50 rounded-xl animate-pulse"></div>}>
              <RecentTrades />
            </Suspense>
          </div>

          {/* Main Content Grid - Responsive */}
          <div className="responsive-grid mb-4 sm:mb-6">
            {/* 3. Wallet Balance Section */}
            <div className="space-y-4 sm:space-y-6">
              <Suspense fallback={<div className="h-40 bg-slate-800/50 rounded-xl animate-pulse"></div>}>
                <WalletCard onConnectClick={handleConnectClick} />
              </Suspense>

              {/* 4. Execution Summary */}
              <Suspense fallback={<div className="h-32 bg-slate-800/50 rounded-xl animate-pulse"></div>}>
                <ExecutionSummary />
              </Suspense>
            </div>

            {/* 5. PnL & Performance */}
            <Suspense fallback={<div className="h-48 bg-slate-800/50 rounded-xl animate-pulse"></div>}>
              <PnLWidget />
            </Suspense>
          </div>

          {/* 6. Market Scanner (Last Section) - Lazy loaded */}
          <div className="mb-6" ref={marketScannerRef}>
            {marketScannerVisible && (
              <Suspense fallback={<div className="h-64 bg-slate-800/50 rounded-xl animate-pulse"></div>}>
                <MarketScanner />
              </Suspense>
            )}
          </div>
        </div>
      </main>

      {/* Exchange Accounts Modal */}
      {showExchangeModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="relative bg-gradient-to-br from-slate-800 via-purple-900/30 to-slate-900 border border-purple-500/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowExchangeModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg z-10"
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
