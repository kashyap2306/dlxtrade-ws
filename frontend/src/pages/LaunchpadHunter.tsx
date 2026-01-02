import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { agentsApi } from '../services/api';
import { ErrorBoundary } from '../components/ErrorBoundary';
import Toast from '../components/Toast';

interface LaunchpadAlert {
  id: string;
  presaleId: string;
  presaleName: string;
  chain: string;
  status: 'upcoming' | 'live';
  launchDate: number;
  softCap: number;
  hardCap: number;
  isVerified: boolean;
  liquidityLocked: boolean;
  teamInfo: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: number;
}

interface LaunchpadSettings {
  enabled: boolean;
  selectedChains: string[];
  alertTypes: string[];
  maxAlertsPerDay: number;
  riskFilter: 'all' | 'low';
  apiKeys: {
    etherscan?: string;
    bscscan?: string;
    coingecko?: string;
    pinklock?: string;
  };
}

interface DashboardData {
  alerts: LaunchpadAlert[];
  settings: LaunchpadSettings;
  stats: {
    totalAlerts: number;
    activePresales: number;
    upcomingPresales: number;
  };
}

export default function LaunchpadHunter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [alertsHistory, setAlertsHistory] = useState<LaunchpadAlert[]>([]);
  const [settings, setSettings] = useState<LaunchpadSettings>({
    enabled: true,
    selectedChains: ['ETH', 'BSC'],
    alertTypes: ['upcoming', 'live'],
    maxAlertsPerDay: 10,
    riskFilter: 'all',
    apiKeys: {},
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const response = await agentsApi.getLaunchpadDashboard();
      setDashboardData(response.data);
      setSettings(response.data.settings);

      // Load full alerts history
      const alertsResponse = await agentsApi.getLaunchpadAlerts();
      setAlertsHistory(alertsResponse.data.alerts);
    } catch (error: any) {
      if (error.response?.status === 403) {
        setToast({ message: 'Access denied: Launchpad Hunter not approved', type: 'error' });
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
      await agentsApi.updateLaunchpadSettings(settings);
      setToast({ message: 'Settings saved successfully', type: 'success' });
      await loadDashboardData(); // Refresh data
    } catch (error: any) {
      setToast({ message: error.response?.data?.error || 'Failed to save settings', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low': return 'text-green-400 bg-green-500/20';
      case 'medium': return 'text-yellow-400 bg-yellow-500/20';
      case 'high': return 'text-red-400 bg-red-500/20';
      default: return 'text-gray-400 bg-gray-500/20';
    }
  };

  const getRiskText = (alert: any) => {
    let reasons: string[] = [];

    if (!alert.isVerified) reasons.push('Contract not verified');
    if (!alert.liquidityLocked) reasons.push('Liquidity not locked');
    if (!alert.teamInfo) reasons.push('No team info');
    if (alert.coingeckoExists) reasons.push('Token already exists');

    const riskLevel = reasons.length <= 1 ? 'low' : reasons.length <= 3 ? 'medium' : 'high';

    const emoji = riskLevel === 'low' ? '🟢' : riskLevel === 'medium' ? '🟡' : '🔴';
    const label = riskLevel === 'low' ? 'Looks OK' : riskLevel === 'medium' ? 'Moderate Risk' : 'High Risk';

    return `${emoji} ${label}${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''}`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const formatCountdown = (launchDate: number) => {
    const now = Date.now();
    const diff = launchDate - now;

    if (diff <= 0) return 'Started';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
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
                  🚀 Launchpad Hunter & Presale Sniper
                </h1>
                <p className="text-gray-400 mt-1">Track upcoming presales and get early access alerts</p>
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
          {/* Stats Cards */}
          {dashboardData && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    📊
                  </div>
                  <h3 className="text-lg font-semibold text-white">Total Alerts</h3>
                </div>
                <div className="text-2xl font-bold text-blue-400">{dashboardData.stats.totalAlerts}</div>
                <p className="text-sm text-gray-400">Generated for you</p>
              </div>

              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    🔥
                  </div>
                  <h3 className="text-lg font-semibold text-white">Live Presales</h3>
                </div>
                <div className="text-2xl font-bold text-green-400">{dashboardData.stats.activePresales}</div>
                <p className="text-sm text-gray-400">Currently active</p>
              </div>

              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                    ⏰
                  </div>
                  <h3 className="text-lg font-semibold text-white">Upcoming</h3>
                </div>
                <div className="text-2xl font-bold text-orange-400">{dashboardData.stats.upcomingPresales}</div>
                <p className="text-sm text-gray-400">Starting soon</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Recent Alerts */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">📢 Recent Alerts</h2>
                {dashboardData && dashboardData.alerts.length > 0 ? (
                  <div className="space-y-3">
                    {dashboardData.alerts.slice(0, 5).map((alert) => (
                      <div key={alert.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h3 className="font-semibold text-white">{alert.presaleName}</h3>
                            <div className="flex items-center gap-2 text-sm text-gray-400 mt-1">
                              <span>{alert.chain}</span>
                              <span>•</span>
                              <span className={`px-2 py-1 rounded text-xs ${
                                alert.status === 'live' ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'
                              }`}>
                                {alert.status === 'live' ? '🔥 Live' : '⏰ Upcoming'}
                              </span>
                            </div>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${getRiskColor(alert.riskLevel)}`}>
                            {getRiskText(alert)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-sm mt-3">
                          <div className="text-gray-400">
                            {alert.status === 'upcoming' && alert.launchDate > Date.now() && (
                              <>⏱️ {formatCountdown(alert.launchDate)}</>
                            )}
                          </div>
                          <div className="text-gray-400">
                            {formatTimeAgo(alert.createdAt)}
                          </div>
                        </div>

                        {/* Enhanced Safety Flags */}
                        <div className="flex flex-wrap gap-1 mt-3">
                          <span className={`text-xs px-2 py-1 rounded ${
                            alert.isVerified ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                          }`}>
                            {alert.isVerified ? '✓ Contract Verified' : '✗ Contract Not Verified'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            alert.liquidityLocked ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                          }`}>
                            {alert.liquidityLocked ? '🔒 Liquidity Locked' : '🔓 Liquidity Unlocked'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            alert.teamInfo ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                          }`}>
                            {alert.teamInfo ? '👥 Team Info' : '❓ No Team Info'}
                          </span>
                          {(alert as any).coingeckoExists !== undefined && (
                            <span className={`text-xs px-2 py-1 rounded ${
                              (alert as any).coingeckoExists ? 'bg-yellow-500/20 text-yellow-300' : 'bg-green-500/20 text-green-300'
                            }`}>
                              {(alert as any).coingeckoExists ? '⚠️ Token Exists on CG' : '✅ New Token'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-gray-400 py-8">
                    <div className="text-4xl mb-2">📭</div>
                    <p>No alerts yet. Configure your settings to start receiving notifications.</p>
                  </div>
                )}
              </div>

              {/* Alert History */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">📋 Alert History</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {alertsHistory.slice(0, 20).map((alert) => (
                    <div key={alert.id} className="flex items-center justify-between py-2 border-b border-slate-700/50">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{alert.presaleName}</div>
                        <div className="text-xs text-gray-400">
                          {alert.chain} • {alert.status} • {formatTimeAgo(alert.createdAt)}
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ml-2 ${getRiskColor(alert.riskLevel)}`}>
                        {alert.riskLevel.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
                {alertsHistory.length === 0 && (
                  <div className="text-center text-gray-400 py-4">
                    <p className="text-sm">No alert history yet</p>
                  </div>
                )}
              </div>
            </div>

            {/* Settings Panel */}
            <div className="space-y-6">
              {/* Alert Controls */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">⚙️ Alert Controls</h2>
                <div className="space-y-4">
                  {/* Enable/Disable */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300">Enable Alerts</label>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.enabled}
                        onChange={(e) => setSettings({...settings, enabled: e.target.checked})}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                  </div>

                  {/* Chain Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Chains to Monitor</label>
                    <div className="space-y-2">
                      {['ETH', 'BSC', 'Polygon', 'Arbitrum', 'Avalanche', 'Fantom'].map((chain) => (
                        <label key={chain} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={settings.selectedChains.includes(chain)}
                            onChange={(e) => {
                              const newChains = e.target.checked
                                ? [...settings.selectedChains, chain]
                                : settings.selectedChains.filter(c => c !== chain);
                              setSettings({...settings, selectedChains: newChains});
                            }}
                            className="mr-2 w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
                          />
                          <span className="text-sm text-gray-300">{chain}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Alert Types */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Alert Types</label>
                    <div className="space-y-2">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.alertTypes.includes('upcoming')}
                          onChange={(e) => {
                            const newTypes = e.target.checked
                              ? [...settings.alertTypes, 'upcoming']
                              : settings.alertTypes.filter(t => t !== 'upcoming');
                            setSettings({...settings, alertTypes: newTypes});
                          }}
                          className="mr-2 w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-300">Upcoming Presales</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.alertTypes.includes('live')}
                          onChange={(e) => {
                            const newTypes = e.target.checked
                              ? [...settings.alertTypes, 'live']
                              : settings.alertTypes.filter(t => t !== 'live');
                            setSettings({...settings, alertTypes: newTypes});
                          }}
                          className="mr-2 w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
                        />
                        <span className="text-sm text-gray-300">Live Presales</span>
                      </label>
                    </div>
                  </div>

                  {/* Risk Filter */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Risk Filter</label>
                    <select
                      value={settings.riskFilter}
                      onChange={(e) => setSettings({...settings, riskFilter: e.target.value as 'all' | 'low'})}
                      className="input w-full"
                    >
                      <option value="all">All Alerts (including risky)</option>
                      <option value="low">Low Risk Only (recommended)</option>
                    </select>
                  </div>

                  {/* Max Alerts */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Max Alerts Per Day: {settings.maxAlertsPerDay}
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="50"
                      value={settings.maxAlertsPerDay}
                      onChange={(e) => setSettings({...settings, maxAlertsPerDay: parseInt(e.target.value)})}
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

              {/* API Keys */}
              <div className="bg-slate-800/40 backdrop-blur-xl border border-purple-500/20 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-white mb-4">🔑 API Keys (Optional)</h2>
                <p className="text-sm text-gray-400 mb-4">
                  Provide API keys for enhanced safety checks on specific chains.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Etherscan API Key</label>
                    <input
                      type="password"
                      value={settings.apiKeys.etherscan || ''}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: {...settings.apiKeys, etherscan: e.target.value}
                      })}
                      className="input w-full"
                      placeholder="Enter Etherscan API key"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">BscScan API Key</label>
                    <input
                      type="password"
                      value={settings.apiKeys.bscscan || ''}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: {...settings.apiKeys, bscscan: e.target.value}
                      })}
                      className="input w-full"
                      placeholder="Enter BscScan API key"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">CoinGecko API Key (Optional)</label>
                    <input
                      type="password"
                      value={settings.apiKeys.coingecko || ''}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: {...settings.apiKeys, coingecko: e.target.value}
                      })}
                      className="input w-full"
                      placeholder="Enter CoinGecko API key"
                    />
                    <p className="text-xs text-gray-500 mt-1">Free API key available at coingecko.com</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">PinkLock API Key (Optional)</label>
                    <input
                      type="password"
                      value={settings.apiKeys.pinklock || ''}
                      onChange={(e) => setSettings({
                        ...settings,
                        apiKeys: {...settings.apiKeys, pinklock: e.target.value}
                      })}
                      className="input w-full"
                      placeholder="Enter PinkLock API key"
                    />
                    <p className="text-xs text-gray-500 mt-1">For enhanced liquidity lock verification</p>
                  </div>
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="btn btn-secondary w-full disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : '🔐 Save API Keys'}
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
