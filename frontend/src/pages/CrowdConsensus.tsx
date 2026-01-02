import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import Toast from '../components/Toast';

interface ConsensusSignal {
  id?: string;
  symbol: string;
  direction: 'long' | 'short';
  exchangesConfirmed: string[];
  strengthScore: number;
  avgPrice: number;
  totalVolume: number;
  timestamp: number;
}

interface CrowdConsensusSettings {
  autoTradeEnabled: boolean;
  selectedAutoTradeExchange: string;
  riskPercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  leverage: number;
  maxDailyLossPercent: number;
}

interface DashboardData {
  signals: ConsensusSignal[];
  settings: CrowdConsensusSettings;
  currentConsensus: ConsensusSignal[];
  stats: {
    totalSignals: number;
    activeConsensus: number;
    exchangesMonitored: number;
  };
}

export default function CrowdConsensus() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [settings, setSettings] = useState<CrowdConsensusSettings>({
    autoTradeEnabled: false,
    selectedAutoTradeExchange: '',
    riskPercent: 1,
    stopLossPercent: 2,
    takeProfitPercent: 4,
    leverage: 1,
    maxDailyLossPercent: 5,
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const supportedExchanges = [
    'binance', 'bybit', 'bitget', 'okx', 'kucoin',
    'bingx', 'gate', 'mexc', 'phemex', 'coinex'
  ];

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const response = await agentsApi.getCrowdConsensusDashboard();
      setDashboardData(response.data);
      setSettings(response.data.settings);
    } catch (error: any) {
      if (error.response?.status === 403) {
        setToast({ message: 'Access denied: Crowd Consensus Copy Trade not approved', type: 'error' });
        setTimeout(() => navigate('/agents'), 2000);
      } else {
        setToast({ message: 'Failed to load dashboard', type: 'error' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await agentsApi.updateCrowdConsensusSettings(settings);
      setToast({ message: 'Settings saved successfully', type: 'success' });
      await loadDashboardData(); // Refresh data
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Failed to save settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const getDirectionColor = (direction: string) => {
    return direction === 'long' ? 'text-green-400 bg-green-500/20' : 'text-red-400 bg-red-500/20';
  };

  const getDirectionEmoji = (direction: string) => {
    return direction === 'long' ? '📈' : '📉';
  };

  const getStrengthColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const formatPrice = (price: number) => {
    return price < 1 ? price.toFixed(6) : price.toFixed(2);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1e9) return `${(volume / 1e9).toFixed(1)}B`;
    if (volume >= 1e6) return `${(volume / 1e6).toFixed(1)}M`;
    if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`;
    return volume.toFixed(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-800/70 via-slate-800/50 to-slate-900/70 backdrop-blur-xl border-b border-purple-500/20">
          <div className="container mx-auto px-4 py-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  👥 Crowd Consensus Copy Trade
                </h1>
                <p className="text-gray-400 mt-1">Follow market consensus across multiple exchanges</p>
              </div>
              <button
                onClick={() => navigate('/agents')}
                className="btn btn-secondary"
              >
                ← Back to Agents
              </button>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-6">
          {/* Warning Banner */}
          <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="text-yellow-400 mt-0.5">⚠️</div>
              <div>
                <h4 className="text-sm font-medium text-yellow-300 mb-1">Important Notice</h4>
                <p className="text-sm text-yellow-200/80">
                  This agent follows crowd consensus across exchanges and does NOT access individual trader data, entries, SL/TP, or leverage settings. Only public market data is used.
                </p>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          {dashboardData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    📊
                  </div>
                  <h3 className="text-lg font-semibold text-white">Total Signals</h3>
                </div>
                <div className="text-2xl font-bold text-blue-400">{dashboardData.stats.totalSignals}</div>
                <p className="text-sm text-gray-400">Generated for you</p>
              </div>

              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    🎯
                  </div>
                  <h3 className="text-lg font-semibold text-white">Active Consensus</h3>
                </div>
                <div className="text-2xl font-bold text-green-400">{dashboardData.stats.activeConsensus}</div>
                <p className="text-sm text-gray-400">Coins with strong signals</p>
              </div>

              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    🌐
                  </div>
                  <h3 className="text-lg font-semibold text-white">Exchanges</h3>
                </div>
                <div className="text-2xl font-bold text-purple-400">{dashboardData.stats.exchangesMonitored}</div>
                <p className="text-sm text-gray-400">Monitored for consensus</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Current Consensus Signals */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">🎯 Current Consensus Signals</h2>
                {dashboardData && dashboardData.currentConsensus.length > 0 ? (
                  <div className="space-y-3">
                    {dashboardData.currentConsensus.map((signal, index) => (
                      <div key={`${signal.symbol}-${index}`} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className={`px-3 py-1 rounded-full text-sm font-semibold ${getDirectionColor(signal.direction)}`}>
                              {getDirectionEmoji(signal.direction)} {signal.direction.toUpperCase()}
                            </div>
                            <div className="text-white font-bold text-lg">{signal.symbol.replace('USDT', '')}</div>
                          </div>
                          <div className={`text-sm font-semibold ${getStrengthColor(signal.strengthScore)}`}>
                            Strength: {signal.strengthScore}%
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <div className="text-gray-400">Price</div>
                            <div className="text-white font-semibold">${formatPrice(signal.avgPrice)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400">24h Volume</div>
                            <div className="text-white font-semibold">{formatVolume(signal.totalVolume)}</div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="text-gray-400 text-sm mb-2">Confirming Exchanges ({signal.exchangesConfirmed.length})</div>
                          <div className="flex flex-wrap gap-1">
                            {signal.exchangesConfirmed.map((exchange) => (
                              <span key={exchange} className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs">
                                {exchange}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8">
                    <div className="text-4xl mb-2">🔍</div>
                    <p>No consensus signals detected at the moment.</p>
                    <p className="text-sm mt-2">Signals appear when multiple exchanges agree on direction.</p>
                  </div>
                )}
              </div>

              {/* Signal History */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">📋 Signal History</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {dashboardData && dashboardData.signals.slice(0, 20).map((signal) => (
                    <div key={signal.id || `${signal.symbol}-${signal.timestamp}`} className="flex items-center justify-between py-2 border-b border-slate-700/50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded ${getDirectionColor(signal.direction)}`}>
                            {getDirectionEmoji(signal.direction)}
                          </span>
                          <div className="text-white font-medium truncate">{signal.symbol.replace('USDT', '')}</div>
                        </div>
                        <div className="text-xs text-gray-400">
                          {signal.exchangesConfirmed.length} exchanges • {formatTimeAgo(signal.timestamp)}
                        </div>
                      </div>
                      <span className={`text-xs font-semibold ${getStrengthColor(signal.strengthScore)}`}>
                        {signal.strengthScore}%
                      </span>
                    </div>
                  ))}
                </div>
                {dashboardData && dashboardData.signals.length === 0 && (
                  <div className="text-center text-gray-400 py-4">
                    <p className="text-sm">No signal history yet</p>
                  </div>
                )}
              </div>
            </div>

            {/* Settings Panel */}
            <div className="space-y-6">
              {/* Auto Trade Controls */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">🤖 Auto Trade Controls</h2>
                <div className="space-y-4">
                  {/* Auto Trade Toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">Enable Auto Trading</label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.autoTradeEnabled}
                        onChange={(e) => setSettings({...settings, autoTradeEnabled: e.target.checked})}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                  </div>

                  {/* Exchange Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Auto Trade Exchange</label>
                    <select
                      value={settings.selectedAutoTradeExchange}
                      onChange={(e) => setSettings({...settings, selectedAutoTradeExchange: e.target.value})}
                      className="input w-full"
                      disabled={!settings.autoTradeEnabled}
                    >
                      <option value="">Select exchange...</option>
                      {supportedExchanges.map((exchange) => (
                        <option key={exchange} value={exchange}>
                          {exchange.charAt(0).toUpperCase() + exchange.slice(1)}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      You must have API keys configured for this exchange
                    </p>
                  </div>

                  {settings.autoTradeEnabled && (
                    <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3">
                      <p className="text-yellow-300 text-sm">
                        ⚠️ Auto trading is enabled. Ensure you have sufficient balance and API keys configured for {settings.selectedAutoTradeExchange}.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Risk Settings */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">⚙️ Risk Settings</h2>
                <div className="space-y-4">
                  {/* Risk Percent */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Risk Per Trade: {settings.riskPercent}%
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="5"
                      step="0.1"
                      value={settings.riskPercent}
                      onChange={(e) => setSettings({...settings, riskPercent: parseFloat(e.target.value)})}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Stop Loss */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Stop Loss: {settings.stopLossPercent}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="10"
                      step="0.5"
                      value={settings.stopLossPercent}
                      onChange={(e) => setSettings({...settings, stopLossPercent: parseFloat(e.target.value)})}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Take Profit */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Take Profit: {settings.takeProfitPercent}%
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="0.5"
                      value={settings.takeProfitPercent}
                      onChange={(e) => setSettings({...settings, takeProfitPercent: parseFloat(e.target.value)})}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Leverage */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Leverage: {settings.leverage}x
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={settings.leverage}
                      onChange={(e) => setSettings({...settings, leverage: parseInt(e.target.value)})}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Max Daily Loss */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Max Daily Loss: {settings.maxDailyLossPercent}%
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="0.5"
                      value={settings.maxDailyLossPercent}
                      onChange={(e) => setSettings({...settings, maxDailyLossPercent: parseFloat(e.target.value)})}
                      className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="btn btn-primary w-full disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : '💾 Save Settings'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} />}
    </ErrorBoundary>
  );
}
