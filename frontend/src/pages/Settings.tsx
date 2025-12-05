import React, { useState, useEffect, useCallback, useRef } from 'react';
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
      providerName: "CoinGecko",
      id: "coingecko",
      type: "market",
      apiKeyRequired: false,
      primary: true,
      url: "https://api.coingecko.com/api/v3/"
    },
    backups: [
      {
        providerName: "BraveNewCoin",
        id: "bravenewcoin",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://bravenewcoin.p.rapidapi.com/"
      },
      {
        providerName: "CoinAPI",
        id: "coinapi",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://rest.coinapi.io/"
      },
      {
        providerName: "CoinCheckup",
        id: "coincheckup",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coincheckup.com/v1/"
      },
      {
        providerName: "CoinLore",
        id: "coinlore",
        type: "market",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coinlore.net/api/"
      },
      {
        providerName: "CoinMarketCap",
        id: "coinmarketcap",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://pro-api.coinmarketcap.com/v1/"
      },
      {
        providerName: "CoinPaprika",
        id: "coinpaprika",
        type: "market",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coinpaprika.com/v1/"
      },
      {
        providerName: "CoinStats",
        id: "coinstats",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coinstats.app/public/v1/"
      },
      {
        providerName: "Kaiko",
        id: "kaiko",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://us.market-api.kaiko.io/"
      },
      {
        providerName: "LiveCoinWatch",
        id: "livecoinwatch",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.livecoinwatch.com/"
      },
      {
        providerName: "Messari",
        id: "messari",
        type: "market",
        apiKeyRequired: true,
        primary: false,
        url: "https://data.messari.io/api/v1/"
      }
    ]
  },
  news: {
    icon: "📰",
    bgColor: "bg-green-500",
    title: "News Providers",
    description: "Sentiment analysis and market news",
    primary: {
      providerName: "NewsData.io",
      id: "newsdataio",
      type: "news",
      apiKeyRequired: true,
      primary: true,
      url: "https://newsdata.io/api/1/"
    },
    backups: [
      {
        providerName: "BingNews",
        id: "bingnews",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.bing.microsoft.com/v7.0/news/search"
      },
      {
        providerName: "ContextualWeb",
        id: "contextualweb",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://contextualweb.io/api/v1/"
      },
      {
        providerName: "CryptoPanic",
        id: "cryptopanic",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://cryptopanic.com/api/v1/"
      },
      {
        providerName: "GNews",
        id: "gnews",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://gnews.io/api/v4/"
      },
      {
        providerName: "MediaStack",
        id: "mediastack",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.mediastack.com/v1/"
      },
      {
        providerName: "NewsCatcher",
        id: "newscatcher",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.newscatcherapi.com/v3/"
      },
      {
        providerName: "NewsData.io",
        id: "newsdataio",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://newsdata.io/api/1/"
      },
      {
        providerName: "Reddit",
        id: "reddit",
        type: "news",
        apiKeyRequired: false,
        primary: false,
        url: "https://www.reddit.com/r/cryptocurrency/"
      },
      {
        providerName: "Webz.io",
        id: "webzio",
        type: "news",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.webz.io/"
      },
      {
        providerName: "YahooNews",
        id: "yahoonews",
        type: "news",
        apiKeyRequired: false,
        primary: false,
        url: "https://news.search.yahoo.com/"
      }
    ]
  },
  metadata: {
    icon: "📈",
    bgColor: "bg-purple-500",
    title: "Metadata Providers",
    description: "Market cap, supply, and asset information",
    primary: {
      providerName: "CryptoCompare",
      id: "cryptocompare",
      type: "metadata",
      apiKeyRequired: true,
      primary: true,
      url: "https://min-api.cryptocompare.com/data/"
    },
    backups: [
      {
        providerName: "CoinCap",
        id: "coincap",
        type: "metadata",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coincap.io/v2/"
      },
      {
        providerName: "CoinGecko",
        id: "coingecko",
        type: "metadata",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coingecko.com/api/v3/"
      },
      {
        providerName: "CoinMarketCap",
        id: "coinmarketcap",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://pro-api.coinmarketcap.com/v1/"
      },
      {
        providerName: "CoinPaprika",
        id: "coinpaprika",
        type: "metadata",
        apiKeyRequired: false,
        primary: false,
        url: "https://api.coinpaprika.com/v1/"
      },
      {
        providerName: "CoinRanking",
        id: "coinranking",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coinranking.com/v2/"
      },
      {
        providerName: "CoinStats",
        id: "coinstats",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.coinstats.app/public/v1/"
      },
      {
        providerName: "CryptoCompare",
        id: "cryptocompare",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://min-api.cryptocompare.com/data/"
      },
      {
        providerName: "LiveCoinWatch",
        id: "livecoinwatch",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.livecoinwatch.com/"
      },
      {
        providerName: "Messari",
        id: "messari",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://data.messari.io/api/v1/"
      },
      {
        providerName: "Nomics",
        id: "nomics",
        type: "metadata",
        apiKeyRequired: true,
        primary: false,
        url: "https://api.nomics.com/v1/"
      }
    ]
  }
};

