import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { settingsApi, providerApi, exchangeService, adminApi, autoTradeApi } from '../services/api';
import Toast from '../components/Toast';
import { API_NAME_MAP, PROVIDER_CONFIG } from "../constants/providers";
import { EXCHANGES } from "../constants/exchanges";
import { useAuth } from '../hooks/useAuth';
import { useAutoTradeConfig } from '../hooks/useAutoTradeConfig';
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
import AccuracyAlertsActivationModal from '../components/AccuracyAlertsActivationModal';
import WhaleAlertsActivationModal from '../components/WhaleAlertsActivationModal';
import SoundNotificationsSelectorModal from '../components/SoundNotificationsSelectorModal';
import NotificationModal from '../components/NotificationModal';
import { SystemDiagnostics } from '../components/SystemDiagnostics';

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

// Strict provider type mapping - matches backend expectations (using corrected backend IDs as keys, normalized to lowercase)
const PROVIDER_TYPE_MAP: Record<string, string> = {
  // Market Data Providers
  'cryptocompare': 'marketdata',
  'coingecko': 'metadata',
  'coinpaprika': 'marketdata',
  'coinmarketcap': 'marketdata',
  'coinlore': 'marketdata',
  'coinapi': 'marketdata',
  'bravenewcoin': 'marketdata',
  'messari': 'marketdata',
  'kaiko': 'marketdata',
  'livecoinwatch': 'marketdata',
  'coinstats': 'marketdata',
  'coincheckup': 'marketdata',

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
  const { user, loading: authLoading, authReady, handleLogout: authHandleLogout } = useAuth();

  // FRONTEND AUTH UID CONFIRMATION - LOG ONCE
  useEffect(() => {
    if (user?.uid) {
      console.log("[FRONTEND_AUTH_UID]", user.uid);
    }
  }, []); // Empty dependency array = run once on mount

  // SHARED PROVIDER CONFIG - use same source as AutoTrade
  const {
    config,
    providerConfig,
    setProviderConfig,
    configsLoaded,
    loadProviderConfig: reloadProviderConfig,
  } = useAutoTradeConfig(user);

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
  const [notificationSettings, setNotificationSettings] = useState<any>(null); // null = not loaded yet
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Guard: true when both configs loaded
  const [showAutoTradeModal, setShowAutoTradeModal] = useState(false);
  const [showTradeConfirmationModal, setShowTradeConfirmationModal] = useState(false);
  const [showSoundSelectorModal, setShowSoundSelectorModal] = useState(false);
  const [notificationPrereqs, setNotificationPrereqs] = useState<any>(null);
  const [showAccuracyModal, setShowAccuracyModal] = useState(false);
  const [showWhaleAlertsModal, setShowWhaleAlertsModal] = useState(false);
  const [accuracyThresholdInput, setAccuracyThresholdInput] = useState('80');
  const [telegramForAccuracy, setTelegramForAccuracy] = useState(false);
  const [sampleAccuracy, setSampleAccuracy] = useState(70);
  const [backgroundResearchTelegram, setBackgroundResearchTelegram] = useState<{ telegramBotToken?: string; telegramChatId?: string }>({});
  const [showTestResultModal, setShowTestResultModal] = useState(false);
  const [testResultData, setTestResultData] = useState<{ exchangeName: string, userName: string } | null>(null);

  // New state for backend-saved configs
  const defaultTradingConfig = {
    maxPositionPercent: 2,
    maxDailyLossPercent: 3,
    maxTradesPerDay: 5,
    tradeConfirmationRequired: true
  };
  const [tradingConfig, setTradingConfig] = useState<any>(defaultTradingConfig);

  // COMPUTED: Transform shared providerConfig into format expected by SettingsApiProvidersSection (normalized to PascalCase)
  const providers = useMemo(() => {
    // Normalize legacy newsdataio to newsdata before flattening
    const normalizedNews = { ...(providerConfig.news || {}) };
    if (normalizedNews.newsdataio) {
      normalizedNews.newsdata = normalizedNews.newsdataio;
      delete normalizedNews.newsdataio;
    }

    const flatProviders = {
      ...(providerConfig.marketData || {}),
      ...normalizedNews,
      ...(providerConfig.metadata || {})
    };

    return Object.fromEntries(
      Object.entries(flatProviders).map(([pid, data]: any) => [
        pid,
        {
          providerName: pid,
          apiKey: data?.apiKey || '',
          enabled: data?.enabled ?? false,
          type: data?.type || 'marketData',
          saved: data?.enabled ?? false // Backend-enabled means saved
        }
      ])
    );
  }, [providerConfig]);

  const apiKeys = useMemo(() => {
    return Object.fromEntries(
      Object.entries(providers).map(([pid, data]: any) => [
        pid,
        {
          apiKey: data?.apiKey || '',
          saved: data?.saved ?? false,
          enabled: data?.enabled ?? false,
          type: data?.type || 'marketData'
        }
      ])
    );
  }, [providers]);
  const [exchangeConfig, setExchangeConfig] = useState<any>(null);

  // Initial Settings State (from snippet 11 - defined before callbacks)
  // CRITICAL: Do NOT include enableAutoTrade - it's legacy and comes from autoTradeConfig
  const [settings, setSettings] = useState<any>({
    maxPositionPerTrade: undefined,
    accuracyThreshold: 85,
    maxDailyLoss: 7,
    maxTradesPerDay: 30,
    exchanges: [],
    notifications: {
      autoTradeAlerts: false,
      accuracyAlerts: { enabled: false, threshold: 80 },
      whaleAlerts: { enabled: false, sensitivity: 'medium' },
      tradeConfirmationRequired: false,
      soundEnabled: false,
      vibrateEnabled: false,
      telegramEnabled: false
    }
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

  // Load notification settings
  const loadNotificationSettings = useCallback(async () => {
    try {
      const response = await settingsApi.notifications.load();
      const data = response.data || {};

      // CRITICAL: Set explicit defaults if backend returns empty/undefined
      const safeData = {
        autoTradeAlerts: data.autoTradeAlerts ?? false,
        accuracyAlerts: data.accuracyAlerts || { enabled: false, threshold: 80 },
        whaleAlerts: data.whaleAlerts || { enabled: false, sensitivity: 'medium' },
        tradeConfirmationRequired: data.tradeConfirmationRequired ?? false,
        soundEnabled: data.soundEnabled ?? false,
        vibrateEnabled: data.vibrateEnabled ?? false,
        telegramEnabled: data.telegramEnabled ?? false
      };

      setNotificationSettings(safeData);

      // CRITICAL: Sync notificationSettings to settings.notifications immediately
      setSettings((prev: any) => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          autoTradeAlerts: safeData.autoTradeAlerts ?? false,
          accuracyAlerts: safeData.accuracyAlerts || { enabled: false, threshold: 80 },
          whaleAlerts: safeData.whaleAlerts || { enabled: false, sensitivity: 'medium' },
          tradeConfirmationRequired: safeData.tradeConfirmationRequired ?? false,
          soundEnabled: safeData.soundEnabled ?? false,
          vibrateEnabled: safeData.vibrateEnabled ?? false,
          telegramEnabled: safeData.telegramEnabled ?? false
        },
        tradeConfirmationRequired: safeData.tradeConfirmationRequired ?? false
      }));

      // Sync sound preferences to localStorage
      if (data.soundPreferences && Array.isArray(data.soundPreferences)) {
        localStorage.setItem('soundNotificationPreferences', JSON.stringify(data.soundPreferences));
      }
      if (safeData.soundEnabled) {
        localStorage.setItem('notificationSounds', 'true');
      } else {
        localStorage.setItem('notificationSounds', 'false');
      }

      // Sync vibration preference
      localStorage.setItem('notificationVibration', safeData.vibrateEnabled ? 'true' : 'false');
    } catch (err) {
      console.warn('Failed to load notification settings', err);
      // Set safe defaults on error
      setNotificationSettings({
        autoTradeAlerts: false,
        accuracyAlerts: { enabled: false, threshold: 80 },
        whaleAlerts: { enabled: false, sensitivity: 'medium' },
        tradeConfirmationRequired: false,
        soundEnabled: false,
        vibrateEnabled: false,
        telegramEnabled: false
      });
    }
  }, []);

  // Load background research settings for Telegram credentials
  const loadBackgroundResearchTelegram = useCallback(async () => {
    try {
      const response = await settingsApi.backgroundResearch.getSettings();
      const data = response.data;
      if (data?.telegramBotToken && data?.telegramChatId) {
        setBackgroundResearchTelegram({
          telegramBotToken: data.telegramBotToken,
          telegramChatId: data.telegramChatId,
        });
      }
    } catch (err) {
      // Silently fail - not critical
    }
  }, []);

  // Check API prerequisites for Accuracy Alerts
  const checkAccuracyAlertsPrerequisites = useCallback(() => {
    const cryptocompare = providers.cryptocompare || providers.CryptoCompare;
    const newsdata = providers.newsdata || providers.NewsData;

    return {
      cryptocompare: !!(cryptocompare?.enabled && cryptocompare?.apiKey),
      newsdata: !!(newsdata?.enabled && newsdata?.apiKey),
    };
  }, [providers]);

  // Check API prerequisites for Whale Alerts
  const checkWhaleAlertsPrerequisites = useCallback(() => {
    const cryptocompare = providers.cryptocompare || providers.CryptoCompare;
    const newsdata = providers.newsdata || providers.NewsData;

    return {
      cryptocompare: !!(cryptocompare?.enabled && cryptocompare?.apiKey),
      newsdata: !!(newsdata?.enabled && newsdata?.apiKey),
    };
  }, [providers]);



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
      // CRITICAL: Do NOT set enableAutoTrade - it's legacy
      setSettings(prev => ({ ...prev, exchanges: prev.exchanges || [], }));
    }
  };

  // Helper functions for refreshing state
  // Provider config now comes from shared useAutoTradeConfig hook - no need for separate loading

  const loadExchangeConfig = useCallback(async (uid: string) => {
    try {
      const response = await settingsApi.loadExchangeConfig(uid);
      console.log('[LOAD] Exchange config response:', response.data);
      console.log('[LOAD] Exchange encrypted fields:', {
        apiKeyEncrypted: response.data?.apiKeyEncrypted,
        secretKeyEncrypted: response.data?.secretKeyEncrypted,
        passphraseEncrypted: response.data?.passphraseEncrypted
      });
      setExchangeConfig(response.data || {});
    } catch (err) {
      console.warn('[LOAD] Failed to load exchange config:', err);
      setExchangeConfig({});
    }
  }, []);

  // Helper function: Single source of truth for exchange connection state
  const isExchangeConnected = useCallback((config: any) => {
    return config &&
           config.exchange &&
           (config.apiKeyEncrypted || config.apiKey || config.secretKeyEncrypted || config.secret);
  }, []);

  // REQ 3 & 7: Fix token/401 errors and initialization order
  useEffect(() => {
    isMountedRef.current = true;

    // REQ: authReady becomes true, token exists before first API call
    console.log('[Settings] Mount check:', { uid: user?.uid, authLoading, authReady });

    // Wait for auth to finish loading (both authLoading=false and authReady=true)
    if (!authReady || authLoading) {
      console.log('[Settings] Auth not ready yet - delaying data load');
      return;
    }

    // If auth resolved and there is no user, force logout/redirect to avoid 401
    if (!user) {
      console.warn('[Settings] No user after authReady - redirecting');
      handleLogout();
      return;
    }

    console.log('[Settings] ✅ Auth ready and user exists, starting loadAllData');

    // Auth is ready and user exists — load all data
    const loadAllData = async () => {
      try {
        setLoadingAll(true);
        // CRITICAL: Load both configs in parallel, then set loaded flag
        await Promise.all([
          loadSettings(),
          loadNotificationSettings()
        ]);

        // Wait for useAutoTradeConfig to finish internal loading
        let waitCount = 0;
        while (!configsLoaded && waitCount < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitCount++;
        }

        setSettingsLoaded(true);

        // Load other non-critical data
        await loadBackgroundResearchTelegram();
        await loadExchangeConfig(user.uid);
      } catch (error: any) {
        console.error('[Settings] Error loading data:', error);
        setSettingsLoaded(true);
      } finally {
        setLoadingAll(false);
      }
    };

    loadAllData();

    return () => {
      isMountedRef.current = false;
    };
  }, [authReady, authLoading, user, loadExchangeConfig, configsLoaded]);

  // Sync providerConfig enabled states to settings for UI toggles
  useEffect(() => {
    if (!configsLoaded || !providerConfig || !settingsLoaded) return;

    console.log("[SETTINGS_SYNC] Syncing providerConfig states to UI settings...");
    const newEnabledSettings: Record<string, boolean> = {};

    // Flatten providerConfig buckets into a single map for easier lookup (Case-insensitive)
    const flatConfigMap = new Map<string, any>();

    if (providerConfig.marketData) {
      Object.entries(providerConfig.marketData).forEach(([id, p]: any) => flatConfigMap.set(id.toLowerCase(), p));
    }
    if (providerConfig.news) {
      Object.entries(providerConfig.news).forEach(([id, p]: any) => flatConfigMap.set(id.toLowerCase(), p));
    }
    if (providerConfig.metadata) {
      Object.entries(providerConfig.metadata).forEach(([id, p]: any) => flatConfigMap.set(id.toLowerCase(), p));
    }

    // Iterate through PROVIDER_CONFIG to find matching enabledKeys
    Object.values(PROVIDER_CONFIG).forEach((group: any) => {
      group.backups.forEach((backup: any) => {
        if (backup.enabledKey) {
          const providerId = API_NAME_MAP[backup.name] || backup.name.toLowerCase();
          const backendProvider = flatConfigMap.get(providerId.toLowerCase());

          if (backendProvider) {
            newEnabledSettings[backup.enabledKey] = backendProvider.enabled === true;
          }
        }
      });
    });

    if (Object.keys(newEnabledSettings).length > 0) {
      console.log("[SETTINGS_SYNC] Found enabled states to sync:", newEnabledSettings);
      setSettings((prev: any) => ({
        ...prev,
        ...newEnabledSettings
      }));
    }
  }, [configsLoaded, providerConfig, settingsLoaded]);

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
        maxDailyLossPercent: Number(settings.maxDailyLoss || 7),
        maxTradesPerDay: Number(settings.maxTradesPerDay || 30),
        notifications: {
          autoTradeAlerts: Boolean(settings.notifications?.autoTradeAlerts || false),
          accuracyAlerts: Boolean(settings.notifications?.accuracyAlerts || false),
          whaleAlerts: Boolean(settings.notifications?.whaleAlerts || false),
          tradeConfirmationRequired: Boolean(settings.tradeConfirmationRequired || false),
          soundEnabled: Boolean(settings.notifications?.soundEnabled || false),
          vibrateEnabled: Boolean(settings.notifications?.vibrateEnabled || false),
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

  const handleNotificationToggle = async (type: string, checked: boolean) => {
    // IMPORTANT: When disabling, close any open modals IMMEDIATELY
    if (!checked) {
      // Close any modals that might be open
      if (type === 'accuracyAlerts') {
        setShowAccuracyModal(false);
      } else if (type === 'whaleAlerts') {
        setShowWhaleAlertsModal(false);
      } else if (type === 'soundEnabled') {
        setShowSoundSelectorModal(false);
      }

      // Update localStorage for vibration immediately (UX preference)
      if (type === 'vibrateEnabled') {
        localStorage.setItem('notificationVibration', 'false');
      }

      // Save to backend FIRST
      try {
        const updateData: any = {
          ...notificationSettings,
        };

        if (type === 'vibrateEnabled') {
          updateData.vibrateEnabled = false;
        } else if (type === 'accuracyAlerts') {
          updateData.accuracyAlerts = { enabled: false };
        } else if (type === 'whaleAlerts') {
          updateData.whaleAlerts = { enabled: false };
        } else if (type === 'soundEnabled') {
          updateData.soundEnabled = false;
        } else {
          updateData[type] = false;
        }

        await settingsApi.notifications.update(updateData);

        // Update UI ONLY after successful response
        setNotificationSettings(updateData);
        setSettings((prev: any) => ({
          ...prev,
          notifications: {
            ...prev.notifications,
            ...prev.notifications,
            [type]: false,
            // Reset nested objects when disabling
            ...(type === 'accuracyAlerts' && { accuracyAlerts: { enabled: false } }),
            ...(type === 'whaleAlerts' && { whaleAlerts: { enabled: false } }),
          }
        }));

        // Notify other components (NotificationManager)
        window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: updateData }));

        showToast('Notification setting updated', 'success');
      } catch (err: any) {
        showToast(err.response?.data?.error || 'Failed to update setting', 'error');
      }
      return;
    }

    // From here on, we're only handling ENABLING (checked === true)

    // CRITICAL: Special handling for autoTradeAlerts - requires Auto Trade Mode to be enabled
    // Use config.autoTradeEnabled (unified source of truth), not settings.enableAutoTrade
    if (type === 'autoTradeAlerts' && !config?.autoTradeEnabled) {
      setShowAutoTradeModal(true);
      showToast('Auto Trade Mode must be enabled first', 'warning');
      return; // Do not enable toggle
    }

    // Special handling for accuracyAlerts - show activation modal ONLY when enabling
    if (type === 'accuracyAlerts') {
      const prereqs = checkAccuracyAlertsPrerequisites();
      if (!prereqs.cryptocompare || !prereqs.newsdata) {
        showToast('CryptoCompare and NewsData.io must be configured first', 'warning');
        return;
      }
      setShowAccuracyModal(true);
      return; // Modal will handle enabling
    }

    // Special handling for whaleAlerts - show activation modal ONLY when enabling
    if (type === 'whaleAlerts') {
      setShowWhaleAlertsModal(true);
      return; // Modal will handle enabling
    }

    // Special handling for soundEnabled - open sound selector modal ONLY when enabling
    if (type === 'soundEnabled') {
      setShowSoundSelectorModal(true);
      return; // Don't toggle directly, modal will handle it
    }

    // For simple toggles (like vibration when enabling), save first then update UI
    if (type === 'vibrateEnabled') {
      // Save to backend
      try {
        const updateData: any = {
          ...notificationSettings,
          vibrateEnabled: true,
        };

        await settingsApi.notifications.update(updateData);

        // Update UI after success
        localStorage.setItem('notificationVibration', 'true');
        setNotificationSettings(updateData);
        setSettings((prev: any) => ({
          ...prev,
          notifications: {
            ...prev.notifications,
            vibrateEnabled: true
          }
        }));

        // Notify other components
        window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: updateData }));

        showToast('Notification setting updated', 'success');
      } catch (err: any) {
        showToast(err.response?.data?.error || 'Failed to update setting', 'error');
      }
    }
    // Handle autoTradeAlerts enable (simple toggle)
    else if (type === 'autoTradeAlerts') {
      try {
        const updateData: any = {
          ...notificationSettings,
          autoTradeAlerts: true,
        };

        await settingsApi.notifications.update(updateData);

        setNotificationSettings(updateData);
        setSettings((prev: any) => ({
          ...prev,
          notifications: {
            ...prev.notifications,
            autoTradeAlerts: true
          }
        }));

        // Notify other components
        window.dispatchEvent(new CustomEvent('settingsUpdated', { detail: updateData }));

        showToast('Notification setting updated', 'success');
      } catch (err: any) {
        // CRITICAL: Revert toggle state on save failure
        if (type === 'autoTradeAlerts') {
          setSettings((prev: any) => ({
            ...prev,
            notifications: {
              ...prev.notifications,
              autoTradeAlerts: false // Revert to false on error
            }
          }));
        } else if (type === 'vibrateEnabled') {
          setSettings((prev: any) => ({
            ...prev,
            notifications: {
              ...prev.notifications,
              vibrateEnabled: false // Revert to false on error
            }
          }));
        }

        showToast(err.response?.data?.error || 'Failed to update setting', 'error');
      }
    }
  };

  // Handle Accuracy Alerts save
  const handleAccuracyAlertsSave = async (alertSettings: {
    enabled: boolean;
    thresholdRange: '65-80' | '80-90' | '90+';
    telegramEnabled: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
  }) => {
    try {
      // Convert threshold range to min/max values
      const thresholdMap = {
        '65-80': { min: 65, max: 80 },
        '80-90': { min: 80, max: 90 },
        '90+': { min: 90, max: 100 },
      };
      const threshold = thresholdMap[alertSettings.thresholdRange];

      const updateData: any = {
        ...notificationSettings,
        accuracyAlerts: {
          enabled: true,
          thresholdMin: threshold.min,
          thresholdMax: threshold.max,
          telegramEnabled: alertSettings.telegramEnabled,
        },
      };

      // If Telegram is enabled, save credentials (backend will handle encryption)
      if (alertSettings.telegramEnabled && alertSettings.telegramBotToken && alertSettings.telegramChatId) {
        updateData.telegramBotToken = alertSettings.telegramBotToken;
        updateData.telegramChatId = alertSettings.telegramChatId;
        updateData.telegramEnabled = true;
      }

      await settingsApi.notifications.update(updateData);

      // Update local state
      setSettings((prev: any) => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          accuracyAlerts: {
            enabled: true,
            threshold: threshold.max,
            telegramEnabled: alertSettings.telegramEnabled,
          },
        },
      }));

      setNotificationSettings(updateData);
      setShowAccuracyModal(false); // Close modal after successful save
      showToast('Accuracy Alerts enabled successfully!', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to enable Accuracy Alerts', 'error');
      throw err;
    }
  };

  // Handle Whale Alerts enable
  const handleWhaleAlertsEnable = async () => {
    try {
      const updateData = {
        ...notificationSettings,
        whaleAlerts: {
          enabled: true,
          sensitivity: 'medium' as const,
        },
      };

      await settingsApi.notifications.update(updateData);

      setSettings((prev: any) => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          whaleAlerts: {
            enabled: true,
            sensitivity: 'medium',
          },
        },
      }));

      setNotificationSettings(updateData);
      setShowWhaleAlertsModal(false); // Close modal after successful save
      showToast('Whale Alerts enabled successfully!', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to enable Whale Alerts', 'error');
      throw err;
    }
  };

  // Handle Sound Notifications save
  const handleSoundNotificationsSave = async (selectedTypes: string[]) => {
    try {
      // Save to localStorage for quick access
      localStorage.setItem('soundNotificationPreferences', JSON.stringify(selectedTypes));
      localStorage.setItem('notificationSounds', 'true');

      const updateData = {
        ...notificationSettings,
        soundEnabled: true,
        soundPreferences: selectedTypes,
      };

      await settingsApi.notifications.update(updateData);

      setSettings((prev: any) => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          soundEnabled: true,
          soundPreferences: selectedTypes,
        },
      }));

      setNotificationSettings(updateData);
      setShowSoundSelectorModal(false); // Close modal after successful save
      showToast('Sound notification preferences saved!', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save sound preferences', 'error');
      throw err;
    }
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

      // FORCE CORRECT VALUES FOR CRYPTOCOMPARE - Remove providerName comparisons
      let finalProviderId = providerId;
      let finalProviderType = providerType;
      if (finalProviderId === 'cryptocompare') {
        finalProviderId = 'cryptocompare';
        finalProviderType = 'marketData';
        console.log('[CRYPTOCOMPARE_SAVE] Forced correct values:', { finalProviderId, finalProviderType });
      }

      // FORCE CORRECT VALUES FOR NEWSDATA - Normalize any variation to 'newsdata'
      const normalizedProviderId = finalProviderId.toLowerCase();
      if (normalizedProviderId === 'newsdataio' || normalizedProviderId === 'newsdata' || normalizedProviderId === 'newsdata.io') {
        finalProviderId = 'newsdata';
        finalProviderType = 'news';
        console.log('[NEWSDATA_SAVE] Forced correct values:', { finalProviderId, finalProviderType });
      }

      const payload = {
        providerId: finalProviderId,
        providerType: finalProviderType,
        apiKey,
        enabled: true
      };

      // CONSOLE LOG BEFORE SENDING REQUEST
      console.log({
        providerId: finalProviderId,
        providerType: finalProviderType,
        apiKey
      });

      // GUARANTEED LOG BEFORE API CALL FOR CRYPTOCOMPARE AND NEWSDATA
      if (finalProviderId === 'cryptocompare') {
        console.log("🔥 FRONTEND_SAVE_CRYPTOCOMPARE", payload);
      }
      if (finalProviderId === 'newsdata') {
        console.log("🔥 FRONTEND_SAVE_NEWSDATA", payload);
      }

      console.log('[SETTINGS] Saving provider via /users/:uid/provider-config', { providerId: finalProviderId, providerType: finalProviderType, maskedApiKeyLength });
      console.log('[PROVIDER-SAVE] Making API call to saveProviderConfig...');
      const resp = await settingsApi.saveProviderConfig(user.uid, payload);
      console.log('[PROVIDER-SAVE] API response received:', resp?.providerConfig || resp);

      // VERIFY API CALL SUCCESS - ensure response exists
      if (!resp) {
        console.error('[PROVIDER-SAVE] ERROR: No response from API call!');
        throw new Error('No response from save API');
      }

      // SUCCESS: Force reload shared provider config to get authoritative state
      console.log('[PROVIDER-SAVE] Save successful, force reloading shared provider config');

      try {
        await reloadProviderConfig(true); // Force reload
        console.log('[PROVIDER-SAVE] Successfully force reloaded shared provider config');
      } catch (refetchErr) {
        console.warn('[PROVIDER-SAVE] Failed to force reload provider config:', refetchErr);
        // Continue with success - the save worked, just couldn't refresh local state
      }

      console.log("🔥 PROVIDER_CONFIG_UPDATED_AFTER_SAVE", { providerId });

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
    const providerType: string = PROVIDER_TYPE_MAP[providerId] || 'marketdata';
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

      // Test successful - provider config will be updated via shared hook
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

  const handleToggleProviderEnabled = async (providerName: string, enabledKey: string, isEnabled: boolean) => {
    if (!user) {
      showToast('Authentication required', 'error');
      return;
    }

    // CRITICAL: Always send boolean, never undefined
    const enabledValue = isEnabled === true;

    // Update local state
    setSettings((prev: any) => ({ ...prev, [enabledKey]: enabledValue }));

    // Send provider config to backend with enabled flag
    try {
      const providerId = PROVIDER_ID_MAP[providerName] || providerName.toLowerCase().replace(/\s+/g, '');
      const providerType = PROVIDER_TYPE_MAP[providerId] || 'marketData';

      // Get current API key from provider config (if any)
      const currentProvider = providers[providerId];
      const apiKey = currentProvider?.apiKey || '';

      // CRITICAL: Send provider config with enabled flag
      // For News/Metadata providers, ensure type is correct and enabled is always boolean
      const payload = {
        providerId: providerId,
        providerType: providerType, // Will be 'news' for News, 'metadata' for Metadata providers
        apiKey: apiKey, // Keep existing API key if any (empty string for free providers)
        enabled: enabledValue // Always boolean - never undefined
      };

      console.log('[PROVIDER_TOGGLE] Saving provider config:', { ...payload, apiKeyLength: apiKey.length, providerType });
      await settingsApi.saveProviderConfig(user.uid, payload);

      // Reload provider config to get authoritative state
      await reloadProviderConfig(true);

      showToast(`${providerName} ${enabledValue ? 'enabled' : 'disabled'}`, 'success');
    } catch (err: any) {
      console.error('[PROVIDER_TOGGLE] error', err?.response?.data || err);
      // Revert local state on error
      setSettings((prev: any) => ({ ...prev, [enabledKey]: !enabledValue }));
      showToast(err.response?.data?.error || `Failed to ${enabledValue ? 'enable' : 'disable'} ${providerName}`, 'error');
    }
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

      // SUCCESS: Re-fetch exchange config from backend to get authoritative state
      console.log('[EXCHANGE-SAVE] Save successful, re-fetching authoritative exchange config');

      try {
        await loadExchangeConfig(user.uid);
        console.log('[EXCHANGE-SAVE] Successfully re-fetched authoritative exchange config');
      } catch (refetchErr) {
        console.warn('[EXCHANGE-SAVE] Failed to re-fetch exchange config:', refetchErr);
        // Continue with success - the save worked, just couldn't refresh local state
      }

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
      // Build config object for connection test
      const testConfig = {
        exchange: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secret: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase || undefined,
        testnet: true
      };

      // Call POST /api/exchange/test with full config
      const response = await exchangeService.testExchangeConnection(testConfig);

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

        // Show popup modal with connection details
        const exchangeData = EXCHANGES.find(e => e.id === selectedExchange);
        const exchangeName = exchangeData?.name || selectedExchange;
        const userName = user?.displayName || user?.email || user?.uid || 'User';
        setTestResultData({
          exchangeName: exchangeName,
          userName: userName,
        });
        setShowTestResultModal(true);
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

    // Ask for confirmation before disconnecting
    const confirmed = window.confirm(
      'Are you sure you want to disconnect your exchange?\n\n' +
      'Your API credentials will be preserved and you can reconnect anytime without re-entering them.\n\n' +
      'To permanently delete your credentials, please contact support.'
    );

    if (!confirmed) return;

    try {
      // Determine exchange dynamically using existing state
      const resolvedExchange = exchangeConfig?.exchange || connectedExchange?.exchange;

      // Call backend disconnect route (preserves credentials)
      await exchangeService.disconnect(resolvedExchange);

      // Immediately clear state after successful disconnect
      setExchangeConfig(null);
      setConnectedExchange(null);

      setExchangeTestResult(undefined);
      showToast('Exchange disconnected successfully. Your credentials are preserved for easy reconnection.', 'success');
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || 'Failed to disconnect exchange', 'error');
    }
  };

  const handleToggleTradeConfirmation = async (isChecked: boolean) => {
    // CRITICAL: Check config.autoTradeEnabled (unified source of truth) instead of settings.enableAutoTrade
    if (isChecked && !config.autoTradeEnabled) {
      setShowTradeConfirmationModal(true);
      return; // Do not enable toggle
    }

    // If enabling or disabling is allowed, proceed
    setSettings((prev: any) => ({ ...prev, tradeConfirmationRequired: isChecked }));
    try {
      // Save EXCLUSIVELY to settings/current notification settings (centralized)
      await settingsApi.notifications.update({ tradeConfirmationRequired: isChecked });
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
          // Use unified autoTradeApi.toggle() instead of settingsApi
          await autoTradeApi.toggle(true);
          // Config will be updated via useAutoTradeConfig hook polling
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
      // Disable immediately using unified API
      try {
        await autoTradeApi.toggle(false);
        // Config will be updated via useAutoTradeConfig hook polling
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
    // CRITICAL: Do NOT reset enableAutoTrade - it's legacy and not in settings state
    // Toggle state is managed by config.autoTradeEnabled from useAutoTradeConfig
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
        <main className="min-h-screen w-full relative z-10">
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
        <main className="min-h-screen w-full relative z-10">
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
          <main className="min-h-screen w-full relative z-10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
              <h1 className="text-4xl font-extrabold text-white mb-10 border-b border-purple-500/30 pb-3">
                Trading Engine Settings
              </h1>

              {!settingsLoaded || !configsLoaded ? (
                <div className="bg-[#0a0f1a] backdrop-blur-sm border border-blue-500/20 rounded-xl p-6 mb-8">
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
                    <span className="text-blue-200">Loading settings...</span>
                  </div>
                </div>
              ) : (
                <SettingsGeneralSection
                  settings={settings}
                  setSettings={setSettings}
                  savingSettings={savingSettings}
                  autoTradeEnabled={config?.autoTradeEnabled ?? false}
                  handleToggleTradeConfirmation={handleToggleTradeConfirmation}
                  handleSaveGeneralSettings={handleSaveGeneralSettings}
                  handleNotificationToggle={handleNotificationToggle}
                />
              )}

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
                isExchangeConnected={isExchangeConnected}
              />

              {/* Background Research Wizard */}
              <section id="background-research" className="mb-12">
                <h2 className="text-3xl font-bold text-white mb-6 flex items-center gap-3">
                  🧠 Background Research & Alerts
                </h2>
                <BackgroundResearchWizard handleLogout={handleLogout} />
              </section>

              {/* System Diagnostics */}
              <SystemDiagnostics />

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

              {/* Accuracy Alerts Activation Modal */}
              <AccuracyAlertsActivationModal
                isOpen={showAccuracyModal}
                onClose={() => {
                  setShowAccuracyModal(false);
                  // Revert toggle state if user closes without saving
                  if (!notificationSettings?.accuracyAlerts?.enabled) {
                    setSettings((prev: any) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        accuracyAlerts: { enabled: false },
                      },
                    }));
                  }
                }}
                onSave={handleAccuracyAlertsSave}
                existingSettings={notificationSettings?.accuracyAlerts}
                backgroundResearchTelegram={backgroundResearchTelegram}
              />

              {/* Whale Alerts Activation Modal */}
              <WhaleAlertsActivationModal
                isOpen={showWhaleAlertsModal}
                onClose={() => {
                  setShowWhaleAlertsModal(false);
                  // Revert toggle state if user closes without saving
                  if (!notificationSettings?.whaleAlerts?.enabled) {
                    setSettings((prev: any) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        whaleAlerts: { enabled: false },
                      },
                    }));
                  }
                }}
                onEnable={handleWhaleAlertsEnable}
                apiStatus={checkWhaleAlertsPrerequisites()}
              />

              {/* Sound Notifications Selector Modal */}
              <SoundNotificationsSelectorModal
                isOpen={showSoundSelectorModal}
                onClose={() => {
                  setShowSoundSelectorModal(false);
                  // Revert toggle state if user closes without saving
                  if (!notificationSettings?.soundEnabled) {
                    setSettings((prev: any) => ({
                      ...prev,
                      notifications: {
                        ...prev.notifications,
                        playSound: false,
                      },
                    }));
                  }
                }}
                onSave={handleSoundNotificationsSave}
                existingPreferences={notificationSettings?.soundPreferences || settings.notifications?.soundPreferences || []}
              />

              {/* Exchange Test Connection Result Modal */}
              {showTestResultModal && testResultData && (
                <NotificationModal
                  isOpen={showTestResultModal}
                  type="success"
                  title="Connection Successful"
                  message="Connection successful"
                  onClose={() => {
                    setShowTestResultModal(false);
                    setTestResultData(null);
                  }}
                >
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Exchange:</span>
                      <span className="text-white font-medium">{testResultData.exchangeName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">User:</span>
                      <span className="text-white font-medium">{testResultData.userName}</span>
                    </div>
                  </div>
                </NotificationModal>
              )}

              {/* Toast Notification */}
              {toast && (
                <Toast
                  message={toast.message}
                  type={toast.type === 'warning' ? 'error' : toast.type}
                />
              )}

            </div>
          </main>

        </div >
      </ErrorBoundary >
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
