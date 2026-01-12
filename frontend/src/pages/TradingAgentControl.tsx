import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Toast from '../components/Toast';
import { useAuth } from '../hooks/useAuth';
import { useUnlockedAgents } from '../hooks/useUnlockedAgents';
import { agentsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function TradingAgentControl() {
  const { agentId } = useParams<{ agentId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { unlockedAgents, loading: unlockedLoading } = useUnlockedAgents();
  const [loading, setLoading] = useState(true);
  const [agent, setAgent] = useState<any>(null);
  const [control, setControl] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'trades'>('dashboard');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [settings, setSettings] = useState({
    riskPerTrade: 1.0,
    maxConcurrentTrades: 1,
    maxTradesPerDay: 6,
    apiKey: '',
    apiSecret: ''
  });

  useEffect(() => {
    if (user && agentId && !unlockedLoading) {
      // Check if user has access to TRADING_AGENT
      const hasAccess = unlockedAgents.some(agent => agent.agentId === 'TRADING_AGENT');

      // If user doesn't have access, redirect to marketplace
      if (!hasAccess) {
        navigate('/agents', { replace: true });
        return;
      }

      loadAgentData();
    }
  }, [unlockedLoading]); // Only depend on unlockedLoading to avoid race conditions

  const loadAgentData = async () => {
    if (!agentId || !user) return;

    setLoading(true);
    try {
      const response = await agentsApi.getTradingAgentControl(agentId);
      const data = response.data;

      setAgent(data.agent);
      setControl(data.control);
      setPerformance(data.performance);
      setTrades(data.trades || []);

      // Set settings from agent data
      setSettings({
        riskPerTrade: data.agent.riskPerTrade || 1.0,
        maxConcurrentTrades: data.agent.maxConcurrentTrades || 1,
        maxTradesPerDay: data.agent.maxTradesPerDay || 6,
        apiKey: data.agent.apiKey || '',
        apiSecret: data.agent.apiSecret || ''
      });
    } catch (err: any) {
      console.error('Error loading agent data:', err);
      showToast('Failed to load agent data', 'error');
      navigate('/agents');
    } finally {
      setLoading(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpdateSettings = async () => {
    if (!agentId) return;

    setUpdatingSettings(true);
    try {
      await agentsApi.updateTradingAgentSettings(agentId, settings);
      showToast('Settings updated successfully', 'success');
      await loadAgentData(); // Reload to get updated data
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to update settings', 'error');
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleAgentAction = async (action: 'start' | 'stop' | 'pause' | 'resume') => {
    if (!agentId) return;

    try {
      switch (action) {
        case 'start':
          await agentsApi.startTradingAgent(agentId);
          showToast('Trading agent started successfully', 'success');
          break;
        case 'stop':
          await agentsApi.stopTradingAgent(agentId);
          showToast('Trading agent stopped successfully', 'success');
          break;
        case 'pause':
          await agentsApi.pauseTradingAgent(agentId);
          showToast('Trading agent paused successfully', 'success');
          break;
        case 'resume':
          await agentsApi.resumeTradingAgent(agentId);
          showToast('Trading agent resumed successfully', 'success');
          break;
      }
      await loadAgentData(); // Reload to get updated status
    } catch (err: any) {
      showToast(err.response?.data?.error || `Failed to ${action} agent`, 'error');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'text-green-400';
      case 'PAUSED': return 'text-yellow-400';
      case 'STOPPED': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      ACTIVE: 'bg-green-600/20 text-green-400 border-green-500/30',
      PAUSED: 'bg-yellow-600/20 text-yellow-400 border-yellow-500/30',
      STOPPED: 'bg-red-600/20 text-red-400 border-red-500/30',
      PENDING_APPROVAL: 'bg-blue-600/20 text-blue-400 border-blue-500/30'
    };
    return colors[status as keyof typeof colors] || 'bg-gray-600/20 text-gray-400 border-gray-500/30';
  };

  if (loading || unlockedLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-blue-200">Loading trading agent...</p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Agent Not Found</h2>
          <p className="text-gray-400 mb-6">The requested trading agent doesn't exist or you don't have access.</p>
          <button
            onClick={() => navigate('/agents')}
            className="btn btn-primary"
          >
            Back to Agents
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900">
        {/* Animated background elements */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        </div>

        <div className="relative z-10 p-6 max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate('/agents')}
              className="text-purple-400 hover:text-purple-300 mb-4 inline-flex items-center"
            >
              ← Back to Agents
            </button>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
              📈 {agent.name}
            </h1>
            <div className="flex items-center space-x-4 text-gray-400">
              <span>{agent.tradingPair} • {agent.marketType}</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusBadge(agent.status)}`}>
                {agent.status}
              </span>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex space-x-1 mb-8 bg-slate-800/50 p-1 rounded-lg backdrop-blur-sm">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: '📊' },
              { id: 'settings', label: 'Settings', icon: '⚙️' },
              { id: 'trades', label: 'Trade History', icon: '📋' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-purple-600 text-white shadow-lg'
                    : 'text-gray-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              {/* Agent Status & Controls */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">Status</h3>
                      <p className={`font-medium ${getStatusColor(agent.status)}`}>
                        {agent.status}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {agent.status === 'STOPPED' && (
                      <button
                        onClick={() => handleAgentAction('start')}
                        className="w-full btn btn-primary text-sm"
                      >
                        ▶️ Start Agent
                      </button>
                    )}
                    {agent.status === 'ACTIVE' && (
                      <>
                        <button
                          onClick={() => handleAgentAction('pause')}
                          className="w-full btn btn-secondary text-sm mb-2"
                        >
                          ⏸️ Pause Agent
                        </button>
                        <button
                          onClick={() => handleAgentAction('stop')}
                          className="w-full btn btn-danger text-sm"
                        >
                          ⏹️ Stop Agent
                        </button>
                      </>
                    )}
                    {agent.status === 'PAUSED' && (
                      <>
                        <button
                          onClick={() => handleAgentAction('resume')}
                          className="w-full btn btn-primary text-sm mb-2"
                        >
                          ▶️ Resume Agent
                        </button>
                        <button
                          onClick={() => handleAgentAction('stop')}
                          className="w-full btn btn-danger text-sm"
                        >
                          ⏹️ Stop Agent
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">Daily Trades</h3>
                      <p className="text-blue-400 font-medium">{control?.dailyTrades || 0}/{agent.maxTradesPerDay}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">Win Rate</h3>
                      <p className="text-green-400 font-medium">{performance?.winRate?.toFixed(1) || 0}%</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-1">Total P&L</h3>
                      <p className={`font-medium ${performance?.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${performance?.totalPnL?.toFixed(2) || '0.00'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Strategy Overview */}
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6 mb-8">
                <h2 className="text-xl font-bold text-white mb-6">Strategy Overview</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Entry Conditions</h3>
                    <div className="space-y-2 text-gray-300">
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-3"></span>
                        Price &gt; EMA 50 (trend filter)
                      </div>
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-3"></span>
                        RSI (14) &lt; 30 (oversold)
                      </div>
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-green-500 rounded-full mr-3"></span>
                        Price below Lower Bollinger Band
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Risk Management</h3>
                    <div className="space-y-2 text-gray-300">
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-blue-500 rounded-full mr-3"></span>
                        Stop Loss: 1 × ATR from entry
                      </div>
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-blue-500 rounded-full mr-3"></span>
                        Take Profit: 0.8 × ATR from entry
                      </div>
                      <div className="flex items-center">
                        <span className="w-2 h-2 bg-blue-500 rounded-full mr-3"></span>
                        {agent.riskPerTrade}% risk per trade
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Trades */}
              <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-6">Recent Trades</h2>
                {trades.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400">No trades yet</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {trades.slice(0, 5).map((trade) => (
                      <div key={trade.id} className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
                        <div>
                          <div className="flex items-center space-x-3 mb-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              trade.direction === 'LONG' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                            }`}>
                              {trade.direction}
                            </span>
                            <span className="text-white font-medium">${trade.entryPrice}</span>
                            <span className={`text-sm ${trade.status === 'CLOSED' ? 'text-green-400' : 'text-yellow-400'}`}>
                              {trade.status}
                            </span>
                          </div>
                          <p className="text-gray-400 text-sm">
                            {new Date(trade.entryTime).toLocaleString()}
                          </p>
                        </div>
                        {trade.pnl && (
                          <div className={`text-right ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            <p className="font-medium">${trade.pnl.toFixed(2)}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-6">Agent Settings</h2>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Risk per Trade (%)
                    </label>
                    <input
                      type="number"
                      value={settings.riskPerTrade}
                      onChange={(e) => setSettings({ ...settings, riskPerTrade: parseFloat(e.target.value) || 1.0 })}
                      className="input w-full"
                      min="0.1"
                      max="5"
                      step="0.1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Max Concurrent Trades
                    </label>
                    <input
                      type="number"
                      value={settings.maxConcurrentTrades}
                      onChange={(e) => setSettings({ ...settings, maxConcurrentTrades: parseInt(e.target.value) || 1 })}
                      className="input w-full"
                      min="1"
                      max="2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Max Trades per Day
                    </label>
                    <input
                      type="number"
                      value={settings.maxTradesPerDay}
                      onChange={(e) => setSettings({ ...settings, maxTradesPerDay: parseInt(e.target.value) || 6 })}
                      className="input w-full"
                      min="1"
                      max="10"
                    />
                  </div>
                </div>

                <div className="border-t border-purple-500/20 pt-6">
                  <h3 className="text-lg font-semibold text-white mb-4">Exchange API Credentials</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={settings.apiKey}
                        onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                        className="input w-full"
                        placeholder="Enter your exchange API key"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        API Secret
                      </label>
                      <input
                        type="password"
                        value={settings.apiSecret}
                        onChange={(e) => setSettings({ ...settings, apiSecret: e.target.value })}
                        className="input w-full"
                        placeholder="Enter your exchange API secret"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    onClick={handleUpdateSettings}
                    disabled={updatingSettings}
                    className="btn btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {updatingSettings ? 'Updating...' : '💾 Save Settings'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Trades Tab */}
          {activeTab === 'trades' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-white">Trade History</h2>
              {trades.length === 0 ? (
                <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-8 text-center">
                  <p className="text-gray-400">No trades yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {trades.map((trade) => (
                    <div key={trade.id} className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-sm border border-purple-500/30 rounded-xl p-6">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              trade.direction === 'LONG' ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                            }`}>
                              {trade.direction}
                            </span>
                            <span className="text-white font-medium">${trade.entryPrice}</span>
                            <span className={`text-sm ${trade.status === 'CLOSED' ? 'text-green-400' : 'text-yellow-400'}`}>
                              {trade.status}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-400 mt-4">
                            <div>
                              <span className="block text-gray-500">Entry Time</span>
                              <span className="text-white">{new Date(trade.entryTime).toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="block text-gray-500">Stop Loss</span>
                              <span className="text-white">${trade.stopLoss}</span>
                            </div>
                            <div>
                              <span className="block text-gray-500">Take Profit</span>
                              <span className="text-white">${trade.takeProfit}</span>
                            </div>
                            <div>
                              <span className="block text-gray-500">Quantity</span>
                              <span className="text-white">{trade.quantity}</span>
                            </div>
                          </div>
                          {trade.pnl && (
                            <div className="mt-4 pt-4 border-t border-purple-500/20">
                              <div className={`text-lg font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                P&L: ${trade.pnl.toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {toast && <Toast message={toast.message} type={toast.type} />}
      </div>
    </ErrorBoundary>
  );
}