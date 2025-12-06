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
import { SettingsGeneralSection } from './SettingsGeneralSection';
import { SettingsPositionSizingSection } from './SettingsPositionSizingSection';
import { SettingsApiProvidersSection } from './SettingsApiProvidersSection';
import { SettingsExchangeSection } from './SettingsExchangeSection';
import { BackgroundResearchWizard } from './BackgroundResearchWizard';
import { SettingsModals } from './SettingsModals';

// Main Settings Component 
const Settings = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, handleLogout: authHandleLogout } = useAuth();
  
  // REQ 6: All React hooks (useState, useEffect, useCallback) MUST be declared before any conditional returns.
  // State variables and refs
  const [loadingAll, setLoadingAll] = useState(true);
  const [error, setError] = useState<any>(null);
  const [retryCount, setRetryCount] = useState(0);
  const isMountedRef = useRef(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const isLoadingTopCoinsRef = useRef(false); 
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
  const [top100Coins, setTop100Coins] = useState<string[]>([]);
  const [coinSearch, setCoinSearch] = useState('');
  const [showCoinDropdown, setShowCoinDropdown] = useState(false);
  const [tradingSettings, setTradingSettings] = useState({
    manualCoins: [] as string[],
    positionSizingMap: [] as { min: number; max: number; percent: number }[],
    maxPositionPerTrade: 10,
  });
  const [notificationSettings, setNotificationSettings] = useState<any>({});
  const [showAutoTradeModal, setShowAutoTradeModal] = useState(false);
  const [notificationPrereqs, setNotificationPrereqs] = useState<any>(null);
  const [showAccuracyModal, setShowAccuracyModal] = useState(false);
  const [accuracyThresholdInput, setAccuracyThresholdInput] = useState('80');
  const [telegramForAccuracy, setTelegramForAccuracy] = useState(false);
  const [sampleAccuracy, setSampleAccuracy] = useState(70);

  // Initial Settings State (from snippet 11 - defined before callbacks)
  const [settings, setSettings] = useState<any>({
    maxPositionPercent: 10, tradeType: 'scalping', accuracyThreshold: 85, maxDailyLoss: 5, maxTradesPerDay: 50,
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
      // Placeholder implementation for REQ 7
      try {
          const response = await exchangeApi.loadConnected();
          setConnectedExchange(response.data.exchange || null);
          setTradingSettings(prev => ({
              ...prev,
              manualCoins: response.data.manualCoins || [],
              positionSizingMap: response.data.positionSizingMap || [],
              maxPositionPerTrade: response.data.maxPositionPerTrade || 10,
          }));
      } catch (err) {
          console.warn('Failed to load connected exchange', err);
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

  const loadTop100Coins = useCallback(async () => {
    if (isLoadingTopCoinsRef.current) return;
    isLoadingTopCoinsRef.current = true;
    try {
      const response = await adminApi.getMarketData();

      // adminApi.getMarketData() returns axios response with data array
      if (response?.data && Array.isArray(response.data)) {
        const coins = response.data.map((coin: any) => coin.symbol || coin);
        setTop100Coins(coins);
      } else {
        // On any error or slow response, fallback to default list
        setTop100Coins(['BTCUSDT','ETHUSDT','BNBUSDT','ADAUSDT','SOLUSDT']);
      }
    } catch (err) {
      // Never throw errors to React - fallback silently
      setTop100Coins(['BTCUSDT','ETHUSDT','BNBUSDT','ADAUSDT','SOLUSDT']);
    } finally {
      if (isMountedRef.current) {
        isLoadingTopCoinsRef.current = false;
      }
    }
  }, []);


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
      const response = await integrationsApi.load();
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
    
    // REQ 3: Ensure no request runs without a token (prevent undefined-token race conditions).
    if (authLoading) return; // Wait for auth state to be loaded
    if (!user) {
      handleLogout(); // Redirect if auth finishes and user is null (401 fix)
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoadingAll(true);
        const loadPromises = [
          // REQ 7: Only load critical data: user settings, integrations, notifications.
          // REQ 7: Wrap loadSettings in catch to prevent blocking on failure
          loadSettings().catch(err => {
            console.warn('Failed to load user settings (non-critical block):', err);
            return Promise.resolve(); 
          }),
          loadIntegrations().catch(err => { 
            console.warn('Failed to load integrations:', err); 
            return Promise.resolve(); 
          }),
          loadConnectedExchange().catch(err => { 
            console.warn('Failed to load connected exchange:', err); 
            return Promise.resolve(); 
          }),
          loadNotificationSettings().catch(err => { 
            console.warn('Failed to load notification settings:', err); 
            return Promise.resolve(); 
          })
        ];

        // REQ 7: Fire and forget top 100 coins (non-critical) so it doesn't block page load
        loadTop100Coins().catch(err => { console.warn('Failed to load top 100 coins (background):', err); });

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
    
    // Cleanup function
    return () => { isMountedRef.current = false; }; 
  }, [retryCount, authLoading, user, handleLogout, loadNotificationSettings, loadIntegrations, loadConnectedExchange, loadTop100Coins]); // REQ 3: Added authLoading, user, handleLogout to deps.
  
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
  
  const handleProviderKeyChange = async (providerName: string, keyName: string, apiKey: string) => {
    setSavingProvider(providerName);
    try {
      const apiName = API_NAME_MAP[providerName];
      if (!apiName) {
        showToast(`Invalid provider: ${providerName}`, 'error');
        return;
      }
      await integrationsApi.saveKey(apiName, apiKey);
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
      const apiName = API_NAME_MAP[providerName];
      if (!apiName) {
        setProviderTestResults(prev => ({
          ...prev,
          [providerName]: {
            status: 'error',
            message: `Invalid provider: ${providerName}`
          }
        }));
        showToast(`Invalid provider: ${providerName}`, 'error');
        return;
      }
      const response = await integrationsApi.testKey(apiName, apiKey);

      setProviderTestResults(prev => ({
        ...prev,
        [providerName]: {
          status: response.data?.valid ? 'success' : 'error',
          message: response.data?.message || (response.data?.valid ? 'Connection successful.' : 'Invalid key or connection failed.')
        }
      }));
      showToast(`${providerName} test completed.`, response.data?.valid ? 'success' : 'error');

      // If test successful for a primary provider, ensure the key is saved/updated in state
      if (response.data?.valid && keyName) {
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

  const calculatePositionForAccuracy = (accuracy: number): number => {
    if (accuracy < 0 || accuracy > 100) {
      return 0;
    } 
    // DEFENSIVE: Check if positionSizingMap exists and is valid
    if (!tradingSettings.positionSizingMap || !Array.isArray(tradingSettings.positionSizingMap)) {
      return 0;
    }
    const range = tradingSettings.positionSizingMap.find((r: any) => 
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

      await exchangeApi.save({
        exchangeId: selectedExchange,
        ...exchangeForm,
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
      const response = await exchangeApi.testConnection({
        exchangeId: selectedExchange,
        ...exchangeForm,
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
      await exchangeApi.disconnect();
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
        const response = await settingsApi.autoTrade.checkPrerequisites();
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
      await settingsApi.notifications.test();
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
  
  if (loadingAll) {
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex items-center justify-center">
            <div className="text-center"> 
              <LoadingState message="Loading your settings..." />
              <p className="text-gray-500 mt-4 text-sm">Please wait while we fetch your configuration.</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen w-full fixed inset-0 bg-gradient-to-br from-[#0a0f1c] via-[#111727] to-[#000a0f] overflow-y-auto">
        <Sidebar onLogout={handleLogout} />
        <main className="min-h-screen w-full relative z-10 pt-16 lg:pt-0 lg:pl-64">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 flex items-center justify-center">
            <ErrorState 
              message="Failed to load critical settings." 
              details={error.message || 'An unknown error occurred.'}
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
        <Sidebar onLogout={handleLogout} />
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
          <Sidebar onLogout={handleLogout} />
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

              <SettingsPositionSizingSection
                tradingSettings={tradingSettings}
                setTradingSettings={setTradingSettings}
                settings={settings}
                sampleAccuracy={sampleAccuracy}
                setSampleAccuracy={setSampleAccuracy}
                updatePositionSizingMap={updatePositionSizingMap}
                coinSearch={coinSearch}
                setCoinSearch={setCoinSearch}
                showCoinDropdown={showCoinDropdown}
                setShowCoinDropdown={setShowCoinDropdown}
                filteredCoins={filteredCoins}
                addCoinToManual={addCoinToManual}
                removeCoinFromManual={removeCoinFromManual}
                savingSettings={savingSettings}
                handleSaveGeneralSettings={handleSaveGeneralSettings}
                calculatePositionForAccuracy={calculatePositionForAccuracy}
              />

              <SettingsApiProvidersSection
                settings={settings}
                setSettings={setSettings}
                showProviderDetails={showProviderDetails}
                setShowProviderDetails={setShowProviderDetails}
                savingProvider={savingProvider}
                providerTestResults={providerTestResults}
                testProviderConnection={testProviderConnection}
                handleProviderKeyChange={handleProviderKeyChange}
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

            </div>
          </main>

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
