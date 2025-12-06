import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsApi, integrationsApi, exchangeApi, adminApi } from '../services/api';
import Toast from '../components/Toast';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../hooks/useAuth';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import {
  CheckCircleIcon,
  XCircleIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExclamationTriangleIcon,
  SpeakerWaveIcon,
  DevicePhoneMobileIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import BinanceLogo from '../components/ui/BinanceLogo';
import BitgetLogo from '../components/ui/BitgetLogo';
import KuCoinLogo from '../components/ui/KuCoinLogo';
import OKXLogo from '../components/ui/OKXLogo';
import BingXLogo from '../components/ui/BingXLogo';
import MEXCLogo from '../components/ui/MEXCLogo';
import WeexLogo from '../components/ui/WeexLogo';

// Reusable input component for consistent styling
const SettingsInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10"
    {...props}
  />
);

// Reusable card component for consistent styling
const SettingsCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 p-5 sm:p-8 shadow-xl transition-all duration-300 hover:shadow-2xl hover:border-purple-500/20 ${className}`}>
    {children}
  </div>
);

// Reusable toggle switch component
const ToggleSwitch: React.FC<{
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  size?: 'normal' | 'small';
}> = ({ id, checked, onChange, ariaLabel, size = 'normal' }) => {
  const dimensions = size === 'small'
    ? { container: 'w-10 h-5', knob: 'after:h-4 after:w-4', translate: 'peer-checked:after:translate-x-full', bg: 'peer-checked:bg-purple-500' }
    : { container: 'w-12 h-6', knob: 'after:h-5 after:w-5', translate: 'peer-checked:after:translate-x-full peer-checked:after:border-white', bg: 'peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500' };
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        id={id}
        className="sr-only peer"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
      />
      <div className={`${dimensions.container} bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer ${dimensions.translate} ${dimensions.bg} after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full ${dimensions.knob} after:transition-all`}></div>
    </label>
  );
};

// Reusable provider test result component
const ProviderTestResult: React.FC<{
  result: { status: 'success' | 'error' | null; message: string } | undefined;
  size?: 'normal' | 'small';
}> = ({ result, size = 'normal' }) => {
  if (!result) return null;
  const iconSize = size === 'small' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg text-${size === 'small' ? 'xs' : 'sm'} ${result.status === 'success'
        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
        : result.status === 'error'
          ? 'bg-red-500/10 border border-red-500/20 text-red-400'
          : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
      }`}>
      {result.status === 'success' && <CheckCircleIcon className={iconSize} />}
      {result.status === 'error' && <XCircleIcon className={iconSize} />}
      <span>{result.message}</span>
    </div>
  );
};

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
      name: "CoinGecko",
      key: "coinGeckoKey",
      placeholder: "Enter CoinGecko API key"
    },
    backups: [
      { name: "CoinPaprika", key: "coinPaprikaKey", enabledKey: "coinPaprikaEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinMarketCap", key: "coinMarketCapKey", enabledKey: "coinMarketCapEnabled", type: "api", placeholder: "Enter CoinMarketCap API key" },
      { name: "CoinLore", key: "coinLoreKey", enabledKey: "coinLoreEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinAPI", key: "coinApiKey", enabledKey: "coinApiEnabled", type: "api", placeholder: "Enter CoinAPI key" },
      { name: "BraveNewCoin", key: "braveNewCoinKey", enabledKey: "braveNewCoinEnabled", type: "api", placeholder: "Enter BraveNewCoin API key" },
      { name: "Messari", key: "messariKey", enabledKey: "messariEnabled", type: "api", placeholder: "Enter Messari API key" },
      { name: "Kaiko", key: "kaikoKey", enabledKey: "kaikoEnabled", type: "api", placeholder: "Enter Kaiko API key" },
      { name: "LiveCoinWatch", key: "liveCoinWatchKey", enabledKey: "liveCoinWatchEnabled", type: "api", placeholder: "Enter LiveCoinWatch API key" },
      { name: "CoinStats", key: "coinStatsKey", enabledKey: "coinStatsEnabled", type: "api", placeholder: "Enter CoinStats API key" },
      { name: "CoinCheckup", key: "coinCheckupKey", enabledKey: "coinCheckupEnabled", type: "free", placeholder: "API Not Required" }
    ]
  },
  news: {
    icon: "📰",
    bgColor: "bg-green-500",
    title: "News Providers",
    description: "Sentiment analysis and market news",
    primary: {
      name: "NewsData.io",
      key: "newsDataKey",
      placeholder: "Enter NewsData.io API key"
    },
    backups: [
      { name: "CryptoPanic", key: "cryptoPanicKey", enabledKey: "cryptoPanicEnabled", type: "api", placeholder: "Enter CryptoPanic API key" },
      { name: "Reddit", key: "redditKey", enabledKey: "redditEnabled", type: "free", placeholder: "API Not Required" },
      { name: "Cointelegraph RSS", key: "cointelegraphKey", enabledKey: "cointelegraphEnabled", type: "free", placeholder: "API Not Required" },
      { name: "AltcoinBuzz RSS", key: "altcoinBuzzKey", enabledKey: "altcoinBuzzEnabled", type: "free", placeholder: "API Not Required" },
      { name: "GNews", key: "gnewsKey", enabledKey: "gnewsEnabled", type: "api", placeholder: "Enter GNews API key" },
      { name: "Marketaux", key: "marketauxKey", enabledKey: "marketauxEnabled", type: "api", placeholder: "Enter Marketaux API key" },
      { name: "Webz.io", key: "webzKey", enabledKey: "webzEnabled", type: "api", placeholder: "Enter Webz.io API key" },
      { name: "CoinStatsNews", key: "coinStatsNewsKey", enabledKey: "coinStatsNewsEnabled", type: "free", placeholder: "API Not Required" },
      { name: "NewsCatcher", key: "newsCatcherKey", enabledKey: "newsCatcherEnabled", type: "api", placeholder: "Enter NewsCatcher API key" },
      { name: "CryptoCompare News", key: "cryptoCompareNewsKey", enabledKey: "cryptoCompareNewsEnabled", type: "api", placeholder: "Enter CryptoCompare News API key" }
    ]
  },
  metadata: {
    icon: "📈",
    bgColor: "bg-purple-500",
    title: "Metadata Providers",
    description: "Market cap, supply, and asset information",
    primary: {
      name: "CryptoCompare",
      key: "cryptoCompareKey",
      placeholder: "Enter CryptoCompare API key"
    },
    backups: [
      { name: "CoinGecko", key: "coinGeckoKey", enabledKey: "coinGeckoEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinPaprika", key: "coinPaprikaKey", enabledKey: "coinPaprikaEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinMarketCap", key: "coinMarketCapKey", enabledKey: "coinMarketCapEnabled", type: "api", placeholder: "Enter CoinMarketCap API key" },
      { name: "CoinStats", key: "coinStatsKey", enabledKey: "coinStatsEnabled", type: "api", placeholder: "Enter CoinStats API key" },
      { name: "CryptoCompare", key: "cryptoCompareKey", enabledKey: "cryptoCompareEnabled", type: "api", placeholder: "Enter CryptoCompare API key" },
      { name: "LiveCoinWatch", key: "liveCoinWatchKey", enabledKey: "liveCoinWatchEnabled", type: "api", placeholder: "Enter LiveCoinWatch API key" },
      { name: "Messari", key: "messariKey", enabledKey: "messariEnabled", type: "api", placeholder: "Enter Messari API key" },
      { name: "CoinLore", key: "coinLoreKey", enabledKey: "coinLoreEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinCheckup", key: "coinCheckupKey", enabledKey: "coinCheckupEnabled", type: "free", placeholder: "API Not Required" },
      { name: "CoinCap.io", key: "coinCapKey", enabledKey: "coinCapEnabled", type: "free", placeholder: "API Not Required" }
    ]
  }
};

