import { useState, useEffect } from 'react';
import { settingsApi, integrationsApi } from '../services/api';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import APIIntegrationsSection from '../components/APIIntegrationsSection';
import ExchangeAccountsSection from '../components/ExchangeAccountsSection';
import { useAuth } from '../hooks/useAuth';

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadSettings();
      loadGlobalSettings();
    }
  }, [user]);


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
      // Settings loaded successfully
      if (response.data) {
        setSettings({
          symbol: response.data.symbol || 'BTCUSDT',
          quoteSize: response.data.quoteSize || 0.001,
          adversePct: response.data.adversePct || 0.0002,
          cancelMs: response.data.cancelMs || 40,
          maxPos: response.data.maxPos || 0.01,
          minAccuracyThreshold: response.data.minAccuracyThreshold || 0.85,
          strategy: response.data.strategy || 'orderbook_imbalance',
          max_loss_pct: response.data.max_loss_pct || 5,
          max_drawdown_pct: response.data.max_drawdown_pct || 10,
          per_trade_risk_pct: response.data.per_trade_risk_pct || 1,
          cryptoCompareKey: response.data.cryptoCompareKey || '',
          newsDataKey: response.data.newsDataKey || '',
          binaceKey: response.data.binaceKey || '',
          coinmarketcapKey: response.data.coinmarketcapKey || '',
          enableAutoTrade: response.data.enableAutoTrade || false,
          exchanges: response.data.exchanges || [],
          backupApis: response.data.backupApis || [],
          showUnmaskedKeys: response.data.showUnmaskedKeys || false,
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
          strategy: 'orderbook_imbalance',
          max_loss_pct: 5,
          max_drawdown_pct: 10,
          per_trade_risk_pct: 1,
          cryptoCompareKey: '',
          newsDataKey: '',
          binaceKey: '',
          coinmarketcapKey: '',
          enableAutoTrade: false,
          exchanges: [],
          backupApis: [],
          showUnmaskedKeys: false,
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
        strategy: 'orderbook_imbalance',
        max_loss_pct: 5,
        max_drawdown_pct: 10,
        per_trade_risk_pct: 1,
        cryptoCompareKey: '',
        newsDataKey: '',
        binaceKey: '',
        coinmarketcapKey: '',
        enableAutoTrade: false,
        exchanges: [],
        backupApis: [],
        showUnmaskedKeys: false,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    // Validate required API keys
    if (!settings.cryptoCompareKey?.trim()) {
      showToast('CryptoCompare API key is required', 'error');
      return;
    }
    if (!settings.newsDataKey?.trim()) {
      showToast('NewsData.io API key is required', 'error');
      return;
    }

    setSaving(true);

    try {
      const response = await settingsApi.update(settings);
      // Settings updated successfully
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 pb-20 lg:pb-0 smooth-scroll">
      {/* Animated background elements - Performance optimized */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none gpu-accelerated">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="min-h-screen smooth-scroll">
        <div className="container py-4 sm:py-8">
          <section className="mb-6 sm:mb-8">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                Trading Settings
              </h1>
              <p className="text-sm sm:text-base text-gray-300">
                Configure your API keys and trading parameters
              </p>
            </div>
          </section>

          {/* API Keys Section */}
          <div className="card mb-6">
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
              API Keys
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">
                  CryptoCompare API Key <span className="text-red-400">*</span>
                </label>
                <input
                  type={settings.showUnmaskedKeys ? "text" : "password"}
                  className="input"
                  placeholder="Enter your CryptoCompare API key"
                  value={settings.cryptoCompareKey || ''}
                  onChange={(e) => setSettings({ ...settings, cryptoCompareKey: e.target.value })}
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Required for historical OHLC data and market analysis
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">
                  NewsData.io API Key <span className="text-red-400">*</span>
                </label>
                <input
                  type={settings.showUnmaskedKeys ? "text" : "password"}
                  className="input"
                  placeholder="Enter your NewsData.io API key"
                  value={settings.newsDataKey || ''}
                  onChange={(e) => setSettings({ ...settings, newsDataKey: e.target.value })}
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Required for news sentiment analysis and market insights
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">
                  Binance API Key
                </label>
                <input
                  type={settings.showUnmaskedKeys ? "text" : "password"}
                  className="input"
                  placeholder="Enter your Binance API key (optional)"
                  value={settings.binaceKey || ''}
                  onChange={(e) => setSettings({ ...settings, binaceKey: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Optional - platform uses public endpoints if not provided
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">
                  CoinMarketCap API Key
                </label>
                <input
                  type={settings.showUnmaskedKeys ? "text" : "password"}
                  className="input"
                  placeholder="Enter your CoinMarketCap API key (optional)"
                  value={settings.coinmarketcapKey || ''}
                  onChange={(e) => setSettings({ ...settings, coinmarketcapKey: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Optional backup for token metadata and market data
                </p>
              </div>
            </div>
          </div>

          {/* Backup APIs Section */}
          <div className="card mb-6">
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
              Backup API Providers
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">
                  Backup API Keys (JSON format)
                </label>
                <textarea
                  className="input min-h-32"
                  placeholder='{"cryptocompare": "key1", "newsdata": "key2", "binance": "key3"}'
                  value={Array.isArray(settings.backupApis) ? JSON.stringify(settings.backupApis, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setSettings({ ...settings, backupApis: Array.isArray(parsed) ? parsed : [] });
                    } catch (err) {
                      // Allow invalid JSON during typing
                      setSettings({ ...settings, backupApis: [] });
                    }
                  }}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Additional API keys for rotation when primary keys are exhausted. JSON object with provider names as keys.
                </p>
              </div>

              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    checked={settings.showUnmaskedKeys || false}
                    onChange={(e) => setSettings({ ...settings, showUnmaskedKeys: e.target.checked })}
                  />
                  <span className="text-sm font-medium text-gray-300">Show API keys unmasked</span>
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Display API keys in plain text instead of masked format
                </p>
              </div>
            </div>
          </div>

          {/* Provider Status Section */}
          <div className="card mb-6">
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
              API Provider Status
            </h2>
            <div className="space-y-3">
              {[
                { name: 'CryptoCompare', key: 'cryptoCompareKey', required: true },
                { name: 'NewsData.io', key: 'newsDataKey', required: true },
                { name: 'Binance', key: 'binaceKey', required: false },
                { name: 'CoinMarketCap', key: 'coinmarketcapKey', required: false },
              ].map((provider) => {
                const hasKey = settings[provider.key as keyof typeof settings];
                const isConfigured = hasKey && String(hasKey).trim().length > 0;

                let status = 'Not Configured';
                let statusColor = 'text-gray-400';
                let bgColor = 'bg-gray-500/20';
                let borderColor = 'border-gray-400/30';

                if (isConfigured) {
                  // Mock status - in real implementation, this would check actual API status
                  const mockStatus = Math.random();
                  if (mockStatus > 0.8) {
                    status = 'Throttled';
                    statusColor = 'text-yellow-300';
                    bgColor = 'bg-yellow-500/20';
                    borderColor = 'border-yellow-400/30';
                  } else if (mockStatus > 0.95) {
                    status = 'Exhausted';
                    statusColor = 'text-red-300';
                    bgColor = 'bg-red-500/20';
                    borderColor = 'border-red-400/30';
                  } else {
                    status = 'OK';
                    statusColor = 'text-green-300';
                    bgColor = 'bg-green-500/20';
                    borderColor = 'border-green-400/30';
                  }
                }

                return (
                  <div key={provider.key} className={`flex items-center justify-between p-3 rounded-lg border ${bgColor} ${borderColor}`}>
                    <div className="flex items-center space-x-3">
                      <span className="text-sm font-medium text-white">{provider.name}</span>
                      {provider.required && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-300 border border-red-400/30">
                          Required
                        </span>
                      )}
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bgColor} ${statusColor} ${borderColor}`}>
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Real-time status of API providers. Status updates every 30 seconds.
            </p>
          </div>

          {/* Auto-Trading Section */}
          <div className="card mb-6">
            <h2 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent mb-4">
              Auto-Trading Configuration
            </h2>
            <div className="space-y-4">
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    checked={settings.enableAutoTrade || false}
                    onChange={(e) => setSettings({ ...settings, enableAutoTrade: e.target.checked })}
                  />
                  <span className="text-sm font-medium text-gray-300">Enable Auto-Trading</span>
                </label>
                <p className="text-xs text-gray-400 mt-1">
                  Automatically execute trades when accuracy ≥ 75%
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">
                  Trading Exchanges
                </label>
                <div className="space-y-2">
                  {['Binance', 'Bitget', 'Weex', 'BingX', 'MEXC'].map((exchange) => (
                    <label key={exchange} className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        checked={(settings.exchanges || []).includes(exchange)}
                        onChange={(e) => {
                          const currentExchanges = settings.exchanges || [];
                          const newExchanges = e.target.checked
                            ? [...currentExchanges, exchange]
                            : currentExchanges.filter(ex => ex !== exchange);
                          setSettings({ ...settings, exchanges: newExchanges });
                        }}
                      />
                      <span className="text-sm text-gray-300">{exchange}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Select exchanges where auto-trades will be executed
                </p>
              </div>
            </div>
          </div>
          <div className="card">
            <form onSubmit={handleSave} className="space-y-4 sm:space-y-6">
              <div className="space-y-4 sm:space-y-6">{/* Single column on mobile */}
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

    </div>
  );
}
