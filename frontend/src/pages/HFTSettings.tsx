import { useState, useEffect } from 'react';
import { hftApi, settingsApi } from '../services/api';
import Toast from '../components/Toast';

export default function HFTSettings() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [hasBinance, setHasBinance] = useState(false);
  const [settings, setSettings] = useState({
    symbol: 'BTCUSDT',
    quoteSize: 0.001,
    adversePct: 0.0002,
    cancelMs: 40,
    maxPos: 0.01,
    minSpreadPct: 0.01,
    maxTradesPerDay: 500,
    enabled: false,
  });

  useEffect(() => {
    loadSettings();
    checkBinanceIntegration();
  }, []);

  const checkBinanceIntegration = async () => {
    try {
      const response = await settingsApi.providers.load();
      const integrations = response.data;
      setHasBinance(integrations.binance?.enabled && !!integrations.binance?.apiKey);
    } catch (err) {
      console.error('Error checking Binance integration:', err);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await hftApi.loadSettings();
      if (response.data) {
        setSettings({
          symbol: response.data.symbol || 'BTCUSDT',
          quoteSize: response.data.quoteSize || 0.001,
          adversePct: response.data.adversePct || 0.0002,
          cancelMs: response.data.cancelMs || 40,
          maxPos: response.data.maxPos || 0.01,
          minSpreadPct: response.data.minSpreadPct || 0.01,
          maxTradesPerDay: response.data.maxTradesPerDay || 500,
          enabled: response.data.enabled || false,
        });
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error loading HFT settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      await hftApi.updateSettings(settings);
      showToast('HFT settings saved', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Error saving HFT settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEnableToggle = (enabled: boolean) => {
    if (enabled && !hasBinance) {
      showToast('Please configure Binance integration first', 'error');
      return;
    }
    setSettings({ ...settings, enabled });
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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-lg text-white">Loading HFT settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-indigo-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <main className="min-h-screen">
        <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-400 bg-clip-text text-transparent mb-2">
              HFT Bot Settings
            </h1>
            <p className="text-gray-300">Configure high-frequency trading parameters</p>
          </div>
          <div className="card">
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  <p className="text-xs text-gray-400 mt-1">Orders auto-cancel after this time</p>
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
                  <label className="block text-sm font-medium mb-1 text-gray-300">Min Spread %</label>
                  <input
                    type="number"
                    step="0.001"
                    className="input"
                    value={settings.minSpreadPct}
                    onChange={(e) => setSettings({ ...settings, minSpreadPct: parseFloat(e.target.value) })}
                    required
                  />
                  <p className="text-xs text-gray-400 mt-1">Minimum spread required to place orders</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-300">Max Trades Per Day</label>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min="100"
                      max="2000"
                      step="50"
                      className="w-full"
                      value={settings.maxTradesPerDay}
                      onChange={(e) => setSettings({ ...settings, maxTradesPerDay: parseInt(e.target.value, 10) })}
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>100</span>
                      <span className="font-semibold text-blue-400">{settings.maxTradesPerDay}</span>
                      <span>2000</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Safe: 200-500 | Aggressive: 500-1000 | Extreme: 1000+
                  </p>
                </div>
              </div>

              {/* Enable HFT */}
              <div className="border-t border-blue-500/20 pt-6">
                <h3 className="text-lg font-semibold text-white mb-4">Enable HFT Bot</h3>
                <div>
                  <label className="flex items-center text-gray-300">
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(e) => handleEnableToggle(e.target.checked)}
                      disabled={!hasBinance}
                      className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                    />
                    <span className="font-medium">Enable HFT Bot</span>
                  </label>
                  <p className="text-xs text-gray-400 mt-1 ml-6">
                    When enabled, HFT bot will place maker orders continuously
                    {!hasBinance && ' (Binance integration required)'}
                  </p>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save HFT Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}

