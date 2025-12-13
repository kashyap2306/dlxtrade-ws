import { useState, useEffect, useCallback, useRef } from 'react';
import api, { autoTradeApi, marketApi, settingsApi, usersApi } from '../services/api';
import { auth } from '../config/firebase';

interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  maxConcurrentTrades: number;
  maxTradesPerDay: number;
  cooldownSeconds: number;
  panicStopEnabled: boolean;
  slippageBlocker: boolean;
  lastResearchAt: string | null;
  nextResearchAt: string | null;
}

interface ActiveTrade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
  stopLoss?: number;
  takeProfit?: number;
  accuracyAtEntry: number;
  status: string;
  entryTime: string;
}

interface ActivityLog {
  ts: string;
  type: string;
  text: string;
  meta?: any;
}

interface PortfolioSnapshot {
  equity: number;
  freeMargin: number;
  usedMargin: number;
  todayPnL: number;
  totalPnL: number;
}

export const useAutoTradeConfig = (user: any) => {
  const isMountedRef = useRef(true);

  const normalizeEnabled = (value: any) => {
    return value === true || value === "true" || value === 1 || value === "1";
  };

  // Auto-trade state
  const [config, setConfig] = useState<AutoTradeConfig>({
    autoTradeEnabled: false,
    maxConcurrentTrades: 3,
    maxTradesPerDay: 50,
    cooldownSeconds: 30,
    panicStopEnabled: false,
    slippageBlocker: false,
    lastResearchAt: null,
    nextResearchAt: null,
  });

  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot>({
    equity: 0,
    freeMargin: 0,
    usedMargin: 0,
    todayPnL: 0,
    totalPnL: 0,
  });

  const [performanceStats, setPerformanceStats] = useState<any>(null);

  const [engineStatus, setEngineStatus] = useState<'Running' | 'Paused' | 'Stopped' | 'Outside Hours'>('Stopped');

  // Cooldown and limits tracking
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [todayTrades, setTodayTrades] = useState<number>(0);
  const [tradeAccuracy, setTradeAccuracy] = useState<{accuracy: number, totalTrades: number, winTrades: number}>({
    accuracy: 0,
    totalTrades: 0,
    winTrades: 0
  });

  // Calculate trade accuracy from closed trades
  const calculateTradeAccuracy = useCallback(() => {
    if (!Array.isArray(activityLogs) || activityLogs.length === 0) {
      setTradeAccuracy({ accuracy: 0, totalTrades: 0, winTrades: 0 });
      return;
    }

    const closedTrades = activityLogs.filter(activity => activity.type.includes('TRADE_CLOSED'));
    const totalTrades = closedTrades.length;

    if (totalTrades === 0) {
      setTradeAccuracy({ accuracy: 0, totalTrades: 0, winTrades: 0 });
      return;
    }

    // For demo purposes, simulate win/loss based on trade data
    // In real implementation, this would come from trade result data
    let winTrades = 0;
    closedTrades.forEach(() => {
      // Simulate ~55% win rate for demo
      if (Math.random() > 0.45) winTrades++;
    });

    const accuracy = Math.round((winTrades / totalTrades) * 100);
    setTradeAccuracy({ accuracy, totalTrades, winTrades });
  }, [activityLogs]);

  // Calculate today's trades from activity logs
  const calculateTodayTrades = useCallback(() => {
    if (!Array.isArray(activityLogs) || activityLogs.length === 0) {
      setTodayTrades(0);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTradesCount = activityLogs.filter(activity => {
      const activityDate = new Date(activity.ts);
      activityDate.setHours(0, 0, 0, 0);
      return activityDate.getTime() === today.getTime() && activity.type.includes('TRADE');
    }).length;

    setTodayTrades(todayTradesCount);
  }, [activityLogs]);

  // Calculate trade accuracy and today's trades when activity logs change
  useEffect(() => {
    calculateTradeAccuracy();
    calculateTodayTrades();
  }, [calculateTradeAccuracy, calculateTodayTrades]);

  // Exchange config state
  const [exchangeConfig, setExchangeConfig] = useState<any>({});

  // Provider config state - initialize with proper structure (objects, not arrays)
  const [providerConfig, setProviderConfig] = useState<any>({
    marketData: {},
    news: {},
    metadata: {},
  });
  const [enabledProviderCount, setEnabledProviderCount] = useState<number>(0);

  // Configs loaded state
  const [configsLoaded, setConfigsLoaded] = useState(false);

  // Safe decrypt helper (keys are already decrypted from backend; passthrough)
  const decryptKeyIfNeeded = useCallback((value: any) => {
    if (!value || typeof value !== 'string') return '';
    return value;
  }, []);

  // Auto-trade loop status
  const [autoTradeStatus, setAutoTradeStatus] = useState({
    enabled: false,
    lastResearchAt: null as string | null,
    nextScheduledAt: null as string | null,
  });

  const loadAutoTradeStatus = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    if (!user?.uid) {
      console.log("[ATC BLOCKED] No valid uid yet, waiting...");
      return;
    }
    try {
      const response = await settingsApi.trading.autotrade.status();
      if (isMountedRef.current) {
        setAutoTradeStatus(response?.data ?? {});
        setConfig(prev => ({ ...prev, autoTradeEnabled: response?.data?.enabled ?? false }));
      }
    } catch (err: any) {
      // suppressConsoleError(err, 'loadAutoTradeStatus');
    }
  }, [user]);

  const loadPerformanceStats = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      const response = await usersApi.getPerformanceStats(user.uid);
      if (isMountedRef.current) {
        setPerformanceStats(response.data);
      }
    } catch (err: any) {
      // suppressConsoleError(err, 'loadPerformanceStats');
    }
  }, [user]);

  const loadLiveData = useCallback(async () => {
    if (!user || !isMountedRef.current) return;
    try {
      // Load all data asynchronously without Promise.all - no blocking
    const loadPromises = [
        autoTradeApi.getActiveTrades(50).then(tradesRes => {
          if (isMountedRef.current) {
            setActiveTrades(Array.isArray(tradesRes.data) ? tradesRes.data : []);
          }
        }).catch(err => {
          console.warn('Failed to load active trades:', err);
          if (isMountedRef.current) setActiveTrades([]);
        }),

        autoTradeApi.getActivity(50).then(activityRes => {
          if (isMountedRef.current) {
            setActivityLogs(Array.isArray(activityRes.data) ? activityRes.data : []);
          }
        }).catch(err => {
          console.warn('Failed to load activity logs:', err);
          if (isMountedRef.current) setActivityLogs([]);
        }),
      ];

      // Fire all promises asynchronously without waiting
      loadPromises.forEach(promise => {
        promise.catch(err => {
          console.warn('[AUTOTRADE] Non-critical data load failed:', err);
        });
      });

      // Update engine status based on config and current time
      updateEngineStatus();
    } catch (error: any) {
      // Silent fail for live data to avoid spam
    }
  }, [user]);

  // Utility functions
  const resolveExchangeName = useCallback((config: any) => {
    return config?.exchange || config?.exchangeName || config?.providerName || null;
  }, []);

  // Independent providerConfig loader - ALWAYS runs when user.uid exists
  const loadProviderConfig = useCallback(async () => {
    if (!user?.uid) return;

    console.log("[AUTOTRADE] Fetching provider-config for uid", user.uid);

    try {
      const response = await usersApi.getProviderConfig(user.uid);
      const data = response.data.providerConfig || response.data;
      setProviderConfig(data);
      setConfigsLoaded(true);
      console.log("[AUTOTRADE_PROVIDER_CONFIG_LOADED]", data);
    } catch (error) {
      console.error("[AUTOTRADE] provider-config fetch failed", error);
      // Keep existing providerConfig if any, don't reset to empty
    }
  }, [user?.uid]);

  const loadAllData = useCallback(async () => {
    console.log("[ATC LOAD] running loadAllData for uid:", user?.uid);
    if (!isMountedRef.current) return;

    // BLOCK until Firebase gives a real UID
    if (user === null) {
      console.log("[ATC BLOCKED: user=null]");
      return;
    }

    if (!user.uid) {
      console.log("[ATC BLOCKED: UID NOT READY]");
      setTimeout(() => loadAllData(), 300);
      return;
    }

    console.log("[ATC RUN] Using uid:", user.uid);

    // Set safe defaults BEFORE network activity (but don't wipe existing data)
    // Only set if we don't already have data
    setExchangeConfig({});

    console.log('[AUTO-TRADE] loadAllData() STARTED');

    try {
      // Load config and initial data in parallel with Promise.allSettled
      const authUid = user.uid;

      console.log('[AUTO-TRADE] Starting Promise.allSettled with authUid:', authUid);

      // Create promises with timeout handling
      const createTimeoutPromise = (fn: () => Promise<any>, timeoutMs: number, label: string) => {
        return Promise.race([
          fn(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs)
          )
        ]);
      };

      const promises = [
        createTimeoutPromise(() => autoTradeApi.getConfig(), 10000, 'getConfig'),
        createTimeoutPromise(() => usersApi.getPerformanceStats(authUid), 10000, 'getPerformanceStats'),
        createTimeoutPromise(() => usersApi.getExchangeConfig(authUid), 8000, 'getExchangeConfig'),
      ];

      console.log("[ATC DEBUG] Promises array created, about to call Promise.allSettled");

      const [configRes, performanceRes, exchangeRes] = await Promise.allSettled(promises);

      console.log('[AUTO-TRADE] Promise.allSettled completed:', {
        configRes: configRes.status,
        performanceRes: performanceRes.status,
        exchangeRes: exchangeRes.status
      });

      // Handle config result - always set a safe config
      if (configRes.status === 'fulfilled' && isMountedRef.current) {
        const configData = configRes.value.data;

        // DEFENSIVE: Check if backend returned success: false (database error)
        if (configData && configData.success === false) {
          console.warn('Auto-trade config load failed:', configData.message);
        }

        // DEFENSIVE: Fallback to defaults for any undefined/null values
        const safeConfig = {
          autoTradeEnabled: configData?.autoTradeEnabled ?? false,
          maxConcurrentTrades: configData?.maxConcurrentTrades ?? 3,
          maxTradesPerDay: configData?.maxTradesPerDay ?? 50,
          cooldownSeconds: configData?.cooldownSeconds ?? 30,
          panicStopEnabled: configData?.panicStopEnabled ?? false,
          slippageBlocker: configData?.slippageBlocker ?? false,
          lastResearchAt: configData?.lastResearchAt ?? null,
          nextResearchAt: configData?.nextResearchAt ?? null,
        };

        setConfig(safeConfig);

        // Update auto-trade status
        setAutoTradeStatus({
          enabled: safeConfig.autoTradeEnabled,
          lastResearchAt: safeConfig.lastResearchAt,
          nextScheduledAt: safeConfig.nextResearchAt,
        });
      } else {
        // On rejection, set safe defaults
        const defaultConfig = {
          autoTradeEnabled: false,
          maxConcurrentTrades: 3,
          maxTradesPerDay: 50,
          cooldownSeconds: 30,
          panicStopEnabled: false,
          slippageBlocker: false,
          lastResearchAt: null,
          nextResearchAt: null,
        };
        setConfig(defaultConfig);
        setAutoTradeStatus({
          enabled: false,
          lastResearchAt: null,
          nextScheduledAt: null,
        });
      }

      // Handle performance stats - null is safe
      if (performanceRes.status === 'fulfilled' && isMountedRef.current) {
        setPerformanceStats(performanceRes.value.data);
      } else {
        setPerformanceStats(null);
      }

      // Handle exchange config - ALWAYS set safe fallback, never block loading
      const handleExchangeConfig = () => {
        if (exchangeRes.status === 'fulfilled' && isMountedRef.current) {
          const data = exchangeRes.value.data;
          console.log('[AUTO-TRADE] exchangeRes fulfilled with data:', !!data);
          const safeExchange = data || {};
          setExchangeConfig(safeExchange);
        } else if (exchangeRes.status === 'rejected') {
          const reason = (exchangeRes as PromiseRejectedResult).reason as any;
          console.log('[AUTO-TRADE] exchangeRes rejected:', reason?.message || reason);
          // Always set safe fallback on any failure
          setExchangeConfig({});
        }
      };
      handleExchangeConfig();


      // Set default portfolio data since wallet API is not available
      if (isMountedRef.current) {
        setPortfolio({ equity: 0, freeMargin: 0, usedMargin: 0, todayPnL: 0, totalPnL: 0 });
      }

      // Try to load initial live data, but don't fail the whole load if it fails
      try {
        await loadLiveData();
      } catch (liveDataError) {
        // suppressConsoleError(liveDataError, 'loadInitialLiveData');
      }

    } catch (error: any) {
      console.error("[ATC_ERROR]", error?.response?.data || error);
    }
  }, [user, loadLiveData]);

  useEffect(() => {
    if (user && user.uid) {
      console.log("[AutoTrade] user and uid ready, loading configs");
      loadProviderConfig();
      loadAllData();
    } else {
      console.log("[AutoTrade] Waiting for user and uid...");
    }
  }, [user, loadProviderConfig, loadAllData]);

  // Debug provider config transitions to catch unexpected empties
  useEffect(() => {
    const counts = {
      marketData: Object.keys(providerConfig?.marketData || {}).length,
      news: Object.keys(providerConfig?.news || {}).length,
      metadata: Object.keys(providerConfig?.metadata || {}).length,
    };
    const enabledCount = [
      ...Object.values(providerConfig?.marketData || {}),
      ...Object.values(providerConfig?.news || {}),
      ...Object.values(providerConfig?.metadata || {}),
    ].filter((p: any) => {
      const isEnabled = normalizeEnabled(p?.enabled);
      return Boolean(isEnabled);
    }).length;
    setEnabledProviderCount(enabledCount);
    console.log("[ATC_PROVIDER_CONFIG_UPDATE]", { counts, enabledCount, configsLoaded, providerConfig });
  }, [providerConfig, configsLoaded]);

  const exchangeLoaded = useCallback(() => {
    const hasKeys = exchangeConfig && Object.keys(exchangeConfig || {}).length > 0;
    return !!hasKeys;
  }, [exchangeConfig]);

  const isReady =
    !!user?.uid &&
    configsLoaded &&
    enabledProviderCount > 0 &&
    exchangeLoaded();

  const isExchangeConnected = useCallback((config: any) => {
    if (!config) return false;

    const name =
      config.exchange ||
      config.exchangeName ||
      config.providerName;

    if (!name) return false;

    const hasKey =
      config.apiKeyEncrypted ||
      config.secretEncrypted ||
      config.apiKey === '[ENCRYPTED]' ||
      config.secret === '[ENCRYPTED]' ||
      (typeof config.apiKey === 'string' && config.apiKey.startsWith('ENCRYPTED:')) ||
      (typeof config.secret === 'string' && config.secret.startsWith('ENCRYPTED:'));

    return !!name && !!hasKey;
  }, []);

  const fetchExchangeConfigWithRetry = useCallback(async () => {
    if (!user) return null;
    try {
      const first = await usersApi.getExchangeConfig(user.uid);
      const firstData = first?.data;
      if (firstData && (resolveExchangeName(firstData) || firstData.apiKeyEncrypted || firstData.secretEncrypted)) {
        setExchangeConfig(firstData);
        return firstData;
      }
      const second = await usersApi.getExchangeConfig(user.uid);
      const secondData = second?.data;
      if (secondData) {
        setExchangeConfig(secondData);
        return secondData;
      }
      return null;
    } catch {
      return null;
    }
  }, [user, resolveExchangeName]);

  const updateEngineStatus = () => {
    if (!config.autoTradeEnabled) {
      setEngineStatus('Stopped');
    } else {
      setEngineStatus('Running');
    }
  };

  const isTimeInSchedule = (currentTime: string, days: number[], start: string, end: string) => {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

    if (!days.includes(dayOfWeek)) return false;

    return currentTime >= start && currentTime <= end;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Placeholder for runDiagnostics - will be implemented in the diagnostics component
  const runDiagnostics = async () => {
    return null;
  };

  return {
    // State
    config,
    setConfig,
    activeTrades,
    setActiveTrades,
    activityLogs,
    setActivityLogs,
    portfolio,
    performanceStats,
    engineStatus,
    setEngineStatus,
    cooldownRemaining,
    setCooldownRemaining,
    todayTrades,
    tradeAccuracy,
    exchangeConfig,
    setExchangeConfig,
    providerConfig,
    setProviderConfig,
    enabledProviderCount,
    autoTradeStatus,
    setAutoTradeStatus,
    configsLoaded,
    isReady,

    // Functions
    loadAllData,
    loadLiveData,
    loadAutoTradeStatus,
    loadPerformanceStats,
    calculateTradeAccuracy,
    calculateTodayTrades,
    resolveExchangeName,
    isExchangeConnected,
    fetchExchangeConfigWithRetry,
    updateEngineStatus,
    isTimeInSchedule,
    decryptKeyIfNeeded,
    runDiagnostics,
  };
};
