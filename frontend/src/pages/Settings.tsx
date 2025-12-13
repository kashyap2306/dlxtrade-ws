import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsApi, providerApi, exchangeService, adminApi } from '../services/api';
import Toast from '../components/Toast';
import { API_NAME_MAP, PROVIDER_CONFIG } from "../constants/providers";
import { EXCHANGES } from "../constants/exchanges";
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
import { SettingsGeneralSection } from './SettingsGeneralSection';
import { SettingsApiProvidersSection } from './SettingsApiProvidersSection';
import { SettingsExchangeSection } from './SettingsExchangeSection';
import { BackgroundResearchWizard } from './BackgroundResearchWizard';
import { SettingsModals } from './SettingsModals';

// Provider ID mapping - maps UI names to backend IDs (corrected)
const PROVIDER_ID_MAP: Record<string, string> = {
  "NewsData.io": "newsdata",
  "CryptoCompare": "cryptocompare",
  "CoinGecko": "coingecko",
  "CoinPaprika": "coinpaprika",
  "CoinMarketCap": "coinmarketcap",
  "CoinLore": "coinlore",
  "CoinStats": "coinstats",
  "CoinAPI": "coinapi",
  "BraveNewCoin": "bravenewcoin",
  "Messari": "messari",
  "Kaiko": "kaiko",
  "LiveCoinWatch": "livecoinwatch",
  "CoinCheckup": "coincheckup",
  "Cointelegraph RSS": "cointelegraph_rss",
  "AltcoinBuzz RSS": "altcoinbuzz_rss",
  "GNews": "gnews",
  "Marketaux": "marketaux",
  "Webz.io": "webzio",
  "CryptoPanic": "cryptopanic",
  "Reddit": "reddit",
  "CoinStatsNews": "coinstatsnews",
  "NewsCatcher": "newscatcher",
  "CryptoCompare News": "cryptocompare_news"
};

// Strict provider type mapping - matches backend expectations (using corrected backend IDs as keys)
const PROVIDER_TYPE_MAP: Record<string, 'marketData' | 'news' | 'metadata'> = {
  // Market Data Providers
  'cryptocompare': 'marketData',
  'coingecko': 'metadata',
  'coinpaprika': 'marketData',
  'coinmarketcap': 'marketData',
  'coinlore': 'marketData',
  'coinapi': 'marketData',
  'bravenewcoin': 'marketData',
  'messari': 'marketData',
  'kaiko': 'marketData',
  'livecoinwatch': 'marketData',
  'coinstats': 'marketData',
  'coincheckup': 'marketData',

  // News Providers
  'newsdata': 'news',
  'cryptopanic': 'news',
  'reddit': 'news',
  'gnews': 'news',
  'cointelegraph_rss': 'news',
  'altcoinbuzz_rss': 'news',
  'marketaux': 'news',
  'webzio': 'news',
  'coinstatsnews': 'news',
  'newscatcher': 'news',
  'cryptocompare_news': 'news',

  // Metadata Providers
  'coincap': 'metadata',
  'coinranking': 'metadata',
  'nomics': 'metadata'
};

console.log("🟣 SETTINGS COMPONENT CHECK", {
  General: SettingsGeneralSection,
  Providers: SettingsApiProvidersSection,
  Exchange: SettingsExchangeSection,
  Wizard: BackgroundResearchWizard,
  Modals: SettingsModals,
});

