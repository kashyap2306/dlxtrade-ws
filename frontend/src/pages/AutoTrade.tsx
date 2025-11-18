import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { autoTradeApi } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { suppressConsoleError, getApiErrorMessage } from '../utils/errorHandler';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import Toast from '../components/Toast';

interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number;
  maxConcurrentTrades: number;
  maxDailyLossPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStop: boolean;
  trailingPct: number;
  manualOverride: boolean;
  mode: 'AUTO' | 'MANUAL' | 'SIMULATION';
}

interface AutoTradeStatus {
  enabled: boolean;
  mode: string;
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
    trailingStop: boolean;
    trailingPct: number;
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
    trailingStop: false,
    trailingPct: 0.5,
    manualOverride: false,
    mode: 'SIMULATION',
  });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (user) {
      checkAdmin();
      loadStatus();
      loadConfig();
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

  const loadStatus = async () => {
    if (!user) return;
    try {
      const response = await autoTradeApi.getStatus();
      setStatus(response.data);
      if (response.data.config) {
        setConfig(prev => ({ ...prev, ...response.data.config }));
      }
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  };

  const loadConfig = async () => {
    // Config is loaded from status endpoint
    await loadStatus();
  };

  const handleConfigUpdate = async (updates: Partial<AutoTradeConfig>) => {
    if (!user) return;
    setLoading(true);
    try {
      // Warn if switching to AUTO mode
      if (updates.mode === 'AUTO' && config.mode !== 'AUTO' && !isAdmin) {
        showError('Only admins can enable AUTO (live trading) mode. Use SIMULATION mode for testing.', 'auth');
        return;
      }

      // Show warning for AUTO mode
      if (updates.mode === 'AUTO') {
        const confirmed = window.confirm(
          '⚠️ WARNING: AUTO mode enables LIVE TRADING with real money.\n\n' +
          'Trading involves risk. Past performance is no guarantee of future results.\n\n' +
          'Are you sure you want to enable live trading?'
        );
        if (!confirmed) return;
      }

      await autoTradeApi.updateConfig(updates);
      setConfig(prev => ({ ...prev, ...updates }));
      setToast({ message: 'Configuration updated successfully', type: 'success' });
      await loadStatus();
    } catch (err: any) {
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const handleRunNow = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await autoTradeApi.run();
      setToast({ 
        message: `Processed ${response.data.processed} queued signals`, 
        type: 'success' 
      });
      await loadStatus();
    } catch (err: any) {
      const { message, type } = getApiErrorMessage(err);
      showError(message, type);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleOverride = async () => {
    await handleConfigUpdate({ manualOverride: !config.manualOverride });
  };

  const handleResetCircuitBreaker = async () => {
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
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    const { auth } = await import('../config/firebase');
    await signOut(auth);
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('firebaseUser');
    window.location.href = '/login';
  };

  const winRate = status?.stats 
    ? status.stats.totalTrades > 0 
      ? ((status.stats.winningTrades / status.stats.totalTrades) * 100).toFixed(1)
      : '0.0'
    : '0.0';

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
        <div className="max-w-7xl mx-auto py-4 sm:py-8 px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8">
          <Header
            title="Auto-Trade Dashboard"
            subtitle="Automated trading with risk management and safety controls"
            onMenuToggle={() => {
              const toggle = (window as any).__sidebarToggle;
              if (toggle) toggle();
            }}
            menuOpen={(window as any).__sidebarOpen || false}
          />

          {/* Safety Disclaimer */}
          <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
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

          {/* Live Trading Warning */}
          {config.mode === 'AUTO' && config.autoTradeEnabled && (
            <div className="mb-6 p-4 bg-red-500/20 border-2 border-red-500/50 rounded-xl animate-pulse">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔴</span>
                <div>
                  <h3 className="text-red-400 font-bold text-lg mb-1">LIVE TRADING ENABLED</h3>
                  <p className="text-sm text-red-300">
                    Real money trades are being executed. Monitor your positions closely.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Status Cards */}
            <div className="lg:col-span-2 space-y-6">
              {/* Current Status */}
              <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
                <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                  Current Status
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Mode</div>
                    <div className={`text-lg font-bold ${
                      config.mode === 'AUTO' ? 'text-red-400' :
                      config.mode === 'SIMULATION' ? 'text-blue-400' :
                      'text-yellow-400'
                    }`}>
                      {config.mode}
                      {config.mode === 'SIMULATION' && ' (Safe Testing)'}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Status</div>
                    <div className={`text-lg font-bold ${
                      status?.enabled ? 'text-green-400' : 'text-gray-400'
                    }`}>
                      {status?.enabled ? '🟢 Enabled' : '⚪ Disabled'}
                    </div>
                  </div>
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

              {/* Manual Controls */}
              <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
                <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                  Manual Controls
                </h2>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleRunNow}
                    disabled={loading || !status?.enabled}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-pink-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Processing...' : 'Run Now'}
                  </button>
                  <button
                    onClick={handleToggleOverride}
                    disabled={loading}
                    className={`px-6 py-3 font-semibold rounded-xl transition-all ${
                      config.manualOverride
                        ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                    }`}
                  >
                    {config.manualOverride ? 'Resume Trading' : 'Pause Trading'}
                  </button>
                </div>
              </div>
            </div>

            {/* Configuration Panel */}
            <div className="bg-black/30 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-6">
              <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
                Configuration
              </h2>
              
              <div className="space-y-4">
                {/* Mode Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Trading Mode
                  </label>
                  <select
                    value={config.mode}
                    onChange={(e) => handleConfigUpdate({ mode: e.target.value as any })}
                    disabled={loading || !isAdmin}
                    className="w-full px-4 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                  >
                    <option value="SIMULATION">SIMULATION (Safe Testing)</option>
                    <option value="MANUAL">MANUAL (No Auto-Execute)</option>
                    {isAdmin && <option value="AUTO">AUTO (Live Trading)</option>}
                  </select>
                  {!isAdmin && (
                    <p className="text-xs text-yellow-400 mt-1">
                      Only admins can enable AUTO mode
                    </p>
                  )}
                </div>

                {/* Enable Toggle */}
                <div className="flex items-center justify-between p-3 bg-black/40 rounded-lg">
                  <span className="text-sm text-gray-300">Enable Auto-Trade</span>
                  <button
                    onClick={async () => {
                      await handleConfigUpdate({ autoTradeEnabled: !config.autoTradeEnabled });
                    }}
                    disabled={loading}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      config.autoTradeEnabled ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                    aria-label={config.autoTradeEnabled ? 'Disable Auto-Trade' : 'Enable Auto-Trade'}
                  >
                    <span
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        config.autoTradeEnabled ? 'translate-x-6' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Risk Settings */}
                <div className="space-y-3 pt-3 border-t border-purple-500/20">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Per-Trade Risk (%)
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={config.perTradeRiskPct}
                      onChange={(e) => handleConfigUpdate({ perTradeRiskPct: parseFloat(e.target.value) })}
                      disabled={loading}
                      className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Max Concurrent Trades
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={config.maxConcurrentTrades}
                      onChange={(e) => handleConfigUpdate({ maxConcurrentTrades: parseInt(e.target.value) })}
                      disabled={loading}
                      className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Max Daily Loss (%)
                    </label>
                    <input
                      type="number"
                      min="0.5"
                      max="50"
                      step="0.5"
                      value={config.maxDailyLossPct}
                      onChange={(e) => handleConfigUpdate({ maxDailyLossPct: parseFloat(e.target.value) })}
                      disabled={loading}
                      className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Stop Loss (%)
                    </label>
                    <input
                      type="number"
                      min="0.5"
                      max="10"
                      step="0.1"
                      value={config.stopLossPct}
                      onChange={(e) => handleConfigUpdate({ stopLossPct: parseFloat(e.target.value) })}
                      disabled={loading}
                      className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Take Profit (%)
                    </label>
                    <input
                      type="number"
                      min="0.5"
                      max="20"
                      step="0.1"
                      value={config.takeProfitPct}
                      onChange={(e) => handleConfigUpdate({ takeProfitPct: parseFloat(e.target.value) })}
                      disabled={loading}
                      className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                    />
                  </div>

                  <div className="flex items-center justify-between p-3 bg-black/40 rounded-lg">
                    <span className="text-sm text-gray-300">Trailing Stop</span>
                    <button
                      onClick={() => handleConfigUpdate({ trailingStop: !config.trailingStop })}
                      disabled={loading}
                      className={`relative w-12 h-6 rounded-full transition-colors ${
                        config.trailingStop ? 'bg-green-500' : 'bg-gray-600'
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          config.trailingStop ? 'translate-x-6' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {config.trailingStop && (
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">
                        Trailing Stop (%)
                      </label>
                      <input
                        type="number"
                        min="0.1"
                        max="5"
                        step="0.1"
                        value={config.trailingPct}
                        onChange={(e) => handleConfigUpdate({ trailingPct: parseFloat(e.target.value) })}
                        disabled={loading}
                        className="w-full px-3 py-2 bg-black/40 border border-purple-500/40 rounded-lg text-white focus:outline-none focus:border-purple-400 disabled:opacity-50"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

