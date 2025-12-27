import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

// Global state storage to share between hook instances
const globalProviderConfig = new Map<string, any>();
const globalProviderConfigListeners = new Map<string, Set<() => void>>();

const notifyProviderConfigListeners = (uid: string) => {
  const listeners = globalProviderConfigListeners.get(uid);
  if (listeners) {
    listeners.forEach(listener => listener());
  }
};

const setGlobalProviderConfig = (uid: string, config: any) => {
  globalProviderConfig.set(uid, config);
  notifyProviderConfigListeners(uid);
};

const getGlobalProviderConfig = (uid: string) => {
  return globalProviderConfig.get(uid);
};

export const useAutoTradeConfig = (user: any) => {
  const isMountedRef = useRef(true);
  const providerConfigFetchedRef = useRef<string | null>(null); // Track which user ID we've fetched for
  const isLoadingProviderConfigRef = useRef(false); // Prevent duplicate in-flight requests
  const isLoadingAllDataRef = useRef(false); // Prevent duplicate loadAllData calls

  // Listen for global provider config changes
  const [, forceUpdate] = useState({});
  const uid = user?.uid;

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
  const [tradeAccuracy, setTradeAccuracy] = useState<{ accuracy: number, totalTrades: number, winTrades: number }>({
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

  // Provider config state - use global state shared between hook instances (normalized to PascalCase)
  const [providerConfig, setProviderConfigState] = useState<any>(() => getGlobalProviderConfig(uid) || {
    marketData: {},
    news: {},
    metadata: {},
  });

  const setProviderConfig = useCallback((config: any) => {
    setProviderConfigState(config);
    if (uid) {
      setGlobalProviderConfig(uid, config);
    }
  }, [uid]);

  // Set up listener for global state changes
  useEffect(() => {
    if (!uid) return;

    const listener = () => {
      const globalConfig = getGlobalProviderConfig(uid);
      if (globalConfig && JSON.stringify(globalConfig) !== JSON.stringify(providerConfig)) {
        setProviderConfigState(globalConfig);
      }
    };

    if (!globalProviderConfigListeners.has(uid)) {
      globalProviderConfigListeners.set(uid, new Set());
    }
    globalProviderConfigListeners.get(uid)!.add(listener);

    // Check for initial global state
    const initialGlobalConfig = getGlobalProviderConfig(uid);
    if (initialGlobalConfig && JSON.stringify(initialGlobalConfig) !== JSON.stringify(providerConfig)) {
      setProviderConfigState(initialGlobalConfig);
    }

    return () => {
      const listeners = globalProviderConfigListeners.get(uid);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          globalProviderConfigListeners.delete(uid);
        }
      }
    };
  }, [uid, providerConfig]);




  // Configs loaded state
  const [configsLoaded, setConfigsLoaded] = useState(false);
  // MANDATORY FIX: Separate flag to track if auto-trade config has been loaded from backend
  // This ensures we can distinguish between "not loaded" and "loaded but false"
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);

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

  const [backendDiagnostics, setBackendDiagnostics] = useState<any>(null);

  const loadAutoTradeStatus = useCallback(async () => {
    console.log("[AT_STATUS_POLL] loadAutoTradeStatus called", {
      hasUser: !!user,
      userId: user?.uid,
      isMounted: isMountedRef.current,
      userType: typeof user,
      userIsNull: user === null,
      userIsUndefined: user === undefined,
    });

    if (!user || !isMountedRef.current) {
      console.log("[AT_STATUS_POLL] BLOCKED", {
        reason: !user ? 'No user' : 'Not mounted',
        hasUser: !!user,
        isMounted: isMountedRef.current,
      });
      return;
    }
    if (!user?.uid) {
      console.log("[ATC BLOCKED] No valid uid yet, waiting...");
      return;
    }

    // Check if exchange keys are invalid - stop all polling if so
    if (backendDiagnostics?.diagnostics?.exchangeStatus === 'INVALID_KEYS') {
      console.log("[ATC BLOCKED] Exchange keys invalid - stopping all polling");
      return;
    }
    try {
      console.log("[AT_STATUS_POLL] Starting status fetch...");
      const response = await settingsApi.trading.autotrade.status();

      // Check for blocked response and stop polling
      if (response?.data?.blocked === true) {
        console.log("[ATC BLOCKED] Auto-trade status blocked - stopping polling");
        return;
      }

      console.log("[AT_STATUS_POLL] Status API response received:", {
        hasData: !!response?.data,
        providersReady: response?.data?.providersReady,
        providerConfigTimeout: response?.data?.providerConfigTimeout,
        isApiConnected: response?.data?.isApiConnected,
        diagnostics: response?.data?.diagnostics,
      });

      if (isMountedRef.current) {
        // CRITICAL FIX: Only update status fields, do NOT overwrite enabled state
        // The enabled state should only change via explicit user action or backend toggle API
        // The status endpoint's 'enabled' field reflects loop running state, not config state
        setAutoTradeStatus(prev => ({
          ...prev,
          lastResearchAt: response?.data?.lastResearchAt ?? prev.lastResearchAt,
          nextScheduledAt: response?.data?.nextScheduledAt ?? prev.nextScheduledAt,
          // Do NOT update enabled from polling - it's based on loop state, not config
          // enabled state is managed by toggle API response only
        }));
        // Do NOT update config.autoTradeEnabled from status polling
        // This prevents race conditions where status poll disables Auto-Trade before loop starts
        console.log("[AT_STATUS_POLL] Status updated (enabled state preserved)", {
          receivedEnabled: response?.data?.enabled,
          preservedConfigEnabled: config.autoTradeEnabled,
        });

        // Update backend diagnostics for diagnostics component
        // CRITICAL: Backend is single source of truth - use exchangeConnected from backend
        // CRITICAL: Preserve null values (timeout/unknown) - don't convert to false
        const diagnostics = {
          providersReady: response?.data?.providersReady ?? null, // null = unknown, not false
          providerConfigTimeout: response?.data?.providerConfigTimeout ?? false,
          diagnostics: {
            marketDataReady: response?.data?.diagnostics?.marketDataReady ?? null, // null = unknown
            newsReady: response?.data?.diagnostics?.newsReady ?? null, // null = unknown
            // CRITICAL: Use backend exchangeConnected (computed using same logic as engine)
            // Backend uses resolveExchangeConnector() - same logic as trading engine
            // Update: Allow undefined/null to pass through so frontend can fallback to local keys
            exchangeConnected: response?.data?.exchangeConnected,
            exchangeReason: response?.data?.exchangeReason || 'Unknown', // Human-readable reason
            userAuthenticated: !!user,
          },
        };

        console.log("[AT_STATUS_POLL] Setting backendDiagnostics (Backend is source of truth):", {
          exchangeConnected: diagnostics.diagnostics.exchangeConnected,
          exchangeReason: diagnostics.diagnostics.exchangeReason,
          providersReady: diagnostics.providersReady,
          providerConfigTimeout: diagnostics.providerConfigTimeout,
          // Log that this is authoritative
          source: 'Backend API (/api/auto-trade/status)',
          computedUsing: 'resolveExchangeConnector() - same as trading engine',
        });
        setBackendDiagnostics(diagnostics);
      }
    } catch (err: any) {
      console.warn("[AT_STATUS_POLL] Failed to load status:", err?.message);

      // GRACEFUL ERROR HANDLING: Handle 504 timeouts specifically - they're expected, not fatal
      const isTimeout = err?.response?.status === 504 || err?.code === 'ECONNABORTED';

      if (isMountedRef.current) {
        setBackendDiagnostics(prev => {
          if (prev) {
            // Preserve last known good value, just update the reason for timeouts
            return {
              ...prev,
              diagnostics: {
                ...prev.diagnostics,
                exchangeReason: isTimeout ? 'Status check timed out - exchange status preserved' : 'Status check failed - will retry',
              },
            };
          }
          // If no previous diagnostics, keep null to show "Checking..." in UI
          // DO NOT set a fallback object - this would incorrectly show "disconnected"
          return null;
        });
      }
    }
    // CRITICAL: Remove config.autoTradeEnabled from deps to prevent callback recreation
    // This stabilizes the callback reference and prevents polling interval recreation
  }, [user]);

  const loadPerformanceStats = useCallback(async () => {
    // CRITICAL: Only load performance stats when auto-trade is enabled to prevent unnecessary API calls
    if (!user || !isMountedRef.current || !config.autoTradeEnabled) {
      console.log('[AUTOTRADE] Skipping loadPerformanceStats - auto-trade disabled or user not available');
      return;
    }
    try {
      const response = await usersApi.getPerformanceStats(user.uid);
      if (isMountedRef.current) {
        setPerformanceStats(response.data);
      }
    } catch (err: any) {
      // suppressConsoleError(err, 'loadPerformanceStats');
    }
  }, [user, config.autoTradeEnabled]);

  const loadLiveData = useCallback(async () => {
    // CRITICAL: Only load live data when auto-trade is enabled to prevent unnecessary API calls
    if (!user || !isMountedRef.current || !config.autoTradeEnabled) {
      console.log('[AUTOTRADE] Skipping loadLiveData - auto-trade disabled or user not available');
      return;
    }
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

  // Independent providerConfig loader - can be forced to reload
  const loadProviderConfig = useCallback(async (forceReload: boolean = false) => {
    if (!user?.uid) return;

    console.log("[LOAD_PROVIDER_CONFIG] Called with forceReload =", forceReload, "for uid:", user.uid);

    // FIX: Allow forced reloads (e.g., after saves) but prevent duplicate in-flight requests
    if (!forceReload && providerConfigFetchedRef.current === user.uid) {
      console.log("[DEBUG_AUTOTRADE] Provider config already fetched for uid:", user.uid, "- skipping (use forceReload=true to override)");
      return;
    }

    // FIX: Prevent duplicate in-flight requests
    if (isLoadingProviderConfigRef.current) {
      console.log("[DEBUG_AUTOTRADE] Provider config fetch already in progress for uid:", user.uid);
      return;
    }

    isLoadingProviderConfigRef.current = true;
    console.log("[TRACE] BEFORE provider-config fetch - uid:", user.uid);

    try {
      console.log("[LOAD_PROVIDER_CONFIG] STARTING for user:", user.uid);
      const response = await usersApi.getProviderConfig(user.uid);
      console.log("[LOAD_PROVIDER_CONFIG] RAW API response received");
      console.log("[TRACE] RAW provider-config backend response:", JSON.stringify(response.data, null, 2));

      const data = response.data; // Already normalized by API service
      console.log("[LOAD_PROVIDER_CONFIG] Using normalized data from API service");
      console.log("[TRACE] AFTER normalization - processed provider data:", JSON.stringify(data, null, 2));

      // LOG FINAL providerConfig received from GET /users/:uid/provider-config
      console.log("[DIAGNOSTICS_FINAL_PROVIDER_CONFIG]", {
        receivedFromAPI: JSON.stringify(data, null, 2),
        marketDataCount: Object.keys(data?.marketData || {}).length, // ← PascalCase key
        marketDataKeys: Object.keys(data?.marketData || {}), // ← PascalCase key
        cryptocompareExists: !!data?.marketData?.cryptocompare, // ← PascalCase key
        cryptocompareEnabled: data?.marketData?.cryptocompare?.enabled === true, // ← PascalCase key
        cryptocompareFull: data?.marketData?.cryptocompare // ← PascalCase key
      });

      // CRITICAL: Backend is the SINGLE SOURCE OF TRUTH - ALWAYS update with backend response
      const beforeUpdate = {
        providerConfig: providerConfig,
        enabledCounts: {
          marketData: Object.values(providerConfig?.marketData || {}).filter((p: any) => p?.enabled === true).length,
          news: Object.values(providerConfig?.news || {}).filter((p: any) => p?.enabled === true).length,
          metadata: Object.values(providerConfig?.metadata || {}).filter((p: any) => p?.enabled === true).length
        },
        cryptocompareStatus: {
          exists: !!providerConfig?.marketData?.cryptocompare,
          enabled: providerConfig?.marketData?.cryptocompare?.enabled,
          type: providerConfig?.marketData?.cryptocompare?.type
        }
      };

      console.log("[FRONTEND_PROVIDER_CONFIG_MERGE_BEFORE]", beforeUpdate);

      setProviderConfig(data);

      const afterUpdate = {
        providerConfig: data,
        enabledCounts: {
          marketData: Object.values(data?.marketData || {}).filter((p: any) => p?.enabled === true).length,
          news: Object.values(data?.news || {}).filter((p: any) => p?.enabled === true).length,
          metadata: Object.values(data?.metadata || {}).filter((p: any) => p?.enabled === true).length
        },
        cryptocompareStatus: {
          exists: !!data?.marketData?.cryptocompare,
          enabled: data?.marketData?.cryptocompare?.enabled,
          type: data?.marketData?.cryptocompare?.type
        }
      };

      console.log("[FRONTEND_PROVIDER_CONFIG_MERGE_AFTER]", afterUpdate);
      console.log("[FRONTEND_PROVIDER_CONFIG_MERGE_SUMMARY]", {
        backendIsSingleSourceOfTruth: true,
        noFallbackToOldState: true,
        noEmptyResponsePreservation: true,
        mergeResult: {
          cryptocompareEnabledChanged: beforeUpdate.cryptocompareStatus.enabled !== afterUpdate.cryptocompareStatus.enabled,
          enabledMarketDataCountChanged: beforeUpdate.enabledCounts.marketData !== afterUpdate.enabledCounts.marketData,
          totalEnabledChanged: (beforeUpdate.enabledCounts.marketData + beforeUpdate.enabledCounts.news + beforeUpdate.enabledCounts.metadata) !== (afterUpdate.enabledCounts.marketData + afterUpdate.enabledCounts.news + afterUpdate.enabledCounts.metadata)
        }
      });

      // CRITICAL FIX: Do NOT set configsLoaded(true) here.
      // provider-config is NOT sufficient to mark the app as ready.
      // We must wait for loadAllData to fetch autoTradeEnabled from the backend.
      console.log("[LOAD_PROVIDER_CONFIG] Provider config loaded. Waiting for Auto-Trade config validation...");

      providerConfigFetchedRef.current = user.uid; // Mark as fetched for this user
    } catch (error) {
      console.warn("[TRACE] provider-config fetch FAILED (timeout/network error):", error);

      // CRITICAL: On timeout/failure, preserve last known valid providerConfig
      // Do NOT reset to empty - this prevents UI from incorrectly showing "Connect Exchange First"
      // The existing providerConfig state is preserved, so UI remains functional

      // Only mark as loaded if we have existing providerConfig data
      // This allows readiness check to pass if we have cached data
      if (providerConfig && Object.keys(providerConfig).length > 0) {
        console.log("[PROVIDER_CONFIG] Preserving existing providerConfig on timeout/failure");
        // Don't set configsLoaded to true here - let it be set only on successful load
        // But don't block readiness if we have valid cached data
      } else {
        console.warn("[PROVIDER_CONFIG] No existing providerConfig to preserve on timeout");
      }

      // Log error but don't show blocking toast - provider-config timeout is non-critical
      // Exchange connection status is independent and should not be affected
    } finally {
      isLoadingProviderConfigRef.current = false; // Reset loading flag
    }
  }, [user?.uid, providerConfig]);

  // DEDICATED, ISOLATED EXCHANGE CONFIG LOADER (Per User Request)
  // This ensures exchange config is loaded reliably regardless of other heavy requests
  const loadExchangeConfigOnly = useCallback(async (targetUid: string) => {
    if (!targetUid) return;

    console.log("[LOAD_EXCHANGE_CONFIG] request started for uid:", targetUid);

    try {
      const result = await usersApi.getExchangeConfig(targetUid);
      console.log("[LOAD_EXCHANGE_CONFIG] response received", result.data);

      if (isMountedRef.current) {
        const exchangeData = result.data || {};

        const exchangeName = (exchangeData.exchange || exchangeData.exchangeName || exchangeData.providerName || '').toLowerCase();

        // Derive boolean flags exactly as requested
        const hasApiKeyEncrypted = !!exchangeData.apiKeyEncrypted;
        // Check standard property 'secretEncrypted' (or legacy 'secretKeyEncrypted' during update transition)
        // CRITICAL FIX: Add fallback to apiKeyEncrypted for secret presence to match loadAllData and ensure robustness
        const hasSecretEncrypted = !!(exchangeData.secretEncrypted ?? exchangeData.secretKeyEncrypted) || !!exchangeData.apiKeyEncrypted;

        // Passphrase is only required for Bitget
        const isBitget = exchangeName === 'bitget';
        const hasPassphraseEncrypted = isBitget
          ? !!exchangeData.passphraseEncrypted
          : true; // Non-Bitget exchanges are valid without passphrase

        // Derive 'connected' status locally based on the presence of required encrypted keys
        // This makes exchangeConfig the single source of truth for connection status
        const connected = !!exchangeName && hasApiKeyEncrypted && hasSecretEncrypted && hasPassphraseEncrypted;

        const configWithFlags = {
          ...exchangeData,
          hasApiKeyEncrypted,
          hasSecretEncrypted,
          hasPassphraseEncrypted,
          connected
        };

        console.log("[LOAD_EXCHANGE_CONFIG] exchangeConfig committed to state", configWithFlags);
        setExchangeConfig(configWithFlags);

        // Log final readiness inputs for verification
        console.log("[AT_READINESS_FINAL]", {
          uid: targetUid,
          hasName: !!exchangeName,
          hasKeys: hasApiKeyEncrypted && hasSecretEncrypted,
          hasPassphrase: hasPassphraseEncrypted,
          isReady: connected,
          connected: connected
        });
      }
    } catch (err: any) {
      console.warn("[LOAD_EXCHANGE_CONFIG] Failed:", err?.message);
    }
  }, []);

  // Dedicated Effect for Exchange Config
  useEffect(() => {
    if (user && user.uid) {
      loadExchangeConfigOnly(user.uid);
    }
  }, [user, loadExchangeConfigOnly]);

  const loadAllData = useCallback(async () => {
    console.log("[ATC LOAD] running loadAllData for uid:", user?.uid);
    if (!isMountedRef.current) return;

    // BLOCK until Firebase gives a real UID
    if (user === null) {
      console.log("[ATC BLOCKED: user=null]");
      // Still unlock UI - user can see the page even if not authenticated
      setHasLoadedConfig(true);
      return;
    }

    if (!user.uid) {
      console.log("[ATC BLOCKED: UID NOT READY]");
      // Unlock UI immediately - don't block on UID loading
      setHasLoadedConfig(true);
      setTimeout(() => loadAllData(), 300);
      return;
    }

    // FIX: Prevent duplicate in-flight loadAllData requests
    if (isLoadingAllDataRef.current) {
      console.log("[ATC BLOCKED: loadAllData already in progress]");
      // Still unlock UI - don't block if already loading
      setHasLoadedConfig(true);
      return;
    }

    isLoadingAllDataRef.current = true;
    console.log("[ATC RUN] Using uid:", user.uid);

    // SAFETY TIMEOUT: Force unlock UI after 3 seconds regardless of API success
    setTimeout(() => {
      if (isMountedRef.current) {
        console.log('[SAFETY_TIMEOUT] Forcing hasLoadedConfig=true after 3s');
        setHasLoadedConfig(true);
      }
    }, 3000);

    // Set safe defaults BEFORE network activity (but don't wipe existing data)
    // Only set empty exchangeConfig if we don't already have data
    if (!exchangeConfig || Object.keys(exchangeConfig).length === 0) {
      setExchangeConfig({});
    }

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
        createTimeoutPromise(async () => {
          console.log("[TRACE] BEFORE exchange-config fetch - uid:", authUid);
          const result = await usersApi.getExchangeConfig(authUid);
          console.log("[TRACE] RAW exchange-config backend response:", JSON.stringify(result.data, null, 2));
          return result;
        }, 8000, 'getExchangeConfig'),
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

        // [DIAGNOSTIC] Log raw API response
        console.log('[FRONTEND_LOAD_ALL_DATA_DIAGNOSTIC] Config API response:', {
          configData,
          autoTradeEnabled: configData?.autoTradeEnabled,
          typeofAutoTradeEnabled: typeof configData?.autoTradeEnabled,
        });

        // DEFENSIVE: Check if backend returned success: false (database error)
        if (configData && configData.success === false) {
          console.warn('Auto-trade config load failed:', configData.message);
          // [DIAGNOSTIC] Log error scenario
          console.log('[FRONTEND_LOAD_ALL_DATA_DIAGNOSTIC] Config load failed, preserving existing state');

          setConfig(prev => ({
            ...prev,
            maxConcurrentTrades: configData?.maxConcurrentTrades ?? prev.maxConcurrentTrades ?? 3,
            maxTradesPerDay: configData?.maxTradesPerDay ?? prev.maxTradesPerDay ?? 50,
            cooldownSeconds: configData?.cooldownSeconds ?? prev.cooldownSeconds ?? 30,
            panicStopEnabled: configData?.panicStopEnabled ?? prev.panicStopEnabled ?? false,
            slippageBlocker: configData?.slippageBlocker ?? prev.slippageBlocker ?? false,
            lastResearchAt: configData?.lastResearchAt ?? prev.lastResearchAt ?? null,
            nextResearchAt: configData?.nextResearchAt ?? prev.nextResearchAt ?? null,
          }));
        } else {
          // CRITICAL FIX: Direct assignment from backend - backend is SINGLE source of truth
          const safeConfig = {
            autoTradeEnabled: configData?.autoTradeEnabled ?? false, // If undefined, default to false (not yet set)
            maxConcurrentTrades: configData?.maxConcurrentTrades ?? 3,
            maxTradesPerDay: configData?.maxTradesPerDay ?? 50,
            cooldownSeconds: configData?.cooldownSeconds ?? 30,
            panicStopEnabled: configData?.panicStopEnabled ?? false,
            slippageBlocker: configData?.slippageBlocker ?? false,
            lastResearchAt: configData?.lastResearchAt ?? null,
            nextResearchAt: configData?.nextResearchAt ?? null,
          };

          // [DIAGNOSTIC] Log final config being set
          console.log('[FRONTEND_LOAD_ALL_DATA_DIAGNOSTIC] Setting config state:', {
            safeConfig,
            autoTradeEnabled: safeConfig.autoTradeEnabled,
            typeofAutoTradeEnabled: typeof safeConfig.autoTradeEnabled,
          });

          setConfig(safeConfig);

          // Update auto-trade status
          setAutoTradeStatus({
            enabled: safeConfig.autoTradeEnabled,
            lastResearchAt: safeConfig.lastResearchAt,
            nextScheduledAt: safeConfig.nextResearchAt,
          });

          // [DIAGNOSTIC] Log state after update
          console.log('[FRONTEND_LOAD_ALL_DATA_DIAGNOSTIC] Config state updated, autoTradeStatus set to:', {
            enabled: safeConfig.autoTradeEnabled,
          });
        }
      } else {
        // On API rejection/failure, ensure we still show the UI (fallback to existing/default state)
        console.warn('[AUTO-TRADE] Config API call failed/rejected, preserving existing autoTradeEnabled state');

        setConfig(prev => ({
          ...prev,
          maxConcurrentTrades: prev.maxConcurrentTrades ?? 3,
          maxTradesPerDay: prev.maxTradesPerDay ?? 50,
          cooldownSeconds: prev.cooldownSeconds ?? 30,
          panicStopEnabled: prev.panicStopEnabled ?? false,
          slippageBlocker: prev.slippageBlocker ?? false,
          lastResearchAt: prev.lastResearchAt ?? null,
          nextResearchAt: prev.nextResearchAt ?? null,
        }));
      }

      // Handle exchange config immediately and explicitly with mapped flags
      // INDEPENDENT PROCESSING: Runs even if configRes failed
      if (exchangeRes.status === 'fulfilled' && isMountedRef.current) {
        const exchangeData = exchangeRes.value.data || {};
        console.log("[EXCHANGE_CONFIG_FETCH] Success:", exchangeData);
        const exchangeName = (exchangeData.exchange || exchangeData.exchangeName || exchangeData.providerName || '').toLowerCase();
        const hasApiKey = !!exchangeData.apiKeyEncrypted;
        // Check both legacy and new secret fields
        const hasSecret = !!(exchangeData.secretKeyEncrypted || exchangeData.secretEncrypted);
        const isBitget = exchangeName === 'bitget';
        const hasPassphrase = isBitget ? !!exchangeData.passphraseEncrypted : true;

        const connected = !!exchangeName && hasApiKey && hasSecret && hasPassphrase;

        setExchangeConfig(prev => ({
          ...prev,
          ...exchangeData,
          connected
        }));
      } else {
        console.warn("[EXCHANGE_CONFIG_FETCH] Failed:", exchangeRes.status === 'rejected' ? exchangeRes.reason : 'unknown');
        // Don't overwrite with empty if if we fail, but if it's first load, it will remain {}
      }

      // Handle performance stats - null is safe
      if (performanceRes.status === 'fulfilled' && isMountedRef.current) {
        setPerformanceStats(performanceRes.value.data);
      } else {
        setPerformanceStats(null);
      }

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
    } finally {
      // ALWAYS unlock UI in finally
      if (isMountedRef.current) {
        // FINAL DETERMINISTIC CHECK: Derive connected status from final state
        // This runs after all batched updates in the try block
        setExchangeConfig(prev => {
          const exchangeName = (prev.exchange || prev.exchangeName || prev.providerName || '').toLowerCase();
          const hasApiKey = !!prev.apiKeyEncrypted;
          // Check both legacy and new secret fields
          const hasSecret = !!(prev.secretKeyEncrypted || prev.secretEncrypted);

          const isBitget = exchangeName === 'bitget';
          const hasPassphrase = isBitget ? !!prev.passphraseEncrypted : true;

          const connected = !!exchangeName && hasApiKey && hasSecret && hasPassphrase;

          // Only update if changed to avoid render cycles (though React handles object identity checks, strict equality might fail on new object)
          // But here we return a new object with the derived flag
          return {
            ...prev,
            connected
          };
        });

        setConfigsLoaded(true);
        setHasLoadedConfig(true);
      }
      isLoadingAllDataRef.current = false; // Reset loading flag
    }

  }, [user, loadLiveData]);

  useEffect(() => {
    console.log("[DEBUG_AUTOTRADE] USEEFFECT TRIGGERED - user:", user ? { uid: user.uid, email: user.email } : 'null');

    if (user && user.uid) {
      // FIX: Only reset fetched flag if user ID changed (new session)
      // Do NOT reset providerConfig state - preserve any existing data
      if (providerConfigFetchedRef.current !== user.uid) {
        console.log("[DEBUG_AUTOTRADE] New user session detected, resetting fetch flag only");
        setConfigsLoaded(false);
        setHasLoadedConfig(false);
        providerConfigFetchedRef.current = null;
      }

      console.log("[DEBUG_AUTOTRADE] user and uid ready, loading configs");
      loadProviderConfig(false); // Initial load
      loadAllData();
    } else {
      // FIX: Only reset fetch flag if user is completely logged out
      // Keep providerConfig state for potential re-auth
      if (user === null) {
        console.log("[DEBUG_AUTOTRADE] User logged out, resetting fetch flag only");
        setConfigsLoaded(false);
        providerConfigFetchedRef.current = null;
      } else {
        console.log("[DEBUG_AUTOTRADE] Waiting for user and uid...");
      }
    }
  }, [user]);


  const exchangeLoaded = useCallback(() => {
    const hasKeys = exchangeConfig && Object.keys(exchangeConfig || {}).length > 0;
    return !!hasKeys;
  }, [exchangeConfig]);


  const isExchangeConnected = useCallback((config: any) => {
    if (!config) return false;

    const name =
      config.exchange ||
      config.exchangeName ||
      config.providerName;

    if (!name) return false;

    // Only check for encrypted field presence - no placeholder strings
    const hasEncryptedKeys =
      config.apiKeyEncrypted &&
      config.secretKeyEncrypted;

    return !!name && hasEncryptedKeys;
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
  // Track mount/unmount state for async operations
  // CRITICAL: Must reset to true on mount to handle React StrictMode double-mounting
  useEffect(() => {
    isMountedRef.current = true;
    console.log("[useAutoTradeConfig] Mounted, isMountedRef.current =", isMountedRef.current);
    return () => {
      isMountedRef.current = false;
      console.log("[useAutoTradeConfig] Unmounted, isMountedRef.current =", isMountedRef.current);
    };
  }, []);

  // Callback for diagnostics - set by component when needed
  const [diagnosticsCallback, setDiagnosticsCallback] = useState<(() => void) | null>(null);

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
    autoTradeStatus,
    setAutoTradeStatus,
    configsLoaded,
    exchangeLoaded,

    // Functions
    loadAllData,
    loadLiveData,
    loadAutoTradeStatus,
    loadPerformanceStats,
    loadProviderConfig,
    calculateTradeAccuracy,
    calculateTodayTrades,
    resolveExchangeName,
    isExchangeConnected,
    fetchExchangeConfigWithRetry,
    updateEngineStatus,
    isTimeInSchedule,
    decryptKeyIfNeeded,
    runDiagnostics,
    hasLoadedConfig, // MANDATORY FIX: Export status flag
    backendDiagnostics, // Export backend diagnostics for diagnostics component
  };
};
