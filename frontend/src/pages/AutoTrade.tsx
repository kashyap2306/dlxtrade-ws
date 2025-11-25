import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import { autoTradeApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useAutoTradeMode } from '../hooks/useAutoTradeMode';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { suppressConsoleError, getApiErrorMessage } from '../utils/errorHandler';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import Toast from '../components/Toast';
import WalletCard from '../components/Wallet/WalletCard';
import ConfigCard from '../components/AutoTrade/ConfigCard';
import ActivityList from '../components/AutoTrade/ActivityList';
import ExchangeAccountsSection from '../components/ExchangeAccountsSection';

interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number;
  maxConcurrentTrades: number;
  maxDailyLossPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  manualOverride: boolean;
}

interface AutoTradeStatus {
  enabled: boolean;
  activeTrades: number;
  dailyPnL: number;
  dailyTrades: number;
  circuitBreaker: boolean;
  manualOverride: boolean;
  equity: number;
  engineRunning: boolean;
  isApiConnected: boolean;
  config?: {
    perTradeRiskPct: number;
    maxConcurrentTrades: number;
    maxDailyLossPct: number;
    stopLossPct: number;
    takeProfitPct: number;
  };
  stats?: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnL: number;
    dailyPnL: number;
    dailyTrades: number;
  };
}

