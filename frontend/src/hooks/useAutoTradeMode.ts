import { useState, useEffect, useCallback } from 'react';
import { autoTradeApi, settingsApi, usersApi } from '../services/api';
import { useAuth } from './useAuth';
import { suppressConsoleError } from '../utils/errorHandler';

interface AutoTradeModeState {
  enabled: boolean;
  isApiConnected: boolean;
  allRequiredAPIsConnected: boolean;
  missingAPIs: string[];
  loading: boolean;
  checking: boolean;
}

interface UseAutoTradeModeReturn extends AutoTradeModeState {
  toggle: () => Promise<void>;
  canEnable: boolean;
  refresh: () => Promise<void>;
}

export function useAutoTradeMode(): UseAutoTradeModeReturn {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [isApiConnected, setIsApiConnected] = useState(false);
  const [integrations, setIntegrations] = useState<any>({
    cryptocompare: { enabled: false, apiKey: null },
    newsdata: { enabled: false, apiKey: null },
    coinmarketcap: { enabled: false, apiKey: null },
  });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  const toArray = (obj: any) =>
    Object.entries(obj || {}).map(([providerName, cfg]) => ({ providerName, ...(cfg || {}) }));

  const normalize = (v?: string) => (typeof v === 'string' ? v.toLowerCase().trim() : '');

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      // Auto-trade status not available from current valid endpoints
      // Set defaults and load from settings
      const settingsResponse = await settingsApi.load();
      const exchangeResponse = await usersApi.getExchangeConfig(user.uid);

      const exchangeData = exchangeResponse?.data || {};
      const hasExchange = !!(exchangeData.exchange || exchangeData.providerName);

      setEnabled(settingsResponse.data?.autoTradeEnabled || false);
      setIsApiConnected(hasExchange);
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
      // Set safe defaults
      setEnabled(false);
      setIsApiConnected(false);
    }
  }, [user]);

  const loadIntegrations = useCallback(async () => {
    if (!user) return;
    try {
      const response = await settingsApi.loadProviderConfig(user.uid);
      const payload = response?.data || response || {};
      const map =
        payload?.config?.providerConfig ??
        payload?.providerConfig ??
        payload ??
        {};

      const normalized: Record<string, any> = {};
      Object.entries(map || {}).forEach(([k, v]) => {
        const entry = (v as any) || {};
        const providerName = entry.providerName || k;
        const key = typeof providerName === 'string' ? providerName.toLowerCase().trim() : String(k).toLowerCase().trim();

        const forcedType =
          key.includes('newsdata')
            ? 'news'
            : key.includes('cryptocompare')
              ? 'metadata'
              : (entry.type || '').toLowerCase();

        const apiKeyValue =
          entry.apiKey ||
          entry.apiKeyEncrypted ||
          entry.secretEncrypted ||
          (entry.apiKey === '[ENCRYPTED]' ? '[ENCRYPTED]' : undefined) ||
          '[ENCRYPTED]';

        const enabledValue = entry.enabled === undefined ? true : !!entry.enabled;

        normalized[key] = {
          ...entry,
          providerName: key,
          type: forcedType,
          enabled: enabledValue,
          apiKey: apiKeyValue,
        };
      });

      setIntegrations({
        cryptocompare: normalized['cryptocompare'] || { enabled: false, apiKey: null },
        newsdata: normalized['newsdata'] || { enabled: false, apiKey: null },
        coinmarketcap: normalized['coinmarketcap'] || { enabled: false, apiKey: null },
      });
    } catch (err: any) {
      suppressConsoleError(err, 'loadIntegrations');
      // Set safe defaults
      setIntegrations({
        cryptocompare: { enabled: false, apiKey: null },
        newsdata: { enabled: false, apiKey: null },
        coinmarketcap: { enabled: false, apiKey: null },
      });
    }
  }, [user]);

  const checkRequiredAPIs = useCallback((): { allConnected: boolean; missing: string[] } => {
    const missing: string[] = [];

    if (!integrations.cryptocompare || !integrations.cryptocompare.apiKey || !integrations.cryptocompare.enabled) {
      missing.push('cryptocompare');
    }

    if (!integrations.newsdata || !integrations.newsdata.apiKey || !integrations.newsdata.enabled) {
      missing.push('newsdata');
    }

    if (!integrations.coinmarketcap || !integrations.coinmarketcap.apiKey || !integrations.coinmarketcap.enabled) {
      missing.push('coinmarketcap');
    }

    return {
      allConnected: missing.length === 0,
      missing,
    };
  }, [integrations]);

  const refresh = useCallback(async () => {
    await Promise.all([loadStatus(), loadIntegrations()]);
  }, [loadStatus, loadIntegrations]);

  useEffect(() => {
    if (user) {
      refresh();
      // Reduced polling interval to 60 seconds to improve performance
      const interval = setInterval(refresh, 60000);
      return () => clearInterval(interval);
    }
  }, [user, refresh]);

  const toggle = useCallback(async () => {
    if (!user) return;
    
    if (!enabled) {
      setChecking(true);
      
      if (!isApiConnected) {
        setChecking(false);
        throw new Error('Exchange API not connected. Please connect your exchange API first.');
      }
      
      const { allConnected, missing } = checkRequiredAPIs();
      if (!allConnected) {
        const missingNames = missing.map((m) => {
          if (m === 'cryptocompare') return 'CryptoCompare';
          if (m === 'newsdata') return 'NewsData';
          if (m === 'coinmarketcap') return 'CoinMarketCap';
          return m.charAt(0).toUpperCase() + m.slice(1);
        }).join(', ');
        
        setChecking(false);
        throw new Error(`Please submit all required APIs to enable Auto-Trade Mode. Missing: ${missingNames}`);
      }
    }
    
    setChecking(false);
    setLoading(true);
    
    try {
      const newEnabled = !enabled;
      await autoTradeApi.toggle(newEnabled);
      setEnabled(newEnabled);
      await loadStatus();
    } catch (err: any) {
      suppressConsoleError(err, 'toggleAutoTrade');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [user, enabled, isApiConnected, checkRequiredAPIs, loadStatus]);

  const { allConnected, missing } = checkRequiredAPIs();
  const canEnable = isApiConnected && allConnected;

  return {
    enabled,
    isApiConnected,
    allRequiredAPIsConnected: allConnected,
    missingAPIs: missing,
    loading,
    checking,
    toggle,
    canEnable,
    refresh,
  };
}

