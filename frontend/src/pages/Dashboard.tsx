import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Orderbook from '../components/Orderbook';
import TradesTicker from '../components/TradesTicker';
import OrdersTable from '../components/OrdersTable';
import PnLWidget from '../components/PnLWidget';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { engineApi, settingsApi, hftApi, globalStatsApi, usersApi, tradesApi, activityLogsApi, agentsApi, uiPreferencesApi, autoTradeApi } from '../services/api';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [hftStatus, setHftStatus] = useState<any>(null);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [autoTradeStatus, setAutoTradeStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [hftLoading, setHftLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [dismissedAgents, setDismissedAgents] = useState<string[]>([]);
  const [unlockedAgents, setUnlockedAgents] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const [userStats, setUserStats] = useState<any>(null);
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);

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
      await loadHFTStatus();
      await delay(150);
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
      await loadAgents();
      await delay(150);
      await loadAgentData();
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
      console.error('Error loading auto-trade status:', err);
      showToast(err.response?.data?.error || 'Failed to load auto-trade status', 'error');
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
      console.error('Error toggling auto-trade:', err);
      showToast(err.response?.data?.error || 'Error toggling auto-trade', 'error');
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
      console.error('Error loading global stats:', err);
      showToast(err.response?.data?.error || 'Failed to load global stats', 'error');
    }
  };

  const loadUserStats = async () => {
    if (!user) return;
    try {
      const response = await usersApi.get(user.uid);
      console.log('User stats API response:', response.data);
      setUserStats(response.data);
    } catch (err: any) {
      console.error('Error loading user stats:', err);
      showToast(err.response?.data?.error || 'Failed to load user stats', 'error');
    }
  };

  const loadRecentTrades = async () => {
    if (!user) return;
    try {
      const response = await tradesApi.get({ uid: user.uid, limit: 5 });
      console.log('Recent trades API response:', response.data);
      setRecentTrades(response.data.trades || []);
    } catch (err: any) {
      console.error('Error loading recent trades:', err);
      showToast(err.response?.data?.error || 'Failed to load recent trades', 'error');
    }
  };

  const loadRecentActivity = async () => {
    if (!user) return;
    try {
      const response = await activityLogsApi.get({ uid: user.uid, limit: 5 });
      console.log('Recent activity API response:', response.data);
      setRecentActivity(response.data.logs || []);
    } catch (err: any) {
      console.error('Error loading recent activity:', err);
      showToast(err.response?.data?.error || 'Failed to load recent activity', 'error');
    }
  };

  const loadAgents = async () => {
    try {
      const response = await agentsApi.getAll();
      console.log('Agents API response:', response.data);
      const agentsList = response.data.agents || [];
      if (agentsList.length === 0) {
        console.warn('No agents found in backend. Please add agents to Firestore.');
        showToast('No agents available. Please contact admin.', 'error');
      }
      setAgents(agentsList);
    } catch (err: any) {
      console.error('Error loading agents:', err);
      showToast(err.response?.data?.error || 'Failed to load agents', 'error');
      setAgents([]); // Set empty array instead of fallback
    }
  };

  const loadAgentData = async () => {
    if (!user) return;
    try {
      // Load UI preferences for dismissed agents
      const prefsResponse = await uiPreferencesApi.get();
      console.log('UI preferences API response:', prefsResponse.data);
      const prefs = prefsResponse.data.preferences || {};
      setDismissedAgents(prefs.dismissedAgents || []);

      // Load unlocked agents from backend
      const unlocksResponse = await agentsApi.getUnlocks();
      console.log('Agent unlocks API response:', unlocksResponse.data);
      const unlocks = unlocksResponse.data.unlocks || [];
      const unlockedMap: Record<string, boolean> = {};
      unlocks.forEach((unlock: any) => {
        // Match by agent name
        const agent = agents.find(a => a.name === unlock.agentName);
        if (agent) {
          unlockedMap[agent.id || unlock.agentName] = true;
        }
      });
      setUnlockedAgents(unlockedMap);
    } catch (err: any) {
      console.error('Error loading agent data:', err);
      console.error('Error details:', err.response?.data);
    }
  };

  const handleDismissFromDashboard = async (agentId: string) => {
    if (!user) return;
    try {
      const newDismissed = [...dismissedAgents, agentId];
      setDismissedAgents(newDismissed);

      await uiPreferencesApi.update({
        dismissedAgents: newDismissed,
      });

      showToast('Agent removed from dashboard', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error removing agent', 'error');
    }
  };

  const handleAgentClick = (agent: any, e?: React.MouseEvent) => {
    // Prevent navigation if clicking on dismiss button or other interactive elements
    if (e) {
      const target = e.target as HTMLElement;
      if (target.closest('button') && !target.closest('button')?.hasAttribute('data-navigate')) {
        return;
      }
    }
    navigate(`/checkout/${agent.id}`);
  };

  const loadStatus = async () => {
    if (!user) return;
    try {
      const response = await engineApi.getStatus();
      console.log('Engine status API response:', response.data);
      setEngineStatus(response.data);
    } catch (err: any) {
      console.error('Error loading engine status:', err);
      console.error('Error details:', err.response?.data);
    }
  };

  const loadSettings = async () => {
    if (!user) return;
    try {
      const response = await settingsApi.load();
      console.log('Dashboard settings API response:', response.data);
      setAutoTradeEnabled(response.data?.autoTradeEnabled || false);
    } catch (err: any) {
      console.error('Error loading settings:', err);
      console.error('Error details:', err.response?.data);
    }
  };

  const loadHFTStatus = async () => {
    if (!user) return;
    try {
      const response = await hftApi.getStatus();
      console.log('HFT status API response:', response.data);
      setHftStatus(response.data);
    } catch (err: any) {
      console.error('Error loading HFT status:', err);
      console.error('Error details:', err.response?.data);
    }
  };

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

  const handleStartHFT = async () => {
    setHftLoading(true);
    try {
      await hftApi.start();
      showToast('HFT Bot started', 'success');
      loadHFTStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error starting HFT Bot', 'error');
    } finally {
      setHftLoading(false);
    }
  };

  const handleStopHFT = async () => {
    if (!confirm('Are you sure you want to stop HFT Bot?')) return;
    setHftLoading(true);
    try {
      await hftApi.stop();
      showToast('HFT Bot stopped', 'success');
      loadHFTStatus();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error stopping HFT Bot', 'error');
    } finally {
      setHftLoading(false);
    }
  };

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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Header
            title="Dashboard"
            subtitle="Monitor your trading activity and market data"
            onMenuToggle={() => {
              const toggle = (window as any).__sidebarToggle;
              if (toggle) toggle();
            }}
            menuOpen={menuOpen}
          />
          <div className="py-6 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-white">Orderbook</h2>
                <Orderbook symbol="BTCUSDT" />
              </div>
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-white">Recent Trades</h2>
                <TradesTicker symbol="BTCUSDT" />
              </div>
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-white">Orders & Fills</h2>
                <OrdersTable />
              </div>
            </div>
            <div className="space-y-6">
              <PnLWidget />
              
              {/* PART 3: Auto Trade Button and Stats */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-white">Auto Trade</h2>
                {autoTradeStatus && userStats ? (
                  <div className="space-y-4">
                    {/* Auto Trade Toggle Button */}
                    <button
                      onClick={handleToggleAutoTrade}
                      disabled={loading || !autoTradeStatus.isApiConnected}
                      className={`w-full px-6 py-3 text-lg font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
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
                        <div className="text-lg font-bold text-purple-400">
                          {autoTradeStatus.engineRunning ? '🟢 Running' : '⚪ Stopped'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Engine Status</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className="text-lg font-bold text-cyan-400">
                          {autoTradeStatus.isApiConnected ? '🟢 Connected' : '🔴 Not Connected'}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">My API Status</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className={`text-lg font-bold ${
                          (userStats.dailyPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${(userStats.dailyPnl || 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Today's PNL</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                        <div className={`text-lg font-bold ${
                          (userStats.totalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          ${(userStats.totalPnl || 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">Total PNL</div>
                      </div>
                      <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20 col-span-2">
                        <div className="text-lg font-bold text-blue-400">
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
              
              {/* Global Stats */}
              {globalStats && (
                <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                  <h2 className="text-xl font-semibold mb-4 text-white">Platform Stats</h2>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-2xl font-bold text-purple-400">{globalStats.totalUsers || 0}</div>
                      <div className="text-xs text-gray-400 mt-1">Total Users</div>
                    </div>
                    <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-2xl font-bold text-green-400">{globalStats.totalTrades || 0}</div>
                      <div className="text-xs text-gray-400 mt-1">Total Trades</div>
                    </div>
                    <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-2xl font-bold text-blue-400">{globalStats.activeEngines || 0}</div>
                      <div className="text-xs text-gray-400 mt-1">Active Engines</div>
                    </div>
                    <div className="text-center p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
                      <div className="text-2xl font-bold text-cyan-400">{globalStats.activeHFT || 0}</div>
                      <div className="text-xs text-gray-400 mt-1">Active HFT</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* AI/Level Bot Control */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-white">AI/Level Bot</h2>
                {engineStatus ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-300">Status:</span>
                        <span className={engineStatus.engine?.running ? 'text-green-400' : 'text-gray-400'}>
                          {engineStatus.engine?.running ? 'Running' : 'Stopped'}
                        </span>
                      </div>
                      {engineStatus.engine?.config && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-gray-300">Symbol:</span>
                            <span className="text-gray-200">{engineStatus.engine.config.symbol}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-300">Quote Size:</span>
                            <span className="text-gray-200">{engineStatus.engine.config.quoteSize}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between">
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
                              className="flex-1 px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all disabled:opacity-50"
                            >
                              {loading ? 'Stopping...' : 'Stop AI/Level Bot'}
                            </button>
                          ) : (
                            <button
                              onClick={handleStartAutoTrade}
                              disabled={loading}
                              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all disabled:opacity-50 shadow-lg shadow-purple-500/50"
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

              {/* HFT Bot Control */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-blue-500/20 rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-semibold mb-4 text-white">HFT Bot</h2>
                {hftStatus ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-300">Status:</span>
                        <span className={hftStatus.running ? 'text-green-400' : 'text-gray-400'}>
                          {hftStatus.running ? 'Running' : 'Stopped'}
                        </span>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-blue-500/20">
                      <div className="flex gap-2">
                        {hftStatus.running ? (
                          <button
                            onClick={handleStopHFT}
                            disabled={hftLoading}
                            className="flex-1 px-4 py-2 text-sm font-medium text-red-300 bg-red-900/30 backdrop-blur-sm border border-red-500/30 rounded-lg hover:bg-red-900/50 transition-all disabled:opacity-50"
                          >
                            {hftLoading ? 'Stopping...' : 'Stop HFT Bot'}
                          </button>
                        ) : (
                          <button
                            onClick={handleStartHFT}
                            disabled={hftLoading}
                            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-cyan-500 rounded-lg hover:from-blue-600 hover:to-cyan-600 transition-all disabled:opacity-50 shadow-lg shadow-blue-500/50"
                          >
                            {hftLoading ? 'Starting...' : 'Start HFT Bot'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-400">Loading...</p>
                )}
              </div>
            </div>
          </div>

          {/* Agents Section */}
          <div className="mt-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                Premium Agents
              </h2>
              <button
                onClick={() => navigate('/agents')}
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                View All →
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {agents
                .filter((agent: any) => !dismissedAgents.includes(agent.id || agent.name))
                .map((agent: any) => {
                  const aid = agent.id || agent.name;
                  const isUnlocked = !!unlockedAgents[aid];
                  const supportNumber = import.meta.env.VITE_SUPPORT_NUMBER || '15551234567';
                  const waUrl = `https://wa.me/${supportNumber}?text=${encodeURIComponent(`Please unlock agent: ${agent.name}`)}`;

                  return (
                    <div
                      key={aid}
                      className={`group relative bg-gradient-to-br from-slate-800/60 via-slate-800/40 to-slate-900/60 backdrop-blur-xl border ${isUnlocked ? 'border-green-500/30' : 'border-purple-500/20'} rounded-xl shadow-lg p-5 hover:shadow-xl transition-all`}
                    >
                      {/* Dismiss Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDismissFromDashboard(aid);
                        }}
                        className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-500/20 rounded-full transition-all"
                        title="Remove from dashboard"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>

                      {/* Status Badge */}
                      <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg text-xs font-medium ${isUnlocked ? 'bg-green-500/20 border border-green-500/50 text-green-400' : 'bg-slate-700/50 border border-slate-500/30 text-gray-300'}`}>
                        {isUnlocked ? '✓ Active Agent' : '🔒 Locked'}
                      </div>

                      {/* Content */}
                      <h3 className="text-lg font-bold text-white mb-2">{agent.name}</h3>
                      <p className="text-gray-400 text-sm mb-4 line-clamp-2">{agent.description || 'Premium trading agent'}</p>

                      <div className="pt-3 border-t border-purple-500/20 flex items-center justify-between">
                        <div className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                          ${agent.price || 0}
                        </div>
                        {!isUnlocked ? (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-2 text-xs font-medium rounded-lg bg-slate-900/60 border border-purple-500/30 text-purple-200 hover:bg-slate-900/80 transition-colors"
                          >
                            Unlock via WhatsApp
                          </a>
                        ) : (
                          <button
                            onClick={() => navigate(`/agent/${encodeURIComponent(aid)}`)}
                            className="px-3 py-2 text-xs font-medium rounded-lg bg-green-600/80 hover:bg-green-600 text-white transition-colors"
                          >
                            Use Agent
                          </button>
                        )}
                      </div>

                      {/* Lock overlay for locked agents */}
                      {!isUnlocked && (
                        <div className="absolute inset-0 rounded-xl bg-slate-900/30 backdrop-blur-[1px] pointer-events-none"></div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