export default function AutoTrade() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showError } = useError();
  const { addNotification } = useNotificationContext();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AutoTradeStatus | null>(null);
  const [config, setConfig] = useState<AutoTradeConfig>({
    autoTradeEnabled: false,
    perTradeRiskPct: 1,
    maxConcurrentTrades: 3,
    maxDailyLossPct: 5,
    stopLossPct: 1.5,
    takeProfitPct: 3,
    manualOverride: false,
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [showApiRequiredModal, setShowApiRequiredModal] = useState(false);

  useEffect(() => {
    if (user) {
      checkAdmin();
      loadStatus();
    }
  }, [user]);

  const checkAdmin = async () => {
    if (!user) return;
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        const userData: any = userDoc.data();
        setIsAdmin(userData.role === 'admin' || userData.isAdmin === true);
      }
    } catch (error) {
      console.error('Error checking admin role:', error);
    }
  };

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const response = await autoTradeApi.getStatus();
      setStatus(response.data);
      if (response.data.config) {
        setConfig(prev => ({
          ...prev,
          perTradeRiskPct: response.data.config?.perTradeRiskPct ?? prev.perTradeRiskPct,
          maxConcurrentTrades: response.data.config?.maxConcurrentTrades ?? prev.maxConcurrentTrades,
          maxDailyLossPct: response.data.config?.maxDailyLossPct ?? prev.maxDailyLossPct,
          stopLossPct: response.data.config?.stopLossPct ?? prev.stopLossPct,
          takeProfitPct: response.data.config?.takeProfitPct ?? prev.takeProfitPct,
        }));
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  }, [user]);

  // Use shared hook for Auto-Trade Mode logic
  const autoTradeMode = useAutoTradeMode();

  const handleEnableToggle = useCallback(async (enabled: boolean) => {
    if (!user) return;

    // Use shared hook logic
    if (enabled) {
      if (!autoTradeMode.isApiConnected) {
        setShowApiRequiredModal(true);
        return;
      }
      
      if (!autoTradeMode.allRequiredAPIsConnected) {
        const missingNames = autoTradeMode.missingAPIs.map((m) => {
          if (m === 'coinapi_market') return 'CoinAPI Market';
          if (m === 'coinapi_flatfile') return 'CoinAPI Flatfile';
          if (m === 'coinapi_exchangerate') return 'CoinAPI Exchange Rate';
          return m.charAt(0).toUpperCase() + m.slice(1);
        }).join(', ');
        
        showError(`Please submit all required APIs to enable Auto-Trade Mode. Missing: ${missingNames}`, 'validation');
        return;
      }
    }

    try {
      await autoTradeMode.toggle();
      // Refresh status to get updated enabled state
      await loadStatus();
      setToast({ 
        message: enabled ? 'Auto-Trade enabled successfully' : 'Auto-Trade disabled successfully', 
        type: 'success' 
      });
    } catch (err: any) {
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    }
  }, [user, autoTradeMode, loadStatus, showError]);

  const handleConfigSave = useCallback(async (updates: Partial<AutoTradeConfig>) => {
    if (!user) return;
    setLoading(true);
    try {
      await autoTradeApi.updateConfig(updates);
      setConfig(prev => ({ ...prev, ...updates }));
      setToast({ message: 'Trading configuration updated!', type: 'success' });
      await loadStatus();
    } catch (err: any) {
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  }, [user, loadStatus, showError]);

  const handleConfigUpdate = useCallback(async (updates: Partial<AutoTradeConfig>) => {
    // For individual field updates, just update local state
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const handleResetCircuitBreaker = useCallback(async () => {
    if (!isAdmin) {
      showError('Only admins can reset circuit breaker', 'auth');
      return;
    }
    setLoading(true);
    try {
      await autoTradeApi.resetCircuitBreaker();
      setToast({ message: 'Circuit breaker reset successfully', type: 'success' });
      await loadStatus();
    } catch (err: any) {
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, loadStatus, showError]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleLogout = useCallback(async () => {
    const { signOut } = await import('firebase/auth');
    const { auth } = await import('../config/firebase');
    await signOut(auth);
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('firebaseUser');
    window.location.href = '/login';
  }, []);

  const winRate = useMemo(() => {
    return status?.stats 
      ? status.stats.totalTrades > 0 
        ? ((status.stats.winningTrades / status.stats.totalTrades) * 100).toFixed(1)
        : '0.0'
      : '0.0';
  }, [status?.stats]);

  const statusChip = useMemo(() => {
    if (!status) return { text: 'Loading...', color: 'text-gray-400' };
    return status.enabled
      ? { text: 'Enabled', color: 'text-green-400' }
      : { text: 'Disabled', color: 'text-gray-400' };
  }, [status]);

  const isConfigValid = useMemo(() => {
    return (
      config.perTradeRiskPct >= 0.1 && config.perTradeRiskPct <= 10 &&
      config.maxConcurrentTrades >= 1 && config.maxConcurrentTrades <= 10 &&
      config.maxDailyLossPct >= 0.5 && config.maxDailyLossPct <= 50 &&
      config.stopLossPct >= 0.5 && config.stopLossPct <= 10 &&
      config.takeProfitPct >= 0.5 && config.takeProfitPct <= 20
    );
  }, [config]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#101726] to-[#0a0f1c] pb-20 lg:pb-0 relative overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full mix-blend-screen filter blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] opacity-40"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen relative z-10">
        <div className="max-w-7xl mx-auto py-4 sm:py-8 px-4 sm:px-6 lg:px-8 pt-16">
          {/* Header */}
          <section className="mb-6 sm:mb-8">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="space-y-2">
                <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Auto-Trade
                </h1>
                <p className="text-sm sm:text-base text-gray-300 max-w-3xl">
                  Automated trading with risk management and safety controls
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${statusChip.color}`}>
                  {statusChip.text}
                </span>
              </div>
            </div>
          </section>

          {/* Wallet Section - Moved to Top */}
          <div className="mb-6">
            <WalletCard onConnectClick={() => setShowExchangeModal(true)} />
          </div>

          {/* Main Dashboard Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Left Column: Configuration */}
            <div className="lg:col-span-2 space-y-6">
              {/* Status Overview */}
              <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
                <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                  Trading Status
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Active Trades</div>
                    <div className="text-lg font-bold text-white">
                      {status?.activeTrades || 0} / {config.maxConcurrentTrades}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Daily P&L</div>
                    <div className={`text-lg font-bold ${
                      (status?.dailyPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      ${(status?.dailyPnL || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Daily Trades</div>
                    <div className="text-lg font-bold text-white">
                      {status?.dailyTrades || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Equity</div>
                    <div className="text-lg font-bold text-white">
                      ${(status?.equity || 0).toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Engine Status</div>
                    <div className={`text-lg font-bold ${
                      status?.engineRunning ? 'text-green-400' : 'text-gray-400'
                    }`}>
                      {status?.engineRunning ? '🟢 Running' : '⚪ Stopped'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">API Connection</div>
                    <div className={`text-lg font-bold ${
                      status?.isApiConnected ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {status?.isApiConnected ? 'Connected' : 'Disconnected'}
                    </div>
                  </div>
                </div>

                {status?.circuitBreaker && (
                  <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="text-red-400 font-semibold">⚠️ Circuit Breaker Active</span>
                      {isAdmin && (
                        <button
                          onClick={handleResetCircuitBreaker}
                          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-red-300 mt-1">
                      Daily loss limit exceeded. Trading paused.
                    </p>
                  </div>
                )}

                {status?.manualOverride && (
                  <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
                    <span className="text-yellow-400 font-semibold">⏸️ Manual Override Active</span>
                    <p className="text-xs text-yellow-300 mt-1">Trading paused for manual review.</p>
                  </div>
                )}
              </div>

              {/* Statistics */}
              {status?.stats && (
                <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
                  <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                    Trading Statistics
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Total Trades</div>
                      <div className="text-2xl font-bold text-white">{status.stats.totalTrades}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Win Rate</div>
                      <div className="text-2xl font-bold text-green-400">{winRate}%</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">Total P&L</div>
                      <div className={`text-2xl font-bold ${
                        status.stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        ${status.stats.totalPnL.toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-400 mb-1">W/L Ratio</div>
                      <div className="text-2xl font-bold text-white">
                        {status.stats.winningTrades}/{status.stats.losingTrades}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Configuration Card */}
              <ConfigCard 
                config={config} 
                loading={loading} 
                isApiConnected={status?.isApiConnected ?? false}
                onUpdate={handleConfigUpdate}
                onSave={handleConfigSave}
                onEnableToggle={handleEnableToggle}
                isConfigValid={isConfigValid}
              />

              {/* Activity List */}
              <ActivityList />
            </div>

            {/* Right Column: Empty for now (previously had Wallet) */}
            <div className="space-y-6">
              {/* Reserved for future content */}
            </div>
          </div>

          {/* Trading Risk Disclaimer - Moved to Footer */}
          <div className="mt-8 pt-6 border-t border-purple-500/20">
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h3 className="text-yellow-400 font-semibold mb-1">Trading Risk Disclaimer</h3>
                  <p className="text-sm text-gray-300">
                    Trading involves risk. Past performance is no guarantee of future results. 
                    You may lose money when trading. Only trade with funds you can afford to lose. 
                    This system does not guarantee profits or prevent losses.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Exchange Accounts Modal */}
          {showExchangeModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-800 border border-purple-500/50 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-slate-800/95 backdrop-blur-xl border-b border-purple-500/30 px-6 py-4 flex items-center justify-between">
                  <h3 className="text-xl font-bold text-white">Exchange Accounts</h3>
                  <button
                    onClick={() => {
                      setShowExchangeModal(false);
                      loadStatus(); // Refresh status after closing modal
                    }}
                    className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-6">
                  <ExchangeAccountsSection />
                </div>
              </div>
            </div>
          )}

          {/* API Required Modal */}
          {showApiRequiredModal && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-800 border border-purple-500/50 rounded-2xl shadow-2xl max-w-md w-full p-6">
                <h3 className="text-xl font-bold text-white mb-4">Exchange API Required</h3>
                <p className="text-gray-300 mb-6">
                  Please connect your exchange API before enabling Auto-Trade.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowApiRequiredModal(false);
                      setShowExchangeModal(true);
                    }}
                    className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-500 hover:to-pink-500 transition-all"
                  >
                    Connect Exchange
                  </button>
                  <button
                    onClick={() => setShowApiRequiredModal(false)}
                    className="px-4 py-2 bg-gray-700 text-gray-200 font-semibold rounded-lg hover:bg-gray-600 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
