import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsApi, integrationsApi, exchangeApi, adminApi } from '../services/api';
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
    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
    {...props}
  />
);

// Reusable card component for consistent styling
const SettingsCard: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 sm:p-6 shadow-sm ${className}`}>
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
    <div className={`flex items-center gap-2 p-2 rounded-lg text-${size === 'small' ? 'xs' : 'sm'} ${
      result.status === 'success'
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
                {[0, 1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300 ${
                      step <= currentStep
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                        : 'bg-slate-700 text-gray-400'
                    }`}
                  >
                    {step === 0 ? '✓' : step}
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
          <div className="p-6">
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
                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold rounded-xl hover:from-blue-600 hover:to-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
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
                      className="px-8 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all shadow-lg"
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
                      className={`relative flex items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-105 ${
                        researchFrequency === value
                          ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white shadow-lg'
                          : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-slate-500/70 hover:bg-slate-700/50'
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
                      <div className="flex-1 text-center">
                        <div className="text-lg font-bold mb-1">{label}</div>
                        <div className="text-xs text-gray-400">{desc}</div>
                      </div>
                      {accuracyTrigger === value && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm">✓</span>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <p className="text-sm text-amber-200">
                    <span className="font-semibold">⚠️ Warning:</span> Choosing a high accuracy trigger (e.g., 95%) will significantly reduce the number of alerts received.
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
                  <h3 className="text-2xl font-bold text-white mb-2">💾 Review & Save</h3>
                  <p className="text-gray-400">
                    Please review your background deep research settings before saving.
                  </p>
                </div>
                <div className="bg-slate-800/30 rounded-xl p-6 border border-slate-600/30 space-y-4">
                  <h4 className="text-lg font-semibold text-white mb-3">Configuration Summary</h4>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-sm font-medium text-gray-300">Status</span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-300">
                      Enabled
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-sm font-medium text-gray-300">Telegram Config</span>
                    <span className="text-sm font-semibold text-purple-400">
                      {telegramBotToken.length > 10 ? 'Token Configured' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <span className="text-sm font-medium text-gray-300">Research Frequency</span>
                    <span className="text-sm font-semibold text-white">
                      {researchFrequency} Minutes
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-300">Accuracy Trigger</span>
                    <span className="text-sm font-semibold text-white">
                      🎯 {accuracyTrigger === 60 ? '60% - 75%' : accuracyTrigger === 75 ? '75% - 85%' : accuracyTrigger === 85 ? '85% - 95%' : 'Above 95%'}
                    </span>
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
                        ✅ Confirm & Save Settings
                      </span>
                    )}
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
const Settings: React.FC = () => {
  const navigate = useNavigate();
  const { user, handleLogout: authHandleLogout } = useAuth();
  const [loadingAll, setLoadingAll] = useState(true);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const isMountedRef = useRef(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
    // Notification settings
    enableAutoTradeAlerts: false,
    enableAccuracyAlerts: false,
    enableWhaleAlerts: false,
    tradeConfirmationRequired: false,
    notificationSounds: false,
    notificationVibration: false,
  });
  const [showUnmaskedKeys, setShowUnmaskedKeys] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { status: 'success' | 'error' | null; message: string }>>({});

  // Exchange States
  const [connectedExchange, setConnectedExchange] = useState<any>(null);
  const [selectedExchange, setSelectedExchange] = useState<string | null>(null);
  const [exchangeForm, setExchangeForm] = useState({ apiKey: '', secretKey: '', passphrase: '' });
  const [savingExchange, setSavingExchange] = useState(false);
  const [disconnectingExchange, setDisconnectingExchange] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Trading Settings States
  const [tradingSettings, setTradingSettings] = useState<any>({
    tradeType: 'scalping',
    maxPositionPerTrade: 10,
    accuracyThreshold: 85,
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    positionSizingMap: [
      { min: 0, max: 84, percent: 0 },
      { min: 85, max: 89, percent: 3 },
      { min: 90, max: 94, percent: 6 },
      { min: 95, max: 99, percent: 8.5 },
      { min: 100, max: 100, percent: 10 }
    ],
    manualCoins: [],
  });
  const [savingTradingSettings, setSavingTradingSettings] = useState(false);
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

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleRetry = useCallback(() => {
    setError(null);
    setLoadingAll(true);
    setRetryCount(prev => prev + 1);
  }, []);

  const handleLogout = useCallback(() => {
    authHandleLogout();
    navigate('/login');
  }, [authHandleLogout, navigate]);

  // Loaders
  const loadSettings = async () => {
    try {
      const response = await settingsApi.load();
      // Use loaded successfully if (response.data) {
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
      showToast(err.response?.data?.error || 'Error loading settings', 'error');
      // Set defaults on error
      setSettings(prev => ({
        ...prev,
        enableAutoTrade: false,
        exchanges: [],
      }));
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
      // Also update settings with API keys (if available)
      setSettings((prev: any) => ({
        ...prev,
        // Assuming the response includes the latest keys
        ...integrationsData
      }));
    } catch (err: any) {
      setIntegrations({});
    } finally {
      setIntegrationsLoading(false);
    }
  };

  const loadConnectedExchange = async () => {
    if (!user) return;
    try {
      const response = await exchangeApi.status();
      if (response.data && response.data.exchanges) {
        // Find the first connected exchange
        const connectedExchangeData = response.data.exchanges.find((ex: any) => ex.connected);
        if (connectedExchangeData) {
          setConnectedExchange({
            id: connectedExchangeData.exchange,
            name: connectedExchangeData.exchange,
            logo: EXCHANGES.find(e => e.id === connectedExchangeData.exchange)?.logo || (() => <div className="w-12 h-12 bg-gray-500 rounded-full"></div>),
            lastUpdated: connectedExchangeData.lastUpdated,
          });
          setSelectedExchange(null); // Clear selection on successful connection
        } else {
          setConnectedExchange(null);
        }
      }
    } catch (err) {
      setConnectedExchange(null);
    }
  };

  const loadTradingSettings = async () => {
    try {
      const response = await settingsApi.trading.load();
      if (response.data) {
        setTradingSettings({
          tradeType: response.data.tradeType || 'scalping',
          maxPositionPerTrade: response.data.maxPositionPerTrade || 10,
          accuracyThreshold: response.data.accuracyThreshold || 85,
          maxDailyLoss: response.data.maxDailyLoss || 5,
          maxTradesPerDay: response.data.maxTradesPerDay || 50,
          positionSizingMap: response.data.positionSizingMap || [
            { min: 0, max: 84, percent: 0 },
            { min: 85, max: 89, percent: 3 },
            { min: 90, max: 94, percent: 6 },
            { min: 95, max: 99, percent: 8.5 },
            { min: 100, max: 100, percent: 10 }
          ],
          manualCoins: response.data.manualCoins || [],
        });
      }
    } catch (err) {
      // DEFENSIVE: On API failure, show warning but keep UI functional with defaults
      setToast({ message: 'Unable to load trading settings - check connection', type: 'error' });
      setTimeout(() => setToast(null), 5000); // Settings will use defaults defined in state
    }
  };

  const loadTop100Coins = async () => {
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
  };

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
      const response = await settingsApi.notifications.checkPrereq();
      setNotificationPrereqs(response.data);
      return response.data;
    } catch (error: any) {
      return { met: false, missing: ['Error checking prerequisites'] };
    }
  }, []);

  // Combined data loading logic
  const loadAllData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;

    try {
      setLoadingAll(true);
      setError(null);

      let settingsResult: PromiseSettledResult<any>;
      let integrationsResult: PromiseSettledResult<any>;
      let exchangeResult: PromiseSettledResult<any>;
      let tradingSettingsResult: PromiseSettledResult<any>;
      let topCoinsResult: PromiseSettledResult<any>;
      let notificationsResult: PromiseSettledResult<any>;

      [settingsResult, integrationsResult, exchangeResult, tradingSettingsResult, topCoinsResult, notificationsResult] = await Promise.allSettled([
        loadSettings(),
        loadIntegrations(),
        loadConnectedExchange(),
        loadTradingSettings(),
        loadTop100Coins(),
        loadNotificationSettings()
      ]);

      // Log any failures but don't fail the whole load
      if (settingsResult.status === 'rejected') { suppressConsoleError(settingsResult.reason, 'loadSettings'); }
      if (integrationsResult.status === 'rejected') { suppressConsoleError(integrationsResult.reason, 'loadIntegrations'); }
      if (exchangeResult.status === 'rejected') { suppressConsoleError(exchangeResult.reason, 'loadConnectedExchange'); }
      if (topCoinsResult.status === 'rejected') { suppressConsoleError(topCoinsResult.reason, 'loadTop100Coins'); }
      if (notificationsResult.status === 'rejected') { suppressConsoleError(notificationsResult.reason, 'loadNotificationSettings'); }

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
  }, [user, loadNotificationSettings]);

  useEffect(() => {
    if (user) {
      loadAllData();
    }
  }, [user, loadAllData]);

  // Force load after 10 seconds if still loading (fallback for slow APIs)
  useEffect(() => {
    if (loadingAll && user) {
      const timeout = setTimeout(() => {
        if (isMountedRef.current) {
          setLoadingAll(false);
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
        setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: 'API key required' } }));
        return;
      }

      // Call test API - this would need to be implemented in the backend
      const testResponse = await integrationsApi.testProvider(apiName, { apiKey: apiKey as string });

      if (testResponse.data?.success) {
        setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'success', message: 'Connection successful' } }));
      } else {
        setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: testResponse.data?.error || 'Connection failed' } }));
      }
    } catch (err: any) {
      setProviderTestResults(prev => ({ ...prev, [providerName]: { status: 'error', message: err.response?.data?.error || 'Connection failed' } }));
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSaveTradingSettings = async () => {
    setSavingTradingSettings(true);
    try {
      await settingsApi.trading.update(tradingSettings);
      showToast('Trading parameters saved successfully', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save trading parameters', 'error');
    } finally {
      setSavingTradingSettings(false);
    }
  };

  // Trading Helpers
  const calculatePositionForAccuracy = (accuracy: number): number => {
    // DEFENSIVE: Validate inputs to prevent NaN/undefined
    if (!accuracy || isNaN(accuracy) || accuracy < 0 || accuracy > 100) {
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

  const handleSaveExchange = async () => {
    if (!selectedExchange) return;

    const exchange = EXCHANGES.find(e => e.id === selectedExchange);
    if (!exchange) {
      showToast('Invalid exchange selected', 'error');
      return;
    }

    const requiredFields = exchange.fields;
    for (const field of requiredFields) {
      if (!exchangeForm[field as keyof typeof exchangeForm]) {
        showToast(`Please enter the required ${field} for ${exchange.name}`, 'error');
        return;
      }
    }

    setSavingExchange(true);
    try {
      await exchangeApi.connect({
        exchangeId: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secretKey: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase,
      });

      // Reload connected exchange data
      await loadConnectedExchange();

      showToast(`Successfully connected to ${exchange.name}!`, 'success');
      setSelectedExchange(null);
    } catch (err: any) {
      showToast(err.response?.data?.error || `Failed to connect to ${exchange.name}`, 'error');
    } finally {
      setSavingExchange(false);
    }
  };

  const handleDisconnectExchange = async () => {
    if (!connectedExchange) return;
    setDisconnectingExchange(true);
    try {
      await exchangeApi.disconnect(connectedExchange.id);
      setConnectedExchange(null);
      showToast(`Successfully disconnected from ${connectedExchange.name}`, 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || `Failed to disconnect from ${connectedExchange.name}`, 'error');
    } finally {
      setDisconnectingExchange(false);
      setShowDisconnectConfirm(false);
    }
  };

  // Notification Handlers
  const handleAutoTradeAlertsToggle = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const prereq = await checkAutoTradePrerequisites();
      if (!prereq.met) {
        setShowAutoTradePrereqModal(true);
        return;
      }
    }
    await saveNotificationSettings({ ...notificationSettings, autoTradeAlerts: enabled });
  }, [notificationSettings, checkAutoTradePrerequisites, saveNotificationSettings]);

  const handleAccuracyAlertsToggle = useCallback(async () => {
    setAccuracyThresholdInput(notificationSettings.accuracyAlerts?.threshold?.toString() || '80');
    setTelegramForAccuracy(notificationSettings.telegramEnabled || false);
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
  }, [accuracyThresholdInput, notificationSettings, saveNotificationSettings, telegramForAccuracy]);

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
            <ErrorState error={error} onRetry={handleRetry} message={`Failed to load settings${retryCount > 0 ? ` (attempt ${retryCount + 1})` : ''}`} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden">
        {/* Animated background elements - omitted for brevity */}

        <Sidebar onLogout={handleLogout} />
        <main className="flex-1 overflow-y-auto smooth-scroll">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

            <h1 className="text-3xl font-bold text-white mb-8">System Settings</h1>

            {/* General Settings Section (Autotrade, Max Position) */}
            <SettingsCard className="mb-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">General Trading Settings</h2>
                <p className="text-sm text-gray-400">Core parameters for the automated trading engine</p>
              </div>

              <div className="space-y-6">
                {/* Auto-Trade Toggle */}
                <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-xl border border-slate-700/50">
                  <div className="flex-1">
                    <label htmlFor="enable-autotrade" className="text-lg font-semibold text-white block">Enable Auto-Trade</label>
                    <p className="text-sm text-gray-400">Automatically execute trades based on system signals</p>
                  </div>
                  <ToggleSwitch
                    id="enable-autotrade"
                    checked={settings.enableAutoTrade || false}
                    onChange={(checked) => setSettings({ ...settings, enableAutoTrade: checked })}
                    ariaLabel="Toggle auto-trade"
                  />
                </div>

                {/* Max Position Per Trade */}
                <div className="space-y-2">
                  <label htmlFor="max-position" className="block text-sm font-medium text-gray-300">Max Position Per Trade (%)</label>
                  <SettingsInput
                    id="max-position"
                    type="number"
                    step="1"
                    min="1"
                    max="100"
                    value={settings.maxPositionPercent}
                    onChange={(e) => setSettings({ ...settings, maxPositionPercent: parseInt(e.target.value) || 1 })}
                  />
                  <p className="text-xs text-gray-400">Maximum percentage of total capital to use per trade. Default: 10%</p>
                </div>
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveGeneralSettings}
                  disabled={savingSettings}
                  className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  {savingSettings ? 'Saving...' : 'Save General Settings'}
                </button>
              </div>
            </SettingsCard>

            {/* Trading Parameters Section */}
            <SettingsCard className="mb-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Trading Engine Parameters</h2>
                <p className="text-sm text-gray-400">Advanced risk and position sizing controls for auto-trade</p>
              </div>

              {/* Trade Type and Risk */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Trade Type</label>
                  <div className="flex space-x-2">
                    {['scalping', 'swing', 'daytrading'].map((type) => (
                      <button
                        key={type}
                        onClick={() => setTradingSettings({ ...tradingSettings, tradeType: type })}
                        className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg capitalize transition-all ${
                          tradingSettings.tradeType === type
                            ? 'bg-purple-500 text-white shadow-md'
                            : 'bg-slate-700/50 text-gray-300 hover:bg-slate-600/50'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Daily Loss (%)</label>
                  <SettingsInput
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={tradingSettings.maxDailyLoss}
                    onChange={(e) => setTradingSettings({ ...tradingSettings, maxDailyLoss: parseFloat(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-gray-400">Engine pauses if daily loss exceeds this %</p>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Trades Per Day</label>
                  <SettingsInput
                    type="number"
                    min="1"
                    max="500"
                    value={tradingSettings.maxTradesPerDay}
                    onChange={(e) => setTradingSettings({ ...tradingSettings, maxTradesPerDay: parseInt(e.target.value) || 1 })}
                  />
                  <p className="text-xs text-gray-400">Maximum trades allowed per day</p>
                </div>
              </div>

              {/* Position Sizing Map */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-white mb-3">Position Sizing Map</h3>
                <p className="text-sm text-gray-400 mb-4">Configure position sizes based on model accuracy ranges</p>
                <div className="space-y-3">
                  {tradingSettings.positionSizingMap.map((range: any, index: number) => (
                    <div key={index} className="flex items-center gap-4 p-3 bg-slate-800/30 rounded-lg">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="w-16 px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-white text-center"
                          value={range.min}
                          onChange={(e) => updatePositionSizingMap(index, 'min', parseInt(e.target.value) || 0)}
                        />
                        <span className="text-xs text-gray-400">-</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="w-16 px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-white text-center"
                          value={range.max}
                          onChange={(e) => updatePositionSizingMap(index, 'max', parseInt(e.target.value) || 0)}
                        />
                        <span className="text-sm text-gray-300 flex-shrink-0">Accuracy % →</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max={tradingSettings.maxPositionPerTrade || 10}
                          className="w-16 px-2 py-1 bg-purple-700/50 border border-purple-600/50 rounded text-xs text-white text-center"
                          value={range.percent}
                          onChange={(e) => updatePositionSizingMap(index, 'percent', parseFloat(e.target.value) || 0)}
                        />
                        <span className="text-sm font-semibold text-purple-400 flex-shrink-0">Position %</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Live Position Calculation Preview */}
                <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
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
                      className="w-full h-2 bg-blue-700 rounded-lg appearance-none cursor-pointer range-lg"
                    />
                    <span className="text-lg font-bold text-white w-12 flex-shrink-0">{sampleAccuracy}%</span>
                  </div>
                  <div className="mt-2 text-center text-lg font-bold text-white">
                    Position Size: <span className="text-purple-400">{calculatePositionForAccuracy(sampleAccuracy)}%</span> of Max ({tradingSettings.maxPositionPerTrade}%)
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
                    <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                      {filteredCoins.length > 0 ? (
                        filteredCoins.slice(0, 10).map((coin) => (
                          <div
                            key={coin}
                            className="px-4 py-2 text-sm text-gray-200 hover:bg-slate-700/50 cursor-pointer flex justify-between items-center"
                            onClick={() => addCoinToManual(coin)}
                          >
                            {coin}
                            <PlusIcon className="w-4 h-4 text-green-400" />
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-2 text-sm text-gray-400">No coins found or already added.</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {tradingSettings.manualCoins.map((coin: string) => (
                    <span
                      key={coin}
                      className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-500/20 text-purple-300 cursor-pointer hover:bg-red-500/20 transition-colors"
                      onClick={() => removeCoinFromManual(coin)}
                    >
                      {coin} <XMarkIcon className="w-4 h-4 ml-1" />
                    </span>
                  ))}
                </div>
              </div>

              {/* Save Button */}
              <div className="mt-6 flex justify-end pt-4 border-t border-white/10">
                <button
                  onClick={handleSaveTradingSettings}
                  disabled={savingTradingSettings}
                  className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  {savingTradingSettings ? 'Saving...' : 'Save Trading Parameters'}
                </button>
              </div>
            </SettingsCard>

            {/* API Provider Configuration Section */}
            <SettingsCard className="mb-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">API Provider Configuration</h2>
                <p className="text-sm text-gray-400">Manage API keys for market data, news, and metadata sources</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                {/* Dynamic Provider Categories */}
                {Object.entries(PROVIDER_CONFIG).map(([categoryKey, config]) => (
                  <div key={categoryKey} className="bg-slate-800/30 rounded-2xl p-4 sm:p-6 border border-slate-700/50 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-12 h-12 ${config.bgColor} rounded-xl flex items-center justify-center shadow-sm`}>
                        <span className="text-white font-bold text-xl">{config.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-white">{config.title}</h3>
                        <p className="text-sm text-gray-400">{config.description}</p>
                      </div>
                    </div>

                    {/* Primary Provider */}
                    {config.primary && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30"> PRIMARY </span>
                          <span className="text-sm font-medium text-white">{config.primary.name}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            config.primary.name === 'CoinGecko' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}>
                            {config.primary.name === 'CoinGecko' ? 'API Not Required' : 'API Required'}
                          </span>
                        </div>

                        {config.primary.name !== 'CoinGecko' ? (
                          <div className="space-y-2">
                            <SettingsInput
                              type={showUnmaskedKeys ? 'text' : 'password'}
                              placeholder={config.primary.placeholder}
                              value={settings[config.primary.key] || ''}
                              onChange={(e) => setSettings({ ...settings, [config.primary.key]: e.target.value })}
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => testProviderConnection(config.primary.name, settings[config.primary.key], config.primary.key)}
                                disabled={testingProvider === config.primary.name}
                                className="px-3 py-1 bg-slate-600/50 text-slate-300 text-xs rounded-lg hover:bg-slate-600/70 transition-all disabled:opacity-50"
                              >
                                {testingProvider === config.primary.name ? 'Testing...' : 'Test'}
                              </button>
                              <button
                                onClick={() => handleProviderKeyChange(config.primary.name, config.primary.key, settings[config.primary.key])}
                                disabled={savingProvider === config.primary.name || !settings[config.primary.key]}
                                className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded text-xs hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                              >
                                {savingProvider === config.primary.name ? '...' : 'Save Key'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                            <span className="text-green-400 text-sm">CoinGecko is active by default.</span>
                          </div>
                        )}
                        <ProviderTestResult result={providerTestResults[config.primary.name]} />
                      </div>
                    )}

                    {/* Toggle for Backup Providers */}
                    {config.backups && config.backups.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-700/50">
                        <button
                          onClick={() => {
                            if (categoryKey === 'marketData') setShowMarketBackups(!showMarketBackups);
                            if (categoryKey === 'news') setShowNewsBackups(!showNewsBackups);
                            if (categoryKey === 'metadata') setShowMetadataBackups(!showMetadataBackups);
                          }}
                          className="w-full flex items-center justify-between text-purple-400 hover:text-purple-300 transition-all text-sm font-medium"
                        >
                          <PlusIcon className="w-4 h-4" /> Add Backup Providers
                          {((categoryKey === 'marketData' && showMarketBackups) || (categoryKey === 'news' && showNewsBackups) || (categoryKey === 'metadata' && showMetadataBackups)) ? (
                            <ChevronUpIcon className="w-4 h-4" />
                          ) : (
                            <ChevronDownIcon className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Backup Providers */}
                    {config.backups && config.backups.length > 0 && (
                      <div className={`transition-all duration-300 ease-in-out ${
                        ((categoryKey === 'marketData' && showMarketBackups) || (categoryKey === 'news' && showNewsBackups) || (categoryKey === 'metadata' && showMetadataBackups))
                          ? 'opacity-100 max-h-screen mt-4'
                          : 'opacity-0 max-h-0 overflow-hidden'
                      }`}>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-gray-300">Backup Providers</h4>
                            <span className="text-xs text-gray-400 bg-slate-700/50 px-2 py-1 rounded-full">
                              {config.backups.length} available
                            </span>
                          </div>
                          <div className="space-y-2">
                            {config.backups.map((backup) => (
                              <div key={backup.key} className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/50">
                                <div className="flex items-start justify-between">
                                  <div className="flex items-center gap-3">
                                    <ToggleSwitch
                                      id={`backup-${backup.key}`}
                                      checked={settings[backup.enabledKey] || false}
                                      onChange={(checked) => setSettings({ ...settings, [backup.enabledKey]: checked })}
                                      ariaLabel={`Enable ${backup.name} backup provider`}
                                      size="small"
                                    />
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-white">{backup.name}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                          backup.type === 'free' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        }`}>
                                          {backup.type === 'free' ? 'Free/No API' : 'API Required'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  {settings[backup.enabledKey] && backup.type !== 'free' && (
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => testProviderConnection(backup.name, settings[backup.key], backup.key)}
                                        disabled={testingProvider === backup.name}
                                        className="px-3 py-1 bg-slate-600/50 text-slate-300 text-xs rounded-lg hover:bg-slate-600/70 transition-all disabled:opacity-50"
                                      >
                                        {testingProvider === backup.name ? 'Testing...' : 'Test'}
                                      </button>
                                      <button
                                        onClick={() => handleProviderKeyChange(backup.name, backup.key, settings[backup.key])}
                                        disabled={savingProvider === backup.name || !settings[backup.key]}
                                        className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded text-xs hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                                      >
                                        {savingProvider === backup.name ? '...' : 'Save'}
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {settings[backup.enabledKey] && backup.type !== 'free' && (
                                  <div className="mt-3">
                                    <SettingsInput
                                      type={showUnmaskedKeys ? 'text' : 'password'}
                                      placeholder={backup.placeholder}
                                      value={settings[backup.key] || ''}
                                      onChange={(e) => setSettings({ ...settings, [backup.key]: e.target.value })}
                                    />
                                  </div>
                                )}
                                {settings[backup.enabledKey] && <ProviderTestResult result={providerTestResults[backup.name]} size="small" />}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-6 flex justify-end">
                <ToggleSwitch
                  id="showKeysToggle"
                  checked={showUnmaskedKeys}
                  onChange={setShowUnmaskedKeys}
                  ariaLabel="Toggle show API keys"
                />
                <span className="ml-2 text-sm text-gray-400">Show API Keys</span>
              </div>
            </SettingsCard>

            {/* Notification Settings Section */}
            <SettingsCard className="mb-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Notification Settings</h2>
                <p className="text-sm text-gray-400">Configure comprehensive notification preferences and alert triggers</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {/* Auto-Trade Trigger Alerts */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-white">Auto-Trade Trigger Alerts</h3>
                        {!notificationSettings?.autoTradeAlertsPrereqMet && notificationSettings?.autoTradeAlerts && (
                          <ExclamationTriangleIcon className="w-4 h-4 text-amber-400" />
                        )}
                      </div>
                      <p className="text-xs text-gray-400">Get notified when auto-trade executes based on high accuracy signals</p>
                      {notificationSettings?.autoTradeAlerts && !notificationSettings?.autoTradeAlertsPrereqMet && (
                        <p className="text-xs text-amber-400 mt-1">Prerequisites not met - configure providers, auto-trade, and exchange</p>
                      )}
                    </div>
                    <ToggleSwitch
                      id="autoTradeAlerts"
                      checked={notificationSettings?.autoTradeAlerts || false}
                      onChange={handleAutoTradeAlertsToggle}
                      ariaLabel="Enable auto-trade trigger alerts"
                    />
                  </div>
                </div>

                {/* Accuracy Alerts */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-white">Accuracy Threshold Alerts</h3>
                        {notificationSettings?.accuracyAlerts?.enabled && notificationSettings.accuracyAlerts.threshold < 70 && (
                          <ExclamationTriangleIcon className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                      <p className="text-xs text-gray-400">Receive alerts when the core model's accuracy exceeds a set threshold (e.g., 90%)</p>
                      {notificationSettings?.accuracyAlerts?.enabled && (
                        <p className="text-xs text-purple-400 mt-1">Alerts enabled for accuracy &gt; {notificationSettings.accuracyAlerts.threshold}%</p>
                      )}
                    </div>
                    {notificationSettings?.accuracyAlerts?.enabled ? (
                      <button
                        onClick={() => saveNotificationSettings({ ...notificationSettings, accuracyAlerts: { enabled: false, threshold: 80 } })}
                        className="px-3 py-1 bg-red-500/50 text-white text-xs rounded-lg hover:bg-red-600/50 transition-all"
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        onClick={handleAccuracyAlertsToggle}
                        className="px-3 py-1 bg-purple-500/50 text-white text-xs rounded-lg hover:bg-purple-600/50 transition-all"
                      >
                        Configure
                      </button>
                    )}
                  </div>
                </div>

                {/* Whale Alerts */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-white mb-1">Large Transaction (Whale) Alerts</h3>
                      <p className="text-xs text-gray-400">Get notified of significant whale transactions (experimental)</p>
                    </div>
                    <ToggleSwitch
                      id="whaleAlerts"
                      checked={notificationSettings?.whaleAlerts || false}
                      onChange={(checked) => saveNotificationSettings({ ...notificationSettings, whaleAlerts: checked })}
                      ariaLabel="Enable whale alerts"
                    />
                  </div>
                </div>

                {/* Trade Confirmation Required */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
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
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-white mb-1">Audio & Haptic Feedback</h3>
                      <p className="text-xs text-gray-400">Configure audio and haptic feedback for notifications</p>
                    </div>
                    <button
                      onClick={testNotification}
                      className="px-3 py-1 bg-slate-600/50 text-slate-300 text-xs rounded-lg hover:bg-slate-600/70 transition-all"
                    >
                      Test
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SpeakerWaveIcon className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-300">Enable Sound</span>
                      </div>
                      <ToggleSwitch
                        id="soundEnabled"
                        checked={notificationSettings?.soundEnabled || false}
                        onChange={(checked) => saveNotificationSettings({ ...notificationSettings, soundEnabled: checked })}
                        ariaLabel="Enable notification sounds"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <DevicePhoneMobileIcon className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-300">Enable Vibration/Haptics</span>
                      </div>
                      <ToggleSwitch
                        id="vibrationEnabled"
                        checked={notificationSettings?.vibrationEnabled || false}
                        onChange={(checked) => saveNotificationSettings({ ...notificationSettings, vibrationEnabled: checked })}
                        ariaLabel="Enable notification vibration"
                      />
                    </div>
                  </div>
                </div>

              </div>
            </SettingsCard>

            {/* Background Deep Research Alerts Section */}
            <SettingsCard className="mb-8">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Background Deep Research Alerts</h2>
                <p className="text-sm text-gray-400">Configure automatic deep research with Telegram notifications</p>
              </div>
              <BackgroundResearchWizard />
            </SettingsCard>

            {/* Add Exchange Section */}
            <SettingsCard className="mb-8">
              <div className="mb-6">
                <h2 id="exchange-settings" className="text-xl font-semibold text-white mb-2">Add Exchange</h2>
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
                      <CheckCircleIcon className="w-3 h-3 mr-1" /> Connected
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-400 mb-6">
                    <span>Last updated: {new Date(connectedExchange.lastUpdated).toLocaleString()}</span>
                  </div>
                  <button
                    onClick={() => setShowDisconnectConfirm(true)}
                    className="w-full px-4 py-2 bg-red-600/80 text-white font-medium rounded-lg hover:bg-red-700/80 transition-colors"
                  >
                    Disconnect Exchange
                  </button>
                </div>
              ) : (
                // Exchange selection form
                <div className="space-y-6">
                  <div className="grid grid-cols-3 sm:grid-cols-7 gap-4">
                    {EXCHANGES.map((exchange) => (
                      <div
                        key={exchange.id}
                        onClick={() => handleExchangeSelect(exchange.id)}
                        className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center space-y-2 cursor-pointer transition-all duration-200 hover:scale-105 ${
                          selectedExchange === exchange.id
                            ? 'border-purple-500 bg-purple-500/10 shadow-lg'
                            : 'border-slate-700/50 bg-slate-800/30 hover:border-purple-500/50'
                        }`}
                      >
                        {React.createElement(exchange.logo, { size: 40 })}
                        <span className="text-xs font-medium text-white text-center">{exchange.name}</span>
                      </div>
                    ))}
                  </div>

                  {selectedExchange && (
                    <div className="bg-slate-800/30 rounded-xl p-6 border border-purple-500/30 space-y-4">
                      <h3 className="text-lg font-semibold text-white">
                        Connect {EXCHANGES.find(e => e.id === selectedExchange)?.name}
                      </h3>
                      {EXCHANGES.find(e => e.id === selectedExchange)?.fields.map((field) => (
                        <div key={field} className="space-y-2">
                          <label className="block text-sm font-medium text-gray-300 capitalize">{field.replace('key', ' Key').replace('passphrase', 'Passphrase')}</label>
                          <SettingsInput
                            type={field.includes('Key') ? (showUnmaskedKeys ? 'text' : 'password') : 'password'}
                            placeholder={`Enter ${field.replace('key', ' Key').replace('passphrase', 'Passphrase')}`}
                            value={exchangeForm[field as keyof typeof exchangeForm]}
                            onChange={(e) => setExchangeForm({ ...exchangeForm, [field]: e.target.value })}
                          />
                        </div>
                      ))}
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
                          className="px-4 py-2 bg-slate-700 text-gray-300 font-medium rounded-lg hover:bg-slate-600 transition-colors"
                          disabled={savingExchange}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SettingsCard>

          </div>
        </main>

        {/* Modals */}
        {/* Disconnect Confirmation Modal */}
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

        {/* Auto-Trade Prerequisite Modal */}
        {showAutoTradePrereqModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-8 max-w-lg w-full text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <ExclamationTriangleIcon className="w-8 h-8 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Cannot Enable Auto-Trade Alerts</h3>
              <p className="text-gray-600 mb-6 text-left">
                To enable Auto-Trade Trigger Alerts, the following prerequisites must be met:
              </p>
              <ul className="text-left space-y-2 text-sm text-gray-700 mb-6">
                {notificationPrereqs?.missing?.map((item: string, index: number) => (
                  <li key={index} className="flex items-start">
                    <XCircleIcon className="w-5 h-5 text-red-500 mr-2 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => setShowAutoTradePrereqModal(false)}
                className="w-full px-4 py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Accuracy Alert Configuration Modal */}
        {showAccuracyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-slate-800 rounded-2xl p-8 max-w-sm w-full text-white">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-semibold">Configure Accuracy Alert</h3>
                <button onClick={() => setShowAccuracyModal(false)}>
                  <XMarkIcon className="w-6 h-6 text-gray-400 hover:text-white" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="accuracy-threshold" className="block text-sm font-medium text-gray-300">Minimum Accuracy Threshold (%)</label>
                  <SettingsInput
                    id="accuracy-threshold"
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
                  className="w-full px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 transition-colors"
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
};

export default Settings;