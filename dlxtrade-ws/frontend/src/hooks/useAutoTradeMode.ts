import { useState, useEffect, useCallback } from 'react';
import { autoTradeApi, integrationsApi } from '../services/api';
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
    cryptoquant: { enabled: false, apiKey: null },
    coinapi: {
      market: { enabled: false, apiKey: null },
      flatfile: { enabled: false, apiKey: null },
      exchangerate: { enabled: false, apiKey: null },
    },
  });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const response = await autoTradeApi.getStatus();
      setEnabled(response.data?.autoTradeEnabled || false);
      setIsApiConnected(response.data?.isApiConnected || false);
    } catch (err: any) {
      suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  }, [user]);

  const loadIntegrations = useCallback(async () => {
    if (!user) return;
    try {
      const response = await integrationsApi.load();
      const data = response.data || {};
      
      const loaded: any = {
        cryptoquant: data.cryptoquant || { enabled: false, apiKey: null },
        coinapi: {
          market: data.coinapi?.market || { enabled: false, apiKey: null },
          flatfile: data.coinapi?.flatfile || { enabled: false, apiKey: null },
          exchangerate: data.coinapi?.exchangerate || { enabled: false, apiKey: null },
        },
      };
      
      setIntegrations(loaded);
    } catch (err: any) {
      suppressConsoleError(err, 'loadIntegrations');
    }
  }, [user]);

  const checkRequiredAPIs = useCallback((): { allConnected: boolean; missing: string[] } => {
    const missing: string[] = [];
    
    if (!integrations.cryptoquant || !integrations.cryptoquant.apiKey || !integrations.cryptoquant.enabled) {
      missing.push('cryptoquant');
    }
    
    
    const coinapi = integrations.coinapi as any;
    if (!coinapi?.market || !coinapi.market.apiKey || !coinapi.market.enabled) {
      missing.push('coinapi_market');
    }
    if (!coinapi?.flatfile || !coinapi.flatfile.apiKey || !coinapi.flatfile.enabled) {
      missing.push('coinapi_flatfile');
    }
    if (!coinapi?.exchangerate || !coinapi.exchangerate.apiKey || !coinapi.exchangerate.enabled) {
      missing.push('coinapi_exchangerate');
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
          if (m === 'coinapi_market') return 'CoinAPI Market';
          if (m === 'coinapi_flatfile') return 'CoinAPI Flatfile';
          if (m === 'coinapi_exchangerate') return 'CoinAPI Exchange Rate';
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

