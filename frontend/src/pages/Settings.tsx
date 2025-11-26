import React, { useState, useEffect } from 'react';
import { settingsApi, integrationsApi } from '../services/api';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../hooks/useAuth';
import {
  CheckCircleIcon,
  XCircleIcon,
  KeyIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import BinanceLogo from '../components/ui/BinanceLogo';
import BitgetLogo from '../components/ui/BitgetLogo';
import KuCoinLogo from '../components/ui/KuCoinLogo';
import OKXLogo from '../components/ui/OKXLogo';
import BingXLogo from '../components/ui/BingXLogo';
import MEXCLogo from '../components/ui/MEXCLogo';
import WeexLogo from '../components/ui/WeexLogo';

// Exchange definitions with required fields
const EXCHANGES = [
  {
    id: 'binance',
    name: 'Binance',
    logo: BinanceLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'weex',
    name: 'Weex',
    logo: WeexLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'bingx',
    name: 'BingX',
    logo: BingXLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'mexc',
    name: 'MEXC',
    logo: MEXCLogo,
    fields: ['apiKey', 'secretKey']
  },
  {
    id: 'bitget',
    name: 'Bitget',
    logo: BitgetLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  },
  {
    id: 'kucoin',
    name: 'KuCoin',
    logo: KuCoinLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  },
  {
    id: 'okx',
    name: 'OKX',
    logo: OKXLogo,
    fields: ['apiKey', 'secretKey', 'passphrase']
  }
];

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [selectedExchange, setSelectedExchange] = useState<string | null>(null);
  const [connectedExchange, setConnectedExchange] = useState<any>(null);
  const [exchangeForm, setExchangeForm] = useState({
    apiKey: '',
    secretKey: '',
    passphrase: ''
  });
  const [savingExchange, setSavingExchange] = useState(false);
  const [showSuccessPopup, setShowSuccessPopup] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnectingExchange, setDisconnectingExchange] = useState(false);
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

  const handleSaveProvider = async (providerName: string, requiredFields: string[] = []) => {
    if (!settings) return;

    // Validate required fields for this provider
    for (const field of requiredFields) {
      if (!settings[field]?.trim()) {
        showToast(`${field} is required`, 'error');
        return;
      }
    }

    setSavingProvider(providerName);

    try {
      const response = await settingsApi.update(settings);
      showToast(`${providerName} saved successfully`, 'success');
      await loadSettings();
    } catch (err: any) {
      console.error(`Error saving ${providerName}:`, err);
      showToast(err.response?.data?.error || `Error saving ${providerName}`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleExchangeSelect = (exchangeId: string) => {
    setSelectedExchange(exchangeId);
    setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
  };

  const handleSaveExchange = async () => {
    if (!selectedExchange) return;

    const exchange = EXCHANGES.find(e => e.id === selectedExchange);
    if (!exchange) return;

    // Validate required fields
    for (const field of exchange.fields) {
      if (!exchangeForm[field as keyof typeof exchangeForm]?.trim()) {
        showToast(`${field} is required for ${exchange.name}`, 'error');
        return;
      }
    }

    setSavingExchange(true);

    try {
      // Here you would typically call an API to save the exchange credentials
      // For now, we'll simulate the save and show success popup
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call

      // Set connected exchange
      setConnectedExchange({
        ...exchange,
        connectedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      });

      // Show success popup
      setShowSuccessPopup(true);
      setSelectedExchange(null);
      setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
    } catch (err: any) {
      console.error('Error saving exchange:', err);
      showToast('Error saving exchange', 'error');
    } finally {
      setSavingExchange(false);
    }
  };

  const handleDisconnectExchange = async () => {
    setDisconnectingExchange(true);

    try {
      // Here you would typically call an API to delete the exchange credentials
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API call

      setConnectedExchange(null);
      setShowDisconnectConfirm(false);
      showToast('Exchange disconnected successfully', 'success');
    } catch (err: any) {
      console.error('Error disconnecting exchange:', err);
      showToast('Error disconnecting exchange', 'error');
    } finally {
      setDisconnectingExchange(false);
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
            <p className="text-gray-400">Configure your trading parameters and API integrations</p>
          </div>

          <div className="space-y-8">
            {/* Trading Settings Section */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Trading Settings</h2>
                <p className="text-sm text-gray-400">Configure your core trading parameters</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Symbol</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.symbol}
                    onChange={(e) => setSettings({ ...settings, symbol: e.target.value.toUpperCase() })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Quote Size</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.quoteSize}
                    onChange={(e) => setSettings({ ...settings, quoteSize: parseFloat(e.target.value) })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Adverse Selection %</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.adversePct}
                    onChange={(e) => setSettings({ ...settings, adversePct: parseFloat(e.target.value) })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Cancel Time (ms)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.cancelMs}
                    onChange={(e) => setSettings({ ...settings, cancelMs: parseInt(e.target.value, 10) })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Position</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.maxPos}
                    onChange={(e) => setSettings({ ...settings, maxPos: parseFloat(e.target.value) })}
                    required
                  />
                </div>

                <div className="space-y-2 md:col-span-2 lg:col-span-1">
                  <label className="block text-sm font-medium text-gray-300">Strategy</label>
                  <select
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.strategy}
                    onChange={(e) => setSettings({ ...settings, strategy: e.target.value as any })}
                  >
                    <option value="orderbook_imbalance">Orderbook Imbalance</option>
                    <option value="smc_hybrid">SMC Hybrid</option>
                    <option value="stat_arb">Statistical Arbitrage (Stub)</option>
                  </select>
                </div>
              </div>

              {/* Min Accuracy Threshold */}
              <div className="mt-6 space-y-3">
                <label className="block text-sm font-medium text-gray-300">Min Accuracy Threshold</label>
                <div className="space-y-2">
                  <input
                    type="range"
                    min="0.5"
                    max="0.99"
                    step="0.01"
                    className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer slider"
                    value={settings.minAccuracyThreshold}
                    onChange={(e) => setSettings({ ...settings, minAccuracyThreshold: parseFloat(e.target.value) })}
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>50%</span>
                    <span className="font-semibold text-purple-400">{(settings.minAccuracyThreshold * 100).toFixed(0)}%</span>
                    <span>99%</span>
                  </div>
                </div>
                <p className="text-xs text-gray-400">Trades will only execute if accuracy is above this threshold</p>
              </div>
            </section>

            {/* Risk Controls Section */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Risk Controls</h2>
                <p className="text-sm text-gray-400">Configure your risk management parameters</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Daily Loss (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.max_loss_pct}
                    onChange={(e) => setSettings({ ...settings, max_loss_pct: parseFloat(e.target.value) })}
                  />
                  <p className="text-xs text-gray-400">Engine pauses if daily loss exceeds this %</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Drawdown (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.max_drawdown_pct}
                    onChange={(e) => setSettings({ ...settings, max_drawdown_pct: parseFloat(e.target.value) })}
                  />
                  <p className="text-xs text-gray-400">Engine pauses if drawdown exceeds this %</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Per-Trade Risk (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.per_trade_risk_pct}
                    onChange={(e) => setSettings({ ...settings, per_trade_risk_pct: parseFloat(e.target.value) })}
                  />
                  <p className="text-xs text-gray-400">Maximum risk per individual trade</p>
                </div>
              </div>
            </section>

            {/* API Integrations Section */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">API Integrations</h2>
                <p className="text-sm text-gray-400">Connect your data provider API keys</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* CryptoCompare */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-sm">CC</span>
                    </div>
                    <div>
                      <h3 className="text-white font-medium">CryptoCompare</h3>
                      <p className="text-xs text-gray-400">Market data & fundamentals</p>
                    </div>
                    {settings.cryptoCompareKey ? (
                      <CheckCircleIcon className="w-5 h-5 text-green-400" />
                    ) : (
                      <XCircleIcon className="w-5 h-5 text-red-400" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-400">API Key</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      value={settings.cryptoCompareKey}
                      onChange={(e) => setSettings({ ...settings, cryptoCompareKey: e.target.value })}
                      placeholder="Enter CryptoCompare API key"
                    />
                  </div>

                  <button
                    onClick={() => handleSaveProvider('CryptoCompare', ['cryptoCompareKey'])}
                    disabled={savingProvider === 'CryptoCompare'}
                    className="w-full px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {savingProvider === 'CryptoCompare' ? 'Saving...' : 'Save CryptoCompare'}
                  </button>
                </div>

                {/* NewsData */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-sm">📰</span>
                    </div>
                    <div>
                      <h3 className="text-white font-medium">NewsData</h3>
                      <p className="text-xs text-gray-400">News sentiment analysis</p>
                    </div>
                    {settings.newsDataKey ? (
                      <CheckCircleIcon className="w-5 h-5 text-green-400" />
                    ) : (
                      <XCircleIcon className="w-5 h-5 text-red-400" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-400">API Key</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      value={settings.newsDataKey}
                      onChange={(e) => setSettings({ ...settings, newsDataKey: e.target.value })}
                      placeholder="Enter NewsData API key"
                    />
                  </div>

                  <button
                    onClick={() => handleSaveProvider('NewsData', ['newsDataKey'])}
                    disabled={savingProvider === 'NewsData'}
                    className="w-full px-4 py-2 bg-green-500 text-white font-medium rounded-lg hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {savingProvider === 'NewsData' ? 'Saving...' : 'Save NewsData'}
                  </button>
                </div>

                {/* Binance Public */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-yellow-500 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-sm">🪙</span>
                    </div>
                    <div>
                      <h3 className="text-white font-medium">Binance Public</h3>
                      <p className="text-xs text-gray-400">Auto-enabled public API</p>
                    </div>
                    <CheckCircleIcon className="w-5 h-5 text-green-400" />
                  </div>
                  <p className="text-xs text-gray-500">No configuration required - automatically enabled</p>
                </div>

                {/* CoinMarketCap */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-purple-500 rounded-lg flex items-center justify-center">
                      <span className="text-white font-bold text-sm">💎</span>
                    </div>
                    <div>
                      <h3 className="text-white font-medium">CoinMarketCap</h3>
                      <p className="text-xs text-gray-400">Market data backup</p>
                    </div>
                    {settings.coinmarketcapKey ? (
                      <CheckCircleIcon className="w-5 h-5 text-green-400" />
                    ) : (
                      <XCircleIcon className="w-5 h-5 text-gray-400" />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-400">API Key (Optional)</label>
                    <input
                      type="password"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      value={settings.coinmarketcapKey}
                      onChange={(e) => setSettings({ ...settings, coinmarketcapKey: e.target.value })}
                      placeholder="Enter CoinMarketCap API key"
                    />
                  </div>

                  <button
                    onClick={() => handleSaveProvider('CoinMarketCap')}
                    disabled={savingProvider === 'CoinMarketCap'}
                    className="w-full px-4 py-2 bg-purple-500 text-white font-medium rounded-lg hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {savingProvider === 'CoinMarketCap' ? 'Saving...' : 'Save CoinMarketCap'}
                  </button>
                </div>
              </div>
            </section>

            {/* Add Exchange Section */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Add Exchange</h2>
                <p className="text-sm text-gray-400">Connect one exchange for automated trading</p>
              </div>

              {connectedExchange ? (
                // Connected exchange section
                <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      {React.createElement(connectedExchange.logo, { size: 48 })}
                      <div>
                        <h3 className="text-xl font-semibold text-white">{connectedExchange.name}</h3>
                        <p className="text-sm text-gray-400">Exchange account connected</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                      <CheckCircleIcon className="w-3 h-3 mr-1" />
                      Connected
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-400 mb-6">
                    <span>Last updated: {new Date(connectedExchange.lastUpdated).toLocaleString()}</span>
                  </div>

                  <button
                    onClick={() => setShowDisconnectConfirm(true)}
                    className="w-full px-4 py-2 bg-red-500/20 text-red-300 font-medium rounded-lg border border-red-500/30 hover:bg-red-500/30 transition-all"
                  >
                    Disconnect Exchange
                  </button>
                </div>
              ) : !selectedExchange ? (
                // Exchange selection grid
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {EXCHANGES.map((exchange) => {
                    const LogoComponent = exchange.logo;
                    return (
                      <button
                        key={exchange.id}
                        onClick={() => handleExchangeSelect(exchange.id)}
                        className="flex flex-col items-center space-y-3 p-4 bg-white/5 rounded-lg border border-white/10 hover:border-white/20 hover:bg-white/10 transition-all"
                      >
                        <LogoComponent size={48} />
                        <span className="text-sm font-medium text-white">{exchange.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                // Exchange configuration form
                <div className="space-y-6">
                  {(() => {
                    const exchange = EXCHANGES.find(e => e.id === selectedExchange);
                    if (!exchange) return null;

                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            {React.createElement(exchange.logo, { size: 40 })}
                            <div>
                              <h3 className="text-lg font-semibold text-white">{exchange.name}</h3>
                              <p className="text-sm text-gray-400">Configure API credentials</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedExchange(null)}
                            className="text-gray-400 hover:text-white transition-colors"
                          >
                            <XCircleIcon className="w-6 h-6" />
                          </button>
                        </div>

                        <div className="space-y-4">
                          {/* API Key */}
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-300">API Key</label>
                            <input
                              type="password"
                              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              value={exchangeForm.apiKey}
                              onChange={(e) => setExchangeForm({ ...exchangeForm, apiKey: e.target.value })}
                              placeholder="Enter your API key"
                            />
                          </div>

                          {/* Secret Key */}
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-300">Secret Key</label>
                            <input
                              type="password"
                              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              value={exchangeForm.secretKey}
                              onChange={(e) => setExchangeForm({ ...exchangeForm, secretKey: e.target.value })}
                              placeholder="Enter your secret key"
                            />
                          </div>

                          {/* Passphrase (only for exchanges that require it) */}
                          {exchange.fields.includes('passphrase') && (
                            <div className="space-y-2">
                              <label className="block text-sm font-medium text-gray-300">Passphrase</label>
                              <input
                                type="password"
                                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                value={exchangeForm.passphrase}
                                onChange={(e) => setExchangeForm({ ...exchangeForm, passphrase: e.target.value })}
                                placeholder="Enter your passphrase"
                              />
                            </div>
                          )}

                          {/* Save Button */}
                          <div className="flex space-x-3 pt-4">
                            <button
                              onClick={handleSaveExchange}
                              disabled={savingExchange}
                              className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {savingExchange ? 'Connecting...' : 'Connect Exchange'}
                            </button>
                            <button
                              onClick={() => setSelectedExchange(null)}
                              className="px-4 py-2 bg-white/10 text-white font-medium rounded-lg hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50 transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </section>

          </div>
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Success Popup */}
      {showSuccessPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircleIcon className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Exchange Connected</h3>
            <p className="text-gray-600 mb-6">Your exchange account has been successfully linked.</p>
            <button
              onClick={() => setShowSuccessPopup(false)}
              className="w-full px-4 py-2 bg-gray-900 text-white font-medium rounded-lg hover:bg-gray-800 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Disconnect Confirmation Popup */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Disconnect Exchange?</h3>
            <p className="text-gray-600 mb-6">Are you sure you want to disconnect this exchange? Auto-trading will be disabled.</p>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowDisconnectConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 font-medium rounded-lg hover:bg-gray-300 transition-colors"
                disabled={disconnectingExchange}
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnectExchange}
                disabled={disconnectingExchange}
                className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {disconnectingExchange ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