// Main Settings Component
const Settings = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, handleLogout: authHandleLogout } = useAuth();
  
  // REQ 6: All React hooks (useState, useEffect, useCallback) MUST be declared before any conditional returns.
  // State variables and refs
  const [loadingAll, setLoadingAll] = useState(false); // Never show global loading like Research page
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const isMountedRef = useRef(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectedExchange, setSelectedExchange] = useState<string>('');
  const [exchangeForm, setExchangeForm] = useState({ apiKey: '', secretKey: '', passphrase: '' });
  const [connectedExchange, setConnectedExchange] = useState<any>(null);
  const [exchangeTestResult, setExchangeTestResult] = useState<{ status: 'success' | 'error' | null; message: string } | undefined>(undefined);
  const [savingExchange, setSavingExchange] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { status: 'success' | 'error' | null; message: string }>>({});
  const [showProviderDetails, setShowProviderDetails] = useState<Record<string, boolean>>({});
  const [notificationSettings, setNotificationSettings] = useState<any>({});
  const [showAutoTradeModal, setShowAutoTradeModal] = useState(false);
  const [showTradeConfirmationModal, setShowTradeConfirmationModal] = useState(false);
  const [showSoundSelectorModal, setShowSoundSelectorModal] = useState(false);
  const [notificationPrereqs, setNotificationPrereqs] = useState<any>(null);
  const [showAccuracyModal, setShowAccuracyModal] = useState(false);
  const [accuracyThresholdInput, setAccuracyThresholdInput] = useState('80');
  const [telegramForAccuracy, setTelegramForAccuracy] = useState(false);
  const [sampleAccuracy, setSampleAccuracy] = useState(70);

  // New state for backend-saved configs
  const defaultTradingConfig = {
    maxPositionPercent: 2,
    maxDailyLossPercent: 3,
    maxTradesPerDay: 10,
    preferredTradeType: 'swing',
    tradeConfirmationRequired: true
  };
  const [tradingConfig, setTradingConfig] = useState<any>(defaultTradingConfig);
  const [providers, setProviders] = useState<any>({});
  const [apiKeys, setApiKeys] = useState<Record<string, { apiKey: string; saved: boolean }>>({});
  const [exchangeConfig, setExchangeConfig] = useState<any>(null);

  // Initial Settings State (from snippet 11 - defined before callbacks)
  const [settings, setSettings] = useState<any>({
    maxPositionPerTrade: 10,
    tradeType: 'scalping',
    accuracyThreshold: 85,
    maxDailyLoss: 5,
    maxTradesPerDay: 50,
    enableAutoTrade: false,
    exchanges: [],
    enableAutoTradeAlerts: false,
    enablePositionAlerts: false,
    enableWhaleAlerts: false,
    tradeConfirmationRequired: false,
    notificationSounds: false,
    notificationVibration: false,
    notifications: {}
  });
  
  // REQ 2: Fix handleLogout TDZ fatal error: Move handleLogout ABOVE any JSX or function that uses it.
  const handleLogout = useCallback(() => {
    authHandleLogout();
    navigate('/login');
  }, [authHandleLogout, navigate]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoadingAll(true);
    setRetryCount(prev => prev + 1);
  }, []);
  
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'warning') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);
  
  // Placeholder for other necessary callbacks/loaders (e.g., loadNotificationSettings, etc.)
  const loadNotificationSettings = useCallback(async () => {
      // Placeholder implementation for REQ 7
      try {
          const response = await settingsApi.notifications.load();
          setNotificationSettings(response.data || {});
      } catch (err) {
          console.warn('Failed to load notification settings', err);
      }
  }, []);
  

  
  const handleSaveAccuracySettings = useCallback(async () => {
    const threshold = parseInt(accuracyThresholdInput);
    if (isNaN(threshold) || threshold < 60 || threshold > 99) {
      showToast('Threshold must be between 60 and 99.', 'error');
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
    await settingsApi.notifications.update(newSettings); // Assuming saveNotificationSettings calls update
    setShowAccuracyModal(false);
  }, [accuracyThresholdInput, notificationSettings, telegramForAccuracy]);



  // REQ 4: Fix loadSettings() return mapping
  const loadSettings = async () => {
    try {
      const response = await settingsApi.load(); 
      // Handle potential 401 or null response
      if (!response || response.status === 401) {
        if (response?.status === 401) { 
          console.warn('[Settings] 401 Unauthorized loading settings'); 
          showToast('Authentication required. Please log in again.', 'error');
          handleLogout(); 
        } 
        return; 
      } 
      
      // REQ 8: Ensure loader returns plain JSON data
      const data = response.data || {};
      
      // REQ 4: Only map backend fields that exist - DO NOT overwrite unrelated settings
      setSettings((prev: any) => {
        const newSettings = { ...prev };

        // Only update fields that exist in the backend response
        Object.keys(data).forEach(key => {
          if (data.hasOwnProperty(key)) {
            newSettings[key] = data[key];
          }
        });

        return newSettings;
      });
    } catch (err: any) {
      console.warn('Load settings failed:', err);
      if (err.response?.status === 401) {
        showToast('Authentication required. Please log in again.', 'error');
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || 'Error loading settings', 'error');
      // Set minimal defaults on error to prevent crash
      setSettings(prev => ({ ...prev, enableAutoTrade: prev.enableAutoTrade || false, exchanges: prev.exchanges || [], }));
    }
  };

  // Helper functions for refreshing state
  const loadProviderConfig = useCallback(async (uid: string) => {
    try {
      const response = await settingsApi.loadProviderConfig(uid);
      const raw =
        response?.providerConfig ??
        response?.config ??
        response?.data?.providerConfig ??
        response?.data?.config ??
        response?.data ??
        response ??
        {};

      console.log('[SETTINGS] Loaded providerConfig keys:', Object.keys(raw || {}));

      const providerConfig = {
        marketData: raw.marketData || {},
        news: raw.news || {},
        metadata: raw.metadata || {}
      };

      const flatProviders = {
        ...(providerConfig.marketData || {}),
        ...(providerConfig.news || {}),
        ...(providerConfig.metadata || {})
      };

      const normalizedProviders = Object.fromEntries(
        Object.entries(flatProviders).map(([pid, data]: any) => {
          const apiKey = data?.apiKey || '';
          const normalizedType = PROVIDER_TYPE_MAP[pid] || data?.type || 'marketData';
          const enabled = data?.enabled ?? !!apiKey;
          return [
            pid,
            {
              providerName: pid,
              apiKey,
              enabled,
              type: normalizedType
            }
          ];
        })
      );

      // Update providers state with normalized map for UI consumers
      setProviders(normalizedProviders);

      // Update apiKeys state with minimal fields
      setApiKeys(
        Object.fromEntries(
          Object.entries(normalizedProviders).map(([pid, data]: any) => [
            pid,
            {
              apiKey: data?.apiKey || "",
              saved: !!(data?.apiKey),
              enabled: data?.enabled || false,
              type: data?.type || (PROVIDER_TYPE_MAP[pid] || 'marketData')
            }
          ])
        )
      );

      // Remove legacy provider keys from settings state
      setSettings(prevSettings => {
        const cleaned = { ...prevSettings };
        const legacyKeys = [
          'coinGeckoKey', 'newsDataKey', 'cryptoCompareKey',
          'coinPaprikaKey', 'coinPaprikaEnabled', 'coinMarketCapKey', 'coinMarketCapEnabled',
          'coinLoreKey', 'coinLoreEnabled', 'coinApiKey', 'coinApiEnabled',
          'braveNewCoinKey', 'braveNewCoinEnabled', 'messariKey', 'messariEnabled',
          'kaikoKey', 'kaikoEnabled', 'liveCoinWatchKey', 'liveCoinWatchEnabled',
          'coinStatsKey', 'coinStatsEnabled', 'coinCheckupKey', 'coinCheckupEnabled',
          'cryptoPanicKey', 'cryptoPanicEnabled', 'redditKey', 'redditEnabled',
          'cointelegraphKey', 'cointelegraphEnabled', 'altcoinBuzzKey', 'altcoinBuzzEnabled',
          'gnewsKey', 'gnewsEnabled', 'marketauxKey', 'marketauxEnabled',
          'webzKey', 'webzEnabled', 'coinStatsNewsKey', 'coinStatsNewsEnabled',
          'newsCatcherKey', 'newsCatcherEnabled', 'cryptoCompareNewsKey', 'cryptoCompareNewsEnabled',
          'coinCapKey', 'coinCapEnabled', 'coinRankingKey', 'coinRankingEnabled',
          'nomicsKey', 'nomicsEnabled'
        ];
        legacyKeys.forEach(k => {
          if (k in cleaned) {
            delete cleaned[k];
          }
        });
        return cleaned;
      });
    } catch (err) {
      console.warn('[LOAD] Failed to load provider config:', err);
    }
  }, []);

  const loadExchangeConfig = useCallback(async (uid: string) => {
    try {
      const response = await settingsApi.loadExchangeConfig(uid);
      console.log('[LOAD] Exchange config response:', response.data);
      setExchangeConfig(response.data || {});
    } catch (err) {
      console.warn('[LOAD] Failed to load exchange config:', err);
      setExchangeConfig({});
    }
  }, []);

  // REQ 3 & 7: Fix token/401 errors and initialization order
  useEffect(() => {
    isMountedRef.current = true;

    console.log('[TEST] Settings mount - user:', user?.uid, 'authLoading:', authLoading);

    // Wait for auth to finish loading
    if (authLoading) {
      console.log('[TEST] auth still loading - delaying settings load');
      return;
    }

    // If auth resolved and there is no user, force logout/redirect to avoid 401
    if (!user) {
      console.warn('[Settings] No authenticated user after auth loading - logging out');
      handleLogout();
      return;
    }

    // Auth is ready and user exists — load all data
    const loadAllData = async () => {
      try {
        await loadSettings();
        if (user) {
          await loadProviderConfig(user.uid);
          await loadExchangeConfig(user.uid);
        }
      } catch (error: any) {
        console.error('[Settings] Error loading data:', error);
        // Don't crash the page, just log the error
      }
    };

    loadAllData();

    return () => {
      isMountedRef.current = false;
    };
    // deliberately include authLoading and user in deps to re-run when auth is ready
  }, [authLoading, user, loadProviderConfig, loadExchangeConfig]);

  // Helper function to map provider ID to settings key
  const getSettingsKeyFromProviderId = (providerId: string): string | null => {
    const mapping: Record<string, string> = {
      'coingecko': 'coinGeckoKey',
      'newsdata': 'newsDataKey',
      'cryptocompare': 'cryptoCompareKey',
      'coinpaprika': 'coinPaprikaKey',
      'coinmarketcap': 'coinMarketCapKey',
      'coinlore': 'coinLoreKey',
      'coinapi': 'coinApiKey',
      'bravenewcoin': 'braveNewCoinKey',
      'messari': 'messariKey',
      'kaiko': 'kaikoKey',
      'livecoinwatch': 'liveCoinWatchKey',
      'coinstats': 'coinStatsKey',
      'coincheckup': 'coinCheckupKey',
      'cryptopanic': 'cryptoPanicKey',
      'reddit': 'redditKey',
      'cointelegraph_rss': 'cointelegraphKey',
      'altcoinbuzz_rss': 'altcoinBuzzKey',
      'gnews': 'gnewsKey',
      'marketaux': 'marketauxKey',
      'webzio': 'webzKey',
      'coinstatsnews': 'coinStatsNewsKey',
      'newscatcher': 'newsCatcherKey',
      'cryptocompare_news': 'cryptoCompareNewsKey'
    };
    return mapping[providerId] || null;
  };

  const getEnabledKeyFromProviderId = (providerId: string): string | null => {
    const nameEntry = Object.entries(API_NAME_MAP).find(([, id]) => id === providerId);
    if (!nameEntry) return null;
    const providerName = nameEntry[0];

    for (const config of Object.values(PROVIDER_CONFIG)) {
      if ((config as any).primary?.name === providerName && (config as any).primary?.enabledKey) {
        return (config as any).primary.enabledKey;
      }
      const backup = config.backups.find(b => b.name === providerName);
      if (backup?.enabledKey) {
        return backup.enabledKey;
      }
    }

    return null;
  };

  // Handlers (rest of existing handlers like handleSaveGeneralSettings, handleProviderKeyChange, etc.)

  const handleSaveGeneralSettings = async () => {
    if (!user) {
      showToast('Authentication required', 'error');
      return;
    }

    setSavingSettings(true);
    try {
      const payload = {
        maxPositionPercent: Number(settings.maxPositionPerTrade || 10),
        maxDailyLossPercent: Number(settings.maxDailyLoss || 5),
        maxTradesPerDay: Number(settings.maxTradesPerDay || 50),
        preferredTradeType: settings.tradeType || 'Scalping',
        tradeConfirmationRequired: Boolean(settings.tradeConfirmationRequired || false),
        notifications: {
          autoTradeAlerts: Boolean(settings.notifications?.autoTradeAlerts || false),
          accuracyAlerts: Boolean(settings.notifications?.accuracyAlerts || false),
          whaleAlerts: Boolean(settings.notifications?.whaleAlerts || false),
          playSound: Boolean(settings.notifications?.playSound || false),
          vibrate: Boolean(settings.notifications?.vibrate || false),
          soundPreferences: settings.notifications?.soundPreferences || {}
        }
      };

      const response = await settingsApi.general.save(payload);

      if (response.data?.settings) {
        setSettings(response.data.settings);
      }

      showToast('General settings saved successfully', 'success');
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || 'Failed to save settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleNotificationToggle = (type: string, checked: boolean) => {
    // Special handling for autoTradeAlerts - requires Auto Trade Mode to be enabled
    if (type === 'autoTradeAlerts' && checked && !settings.enableAutoTrade) {
      setShowAutoTradeModal(true);
      showToast('Auto Trade Mode must be enabled first', 'warning');
      return; // Do not enable toggle
    }

    // Special handling for whaleAlerts - requires primary market API key
    if (type === 'whaleAlerts' && checked) {
      // Check if any market data provider has an API key
      const hasPrimaryMarketApiKey = Object.values(providers).some((provider: any) =>
        provider.type === 'marketData' && provider.apiKey && provider.apiKey.trim() !== ''
      );

      if (!hasPrimaryMarketApiKey) {
        showToast('Primary Market Data API Key required for Whale Alerts', 'warning');
        // Could open a modal here to guide user to add API key
        return; // Do not enable toggle
      }
    }

    // Special handling for playSound - open sound selector modal instead of direct toggle
    if (type === 'playSound' && checked) {
      setShowSoundSelectorModal(true);
      return; // Don't toggle directly, modal will handle it
    }

    setSettings((prev: any) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [type]: checked
      }
    }));
  };


  const handleSaveTradingConfig = async (newConfig: any) => {
    try {
      const resp = await settingsApi.saveTradingConfig(user!.uid, newConfig);
      if (resp?.data?.success) {
        setTradingConfig(resp.data.config); // immediate UI reflect
        showToast('Trading settings saved', 'success');
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast('Failed to save trading settings', 'error');
      console.error(err);
    }
  };
  
  const handleProviderKeyChange = async (providerName: string, keyName: string, apiKey: string, _uid?: string, _setProviders?: (providers: any) => void) => {
    if (!user) {
      showToast('Authentication required', 'error');
      return;
    }
    setSavingProvider(providerName);
    try {
      const providerId = PROVIDER_ID_MAP[providerName] || providerName.toLowerCase().replace(/\s+/g, '');
      const providerType = PROVIDER_TYPE_MAP[providerId] || 'marketData';
      const maskedApiKeyLength = apiKey ? apiKey.length : 0;

      console.log('[SETTINGS] Saving provider via /users/:uid/provider-config', { providerId, providerType, maskedApiKeyLength });

      // Build payload for backend provider-config endpoint (integrations collection)
      const payload = {
        providerConfig: {
          [providerId]: {
            providerName: providerId,
            apiKey,
            enabled: true,
            type: providerType
          }
        }
      };

      const resp = await settingsApi.saveProviderConfig(user.uid, payload);
      console.log('[PROVIDER-SAVE] response', resp?.providerConfig || resp);

      // Update local provider caches
      setProviders(prev => ({
        ...prev,
        [providerId]: {
          ...(prev?.[providerId] || {}),
          providerName: providerId,
          apiKey,
          enabled: !!apiKey,
          type: providerType
        }
      }));
      setApiKeys(prev => ({
        ...prev,
        [providerId]: {
          apiKey,
          saved: !!apiKey,
          enabled: !!apiKey,
          type: providerType
        }
      }));

      // Refresh local provider state from backend to reflect latest saved values
      await loadProviderConfig(user.uid);
      showToast(`${providerName} API key saved!`, 'success');
    } catch (err: any) {
      console.error('[PROVIDER-SAVE] error', err?.response?.data || err);
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || `Failed to save ${providerName} key`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleProviderKeyChangeBridge = useCallback(async (providerId: string, data: { apiKey: string; enabled: boolean; }) => {
    const providerName = Object.entries(PROVIDER_ID_MAP).find(([, id]) => id === providerId)?.[0] || providerId;
    await handleProviderKeyChange(providerName, 'apiKey', data.apiKey);
  }, [handleProviderKeyChange]);

  const testProviderConnection = async (providerName: string, apiKey: string, keyName: string) => {
    const providerId = PROVIDER_ID_MAP[providerName] || providerName.toLowerCase().replace(/\s+/g, '');
    const providerType: 'marketData' | 'news' | 'metadata' = PROVIDER_TYPE_MAP[providerId] || 'marketData';
    setSavingProvider(providerName);
    try {
      const response = await settingsApi.providers.test({
        providerName,
        type: providerType,
        apiKey
      });

      setProviderTestResults(prev => ({
        ...prev,
        [providerId]: {
          status: response.data?.success ? 'success' : 'error',
          message: response.data?.message || (response.data?.success ? 'Connection successful.' : 'Invalid key or connection failed.')
        }
      }));
      showToast(`${providerName} test completed.`, response.data?.success ? 'success' : 'error');

      // If test successful for a primary provider, ensure the key is saved/updated in state
      if (response.data?.success && keyName) {
        setApiKeys(prev => ({
          ...prev,
          [providerId]: {
            ...(prev?.[providerId] || {}),
            apiKey,
            saved: !!apiKey,
            enabled: !!apiKey,
            type: providerType
          }
        }));
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      setProviderTestResults(prev => ({
        ...prev,
        [providerId]: {
          status: 'error',
          message: err.response?.data?.error || 'Connection failed due to network error.'
        }
      }));
      showToast(`Failed to test ${providerName} connection.`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  const handleToggleProviderEnabled = (providerName: string, enabledKey: string, isEnabled: boolean) => {
    setSettings((prev: any) => ({ ...prev, [enabledKey]: isEnabled }));
    // Automatically save the setting change
    handleSaveGeneralSettings().catch(err => {
      console.error(`Failed to save provider toggle for ${providerName}`, err);
    });
  };

  

  // Exchange Handlers
  const handleExchangeSelect = (exchangeId: string) => {
    setSelectedExchange(exchangeId);
    // Reset form for new selection
    setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
  };

  const handleExchangeFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setExchangeForm({ ...exchangeForm, [e.target.name]: e.target.value });
  };

  const handleSaveExchange = async () => {
    if (!selectedExchange || !user) return;
    setSavingExchange(true);
    try {
      const exchangeData = EXCHANGES.find(e => e.id === selectedExchange);
      if (!exchangeData) throw new Error('Invalid exchange selected');

      // Validation: Check required fields for the selected exchange
      if (exchangeData.fields.includes('apiKey') && !exchangeForm.apiKey) {
        showToast('API Key is required.', 'error');
        return;
      }
      if (exchangeData.fields.includes('secretKey') && !exchangeForm.secretKey) {
        showToast('Secret Key is required.', 'error');
        return;
      }
      if (exchangeData.fields.includes('passphrase') && !exchangeForm.passphrase) {
        showToast('Passphrase is required for this exchange.', 'error');
        return;
      }

      // Backend expects a flat payload; keep it deterministic for immediate UI updates
      const exchangeConfigPayload = {
        exchange: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secret: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase || undefined,
        testnet: true,
      };

      await settingsApi.saveExchangeConfig(user.uid, exchangeConfigPayload);

      // Optimistically reflect the connection while the reload fetches the authoritative value
      setExchangeConfig({
        exchange: selectedExchange,
        apiKey: '[ENCRYPTED]',
        lastUpdated: new Date().toISOString(),
      });

      // Refresh exchangeConfig state
      await loadExchangeConfig(user.uid);

      showToast(`${exchangeData.name} credentials saved successfully!`, 'success');
      setExchangeForm({ apiKey: '', secretKey: '', passphrase: '' });
      setSelectedExchange('');
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || 'Failed to save exchange credentials', 'error');
    } finally {
      setSavingExchange(false);
    }
  };

  const handleTestExchange = async () => {
    if (!selectedExchange) return;
    setSavingExchange(true);
    try {
      // Call GET /api/exchange/test?exchange=X
      const response = await exchangeService.testExchangeConnection(selectedExchange);

      // Backend returns: { balance: { USDT: number, BTC: number, ... } }
      if (response.data?.balance) {
        const balance = response.data.balance;
        const balanceMessage = Object.entries(balance)
          .map(([currency, amount]) => `${currency}: ${amount}`)
          .join(', ');

        setExchangeTestResult({
          status: 'success',
          message: `Connection successful. Balance: ${balanceMessage}`
        });
      } else {
        setExchangeTestResult({
          status: 'error',
          message: 'Test completed but no balance data received.'
        });
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      setExchangeTestResult({
        status: 'error',
        message: err.response?.data?.error || 'Connection test failed due to network error.'
      });
    } finally {
      setSavingExchange(false);
    }
  };

  const handleDisconnectExchange = async () => {
    if (!user) return;
    try {
      // Explicitly clear exchange config so downstream checks see it as disconnected
      const exchangeConfigPayload = {
        exchange: null,
        apiKey: '',
        secret: '',
        passphrase: '',
        testnet: false,
      };

      await settingsApi.saveExchangeConfig(user.uid, exchangeConfigPayload);

      // Refresh exchangeConfig state
      await loadExchangeConfig(user.uid);

      setExchangeTestResult(undefined);
      showToast('Exchange disconnected successfully.', 'success');
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || 'Failed to disconnect exchange', 'error');
    }
  };

  const handleToggleTradeConfirmation = async (isChecked: boolean) => {
    // Check if Auto Trade Mode is enabled first
    if (isChecked && !settings.enableAutoTrade) {
      setShowTradeConfirmationModal(true);
      return; // Do not enable toggle
    }

    // If enabling or disabling is allowed, proceed
    setSettings((prev: any) => ({ ...prev, tradeConfirmationRequired: isChecked }));
    try {
      await settingsApi.general.save({ tradeConfirmationRequired: isChecked });
      showToast('Trade confirmation setting saved.', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save setting', 'error');
    }
  };

  const handleTradeConfirmationModalClose = () => {
    setShowTradeConfirmationModal(false);
    // Reset toggle state since modal was closed without enabling auto trade
    setSettings((prev: any) => ({ ...prev, tradeConfirmationRequired: false }));
  };

  const handleGoToAutoTradeSettings = () => {
    setShowTradeConfirmationModal(false);
    setSettings((prev: any) => ({ ...prev, tradeConfirmationRequired: false }));
    // Scroll to auto trade section (could be enhanced with actual navigation)
    const autoTradeSection = document.querySelector('[data-section="auto-trade"]');
    if (autoTradeSection) {
      autoTradeSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleSoundSelectorSave = (preferences: any) => {
    setSettings((prev: any) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        playSound: true,
        soundPreferences: preferences
      }
    }));
  };

  const handleSoundSelectorClose = () => {
    setShowSoundSelectorModal(false);
  };

  const handleToggleAutoTrade = async (isChecked: boolean) => {
    if (isChecked) {
      // Check prerequisites before allowing the toggle
      try {
        const response = await settingsApi.notifications.checkPrereq();
        setNotificationPrereqs(response.data);
        if (response.data && response.data.ready) {
          setSettings((prev: any) => ({ ...prev, enableAutoTrade: isChecked }));
          await settingsApi.general.save({ enableAutoTrade: isChecked });
          showToast('Auto-Trade enabled!', 'success');
        } else {
          setShowAutoTradeModal(true);
          // Revert toggle state in UI temporarily
          // The actual save will happen once prerequisites are met or user closes modal
          // For now, don't update settings in state if prerequisites are not met
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          handleLogout();
          return;
        }
        showToast(err.response?.data?.error || 'Failed to check Auto-Trade prerequisites', 'error');
        // Revert toggle state in UI temporarily
      }
    } else {
      // Disable immediately
      setSettings((prev: any) => ({ ...prev, enableAutoTrade: isChecked }));
      try {
        await settingsApi.general.save({ enableAutoTrade: isChecked });
        showToast('Auto-Trade disabled.', 'success');
      } catch (err: any) {
        if (err.response?.status === 401) {
          handleLogout();
          return;
        }
        showToast(err.response?.data?.error || 'Failed to disable Auto-Trade', 'error');
      }
    }
  };

  const handleAutoTradeModalClose = () => {
    setShowAutoTradeModal(false);
    // Reset toggle state if modal is closed without enabling
    setSettings((prev: any) => ({ ...prev, enableAutoTrade: false }));
  };

  const testNotification = async () => {
    try {
      await settingsApi.notifications.checkPrereq();
      showToast('Test notification sent successfully!', 'success');
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || 'Failed to send test notification', 'error');
    }
  };

  // Compute readiness after all hooks are defined
  const isAuthenticated = !!user;
  const isAuthLoading = authLoading;
  
  // Always render content like Research page - no global loading states

  if (error) {
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex items-center justify-center">
            <ErrorState
              error={error}
              message="Failed to load critical settings."
              onRetry={handleRetry}
            />
          </div>
        </main>
      </div>
    );
  }
  
  // Compute Readiness
  const isReady = isAuthenticated && !isAuthLoading;

  if (!isReady) {
    // Should be caught by the useEffect above, but serves as a final guard
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex items-center justify-center">
            <div className="text-center">
              <LoadingState message="Authenticating..." />
              <p className="text-gray-500 mt-4 text-sm">Redirecting to login if authentication fails.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  try {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
          <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
              <h1 className="text-4xl font-extrabold text-white mb-10 border-b border-purple-500/30 pb-3">
                Trading Engine Settings
              </h1>

              <SettingsGeneralSection
                settings={settings}
                setSettings={setSettings}
                savingSettings={savingSettings}
                handleToggleTradeConfirmation={handleToggleTradeConfirmation}
                handleSaveGeneralSettings={handleSaveGeneralSettings}
                handleNotificationToggle={handleNotificationToggle}
              />

              <SettingsApiProvidersSection
                settings={settings}
                setSettings={setSettings}
                showProviderDetails={showProviderDetails}
                setShowProviderDetails={setShowProviderDetails}
                savingProvider={savingProvider}
                providerTestResults={providerTestResults}
                testProviderConnection={testProviderConnection}
                apiKeys={apiKeys}
                handleProviderKeyChange={handleProviderKeyChangeBridge}
                handleToggleProviderEnabled={handleToggleProviderEnabled}
              />

              <SettingsExchangeSection
                exchangeConfig={exchangeConfig}
                selectedExchange={selectedExchange}
                handleExchangeSelect={handleExchangeSelect}
                exchangeForm={exchangeForm}
                handleExchangeFormChange={handleExchangeFormChange}
                exchangeTestResult={exchangeTestResult}
                handleTestExchange={handleTestExchange}
                handleSaveExchange={handleSaveExchange}
                handleDisconnectExchange={handleDisconnectExchange}
                savingExchange={savingExchange}
              />

              {/* Background Research Wizard */}
              <section id="background-research" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  🧠 Background Research & Alerts
                </h2>
                <BackgroundResearchWizard handleLogout={handleLogout} />
              </section>

              <SettingsModals
                showAutoTradeModal={showAutoTradeModal}
                showTradeConfirmationModal={showTradeConfirmationModal}
                showSoundSelectorModal={showSoundSelectorModal}
                notificationPrereqs={notificationPrereqs}
                currentSoundPreferences={settings.notifications?.soundPreferences || {}}
                handleAutoTradeModalClose={handleAutoTradeModalClose}
                handleTradeConfirmationModalClose={handleTradeConfirmationModalClose}
                handleGoToAutoTradeSettings={handleGoToAutoTradeSettings}
                handleSoundSelectorSave={handleSoundSelectorSave}
                handleSoundSelectorClose={handleSoundSelectorClose}
              />

              {/* Toast Notification */}
              {toast && (
                <Toast
                  message={toast.message}
                  type={toast.type === 'warning' ? 'error' : toast.type}
                />
              )}

            </div>
          </main>

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
          <h2 className="text-xl font-bold text-white mb-2">A Critical UI Error Occurred</h2>
          <p className="text-gray-400">The application failed to render the settings page correctly. Please try refreshing or logging in again.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-3 bg-purple-500/80 text-white font-semibold rounded-xl hover:bg-purple-600/90 transition-all duration-300"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}

export default Settings;
