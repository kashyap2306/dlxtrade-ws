import React, { useState, useEffect, useCallback, useRef } from 'react';
import { settingsApi, integrationsApi, exchangeApi, marketApi } from '../services/api';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../hooks/useAuth';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { suppressConsoleError } from '../utils/errorHandler';
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

// Dynamic Provider Configuration according to new architecture
const PROVIDER_CONFIG = {
  marketData: {
    icon: "📊",
    bgColor: "bg-blue-500",
    title: "Market Data Providers",
    description: "Real-time price, volume, and OHLC data",
    primary: {
      name: "CryptoCompare",
      key: "cryptoCompareKey",
      placeholder: "Enter CryptoCompare API key"
    },
    backups: [
      { name: "Binance Public", key: "binanceBackupKey", enabledKey: "binanceBackupEnabled", type: "api", placeholder: "Enter Binance API key" },
      { name: "KuCoin Public", key: "kucoinBackupKey", enabledKey: "kucoinBackupEnabled", type: "api", placeholder: "Enter KuCoin API key" },
      { name: "Bybit Public", key: "bybitBackupKey", enabledKey: "bybitBackupEnabled", type: "api", placeholder: "Enter Bybit API key" },
      { name: "OKX Public", key: "okxBackupKey", enabledKey: "okxBackupEnabled", type: "api", placeholder: "Enter OKX API key" },
      { name: "Bitget Public", key: "bitgetBackupKey", enabledKey: "bitgetBackupEnabled", type: "api", placeholder: "Enter Bitget API key" },
      { name: "CryptoCompare-FreeMode-1", key: "cryptoCompareFreeMode1Key", enabledKey: "cryptoCompareFreeMode1Enabled", type: "free", placeholder: "No key required" },
      { name: "CryptoCompare-FreeMode-2", key: "cryptoCompareFreeMode2Key", enabledKey: "cryptoCompareFreeMode2Enabled", type: "free", placeholder: "No key required" }
    ]
  },
  metadata: {
    icon: "📈",
    bgColor: "bg-purple-500",
    title: "Metadata Providers",
    description: "Market cap, supply, and asset information",
    primary: {
      name: "CoinGecko",
      key: "coinGeckoKey",
      placeholder: "Enter CoinGecko API key"
    },
    backups: [
      { name: "CoinMarketCap", key: "coinmarketcapKey", enabledKey: "coinmarketcapEnabled", type: "api", placeholder: "Enter CoinMarketCap API key" },
      { name: "CoinPaprika", key: "coinpaprikaKey", enabledKey: "coinpaprikaEnabled", type: "free", placeholder: "No key required" },
      { name: "Nomics", key: "nomicsKey", enabledKey: "nomicsEnabled", type: "api", placeholder: "Enter Nomics API key" },
      { name: "Messari", key: "messariKey", enabledKey: "messariEnabled", type: "api", placeholder: "Enter Messari API key" },
      { name: "CryptoRank", key: "cryptorankKey", enabledKey: "cryptorankEnabled", type: "free", placeholder: "No key required" }
    ]
  },
  news: {
    icon: "📰",
    bgColor: "bg-green-500",
    title: "News Providers",
    description: "Sentiment analysis and market news",
    primary: {
      name: "NewsData",
      key: "newsDataKey",
      placeholder: "Enter NewsData API key"
    },
    backups: [
      { name: "CryptoPanic", key: "cryptoPanicKey", enabledKey: "cryptoPanicEnabled", type: "api", placeholder: "Enter CryptoPanic API key" },
      { name: "GNews", key: "gnewsKey", enabledKey: "gnewsEnabled", type: "api", placeholder: "Enter GNews API key" },
      { name: "Reddit Crypto", key: "redditKey", enabledKey: "redditEnabled", type: "free", placeholder: "No key required" },
      { name: "Twitter/X", key: "twitterKey", enabledKey: "twitterEnabled", type: "api", placeholder: "Enter Twitter/X API key" },
      { name: "Alternative.me", key: "alternativemeKey", enabledKey: "alternativemeEnabled", type: "free", placeholder: "No key required" }
    ]
  }
};

