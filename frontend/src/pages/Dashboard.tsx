import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Orderbook from '../components/Orderbook';
import TradesTicker from '../components/TradesTicker';
import OrdersTable from '../components/OrdersTable';
import PnLWidget from '../components/PnLWidget';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import APIDiagnosticPanel from '../components/APIDiagnosticPanel';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { engineApi, settingsApi, globalStatsApi, usersApi, tradesApi, activityLogsApi, autoTradeApi } from '../services/api';
import ExecutionLogsSection from '../components/ExecutionLogsSection';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { suppressConsoleError } from '../utils/errorHandler';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [engineStatus, setEngineStatus] = useState<any>(null);
  // HFT status removed from dashboard (managed as Premium Agent only)
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [autoTradeStatus, setAutoTradeStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // HFT loading removed
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadSafely = async () => {
      if (cancelled) return;
      await loadAllData();
    };

    loadSafely();
    // Reduce polling to 10s and stagger calls within loadAllData
    const interval = setInterval(loadSafely, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const loadAllData = async () => {
    if (!user) return;
    try {
      // Stagger requests to avoid bursts that trigger rate limits
      await loadStatus();
      await delay(150);
      // HFT status removed
      await loadSettings();
      await delay(150);
      await loadGlobalStats();
      await delay(150);
      await loadUserStats();
      await delay(150);
      await loadRecentTrades();
      await delay(150);
      await loadRecentActivity();
      await delay(150);
      await loadAutoTradeStatus();
    } catch (e) {
      // Errors are already handled per-call
    }
  };

  const loadAutoTradeStatus = async () => {
    if (!user) return;
    try {
      const response = await autoTradeApi.getStatus();
      console.log('Auto Trade status API response:', response.data);
      setAutoTradeStatus(response.data);
      setAutoTradeEnabled(response.data?.autoTradeEnabled || false);
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  };

  const handleToggleAutoTrade = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const newEnabled = !autoTradeEnabled;
      const response = await autoTradeApi.toggle(newEnabled);
      console.log('Auto Trade toggle API response:', response.data);
      
      setAutoTradeEnabled(newEnabled);
      showToast(
        newEnabled ? 'Auto Trade enabled successfully' : 'Auto Trade disabled successfully',
        'success'
      );
      
      // Reload status
      await loadAutoTradeStatus();
      await loadStatus();
      await loadUserStats();
    } catch (err: any) {
      suppressConsoleError(err, 'toggleAutoTrade');
    } finally {
      setLoading(false);
    }
  };

  const loadGlobalStats = async () => {
    try {
      const response = await globalStatsApi.get();
      console.log('Global stats API response:', response.data);
      setGlobalStats(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadGlobalStats');
    }
  };

  const loadUserStats = async () => {
    if (!user) return;
    try {
      const response = await usersApi.getStats(user.uid);
      console.log('User stats API response:', response.data);
      setUserStats(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadUserStats');
    }
  };

  const loadRecentTrades = async () => {
    if (!user) return;
    try {
      const response = await tradesApi.get({ uid: user.uid, limit: 5 });
      console.log('Recent trades API response:', response.data);
      setRecentTrades(response.data.trades || []);
    } catch (err: any) {
      suppressConsoleError(err, 'loadRecentTrades');
    }
  };

  const loadRecentActivity = async () => {
    if (!user) return;
    try {
      const response = await activityLogsApi.get({ uid: user.uid, limit: 5 });
      console.log('Recent activity API response:', response.data);
      setRecentActivity(response.data.logs || []);
    } catch (err: any) {
      suppressConsoleError(err, 'loadRecentActivity');
    }
  };


  const loadStatus = async () => {
    if (!user) return;
    try {
      const response = await engineApi.getStatus();
      console.log('Engine status API response:', response.data);
      setEngineStatus(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadEngineStatus');
    }
  };

  const loadSettings = async () => {
    if (!user) return;
    try {
      const response = await settingsApi.load();
      console.log('Dashboard settings API response:', response.data);
      setAutoTradeEnabled(response.data?.autoTradeEnabled || false);
    } catch (err: any) {
      suppressConsoleError(err, 'loadSettings');
    }
  };

  // HFT status function removed

  const handleStartAutoTrade = async () => {
    setLoading(true);
    try {
      const settings = await settingsApi.load();
      if (!settings.data?.autoTradeEnabled) {
        showToast('Please enable auto-trade in Settings first', 'error');
        return;
      }
      await engineApi.start({
        symbol: settings.data.symbol || 'BTCUSDT',
        quoteSize: settings.data.quoteSize || 0.001,
        adversePct: settings.data.adversePct || 0.0002,
        cancelMs: settings.data.cancelMs || 40,
        maxPos: settings.data.maxPos || 0.01,
        enabled: true,
      });
      showToast('Auto-trade started', 'success');
      loadStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error starting auto-trade', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleStopAutoTrade = async () => {
    if (!confirm('Are you sure you want to stop auto-trade?')) return;
    setLoading(true);
    try {
      await engineApi.stop();
      showToast('AI/Level Bot stopped', 'success');
      loadStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping AI/Level Bot', 'error');
    } finally {
      setLoading(false);
    }
  };

  // HFT controls removed (HFT appears only as Premium Agent)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onMenuToggle={setMenuOpen} />

      <main className="min-h-screen">
        <div className="max-w-7xl mx-auto container-mobile pt-4 lg:pt-0">
          <Header
            title="Dashboard"
            subtitle="Monitor your trading activity and market data"
            onMenuToggle={() => {
              const toggle = (window as any).__sidebarToggle;
              if (toggle) toggle();
            }}
            menuOpen={menuOpen}
          />
          <div className="py-4 sm:py-6 lg:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-mobile">
            <div className="lg:col-span-2 space-y-4 sm:space-y-6">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-4 text-white">Orderbook</h2>
                <Orderbook symbol="BTCUSDT" />
              </div>
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-4 text-white">Recent Trades</h2>
                <TradesTicker symbol="BTCUSDT" />
              </div>
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-4 text-white">Orders & Fills</h2>
                <OrdersTable />
              </div>
            </div>
            <div className="space-y-4 sm:space-y-6">
              <PnLWidget />
              
              {/* PART 3: Auto Trade Button and Stats */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-4 text-white">Auto Trade</h2>
                {autoTradeStatus && userStats ? (
                  <div className="space-y-4">
                    {/* Auto Trade Toggle Button */}
                    <button
                      onClick={handleToggleAutoTrade}
                      disabled={loading || !autoTradeStatus.isApiConnected}
                      className={`btn-mobile-full px-6 py-3 text-base sm:text-lg font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        autoTradeEnabled
                          ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white shadow-lg shadow-green-500/50'
                          : 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white shadow-lg shadow-blue-500/50'
                      }`}
                    >
                      {autoTradeEnabled ? '🟢 Auto Trade: ON' : '🔵 Auto Trade: OFF'}
                    </button>
                    
                    {!autoTradeStatus.isApiConnected && (
                      <p className="text-sm text-yellow-400 text-center">
                        Connect your Binance API keys first
                      </p>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-purple-500/20">
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className="text-base sm:text-lg font-bold text-purple-400">
                          {autoTradeStatus.engineRunning ? '🟢 Running' : '⚪ Stopped'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Engine Status</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className="text-base sm:text-lg font-bold text-cyan-400">
                          {autoTradeStatus.isApiConnected ? '🟢 Connected' : '🔴 Not Connected'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">My API Status</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className={`text-base sm:text-lg font-bold ${
                          (userStats.dailyPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${(userStats.dailyPnl || 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Today's PNL</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className={`text-base sm:text-lg font-bold ${
                          (userStats.totalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${(userStats.totalPnl || 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Total PNL</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20 col-span-2">
                        <div className="text-base sm:text-lg font-bold text-blue-400">
                          {userStats.totalTrades || 0}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Total Trades</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400">Loading...</p>
                )}
              </div>
              
              {/* Platform Stats section removed per request */}
              
              {/* API Diagnostic Panel - Now opens as modal */}
              <APIDiagnosticPanel />

              {/* AI/Level Bot Control */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-semibold mb-4 text-white">AI/Level Bot</h2>
                {engineStatus ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm sm:text-base">
                        <span className="text-gray-300">Status:</span>
                        <span className={engineStatus.engine?.running ? 'text-green-400' : 'text-gray-400'}>
                          {engineStatus.engine?.running ? 'Running' : 'Stopped'}
                        </span>
                      </div>
                      {engineStatus.engine?.config && (
                        <>
                          <div className="flex justify-between text-sm sm:text-base">
                            <span className="text-gray-300">Symbol:</span>
                            <span className="text-gray-200">{engineStatus.engine.config.symbol}</span>
                          </div>
                          <div className="flex justify-between text-sm sm:text-base">
                            <span className="text-gray-300">Quote Size:</span>
                            <span className="text-gray-200">{engineStatus.engine.config.quoteSize}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between text-sm sm:text-base">
                        <span className="text-gray-300">Circuit Breaker:</span>
                        <span className={engineStatus.risk?.circuitBreaker ? 'text-red-400' : 'text-green-400'}>
                          {engineStatus.risk?.circuitBreaker ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                    </div>
                    {autoTradeEnabled && (
                      <div className="pt-4 border-t border-purple-500/20">
                        <div className="flex gap-2">
                          {engineStatus.engine?.running ? (
                            <button
                              onClick={handleStopAutoTrade}
                              disabled={loading}
                              className="btn-mobile-full px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all disabled:opacity-50"
                            >
                              {loading ? 'Stopping...' : 'Stop AI/Level Bot'}
                            </button>
                          ) : (
                            <button
                              onClick={handleStartAutoTrade}
                              disabled={loading}
                              className="btn-mobile-full px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 shadow-lg shadow-purple-500/50"
                            >
                              {loading ? 'Starting...' : 'Start AI/Level Bot'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-400">Loading...</p>
                )}
              </div>

              {/* HFT Bot control removed */}
            </div>
          </div>

          {/* Execution Logs Section */}
          <div className="mt-6 sm:mt-8">
            <div className="bg-gradient-to-br from-slate-800/40 via-purple-900/20 to-slate-900/40 backdrop-blur-xl border border-purple-500/20 rounded-2xl p-4 sm:p-6 md:p-8 shadow-2xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
                    Execution Logs
                  </h2>
                  <p className="text-gray-400 text-sm sm:text-base">
                    View detailed execution history and trade outcomes
                  </p>
                </div>
                <button
                  onClick={() => navigate('/execution')}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 whitespace-nowrap"
                >
                  View All Logs →
                </button>
              </div>
              
              <ExecutionLogsSection limit={20} />
            </div>
          </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

