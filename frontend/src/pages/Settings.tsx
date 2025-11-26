import React, { useState, useEffect } from 'react';
import { settingsApi, integrationsApi, exchangeApi } from '../services/api';
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
  const [marketSymbols, setMarketSymbols] = useState<string[]>([]);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [savingTrading, setSavingTrading] = useState(false);
  const [savingRisk, setSavingRisk] = useState(false);
  const [loadingAll, setLoadingAll] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (user) {
      loadAllData();
    }
  }, [user]);

  const loadAllData = async () => {
    setLoadingAll(true);
    try {
      await Promise.all([
        loadSettings(),
        loadGlobalSettings(),
        loadConnectedExchange(),
        loadMarketSymbols()
      ]);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoadingAll(false);
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
      // Settings loaded successfully
      if (response.data) {
        setSettings({
          symbol: response.data.symbol || 'BTCUSDT',
          maxPositionPercent: response.data.maxPositionPercent || 10,
          tradeType: response.data.tradeType || 'scalping',
          accuracyThreshold: response.data.accuracyThreshold || 85,
          maxDailyLoss: response.data.maxDailyLoss || 5,
          maxTradesPerDay: response.data.maxTradesPerDay || 50,
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
          maxPositionPercent: 10,
          tradeType: 'scalping',
          accuracyThreshold: 85,
          maxDailyLoss: 5,
          maxTradesPerDay: 50,
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
        maxPositionPercent: 10,
        tradeType: 'scalping',
        accuracyThreshold: 85,
        maxDailyLoss: 5,
        maxTradesPerDay: 50,
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

  const loadConnectedExchange = async () => {
    if (!user) return;
    try {
      const response = await exchangeApi.getConfig();
      if (response.data && response.data.hasApiKey) {
        // Map exchange names to our UI format
        const exchangeMap: any = {
          binance: 'binance',
          bitget: 'bitget',
          weex: 'weex',
          bingx: 'bingx'
        };

        setConnectedExchange({
          id: exchangeMap[response.data.exchange] || response.data.exchange,
          name: response.data.exchange,
          logo: EXCHANGES.find(e => e.id === exchangeMap[response.data.exchange])?.logo,
          connectedAt: response.data.updatedAt,
          lastUpdated: response.data.updatedAt
        });
      }
    } catch (err: any) {
      // Exchange not configured yet, which is fine
      console.log('No exchange configured yet');
    }
  };

  const loadMarketSymbols = async () => {
    try {
      // Try to get symbols from backend market API
      const response = await adminApi.getMarketData();
      if (response.data?.symbols && Array.isArray(response.data.symbols)) {
        setMarketSymbols(response.data.symbols);
      } else {
        // Fallback to common symbols
        const commonSymbols = [
          'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT',
          'DOTUSDT', 'LINKUSDT', 'UNIUSDT', 'AVAXUSDT', 'LTCUSDT'
        ];
        setMarketSymbols(commonSymbols);
      }
    } catch (err) {
      console.error('Error loading market symbols:', err);
      // Fallback to common symbols
      setMarketSymbols(['BTCUSDT', 'ETHUSDT', 'BNBUSDT']);
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
      await exchangeApi.saveConfig({
        exchange: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secret: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase || undefined,
        testnet: true // Default to testnet
      });

      // Load the connected exchange to update state
      await loadConnectedExchange();

      // Show success popup
      setShowSuccessPopup(true);
      setSelectedExchange(null);
      setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
    } catch (err: any) {
      console.error('Error saving exchange:', err);
      showToast(err.response?.data?.error || 'Error saving exchange', 'error');
    } finally {
      setSavingExchange(false);
    }
  };

  const handleSaveTradingSettings = async () => {
    setSavingTrading(true);
    try {
      // Send only trading settings fields
      const tradingSettings = {
        symbol: settings.symbol,
        maxPositionPercent: settings.maxPositionPercent,
        tradeType: settings.tradeType,
        accuracyThreshold: settings.accuracyThreshold
      };
      await settingsApi.update(tradingSettings);
      showToast('Trading settings saved successfully', 'success');
    } catch (err: any) {
      console.error('Error saving trading settings:', err);
      showToast(err.response?.data?.error || 'Error saving trading settings', 'error');
    } finally {
      setSavingTrading(false);
    }
  };

  const handleSaveRiskControls = async () => {
    setSavingRisk(true);
    try {
      // Send only risk controls fields
      const riskControls = {
        maxDailyLoss: settings.maxDailyLoss,
        maxTradesPerDay: settings.maxTradesPerDay
      };
      await settingsApi.update(riskControls);
      showToast('Risk controls saved successfully', 'success');
    } catch (err: any) {
      console.error('Error saving risk controls:', err);
      showToast(err.response?.data?.error || 'Error saving risk controls', 'error');
    } finally {
      setSavingRisk(false);
    }
  };

  const handleDisconnectExchange = async () => {
    setDisconnectingExchange(true);

    try {
      await exchangeApi.removeConfig();

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

  if (loadingAll || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto mb-4"></div>
          <div className="text-lg text-white">Loading settings...</div>
          <div className="text-sm text-gray-400 mt-2">Fetching exchange config, market data, and settings</div>
        </div>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Symbol</label>
                  <div className="relative">
                    <input
                      type="text"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      value={symbolSearch || settings.symbol}
                      onChange={(e) => setSymbolSearch(e.target.value)}
                      placeholder="Search symbols..."
                    />
                    {symbolSearch && (
                      <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-white/10 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {marketSymbols
                          .filter(symbol => symbol.toLowerCase().includes(symbolSearch.toLowerCase()))
                          .slice(0, 10)
                          .map((symbol) => (
                            <div
                              key={symbol}
                              className="px-3 py-2 hover:bg-white/10 cursor-pointer text-white"
                              onClick={() => {
                                setSettings({ ...settings, symbol });
                                setSymbolSearch('');
                              }}
                            >
                              {symbol}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">Trading pair for analysis and execution</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Position Per Trade (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.maxPositionPercent}
                    onChange={(e) => setSettings({ ...settings, maxPositionPercent: parseFloat(e.target.value) })}
                  />
                  <p className="text-xs text-gray-400">% of portfolio allocated per trade</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Trade Type</label>
                  <select
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.tradeType}
                    onChange={(e) => setSettings({ ...settings, tradeType: e.target.value })}
                  >
                    <option value="scalping">Scalping</option>
                    <option value="intraday">Intraday</option>
                    <option value="swing">Swing</option>
                  </select>
                  <p className="text-xs text-gray-400">Trading timeframe and strategy</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Accuracy Trigger (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.accuracyTrigger}
                    onChange={(e) => setSettings({ ...settings, accuracyTrigger: parseInt(e.target.value, 10) })}
                  />
                  <p className="text-xs text-gray-400">Minimum accuracy to trigger trades</p>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveTradingSettings}
                  disabled={savingTrading}
                  className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingTrading ? 'Saving...' : 'Save Trading Settings'}
                </button>
              </div>
            </section>

            {/* Risk Controls Section */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Risk Controls</h2>
                <p className="text-sm text-gray-400">Configure your risk management parameters</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Daily Loss (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.maxDailyLoss}
                    onChange={(e) => setSettings({ ...settings, maxDailyLoss: parseFloat(e.target.value) })}
                  />
                  <p className="text-xs text-gray-400">Engine pauses if daily loss exceeds this %</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Trades Per Day</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={settings.maxTradesPerDay}
                    onChange={(e) => setSettings({ ...settings, maxTradesPerDay: parseInt(e.target.value, 10) })}
                  />
                  <p className="text-xs text-gray-400">Maximum trades allowed per day</p>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveRiskControls}
                  disabled={savingRisk}
                  className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingRisk ? 'Saving...' : 'Save Risk Controls'}
                </button>
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