// Background Research Wizard Component
function BackgroundResearchWizard() {
  const [bgResearchEnabled, setBgResearchEnabled] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [researchFrequency, setResearchFrequency] = useState(5);
  const [accuracyTrigger, setAccuracyTrigger] = useState(80);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Load existing settings on component mount
  useEffect(() => {
    loadBackgroundResearchSettings();
  }, []);

  const loadBackgroundResearchSettings = async () => {
    try {
      setLoadingSettings(true);
      const response = await settingsApi.backgroundResearch.getSettings();
      const data = response.data;
      setBgResearchEnabled(data.backgroundResearchEnabled || false);
      setTelegramBotToken(data.telegramBotToken || '');
      setTelegramChatId(data.telegramChatId || '');
      setResearchFrequency(data.researchFrequencyMinutes || 5);
      setAccuracyTrigger(data.accuracyTrigger || 80);
    } catch (error) {
      console.error('Error loading background research settings:', error);
    } finally {
      setLoadingSettings(false);
    }
  };

  const testTelegramConnection = async () => {
    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      showToast('Please fill in both Bot Token and Chat ID', 'error');
      return;
    }

    setTestingTelegram(true);
    try {
      await settingsApi.telegram.test({ botToken: telegramBotToken, chatId: telegramChatId });
      showToast('Test message sent successfully!', 'success');
    } catch (error: any) {
      console.error('Error testing Telegram:', error);
      showToast(error.response?.data?.error || 'Failed to send test message', 'error');
    } finally {
      setTestingTelegram(false);
    }
  };

  const saveBackgroundResearchSettings = async () => {
    setSavingSettings(true);
    try {
      await settingsApi.backgroundResearch.saveSettings({
        backgroundResearchEnabled: bgResearchEnabled,
        telegramBotToken: bgResearchEnabled ? telegramBotToken : undefined,
        telegramChatId: bgResearchEnabled ? telegramChatId : undefined,
        researchFrequencyMinutes: researchFrequency,
        accuracyTrigger: accuracyTrigger,
      });
      showToast('Background research settings saved successfully!', 'success');
      setCurrentStep(1); // Reset to first step
    } catch (error: any) {
      console.error('Error saving background research settings:', error);
      showToast(error.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const nextStep = () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceedToStep2 = bgResearchEnabled;
  const canProceedToStep3 = telegramBotToken.trim() && telegramChatId.trim();
  const canProceedToStep4 = true; // Always allow proceeding to confirmation

  if (loadingSettings) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Enable/Disable Toggle */}
      <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1">
            <label className="text-lg font-semibold text-white mb-2 block">Background Deep Research</label>
            <p className="text-sm text-gray-400">Automatically run deep research analysis and receive Telegram alerts for high-accuracy signals</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={bgResearchEnabled}
              onChange={(e) => setBgResearchEnabled(e.target.checked)}
            />
            <div className="w-14 h-7 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
          </label>
        </div>
      </div>

      {/* Multi-step Wizard */}
      {bgResearchEnabled && (
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 shadow-lg overflow-hidden">
          {/* Step Indicator */}
          <div className="bg-gradient-to-r from-slate-800/50 to-slate-900/50 px-6 py-4 border-b border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                      step <= currentStep
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                        : 'bg-slate-700 text-gray-400'
                    }`}
                  >
                    {step}
                  </div>
                ))}
              </div>
              <div className="text-right">
                <span className="text-sm font-medium text-gray-300">
                  Step {currentStep} of 4
                </span>
                <p className="text-xs text-gray-400 mt-1">
                  {currentStep === 1 && 'Configure Telegram'}
                  {currentStep === 2 && 'Set Research Frequency'}
                  {currentStep === 3 && 'Choose Accuracy Trigger'}
                  {currentStep === 4 && 'Review & Save'}
                </p>
              </div>
            </div>
          </div>

          {/* Step Content */}
          <div className="p-6">
            {currentStep === 1 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">🚀 Telegram Setup</h3>
                  <p className="text-gray-400">
                    Configure your Telegram bot to receive real-time research alerts with high-accuracy signals.
                  </p>
                </div>

                <div className="grid gap-6 sm:grid-cols-1">
                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-gray-200">
                      📱 Telegram Bot Token
                    </label>
                    <input
                      type="password"
                      className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                      value={telegramBotToken}
                      onChange={(e) => setTelegramBotToken(e.target.value)}
                      placeholder="Enter your Telegram bot token (e.g., 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11)"
                    />
                    <p className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="text-blue-400">💡</span>
                      Create a bot with @BotFather on Telegram and get your token
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-gray-200">
                      👤 Telegram Chat ID
                    </label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 bg-slate-800/50 border border-slate-600/50 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      placeholder="Enter your chat ID (e.g., 123456789)"
                    />
                    <p className="text-xs text-gray-400 flex items-center gap-2">
                      <span className="text-green-400">💡</span>
                      Send /start to your bot, then use @userinfobot or check bot logs
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={testTelegramConnection}
                    disabled={testingTelegram || !telegramBotToken.trim() || !telegramChatId.trim()}
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                  >
                    {testingTelegram ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Sending Test Message...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        📤 Send Test Message
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex justify-end pt-4 border-t border-white/10">
                  <button
                    onClick={nextStep}
                    disabled={!canProceedToStep2}
                    className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">⏰ Research Frequency</h3>
                  <p className="text-gray-400">
                    Choose how often the system should run deep research analysis in the background.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {[1, 3, 5, 10, 15, 30].map((minutes) => (
                    <label
                      key={minutes}
                      className={`relative flex items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-105 ${
                        researchFrequency === minutes
                          ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white shadow-lg'
                          : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-slate-500/70 hover:bg-slate-700/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="frequency"
                        value={minutes}
                        checked={researchFrequency === minutes}
                        onChange={(e) => setResearchFrequency(parseInt(e.target.value))}
                        className="sr-only"
                      />
                      <div className="text-center">
                        <span className="text-lg font-bold block">
                          {minutes}
                        </span>
                        <span className="text-xs font-medium">
                          min{minutes > 1 ? 's' : ''}
                        </span>
                      </div>
                      {researchFrequency === minutes && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs">✓</span>
                        </div>
                      )}
                    </label>
                  ))}
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <p className="text-sm text-blue-200">
                    <span className="font-semibold">💡 Tip:</span> More frequent research provides timelier signals but uses more API calls. Start with 5 minutes for optimal balance.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all shadow-lg"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">🎯 Accuracy Trigger</h3>
                  <p className="text-gray-400">
                    Set the minimum accuracy threshold for sending Telegram alerts. Higher thresholds mean fewer but more reliable signals.
                  </p>
                </div>

                <div className="space-y-4">
                  {[
                    { label: '60% - 75%', value: 60, desc: 'More signals, higher volume', color: 'from-green-500 to-emerald-500' },
                    { label: '75% - 85%', value: 75, desc: 'Balanced approach', color: 'from-blue-500 to-cyan-500' },
                    { label: '85% - 95%', value: 85, desc: 'High confidence', color: 'from-yellow-500 to-orange-500' },
                    { label: 'Above 95%', value: 95, desc: 'Ultra-precise signals', color: 'from-red-500 to-pink-500' },
                  ].map(({ label, value, desc, color }) => (
                    <label
                      key={value}
                      className={`relative flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-102 ${
                        accuracyTrigger === value
                          ? `border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white shadow-lg`
                          : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-slate-500/70 hover:bg-slate-700/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="accuracy"
                        value={value}
                        checked={accuracyTrigger === value}
                        onChange={(e) => setAccuracyTrigger(parseInt(e.target.value))}
                        className="sr-only"
                      />
                      <div className="flex items-center justify-between w-full">
                        <div>
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${color}`}></div>
                            <span className="font-semibold">{label}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{desc}</p>
                        </div>
                        {accuracyTrigger === value && (
                          <div className="w-6 h-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                            <span className="text-white text-sm">✓</span>
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4">
                  <p className="text-sm text-purple-200">
                    <span className="font-semibold">🎯 Recommended:</span> Start with 80% (75-85% range) for a good balance of signal quality and frequency.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all shadow-lg"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">✅ Confirmation</h3>
                  <p className="text-gray-400">
                    Review your configuration and save your background research settings.
                  </p>
                </div>

                <div className="bg-gradient-to-r from-slate-800/50 to-slate-900/50 rounded-xl p-6 border border-white/10">
                  <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <span>📋</span> Configuration Summary
                  </h4>

                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-slate-700/30 rounded-lg">
                      <span className="text-gray-300 font-medium">Background Research:</span>
                      <span className={`font-semibold ${bgResearchEnabled ? 'text-green-400' : 'text-red-400'}`}>
                        {bgResearchEnabled ? '✅ Enabled' : '❌ Disabled'}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-slate-700/30 rounded-lg">
                      <span className="text-gray-300 font-medium">Telegram Bot:</span>
                      <span className={`font-semibold ${telegramBotToken ? 'text-green-400' : 'text-red-400'}`}>
                        {telegramBotToken ? '✅ Configured' : '❌ Not configured'}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-slate-700/30 rounded-lg">
                      <span className="text-gray-300 font-medium">Research Frequency:</span>
                      <span className="text-purple-300 font-semibold">
                        ⏰ {researchFrequency} minute{researchFrequency > 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 bg-slate-700/30 rounded-lg">
                      <span className="text-gray-300 font-medium">Accuracy Trigger:</span>
                      <span className="text-blue-300 font-semibold">
                        🎯 {accuracyTrigger === 60 ? '60% - 75%' :
                           accuracyTrigger === 75 ? '75% - 85%' :
                           accuracyTrigger === 85 ? '85% - 95%' :
                           'Above 95%'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
                  <p className="text-sm text-green-200 flex items-center gap-2">
                    <span className="text-green-400">🚀</span>
                    <span>Ready to save! Your background research system will automatically analyze markets and send high-accuracy signals to your Telegram.</span>
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={saveBackgroundResearchSettings}
                    disabled={savingSettings}
                    className="px-8 py-4 bg-gradient-to-r from-green-500 to-green-600 text-white font-bold rounded-xl hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg text-lg"
                  >
                    {savingSettings ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Saving Settings...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        💾 Save & Activate
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-6 py-4 rounded-xl text-white font-semibold z-50 shadow-2xl border backdrop-blur-sm animate-in slide-in-from-bottom-2 duration-300 ${
          toast.type === 'success'
            ? 'bg-gradient-to-r from-green-500 to-green-600 border-green-400/30'
            : 'bg-gradient-to-r from-red-500 to-red-600 border-red-400/30'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-xl">
              {toast.type === 'success' ? '✅' : '❌'}
            </span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [loadingAll, setLoadingAll] = useState(true);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);

  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<any>(null);
  const [settings, setSettings] = useState<any>({
    symbol: 'BTCUSDT',
    maxPositionPercent: 10,
    tradeType: 'scalping',
    accuracyThreshold: 85,
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    // Market Data Providers
    cryptoCompareKey: '',
    binanceBackupKey: '',
    binanceBackupEnabled: false,
    kucoinBackupKey: '',
    kucoinBackupEnabled: false,
    bybitBackupKey: '',
    bybitBackupEnabled: false,
    okxBackupKey: '',
    okxBackupEnabled: false,
    bitgetBackupKey: '',
    bitgetBackupEnabled: false,
    // Free mode providers
    cryptoCompareFreeMode1Key: '',
    cryptoCompareFreeMode1Enabled: false,
    cryptoCompareFreeMode2Key: '',
    cryptoCompareFreeMode2Enabled: false,
    // Metadata Providers
    coinGeckoKey: '',
    coinmarketcapKey: '',
    coinmarketcapEnabled: false,
    coinpaprikaKey: '',
    coinpaprikaEnabled: false,
    nomicsKey: '',
    nomicsEnabled: false,
    messariKey: '',
    messariEnabled: false,
    cryptorankKey: '',
    cryptorankEnabled: false,
    // News Providers
    newsDataKey: '',
    cryptoPanicKey: '',
    cryptoPanicEnabled: false,
    gnewsKey: '',
    gnewsEnabled: false,
    redditKey: '',
    redditEnabled: false,
    twitterKey: '',
    twitterEnabled: false,
    alternativemeKey: '',
    alternativemeEnabled: false,
    enableAutoTrade: false,
    exchanges: [],
    showUnmaskedKeys: false,
  });
  const [integrations, setIntegrations] = useState<any>(null);
  const isMountedRef = useRef(true);

  const loadAllData = useCallback(async () => {
    if (!isMountedRef.current) return;

    setLoadingAll(true);
    setError(null);

    try {
      // Load all settings data in parallel with Promise.allSettled for resilience
      const [settingsResult, integrationsResult, globalSettingsResult, exchangeResult, symbolsResult] = await Promise.allSettled([
        loadSettings(),
        loadIntegrations(),
        loadGlobalSettings(),
        loadConnectedExchange(),
        loadMarketSymbols()
      ]);

      // Log any failures but don't fail the whole load
      if (settingsResult.status === 'rejected') {
        suppressConsoleError(settingsResult.reason, 'loadSettings');
      }
      if (integrationsResult.status === 'rejected') {
        suppressConsoleError(integrationsResult.reason, 'loadIntegrations');
      }
      if (globalSettingsResult.status === 'rejected') {
        suppressConsoleError(globalSettingsResult.reason, 'loadGlobalSettings');
      }
      if (exchangeResult.status === 'rejected') {
        suppressConsoleError(exchangeResult.reason, 'loadConnectedExchange');
      }
      if (symbolsResult.status === 'rejected') {
        suppressConsoleError(symbolsResult.reason, 'loadMarketSymbols');
      }

      setRetryCount(0); // Reset retry count on successful load

    } catch (err: any) {
      suppressConsoleError(err, 'loadSettingsData');
      if (isMountedRef.current) {
        setError(err);
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingAll(false);
      }
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadAllData();
    }
  }, [user, loadAllData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);


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

  const loadIntegrations = async () => {
    // Prevent multiple simultaneous calls
    if (integrationsLoading) return;

    setIntegrationsLoading(true);

    try {
      const response = await integrationsApi.load();
      const integrationsData = response.data || {};
      setIntegrations(integrationsData);
      setIntegrationsLoaded(true);

      // Also update settings with API keys from integrations (only masked keys for UI)
      if (settings) {
        setSettings({
          ...settings,
          // Market Data Providers
          cryptoCompareKey: '', // Clear any entered keys - they'll be masked from integrations
          binanceBackupKey: '',
          kucoinBackupKey: '',
          bybitBackupKey: '',
          okxBackupKey: '',
          bitgetBackupKey: '',
          // Metadata Providers
          coinGeckoKey: '',
          coinmarketcapKey: '',
          coinpaprikaKey: '',
          nomicsKey: '',
          messariKey: '',
          cryptorankKey: '',
          // News Providers
          newsDataKey: '',
          gnewsKey: '',
          cryptoPanicKey: '',
          redditKey: '',
          twitterKey: '',
          alternativemeKey: '',
        });
      }
    } catch (err) {
      console.error('Error loading integrations:', err);
      setIntegrations({});
    } finally {
      setIntegrationsLoading(false);
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
          // Market Data Providers
          cryptoCompareKey: response.data.cryptoCompareKey || '',
          binanceBackupKey: response.data.binanceBackupKey || '',
          binanceBackupEnabled: response.data.binanceBackupEnabled || false,
          kucoinBackupKey: response.data.kucoinBackupKey || '',
          kucoinBackupEnabled: response.data.kucoinBackupEnabled || false,
          bybitBackupKey: response.data.bybitBackupKey || '',
          bybitBackupEnabled: response.data.bybitBackupEnabled || false,
          okxBackupKey: response.data.okxBackupKey || '',
          okxBackupEnabled: response.data.okxBackupEnabled || false,
          bitgetBackupKey: response.data.bitgetBackupKey || '',
          bitgetBackupEnabled: response.data.bitgetBackupEnabled || false,
          cryptoCompareFreeMode1Key: response.data.cryptoCompareFreeMode1Key || '',
          cryptoCompareFreeMode1Enabled: response.data.cryptoCompareFreeMode1Enabled || false,
          cryptoCompareFreeMode2Key: response.data.cryptoCompareFreeMode2Key || '',
          cryptoCompareFreeMode2Enabled: response.data.cryptoCompareFreeMode2Enabled || false,
          // Metadata Providers
          coinGeckoKey: response.data.coinGeckoKey || '',
          coinmarketcapKey: response.data.coinmarketcapKey || '',
          coinmarketcapEnabled: response.data.coinmarketcapEnabled || false,
          coinpaprikaKey: response.data.coinpaprikaKey || '',
          coinpaprikaEnabled: response.data.coinpaprikaEnabled || false,
          nomicsKey: response.data.nomicsKey || '',
          nomicsEnabled: response.data.nomicsEnabled || false,
          messariKey: response.data.messariKey || '',
          messariEnabled: response.data.messariEnabled || false,
          cryptorankKey: response.data.cryptorankKey || '',
          cryptorankEnabled: response.data.cryptorankEnabled || false,
          // News Providers
          newsDataKey: response.data.newsDataKey || '',
          cryptoPanicKey: response.data.cryptoPanicKey || '',
          cryptoPanicEnabled: response.data.cryptoPanicEnabled || false,
          gnewsKey: response.data.gnewsKey || '',
          gnewsEnabled: response.data.gnewsEnabled || false,
          redditKey: response.data.redditKey || '',
          redditEnabled: response.data.redditEnabled || false,
          twitterKey: response.data.twitterKey || '',
          twitterEnabled: response.data.twitterEnabled || false,
          alternativemeKey: response.data.alternativemeKey || '',
          alternativemeEnabled: response.data.alternativemeEnabled || false,
          enableAutoTrade: response.data.enableAutoTrade || false,
          exchanges: response.data.exchanges || [],
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
          // Market Data Providers
          cryptoCompareKey: '',
          binanceBackupKey: '',
          binanceBackupEnabled: false,
          kucoinBackupKey: '',
          kucoinBackupEnabled: false,
          bybitBackupKey: '',
          bybitBackupEnabled: false,
          okxBackupKey: '',
          okxBackupEnabled: false,
          bitgetBackupKey: '',
          bitgetBackupEnabled: false,
          cryptoCompareFreeMode1Key: '',
          cryptoCompareFreeMode1Enabled: false,
          cryptoCompareFreeMode2Key: '',
          cryptoCompareFreeMode2Enabled: false,
          // Metadata Providers
          coinGeckoKey: '',
          coinmarketcapKey: '',
          coinmarketcapEnabled: false,
          coinpaprikaKey: '',
          coinpaprikaEnabled: false,
          nomicsKey: '',
          nomicsEnabled: false,
          messariKey: '',
          messariEnabled: false,
          cryptorankKey: '',
          cryptorankEnabled: false,
          // News Providers
          newsDataKey: '',
          cryptoPanicKey: '',
          cryptoPanicEnabled: false,
          gnewsKey: '',
          gnewsEnabled: false,
          redditKey: '',
          redditEnabled: false,
          twitterKey: '',
          twitterEnabled: false,
          alternativemeKey: '',
          alternativemeEnabled: false,
          enableAutoTrade: false,
          exchanges: [],
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
        // Market Data Providers
        cryptoCompareKey: '',
        binanceBackupKey: '',
        binanceBackupEnabled: false,
        kucoinBackupKey: '',
        kucoinBackupEnabled: false,
        bybitBackupKey: '',
        bybitBackupEnabled: false,
        okxBackupKey: '',
        okxBackupEnabled: false,
        bitgetBackupKey: '',
        bitgetBackupEnabled: false,
        // Metadata Providers
        coinGeckoKey: '',
        coinmarketcapKey: '',
        coinmarketcapEnabled: false,
        coinpaprikaKey: '',
        coinpaprikaEnabled: false,
        nomicsKey: '',
        nomicsEnabled: false,
        messariKey: '',
        messariEnabled: false,
        cryptorankKey: '',
        cryptorankEnabled: false,
        // News Providers
        newsDataKey: '',
        cryptoPanicKey: '',
        cryptoPanicEnabled: false,
        gnewsKey: '',
        gnewsEnabled: false,
        redditKey: '',
        redditEnabled: false,
        twitterKey: '',
        twitterEnabled: false,
        alternativemeKey: '',
        alternativemeEnabled: false,
        enableAutoTrade: false,
        exchanges: [],
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
      // Map provider names to API names
      const apiNameMap: any = {
        'CryptoCompare': 'cryptocompare',
        'Binance Public': 'binancepublic',
        'KuCoin Public': 'kucoinpublic',
        'Bybit Public': 'bybitpublic',
        'OKX Public': 'okxpublic',
        'Bitget Public': 'bitgetpublic',
        'CryptoCompare-FreeMode-1': 'cryptocompare-freemode-1',
        'CryptoCompare-FreeMode-2': 'cryptocompare-freemode-2',
        'CoinGecko': 'coingecko',
        'CoinMarketCap': 'coinmarketcap',
        'CoinPaprika': 'coinpaprika',
        'Nomics': 'nomics',
        'Messari': 'messari',
        'CryptoRank': 'cryptorank',
        'NewsData': 'newsdata',
        'CryptoPanic': 'cryptopanic',
        'GNews': 'gnews',
        'Reddit Crypto': 'reddit',
        'Twitter/X': 'twitter',
        'Alternative.me': 'alternativeme'
      };

      const apiName = apiNameMap[providerName];
      if (!apiName) {
        throw new Error(`Unknown provider: ${providerName}`);
      }

      // Get the API key from settings (handle field name mapping)
      const fieldNameMap: any = {
        'cryptocompare': 'cryptoCompareKey',
        'binancepublic': 'binanceBackupKey',
        'kucoinpublic': 'kucoinBackupKey',
        'bybitpublic': 'bybitBackupKey',
        'okxpublic': 'okxBackupKey',
        'bitgetpublic': 'bitgetBackupKey',
        'cryptocompare-freemode-1': 'cryptoCompareFreeMode1Key',
        'cryptocompare-freemode-2': 'cryptoCompareFreeMode2Key',
        'coingecko': 'coinGeckoKey',
        'coinmarketcap': 'coinmarketcapKey',
        'coinpaprika': 'coinpaprikaKey',
        'nomics': 'nomicsKey',
        'messari': 'messariKey',
        'cryptorank': 'cryptorankKey',
        'newsdata': 'newsDataKey',
        'cryptopanic': 'cryptoPanicKey',
        'gnews': 'gnewsKey',
        'reddit': 'redditKey',
        'twitter': 'twitterKey',
        'alternativeme': 'alternativemeKey'
      };

      // Get enabled state for backup providers
      const enabledFieldMap: any = {
        'binancepublic': 'binanceBackupEnabled',
        'kucoinpublic': 'kucoinBackupEnabled',
        'bybitpublic': 'bybitBackupEnabled',
        'okxpublic': 'okxBackupEnabled',
        'bitgetpublic': 'bitgetBackupEnabled',
        'cryptocompare-freemode-1': 'cryptoCompareFreeMode1Enabled',
        'cryptocompare-freemode-2': 'cryptoCompareFreeMode2Enabled',
        'coinmarketcap': 'coinmarketcapEnabled',
        'coinpaprika': 'coinpaprikaEnabled',
        'nomics': 'nomicsEnabled',
        'messari': 'messariEnabled',
        'cryptorank': 'cryptorankEnabled',
        'cryptopanic': 'cryptoPanicEnabled',
        'gnews': 'gnewsEnabled',
        'reddit': 'redditEnabled',
        'twitter': 'twitterEnabled',
        'alternativeme': 'alternativemeEnabled'
      };

      const apiKeyField = fieldNameMap[apiName] || `${apiName}Key`;
      const apiKey = settings[apiKeyField]?.trim();

      // For backup providers, check if enabled; for primary providers, always enabled
      const isPrimary = ['cryptocompare', 'coingecko', 'newsdata'].includes(apiName);
      const enabledField = enabledFieldMap[apiName];
      const enabled = isPrimary ? true : (enabledField ? settings[enabledField] : !!apiKey);

      // Add required logging
      console.log("FRONTEND-SAVE", { provider: apiName, apiKeyLength: apiKey?.length || 0, enabled });

      // Prepare payload and remove null/undefined values
      const payload: any = {
        apiName,
        enabled
      };

      // Only include apiKey if it's not empty and not null/undefined
      if (apiKey && apiKey.trim() !== '') {
        payload.apiKey = apiKey.trim();
      }

      // Call backend API - this encrypts and saves to Firestore
      const response = await integrationsApi.update(payload);

      // Check if save was successful
      if (response.data?.saved) {
        // Update UI state immediately without waiting for reload
        setIntegrations(prev => ({
          ...prev,
          [apiName]: {
            enabled,
            apiKey: apiKey ? '••••••••••••••••' : null, // Masked key
            updatedAt: new Date().toISOString(),
          }
        }));

        // Clear the input field
        setSettings(prev => ({
          ...prev,
          [fieldNameMap[apiName] || `${apiName}Key`]: ''
        }));

        showToast(`${providerName} ${enabled ? 'connected' : 'disabled'} successfully`, 'success');
      } else {
        throw new Error('Save operation did not complete successfully');
      }

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
      const response = await marketApi.getSymbols();
      if (response.data && Array.isArray(response.data)) {
        // Extract symbol names from the response
        const symbols = response.data.map((item: any) => item.symbol || item);
        setMarketSymbols(symbols);
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
      // Send all trading settings and risk controls together
      const tradingSettings = {
        symbol: settings.symbol,
        maxPositionPercent: settings.maxPositionPercent,
        tradeType: settings.tradeType,
        accuracyThreshold: settings.accuracyThreshold,
        maxDailyLoss: settings.maxDailyLoss,
        maxTradesPerDay: settings.maxTradesPerDay
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

    // Validate required API keys for new provider architecture
    if (!settings.cryptoCompareKey?.trim()) {
      showToast('CryptoCompare API key is required for market data', 'error');
      return;
    }
    if (!settings.coinGeckoKey?.trim()) {
      showToast('CoinGecko API key is required for metadata', 'error');
      return;
    }
    if (!settings.newsDataKey?.trim()) {
      showToast('NewsData API key is required for news analysis', 'error');
      return;
    }

    setSaving(true);

    try {
      const response = await settingsApi.update(settings);
      // Settings updated successfully
      showToast('Settings saved successfully', 'success');
      // No need to reload - local state is already updated
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

  const handleRetry = useCallback(async () => {
    setRetryCount(prev => prev + 1);
    await loadAllData();
  }, [loadAllData]);

  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    const { auth } = await import('../config/firebase');
    await signOut(auth);
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('firebaseUser');
    window.location.href = '/login';
  };

  // Show loading state
  if ((loadingAll || !settings) && retryCount === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen smooth-scroll">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <LoadingState message="Loading settings..." />
          </div>
        </main>
      </div>
    );
  }

  // Show error state with retry option
  if (error && !loadingAll) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen smooth-scroll">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <ErrorState
              error={error}
              onRetry={handleRetry}
              message={`Failed to load settings${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`}
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <ErrorBoundary>
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
                <p className="text-sm text-gray-400">Configure your core trading parameters and risk controls</p>
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
                    value={settings.tradeType || 'scalping'}
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
                    value={settings.accuracyThreshold}
                    onChange={(e) => setSettings({ ...settings, accuracyThreshold: parseInt(e.target.value, 10) })}
                  />
                  <p className="text-xs text-gray-400">Minimum accuracy to trigger trades</p>
                </div>

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
                  onClick={handleSaveTradingSettings}
                  disabled={savingTrading}
                  className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingTrading ? 'Saving...' : 'Save Trading Settings'}
                </button>
              </div>
            </section>

            {/* API Provider Categories */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">API Provider Configuration</h2>
                <p className="text-sm text-gray-400">Configure primary and backup data providers for comprehensive market analysis</p>
              </div>

              <div className="space-y-8">
                {/* Dynamic Provider Categories */}
                {Object.entries(PROVIDER_CONFIG).map(([categoryKey, config]) => (
                  <div key={categoryKey} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${config.bgColor} rounded-lg flex items-center justify-center`}>
                        <span className="text-white font-bold text-lg">{config.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{config.title}</h3>
                        <p className="text-sm text-gray-400">{config.description}</p>
                      </div>
                    </div>

                    {/* Primary Provider */}
                    <div className="ml-13 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-green-400">PRIMARY:</span>
                        <span className="text-sm text-white">{config.primary.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          value={settings[config.primary.key] || ''}
                          onChange={(e) => setSettings({ ...settings, [config.primary.key]: e.target.value })}
                          placeholder={config.primary.placeholder}
                        />
                        <button
                          onClick={() => handleSaveProvider(config.primary.name)}
                          disabled={savingProvider === config.primary.name}
                          className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                          {savingProvider === config.primary.name ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>

                    {/* Backup Providers Accordion */}
                    <details className="group ml-13">
                      <summary className="flex items-center gap-2 cursor-pointer text-sm text-gray-400 hover:text-white transition-colors">
                        <ChevronDownIcon className="w-4 h-4 group-open:rotate-180 transition-transform" />
                        Backup Providers ({config.backups.length} available)
                      </summary>
                      <div className="mt-4 space-y-3">
                        {config.backups.map((backup) => (
                          <div key={backup.key} className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
                            <div className="flex items-center gap-3">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="sr-only peer"
                                  checked={settings[backup.enabledKey] || false}
                                  onChange={(e) => setSettings({ ...settings, [backup.enabledKey]: e.target.checked })}
                                />
                                <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                              </label>
                              <span className={`text-xs ${backup.type === 'free' ? 'text-green-400' : 'text-amber-400'}`}>
                                {backup.type === 'free' ? 'FREE' : 'API KEY'}
                              </span>
                              <span className="text-sm text-white">{backup.name}</span>
                            </div>
                            {settings[backup.enabledKey] && (
                              backup.type === 'free' ? (
                                <span className="text-xs text-gray-400">{backup.placeholder}</span>
                              ) : (
                                <div className="flex gap-2">
                                  <input
                                    type="password"
                                    className="px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                    placeholder="API Key"
                                    value={settings[backup.key] || ''}
                                    onChange={(e) => setSettings({ ...settings, [backup.key]: e.target.value })}
                                  />
                                  <button
                                    onClick={() => handleSaveProvider(backup.name)}
                                    disabled={savingProvider === backup.name}
                                    className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded text-xs hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {savingProvider === backup.name ? '...' : 'Save'}
                                  </button>
                                </div>
                              )
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </section>

            {/* Background Deep Research Alerts Section */}
            <section className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Background Deep Research Alerts</h2>
                <p className="text-sm text-gray-400">Configure automatic deep research with Telegram notifications</p>
              </div>

              <BackgroundResearchWizard />
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


    </ErrorBoundary>
  );
}