// API name mapping for provider handling
const API_NAME_MAP: Record<string, string> = {
  // Market Data Providers
  'CoinGecko': 'coingecko',
  'BraveNewCoin': 'bravenewcoin',
  'CoinAPI': 'coinapi',
  'CoinCheckup': 'coincheckup',
  'CoinLore': 'coinlore',
  'CoinMarketCap': 'coinmarketcap',
  'CoinPaprika': 'coinpaprika',
  'CoinStats': 'coinstats',
  'Kaiko': 'kaiko',
  'LiveCoinWatch': 'livecoinwatch',
  'Messari': 'messari',
  // News Providers
  'NewsData.io': 'newsdataio',
  'BingNews': 'bingnews',
  'ContextualWeb': 'contextualweb',
  'CryptoPanic': 'cryptopanic',
  'GNews': 'gnews',
  'MediaStack': 'mediastack',
  'NewsCatcher': 'newscatcher',
  'Reddit': 'reddit',
  'Webz.io': 'webzio',
  'YahooNews': 'yahoonews',
  // Metadata Providers
  'CryptoCompare': 'cryptocompare',
  'CoinCap': 'coincap',
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
      const response = await settingsApi.backgroundResearch.test({ botToken: telegramBotToken, chatId: telegramChatId });
      showToast(response.data.message || 'DLXTRADE Alert Test Successful: Telegram integration working.', 'success');
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
      setCurrentStep(0); // Reset to API validation step
    } catch (error: any) {
      console.error('Error saving background research settings:', error);
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

  const canProceedToStep1 = bgResearchEnabled;
  const canProceedToStep2 = telegramBotToken.trim() && telegramChatId.trim();
  const canProceedToStep3 = true; // Always allow proceeding to frequency selection
  const canProceedToStep4 = true; // Always allow proceeding to accuracy trigger
  const canProceedToStep5 = true; // Always allow proceeding to confirmation

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
                        ⏰ {researchFrequency === 60 ? '1 hour' : `${researchFrequency} minute${researchFrequency > 1 ? 's' : ''}`}
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
  const [savingTrading, setSavingTrading] = useState(false);
  const [tradingSaved, setTradingSaved] = useState(false);
  const [loadingAll, setLoadingAll] = useState(true);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [submittedProviders, setSubmittedProviders] = useState<Set<string>>(new Set());
  const [providerData, setProviderData] = useState<any>({
    marketData: { primary: null, backups: [] },
    news: { primary: null, backups: [] },
    metadata: { primary: null, backups: [] }
  });
  const [loadingProviders, setLoadingProviders] = useState(false);

  // Trading Settings State
  const [tradingSettings, setTradingSettings] = useState({
    mode: 'MANUAL' as 'MANUAL' | 'TOP_100' | 'TOP_10',
    manualCoins: ['BTCUSDT', 'ETHUSDT'] as string[],
    maxPositionPerTrade: 10,
    tradeType: 'Scalping' as 'Scalping' | 'Swing' | 'Position',
    accuracyTrigger: 85,
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    positionSizingMap: [
      { min: 0, max: 84, percent: 0 },
      { min: 85, max: 89, percent: 3 },
      { min: 90, max: 94, percent: 6 },
      { min: 95, max: 99, percent: 8.5 },
      { min: 100, max: 100, percent: 10 }
    ]
  });
  const [sampleAccuracy, setSampleAccuracy] = useState(85);

  // Research Coin Selection States
  const [coinSearch, setCoinSearch] = useState('');
  const [top100Coins, setTop100Coins] = useState<string[]>([]);
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);

  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { status: 'success' | 'error' | null; message: string }>>({});
  const [settings, setSettings] = useState<any>({
    maxPositionPercent: 10,
    tradeType: 'scalping',
    accuracyThreshold: 85,
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    // Market Data Providers
    cryptoCompareKey: '',
    coinGeckoBackupKey: '',
    coinGeckoBackupEnabled: false,
    kucoinBackupKey: '',
    kucoinBackupEnabled: false,
    bybitBackupKey: '',
    bybitBackupEnabled: false,
    okxBackupKey: '',
    okxBackupEnabled: false,
    bitgetBackupKey: '',
    bitgetBackupEnabled: false,
    // News Providers
    newsDataKey: '',
    cryptoPanicKey: '',
    cryptoPanicEnabled: false,
    redditKey: '',
    redditEnabled: false,
    gnewsKey: '',
    gnewsEnabled: false,
    // Metadata Providers
    coinGeckoKey: '',
    coinGeckoEnabled: false,
    coinpaprikaKey: '',
    coinpaprikaEnabled: false,
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
      const [settingsResult, integrationsResult, exchangeResult, tradingSettingsResult, topCoinsResult, providerResult] = await Promise.allSettled([
        loadSettings(),
        loadIntegrations(),
        loadConnectedExchange(),
        loadTradingSettings(),
        loadTop100Coins(),
        loadProviderData()
      ]);

      // Log any failures but don't fail the whole load
      if (settingsResult.status === 'rejected') {
        suppressConsoleError(settingsResult.reason, 'loadSettings');
      }
      if (integrationsResult.status === 'rejected') {
        suppressConsoleError(integrationsResult.reason, 'loadIntegrations');
      }
      if (exchangeResult.status === 'rejected') {
        suppressConsoleError(exchangeResult.reason, 'loadConnectedExchange');
      }
      if (topCoinsResult.status === 'rejected') {
        suppressConsoleError(topCoinsResult.reason, 'loadTop100Coins');
        // loadTop100Coins already handles its own fallback, so no additional action needed
      }
      if (providerResult.status === 'rejected') {
        suppressConsoleError(providerResult.reason, 'loadProviderData');
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

  // Emergency timeout: force loadingAll=false after 3 seconds
  useEffect(() => {
    if (loadingAll) {
      const timeout = setTimeout(() => {
        console.log('[Settings] EMERGENCY: Forcing loadingAll=false after 3 seconds');
        if (isMountedRef.current) {
          setLoadingAll(false);
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [loadingAll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);



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

  const loadProviderData = async () => {
    if (!user) return;
    setLoadingProviders(true);
    try {
      const response = await settingsApi.providers.load();
      if (response.data?.providers) {
        // Ensure safe structure even if API returns incomplete data
        const safeProviders = {
          marketData: response.data.providers.marketData || { primary: null, backups: [] },
          news: response.data.providers.news || { primary: null, backups: [] },
          metadata: response.data.providers.metadata || { primary: null, backups: [] }
        };
        setProviderData(safeProviders);
      } else {
        // Set safe defaults if no provider data
        setProviderData({
          marketData: { primary: null, backups: [] },
          news: { primary: null, backups: [] },
          metadata: { primary: null, backups: [] }
        });
      }
    } catch (err: any) {
      console.error('Error loading provider data:', err);
      showToast('Failed to load provider settings', 'error');
      // Set safe defaults on error
      setProviderData({
        marketData: { primary: null, backups: [] },
        news: { primary: null, backups: [] },
        metadata: { primary: null, backups: [] }
      });
    } finally {
      setLoadingProviders(false);
    }
  };

  const loadSettings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const response = await settingsApi.load();
      // Settings loaded successfully
      if (response.data) {
        // Use safe defaults for providerConfig
        const safeConfig = {
          marketData: response.data.providerConfig?.marketData ?? [],
          news: response.data.providerConfig?.news ?? [],
          metadata: response.data.providerConfig?.metadata ?? []
        };

        setSettings({
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
          messariEnabled: response.data.messariKey || false,
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
          // Notification settings
          enableAutoTradeAlerts: response.data.enableAutoTradeAlerts || false,
          enableAccuracyAlerts: response.data.enableAccuracyAlerts || false,
          enableWhaleAlerts: response.data.enableWhaleAlerts || false,
          tradeConfirmationRequired: response.data.tradeConfirmationRequired || false,
          notificationSounds: response.data.notificationSounds || false,
          notificationVibration: response.data.notificationVibration || false,
        });
      } else {
        // Initialize with defaults if no settings exist
        setSettings({
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
          // Notification settings
          enableAutoTradeAlerts: false,
          enableAccuracyAlerts: false,
          enableWhaleAlerts: false,
          tradeConfirmationRequired: false,
          notificationSounds: false,
          notificationVibration: false,
        });
      }
    } catch (err: any) {
      console.error('Error loading settings:', err);
      showToast(err.response?.data?.error || 'Error loading settings', 'error');
      // Set defaults on error
      setSettings({
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


  const handleSaveProvider = async (providerId: string, providerType: 'marketData' | 'news' | 'metadata', isPrimary: boolean, enabled: boolean, apiKey?: string) => {
    setSavingProvider(`${providerType}-${providerId}`);

    try {
      await settingsApi.providers.save({
        providerId,
        providerType,
        isPrimary,
        enabled,
        apiKey
      });

      // Reload provider data
      await loadProviderData();

      showToast(`${providerId} ${enabled ? 'enabled' : 'disabled'} successfully`, 'success');
    } catch (err: any) {
      console.error(`Error saving ${providerId}:`, err);
      showToast(err.response?.data?.error || `Error saving ${providerId}`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleChangeProviderKey = async (providerId: string, providerType: 'marketData' | 'news' | 'metadata', isPrimary: boolean, newApiKey: string) => {
    setSavingProvider(`${providerType}-${providerId}`);

    try {
      await settingsApi.providers.changeKey({
        providerId,
        providerType,
        isPrimary,
        newApiKey
      });

      // Reload provider data
      await loadProviderData();

      showToast(`API key for ${providerId} updated successfully`, 'success');
    } catch (err: any) {
      console.error(`Error changing key for ${providerId}:`, err);
      showToast(err.response?.data?.error || `Error changing API key for ${providerId}`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  // Legacy function for backward compatibility (used by old UI)
  const handleSaveProviderLegacy = async (providerName: string, requiredFields: string[] = []) => {
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

      const apiName = API_NAME_MAP[providerName];
      if (!apiName) {
        throw new Error(`Unknown provider: ${providerName}`);
      }

      // Get the API key from settings (handle field name mapping)
      const fieldNameMap: any = {
        'cryptocompare': 'cryptoCompareKey',
        'coingecko': 'coinGeckoBackupKey',
        'kucoin': 'kucoinBackupKey',
        'bybit': 'bybitBackupKey',
        'okx': 'okxBackupKey',
        'bitget': 'bitgetBackupKey',
        'newsdata': 'newsDataKey',
        'cryptopanic': 'cryptoPanicKey',
        'reddit': 'redditKey',
        'gnews': 'gnewsKey'
      };

      // Get enabled state for backup providers
      const enabledFieldMap: any = {
        'coingecko': 'coinGeckoBackupEnabled',
        'kucoin': 'kucoinBackupEnabled',
        'bybit': 'bybitBackupEnabled',
        'okx': 'okxBackupEnabled',
        'bitget': 'bitgetBackupEnabled',
        'cryptopanic': 'cryptoPanicEnabled',
        'reddit': 'redditEnabled',
        'gnews': 'gnewsEnabled',
        'coinpaprika': 'coinpaprikaEnabled'
      };

      const apiKeyField = fieldNameMap[apiName] || `${apiName}Key`;
      const apiKey = settings[apiKeyField]?.trim();

      // For backup providers, check if enabled; for primary providers, always enabled
      const isPrimary = ['cryptocompare', 'newsdata'].includes(apiName);
      const enabledField = enabledFieldMap[apiName];
      const enabled = isPrimary ? true : (enabledField ? settings[enabledField] : !!apiKey);

      // Add required logging

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

        // Mark provider as submitted
        setSubmittedProviders(prev => new Set(prev).add(apiName));

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

  const handleTestProvider = async (providerName: string) => {
    setTestingProvider(providerName);
    setProviderTestResults(prev => ({ ...prev, [providerName]: { status: null, message: 'Testing...' } }));

    try {
      // Determine provider type from providerName
      let providerType: 'marketData' | 'news' | 'metadata' = 'marketData';

      // Market data providers
      const marketDataProviders = [
        'CoinGecko', 'BraveNewCoin', 'CoinAPI', 'CoinCheckup', 'CoinLore',
        'CoinMarketCap', 'CoinPaprika', 'CoinStats', 'Kaiko', 'LiveCoinWatch', 'Messari'
      ];

      // News providers
      const newsProviders = [
        'NewsData.io', 'BingNews', 'ContextualWeb', 'CryptoPanic', 'GNews',
        'MediaStack', 'NewsCatcher', 'Reddit', 'Webz.io', 'YahooNews'
      ];

      // Metadata providers
      const metadataProviders = [
        'CryptoCompare', 'CoinCap', 'CoinRanking', 'Nomics'
      ];

      if (marketDataProviders.includes(providerName)) {
        providerType = 'marketData';
      } else if (newsProviders.includes(providerName)) {
        providerType = 'news';
      } else if (metadataProviders.includes(providerName)) {
        providerType = 'metadata';
      }

      // Call the test API
      const response = await settingsApi.providers.test({
        providerName,
        type: providerType
      });

      if (response.success) {
        setProviderTestResults(prev => ({
          ...prev,
          [providerName]: {
            status: 'success',
            message: response.message || `Connection OK in ${response.latencyMs}ms`
          }
        }));
        showToast(`✅ ${providerName} connected successfully in ${response.latencyMs}ms`, 'success');
      } else {
        setProviderTestResults(prev => ({
          ...prev,
          [providerName]: {
            status: 'error',
            message: response.message || 'Connection failed'
          }
        }));
        showToast(`❌ ${providerName} connection failed: ${response.message}`, 'error');
      }
    } catch (error: any) {
      setProviderTestResults(prev => ({
        ...prev,
        [providerName]: { status: 'error', message: error.message || 'Connection failed' }
      }));
      showToast(`❌ ${providerName} test failed: ${error.message}`, 'error');
    } finally {
      setTestingProvider(null);
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
    }
  };


  const loadTradingSettings = async () => {
    try {
      const response = await settingsApi.trading.load();

      // DEFENSIVE: Check if backend returned success: false (database error)
      if (response.data && response.data.success === false) {
        console.warn('Trading settings load failed:', response.data.message);
        // Show non-blocking warning toast but keep UI functional with defaults
        setToast({
          message: 'Trading settings temporarily unavailable - using defaults',
          type: 'error'
        });
        setTimeout(() => setToast(null), 5000);
        return;
      }

      // DEFENSIVE: Fallback to defaults for any undefined/null values
      if (response.data) {
        const safeSettings = {
          mode: response.data.mode || 'MANUAL',
          manualCoins: response.data.manualCoins || ['BTCUSDT', 'ETHUSDT'],
          maxPositionPerTrade: response.data.maxPositionPerTrade || 10,
          tradeType: response.data.tradeType || 'Scalping',
          accuracyTrigger: response.data.accuracyTrigger || 85,
          maxDailyLoss: response.data.maxDailyLoss || 5,
          maxTradesPerDay: response.data.maxTradesPerDay || 50,
          positionSizingMap: response.data.positionSizingMap || [
            { min: 0, max: 84, percent: 0 },
            { min: 85, max: 89, percent: 3 },
            { min: 90, max: 94, percent: 6 },
            { min: 95, max: 99, percent: 8.5 },
            { min: 100, max: 100, percent: 10 }
          ]
        };
        setTradingSettings(safeSettings);
      }
    } catch (err) {
      console.error('Error loading trading settings:', err);
      // DEFENSIVE: On API failure, show warning but keep UI functional with defaults
      setToast({
        message: 'Unable to load trading settings - check connection',
        type: 'error'
      });
      setTimeout(() => setToast(null), 5000);
      // Settings will use defaults defined in state
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
          'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT',
          'DOTUSDT', 'LINKUSDT', 'UNIUSDT', 'AVAXUSDT', 'LTCUSDT',
          'ALGOUSDT', 'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT',
          'ETCUSDT', 'XLMUSDT', 'THETAUSDT', 'FTTUSDT', 'HBARUSDT'
        ]);
      }
    } catch (err) {
      console.error('Error loading top 100 coins:', err);
      // Fallback to common coins
      setTop100Coins([
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'SOLUSDT'
      ]);
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
    setTradingSaved(false);
    try {
      await settingsApi.trading.update(tradingSettings);
      showToast('Trading settings saved successfully', 'success');
      setTradingSaved(true);
      setTimeout(() => setTradingSaved(false), 3000);
    } catch (err: any) {
      console.error('Error saving trading settings:', err);
      showToast(err.response?.data?.error || 'Error saving trading settings', 'error');
    } finally {
      setSavingTrading(false);
    }
  };

  const handleResetTradingSettings = () => {
    setTradingSettings({
      mode: 'MANUAL',
      manualCoins: ['BTCUSDT', 'ETHUSDT'],
      maxPositionPerTrade: 10,
      tradeType: 'Scalping',
      accuracyTrigger: 85,
      maxDailyLoss: 5,
      maxTradesPerDay: 50,
      positionSizingMap: [
        { min: 0, max: 84, percent: 0 },
        { min: 85, max: 89, percent: 3 },
        { min: 90, max: 94, percent: 6 },
        { min: 95, max: 99, percent: 8.5 },
        { min: 100, max: 100, percent: 10 }
      ]
    });
  };

  const calculatePositionForAccuracy = (accuracy: number): number => {
    // DEFENSIVE: Validate inputs to prevent NaN/undefined
    if (!accuracy || isNaN(accuracy) || accuracy < 0 || accuracy > 100) {
      return 0;
    }

    // DEFENSIVE: Check if positionSizingMap exists and is valid
    if (!tradingSettings.positionSizingMap || !Array.isArray(tradingSettings.positionSizingMap)) {
      return 0;
    }

    const range = tradingSettings.positionSizingMap.find(r =>
      r && typeof r.min === 'number' && typeof r.max === 'number' && typeof r.percent === 'number' &&
      accuracy >= r.min && accuracy <= r.max
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
      setTradingSettings({
        ...tradingSettings,
        manualCoins: [...tradingSettings.manualCoins, coin]
      });
    }
    setCoinSearch('');
    setShowCoinDropdown(false);
  };

  const removeCoinFromManual = (coin: string) => {
    setTradingSettings({
      ...tradingSettings,
      manualCoins: tradingSettings.manualCoins.filter(c => c !== coin)
    });
  };

  const filteredCoins = top100Coins.filter(coin =>
    coin.toLowerCase().includes(coinSearch.toLowerCase()) &&
    !tradingSettings.manualCoins.includes(coin)
  );


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

      // Save notification preferences to localStorage for immediate access
      localStorage.setItem('notificationSounds', settings.notificationSounds ? 'true' : 'false');
      localStorage.setItem('notificationVibration', settings.notificationVibration ? 'true' : 'false');
      localStorage.setItem('enableAutoTradeAlerts', settings.enableAutoTradeAlerts ? 'true' : 'false');
      localStorage.setItem('enableAccuracyAlerts', settings.enableAccuracyAlerts ? 'true' : 'false');
      localStorage.setItem('enableWhaleAlerts', settings.enableWhaleAlerts ? 'true' : 'false');
      localStorage.setItem('tradeConfirmationRequired', settings.tradeConfirmationRequired ? 'true' : 'false');

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
    // Limit retries to 1 attempt
    if (retryCount >= 1) {
      console.warn('Maximum retry attempts reached');
      return;
    }
    setRetryCount(prev => prev + 1);
    await loadAllData();
  }, [loadAllData, retryCount]);

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
      <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements - Performance optimized */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none gpu-accelerated">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-pink-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <Sidebar onLogout={handleLogout} />

      <main className="flex-1 overflow-y-auto pt-16 lg:pt-0 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
        <div className="min-h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          {/* Header */}
          <div className="mb-12">
            <div className="text-center lg:text-left">
              <h1 className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-white via-purple-200 to-cyan-200 bg-clip-text text-transparent mb-4">
                Settings
              </h1>
              <p className="text-lg text-slate-400 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
                Configure your trading parameters, risk controls, and API integrations for optimal performance
              </p>
            </div>
          </div>

          <div className="space-y-8 lg:space-y-12">
            {/* Trading Settings Section */}
            <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl rounded-3xl border border-slate-700/50 p-6 lg:p-8 shadow-2xl shadow-slate-900/20">
              <div className="mb-6 lg:mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white">Trading Configuration</h2>
                </div>
                <p className="text-slate-400 leading-relaxed">Configure your core trading parameters, risk controls, and position sizing strategy</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                {/* Research Coin Selection System */}
                <div className="space-y-4 md:col-span-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Research Coin Selection System</label>
                    <p className="text-xs text-gray-400 mb-4">Choose how Deep Research selects coins for analysis and auto-trading</p>
                  </div>

                  {/* Mode Selection */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                    <label className={`relative flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-102 ${
                      tradingSettings.mode === 'MANUAL'
                        ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white'
                        : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-slate-500/70 hover:bg-slate-700/50'
                    }`}>
                      <input
                        type="radio"
                        name="researchMode"
                        value="MANUAL"
                        checked={tradingSettings.mode === 'MANUAL'}
                        onChange={(e) => setTradingSettings({ ...tradingSettings, mode: e.target.value as 'MANUAL' | 'TOP_100' | 'TOP_10' })}
                        className="sr-only"
                      />
                      <div className="flex-1 text-center">
                        <div className="text-lg font-bold mb-1">📋 Manual</div>
                        <div className="text-xs text-gray-400">Select any coins</div>
                      </div>
                      {tradingSettings.mode === 'MANUAL' && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm">✓</span>
                        </div>
                      )}
                    </label>

                    <label className={`relative flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-102 ${
                      tradingSettings.mode === 'TOP_100'
                        ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white'
                        : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-slate-500/70 hover:bg-slate-700/50'
                    }`}>
                      <input
                        type="radio"
                        name="researchMode"
                        value="TOP_100"
                        checked={tradingSettings.mode === 'TOP_100'}
                        onChange={(e) => setTradingSettings({ ...tradingSettings, mode: e.target.value as 'MANUAL' | 'TOP_100' | 'TOP_10' })}
                        className="sr-only"
                      />
                      <div className="flex-1 text-center">
                        <div className="text-lg font-bold mb-1">🔝 Top 100</div>
                        <div className="text-xs text-gray-400">Auto-select best</div>
                      </div>
                      {tradingSettings.mode === 'TOP_100' && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm">✓</span>
                        </div>
                      )}
                    </label>

                    <label className={`relative flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:scale-102 ${
                      tradingSettings.mode === 'TOP_10'
                        ? 'border-purple-500 bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-white'
                        : 'border-slate-600/50 bg-slate-800/30 text-gray-300 hover:border-slate-500/70 hover:bg-slate-700/50'
                    }`}>
                      <input
                        type="radio"
                        name="researchMode"
                        value="TOP_10"
                        checked={tradingSettings.mode === 'TOP_10'}
                        onChange={(e) => setTradingSettings({ ...tradingSettings, mode: e.target.value as 'MANUAL' | 'TOP_100' | 'TOP_10' })}
                        className="sr-only"
                      />
                      <div className="flex-1 text-center">
                        <div className="text-lg font-bold mb-1">⭐ Top 10</div>
                        <div className="text-xs text-gray-400">Elite selection</div>
                      </div>
                      {tradingSettings.mode === 'TOP_10' && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm">✓</span>
                        </div>
                      )}
                    </label>
                  </div>

                  {/* Manual Coin Selection */}
                  {tradingSettings.mode === 'MANUAL' && (
                    <div className="mt-6 p-4 bg-slate-800/30 rounded-xl border border-white/10">
                      <h4 className="text-sm font-medium text-white mb-3">Select Coins for Research</h4>

                      {/* Selected Coins */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        {tradingSettings.manualCoins.map((coin) => (
                          <div key={coin} className="flex items-center gap-1 px-3 py-1 bg-purple-500/20 text-purple-300 rounded-full text-xs">
                            <span>{coin}</span>
                            <button
                              onClick={() => removeCoinFromManual(coin)}
                              className="ml-1 hover:text-red-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Coin Search and Add */}
                      <div className="relative">
                        <input
                          type="text"
                          className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
                          value={coinSearch}
                          onChange={(e) => {
                            setCoinSearch(e.target.value);
                            setShowCoinDropdown(true);
                          }}
                          onFocus={() => setShowCoinDropdown(true)}
                          placeholder="Search and add coins..."
                        />

                        {showCoinDropdown && coinSearch && (
                          <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {filteredCoins.slice(0, 10).map((coin) => (
                              <div
                                key={coin}
                                className="px-3 py-2 hover:bg-slate-700 cursor-pointer text-white text-sm"
                                onClick={() => addCoinToManual(coin)}
                              >
                                {coin}
                              </div>
                            ))}
                            {filteredCoins.length === 0 && (
                              <div className="px-3 py-2 text-gray-400 text-sm">No coins found</div>
                            )}
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-gray-400 mt-2">
                        Selected coins will be analyzed by Deep Research and used for auto-trading
                      </p>
                    </div>
                  )}

                  {/* Mode Descriptions */}
                  <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <div className="text-sm text-blue-200">
                      <strong>💡 How it works:</strong>
                      {tradingSettings.mode === 'MANUAL' && (
                        <span> Deep Research analyzes only your selected coins and auto-trades the highest accuracy signal.</span>
                      )}
                      {tradingSettings.mode === 'TOP_100' && (
                        <span> Deep Research fetches top 100 coins, analyzes them all, and auto-trades only the coin with highest accuracy.</span>
                      )}
                      {tradingSettings.mode === 'TOP_10' && (
                        <span> Deep Research analyzes top 10 coins and auto-trades the coin with highest accuracy.</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Position Per Trade (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="100"
                    className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                    value={tradingSettings.maxPositionPerTrade}
                    onChange={(e) => setTradingSettings({ ...tradingSettings, maxPositionPerTrade: parseFloat(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-gray-400">% of portfolio allocated per trade</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Trade Type</label>
                  <select
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    value={tradingSettings.tradeType}
                    onChange={(e) => setTradingSettings({ ...tradingSettings, tradeType: e.target.value as 'Scalping' | 'Swing' | 'Position' })}
                  >
                    <option value="Scalping">Scalping</option>
                    <option value="Swing">Swing</option>
                    <option value="Position">Position</option>
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
                    className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                    value={tradingSettings.accuracyTrigger}
                    onChange={(e) => setTradingSettings({ ...tradingSettings, accuracyTrigger: parseInt(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-gray-400">Engine will only execute trades when model accuracy ≥ this threshold</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Daily Loss (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                    value={tradingSettings.maxDailyLoss}
                    onChange={(e) => setTradingSettings({ ...tradingSettings, maxDailyLoss: parseFloat(e.target.value) || 0 })}
                  />
                  <p className="text-xs text-gray-400">Engine pauses if daily loss exceeds this %</p>
                </div>

                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300">Max Trades Per Day</label>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
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
                  {tradingSettings.positionSizingMap.map((range, index) => (
                    <div key={index} className="flex items-center gap-4 p-3 bg-slate-800/30 rounded-lg">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="w-16 px-3 py-2 bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-lg text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                          value={range.min}
                          onChange={(e) => updatePositionSizingMap(index, 'min', parseInt(e.target.value) || 0)}
                        />
                        <span className="text-xs text-gray-400">-</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          className="w-16 px-3 py-2 bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-lg text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                          value={range.max}
                          onChange={(e) => updatePositionSizingMap(index, 'max', parseInt(e.target.value) || 0)}
                        />
                        <span className="text-xs text-gray-400">%</span>
                      </div>
                      <span className="text-xs text-gray-400">accuracy →</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="100"
                        className="w-20 px-3 py-2 bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-lg text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                        value={range.percent}
                        onChange={(e) => updatePositionSizingMap(index, 'percent', parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-xs text-gray-400">% position</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sample Calculator */}
              <div className="mb-8 p-6 bg-gradient-to-r from-purple-900/20 to-cyan-900/20 backdrop-blur-sm rounded-2xl border border-purple-500/20">
                <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Position Size Calculator
                </h4>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-slate-400 font-medium">If accuracy =</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className="w-20 px-3 py-2 bg-slate-800/60 backdrop-blur-sm border border-slate-700/60 rounded-lg text-sm text-white text-center focus:outline-none focus:ring-1 focus:ring-purple-500/50"
                      value={sampleAccuracy}
                      onChange={(e) => setSampleAccuracy(parseInt(e.target.value) || 0)}
                    />
                    <span className="text-sm text-slate-400">%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-400">→ position size =</span>
                    <span className="text-lg font-bold text-transparent bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text">
                      {calculatePositionForAccuracy(sampleAccuracy)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-end pt-6 border-t border-slate-700/50">
                <button
                  onClick={handleResetTradingSettings}
                  className="px-6 py-3 bg-slate-700/60 backdrop-blur-sm text-slate-300 font-medium rounded-xl hover:bg-slate-600/60 focus:outline-none focus:ring-2 focus:ring-slate-500/50 transition-all duration-200 border border-slate-600/50"
                >
                  Reset to Defaults
                </button>
                <button
                  onClick={handleSaveTradingSettings}
                  disabled={savingTrading}
                  className="px-8 py-3 bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
                >
                  {savingTrading ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      Saving...
                    </span>
                  ) : tradingSaved ? (
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Saved
                    </span>
                  ) : (
                    'Save Trading Settings'
                  )}
                </button>
              </div>
            </div>

            {/* API Provider Categories */}
            <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl rounded-3xl border border-slate-700/50 p-6 lg:p-8 shadow-2xl shadow-slate-900/20">
              <div className="mb-6 lg:mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white">API Provider Configuration</h2>
                </div>
                <p className="text-slate-400 leading-relaxed">Configure primary and backup data providers for comprehensive market analysis</p>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:gap-8">
                {/* Market Data Providers */}
                <div className="bg-gradient-to-r from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-700/30 shadow-lg overflow-hidden">
                  <div className="p-6 lg:p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-blue-500 rounded-xl flex items-center justify-center shadow-sm">
                        <span className="text-white font-bold text-xl">📊</span>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">Market Data Providers</h3>
                        <p className="text-sm text-gray-400">Real-time price, volume, and OHLC data</p>
                      </div>
                    </div>

                    {/* Primary Provider */}
                    {providerData?.marketData?.primary && (
                      <div className="space-y-4 mb-6">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            PRIMARY
                          </span>
                          <span className="text-sm font-medium text-white">{providerData?.marketData?.primary?.providerName}</span>
                        </div>

                        {providerData?.marketData?.primary?.apiKeyRequired ? (
                          providerData?.marketData?.primary?.apiKeyPresent ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                <CheckCircleIcon className="w-4 h-4 text-green-400" />
                                <span className="text-green-400 text-sm font-medium">API key configured</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleTestProvider(providerData?.marketData?.primary?.providerName)}
                                  disabled={testingProvider === providerData?.marketData?.primary?.providerName}
                                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 disabled:opacity-50 text-sm font-medium backdrop-blur-sm"
                                >
                                  {testingProvider === providerData.marketData.primary.providerName ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                      Testing...
                                    </span>
                                  ) : (
                                    'Test Connection'
                                  )}
                                </button>
                                <button
                                  onClick={() => {
                                    const newKey = prompt(`Enter new API key for ${providerData.marketData.primary.providerName}:`);
                                    if (newKey?.trim()) {
                                      handleChangeProviderKey(providerData.marketData.primary.id, 'marketData', true, newKey.trim());
                                    }
                                  }}
                                  className="px-3 py-2 bg-slate-600/50 text-slate-300 border border-slate-600/50 rounded-lg hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all text-sm font-medium"
                                >
                                  Change Key
                                </button>
                              </div>
                              {providerTestResults[providerData.marketData.primary.providerName] && (
                                <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                                  providerTestResults[providerData.marketData.primary.providerName].status === 'success'
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                    : providerTestResults[providerData.marketData.primary.providerName].status === 'error'
                                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                    : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                                }`}>
                                  {providerTestResults[providerData.marketData.primary.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                  {providerTestResults[providerData.marketData.primary.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                  <span>{providerTestResults[providerData.marketData.primary.providerName].message}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <input
                                  type="password"
                                  id={`primary-marketData-${providerData.marketData.primary.id}`}
                                  className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                  placeholder={`Enter ${providerData.marketData.primary.providerName} API key`}
                                  aria-label={`${providerData.marketData.primary.providerName} API key`}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const input = e.target as HTMLInputElement;
                                      if (input.value.trim()) {
                                        handleSaveProvider(providerData.marketData.primary.id, 'marketData', true, providerData.marketData.primary.enabled ?? true, input.value.trim());
                                        input.value = '';
                                      }
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const input = document.getElementById(`primary-marketData-${providerData.marketData.primary.id}`) as HTMLInputElement;
                                    if (input?.value.trim()) {
                                      handleSaveProvider(providerData.marketData.primary.id, 'marketData', true, providerData.marketData.primary.enabled ?? true, input.value.trim());
                                      input.value = '';
                                    }
                                  }}
                                  disabled={savingProvider === `marketData-${providerData.marketData.primary.id}`}
                                  className="px-4 py-2.5 bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-lg hover:shadow-xl"
                                >
                                  {savingProvider === `marketData-${providerData.marketData.primary.id}` ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                              <CheckCircleIcon className="w-4 h-4 text-green-400" />
                              <span className="text-green-400 text-sm font-medium">No API key required</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleTestProvider(providerData.marketData.primary.providerName)}
                                disabled={testingProvider === providerData.marketData.primary.providerName}
                                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 disabled:opacity-50 text-sm font-medium backdrop-blur-sm"
                              >
                                {testingProvider === providerData.marketData.primary.providerName ? (
                                  <span className="flex items-center justify-center gap-2">
                                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                    Testing...
                                  </span>
                                ) : (
                                  'Test Connection'
                                )}
                              </button>
                            </div>
                            {providerTestResults[providerData.marketData.primary.providerName] && (
                              <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                                providerTestResults[providerData.marketData.primary.providerName].status === 'success'
                                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                  : providerTestResults[providerData.marketData.primary.providerName].status === 'error'
                                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                              }`}>
                                {providerTestResults[providerData.marketData.primary.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                {providerTestResults[providerData.marketData.primary.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                <span>{providerTestResults[providerData.marketData.primary.providerName].message}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Backup Providers */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-300">Backup Providers</h4>
                        <span className="text-xs text-gray-400 bg-slate-700/50 px-2 py-1 rounded-full">
                          {providerData.marketData.backups.length} available
                        </span>
                      </div>

                      <div className="space-y-3">
                        {providerData.marketData.backups.map((backup: any) => (
                          <div key={backup.id} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    id={`backup-marketData-${backup.id}`}
                                    className="sr-only peer"
                                    checked={backup.enabled || false}
                                    onChange={(e) => handleSaveProvider(backup.id, 'marketData', false, e.target.checked)}
                                    aria-label={`Enable ${backup.providerName} backup provider`}
                                  />
                                  <div className="w-10 h-5 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                                </label>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-white">{backup.providerName}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                      !backup.apiKeyRequired
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    }`}>
                                      {!backup.apiKeyRequired ? 'FREE' : 'API KEY'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {backup.enabled && (
                                <div className="flex items-center gap-2 mt-3">
                                  {!backup.apiKeyRequired ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-green-400">Ready</span>
                                      <button
                                        onClick={() => handleTestProvider(backup.providerName)}
                                        disabled={testingProvider === backup.providerName}
                                        className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                      >
                                        {testingProvider === backup.providerName ? '...' : 'Test'}
                                      </button>
                                    </div>
                                  ) : backup.apiKeyPresent ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-green-400 text-xs">✓ Configured</span>
                                      <button
                                        onClick={() => handleTestProvider(backup.providerName)}
                                        disabled={testingProvider === backup.providerName}
                                        className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                      >
                                        {testingProvider === backup.providerName ? '...' : 'Test'}
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newKey = prompt(`Enter new API key for ${backup.providerName}:`);
                                          if (newKey?.trim()) {
                                            handleChangeProviderKey(backup.id, 'marketData', false, newKey.trim());
                                          }
                                        }}
                                        className="px-2 py-1 bg-slate-600/50 text-slate-300 border border-slate-600/50 rounded text-xs hover:bg-slate-600/70 transition-all"
                                      >
                                        Change Key
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2">
                                      <input
                                        type="password"
                                        id={`backup-input-marketData-${backup.id}`}
                                        className="w-24 px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        placeholder="API Key"
                                        aria-label={`${backup.providerName} API key`}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const input = e.target as HTMLInputElement;
                                            if (input.value.trim()) {
                                              handleSaveProvider(backup.id, 'marketData', false, backup.enabled ?? false, input.value.trim());
                                              input.value = '';
                                            }
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={() => {
                                          const input = document.getElementById(`backup-input-marketData-${backup.id}`) as HTMLInputElement;
                                          if (input?.value.trim()) {
                                            handleSaveProvider(backup.id, 'marketData', false, backup.enabled ?? false, input.value.trim());
                                            input.value = '';
                                          }
                                        }}
                                        disabled={savingProvider === `marketData-${backup.id}`}
                                        className="px-2 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded text-xs hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                                      >
                                        {savingProvider === `marketData-${backup.id}` ? '...' : 'Save'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {backup.enabled && providerTestResults[backup.providerName] && (
                              <div className={`flex items-center gap-2 mt-2 p-2 rounded-lg text-xs ${
                                providerTestResults[backup.providerName].status === 'success'
                                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                  : providerTestResults[backup.providerName].status === 'error'
                                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                              }`}>
                                {providerTestResults[backup.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                {providerTestResults[backup.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                <span>{providerTestResults[backup.providerName].message}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* News Providers */}
                <div className="bg-gradient-to-r from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-700/30 shadow-lg overflow-hidden">
                  <div className="p-6 lg:p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-green-500 rounded-xl flex items-center justify-center shadow-sm">
                        <span className="text-white font-bold text-xl">📰</span>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">News Providers</h3>
                        <p className="text-sm text-gray-400">Sentiment analysis and market news</p>
                      </div>
                    </div>

                    {/* Primary Provider */}
                    {providerData?.news?.primary && (
                      <div className="space-y-4 mb-6">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            PRIMARY
                          </span>
                          <span className="text-sm font-medium text-white">{providerData.news.primary.providerName}</span>
                        </div>

                        {providerData.news.primary.apiKeyRequired ? (
                          providerData.news.primary.apiKeyPresent ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                <CheckCircleIcon className="w-4 h-4 text-green-400" />
                                <span className="text-green-400 text-sm font-medium">API key configured</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleTestProvider(providerData.news.primary.providerName)}
                                  disabled={testingProvider === providerData.news.primary.providerName}
                                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 disabled:opacity-50 text-sm font-medium backdrop-blur-sm"
                                >
                                  {testingProvider === providerData.news.primary.providerName ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                      Testing...
                                    </span>
                                  ) : (
                                    'Test Connection'
                                  )}
                                </button>
                                <button
                                  onClick={() => {
                                    const newKey = prompt(`Enter new API key for ${providerData.news.primary.providerName}:`);
                                    if (newKey?.trim()) {
                                      handleChangeProviderKey(providerData.news.primary.id, 'news', true, newKey.trim());
                                    }
                                  }}
                                  className="px-3 py-2 bg-slate-600/50 text-slate-300 border border-slate-600/50 rounded-lg hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all text-sm font-medium"
                                >
                                  Change Key
                                </button>
                              </div>
                              {providerTestResults[providerData.news.primary.providerName] && (
                                <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                                  providerTestResults[providerData.news.primary.providerName].status === 'success'
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                    : providerTestResults[providerData.news.primary.providerName].status === 'error'
                                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                    : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                                }`}>
                                  {providerTestResults[providerData.news.primary.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                  {providerTestResults[providerData.news.primary.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                  <span>{providerTestResults[providerData.news.primary.providerName].message}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <input
                                  type="password"
                                  id={`primary-news-${providerData.news.primary.id}`}
                                  className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                  placeholder={`Enter ${providerData.news.primary.providerName} API key`}
                                  aria-label={`${providerData.news.primary.providerName} API key`}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const input = e.target as HTMLInputElement;
                                      if (input.value.trim()) {
                                        handleSaveProvider(providerData.news.primary.id, 'news', true, providerData.news.primary.enabled ?? true, input.value.trim());
                                        input.value = '';
                                      }
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const input = document.getElementById(`primary-news-${providerData.news.primary.id}`) as HTMLInputElement;
                                    if (input?.value.trim()) {
                                      handleSaveProvider(providerData.news.primary.id, 'news', true, providerData.news.primary.enabled ?? true, input.value.trim());
                                      input.value = '';
                                    }
                                  }}
                                  disabled={savingProvider === `news-${providerData.news.primary.id}`}
                                  className="px-4 py-2.5 bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-lg hover:shadow-xl"
                                >
                                  {savingProvider === `news-${providerData.news.primary.id}` ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                              <CheckCircleIcon className="w-4 h-4 text-green-400" />
                              <span className="text-green-400 text-sm font-medium">No API key required</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleTestProvider(providerData.news.primary.providerName)}
                                disabled={testingProvider === providerData.news.primary.providerName}
                                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 disabled:opacity-50 text-sm font-medium backdrop-blur-sm"
                              >
                                {testingProvider === providerData.news.primary.providerName ? (
                                  <span className="flex items-center justify-center gap-2">
                                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                    Testing...
                                  </span>
                                ) : (
                                  'Test Connection'
                                )}
                              </button>
                            </div>
                            {providerTestResults[providerData.news.primary.providerName] && (
                              <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                                providerTestResults[providerData.news.primary.providerName].status === 'success'
                                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                  : providerTestResults[providerData.news.primary.providerName].status === 'error'
                                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                              }`}>
                                {providerTestResults[providerData.news.primary.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                {providerTestResults[providerData.news.primary.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                <span>{providerTestResults[providerData.news.primary.providerName].message}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Backup Providers */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-300">Backup Providers</h4>
                        <span className="text-xs text-gray-400 bg-slate-700/50 px-2 py-1 rounded-full">
                          {providerData.news.backups.length} available
                        </span>
                      </div>

                      <div className="space-y-3">
                        {providerData.news.backups.map((backup: any) => (
                          <div key={backup.id} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    id={`backup-news-${backup.id}`}
                                    className="sr-only peer"
                                    checked={backup.enabled || false}
                                    onChange={(e) => handleSaveProvider(backup.id, 'news', false, e.target.checked)}
                                    aria-label={`Enable ${backup.providerName} backup provider`}
                                  />
                                  <div className="w-10 h-5 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                                </label>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-white">{backup.providerName}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                      !backup.apiKeyRequired
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    }`}>
                                      {!backup.apiKeyRequired ? 'FREE' : 'API KEY'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {backup.enabled && (
                                <div className="flex items-center gap-2 mt-3">
                                  {!backup.apiKeyRequired ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-green-400">Ready</span>
                                      <button
                                        onClick={() => handleTestProvider(backup.providerName)}
                                        disabled={testingProvider === backup.providerName}
                                        className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                      >
                                        {testingProvider === backup.providerName ? '...' : 'Test'}
                                      </button>
                                    </div>
                                  ) : backup.apiKeyPresent ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-green-400 text-xs">✓ Configured</span>
                                      <button
                                        onClick={() => handleTestProvider(backup.providerName)}
                                        disabled={testingProvider === backup.providerName}
                                        className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                      >
                                        {testingProvider === backup.providerName ? '...' : 'Test'}
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newKey = prompt(`Enter new API key for ${backup.providerName}:`);
                                          if (newKey?.trim()) {
                                            handleChangeProviderKey(backup.id, 'news', false, newKey.trim());
                                          }
                                        }}
                                        className="px-2 py-1 bg-slate-600/50 text-slate-300 border border-slate-600/50 rounded text-xs hover:bg-slate-600/70 transition-all"
                                      >
                                        Change Key
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2">
                                      <input
                                        type="password"
                                        id={`backup-input-news-${backup.id}`}
                                        className="w-24 px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        placeholder="API Key"
                                        aria-label={`${backup.providerName} API key`}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const input = e.target as HTMLInputElement;
                                            if (input.value.trim()) {
                                              handleSaveProvider(backup.id, 'news', false, backup.enabled ?? false, input.value.trim());
                                              input.value = '';
                                            }
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={() => {
                                          const input = document.getElementById(`backup-input-news-${backup.id}`) as HTMLInputElement;
                                          if (input?.value.trim()) {
                                            handleSaveProvider(backup.id, 'news', false, backup.enabled ?? false, input.value.trim());
                                            input.value = '';
                                          }
                                        }}
                                        disabled={savingProvider === `news-${backup.id}`}
                                        className="px-2 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded text-xs hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                                      >
                                        {savingProvider === `news-${backup.id}` ? '...' : 'Save'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {backup.enabled && providerTestResults[backup.providerName] && (
                              <div className={`flex items-center gap-2 mt-2 p-2 rounded-lg text-xs ${
                                providerTestResults[backup.providerName].status === 'success'
                                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                  : providerTestResults[backup.providerName].status === 'error'
                                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                              }`}>
                                {providerTestResults[backup.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                {providerTestResults[backup.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                <span>{providerTestResults[backup.providerName].message}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Metadata Providers */}
                <div className="bg-gradient-to-r from-slate-800/40 to-slate-900/40 backdrop-blur-sm rounded-2xl border border-slate-700/30 shadow-lg overflow-hidden">
                  <div className="p-6 lg:p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-12 h-12 bg-purple-500 rounded-xl flex items-center justify-center shadow-sm">
                        <span className="text-white font-bold text-xl">📈</span>
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold text-white">Metadata Providers</h3>
                        <p className="text-sm text-gray-400">Market cap, supply, and asset information</p>
                      </div>
                    </div>

                    {/* Primary Provider */}
                    {providerData?.metadata?.primary && (
                      <div className="space-y-4 mb-6">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            PRIMARY
                          </span>
                          <span className="text-sm font-medium text-white">{providerData.metadata.primary.providerName}</span>
                        </div>

                        {providerData.metadata.primary.apiKeyRequired ? (
                          providerData.metadata.primary.apiKeyPresent ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                                <CheckCircleIcon className="w-4 h-4 text-green-400" />
                                <span className="text-green-400 text-sm font-medium">API key configured</span>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleTestProvider(providerData.metadata.primary.providerName)}
                                  disabled={testingProvider === providerData.metadata.primary.providerName}
                                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 disabled:opacity-50 text-sm font-medium backdrop-blur-sm"
                                >
                                  {testingProvider === providerData.metadata.primary.providerName ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                      Testing...
                                    </span>
                                  ) : (
                                    'Test Connection'
                                  )}
                                </button>
                                <button
                                  onClick={() => {
                                    const newKey = prompt(`Enter new API key for ${providerData.metadata.primary.providerName}:`);
                                    if (newKey?.trim()) {
                                      handleChangeProviderKey(providerData.metadata.primary.id, 'metadata', true, newKey.trim());
                                    }
                                  }}
                                  className="px-3 py-2 bg-slate-600/50 text-slate-300 border border-slate-600/50 rounded-lg hover:bg-slate-600/70 focus:outline-none focus:ring-2 focus:ring-slate-500 transition-all text-sm font-medium"
                                >
                                  Change Key
                                </button>
                              </div>
                              {providerTestResults[providerData.metadata.primary.providerName] && (
                                <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                                  providerTestResults[providerData.metadata.primary.providerName].status === 'success'
                                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                    : providerTestResults[providerData.metadata.primary.providerName].status === 'error'
                                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                    : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                                }`}>
                                  {providerTestResults[providerData.metadata.primary.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                  {providerTestResults[providerData.metadata.primary.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                  <span>{providerTestResults[providerData.metadata.primary.providerName].message}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <input
                                  type="password"
                                  id={`primary-metadata-${providerData.metadata.primary.id}`}
                                  className="flex-1 px-3 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                  placeholder={`Enter ${providerData.metadata.primary.providerName} API key`}
                                  aria-label={`${providerData.metadata.primary.providerName} API key`}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const input = e.target as HTMLInputElement;
                                      if (input.value.trim()) {
                                        handleSaveProvider(providerData.metadata.primary.id, 'metadata', true, providerData.metadata.primary.enabled ?? true, input.value.trim());
                                        input.value = '';
                                      }
                                    }
                                  }}
                                />
                                <button
                                  onClick={() => {
                                    const input = document.getElementById(`primary-metadata-${providerData.metadata.primary.id}`) as HTMLInputElement;
                                    if (input?.value.trim()) {
                                      handleSaveProvider(providerData.metadata.primary.id, 'metadata', true, providerData.metadata.primary.enabled ?? true, input.value.trim());
                                      input.value = '';
                                    }
                                  }}
                                  disabled={savingProvider === `metadata-${providerData.metadata.primary.id}`}
                                  className="px-4 py-2.5 bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-semibold rounded-xl hover:from-purple-600 hover:to-cyan-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm shadow-lg hover:shadow-xl"
                                >
                                  {savingProvider === `metadata-${providerData.metadata.primary.id}` ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                              <CheckCircleIcon className="w-4 h-4 text-green-400" />
                              <span className="text-green-400 text-sm font-medium">No API key required</span>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleTestProvider(providerData.metadata.primary.providerName)}
                                disabled={testingProvider === providerData.metadata.primary.providerName}
                                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:from-blue-500/30 hover:to-cyan-500/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-200 disabled:opacity-50 text-sm font-medium backdrop-blur-sm"
                              >
                                {testingProvider === providerData.metadata.primary.providerName ? (
                                  <span className="flex items-center justify-center gap-2">
                                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                                    Testing...
                                  </span>
                                ) : (
                                  'Test Connection'
                                )}
                              </button>
                            </div>
                            {providerTestResults[providerData.metadata.primary.providerName] && (
                              <div className={`flex items-center gap-2 p-2 rounded-lg text-xs ${
                                providerTestResults[providerData.metadata.primary.providerName].status === 'success'
                                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                  : providerTestResults[providerData.metadata.primary.providerName].status === 'error'
                                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                              }`}>
                                {providerTestResults[providerData.metadata.primary.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                {providerTestResults[providerData.metadata.primary.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                <span>{providerTestResults[providerData.metadata.primary.providerName].message}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Backup Providers */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-gray-300">Backup Providers</h4>
                        <span className="text-xs text-gray-400 bg-slate-700/50 px-2 py-1 rounded-full">
                          {providerData.metadata.backups.length} available
                        </span>
                      </div>

                      <div className="space-y-3">
                        {providerData.metadata.backups.map((backup: any) => (
                          <div key={backup.id} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/50">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    id={`backup-metadata-${backup.id}`}
                                    className="sr-only peer"
                                    checked={backup.enabled || false}
                                    onChange={(e) => handleSaveProvider(backup.id, 'metadata', false, e.target.checked)}
                                    aria-label={`Enable ${backup.providerName} backup provider`}
                                  />
                                  <div className="w-10 h-5 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-500"></div>
                                </label>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-white">{backup.providerName}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                      !backup.apiKeyRequired
                                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                    }`}>
                                      {!backup.apiKeyRequired ? 'FREE' : 'API KEY'}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {backup.enabled && (
                                <div className="flex items-center gap-2 mt-3">
                                  {!backup.apiKeyRequired ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-green-400">Ready</span>
                                      <button
                                        onClick={() => handleTestProvider(backup.providerName)}
                                        disabled={testingProvider === backup.providerName}
                                        className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                      >
                                        {testingProvider === backup.providerName ? '...' : 'Test'}
                                      </button>
                                    </div>
                                  ) : backup.apiKeyPresent ? (
                                    <div className="flex items-center gap-2">
                                      <span className="text-green-400 text-xs">✓ Configured</span>
                                      <button
                                        onClick={() => handleTestProvider(backup.providerName)}
                                        disabled={testingProvider === backup.providerName}
                                        className="px-2 py-1 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs hover:bg-blue-500/30 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
                                      >
                                        {testingProvider === backup.providerName ? '...' : 'Test'}
                                      </button>
                                      <button
                                        onClick={() => {
                                          const newKey = prompt(`Enter new API key for ${backup.providerName}:`);
                                          if (newKey?.trim()) {
                                            handleChangeProviderKey(backup.id, 'metadata', false, newKey.trim());
                                          }
                                        }}
                                        className="px-2 py-1 bg-slate-600/50 text-slate-300 border border-slate-600/50 rounded text-xs hover:bg-slate-600/70 transition-all"
                                      >
                                        Change Key
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex gap-2">
                                      <input
                                        type="password"
                                        id={`backup-input-metadata-${backup.id}`}
                                        className="w-24 px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-xs text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        placeholder="API Key"
                                        aria-label={`${backup.providerName} API key`}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            const input = e.target as HTMLInputElement;
                                            if (input.value.trim()) {
                                              handleSaveProvider(backup.id, 'metadata', false, backup.enabled ?? false, input.value.trim());
                                              input.value = '';
                                            }
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={() => {
                                          const input = document.getElementById(`backup-input-metadata-${backup.id}`) as HTMLInputElement;
                                          if (input?.value.trim()) {
                                            handleSaveProvider(backup.id, 'metadata', false, backup.enabled ?? false, input.value.trim());
                                            input.value = '';
                                          }
                                        }}
                                        disabled={savingProvider === `metadata-${backup.id}`}
                                        className="px-2 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded text-xs hover:from-purple-600 hover:to-pink-600 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all disabled:opacity-50"
                                      >
                                        {savingProvider === `metadata-${backup.id}` ? '...' : 'Save'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {backup.enabled && providerTestResults[backup.providerName] && (
                              <div className={`flex items-center gap-2 mt-2 p-2 rounded-lg text-xs ${
                                providerTestResults[backup.providerName].status === 'success'
                                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                  : providerTestResults[backup.providerName].status === 'error'
                                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                  : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                              }`}>
                                {providerTestResults[backup.providerName].status === 'success' && <CheckCircleIcon className="w-3 h-3" />}
                                {providerTestResults[backup.providerName].status === 'error' && <XCircleIcon className="w-3 h-3" />}
                                <span>{providerTestResults[backup.providerName].message}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Notification Settings Section */}
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-4 sm:p-6 shadow-sm">
              <div className="mb-6">
                <h2 className="text-xl font-semibold text-white mb-2">Notification Settings</h2>
                <p className="text-sm text-gray-400">Configure in-app notification preferences and alerts</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {/* Auto-Trade Trigger Alerts */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-white mb-1">Auto-Trade Trigger Alerts</h3>
                      <p className="text-xs text-gray-400">Get notified when auto-trade is triggered by high accuracy signals</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="enableAutoTradeAlerts"
                        className="sr-only peer"
                        checked={settings.enableAutoTradeAlerts || false}
                        onChange={(e) => setSettings({ ...settings, enableAutoTradeAlerts: e.target.checked })}
                        aria-label="Enable auto-trade trigger alerts"
                      />
                      <div className="w-12 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
                    </label>
                  </div>
                </div>

                {/* Accuracy Alerts */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-white mb-1">Accuracy Alerts</h3>
                      <p className="text-xs text-gray-400">Receive notifications when accuracy crosses 80%</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="enableAccuracyAlerts"
                        className="sr-only peer"
                        checked={settings.enableAccuracyAlerts || false}
                        onChange={(e) => setSettings({ ...settings, enableAccuracyAlerts: e.target.checked })}
                        aria-label="Enable accuracy alerts"
                      />
                      <div className="w-12 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
                    </label>
                  </div>
                </div>

                {/* Whale Movement Alerts */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-white mb-1">Whale Movement Alerts</h3>
                      <p className="text-xs text-gray-400">Get alerted when large buy/sell movements are detected</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="enableWhaleAlerts"
                        className="sr-only peer"
                        checked={settings.enableWhaleAlerts || false}
                        onChange={(e) => setSettings({ ...settings, enableWhaleAlerts: e.target.checked })}
                        aria-label="Enable whale movement alerts"
                      />
                      <div className="w-12 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
                    </label>
                  </div>
                </div>

                {/* Trade Confirmation Required */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-white mb-1">Trade Confirmation Required</h3>
                      <p className="text-xs text-gray-400">Show confirmation modal before executing auto-trades</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        id="tradeConfirmationRequired"
                        className="sr-only peer"
                        checked={settings.tradeConfirmationRequired || false}
                        onChange={(e) => setSettings({ ...settings, tradeConfirmationRequired: e.target.checked })}
                        aria-label="Require trade confirmation"
                      />
                      <div className="w-12 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
                    </label>
                  </div>
                </div>

                {/* Sound & Vibration Settings */}
                <div className="bg-slate-800/30 rounded-2xl p-4 border border-slate-700/50 shadow-sm">
                  <h3 className="text-sm font-semibold text-white mb-4">Sound & Vibration</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-300">Notification Sounds</span>
                        <p className="text-xs text-gray-400">Play sound effects for notifications</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          id="notificationSounds"
                          className="sr-only peer"
                          checked={settings.notificationSounds || false}
                          onChange={(e) => setSettings({ ...settings, notificationSounds: e.target.checked })}
                          aria-label="Enable notification sounds"
                        />
                        <div className="w-12 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-300">Vibration</span>
                        <p className="text-xs text-gray-400">Vibrate device for critical alerts</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          id="notificationVibration"
                          className="sr-only peer"
                          checked={settings.notificationVibration || false}
                          onChange={(e) => setSettings({ ...settings, notificationVibration: e.target.checked })}
                          aria-label="Enable notification vibration"
                        />
                        <div className="w-12 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-pink-500"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Background Deep Research Alerts Section */}
            <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl rounded-3xl border border-slate-700/50 p-6 lg:p-8 shadow-2xl shadow-slate-900/20">
              <div className="mb-6 lg:mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white">Background Research Alerts</h2>
                </div>
                <p className="text-slate-400 leading-relaxed">Configure automatic deep research analysis with real-time Telegram notifications</p>
              </div>

              <BackgroundResearchWizard />
            </div>

            {/* Add Exchange Section */}
            <div className="bg-gradient-to-br from-slate-800/60 to-slate-900/60 backdrop-blur-xl rounded-3xl border border-slate-700/50 p-6 lg:p-8 shadow-2xl shadow-slate-900/20">
              <div className="mb-6 lg:mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl flex items-center justify-center shadow-lg">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-white">Exchange Connection</h2>
                </div>
                <p className="text-slate-400 leading-relaxed">Connect your exchange account to enable automated trading</p>
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
                              className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
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
                              className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
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
                                className="w-full px-4 py-3 bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
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
            </div>

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

