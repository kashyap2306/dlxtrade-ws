import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { settingsApi, providerApi, exchangeService, adminApi } from '../services/api';
import Toast from '../components/Toast';
import { API_NAME_MAP } from "../constants/providers";
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [integrationsLoading, setIntegrationsLoading] = useState(false); 
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
  const [exchangeConfig, setExchangeConfig] = useState<any>(null);

  // Initial Settings State (from snippet 11 - defined before callbacks)
  const [settings, setSettings] = useState<any>({
    maxPositionPerTrade: 10, tradeType: 'scalping', accuracyThreshold: 85, maxDailyLoss: 5, maxTradesPerDay: 50,
    // Primary Providers
    coinGeckoKey: '', newsDataKey: '', cryptoCompareKey: '',
    // Market Data Backup Providers
    coinPaprikaKey: '', coinPaprikaEnabled: false, coinMarketCapKey: '', coinMarketCapEnabled: false,
    coinLoreKey: '', coinLoreEnabled: false, coinApiKey: '', coinApiEnabled: false,
    braveNewCoinKey: '', braveNewCoinEnabled: false, messariKey: '', messariEnabled: false,
    kaikoKey: '', kaikoEnabled: false, liveCoinWatchKey: '', liveCoinWatchEnabled: false,
    coinStatsKey: '', coinStatsEnabled: false, coinCheckupKey: '', coinCheckupEnabled: false,
    // News Backup Providers
    cryptoPanicKey: '', cryptoPanicEnabled: false, redditKey: '', redditEnabled: false,
    cointelegraphKey: '', cointelegraphEnabled: false, altcoinBuzzKey: '', altcoinBuzzEnabled: false,
    gnewsKey: '', gnewsEnabled: false, marketauxKey: '', marketauxEnabled: false,
    webzKey: '', webzEnabled: false, coinStatsNewsKey: '', coinStatsNewsEnabled: false,
    newsCatcherKey: '', newsCatcherEnabled: false, cryptoCompareNewsKey: '', cryptoCompareNewsEnabled: false,
    // Metadata Backup Providers
    coinCapKey: '', coinCapEnabled: false, coinRankingKey: '', coinRankingEnabled: false,
    nomicsKey: '', nomicsEnabled: false, enableAutoTrade: false, exchanges: [], showUnmaskedKeys: false,
    enableAutoTradeAlerts: false, enablePositionAlerts: false, enableWhaleAlerts: false,
    tradeConfirmationRequired: false, notificationSounds: false, notificationVibration: false
  });
  const [integrations, setIntegrations] = useState<any>({});
  
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
  
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
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
  

  const loadConnectedExchange = useCallback(async () => {
      console.log('[LOAD] Starting loadConnectedExchange...');
      try {
          // Load exchange connection status
          if (!exchangeService || typeof exchangeService.loadConnected !== 'function') {
              console.error('[LOAD] exchangeService.loadConnected is not available');
              setToast({ message: 'Exchange connection check unavailable', type: 'error' });
              setConnectedExchange(null);
              return;
          }

          console.log('[LOAD] Calling exchangeService.loadConnected()...');
          const response = await exchangeService.loadConnected();
          console.log('[LOAD] exchangeService.loadConnected() success:', response.data);

          // Set connected exchange from the response
          if (response.data.connected && response.data.exchanges && response.data.exchanges.length > 0) {
              const primaryExchange = response.data.exchanges[0]; // Take first connected exchange
              setConnectedExchange({
                  exchangeId: primaryExchange.exchange,
                  name: primaryExchange.exchange.charAt(0).toUpperCase() + primaryExchange.exchange.slice(1),
                  apiKey: 'configured' // Masked for security
              });
          } else {
              setConnectedExchange(null);
          }

          console.log('[LOAD] loadConnectedExchange completed successfully');
      } catch (err) {
          console.error('[LOAD] Failed to load connected exchange:', err);
          console.error('[LOAD] Error details:', {
              message: err.message,
              status: err.response?.status,
              data: err.response?.data
          });
          setConnectedExchange(null);
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

  // REQ 5: Fix loadIntegrations() wrong merging
  const loadIntegrations = useCallback(async () => {
    // Prevent multiple simultaneous calls
    if (integrationsLoading) return;
    setIntegrationsLoading(true);
    try {
      const response = await settingsApi.providers.load();
      // Robust check
      if (!response || response.status === 401) {
        if (response?.status === 401) {
          console.warn('[Integrations] 401 Unauthorized');
          handleLogout();
        }
        setIntegrations({});
        return;
      }
      // REQ 8: Ensure loader returns plain JSON data
      const integrationsData = response.data || {};
      setIntegrations(integrationsData);

      // REQ 5: Do NOT merge arbitrary backend objects into settings. Map keys explicitly.
      setSettings((prev: any) => {
        const newSettings = { ...prev };
        
        // Keys to map are all keys ending in Key or Enabled from the initial state
        const keysToMap = Object.keys(prev).filter(key => 
          key.endsWith('Key') || key.endsWith('Enabled')
        );
        
        keysToMap.forEach(key => {
            if (integrationsData.hasOwnProperty(key)) {
                // Safely update with backend data, falling back to previous value if backend value is null/undefined
                newSettings[key] = integrationsData[key] ?? newSettings[key];
            }
        });
        
        return newSettings;
      });
    } catch (err: any) {
      console.warn('Load integrations failed:', err);
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
  }, [handleLogout]);


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

    // Auth is ready and user exists — now load settings
    const loadAll = async () => {
      try {
        await loadSettings();

        // Load new backend configs
        const uid = user.uid;
        Promise.allSettled([
          settingsApi.loadTradingConfig(uid).then(r => setTradingConfig(r.data.config || defaultTradingConfig)),
          settingsApi.loadProviderConfig(uid).then(r => setProviders(r.data.config || {})),
          settingsApi.loadExchangeConfig(uid).then(r => setExchangeConfig(r.data || {})),
        ]).then(() => console.log('[SETTINGS] loaded configs'));

        // add other loads the same guarded way
      } catch (err) {
        console.warn('[LOAD] Failed to load user settings (guarded):', err);
      }
    };

    loadAll();

    return () => {
      isMountedRef.current = false;
    };
    // deliberately include authLoading and user in deps to re-run when auth is ready
  }, [authLoading, user]);
  
  // Handlers (rest of existing handlers like handleSaveGeneralSettings, handleProviderKeyChange, etc.)

  const handleSaveGeneralSettings = async () => {
    setSavingSettings(true);
    try {
      await settingsApi.update(settings);
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


  const handleSaveTradingConfig = async (newConfig: any) => {
    try {
      const resp = await settingsApi.saveTradingConfig(user!.uid, newConfig);
      if (resp?.data?.ok) {
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
  
  const handleProviderKeyChange = async (providerName: string, keyName: string, apiKey: string) => {
    setSavingProvider(providerName);
    try {
      // Determine provider type and if it's primary
      let providerType: 'marketData' | 'news' | 'metadata' = 'marketData';
      let isPrimary = false;

      // Check if it's a primary provider
      if (['CoinGecko', 'NewsData.io', 'CryptoCompare'].includes(providerName)) {
        isPrimary = true;
        if (providerName === 'CoinGecko') providerType = 'metadata';
        else if (providerName === 'NewsData.io') providerType = 'news';
        else if (providerName === 'CryptoCompare') providerType = 'metadata';
      } else {
        // Determine type from provider name
        if (['CoinPaprika', 'CoinMarketCap', 'CoinLore', 'CoinAPI', 'BraveNewCoin', 'Messari', 'Kaiko', 'LiveCoinWatch', 'CoinStats', 'CoinCheckup'].includes(providerName)) {
          providerType = 'marketData';
        } else if (['CryptoPanic', 'Reddit', 'Cointelegraph RSS', 'AltcoinBuzz RSS', 'GNews', 'Marketaux', 'Webz.io', 'CoinStatsNews', 'NewsCatcher', 'CryptoCompare News'].includes(providerName)) {
          providerType = 'news';
        } else if (['CoinCap', 'CoinRanking', 'Nomics'].includes(providerName)) {
          providerType = 'metadata';
        }
      }

      await settingsApi.providers.save(user!.uid, {
        providerId: providerName.toLowerCase().replace(/\s+/g, ''),
        providerType,
        isPrimary,
        enabled: true,
        apiKey
      });

      setSettings({ ...settings, [keyName]: apiKey });
      showToast(`${providerName} API key saved!`, 'success');
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      showToast(err.response?.data?.error || `Failed to save ${providerName} key`, 'error');
    } finally {
      setSavingProvider(null);
    }
  };

  const testProviderConnection = async (providerName: string, apiKey: string, keyName: string) => {
    setSavingProvider(providerName);
    try {
      // Determine provider type
      let providerType: 'marketData' | 'news' | 'metadata' = 'marketData';

      if (['CoinPaprika', 'CoinMarketCap', 'CoinLore', 'CoinAPI', 'BraveNewCoin', 'Messari', 'Kaiko', 'LiveCoinWatch', 'CoinStats', 'CoinCheckup'].includes(providerName)) {
        providerType = 'marketData';
      } else if (['CryptoPanic', 'Reddit', 'Cointelegraph RSS', 'AltcoinBuzz RSS', 'GNews', 'Marketaux', 'Webz.io', 'CoinStatsNews', 'NewsCatcher', 'CryptoCompare News'].includes(providerName)) {
        providerType = 'news';
      } else if (['CoinCap', 'CoinRanking', 'Nomics', 'CoinGecko', 'CryptoCompare'].includes(providerName)) {
        providerType = 'metadata';
      }

      const response = await settingsApi.providers.test({
        providerName,
        type: providerType,
        apiKey
      });

      setProviderTestResults(prev => ({
        ...prev,
        [providerName]: {
          status: response.data?.success ? 'success' : 'error',
          message: response.data?.message || (response.data?.success ? 'Connection successful.' : 'Invalid key or connection failed.')
        }
      }));
      showToast(`${providerName} test completed.`, response.data?.success ? 'success' : 'error');

      // If test successful for a primary provider, ensure the key is saved/updated in state
      if (response.data?.success && keyName) {
        setSettings(prev => ({ ...prev, [keyName]: apiKey }));
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        handleLogout();
        return;
      }
      setProviderTestResults(prev => ({
        ...prev,
        [providerName]: {
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
    if (!selectedExchange) return;
    setSavingExchange(true);
    try {
      const exchangeData = EXCHANGES.find(e => e.id === selectedExchange);
      if (!exchangeData) throw new Error('Invalid exchange selected');

      // Simple validation check (API Key and Secret Key must be present)
      if (exchangeData.fields.includes('apiKey') && !exchangeForm.apiKey) {
        showToast('API Key is required.', 'error');
        return;
      }
      if (exchangeData.fields.includes('secretKey') && !exchangeForm.secretKey) {
        showToast('Secret Key is required.', 'error');
        return;
      }

      await exchangeService.saveConfig({
        exchange: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secret: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase,
      });

      // Update connected exchange state
      setConnectedExchange({ 
        exchangeId: selectedExchange, 
        name: exchangeData.name, 
        apiKey: exchangeForm.apiKey 
      });

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
      const response = await exchangeService.testConnection({
        exchange: selectedExchange,
        apiKey: exchangeForm.apiKey,
        secret: exchangeForm.secretKey,
        passphrase: exchangeForm.passphrase,
      });
      
      setExchangeTestResult({ 
        status: response.data?.valid ? 'success' : 'error', 
        message: response.data?.message || (response.data?.valid ? 'Test successful.' : 'Test failed.') 
      });
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
    try {
      const exchangeToDisconnect = connectedExchange?.exchangeId || selectedExchange;
      await exchangeService.disconnect(exchangeToDisconnect);
      setConnectedExchange(null);
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
    setSettings((prev: any) => ({ ...prev, tradeConfirmationRequired: isChecked }));
    try {
      await settingsApi.update({ tradeConfirmationRequired: isChecked });
      showToast('Trade confirmation setting saved.', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to save setting', 'error');
    }
  };

  const handleToggleAutoTrade = async (isChecked: boolean) => {
    if (isChecked) {
      // Check prerequisites before allowing the toggle
      try {
        const response = await settingsApi.notifications.checkPrereq();
        setNotificationPrereqs(response.data);
        if (response.data && response.data.ready) {
          setSettings((prev: any) => ({ ...prev, enableAutoTrade: isChecked }));
          await settingsApi.update({ enableAutoTrade: isChecked });
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
        await settingsApi.update({ enableAutoTrade: isChecked });
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
              />

              <SettingsApiProvidersSection
                settings={settings}
                setSettings={setSettings}
                showProviderDetails={showProviderDetails}
                setShowProviderDetails={setShowProviderDetails}
                savingProvider={savingProvider}
                providerTestResults={providerTestResults}
                testProviderConnection={testProviderConnection}
                handleProviderKeyChange={(providerName, keyName, value, uid, setProviders) => {
                  if (!user) return;
                  const providerBody = {
                    [providerName.toLowerCase().replace(/\s+/g, '')]: {
                      apiKey: value,
                      enabled: true
                    }
                  };
                  settingsApi.saveProviderConfig(user.uid, providerBody).then(() => {
                    setProviders(prev => ({ ...prev, [providerName]: providerBody }));
                    setToast({ message: `${providerName} API key saved!`, type: 'success' });
                  }).catch(err => {
                    console.error(err);
                    setToast({ message: `Failed to save ${providerName} key`, type: 'error' });
                  });
                }}
                handleToggleProviderEnabled={handleToggleProviderEnabled}
              />

              <SettingsExchangeSection
                connectedExchange={connectedExchange}
                selectedExchange={selectedExchange}
                handleExchangeSelect={handleExchangeSelect}
                exchangeForm={exchangeForm}
                handleExchangeFormChange={handleExchangeFormChange}
                exchangeTestResult={exchangeTestResult}
                handleTestExchange={handleTestExchange}
                handleSaveExchange={handleSaveExchange}
                handleDisconnectExchange={handleDisconnectExchange}
                savingExchange={savingExchange}
                settings={settings}
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
                notificationPrereqs={notificationPrereqs}
                handleAutoTradeModalClose={handleAutoTradeModalClose}
              />

              {/* Toast Notification */}
              {toast && <Toast message={toast.message} type={toast.type} />}

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