// API name mapping for provider handling
const API_NAME_MAP: Record<string, string> = {
  // Primary Providers
  'CoinGecko': 'coingecko',
  'NewsData.io': 'newsdataio',
  'CryptoCompare': 'cryptocompare',
  // Market Data Backups
  'CoinPaprika': 'coinpaprika',
  'CoinMarketCap': 'coinmarketcap',
  'CoinLore': 'coinlore',
  'CoinAPI': 'coinapi',
  'BraveNewCoin': 'bravenewcoin',
  'Messari': 'messari',
  'Kaiko': 'kaiko',
  'LiveCoinWatch': 'livecoinwatch',
  'CoinStats': 'coinstats',
  'CoinCheckup': 'coincheckup',
  // News Backups
  'CryptoPanic': 'cryptopanic',
  'Reddit': 'reddit',
  'Cointelegraph RSS': 'cointelegraph',
  'AltcoinBuzz RSS': 'altcoinbuzz',
  'GNews': 'gnews',
  'Marketaux': 'marketaux',
  'Webz.io': 'webzio',
  'CoinStatsNews': 'coinstatsnews',
  'NewsCatcher': 'newscatcher',
  'CryptoCompare News': 'cryptocomparenews',
  // Metadata Backups
  'CoinCap.io': 'coincap',
  'CoinRanking': 'coinranking',
  'Nomics': 'nomics'
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
  const [checkingApiKeys, setCheckingApiKeys] = useState(false);
  const [apiKeysValid, setApiKeysValid] = useState(false);

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
      // Error is handled by not setting the states, which defaults to initial.
    } finally {
      setLoadingSettings(false);
    }
  };

  const testTelegramConnection = async () => {
    if (!telegramBotToken.trim() || !telegramChatId.trim()) {
      showToast('Please fill in both Bot Token and Chat ID', 'error');
      return;
    }

    // Validate bot token format (Telegram bot tokens start with a number and contain a colon)
    const botTokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
    if (!botTokenRegex.test(telegramBotToken.trim())) {
      showToast('Invalid bot token format. Telegram bot tokens should be in format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11', 'error');
      return;
    }

    // Validate chat ID format (should be a number or start with @ or -)
    const chatIdRegex = /^(@[A-Za-z0-9_]+|-\d+|\d+)$/;
    if (!chatIdRegex.test(telegramChatId.trim())) {
      showToast('Invalid chat ID format. Chat ID should be a number, start with @ for channels/groups, or start with - for groups', 'error');
      return;
    }

    setTestingTelegram(true);
    try {
      const response = await settingsApi.backgroundResearch.test({ botToken: telegramBotToken, chatId: telegramChatId });
      showToast(response.data.message || 'DLXTRADE Alert Test Successful: Telegram integration working.', 'success');
    } catch (error: any) {
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
      setCurrentStep(0); // Reset to API validation step
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const checkApiKeys = async () => {
    setCheckingApiKeys(true);
    try {
      const requiredApis = [
        'CryptoCompare',
        'CoinGecko',
        'CoinPaprika',
        'NewsData',
        'CryptoPanic',
        'Reddit',
        'GNews',
        'KuCoin',
        'Bybit',
        'OKX',
        'Bitget'
      ];
      const missingKeys: string[] = [];

      // Check each required API key
      for (const apiName of requiredApis) {
        try {
          const response = await integrationsApi.checkKey(apiName);
          if (!response.data?.valid) {
            missingKeys.push(apiName);
          }
        } catch (error) {
          missingKeys.push(apiName);
        }
      }

      if (missingKeys.length > 0) {
        showToast(`Missing API keys: ${missingKeys.join(', ')}`, 'error');
        setApiKeysValid(false);
        return false;
      } else {
        showToast('All required API keys are configured!', 'success');
        setApiKeysValid(true);
        return true;
      }
    } catch (error) {
      showToast('Failed to validate API keys', 'error');
      setApiKeysValid(false);
      return false;
    } finally {
      setCheckingApiKeys(false);
    }
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const nextStep = async () => {
    if (currentStep === 0 && bgResearchEnabled) {
      // Check API keys before proceeding
      const keysValid = await checkApiKeys();
      if (keysValid) {
        setCurrentStep(1);
      }
    } else if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceedToStep2 = telegramBotToken.trim() && telegramChatId.trim();

  if (loadingSettings) {
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex items-center justify-center">
            <LoadingState message="Loading settings..." />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Enable/Disable Toggle */}
      <div className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 p-6 sm:p-8 shadow-xl transition-all duration-300 hover:shadow-2xl hover:border-purple-500/20">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1">
            <label className="text-xl font-bold text-white mb-2 block">Background Deep Research</label>
            <p className="text-sm text-gray-400">Automatically run deep research analysis and receive Telegram alerts for high-accuracy signals</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
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
        <div className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl overflow-hidden">
          {/* Step Indicator */}
          <div className="bg-gradient-to-r from-slate-900/70 to-slate-800/70 backdrop-blur-sm px-6 py-4 border-b border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center space-x-3">
                {[0, 1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 hover:scale-105 ${step <= currentStep
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg ring-2 ring-purple-300/50'
                        : 'bg-slate-700 text-gray-400'
                      }`}
                  >
                    {step === 0 ? '✓' : step + 1}
                  </div>
                ))}
              </div>
              <div className="text-right">
                <span className="text-sm font-medium text-gray-300">
                  Step {currentStep + 1} of 5
                </span>
                <p className="text-xs text-gray-400 mt-1">
                  {currentStep === 0 && 'API Key Validation'}
                  {currentStep === 1 && 'Configure Telegram'}
                  {currentStep === 2 && 'Set Research Frequency'}
                  {currentStep === 3 && 'Choose Accuracy Trigger'}
                  {currentStep === 4 && 'Review & Save'}
                </p>
              </div>
            </div>
          </div>

          {/* Step Content */}
          <div className="p-6 sm:p-8">
            {currentStep === 0 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">🔑 API Key Validation</h3>
                  <p className="text-gray-400">
                    Before enabling Deep Research, we need to verify all required API keys are configured.
                  </p>
                </div>
                <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-600/30">
                  <h4 className="text-lg font-semibold text-white mb-4">Required API Keys:</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      'CryptoCompare (Market Data)',
                      'CoinGecko (Metadata)',
                      'CoinPaprika (Metadata)',
                      'NewsData (News)',
                      'CryptoPanic (News)',
                      'Reddit (News)',
                      'GNews (News)',
                      'KuCoin (Exchange)',
                      'Bybit (Exchange)',
                      'OKX (Exchange)',
                      'Bitget (Exchange)'
                    ].map((api, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                        <span className="text-sm text-gray-300">{api}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <p className="text-sm text-blue-200">
                    <span className="font-semibold">💡 Note:</span> Configure these API keys in the "API Provider Configuration" section above before proceeding.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={checkApiKeys}
                    disabled={checkingApiKeys}
                    className="w-full flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                  >
                    {checkingApiKeys ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Checking API Keys...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        🔍 Validate API Keys
                      </span>
                    )}
                  </button>
                </div>
                {apiKeysValid && (
                  <div className="flex justify-end pt-4 border-t border-white/10">
                    <button
                      onClick={nextStep}
                      className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                    >
                      Continue →
                    </button>
                  </div>
                )}
              </div>
            )}
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
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10"
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
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-inner hover:bg-white/10"
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
                    className="w-full flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
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
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { value: 1, label: '1M' },
                    { value: 3, label: '3M' },
                    { value: 5, label: '5M' },
                    { value: 10, label: '10M' },
                    { value: 15, label: '15M' },
                    { value: 30, label: '30M' },
                    { value: 45, label: '45M' },
                    { value: 60, label: '1H' }
                  ].map(({ value, label }) => (
                    <label
                      key={value}
                      className={`relative flex items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-300 hover:scale-[1.02] transform-gpu ${researchFrequency === value
                          ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white shadow-lg ring-2 ring-purple-500/50'
                          : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-purple-500/70 hover:bg-slate-700/50'
                        }`}
                    >
                      <input
                        type="radio"
                        name="frequency"
                        value={value}
                        checked={researchFrequency === value}
                        onChange={(e) => setResearchFrequency(parseInt(e.target.value))}
                        className="sr-only"
                      />
                      <div className="text-center">
                        <span className="text-lg font-bold block">
                          {label}
                        </span>
                      </div>
                      {researchFrequency === value && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs">✓</span>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <p className="text-sm text-blue-200">
                    <span className="font-semibold">💡 Tip:</span> More frequent research provides timelier signals but uses more API calls. Start with 5M for optimal balance between timeliness and cost.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="w-full sm:w-auto px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all duration-300 hover:scale-[1.01]"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
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
                    { label: '85% - 95%', value: 85, desc: 'Fewer, high-conviction signals', color: 'from-purple-500 to-pink-500' },
                    { label: '95% - 100%', value: 95, desc: 'Only critical, ultra-high accuracy alerts', color: 'from-red-500 to-orange-500' }
                  ].map(({ label, value, desc, color }) => (
                    <label
                      key={value}
                      className={`relative block p-5 rounded-xl border-2 cursor-pointer transition-all duration-300 hover:scale-[1.02] transform-gpu ${accuracyTrigger >= value && accuracyTrigger < value + 10
                          ? `border-purple-500 bg-gradient-to-r ${color}/20 text-white shadow-lg ring-2 ring-purple-500/50`
                          : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-purple-500/70 hover:bg-slate-700/50'
                        }`}
                    >
                      <input
                        type="radio"
                        name="accuracy"
                        value={value}
                        checked={accuracyTrigger >= value && accuracyTrigger < value + 10}
                        onChange={() => setAccuracyTrigger(value)}
                        className="sr-only"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-lg font-bold">{label}</span>
                        {accuracyTrigger >= value && accuracyTrigger < value + 10 && (
                          <div className="w-5 h-5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs">✓</span>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-1">{desc}</p>
                    </label>
                  ))}
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-gray-200">
                    Current Accuracy Trigger: <span className="text-purple-400">{accuracyTrigger}%</span>
                  </label>
                  <input
                    type="range"
                    min="60"
                    max="99"
                    step="1"
                    value={accuracyTrigger}
                    onChange={(e) => setAccuracyTrigger(parseInt(e.target.value))}
                    className="w-full h-2 bg-purple-900/50 rounded-lg appearance-none cursor-pointer transition-all duration-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>60% (High Volume)</span>
                    <span>99% (Max Reliability)</span>
                  </div>
                </div>
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4">
                  <p className="text-sm text-orange-200">
                    <span className="font-semibold">⚠️ Warning:</span> Setting a very high trigger (90%+) may significantly reduce the number of alerts received.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="w-full sm:w-auto px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all duration-300 hover:scale-[1.01]"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={nextStep}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            )}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="text-center sm:text-left">
                  <h3 className="text-2xl font-bold text-white mb-2">💾 Review & Save</h3>
                  <p className="text-gray-400"> Please review your background deep research settings before saving. </p>
                </div>
                <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-600/30 space-y-4">
                  <h4 className="text-lg font-semibold text-white mb-3">Configuration Summary</h4>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-sm font-medium text-gray-300">Status</span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">Enabled</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-sm font-medium text-gray-300">Telegram Setup</span>
                    <span className="text-sm font-semibold text-green-400">Configured</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-sm font-medium text-gray-300">Research Frequency</span>
                    <span className="text-sm font-semibold text-purple-400">{researchFrequency} minutes</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-300">Accuracy Trigger</span>
                    <span className="text-sm font-semibold text-purple-400">{accuracyTrigger}%</span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-white/10">
                  <button
                    onClick={prevStep}
                    className="w-full sm:w-auto px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all duration-300 hover:scale-[1.01]"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={saveBackgroundResearchSettings}
                    disabled={savingSettings}
                    className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                  >
                    {savingSettings ? 'Saving...' : 'Save All Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Main Settings Component
const Settings = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, handleLogout: authHandleLogout } = useAuth();
  const [loadingAll, setLoadingAll] = useState(true);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const isMountedRef = useRef(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Callback functions - moved before early returns
  const handleRetry = useCallback(() => {
    setError(null);
    setLoadingAll(true);
    setRetryCount(prev => prev + 1);
  }, []);

  const handleLogout = useCallback(() => {
    authHandleLogout();
    navigate('/login');
  }, [authHandleLogout, navigate]);

  // Additional state variables - moved before early returns
  const [savingSettings, setSavingSettings] = useState(false);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);

  // Exchange Connection States
  const [selectedExchange, setSelectedExchange] = useState<string>('');
  const [exchangeForm, setExchangeForm] = useState({
    apiKey: '',
    secretKey: '',
    passphrase: ''
  });
  const [connectedExchange, setConnectedExchange] = useState<any>(null);
  const [savingExchange, setSavingExchange] = useState(false);
  const [testingExchange, setTestingExchange] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Provider Test States
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { status: 'success' | 'error' | null; message: string }>>({});

  // Trading Engine States
  const [tradingSettings, setTradingSettings] = useState<any>({
    maxPositionPerTrade: 10,
    tradeType: 'scalping',
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    manualCoins: [],
    positionSizingMap: [
      { min: 0, max: 70, percent: 1 },
      { min: 70, max: 80, percent: 5 },
      { min: 80, max: 90, percent: 10 },
      { min: 90, max: 100, percent: 15 },
    ]
  });
  const [sampleAccuracy, setSampleAccuracy] = useState(85);

  // Research Coin Selection States
  const [coinSearch, setCoinSearch] = useState('');
  const [top100Coins, setTop100Coins] = useState<string[]>([]);
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);

  // Backup Provider Toggle States
  const [showMarketBackups, setShowMarketBackups] = useState(false);
  const [showNewsBackups, setShowNewsBackups] = useState(false);
  const [showMetadataBackups, setShowMetadataBackups] = useState(false);

  // Notification Settings States
  const [notificationSettings, setNotificationSettings] = useState<any>(null);
  const [showAutoTradePrereqModal, setShowAutoTradePrereqModal] = useState(false);
  const [notificationPrereqs, setNotificationPrereqs] = useState<any>(null);
  const [showAccuracyModal, setShowAccuracyModal] = useState(false);
  const [accuracyThresholdInput, setAccuracyThresholdInput] = useState('80');
  const [telegramForAccuracy, setTelegramForAccuracy] = useState(false);

  // Callback functions - moved before early returns

  // General Settings & Integrations
  const [integrations, setIntegrations] = useState<any>({});
  const [settings, setSettings] = useState<any>({
    maxPositionPercent: 10,
    tradeType: 'scalping',
    accuracyThreshold: 85,
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    // Primary Providers
    coinGeckoKey: '',
    newsDataKey: '',
    cryptoCompareKey: '',
    // Market Data Backup Providers
    coinPaprikaKey: '',
    coinPaprikaEnabled: false,
    coinMarketCapKey: '',
    coinMarketCapEnabled: false,
    coinLoreKey: '',
    coinLoreEnabled: false,
    coinApiKey: '',
    coinApiEnabled: false,
    braveNewCoinKey: '',
    braveNewCoinEnabled: false,
    messariKey: '',
    messariEnabled: false,
    kaikoKey: '',
    kaikoEnabled: false,
    liveCoinWatchKey: '',
    liveCoinWatchEnabled: false,
    coinStatsKey: '',
    coinStatsEnabled: false,
    coinCheckupKey: '',
    coinCheckupEnabled: false,
    // News Backup Providers
    cryptoPanicKey: '',
    cryptoPanicEnabled: false,
    redditKey: '',
    redditEnabled: false,
    cointelegraphKey: '',
    cointelegraphEnabled: false,
    altcoinBuzzKey: '',
    altcoinBuzzEnabled: false,
    gnewsKey: '',
    gnewsEnabled: false,
    marketauxKey: '',
    marketauxEnabled: false,
    webzKey: '',
    webzEnabled: false,
    coinStatsNewsKey: '',
    coinStatsNewsEnabled: false,
    newsCatcherKey: '',
    newsCatcherEnabled: false,
    cryptoCompareNewsKey: '',
    cryptoCompareNewsEnabled: false,
    // Metadata Backup Providers
    coinCapKey: '',
    coinCapEnabled: false,
    coinRankingKey: '',
    coinRankingEnabled: false,
    nomicsKey: '',
    nomicsEnabled: false,

    enableAutoTrade: false,
    exchanges: [],
    showUnmaskedKeys: false,
    enableAutoTradeAlerts: false,
    enableAccuracyAlerts: false,
    enableWhaleAlerts: false,
    tradeConfirmationRequired: false,
    notificationSounds: false,
    notificationVibration: false,
  });

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Initial Data Load moved to line 1289 to avoid ReferenceError due to hoisting/TDZ

  // Handle timeout
  useEffect(() => {
    if (loadingAll) {
      const timeout = setTimeout(() => {
        if (loadingAll) {
          setError({ message: 'Loading timeout - please try refreshing the page' });
        }
      }, 10000);
      return () => clearTimeout(timeout);
    }
  }, [loadingAll, user]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Additional callback functions - moved before early returns
  const handleAutoTradeToggle = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const prereqs = await checkAutoTradePrerequisites();
      if (!prereqs.allMet) {
        return;
      }
    }
    const newSettings = { ...notificationSettings, enableAutoTradeAlerts: enabled };
    saveNotificationSettings(newSettings);
  }, [notificationSettings]);

  const handleAccuracyAlertsToggle = useCallback(async () => {
    setAccuracyThresholdInput(notificationSettings?.accuracyAlerts?.threshold?.toString() || '80');
    setTelegramForAccuracy(notificationSettings?.telegramEnabled || false);
    setShowAccuracyModal(true);
  }, [notificationSettings]);

  const saveAccuracyAlerts = useCallback(async () => {
    const threshold = parseInt(accuracyThresholdInput);
    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
      showToast('Please enter a valid threshold between 1-100', 'error');
      return;
    }

    const newSettings = {
      ...notificationSettings,
      accuracyAlerts: {
        enabled: true,
        threshold,
      },
      telegramEnabled: telegramForAccuracy,
    };
    await saveNotificationSettings(newSettings);
    setShowAccuracyModal(false);
  }, [accuracyThresholdInput, notificationSettings, telegramForAccuracy]);

  // Compute readiness after all hooks are defined
  const isAuthenticated = !!user;
  const isAuthLoading = authLoading;

  // Loaders
  const loadSettings = async () => {
    try {
      const response = await settingsApi.load();

      // Handle authentication errors
      if (response.status === 401) {
        showToast('Authentication required. Please log in again.', 'error');
        handleLogout();
        return;
      }

      // Use loaded data
      if (response.data) {
        setSettings({
          maxPositionPercent: response.data.maxPositionPercent || 10,
          tradeType: response.data.tradeType || 'scalping',
          accuracyThreshold: response.data.accuracyThreshold || 85,
          maxDailyLoss: response.data.maxDailyLoss || 5,
          maxTradesPerDay: response.data.maxTradesPerDay || 50,
          // Primary Providers
          coinGeckoKey: response.data.coinGeckoKey || '',
          newsDataKey: response.data.newsDataKey || '',
          cryptoCompareKey: response.data.cryptoCompareKey || '',
          // Market Data Backup Providers
          coinPaprikaKey: response.data.coinPaprikaKey || '',
          coinPaprikaEnabled: response.data.coinPaprikaEnabled || false,
          coinMarketCapKey: response.data.coinMarketCapKey || '',
          coinMarketCapEnabled: response.data.coinMarketCapEnabled || false,
          coinLoreKey: response.data.coinLoreKey || '',
          coinLoreEnabled: response.data.coinLoreEnabled || false,
          coinApiKey: response.data.coinApiKey || '',
          coinApiEnabled: response.data.coinApiEnabled || false,
          braveNewCoinKey: response.data.braveNewCoinKey || '',
          braveNewCoinEnabled: response.data.braveNewCoinEnabled || false,
          messariKey: response.data.messariKey || '',
          messariEnabled: response.data.messariEnabled || false,
          kaikoKey: response.data.kaikoKey || '',
          kaikoEnabled: response.data.kaikoEnabled || false,
          liveCoinWatchKey: response.data.liveCoinWatchKey || '',
          liveCoinWatchEnabled: response.data.liveCoinWatchEnabled || false,
          coinStatsKey: response.data.coinStatsKey || '',
          coinStatsEnabled: response.data.coinStatsEnabled || false,
          coinCheckupKey: response.data.coinCheckupKey || '',
          coinCheckupEnabled: response.data.coinCheckupEnabled || false,
          // News Backup Providers
          cryptoPanicKey: response.data.cryptoPanicKey || '',
          cryptoPanicEnabled: response.data.cryptoPanicEnabled || false,
          redditKey: response.data.redditKey || '',
          redditEnabled: response.data.redditEnabled || false,
          cointelegraphKey: response.data.cointelegraphKey || '',
          cointelegraphEnabled: response.data.cointelegraphEnabled || false,
          altcoinBuzzKey: response.data.altcoinBuzzKey || '',
          altcoinBuzzEnabled: response.data.altcoinBuzzEnabled || false,
          gnewsKey: response.data.gnewsKey || '',
          gnewsEnabled: response.data.gnewsEnabled || false,
          marketauxKey: response.data.marketauxKey || '',
          marketauxEnabled: response.data.marketauxEnabled || false,
          webzKey: response.data.webzKey || '',
          webzEnabled: response.data.webzEnabled || false,
          coinStatsNewsKey: response.data.coinStatsNewsKey || '',
          coinStatsNewsEnabled: response.data.coinStatsNewsEnabled || false,
          newsCatcherKey: response.data.newsCatcherKey || '',
          newsCatcherEnabled: response.data.newsCatcherEnabled || false,
          cryptoCompareNewsKey: response.data.cryptoCompareNewsKey || '',
          cryptoCompareNewsEnabled: response.data.cryptoCompareNewsEnabled || false,
          // Metadata Backup Providers
          coinCapKey: response.data.coinCapKey || '',
          coinCapEnabled: response.data.coinCapEnabled || false,
          coinRankingKey: response.data.coinRankingKey || '',
          coinRankingEnabled: response.data.coinRankingEnabled || false,
          nomicsKey: response.data.nomicsKey || '',
          nomicsEnabled: response.data.nomicsEnabled || false,
          enableAutoTrade: response.data.enableAutoTrade || false,
          exchanges: response.data.exchanges || [],
          showUnmaskedKeys: response.data.showUnmaskedKeys || false,
          // Notification settings
          enableAutoTradeAlerts: response.data.enableAutoTradeAlerts || false,
          enableAccuracyAlerts: response.data.enableAccuracyAlerts || false,
          enableWhaleAlerts: response.data.enableWhaleAlerts || false,
          tradeConfirmationRequired: response.data.tradeConfirmationRequired || false,
          notificationSounds: response.data.notificationSounds || false,
          notificationVibration: response.data.notificationVibration || false,
        });
      }
    } catch (err: any) {
      // Handle authentication errors specifically
      if (err.response?.status === 401) {
        showToast('Authentication required. Please log in again.', 'error');
        handleLogout();
        return;
      }

      showToast(err.response?.data?.error || 'Error loading settings', 'error');
      // Set defaults on error
      setSettings(prev => ({
        ...prev,
        enableAutoTrade: false,
        exchanges: [],
      }));
    }
  };

  const loadIntegrations = useCallback(async () => {
    // Prevent multiple simultaneous calls
    if (integrationsLoading) return;
    setIntegrationsLoading(true);
    try {
      const response = await integrationsApi.load();

      // Handle authentication errors
      if (response.status === 401) {
        showToast('Authentication required. Please log in again.', 'error');
        handleLogout();
        return;
      }
      const integrationsData = response.data || {};
      setIntegrations(integrationsData);
      // Also update settings with API keys (if available)
      setSettings((prev: any) => ({
        ...prev,
        // Assuming the response includes the latest keys
        ...integrationsData
      }));
    } catch (err: any) {
      // Handle authentication errors specifically
      if (err.response?.status === 401) {
        showToast('Authentication required. Please log in again.', 'error');
        handleLogout();
        return;
      }

      setIntegrations({});
    } finally {
      setIntegrationsLoading(false);
    }
  }, [integrationsLoading]);

  const loadConnectedExchange = useCallback(async () => {
    if (!user) return;
    try {
      const response = await exchangeApi.status();
      if (response.data?.exchange) {
        const exchange = EXCHANGES.find(e => e.id === response.data.exchange);
        if (exchange) {
          setConnectedExchange({
            ...exchange,
            lastUpdated: new Date().toISOString()
          });
        } else {
          setConnectedExchange(null);
        }
      } else {
        setConnectedExchange(null);
      }
    } catch (err) {
      setConnectedExchange(null);
    }
  }, [user]);

  const loadTop100Coins = useCallback(async () => {
    try {
      const response = await adminApi.getMarketData();
      if (response.data && Array.isArray(response.data)) {
        const coins = response.data.map((coin: any) => coin.symbol || coin);
        setTop100Coins(coins);
      } else {
        // Fallback to common coins
        setTop100Coins([
          'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT', 'DOTUSDT', 'LINKUSDT', 'UNIUSDT', 'AVAXUSDT', 'LTCUSDT',
          'ALGOUSDT', 'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'ETCUSDT', 'XLMUSDT', 'THETAUSDT', 'FTTUSDT', 'HBARUSDT'
        ]);
      }
    } catch (err) {
      // Fallback to common coins
      setTop100Coins([
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT'
      ]);
    }
  }, []);

  const loadNotificationSettings = useCallback(async () => {
    try {
      const response = await settingsApi.notifications.load();
      setNotificationSettings(response.data);
    } catch (error: any) {
      showToast('Failed to load notification settings', 'error');
    }
  }, []);

  const saveNotificationSettings = useCallback(async (newSettings: any) => {
    try {
      await settingsApi.notifications.update(newSettings);
      setNotificationSettings(newSettings);
      showToast('Notification settings saved successfully', 'success');
    } catch (error: any) {
      showToast('Failed to save notification settings', 'error');
    }
  }, []);

  const checkAutoTradePrerequisites = useCallback(async () => {
    try {
      const response = await settingsApi.notifications.checkPrereqs();
      setNotificationPrereqs(response.data);
      if (!response.data.allMet) {
        setShowAutoTradePrereqModal(true);
      }
      return response.data;
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to check auto-trade prerequisites', 'error');
      return { allMet: false };
    }
  }, []);


  // Initial Data Load - Load sections independently to prevent one failure from breaking all
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Load each section independently so failures don't cascade
        const loadPromises = [
          loadSettings().catch(err => {
            console.warn('Failed to load settings:', err);
            // Settings will use defaults, don't set global error
          }),
          loadIntegrations().catch(err => {
            console.warn('Failed to load integrations:', err);
            // Integrations will be empty, don't set global error
          }),
          loadConnectedExchange().catch(err => {
            console.warn('Failed to load connected exchange:', err);
            // Exchange will be null, don't set global error
          }),
          loadTop100Coins().catch(err => {
            console.warn('Failed to load top 100 coins:', err);
            // Coins will be empty, don't set global error
          }),
          loadNotificationSettings().catch(err => {
            console.warn('Failed to load notification settings:', err);
            // Notifications will use defaults, don't set global error
          })
        ];

        await Promise.all(loadPromises);
      } catch (e) {
        // Only set error if all critical sections failed
        console.error('Multiple data loading failures:', e);
        setError(e);
      } finally {
        if (isMountedRef.current) {
          setLoadingAll(false);
        }
      }
    };
    fetchData();
  }, [retryCount, loadNotificationSettings, loadIntegrations, loadConnectedExchange, loadTop100Coins]);

  // Handlers
  const handleSaveGeneralSettings = async () => {
    setSavingSettings(true);
    try {
      await settingsApi.update(settings);
      showToast('General settings saved successfully', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleProviderKeyChange = async (providerName: string, keyName: string, apiKey: string) => {
    setSavingProvider(providerName);
    try {
      const apiName = API_NAME_MAP[providerName];
      await integrationsApi.saveKey(apiName, apiKey);
      setSettings({ ...settings, [keyName]: apiKey });
      showToast(`${providerName} API key saved!`, 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || `Failed to save ${providerName} key`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  const testProviderConnection = async (providerName: string, apiKey: string | boolean, keyName: string) => {
    const apiName = API_NAME_MAP[providerName];
    if (!apiName) {
      setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: 'API not mapped' } }));
      return;
    }
    setTestingProvider(providerName);
    try {
      // Check if API key is missing for a required API
      const FREE_APIS = ['coingecko', 'coinpaprika', 'coinlore', 'reddit', 'cointelegraph', 'altcoinbuzz', 'coinstatsnews', 'coincheckup', 'coincap'];
      if (!apiKey && !FREE_APIS.includes(apiName)) {
        setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: `${providerName} requires an API key.` } }));
        return;
      }

      const response = await integrationsApi.testKey(apiName, apiKey as string);
      if (response.data.valid) {
        setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'success', message: `${providerName} connection successful.` } }));
      } else {
        setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: response.data.message || `${providerName} key invalid or failed to connect.` } }));
      }
    } catch (err: any) {
      setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: err.response?.data?.error || `${providerName} connection failed.` } }));
    } finally {
      setTestingProvider(null);
    }
  };

  const calculatePositionForAccuracy = (accuracy: number) => {
    // DEFENSIVE: Check if accuracy is valid
    if (accuracy < 0 || accuracy > 100) {
      return 0;
    }
    // DEFENSIVE: Check if positionSizingMap exists and is valid
    if (!tradingSettings.positionSizingMap || !Array.isArray(tradingSettings.positionSizingMap)) {
      return 0;
    }

    const range = tradingSettings.positionSizingMap.find((r: any) =>
      r && typeof r.min === 'number' && typeof r.max === 'number' && typeof r.percent === 'number' && accuracy >= r.min && accuracy <= r.max
    );

    if (!range) return 0;

    const maxPosition = tradingSettings.maxPositionPerTrade || 10;
    const result = Math.min(range.percent, maxPosition);

    // DEFENSIVE: Ensure result is a valid number
    return isNaN(result) ? 0 : Math.max(0, result);
  };

  const updatePositionSizingMap = (index: number, field: 'min' | 'max' | 'percent', value: number) => {
    const newMap = [...tradingSettings.positionSizingMap];
    newMap[index] = { ...newMap[index], [field]: value };
    setTradingSettings({ ...tradingSettings, positionSizingMap: newMap });
  };

  // Coin Selection Helpers
  const addCoinToManual = (coin: string) => {
    if (!tradingSettings.manualCoins.includes(coin)) {
      setTradingSettings({ ...tradingSettings, manualCoins: [...tradingSettings.manualCoins, coin] });
    }
    setCoinSearch('');
    setShowCoinDropdown(false);
  };

  const removeCoinFromManual = (coin: string) => {
    setTradingSettings({ ...tradingSettings, manualCoins: tradingSettings.manualCoins.filter((c: string) => c !== coin) });
  };

  const filteredCoins = top100Coins.filter((coin) =>
    coin.toLowerCase().includes(coinSearch.toLowerCase()) && !tradingSettings.manualCoins.includes(coin)
  );

  // Exchange Handlers
  const handleExchangeSelect = (exchangeId: string) => {
    setSelectedExchange(exchangeId);
    setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
  };

  const handleExchangeFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExchangeForm({ ...exchangeForm, [e.target.name]: e.target.value });
  };

  const handleConnectExchange = async () => {
    setSavingExchange(true);
    try {
      const exchange = EXCHANGES.find(e => e.id === selectedExchange);
      if (!exchange) throw new Error('Invalid exchange selected');

      await exchangeApi.connect({
        exchange: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secretKey: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase,
      });

      showToast(`Successfully connected to ${exchange.name}!`, 'success');
      loadConnectedExchange(); // Reload connected exchange status
      setSelectedExchange('');
      setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to connect exchange', 'error');
    } finally {
      setSavingExchange(false);
    }
  };

  const handleTestExchange = async () => {
    setTestingExchange(true);
    try {
      const response = await exchangeApi.test();
      showToast(response.data.message || 'Exchange connection verified!', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Exchange connection failed. Check your API keys/permissions.', 'error');
    } finally {
      setTestingExchange(false);
    }
  };

  const handleDisconnectExchange = async () => {
    setSavingExchange(true); // Reusing savingExchange for disconnect loading state
    try {
      await exchangeApi.disconnect();
      showToast('Exchange disconnected successfully', 'success');
      setConnectedExchange(null);
      setShowDisconnectConfirm(false);
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to disconnect exchange', 'error');
    } finally {
      setSavingExchange(false);
    }
  };

  const testNotification = async () => {
    try {
      await settingsApi.notifications.test();
      showToast('Test notification sent successfully!', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to send test notification', 'error');
    }
  };

  if (loadingAll) {
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex items-center justify-center">
            <div className="text-center">
              <LoadingState message="Loading your settings..." />
              <p className="mt-4 text-sm text-gray-400">
                Please wait while we load your configuration and preferences.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Show error state with retry option
  if (error && !loadingAll) {
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-white mb-2">Settings Load Error</h1>
              <p className="text-gray-400">We encountered an issue loading your settings.</p>
            </div>
            <ErrorState
              message={error.message || "An unexpected error occurred while loading settings."}
              onRetry={handleRetry}
              onLogout={handleLogout}
            />
          </div>
        </main>
      </div>
    );
  }

  // Defensive rendering to prevent top-level crashes
  try {
    return (
      <ErrorBoundary>
        <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
          <Sidebar onLogout={handleLogout} />
          <main className="w-full relative z-10 pt-20 lg:pt-0 lg:pl-64">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
              <h1 className="text-3xl font-extrabold text-white mb-8 sm:mb-12">System Settings & Configuration</h1>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Column 1: Core Settings */}
                <div className="lg:col-span-2 space-y-8">
                  {/* General & Risk Settings Card */}
                  <SettingsCard>
                    <div className="mb-6">
                      <h2 className="text-xl font-bold text-white mb-2">General Trading Settings</h2>
                      <p className="text-sm text-gray-400">Core parameters for the auto-trading engine</p>
                    </div>

                    {/* Settings Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                      <div className="space-y-2">
                        <label htmlFor="maxPositionPercent" className="block text-sm font-medium text-gray-300">Max Position %</label>
                        <SettingsInput
                          id="maxPositionPercent"
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={settings.maxPositionPercent}
                          onChange={(e) => setSettings({ ...settings, maxPositionPercent: parseInt(e.target.value) || 1 })}
                        />
                        <p className="text-xs text-gray-400">Max capital to use per trade. Default: 10%</p>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="maxDailyLoss" className="block text-sm font-medium text-gray-300">Max Daily Loss %</label>
                        <SettingsInput
                          id="maxDailyLoss"
                          type="number"
                          min="1"
                          max="100"
                          step="0.5"
                          value={settings.maxDailyLoss}
                          onChange={(e) => setSettings({ ...settings, maxDailyLoss: parseFloat(e.target.value) || 1 })}
                        />
                        <p className="text-xs text-gray-400">Auto-stop if daily loss exceeds this value.</p>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="maxTradesPerDay" className="block text-sm font-medium text-gray-300">Max Trades/Day</label>
                        <SettingsInput
                          id="maxTradesPerDay"
                          type="number"
                          min="1"
                          max="500"
                          step="1"
                          value={settings.maxTradesPerDay}
                          onChange={(e) => setSettings({ ...settings, maxTradesPerDay: parseInt(e.target.value) || 1 })}
                        />
                        <p className="text-xs text-gray-400">Limit to avoid over-trading.</p>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="accuracyThreshold" className="block text-sm font-medium text-gray-300">Min Accuracy %</label>
                        <SettingsInput
                          id="accuracyThreshold"
                          type="number"
                          min="50"
                          max="100"
                          step="1"
                          value={settings.accuracyThreshold}
                          onChange={(e) => setSettings({ ...settings, accuracyThreshold: parseInt(e.target.value) || 50 })}
                        />
                        <p className="text-xs text-gray-400">Minimum accuracy for a trade signal.</p>
                      </div>
                    </div>

                    {/* Trade Type and Risk */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
                      <div className="space-y-2 sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-300">Trade Type</label>
                        <div className="flex space-x-2">
                          {['scalping', 'swing', 'daytrading'].map((type) => (
                            <button
                              key={type}
                              onClick={() => setSettings({ ...settings, tradeType: type })}
                              className={`flex-1 px-4 py-3 text-sm font-medium rounded-xl capitalize transition-all duration-300 hover:scale-105 ${settings.tradeType === type ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg ring-2 ring-purple-500/50' : 'bg-slate-700/50 text-gray-300 hover:bg-slate-600/50'
                                }`}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Save Button */}
                    <div className="mt-6 flex justify-end border-t border-white/5 pt-6">
                      <button
                        onClick={handleSaveGeneralSettings}
                        disabled={savingSettings}
                        className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                      >
                        {savingSettings ? 'Saving...' : 'Save General Settings'}
                      </button>
                    </div>
                  </SettingsCard>

                  {/* Trading Parameters Section */}
                  <SettingsCard className="mb-8">
                    <div className="mb-6">
                      <h2 className="text-xl font-bold text-white mb-2">Trading Engine Parameters</h2>
                      <p className="text-sm text-gray-400">Advanced risk and position sizing controls for auto-trade</p>
                    </div>

                    {/* Position Sizing Map */}
                    <div className="mb-8">
                      <h3 className="text-lg font-semibold text-white mb-4">Dynamic Position Sizing Map</h3>
                      <p className="text-sm text-gray-400 mb-4">Defines position size based on signal accuracy (Max: {tradingSettings.maxPositionPerTrade}%)</p>
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-4 text-xs font-bold uppercase text-purple-400 border-b border-purple-500/30 pb-2">
                          <span>Min Accuracy (%)</span>
                          <span>Max Accuracy (%)</span>
                          <span>Position Size (%)</span>
                        </div>
                        {tradingSettings.positionSizingMap.map((range: any, index: number) => (
                          <div key={index} className="grid grid-cols-3 gap-4 items-center pb-4 border-b border-white/5 last:border-b-0 transition-all duration-300 hover:bg-white/5 rounded-lg p-2 -mx-2">
                            <SettingsInput
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={range.min}
                              onChange={(e) => updatePositionSizingMap(index, 'min', parseInt(e.target.value))}
                            />
                            <SettingsInput
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={range.max}
                              onChange={(e) => updatePositionSizingMap(index, 'max', parseInt(e.target.value))}
                            />
                            <SettingsInput
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={range.percent}
                              onChange={(e) => updatePositionSizingMap(index, 'percent', parseInt(e.target.value))}
                            />
                          </div>
                        ))}
                        <button
                          onClick={() => setTradingSettings({
                            ...tradingSettings,
                            positionSizingMap: [...tradingSettings.positionSizingMap, { min: 0, max: 0, percent: 0 }]
                          })}
                          className="flex items-center justify-center w-full px-4 py-2 mt-4 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 transition-all duration-300 hover:scale-[1.01]"
                        >
                          <PlusIcon className="w-4 h-4 mr-2" /> Add Range
                        </button>
                      </div>

                      {/* Live Preview */}
                      <div className="mt-8 p-5 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <h4 className="text-sm font-semibold text-blue-200 mb-2">Live Preview:</h4>
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-blue-200">Test Accuracy:</label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={sampleAccuracy}
                            onChange={(e) => setSampleAccuracy(parseInt(e.target.value))}
                            className="w-full h-2 bg-purple-900/50 rounded-lg appearance-none cursor-pointer transition-all duration-300 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                          />
                          <span className="text-lg font-bold text-white w-12 flex-shrink-0">{sampleAccuracy}%</span>
                        </div>
                        <div className="mt-2 text-center text-lg font-bold text-white">
                          Position Size: <span className="text-purple-400">{calculatePositionForAccuracy(sampleAccuracy)}%</span> of Max ({settings.maxPositionPercent}%)
                        </div>
                      </div>
                    </div>

                    {/* Coin Selection */}
                    <div className="mb-6">
                      <h3 className="text-lg font-semibold text-white mb-3">Manual Coin Selection</h3>
                      <p className="text-sm text-gray-400 mb-4">Select specific coins for the engine to trade (if disabled, engine scans all markets)</p>
                      <div className="relative">
                        <SettingsInput
                          type="text"
                          placeholder="Search and add coin (e.g., BTCUSDT)"
                          value={coinSearch}
                          onChange={(e) => {
                            setCoinSearch(e.target.value);
                            setShowCoinDropdown(true);
                          }}
                          onFocus={() => setShowCoinDropdown(true)}
                        />
                        {showCoinDropdown && coinSearch && (
                          <div className="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                            {filteredCoins.length > 0 ? (
                              filteredCoins.slice(0, 10).map((coin) => (
                                <div
                                  key={coin}
                                  className="px-4 py-2 text-sm text-gray-200 hover:bg-purple-600/50 cursor-pointer transition-colors"
                                  onClick={() => addCoinToManual(coin)}
                                >
                                  {coin}
                                </div>
                              ))
                            ) : (
                              <div className="px-4 py-2 text-sm text-gray-400">No coins found or already added.</div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {tradingSettings.manualCoins.map((coin: string) => (
                          <span
                            key={coin}
                            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-500/20 text-purple-300 border border-purple-400/30 cursor-pointer transition-all duration-300 hover:bg-red-500/30 hover:text-red-300"
                            onClick={() => removeCoinFromManual(coin)}
                          >
                            {coin}
                            <XMarkIcon className="w-3 h-3 ml-1" />
                          </span>
                        ))}
                      </div>
                    </div>
                  </SettingsCard>

                  {/* API Provider Configuration Card */}
                  <SettingsCard>
                    <div className="mb-6">
                      <h2 className="text-xl font-bold text-white mb-2">API Provider Configuration</h2>
                      <p className="text-sm text-gray-400">Configure keys for data, news, and metadata providers</p>
                    </div>
                    <div className="space-y-6">
                      {Object.entries(PROVIDER_CONFIG).map(([key, config]) => (
                        <div key={key} className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 transition-all duration-300 hover:shadow-xl hover:scale-[1.005]">
                          <div className="flex items-center gap-4 mb-4">
                            <div className={`p-3 rounded-full ${config.bgColor}/20`}>
                              <span className="text-xl">{config.icon}</span>
                            </div>
                            <div>
                              <h3 className="text-lg font-bold text-white">{config.title}</h3>
                              <p className="text-xs text-gray-400">{config.description}</p>
                            </div>
                          </div>

                          {/* Primary Provider */}
                          <div className="bg-slate-800/50 rounded-xl p-5 border border-purple-500/20 transition-all duration-300 hover:bg-slate-700/50 mb-6">
                            <div className="flex justify-between items-center mb-4">
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30"> PRIMARY </span>
                              <span className="text-sm font-medium text-white">{config.primary.name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${config.primary.name === 'CoinGecko' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                }`}>
                                {config.primary.name === 'CoinGecko' ? 'API Not Required' : 'API Required'}
                              </span>
                            </div>
                            {config.primary.name !== 'CoinGecko' ? (
                              <div className="space-y-2">
                                <SettingsInput
                                  type={settings.showUnmaskedKeys ? 'text' : 'password'}
                                  placeholder={config.primary.placeholder}
                                  value={settings[config.primary.key] || ''}
                                  onChange={(e) => setSettings({ ...settings, [config.primary.key]: e.target.value })}
                                />
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => testProviderConnection(config.primary.name, settings[config.primary.key], config.primary.key)}
                                    disabled={testingProvider === config.primary.name}
                                    className="px-3 py-2 bg-slate-600/50 text-slate-300 text-sm rounded-lg hover:bg-slate-500/70 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                                  >
                                    {testingProvider === config.primary.name ? 'Testing...' : 'Test'}
                                  </button>
                                  <button
                                    onClick={() => handleProviderKeyChange(config.primary.name, config.primary.key, settings[config.primary.key])}
                                    disabled={savingProvider === config.primary.name || !settings[config.primary.key]}
                                    className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg text-sm hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                                  >
                                    {savingProvider === config.primary.name ? 'Saving...' : 'Save'}
                                  </button>
                                </div>
                                <ProviderTestResult result={providerTestResults[config.primary.name]} />
                              </div>
                            ) : (
                              <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-300">
                                CoinGecko is automatically integrated for free tier use.
                              </div>
                            )}
                          </div>

                          {/* Backup Providers */}
                          <div className="border-t border-white/10 pt-4">
                            <button
                              onClick={() => {
                                if (key === 'marketData') setShowMarketBackups(prev => !prev);
                                else if (key === 'news') setShowNewsBackups(prev => !prev);
                                else if (key === 'metadata') setShowMetadataBackups(prev => !prev);
                              }}
                              className="flex justify-between items-center w-full py-2 text-sm font-medium text-gray-300 transition-colors duration-300 hover:text-purple-400"
                            >
                              <span>
                                {key === 'marketData' && 'Market Data Backups'}
                                {key === 'news' && 'News Backups'}
                                {key === 'metadata' && 'Metadata Backups'}
                                {' '} ({config.backups.length})
                              </span>
                              {((key === 'marketData' && showMarketBackups) || (key === 'news' && showNewsBackups) || (key === 'metadata' && showMetadataBackups)) ? (
                                <ChevronUpIcon className="w-5 h-5 transition-transform" />
                              ) : (
                                <ChevronDownIcon className="w-5 h-5 transition-transform" />
                              )}
                            </button>

                            {((key === 'marketData' && showMarketBackups) || (key === 'news' && showNewsBackups) || (key === 'metadata' && showMetadataBackups)) && (
                              <div className="mt-4 space-y-4">
                                {config.backups.map((backup) => (
                                  <div key={backup.name} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 transition-all duration-300 hover:bg-slate-700/50 hover:shadow-md">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-4">
                                        <ToggleSwitch
                                          id={`toggle-${backup.key}`}
                                          checked={settings[backup.enabledKey] || false}
                                          onChange={(checked) => setSettings({ ...settings, [backup.enabledKey]: checked })}
                                          ariaLabel={`Toggle ${backup.name}`}
                                          size="small"
                                        />
                                        <span className="text-sm font-medium text-white">{backup.name}</span>
                                      </div>
                                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${backup.type === 'free' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        }`}>
                                        {backup.type === 'free' ? 'Free/No API' : 'API Required'}
                                      </span>
                                    </div>

                                    {settings[backup.enabledKey] && backup.type !== 'free' && (
                                      <div className="mt-4 space-y-2">
                                        <SettingsInput
                                          type={settings.showUnmaskedKeys ? 'text' : 'password'}
                                          placeholder={backup.placeholder}
                                          value={settings[backup.key] || ''}
                                          onChange={(e) => setSettings({ ...settings, [backup.key]: e.target.value })}
                                        />
                                        <div className="flex justify-end gap-2">
                                          <button
                                            onClick={() => testProviderConnection(backup.name, settings[backup.key], backup.key)}
                                            disabled={testingProvider === backup.name}
                                            className="px-3 py-2 bg-slate-600/50 text-slate-300 text-sm rounded-lg hover:bg-slate-500/70 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                                          >
                                            {testingProvider === backup.name ? 'Testing...' : 'Test'}
                                          </button>
                                          <button
                                            onClick={() => handleProviderKeyChange(backup.name, backup.key, settings[backup.key])}
                                            disabled={savingProvider === backup.name || !settings[backup.key]}
                                            className="px-3 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg text-sm hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300 disabled:opacity-50 hover:scale-[1.05]"
                                          >
                                            {savingProvider === backup.name ? 'Saving...' : 'Save'}
                                          </button>
                                        </div>
                                        <ProviderTestResult result={providerTestResults[backup.name]} size="small" />
                                      </div>
                                    )}
                                    {settings[backup.enabledKey] && backup.type === 'free' && (
                                      <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-300">
                                        {backup.name} is enabled and does not require an API key.
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-end pt-4 border-t border-white/10">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={settings.showUnmaskedKeys}
                            onChange={(e) => setSettings({ ...settings, showUnmaskedKeys: e.target.checked })}
                          />
                          <div className="w-10 h-5 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                          <span className="ml-3 text-sm font-medium text-gray-300">Show Keys</span>
                        </label>
                      </div>
                    </div>
                  </SettingsCard>
                </div>

                {/* Column 2: Notifications, Exchange, Background Research */}
                <div className="space-y-8">
                  {/* Background Research Wizard */}
                  <h2 className="text-xl font-bold text-white mb-4">Background Research</h2>
                  <BackgroundResearchWizard />

                  {/* Exchange Connection Card */}
                  <SettingsCard>
                    <div className="mb-6">
                      <h2 className="text-xl font-bold text-white mb-2">Exchange Connection</h2>
                      <p className="text-sm text-gray-400">Securely connect your trading account</p>
                    </div>

                    {connectedExchange ? (
                      // Connected State
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-green-500/10 rounded-xl border border-green-400/30">
                          <div className="flex items-center gap-4">
                            {React.createElement(connectedExchange.logo, { size: 48 })}
                            <div>
                              <h3 className="text-xl font-semibold text-white">{connectedExchange.name}</h3>
                              <p className="text-sm text-gray-400">Exchange account connected</p>
                            </div>
                          </div>
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300 border border-green-400/30">
                            <CheckCircleIcon className="w-3 h-3 mr-1" /> Connected
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm text-gray-400 mb-6">
                          <span>Last updated: {new Date(connectedExchange.lastUpdated).toLocaleString()}</span>
                          <button
                            onClick={handleTestExchange}
                            disabled={testingExchange}
                            className="px-3 py-1 bg-blue-600/50 text-white text-xs rounded-lg hover:bg-blue-700/50 transition-all duration-300 hover:scale-[1.05]"
                          >
                            {testingExchange ? 'Testing...' : 'Test Connection'}
                          </button>
                        </div>
                        <button
                          onClick={() => setShowDisconnectConfirm(true)}
                          className="w-full px-4 py-2 bg-red-600/80 text-white font-medium rounded-xl hover:bg-red-700/80 transition-colors duration-300 hover:scale-[1.01]"
                        >
                          Disconnect Exchange
                        </button>
                      </div>
                    ) : (
                      // Exchange selection form
                      <div className="space-y-6">
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                          {EXCHANGES.map((exchange) => (
                            <div
                              key={exchange.id}
                              onClick={() => handleExchangeSelect(exchange.id)}
                              className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center space-y-2 cursor-pointer transition-all duration-300 hover:scale-[1.05] hover:border-purple-500 ${selectedExchange === exchange.id ? 'border-purple-500 bg-purple-500/10 shadow-xl ring-2 ring-purple-500' : 'border-slate-700/50 bg-slate-800/50 hover:bg-slate-700/50'
                                }`}
                            >
                              {React.createElement(exchange.logo, { size: 32 })}
                              <span className="text-xs text-gray-300 font-medium">{exchange.name}</span>
                            </div>
                          ))}
                        </div>

                        {selectedExchange && (
                          <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-white pt-2 border-t border-white/10">Enter API Credentials</h3>
                            {EXCHANGES.find(e => e.id === selectedExchange)?.fields.map(field => (
                              <div key={field}>
                                <label className="block text-sm font-medium text-gray-300 mb-1 capitalize">
                                  {field.replace('Key', ' Key').replace('passphrase', 'Passphrase')}
                                </label>
                                <SettingsInput
                                  type={field.toLowerCase().includes('passphrase') || settings.showUnmaskedKeys ? 'text' : 'password'}
                                  name={field}
                                  placeholder={`Enter ${field.replace('Key', ' Key').replace('passphrase', 'Passphrase')}`}
                                  value={exchangeForm[field as keyof typeof exchangeForm]}
                                  onChange={handleExchangeFormChange}
                                  required
                                />
                              </div>
                            ))}
                            <button
                              onClick={handleConnectExchange}
                              disabled={savingExchange || !exchangeForm.apiKey || !exchangeForm.secretKey}
                              className="w-full px-4 py-3 mt-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:scale-[1.01]"
                            >
                              {savingExchange ? 'Connecting...' : 'Connect Exchange'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </SettingsCard>

                  {/* Notification Settings Card */}
                  <SettingsCard>
                    <div className="mb-6">
                      <h2 className="text-xl font-bold text-white mb-2">Notification & Alert Settings</h2>
                      <p className="text-sm text-gray-400">Configure how you receive critical system alerts</p>
                    </div>

                    <div className="space-y-4">
                      {/* Auto-Trade Alerts */}
                      <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 shadow-lg transition-all duration-300 hover:bg-white/10 hover:shadow-xl hover:scale-[1.005]">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-white mb-1">Auto-Trade Execution Alerts</h3>
                            <p className="text-xs text-gray-400">Get notified when the engine opens or closes a position</p>
                          </div>
                          <ToggleSwitch
                            id="autoTradeAlerts"
                            checked={notificationSettings?.enableAutoTradeAlerts || false}
                            onChange={handleAutoTradeToggle}
                            ariaLabel="Enable auto-trade alerts"
                          />
                        </div>
                      </div>

                      {/* Accuracy Alerts */}
                      <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 shadow-lg transition-all duration-300 hover:bg-white/10 hover:shadow-xl hover:scale-[1.005]">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-white mb-1">High Accuracy Signal Alerts</h3>
                            <p className="text-xs text-gray-400">Alert me for signals &gt; {notificationSettings?.accuracyAlerts?.threshold || 80}%</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-gray-300 hidden sm:inline">Status:</span>
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${notificationSettings?.accuracyAlerts?.enabled
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-red-500/20 text-red-300'
                              }`}>
                              {notificationSettings?.accuracyAlerts?.enabled ? 'Active' : 'Disabled'}
                            </span>
                            {notificationSettings?.accuracyAlerts?.enabled ? (
                              <button
                                onClick={() => saveNotificationSettings({ ...notificationSettings, accuracyAlerts: { enabled: false, threshold: 80 } })}
                                className="px-3 py-1 bg-red-500/50 text-white text-xs rounded-lg hover:bg-red-600/50 transition-all duration-300 hover:scale-[1.05]"
                              >
                                Disable
                              </button>
                            ) : (
                              <button
                                onClick={handleAccuracyAlertsToggle}
                                className="px-3 py-1 bg-purple-500/50 text-white text-xs rounded-lg hover:bg-purple-600/50 transition-all duration-300 hover:scale-[1.05]"
                              >
                                Configure
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Whale Alerts */}
                      <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 shadow-lg transition-all duration-300 hover:bg-white/10 hover:shadow-xl hover:scale-[1.005]">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-white mb-1">Large Transaction (Whale) Alerts</h3>
                            <p className="text-xs text-gray-400">Get notified of significant whale transactions (experimental)</p>
                          </div>
                          <ToggleSwitch
                            id="whaleAlerts"
                            checked={notificationSettings?.enableWhaleAlerts || false}
                            onChange={(checked) => saveNotificationSettings({ ...notificationSettings, enableWhaleAlerts: checked })}
                            ariaLabel="Enable whale alerts"
                          />
                        </div>
                      </div>

                      {/* Trade Confirmation Required */}
                      <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 shadow-lg transition-all duration-300 hover:bg-white/10 hover:shadow-xl hover:scale-[1.005]">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-white mb-1">Trade Confirmation Required</h3>
                            <p className="text-xs text-gray-400">Require manual confirmation before executing an auto-trade signal</p>
                          </div>
                          <ToggleSwitch
                            id="tradeConfirmationRequired"
                            checked={notificationSettings?.tradeConfirmationRequired || false}
                            onChange={(checked) => saveNotificationSettings({ ...notificationSettings, tradeConfirmationRequired: checked })}
                            ariaLabel="Require trade confirmation"
                          />
                        </div>
                      </div>

                      {/* Sound & Haptics */}
                      <div className="bg-white/5 backdrop-blur-sm rounded-xl p-5 border border-white/10 shadow-lg transition-all duration-300 hover:bg-white/10 hover:shadow-xl hover:scale-[1.005]">
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-sm font-semibold text-white mb-1">Notification Sound & Haptics</h3>
                            <p className="text-xs text-gray-400">Enable sound and vibration for mobile notifications</p>
                          </div>
                          <div className="flex items-center space-x-4">
                            <div className="flex items-center gap-2">
                              <SpeakerWaveIcon className={`w-5 h-5 ${notificationSettings?.notificationSounds ? 'text-purple-400' : 'text-gray-500'}`} />
                              <ToggleSwitch
                                id="notificationSounds"
                                checked={notificationSettings?.notificationSounds || false}
                                onChange={(checked) => saveNotificationSettings({ ...notificationSettings, notificationSounds: checked })}
                                ariaLabel="Enable notification sounds"
                                size="small"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <DevicePhoneMobileIcon className={`w-5 h-5 ${notificationSettings?.notificationVibration ? 'text-purple-400' : 'text-gray-500'}`} />
                              <ToggleSwitch
                                id="notificationVibration"
                                checked={notificationSettings?.notificationVibration || false}
                                onChange={(checked) => saveNotificationSettings({ ...notificationSettings, notificationVibration: checked })}
                                ariaLabel="Enable notification vibration"
                                size="small"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Test Notification Button */}
                      <div className="mt-6 flex justify-end pt-4 border-t border-white/10">
                        <button
                          onClick={testNotification}
                          className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-cyan-600 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                        >
                          Send Test Notification
                        </button>
                      </div>
                    </div>
                  </SettingsCard>
                </div>
              </div>
            </div>
          </main>

          {/* Disconnect Confirmation Modal */}
          {showDisconnectConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
              <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-lg w-full text-center border border-red-500/20 shadow-2xl">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Confirm Disconnect</h3>
                <p className="text-gray-400 mb-6">Are you sure you want to disconnect your exchange account? This will halt all auto-trading activity.</p>
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => setShowDisconnectConfirm(false)}
                    className="px-6 py-3 bg-slate-700/50 text-gray-300 font-medium rounded-xl hover:bg-slate-600/50 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDisconnectExchange}
                    disabled={savingExchange}
                    className="px-6 py-3 bg-red-600/80 text-white font-medium rounded-xl hover:bg-red-700/80 transition-colors disabled:opacity-50"
                  >
                    {savingExchange ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Auto-Trade Prerequisite Modal */}
          {showAutoTradePrereqModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
              <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-lg w-full text-center border border-amber-500/20 shadow-2xl">
                <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <ExclamationTriangleIcon className="w-8 h-8 text-amber-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Auto-Trade Prerequisites Not Met</h3>
                <p className="text-gray-400 mb-4">You must complete the following steps before enabling Auto-Trade Alerts:</p>
                <ul className="text-left space-y-2 mb-6">
                  <li className={`flex items-center gap-2 ${notificationPrereqs?.exchangeConnected ? 'text-green-400' : 'text-red-400'}`}>
                    {notificationPrereqs?.exchangeConnected ? <CheckCircleIcon className="w-5 h-5 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 flex-shrink-0" />}
                    <span>Connect an Exchange Account</span>
                  </li>
                  <li className={`flex items-center gap-2 ${notificationPrereqs?.tradeTypeSet ? 'text-green-400' : 'text-red-400'}`}>
                    {notificationPrereqs?.tradeTypeSet ? <CheckCircleIcon className="w-5 h-5 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 flex-shrink-0" />}
                    <span>Configure Trade Type (e.g., Scalping)</span>
                  </li>
                  <li className={`flex items-center gap-2 ${notificationPrereqs?.riskSet ? 'text-green-400' : 'text-red-400'}`}>
                    {notificationPrereqs?.riskSet ? <CheckCircleIcon className="w-5 h-5 flex-shrink-0" /> : <XCircleIcon className="w-5 h-5 flex-shrink-0" />}
                    <span>Set Max Position and Max Daily Loss</span>
                  </li>
                </ul>
                <button
                  onClick={() => setShowAutoTradePrereqModal(false)}
                  className="w-full px-6 py-3 bg-purple-600/80 text-white font-medium rounded-xl hover:bg-purple-700/80 transition-colors"
                >
                  Close and Update Settings
                </button>
              </div>
            </div>
          )}

          {/* Accuracy Alert Modal */}
          {showAccuracyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
              <div className="bg-slate-900/90 backdrop-blur-lg rounded-2xl p-8 max-w-md w-full text-center border border-purple-500/20 shadow-2xl space-y-4">
                <h3 className="text-xl font-bold text-white mb-2">Accuracy Alert Configuration</h3>
                <p className="text-gray-400 text-sm">Define the minimum model accuracy required to trigger a notification.</p>

                <div className="space-y-4">
                  <div className="space-y-2 text-left">
                    <label htmlFor="accuracy-threshold-input" className="block text-sm font-medium text-gray-300">Minimum Accuracy Threshold (%)</label>
                    <SettingsInput
                      id="accuracy-threshold-input"
                      type="number"
                      step="1"
                      min="1"
                      max="100"
                      value={accuracyThresholdInput}
                      onChange={(e) => setAccuracyThresholdInput(e.target.value)}
                      placeholder="e.g., 90"
                    />
                    <p className="text-xs text-gray-400">Alert will trigger when model confidence is at or above this value.</p>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                    <span className="text-sm font-medium">Send via Telegram</span>
                    <ToggleSwitch
                      id="telegram-accuracy"
                      checked={telegramForAccuracy}
                      onChange={setTelegramForAccuracy}
                      ariaLabel="Toggle Telegram for accuracy alerts"
                      size="small"
                    />
                  </div>

                  <button
                    onClick={saveAccuracyAlerts}
                    className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all duration-300 shadow-lg hover:scale-[1.01]"
                  >
                    Save Accuracy Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Toast Notification */}
          {toast && <Toast message={toast.message} type={toast.type} />}

        </div>
      </ErrorBoundary>
    );
  } catch (renderError) {
    console.error('Settings component render error:', renderError);
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] flex items-center justify-center">
        <div className="max-w-md mx-auto text-center p-8 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl">
          <div className="text-slate-400 mb-4">
            <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Settings Temporarily Unavailable</h3>
          <p className="text-slate-400 text-sm mb-4">We're experiencing technical difficulties. Please try again later.</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-slate-700/50 border border-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-600/50 transition-colors text-sm font-medium"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }
};

export default Settings;