import { useState, useEffect } from 'react';
import { settingsApi, integrationsApi } from '../services/api';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import APIIntegrationsSection from '../components/APIIntegrationsSection';
import ExchangeAccountsSection from '../components/ExchangeAccountsSection';
import { useAuth } from '../hooks/useAuth';

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showLiveModeModal, setShowLiveModeModal] = useState(false);
  const [liveModeConfirm, setLiveModeConfirm] = useState('');
  const [hasBinance, setHasBinance] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadSettings();
      checkBinanceIntegration();
      loadGlobalSettings();
    }
  }, [user]);

  const checkBinanceIntegration = async () => {
    try {
      const response = await integrationsApi.load();
      console.log('Settings integrations API response:', response.data);
      const integrations = response.data;
      setHasBinance(integrations.binance?.enabled && !!integrations.binance?.apiKey);
    } catch (err: any) {
      console.error('Error checking Binance integration:', err);
      console.error('Error details:', err.response?.data);
    }
  };


  const loadGlobalSettings = async () => {
    try {
      const response = await settingsApi.load();
      // Global settings would be loaded from /api/settings/global/load if user is admin
      // For now, we'll just load user settings
      // Admin can access global settings via admin panel
    } catch (err) {
      console.error('Error loading global settings:', err);
    }
  };

  const loadSettings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await settingsApi.load();
      console.log('Settings API response:', response.data);
      if (response.data) {
        setSettings({
          symbol: response.data.symbol || 'BTCUSDT',
          quoteSize: response.data.quoteSize || 0.001,
          adversePct: response.data.adversePct || 0.0002,
          cancelMs: response.data.cancelMs || 40,
          maxPos: response.data.maxPos || 0.01,
          minAccuracyThreshold: response.data.minAccuracyThreshold || 0.85,
          autoTradeEnabled: response.data.autoTradeEnabled || false,
          strategy: response.data.strategy || 'orderbook_imbalance',
          liveMode: response.data.liveMode || false,
          max_loss_pct: response.data.max_loss_pct || 5,
          max_drawdown_pct: response.data.max_drawdown_pct || 10,
          per_trade_risk_pct: response.data.per_trade_risk_pct || 1,
        });
      } else {
        // Initialize with defaults if no settings exist
        setSettings({
          symbol: 'BTCUSDT',
          quoteSize: 0.001,
          adversePct: 0.0002,
          cancelMs: 40,
          maxPos: 0.01,
          minAccuracyThreshold: 0.85,
          autoTradeEnabled: false,
          strategy: 'orderbook_imbalance',
          liveMode: false,
          max_loss_pct: 5,
          max_drawdown_pct: 10,
          per_trade_risk_pct: 1,
        });
      }
    } catch (err: any) {
      console.error('Error loading settings:', err);
      showToast(err.response?.data?.error || 'Error loading settings', 'error');
      // Set defaults on error
      setSettings({
        symbol: 'BTCUSDT',
        quoteSize: 0.001,
        adversePct: 0.0002,
        cancelMs: 40,
        maxPos: 0.01,
        minAccuracyThreshold: 0.85,
        autoTradeEnabled: false,
        strategy: 'orderbook_imbalance',
        liveMode: false,
        max_loss_pct: 5,
        max_drawdown_pct: 10,
        per_trade_risk_pct: 1,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);

    try {
      const response = await settingsApi.update(settings);
      console.log('Settings update API response:', response.data);
      showToast('Settings saved successfully', 'success');
      // Reload settings to ensure sync
      await loadSettings();
    } catch (err: any) {
      console.error('Error saving settings:', err);
      showToast(err.response?.data?.error || 'Error saving settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAutoTradeToggle = async (enabled: boolean) => {
    if (enabled && !hasBinance) {
      showToast('Please add your Binance API keys first in Settings', 'error');
      return;
    }
    setSettings({ ...settings, autoTradeEnabled: enabled });
  };

  const handleLiveModeToggle = (enabled: boolean) => {
    if (enabled) {
      setShowLiveModeModal(true);
    } else {
      setSettings({ ...settings, liveMode: false });
    }
  };

  const confirmLiveMode = () => {
    if (liveModeConfirm.toUpperCase() === 'CONFIRM') {
      setSettings({ ...settings, liveMode: true });
      setShowLiveModeModal(false);
      setLiveModeConfirm('');
      showToast('Live trading mode enabled. Use with extreme caution!', 'error');
    } else {
      showToast('Please type CONFIRM to enable live trading', 'error');
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

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-lg text-white">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 pb-20 lg:pb-0">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto py-4 sm:py-8 px-4 sm:px-6 lg:px-8 pt-20 lg:pt-8">
          <div className="mb-6 sm:mb-8">
            <div className="lg:hidden mb-4">
              <Header
                title="Trading Settings"
                subtitle="Configure your trading parameters"
                onMenuToggle={() => {
                  const toggle = (window as any).__sidebarToggle;
                  if (toggle) toggle();
                }}
                menuOpen={(window as any).__sidebarOpen || false}
              />
            </div>
            <div className="hidden lg:block">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent mb-2">
                Trading Settings
              </h1>
              <p className="text-gray-300">Configure your trading parameters and preferences</p>
            </div>
          </div>
          <div className="card">
            <form onSubmit={handleSave} className="space-y-4 sm:space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Symbol</label>
                  <input
                    type="text"
                    className="input"
                    value={settings.symbol}
                    onChange={(e) => setSettings({ ...settings, symbol: e.target.value.toUpperCase() })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Quote Size</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="input"
                    value={settings.quoteSize}
                    onChange={(e) => setSettings({ ...settings, quoteSize: parseFloat(e.target.value) })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Adverse Selection %</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="input"
                    value={settings.adversePct}
                    onChange={(e) => setSettings({ ...settings, adversePct: parseFloat(e.target.value) })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Cancel Time (ms)</label>
                  <input
                    type="number"
                    className="input"
                    value={settings.cancelMs}
                    onChange={(e) => setSettings({ ...settings, cancelMs: parseInt(e.target.value, 10) })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Max Position</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="input"
                    value={settings.maxPos}
                    onChange={(e) => setSettings({ ...settings, maxPos: parseFloat(e.target.value) })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Min Accuracy Threshold</label>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min="0.5"
                      max="0.99"
                      step="0.01"
                      className="w-full"
                      value={settings.minAccuracyThreshold}
                      onChange={(e) => setSettings({ ...settings, minAccuracyThreshold: parseFloat(e.target.value) })}
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>50%</span>
                      <span className="font-semibold text-purple-400">{(settings.minAccuracyThreshold * 100).toFixed(0)}%</span>
                      <span>99%</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Trades will only execute if accuracy is above this threshold
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Strategy</label>
                  <select
                    className="input"
                    value={settings.strategy}
                    onChange={(e) => setSettings({ ...settings, strategy: e.target.value as any })}
                  >
                    <option value="orderbook_imbalance">Orderbook Imbalance</option>
                    <option value="smc_hybrid">SMC Hybrid</option>
                    <option value="stat_arb">Statistical Arbitrage (Stub)</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Trading strategy to use for execution (HFT strategy runs separately)
                  </p>
                </div>
              </div>

              {/* Risk Controls */}
              <div className="border-t border-purple-500/20 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Risk Controls</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-300">Max Daily Loss (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="input"
                      value={settings.max_loss_pct}
                      onChange={(e) => setSettings({ ...settings, max_loss_pct: parseFloat(e.target.value) })}
                    />
                    <p className="text-xs text-gray-400 mt-1">Engine pauses if daily loss exceeds this %</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-300">Max Drawdown (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="input"
                      value={settings.max_drawdown_pct}
                      onChange={(e) => setSettings({ ...settings, max_drawdown_pct: parseFloat(e.target.value) })}
                    />
                    <p className="text-xs text-gray-400 mt-1">Engine pauses if drawdown exceeds this %</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-300">Per-Trade Risk (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="input"
                      value={settings.per_trade_risk_pct}
                      onChange={(e) => setSettings({ ...settings, per_trade_risk_pct: parseFloat(e.target.value) })}
                    />
                    <p className="text-xs text-gray-400 mt-1">Maximum risk per individual trade</p>
                  </div>
                </div>
              </div>


              {/* Auto-Trade Settings */}
              <div className="border-t border-purple-500/20 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Auto-Trade Settings</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="flex items-center text-gray-300">
                      <input
                        type="checkbox"
                        checked={settings.autoTradeEnabled}
                        onChange={(e) => handleAutoTradeToggle(e.target.checked)}
                        disabled={!hasBinance}
                        className="mr-2 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded disabled:opacity-50"
                      />
                      <span className="font-medium">Enable Auto-Trade</span>
                    </label>
                    <p className="text-xs text-gray-400 mt-1 ml-6">
                      When enabled, trades will automatically execute when research accuracy meets the threshold
                      {!hasBinance && ' (Binance API keys required)'}
                    </p>
                  </div>

                  {settings.autoTradeEnabled && (
                    <div>
                      <label className="flex items-center text-gray-300">
                        <input
                          type="checkbox"
                          checked={settings.liveMode}
                          onChange={(e) => handleLiveModeToggle(e.target.checked)}
                          className="mr-2 h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                        />
                        <span className="font-medium text-red-400">Enable Live Trading Mode</span>
                      </label>
                      <p className="text-xs text-red-400 mt-1 ml-6">
                        ⚠️ WARNING: This will execute REAL trades with REAL money. Default is TESTNET mode.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="btn-mobile-full btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>

            {/* Exchange Accounts Section - Unified Exchange Management */}
            <ExchangeAccountsSection />

            {/* API Integrations Section */}
            <APIIntegrationsSection />
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Live Mode Confirmation Modal */}
      {showLiveModeModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-red-500/50 rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-2xl font-bold text-red-400 mb-4">⚠️ Enable Live Trading?</h3>
            <p className="text-gray-300 mb-4">
              You are about to enable <strong className="text-red-400">LIVE TRADING MODE</strong>. This will execute real trades with real money on Binance.
            </p>
            <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-300 font-medium mb-2">Before proceeding, confirm:</p>
              <ul className="text-xs text-red-200 space-y-1 list-disc list-inside">
                <li>Your API keys have NO withdrawal permission</li>
                <li>You understand the risks of automated trading</li>
                <li>You have tested on TESTNET first</li>
                <li>You are ready to monitor trades actively</li>
              </ul>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Type <strong className="text-red-400">CONFIRM</strong> to enable live trading:
              </label>
              <input
                type="text"
                className="input"
                value={liveModeConfirm}
                onChange={(e) => setLiveModeConfirm(e.target.value)}
                placeholder="Type CONFIRM"
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowLiveModeModal(false);
                  setLiveModeConfirm('');
                }}
                className="flex-1 btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirmLiveMode}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all"
              >
                Enable Live Mode
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
