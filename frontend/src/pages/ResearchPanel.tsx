import { useState, useEffect, useCallback } from 'react';
import { useThrottle } from '../hooks/usePerformance';
import { researchApi, settingsApi, adminApi } from '../services/api';
import { wsService } from '../services/ws';
import Toast from '../components/Toast';
import { useError } from '../contexts/ErrorContext';
import { useNotificationContext } from '../contexts/NotificationContext';
import { getApiErrorMessage, suppressConsoleError } from '../utils/errorHandler';
import { useAuth } from '../hooks/useAuth';

// Import extracted components
import ResearchPanelHeader from './ResearchPanelHeader';
import TopCoinsGrid from './TopCoinsGrid';
import LiveResearchCard from './LiveResearchCard';
import DeepResearchResults from './DeepResearchResults';
import CoinResearchSection from './CoinResearchSection';
import { ResearchLog, AnalysisReportItem } from './ResearchPanelTypes';
import { canExecute, calculateMultiStrategyAccuracy } from './ResearchPanelUtils';

export default function ResearchPanel() {
  // 🔥 DIAGNOSTIC: PROVE WHICH FRONTEND BUNDLE IS LOADED
  useEffect(() => {
    console.log("🔥 FRONTEND BUILD: FIX-API-GATE-REMOVED @", new Date().toISOString());
  }, []);

  const { user, loading } = useAuth();
  const [logs, setLogs] = useState<ResearchLog[]>([]);
  const [pageLoading, setPageLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [liveData, setLiveData] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [settings, setSettings] = useState<any>(null);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReportItem[]>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);
  const [researchRunning, setResearchRunning] = useState(false); // Hard lock to prevent concurrent requests
  const [deepResearchResults, setDeepResearchResults] = useState<any[]>([]);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [researchProgress, setResearchProgress] = useState<{
    step: string;
    status: 'pending' | 'loading' | 'success' | 'error';
    error?: string;
  }[]>([]);
  const [hasUserTriggeredResearch, setHasUserTriggeredResearch] = useState(false);
  const [researchStatus, setResearchStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [showMoreAnalysis, setShowMoreAnalysis] = useState(false);

  // Deep Research state
  const [topCoins, setTopCoins] = useState<any[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selectedCoinData, setSelectedCoinData] = useState<any>(null);
  const [selectedCoinSymbol, setSelectedCoinSymbol] = useState<string | null>(null);
  const [coinResearchLoading, setCoinResearchLoading] = useState(false);
  const [topCoinsLoading, setTopCoinsLoading] = useState(false);
  const [manualSelectedCoin, setManualSelectedCoin] = useState<string | null>(null);
  const [globalResearchResult, setGlobalResearchResult] = useState<any>(null);
  const [globalResearchExplanation, setGlobalResearchExplanation] = useState<string>('');
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);
  const [timeframe, setTimeframe] = useState<string>('Default');
  const [mobileSectionsOpen, setMobileSectionsOpen] = useState({
    analysis: true,
    metrics: false,
    news: false,
    images: false,
  });

  // API Gate State
  const [apiProvidersConfig, setApiProvidersConfig] = useState<any>(null);
  // CRITICAL: Removed API gate modal state - backend is single source of truth for API key validation

  // History state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [researchHistory, setResearchHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Throttle research results to prevent excessive re-renders
  const throttledDeepResearchResults = useThrottle(deepResearchResults, 200);

  const { showError } = useError();
  const { addNotification } = useNotificationContext();

  // Countdown timer for cooldown
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => {
        setCooldownSeconds(cooldownSeconds - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  const fetchHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const res = await researchApi.deepResearch.getHistory();
      if (res.data?.success) {
        setResearchHistory(res.data.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch research history", err);
      setToast({ message: "Failed to load research history", type: 'error' });
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  const toggleHistory = () => {
    if (!historyOpen) {
      fetchHistory();
    }
    setHistoryOpen(!historyOpen);
  };


  // Strict symbol normalization function
  const normalizeSymbol = useCallback((symbol: string): string | null => {
    if (!symbol || typeof symbol !== 'string') {
      return null;
    }

    // Remove USDT suffix if present for processing
    let baseSymbol = symbol.replace(/USDT$/i, '').trim().toUpperCase();

    // Reject stablecoins
    const stablecoins = ['USDT', 'USDC', 'DAI', 'PYUSD', 'FDUSD', 'TUSD'];
    if (stablecoins.includes(baseSymbol)) {
      return null;
    }

    // Accept only uppercase alphabetic characters (A-Z)
    // Reject symbols containing numbers or special characters
    if (!/^[A-Z]+$/.test(baseSymbol)) {
      return null;
    }

    // Append USDT
    return `${baseSymbol}USDT`;
  }, []);

  // Extract and normalize symbols from topCoins
  const getNormalizedSymbols = useCallback((): string[] => {
    const symbols: string[] = [];
    const seen = new Set<string>();

    for (const coin of topCoins) {
      const rawSymbol = coin.symbol || coin.id;
      if (!rawSymbol) continue;

      const normalized = normalizeSymbol(rawSymbol);
      if (normalized && !seen.has(normalized)) {
        symbols.push(normalized);
        seen.add(normalized);
      }
    }

    return symbols;
  }, [topCoins, normalizeSymbol]);

  // Fetch top 10 non-stablecoins (DEPRECATED: Use API endpoint instead)
  // This function is kept for backward compatibility but should use /deep-research/top50 endpoint
  const fetchTop100Coins = useCallback(async (): Promise<string[]> => {
    try {
      console.log('[RESEARCH] Fetching top 10 non-stablecoins from CoinGecko (fallback)...');
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false',
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(10000), // 10 second timeout
        }
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API returned status ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error('Invalid response format from CoinGecko');
      }

      // CRITICAL: Filter out stablecoins
      const stablecoinSymbols = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDE'];
      const nonStablecoins = data.filter((coin: any) => {
        const symbol = (coin.symbol || '').toUpperCase();
        return !stablecoinSymbols.includes(symbol);
      });

      // Normalize symbols and limit to top 10
      const symbols: string[] = [];
      const seen = new Set<string>();

      for (const coin of nonStablecoins.slice(0, 10)) {
        const rawSymbol = coin.symbol?.toUpperCase();
        if (!rawSymbol) continue;

        const normalized = normalizeSymbol(rawSymbol);
        if (normalized && !seen.has(normalized)) {
          symbols.push(normalized);
          seen.add(normalized);
        }
      }

      console.log(`[RESEARCH] Fetched and normalized ${symbols.length} non-stablecoin symbols from CoinGecko (top 10)`);
      return symbols;
    } catch (err: any) {
      console.error('[RESEARCH] Failed to fetch top 10 non-stablecoins from CoinGecko:', err);
      throw new Error(`Failed to fetch top 10 non-stablecoins: ${err.message || 'Unknown error'}`);
    }
  }, [normalizeSymbol]);


  // DISABLED: Logs are optional and should not block UI
  // const loadLogs = useCallback(async () => {
  //   if (!user) return;
  //   try {
  //     const response = await researchApi.getLogs({ limit: 100 });
  //     if (response.data && Array.isArray(response.data)) {
  //       setLogs(response.data);
  //     }
  //   } catch (err: any) {
  //     suppressConsoleError(err, 'loadLogs');
  //   }
  // }, [user]);

  // Non-blocking stub function for header button
  const loadLogs = useCallback(async () => {
    // Logs are optional - do nothing to prevent blocking
    console.log('[RESEARCH] Logs refresh requested (disabled - logs are optional)');
  }, []);

  // Load top 100 non-stablecoins for manual research - CACHE-ONLY endpoint with fallback
  // CRITICAL: Manual research allows Top 100, auto-trade uses Top 10
  const loadTopCoins = useCallback(async () => {
    if (!user?.uid) {
      console.log('[RESEARCH] Skipping loadTopCoins - no user');
      return;
    }

    console.log('[RESEARCH] Loading top 100 non-stablecoins from API (cache-only endpoint)...');
    setTopCoinsLoading(true);
    
    // Use AbortController for request cancellation
    const abortController = new AbortController();
    let isCancelled = false;
    
    // FALLBACK: Try to load from localStorage if available (last cached list)
    const getCachedCoins = (): any[] => {
      try {
        const cached = localStorage.getItem('research_top_coins_cache');
        if (cached) {
          const parsed = JSON.parse(cached);
          // Check if cache is not too old (24 hours)
          if (parsed.timestamp && (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000)) {
            return parsed.coins || [];
          }
        }
      } catch (e) {
        console.warn('[RESEARCH] Failed to parse cached coins from localStorage');
      }
      return [];
    };
    
    try {
      const response = await researchApi.deepResearch.getTop50();
      
      // Check if component unmounted
      if (isCancelled) return;
      
      console.log('[RESEARCH] Top100 non-stablecoins API response:', response);

      // Handle different response structures
      let coins: any[] = [];
      if (Array.isArray(response.data)) {
        coins = response.data;
      } else if (response.data?.coins && Array.isArray(response.data.coins)) {
        coins = response.data.coins;
      } else if (response.data?.data && Array.isArray(response.data.data)) {
        coins = response.data.data;
      } else if (response.data && typeof response.data === 'object') {
        // Try to extract coins from nested structure
        const data = response.data as any;
        if (data.coins) coins = Array.isArray(data.coins) ? data.coins : [];
        else if (data.data) coins = Array.isArray(data.data) ? data.data : [];
      }

      // CRITICAL: Filter out stablecoins on frontend as well (safety check)
      const stablecoinSymbols = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDE'];
      const nonStablecoins = coins.filter((coin: any) => {
        const symbol = (coin.symbol || '').toUpperCase();
        // Exclude if symbol is a stablecoin or ends with stablecoin (but not trading pairs like BTCUSDT)
        if (stablecoinSymbols.includes(symbol)) return false;
        // Check if base symbol (before USDT/USDC) is a stablecoin
        for (const stable of stablecoinSymbols) {
          if (symbol.endsWith(stable) && symbol.length > stable.length) {
            const baseSymbol = symbol.slice(0, -stable.length);
            if (stablecoinSymbols.includes(baseSymbol)) return false;
          }
        }
        return true;
      });

      if (isCancelled) return;

      if (nonStablecoins.length === 0) {
        // FALLBACK: Use cached coins from localStorage
        const cachedCoins = getCachedCoins();
        if (cachedCoins.length > 0) {
          console.warn('[RESEARCH] API returned empty array, using cached coins from localStorage');
          setTopCoins(cachedCoins);
          addNotification({
            type: 'warning',
            title: 'Using Cached Data',
            message: 'Coin list loaded from cache. Latest data may not be available.'
          });
        } else {
          console.warn('[RESEARCH] Top 100 non-stablecoins API returned empty array - no cache available');
          setTopCoins([]); // Empty is valid fallback state
        }
      } else {
        // CRITICAL: Store all top 100 for manual research (UI will show top 10 initially)
        console.log(`[RESEARCH] Loaded ${nonStablecoins.length} non-stablecoins (top 100):`, nonStablecoins.slice(0, 10).map((c: any) => c.symbol));
        setTopCoins(nonStablecoins.slice(0, 100)); // Store up to 100 for manual research
        
        // Cache to localStorage for fallback
        try {
          localStorage.setItem('research_top_coins_cache', JSON.stringify({
            coins: nonStablecoins.slice(0, 100),
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('[RESEARCH] Failed to cache coins to localStorage');
        }
      }
    } catch (err: any) {
      if (isCancelled) return;
      
      const isTimeout = err?.code === 'ECONNABORTED' || err?.message?.includes('timeout') || err?.message?.includes('TIMEOUT');
      
      console.error('[RESEARCH] Error loading top 100 non-stablecoins:', err);
      
      // FALLBACK: Use cached coins from localStorage
      const cachedCoins = getCachedCoins();
      if (cachedCoins.length > 0) {
        console.warn('[RESEARCH] API call failed, using cached coins from localStorage');
        setTopCoins(cachedCoins);
        
        // Show non-blocking warning toast
        addNotification({
          type: 'warning',
          title: isTimeout ? 'Request Timeout' : 'Connection Error',
          message: `Using cached coin list. ${isTimeout ? 'Request timed out.' : 'Unable to fetch latest data.'}`
        });
      } else {
        console.warn('[RESEARCH] Top 100 non-stablecoins loading failed - no cache available, continuing with empty fallback');
        setTopCoins([]); // Empty is valid fallback state
        
        // Only show error if no cache available
        if (!isTimeout) {
          addNotification({
            type: 'warning',
            title: 'Unable to Load Coins',
            message: 'Coin list could not be loaded. Please try again later.'
          });
        }
      }
    } finally {
      if (!isCancelled) {
        setTopCoinsLoading(false);
      }
    }
    
    // Return cleanup function
    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [user?.uid, addNotification]);

  // Load detailed research for a specific coin
  const loadCoinResearch = useCallback(async (symbol: string) => {
    if (!user?.uid) return;

    setCoinResearchLoading(true);
    setSelectedCoinSymbol(symbol);
    setSelectedSymbol(symbol); // Also update the main selected symbol for deep research

    try {
      const response = await researchApi.deepResearch.getCoin(symbol);
      setSelectedCoinData(response.data?.data || null);
      setLastRefreshTime(new Date());
    } catch (err: any) {
      console.error('Error loading coin research:', err);
      showError('Failed to load coin research data', 'api');
      setSelectedCoinData(null);
    } finally {
      setCoinResearchLoading(false);
    }
  }, [user?.uid, showError]);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefreshEnabled || !selectedCoinSymbol) return;

    const interval = setInterval(() => {
      loadCoinResearch(selectedCoinSymbol);
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoRefreshEnabled, selectedCoinSymbol, loadCoinResearch]);

  // Load top 100 coins on component mount with cleanup
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    
    const load = async () => {
      cleanup = await loadTopCoins();
    };
    
    load();
    
    // Cleanup on unmount
    return () => {
      if (cleanup) cleanup();
    };
  }, [loadTopCoins]);

  const loadSettings = useCallback(async () => {
    try {
      const response = await settingsApi.load();
      setSettings(response.data);
    } catch (err: any) {
      suppressConsoleError(err, 'loadSettings');
    }
  }, []);

  const fetchProviderConfig = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const response = await settingsApi.loadProviderConfig(user.uid);
      const configData = (response as any)?.data || response;
      setApiProvidersConfig(configData);
      console.log("[RESEARCH_API_GATE] Loaded provider config:", configData);
    } catch (err) {
      console.warn("[RESEARCH_API_GATE] Failed to load provider config", err);
    }
  }, [user?.uid]);

  const fetchAnalysis = useCallback(async () => {
    if (!user) return;
    setAnalysisLoading(true);
    try {
      // DISABLED: Logs are optional and should not block UI
      // Fetch research logs
      // const logsResponse = await researchApi.getLogs({ limit: 50 });
      // if (logsResponse.data && Array.isArray(logsResponse.data)) {
      //   // Filter only auto research (researchType === 'auto' or undefined/not 'manual')
      //   const autoLogs = logsResponse.data.filter((log: ResearchLog) =>
      //     log.researchType !== 'manual'
      //   );
      //
      //   // Get unique symbols from logs
      //   const symbols = [...new Set(autoLogs.map(log => log.symbol))];
      //
      //   // Create price map (prices will be null if not available from research data)
      //   const priceMap = new Map<string, number>();
      //
      //   // Process logs into analysis report with prices
      //   const report: AnalysisReportItem[] = autoLogs.map((log: ResearchLog) => ({
      //     id: log.id,
      //     symbol: log.symbol,
      //     price: priceMap.get(log.symbol) || null,
      //     longSignals: log.signal === 'BUY' ? 1 : 0,
      //     accuracy: log.accuracy,
      //     timestamp: log.timestamp,
      //   }));
      //   setAnalysisReport(report);
      // }
    } catch (err: any) {
      suppressConsoleError(err, 'fetchAnalysis');
    } finally {
      setAnalysisLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      // DISABLED: loadLogs() - logs are optional and should not block UI
      // loadLogs();
      loadSettings();
      fetchProviderConfig();
      // Don't auto-fetch analysis on page load - only when user requests it
      // fetchAnalysis();
    }
  }, [user, loadSettings, fetchProviderConfig]);

  useEffect(() => {
    if (!user) return;

    // Subscribe to live research updates
    const unsubscribe = wsService.subscribe('research', (data: any) => {
      setLiveData(data.data);
      // Add to logs (only if it's auto research)
      if (data.data && data.data.researchType !== 'manual') {
        setLogs((prev) => [data.data, ...prev].slice(0, 100));
      }
    });

    // Auto-refresh analysis every 5 minutes (300000ms) - only if user is on the page
    // Removed auto-refresh to prevent performance issues - user can manually refresh

    return () => {
      unsubscribe();
    };
  }, [user]);

  // Shared response parsing function for both global and manual modes
  const parseResearchResponse = useCallback((responseData: any, isGlobal: boolean) => {
    // responseData is the axios response.data (backend response)

    // CRITICAL: Check for blocked state first - do NOT parse blocked results
    if (responseData?.blocked === true || responseData?.reason === 'NO_API_KEYS') {
      const errorMessage = responseData?.message || 'Deep Research requires at least one API key to be connected. Please configure your provider API keys in Settings before running research.';
      throw new Error(errorMessage);
    }

    // CRITICAL: Check for errors
    if (responseData?.error) {
      throw new Error(responseData.error);
    }

    // CRITICAL: Do NOT throw errors for missing providers - backend returns 200 with partial data
    // Provider status is checked separately and shown as warnings, not errors

    // SUPPORT BOTH FORMATS: Root-level and nested data
    const symbol = responseData?.symbol ?? responseData?.data?.symbol;

    // CRITICAL: Check isFinal FIRST - if FINAL, trust backend verdict completely
    const isFinal = !!(responseData.isFinal || responseData.data?.isFinal || responseData.result?.isFinal);

    // CRITICAL: For FINAL results, signal/accuracy come from backend FINAL payload
    // Frontend must trust FINAL backend verdict - do NOT override BUY/SELL with HOLD
    // WHY: Backend FINAL payload is the authoritative source after all analysis is complete
    const signal = isFinal
      ? (responseData?.signal ?? responseData?.data?.signal ?? responseData?.result?.signal)
      : (responseData?.signal ?? responseData?.data?.signal ?? responseData?.result?.signal);

    const rawAccuracy = isFinal
      ? (responseData?.accuracy ?? responseData?.data?.accuracy ?? responseData?.result?.accuracy)
      : (responseData?.accuracy
        ?? responseData?.confidence
        ?? responseData?.confidenceScore
        ?? responseData?.data?.accuracy
        ?? responseData?.data?.confidence
        ?? responseData?.data?.confidenceScore
        ?? responseData?.result?.accuracy);

    if (!symbol) {
      throw new Error('Invalid response format: symbol is required');
    }

    // CRITICAL: For FINAL results, signal is required - if missing, log error but don't throw
    // This allows FINAL results to be displayed even if signal parsing fails
    if (isFinal && !signal) {
      console.error('[PARSE_RESPONSE] FINAL result missing signal:', responseData);
    }

    // FIX: Normalize accuracy to 0-1 range (User Rule: Strictly 0-100%)
    const normalizeAccuracy = (val: any): number => {
      if (val == null || Number.isNaN(Number(val))) return 0;
      let num = Number(val);
      if (num > 1) num = num / 100;
      return Math.max(0, Math.min(1, num));
    };

    const accuracy = normalizeAccuracy(rawAccuracy);

    // Optional fields - provide defaults if missing (prefer root-level, fallback to nested)
    const resultData = responseData.result || responseData.data?.result || responseData;
    let analysis = responseData.analysis || responseData.data?.analysis || null;

    // FIX: If analysis is missing or empty, try to reconstruct from indicators (root-level or deepResearchResult)
    if (!analysis || (typeof analysis === 'object' && Object.keys(analysis).length === 0)) {
      // Try to get indicators from root-level first, then deepResearchResult
      const indicators = responseData.indicators || responseData.data?.indicators ||
        (responseData.deepResearchResult?.indicators) ||
        (responseData.data?.deepResearchResult?.indicators);

      if (indicators) {
        const deepResearchResult = responseData.deepResearchResult || responseData.data?.deepResearchResult;
        const rawData = responseData.raw || responseData.data?.raw || deepResearchResult?.raw;
        analysis = {
          technicalIndicators: {
            status: indicators.status || 'partial',
            rsi: indicators.rsi || null,
            sma50: indicators.ma50 || null,
            sma200: indicators.ma200 || null,
            ema20: indicators.ema20 || null,
            ema50: indicators.ema50 || null,
            macd: indicators.macd || null,
            atr: indicators.atr || null,
            vwap: indicators.vwap || null,
            distribution: {
              uptrendScore: indicators.momentum?.score > 0.6 ? 1 : 0,
              downtrendScore: indicators.momentum?.score < 0.4 ? 1 : 0
            }
          },
          priceAction: {
            status: indicators.status || 'partial',
            currentPrice: rawData?.marketData?.price || indicators.price || 0,
            vsEMA20: (indicators.ema20?.value && (rawData?.marketData?.price || indicators.price)) ?
              (((rawData?.marketData?.price || indicators.price) - indicators.ema20.value) / indicators.ema20.value) * 100 : null,
            vsSMA50: (indicators.ma50?.value && (rawData?.marketData?.price || indicators.price)) ?
              (((rawData?.marketData?.price || indicators.price) - indicators.ma50.value) / indicators.ma50.value) * 100 : null,
            vsSMA200: (indicators.ma200?.value && (rawData?.marketData?.price || indicators.price)) ?
              (((rawData?.marketData?.price || indicators.price) - indicators.ma200.value) / indicators.ma200.value) * 100 : null,
            trendDirection: indicators.ema20?.emaTrend || 'neutral',
            momentumBias: indicators.momentum?.direction || 'neutral',
            vwapSignal: indicators.vwap?.signal || null,
            price: rawData?.marketData?.price || indicators.price || 0,
            ma50: indicators.ma50 || null,
            ma200: indicators.ma200 || null,
            ema20: indicators.ema20 || null,
            vwap: indicators.vwap || null
          },
          volatility: {
            status: indicators.atr ? 'completed' : 'partial',
            atr: indicators.atr || null,
            bollinger: null
          },
          supportResistance: {
            status: indicators.ma50 ? 'completed' : 'partial',
            majorSupport: indicators.ma200?.value || null,
            minorSupport: indicators.ma50?.value || null,
            majorResistance: null,
            minorResistance: null
          },
          patterns: {
            status: indicators.pattern ? 'completed' : 'partial',
            doubleBottom: null,
            doubleTop: null,
            headAndShoulders: null,
            breakOfStructure: null,
            activePattern: indicators.pattern?.pattern || null
          },
          momentum: {
            status: indicators.momentum ? 'completed' : 'partial',
            rsi: indicators.rsi || null,
            macd: indicators.macd || null,
            momentumScore: indicators.momentum?.score || null
          },
          volume: {
            status: indicators.volume ? 'completed' : 'partial',
            volumeTrend: indicators.volume?.trend || null,
            volumeScore: indicators.volume?.score || null
          },
          strategies: [
            { name: 'RSI', signal: indicators.rsi?.value < 30 ? 'BUY' : indicators.rsi?.value > 70 ? 'SELL' : 'HOLD', confidence: null, reason: null },
            { name: 'EMA Trend (20/50)', signal: indicators.ema20?.emaTrend || 'HOLD', confidence: null, reason: null },
            { name: 'SMA Trend (50/200)', signal: indicators.ma50?.smaTrend || 'HOLD', confidence: null, reason: null },
            { name: 'MACD', signal: indicators.macd?.signal || 'HOLD', confidence: null, reason: null },
            { name: 'ATR / Volatility', signal: 'HOLD', confidence: null, reason: null },
            { name: 'VWAP', signal: indicators.vwap?.signal || 'HOLD', confidence: null, reason: null },
            { name: 'Bollinger Bands', signal: 'HOLD', confidence: null, reason: null },
            { name: 'Support & Resistance', signal: 'HOLD', confidence: null, reason: null },
            { name: 'Price Action (HH/HL, LH/LL)', signal: 'HOLD', confidence: null, reason: null },
            { name: 'Chart Patterns', signal: 'HOLD', confidence: null, reason: null },
            { name: 'Momentum', signal: indicators.momentum?.direction || 'HOLD', confidence: null, reason: null },
            { name: 'Volume Confirmation', signal: 'HOLD', confidence: null, reason: null }
          ]
        };
      }
    }

    const news = responseData.news || responseData.data?.news || { articles: [] };
    const metadata = responseData.metadata || responseData.data?.metadata || {};
    const providersMetadata = responseData.providersMetadata || responseData.data?.providersMetadata || null;
    const stages = responseData.stages || responseData.data?.stages || {};
    const partial = responseData.partial || responseData.data?.partial || false;

    // INTEGRATE MULTI-STRATEGY ACCURACY SYSTEM (Frontend Side Enhancement)
    const compositeResults = calculateMultiStrategyAccuracy(analysis, news);

    const isProcessing = !!(responseData.isProcessing || responseData.data?.isProcessing || responseData.result?.isProcessing);

    // CRITICAL: Final Authority - If isFinal === true, ALWAYS use backend FINAL payload values
    // Frontend must trust FINAL backend verdict - do NOT override with frontend calculations
    // WHY: Backend FINAL payload represents completed analysis with authoritative signal/accuracy
    // NEVER override BUY/SELL with HOLD when FINAL exists
    // NEVER reset accuracy to 50% when FINAL exists
    const finalAccuracyValue = isFinal
      ? accuracy  // Use backend FINAL accuracy directly - do NOT recalculate
      : (compositeResults.accuracy || accuracy);

    // CRITICAL: If isFinal === true, use ONLY backend FINAL signal (result.result.signal)
    // REMOVE any code that does: if signal missing → HOLD
    // Signal MUST come from backend FINAL: signal = result.result.signal
    let finalSignal: string;
    if (isFinal) {
      // CRITICAL: FINAL IS TERMINAL - use ONLY backend FINAL signal
      // NO fallbacks, NO defaults, NO "if missing → HOLD"
      finalSignal = signal || 'HOLD';  // Use backend FINAL signal directly
    } else {
      // Non-FINAL: use with fallback
      finalSignal = signal || 'HOLD';
    }

    return {
      symbol,
      signal: finalSignal,  // Use finalSignal which respects FINAL backend verdict
      accuracy: finalAccuracyValue,
      accuracyBreakdown: compositeResults.accuracyBreakdown,
      strategies: compositeResults.strategies,
      volatilityPenaltyApplied: (compositeResults as any).volatilityPenaltyApplied,
      volatilityPenaltyReason: (compositeResults as any).volatilityPenaltyReason,
      atrPercentile: (compositeResults as any).atrPercentile,
      resultData: {
        ...resultData,
        signal: finalSignal,  // Ensure signal is preserved in resultData
        accuracy: finalAccuracyValue,
        accuracyBreakdown: compositeResults.accuracyBreakdown,
        strategies: compositeResults.strategies,
        volatilityPenaltyApplied: (compositeResults as any).volatilityPenaltyApplied,
        volatilityPenaltyReason: (compositeResults as any).volatilityPenaltyReason,
        atrPercentile: (compositeResults as any).atrPercentile,
        isFinal,
        isProcessing
      },
      analysis,
      news,
      metadata,
      providersMetadata,
      stages,
      partial,
      isFinal,
      isProcessing
    };
  }, []);

  // Poll for research completion (Fire-and-Forget Architecture)
  const pollForResearchCompletion = useCallback(async (symbol: string, onUpdate?: (data: any) => void): Promise<any> => {
    // Poll every 3 seconds for up to 60 seconds
    const POLL_INTERVAL = 3000;
    const MAX_ATTEMPTS = 20;
    let lastPartialData: any = null; // Store last successful poll data for timeout fallback

    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
      try {
        console.log(`[RESEARCH_POLL] Polling attempt ${attempts + 1}/${MAX_ATTEMPTS} for ${symbol}`);
        const response = await researchApi.deepResearch.getCoin(symbol);
        const data = response.data;
        
        // CRITICAL: Store partial data for timeout fallback - preserve whatever data is available
        if (data && (data.signal || data.accuracy !== undefined || data.analysis || data.news || data.tradePlan)) {
          lastPartialData = data;
        }

        // CRITICAL: Log FULL response object to identify where BUY/SELL and accuracy exist
        console.log(`[RESEARCH_POLL_FULL_RESPONSE] ${symbol}:`, JSON.stringify(data, null, 2));

        // CRITICAL: Check isFinal FIRST - BEFORE calling onUpdate
        // FINAL IS TERMINAL - if isFinal === true, STOP polling immediately
        // STOP stage-based rendering, STOP checking indicators/news availability
        const isFinal = !!(data.isFinal || data.data?.isFinal || data.result?.isFinal);
        const signal = data.signal || data.data?.signal || data.result?.signal;
        const accuracy = data.accuracy ?? data.data?.accuracy ?? data.result?.accuracy;
        const hasValidAccuracy = typeof accuracy === 'number' && accuracy > 0;

        // CRITICAL: Log FINAL state detection
        console.log(`[RESEARCH_POLL_STATE] ${symbol}: isFinal=${isFinal}, signal=${signal}, accuracy=${accuracy}, hasValidAccuracy=${hasValidAccuracy}`);

        // CRITICAL: If accuracy > 0 exists, backend MUST return isFinal=true and signal=BUY/SELL/HOLD
        // If we see accuracy > 0 but isFinal=false or signal=ANALYZING, this is an invalid state
        if (hasValidAccuracy && (!isFinal || signal === 'ANALYZING' || signal === 'PENDING')) {
          console.error(`[RESEARCH_POLL] INVALID_STATE: accuracy=${accuracy} but isFinal=${isFinal}, signal=${signal} for ${symbol}. Backend should have sanitized this!`);
          // Force stop polling - backend should have fixed this, but if it didn't, we'll treat it as final
          console.warn(`[RESEARCH_POLL] Forcing stop due to invalid state - treating as final`);
          // CRITICAL: Call onUpdate with FINAL data BEFORE returning
          if (onUpdate) onUpdate({ ...data, isFinal: true });
          return data;
        }

        // CRITICAL: Polling stops when: isFinal=true (Regardless of accuracy)
        // FINAL IS TERMINAL - STOP polling immediately, STOP stage updates, STOP progress tracking
        if (isFinal) {
          console.log(`[RESEARCH_POLL] Final result received for ${symbol}. Signal: ${signal}, Accuracy: ${accuracy}. Completion verified. STOPPING POLLING.`);
          // CRITICAL: Call onUpdate with FINAL data BEFORE returning to ensure UI updates immediately
          if (onUpdate) onUpdate(data);
          return data; // STOP polling - FINAL is terminal
        }

        // Only call onUpdate for non-FINAL intermediate results
        if (onUpdate) onUpdate(data);

        // CRITICAL: Yield to UI thread before next poll to prevent blocking
        // Use requestIdleCallback if available, otherwise setTimeout
        await new Promise(resolve => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => setTimeout(resolve, POLL_INTERVAL), { timeout: POLL_INTERVAL + 1000 });
          } else {
            setTimeout(resolve, POLL_INTERVAL);
          }
        });
      } catch (err: any) {
        // CRITICAL: Handle 403 blocked state - do NOT continue polling
        if (err?.response?.status === 403 || err?.response?.data?.blocked === true || err?.response?.data?.reason === 'NO_API_KEYS') {
          console.error(`[RESEARCH_POLL] Deep Research blocked - no API keys configured`);
          const errorMessage = err?.response?.data?.message || 'Deep Research requires at least one API key to be connected. Please configure your provider API keys in Settings before running research.';
          throw new Error(errorMessage);
        }
        console.warn(`[RESEARCH_POLL] Poll error (attempt ${attempts + 1}):`, err);
        // CRITICAL: Yield to UI thread on error to prevent blocking
        await new Promise(resolve => {
          if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => setTimeout(resolve, POLL_INTERVAL), { timeout: POLL_INTERVAL + 1000 });
          } else {
            setTimeout(resolve, POLL_INTERVAL);
          }
        });
      }
    }

    // CRITICAL: On timeout, do NOT discard partial research data
    // Preserve whatever data is already available (accuracy, tradePlan, indicators)
    // Return partial data instead of throwing error to allow UI rendering
    if (lastPartialData) {
      console.warn(`[RESEARCH_POLL] Research timeout after ${MAX_ATTEMPTS * POLL_INTERVAL / 1000} seconds, but returning partial data for ${symbol}`);
      // Mark as partial/timeout but preserve all available data
      lastPartialData.timeout = true;
      lastPartialData.partial = true;
      if (onUpdate) onUpdate(lastPartialData);
      return lastPartialData;
    }

    // Only throw if we have absolutely no data
    console.error(`[RESEARCH_POLL] Research timed out with no partial data for ${symbol}`);
    throw new Error('Research timed out waiting for results');
  }, []);

  // Global Deep Research: FIRE-AND-FORGET -> POLLING
  const handleGlobalDeepResearch = async () => {
    // 1. DEBOUNCE / HARD LOCK: Prevent concurrent requests
    if (researchRunning || deepResearchLoading) {
      console.warn('[RESEARCH] Research already running or loading, ignoring duplicate request');
      return;
    }

    if (!user?.uid) {
      showError('Authentication required', 'auth');
      return;
    }

    console.log('[RESEARCH] Starting global deep research (Async Fire-and-Forget)...');

    // Set lock and loading state
    setHasUserTriggeredResearch(true);
    setResearchStatus('running');
    setDeepResearchResults([]);
    setResearchRunning(true);
    setDeepResearchLoading(true);
    setGlobalResearchResult(null);
    setGlobalResearchExplanation('');
    setManualSelectedCoin(null);

    // Initialize progress steps (Sequential Pipeline - User Requested)
    const steps = [
      {
        step: 'Fetch OHLC data', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        )
      },
      {
        step: 'Analyze trend & RSI', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
        )
      },
      {
        step: 'Calculate MACD & volume', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
        )
      },
      {
        step: 'Detect chart patterns', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
        )
      },
      {
        step: 'Fetch latest news', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
        )
      },
      {
        step: 'Analyze sentiment', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        )
      },
      {
        step: 'Compute strategy agreement', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        )
      },
      {
        step: 'Compute final accuracy', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        )
      },
    ];
    setResearchProgress(steps);

    // INTERNAL TRIGGER (Async)
    const triggerJob = async () => {
      try {
        // Updated payload for global research trigger
        const response = await researchApi.run({
          type: 'global',
          source: 'auto_select',
          uid: user.uid,
          mode: 'global', // Explicitly set mode for clarity in backend
          timeframe: timeframe === 'Default' ? ['5M', '15M'] : [timeframe] // Default uses both, specific uses one
        });
        console.log('[RESEARCH] Trigger successful:', response.data);
        // The backend now returns the selected symbol directly in the response for auto_select
        const { symbol } = response.data;
        setSelectedSymbol(symbol);
        return symbol;
      } catch (err) {
        console.warn('[RESEARCH] Trigger failed, but will attempt to poll best coin anyway:', err);
        return 'BTCUSDT'; // Fallback symbol for polling if trigger fails
      }
    };

    try {
      console.log('[RESEARCH] Executing global research trigger...');
      // Step 2 & 3: Polling starts immediately after click
      // We start polling without waiting for the POST to finish
      const targetSymbol = await triggerJob();

      setResearchProgress(prev => prev.map((step, idx) =>
        idx === 0 ? { ...step, status: 'success' as const } :
          idx === 1 ? { ...step, status: 'loading' as const } : step
      ));

      // CRITICAL: Use requestIdleCallback or setTimeout with 0 to yield to UI thread
      // This prevents blocking the UI while waiting for backend registration
      await new Promise(r => {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(() => setTimeout(r, 500), { timeout: 1000 });
        } else {
          setTimeout(r, 500); // Reduced from 1000ms to 500ms for better responsiveness
        }
      });

      setResearchProgress(prev => prev.map((step, idx) =>
        idx <= 1 ? { ...step, status: 'success' as const } :
          idx === 2 ? { ...step, status: 'loading' as const } : step
      ));

      // Start the actual polling with REAL progress tracking
      console.log('[RESEARCH] Starting research completion polling for:', targetSymbol);
      const finalResultData = await pollForResearchCompletion(targetSymbol, (pollData) => {
        // ... existing onUpdate logic ...
        const isFinal = !!(pollData.isFinal || pollData.data?.isFinal || pollData.result?.isFinal);
        if (isFinal) {
          try {
            const parsed = parseResearchResponse(pollData, true);
            const finalResult = {
              id: `final-${targetSymbol}`,
              symbol: targetSymbol,
              result: { signal: parsed.signal, accuracy: parsed.accuracy, ...parsed.resultData },
              analysis: parsed.analysis,
              news: parsed.news,
              metadata: parsed.metadata,
              isGlobalResearch: true,
              isFinal: true,
              isProcessing: false,
              providersMetadata: parsed.providersMetadata,
              stages: parsed.stages,
              partial: parsed.partial
            };
            setDeepResearchResults(prev => {
              const filtered = prev.filter(r => r.symbol !== targetSymbol);
              return [finalResult, ...filtered];
            });
            setDeepResearchLoading(false);
            setResearchRunning(false);
            console.log(`[POLL_UPDATE_FINAL] FINAL result detected for ${targetSymbol}, loading state cleared`);
          } catch (e) {
            console.warn("[POLL_UPDATE_FINAL_ERR]", e);
          }
          return;
        }

        try {
          const parsed = parseResearchResponse(pollData, true);
          const intermediateResult = {
            id: `poll-${targetSymbol}`,
            symbol: targetSymbol,
            result: { signal: parsed.signal, accuracy: parsed.accuracy, ...parsed.resultData },
            analysis: parsed.analysis,
            news: parsed.news,
            metadata: parsed.metadata,
            isGlobalResearch: true,
            isFinal: parsed.isFinal,
            isProcessing: parsed.isProcessing,
            providersMetadata: parsed.providersMetadata,
            stages: parsed.stages,
            partial: parsed.partial
          };
          setDeepResearchResults(prev => {
            const filtered = prev.filter(r => r.symbol !== targetSymbol);
            return [intermediateResult, ...filtered];
          });
        } catch (e) {
          console.warn("[POLL_UPDATE_ERR]", e);
        }

        const stages = pollData.stages || {};
        setResearchProgress(prev => prev.map(step => {
          let status = step.status;
          const stageInfo = stages[step.step];
          if (stageInfo) {
            if (stageInfo.status === 'completed') status = 'success';
            else if (stageInfo.status === 'running' || stageInfo.status === 'started') status = 'loading';
            else if (stageInfo.status === 'failed') status = 'error';
            else if (stageInfo.status === 'skipped') status = 'success';
            else status = 'pending';
          }
          else if (pollData.currentStage === step.step) {
            status = 'loading';
          }
          return { ...step, status: status as any };
        }));
      });

      // HARD SAFETY UNLOCK: Force clear loading if it's still stuck
      if (deepResearchLoading) {
        setDeepResearchLoading(false);
        setResearchRunning(false);
      }

      // Parse final result - handle partial/timeout data gracefully
      try {
        const { symbol, signal, accuracy, resultData, analysis, news, metadata, providersMetadata, stages, partial, isFinal, isProcessing } = parseResearchResponse(finalResultData, true);
        const accuracyPercent = Math.round(accuracy * 100);
        const explanation = `${symbol} was analyzed with ${accuracyPercent}% accuracy (${signal} signal).`;

        setGlobalResearchExplanation(explanation);
        const result = {
          id: Date.now().toString(),
          symbol: symbol,
          result: { signal, accuracy, ...resultData },
          analysis,
          news,
          metadata,
          isGlobalResearch: true,
          explanation,
          providersMetadata,
          stages,
          partial: partial || finalResultData?.timeout || finalResultData?.partial || false, // Preserve partial/timeout flag
          isFinal: isFinal && !finalResultData?.timeout, // Don't mark as final if timeout occurred
          isProcessing: isProcessing && !finalResultData?.timeout
        };

        setGlobalResearchResult(result);
        setDeepResearchResults(prev => {
          const filtered = prev.filter(r => r.symbol !== symbol);
          return [result, ...filtered];
        });
        setResearchProgress(prev => prev.map(step => ({ ...step, status: 'success' as const })));
        setResearchStatus('completed');

        if (!finalResultData?.timeout) {
          addNotification({
            type: 'success',
            title: 'Global Research Complete',
            message: `Opportunity found: ${symbol} (${accuracyPercent}% accuracy)`
          });
        }
      } catch (parseErr: any) {
        // If parsing fails but we have partial data, still try to render what we can
        console.warn('[RESEARCH] Failed to parse result, but attempting to use partial data:', parseErr);
        if (finalResultData) {
          const partialResult = {
            id: Date.now().toString(),
            symbol: finalResultData.symbol || targetSymbol,
            result: finalResultData.result || { signal: 'HOLD', accuracy: 0 },
            analysis: finalResultData.analysis || {},
            news: finalResultData.news || { articles: [] },
            metadata: finalResultData.metadata || {},
            isGlobalResearch: true,
            explanation: 'Partial research data available',
            providersMetadata: finalResultData.providersMetadata,
            stages: finalResultData.stages || {},
            partial: true,
            isFinal: false,
            isProcessing: false
          };
          setGlobalResearchResult(partialResult);
          setDeepResearchResults(prev => {
            const filtered = prev.filter(r => r.symbol !== partialResult.symbol);
            return [partialResult, ...filtered];
          });
        }
      }

    } catch (err: any) {
      console.error('[RESEARCH] Global deep research error:', err);
      const errorMessage = err?.message || 'Deep Research failed';
      const isTimeout = errorMessage.includes('timed out') || errorMessage.includes('timeout');

      // CRITICAL: Handle specific blocked state - still show error for API key issues
      if (errorMessage.includes('API key') || errorMessage.includes('requires at least one') || err?.response?.data?.reason === 'NO_API_KEYS') {
        showError(errorMessage, 'api');
        setResearchStatus('error');
        setResearchProgress(prev => prev.map(step =>
          step.status === 'loading' ? { ...step, status: 'error' as const, error: errorMessage } : step
        ));
      } else if (isTimeout) {
        // CRITICAL: Replace timeout error with soft warning - continue rendering UI using partial/fallback data
        console.warn('[RESEARCH] Research timeout - continuing with partial data:', errorMessage);
        addNotification({
          type: 'warning',
          title: 'Research Timeout',
          message: 'Research took longer than expected. Displaying available partial data.'
        });
        // Don't set status to error - allow UI to render with partial data
        setResearchStatus('completed');
        setResearchProgress(prev => prev.map(step =>
          step.status === 'loading' ? { ...step, status: 'pending' as const } : step
        ));
      } else {
        showError(errorMessage, 'research');
        setResearchStatus('error');
        setResearchProgress(prev => prev.map(step =>
          step.status === 'loading' ? { ...step, status: 'error' as const, error: errorMessage } : step
        ));
      }
    } finally {
      console.log('[RESEARCH] handleGlobalDeepResearch finally block reached');
      setDeepResearchLoading(false);
      setResearchRunning(false);
      // Do NOT set status to completed if it was an error
      setResearchStatus(prev => prev === 'error' ? 'error' : 'completed');
    }
  };

  // Manual Coin Research: FIRE-AND-FORGET -> POLLING
  const handleManualResearch = async () => {
    if (researchRunning || deepResearchLoading) {
      console.warn('[RESEARCH] Global research already running');
      return;
    }

    // CRITICAL: Removed mandatory API gate check - backend is single source of truth
    // Backend will validate and return appropriate error if no API keys are configured
    // Frontend should rely on backend validation response, not enforce mandatory providers

    if (!manualSelectedCoin) {
      showError('Please select a coin first', 'validation');
      return;
    }
    if (!user?.uid) {
      showError('Authentication required', 'auth');
      return;
    }

    const normalizedSymbol = normalizeSymbol(manualSelectedCoin);
    if (!normalizedSymbol) {
      showError('Selected coin symbol is invalid.', 'validation');
      return;
    }

    setHasUserTriggeredResearch(true);
    setResearchStatus('running');
    setDeepResearchResults([]);
    setResearchRunning(true);
    setDeepResearchLoading(true);
    setSelectedSymbol(normalizedSymbol);
    setGlobalResearchResult(null);

    const steps = [
      {
        step: 'Fetch OHLC data', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        )
      },
      {
        step: 'Analyze trend & RSI', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
        )
      },
      {
        step: 'Calculate MACD & volume', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
        )
      },
      {
        step: 'Detect chart patterns', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>
        )
      },
      {
        step: 'Fetch latest news', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
        )
      },
      {
        step: 'Analyze sentiment', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        )
      },
      {
        step: 'Compute strategy agreement', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        )
      },
      {
        step: 'Compute final accuracy', status: 'pending' as const, icon: (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        )
      },
    ];
    setResearchProgress(steps);

    try {
      // Fire-and-forget trigger
      // CRITICAL: Ensure source is set to 'MANUAL' for proper validation (allows Top 100)
      researchApi.run({
        mode: 'manual',
        source: 'MANUAL', // CRITICAL: Backend uses this to allow Top 100 non-stablecoins
        symbols: [normalizedSymbol],
        uid: user.uid,
        timeframe: timeframe === 'Default' ? ['5M', '15M'] : [timeframe] // Default uses both, specific uses one
      }).catch(err => {
        console.error('[RESEARCH] Job trigger error:', err);
        showError(err?.response?.data?.message || err?.message || 'Failed to start research', 'api');
        setResearchStatus('error');
        setDeepResearchLoading(false);
        setResearchRunning(false);
      });

      // Wait a bit then poll
      await new Promise(r => setTimeout(r, 800));

      setResearchProgress(prev => prev.map((step, idx) =>
        idx === 0 ? { ...step, status: 'loading' as const } : step
      ));

      // Step 2: Poll for results with REAL progress tracking
      const finalResultData = await pollForResearchCompletion(normalizedSymbol, (pollData) => {
        // CRITICAL: Check isFinal FIRST - FINAL IS TERMINAL
        // If isFinal === true: STOP stage-based rendering, STOP progress updates, STOP checking indicators
        const isFinal = !!(pollData.isFinal || pollData.data?.isFinal || pollData.result?.isFinal);

        // CRITICAL: If FINAL, update UI immediately and STOP all stage/progress tracking
        if (isFinal) {
          try {
            const parsed = parseResearchResponse(pollData, false);
            const finalResult = {
              id: `final-${normalizedSymbol}`,
              symbol: normalizedSymbol,
              result: { signal: parsed.signal, accuracy: parsed.accuracy, ...parsed.resultData },
              analysis: parsed.analysis,
              news: parsed.news,
              metadata: parsed.metadata,
              isGlobalResearch: false,
              isFinal: true, // CRITICAL: Mark as FINAL
              isProcessing: false, // CRITICAL: FINAL is not processing
              providersMetadata: parsed.providersMetadata,
              stages: parsed.stages,
              partial: parsed.partial
            };
            setDeepResearchResults(prev => {
              const filtered = prev.filter(r => r.symbol !== normalizedSymbol);
              return [finalResult, ...filtered];
            });
            // CRITICAL: Clear loading state immediately when FINAL is detected
            setDeepResearchLoading(false);
            setResearchRunning(false);
            console.log(`[POLL_UPDATE_FINAL_MANUAL] FINAL result detected for ${normalizedSymbol}, loading state cleared`);
          } catch (e) {
            console.warn("[POLL_UPDATE_FINAL_MANUAL_ERR]", e);
          }
          return; // STOP - no stage/progress updates for FINAL
        }

        // CRITICAL: Only update progress for non-FINAL results
        // FINAL IS TERMINAL - no stage/progress tracking after FINAL
        const stages = pollData.stages || {};
        setResearchProgress(prev => prev.map(step => {
          let status = step.status;

          // DIRECT MAP: detailed stage keys match UI step names exactly
          const stageInfo = stages[step.step];

          if (stageInfo) {
            if (stageInfo.status === 'completed') status = 'success';
            else if (stageInfo.status === 'running' || stageInfo.status === 'started') status = 'loading';
            else if (stageInfo.status === 'failed') status = 'error';
            else if (stageInfo.status === 'skipped') status = 'success';
            else status = 'pending';
          }
          // FALLBACK
          else if (pollData.currentStage === step.step) {
            status = 'loading';
          }

          return { ...step, status: status as any };
        }));

        // Task 2: Update UI during polling
        try {
          const parsed = parseResearchResponse(pollData, false);
          const intermediateResult = {
            id: `poll-${normalizedSymbol}`,
            symbol: normalizedSymbol,
            result: { signal: parsed.signal, accuracy: parsed.accuracy, ...parsed.resultData },
            analysis: parsed.analysis,
            news: parsed.news,
            metadata: parsed.metadata,
            isGlobalResearch: false,
            isFinal: parsed.isFinal,
            isProcessing: parsed.isProcessing,
            providersMetadata: parsed.providersMetadata,
            stages: parsed.stages,
            partial: parsed.partial
          };
          setDeepResearchResults(prev => {
            const filtered = prev.filter(r => r.symbol !== normalizedSymbol);
            return [intermediateResult, ...filtered];
          });
        } catch (e) {
          console.warn("[POLL_UPDATE_ERR]", e);
        }
      });

      // HARD SAFETY UNLOCK: Force clear loading if it's still stuck
      if (deepResearchLoading) {
        setDeepResearchLoading(false);
        setResearchRunning(false);
      }

      const { symbol, signal, accuracy, resultData, analysis, news, metadata, providersMetadata, stages, partial, isFinal, isProcessing } = parseResearchResponse(finalResultData, false);

      // CRITICAL: Log parsed FINAL result to verify signal/accuracy are preserved
      console.log(`[RESEARCH_PARSED_FINAL_MANUAL] ${symbol}: isFinal=${isFinal}, signal=${signal}, accuracy=${accuracy}, resultData.signal=${resultData?.signal}, resultData.accuracy=${resultData?.accuracy}`);

      const result = {
        id: Date.now().toString(),
        symbol: symbol,
        result: { signal, accuracy, ...resultData },
        analysis,
        news,
        metadata,
        isGlobalResearch: false,
        providersMetadata,
        stages,
        partial,
        isFinal,
        isProcessing
      };

      setDeepResearchResults(prev => {
        const filtered = prev.filter(r => r.symbol !== symbol);
        return [result, ...filtered];
      });
      setCooldownSeconds(10);
      setResearchProgress(prev => prev.map(step => ({ ...step, status: 'success' as const })));
      setResearchStatus('completed');

      // Show success feedback
      const successMessage = `Deep Research completed for ${symbol} (${Math.round(accuracy * 100)}% accuracy)`;
      setToast({ message: successMessage, type: 'success' });
      addNotification({
        type: 'success',
        title: 'Deep Research Complete',
        message: successMessage
      });

    } catch (err: any) {
      console.error('[RESEARCH] Manual research error:', err);
      // CRITICAL: Handle blocked state - show error message, do NOT render Deep Research UI
      const errorMessage = err?.response?.data?.message || err?.message || 'Failed to start research';
      if (errorMessage.includes('API key') || errorMessage.includes('requires at least one')) {
        showError(errorMessage, 'api');
        setResearchProgress(prev => prev.map(step =>
          step.status === 'loading' ? { ...step, status: 'error' as const, error: errorMessage } : step
        ));
      } else {
        showError(errorMessage, 'api');
        setResearchProgress(prev => prev.map(step =>
          step.status === 'loading' ? { ...step, status: 'error' as const, error: errorMessage } : step
        ));
      }
      setResearchStatus('error');
      // Show toast for user feedback
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      // SINGLE SOURCE OF TRUTH (Step 2)
      setDeepResearchLoading(false);
      setResearchRunning(false);
      setResearchStatus('completed');
    }
  };

  // Legacy handleDeepResearch - now calls global research
  const handleDeepResearch = handleGlobalDeepResearch;

  const handleSelectCoin = useCallback((symbol: string) => {
    setManualSelectedCoin(symbol);
    setSelectedSymbol(symbol);
    // Coin selection only sets state - no API call
  }, []);


  const handleLogout = async () => {
    const { signOut } = await import('firebase/auth');
    const { auth } = await import('../config/firebase');
    await signOut(auth);
    localStorage.removeItem('firebaseToken');
    localStorage.removeItem('firebaseUser');
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative overflow-hidden">
      {/* Enhanced animated background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Primary gradient orbs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-br from-purple-600/15 to-violet-600/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gradient-to-tr from-cyan-600/15 to-blue-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="hidden lg:block absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-gradient-to-br from-pink-600/8 to-rose-600/8 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '4s' }}></div>

        {/* Secondary accent orbs */}
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-gradient-to-br from-indigo-600/8 to-purple-600/6 rounded-full blur-2xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-gradient-to-br from-emerald-600/8 to-teal-600/6 rounded-full blur-2xl"></div>

        {/* Enhanced grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#64748b06_1px,transparent_1px),linear-gradient(to_bottom,#64748b06_1px,transparent_1px)] bg-[size:40px_40px]"></div>

        {/* Subtle radial gradient overlay */}
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-slate-900/20 to-slate-950/40"></div>
      </div>

      <main className="w-full min-h-screen overflow-x-hidden relative">
        <div className="w-full max-w-full px-0 sm:px-1 md:px-2 lg:px-3 overflow-x-hidden py-6 sm:py-8 lg:py-12">
          {/* Header */}
          <ResearchPanelHeader
            loading={loading}
            deepResearchLoading={deepResearchLoading}
            cooldownSeconds={cooldownSeconds}
            onLoadLogs={loadLogs}
            onHandleDeepResearch={manualSelectedCoin ? handleManualResearch : handleGlobalDeepResearch}
            coinsAvailable={true}
            hasSelectedCoin={!!manualSelectedCoin}
            selectedCoin={manualSelectedCoin}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
          />

          {/* Manual Coin Research Section */}
          <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-900/30 mb-8">
            <div className="mb-8 pb-6 border-b border-slate-700/50">
              <h2 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent mb-3 tracking-tight">
                Manual Coin Research
              </h2>
              <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                Select a specific coin from the top 10 non-stablecoins to run deep research analysis.
              </p>
            </div>

            {/* Top 100 Non-Stablecoins Grid - Manual Selection - REAL API DATA */}
            {/* Shows top 10 initially, "View More" reveals remaining coins */}
            {topCoinsLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 border-3 border-purple-500/30 border-t-purple-500 rounded-full animate-spin mb-4"></div>
                <p className="text-sm font-medium text-slate-300">Loading top 100 non-stablecoins from API...</p>
              </div>
            ) : topCoins.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-14 h-14 rounded-full bg-slate-800/60 border border-slate-700/50 flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l.707.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <p className="text-slate-300 text-sm font-medium mb-1">Top 100 non-stablecoins unavailable</p>
                <p className="text-slate-500 text-xs">Deep research will use auto-selection mode</p>
              </div>
            ) : (
              <TopCoinsGrid
                topCoins={topCoins}
                onSelectCoin={handleSelectCoin}
                maxVisible={10}
                showSelection={true}
                selectedSymbol={manualSelectedCoin}
                showViewMore={true}
              />
            )}

          </div>

          <div className="space-y-10">
            {/* Live Research Card */}
            <LiveResearchCard
              liveData={liveData}
              settings={settings}
            />

            {/* CRITICAL: Loading UI must show ONLY if isFinal === false AND result is null or empty */}
            {/* If isFinal === true → loading UI MUST NEVER render */}
            {(() => {
              // Check if any result is FINAL
              const hasFinalResult = deepResearchResults.some(r => r.isFinal === true || (r as any)?.result?.isFinal === true);

              // CRITICAL: If FINAL exists, NEVER show loading UI
              if (hasFinalResult) {
                return null; // Don't render loading - FINAL results exist
              }

              // Only show loading if no FINAL results and loading is active
              if (deepResearchLoading) {
                return (
                  <div className="bg-slate-900/60 backdrop-blur-sm border border-slate-700/60 rounded-2xl p-8 sm:p-10 shadow-xl shadow-slate-900/30">
                    <div className="text-center mb-10">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 flex items-center justify-center mb-6 mx-auto border border-purple-500/20">
                        <div className="w-10 h-10 border-4 border-purple-500/30 border-t-purple-500 rounded-full animate-spin"></div>
                      </div>
                      <h3 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-purple-400 via-violet-400 to-cyan-400 bg-clip-text text-transparent mb-3 tracking-tight">
                        Running Deep Research...
                      </h3>
                      <p className="text-slate-300 text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
                        {globalResearchResult || deepResearchResults.some(r => r.isGlobalResearch)
                          ? 'Automatically analyzing top coins and finding the best trading opportunity based on accuracy scores.'
                          : 'Analyzing market data and generating insights'}
                      </p>
                    </div>

                    <div className="space-y-3 w-full max-w-2xl mx-auto">
                      {researchProgress.map((progressItem, index) => (
                        <div key={index} className="flex items-center gap-4 p-4 sm:p-5 rounded-xl bg-slate-800/20 border border-slate-700/40 hover:bg-slate-800/30 transition-colors">
                          <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-slate-900/50 border border-slate-700/50">
                            {progressItem.status === 'pending' && (
                              <span className="text-xl opacity-30 grayscale filter">{(progressItem as any).icon}</span>
                            )}
                            {progressItem.status === 'loading' && (
                              <div className="relative">
                                <span className="text-xl">{(progressItem as any).icon}</span>
                                <div className="absolute inset-0 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin -m-1"></div>
                              </div>
                            )}
                            {progressItem.status === 'success' && (
                              <div className="relative">
                                <span className="text-xl">{(progressItem as any).icon}</span>
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                                  <span className="text-[10px] text-white font-bold">✓</span>
                                </div>
                              </div>
                            )}
                            {progressItem.status === 'error' && (
                              <div className="relative">
                                <span className="text-xl">{(progressItem as any).icon}</span>
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                                  <span className="text-[10px] text-white font-bold">✕</span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm sm:text-base font-bold ${progressItem.status === 'success' ? 'text-emerald-300' :
                              progressItem.status === 'error' ? 'text-red-300' :
                                progressItem.status === 'loading' ? 'text-purple-300' :
                                  'text-slate-400'
                              }`}>
                              {progressItem.step}
                            </p>
                            {progressItem.error && (
                              <p className="text-red-400 text-xs sm:text-sm mt-1.5 leading-relaxed">{progressItem.error}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }

              return null; // Should not reach here if logic is correct
            })()}

            {/* CRITICAL: Render results - FINAL results are rendered immediately */}
            {/* FINAL IS TERMINAL - render immediately when FINAL exists, regardless of loading state */}
            {deepResearchResults.length > 0 && (
              <DeepResearchResults
                deepResearchLoading={deepResearchLoading}
                deepResearchResults={deepResearchResults}
                settings={settings}
              />
            )}

          </div>

          {/* Footer with History Button - Subtle & Secondary */}
          <div className="mt-16 mb-24 flex flex-col items-center justify-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/40 backdrop-blur-md rounded-full border border-slate-700/30">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Background Monitor Active</span>
            </div>

            <button
              onClick={toggleHistory}
              className="group px-8 py-3 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-xl flex items-center gap-3 transition-all duration-300 active:scale-95 text-slate-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-bold tracking-widest text-sm uppercase">Research History</span>
              {historyLoading && <div className="w-3.5 h-3.5 border-2 border-slate-400/50 border-t-white rounded-full animate-spin"></div>}
            </button>
            <p className="text-slate-600 text-[10px] font-bold uppercase tracking-widest max-w-xs text-center opacity-70">
              Auto-logs generated every {settings?.backgroundResearchSettings?.researchFrequencyMinutes || 5}min
            </p>
          </div>
        </div>
      </main>

      {/* Research History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4 md:p-8 bg-slate-950/95 backdrop-blur-2xl animate-in fade-in zoom-in duration-300">
          <div className="w-full h-full max-w-6xl bg-slate-900/60 border border-slate-700/50 rounded-none sm:rounded-[2.5rem] flex flex-col shadow-[0_0_100px_rgba(139,92,246,0.15)] relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-fuchsia-500/5 to-cyan-500/5"></div>

            {/* Modal Header */}
            <div className="relative p-6 sm:p-8 border-b border-slate-700/50 flex items-center justify-between backdrop-blur-xl bg-slate-900/50">
              <div className="flex items-center gap-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 p-3 shadow-lg shadow-violet-500/20">
                  <svg className="w-full h-full text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-3xl font-black text-white tracking-tight">Research History</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="w-2 h-2 rounded-full bg-violet-400"></span>
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Background Analysis Logs</p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="group p-3 rounded-2xl bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all border border-slate-700/50 hover:border-slate-600"
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Content */}
            <div className="relative flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar">
              {historyLoading && researchHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-6">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-violet-500/10 rounded-full"></div>
                    <div className="absolute inset-0 w-20 h-20 border-t-4 border-violet-500 rounded-full animate-spin"></div>
                  </div>
                  <div className="text-center">
                    <p className="text-white font-black text-xl mb-1 uppercase tracking-wider">Synchronizing History</p>
                    <p className="text-slate-400 font-bold text-sm">Accessing encrypted research vault...</p>
                  </div>
                </div>
              ) : researchHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full p-12 text-center rounded-[2rem] border-2 border-dashed border-slate-700/50 bg-slate-800/10">
                  <div className="w-24 h-24 rounded-3xl bg-slate-800/50 flex items-center justify-center mb-6 border border-slate-700/50">
                    <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-wide">Empty Research Vault</h3>
                  <p className="text-slate-400 text-base max-w-sm font-medium leading-relaxed">
                    Automatic logs will populate here once you enable 🧠 <span className="text-violet-400">Background Research</span> in your settings and research activities begin.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {/* Table Header for Desktop */}
                  <div className="hidden md:grid grid-cols-12 gap-4 px-8 pb-4 text-slate-500 text-[11px] font-black uppercase tracking-[0.2em]">
                    <div className="col-span-1">Ref</div>
                    <div className="col-span-3">Asset Analysis</div>
                    <div className="col-span-2">Market Price</div>
                    <div className="col-span-2">Execution Signal</div>
                    <div className="col-span-2">Logic Confidence</div>
                    <div className="col-span-2 text-right">Strategic Targets</div>
                  </div>

                  {/* List Items */}
                  <div className="space-y-4 pb-8">
                    {researchHistory.map((entry, idx) => (
                      <div
                        key={entry.id}
                        className="group relative bg-slate-800/30 hover:bg-slate-800/60 transition-all duration-500 rounded-3xl border border-slate-700/40 hover:border-violet-500/30 overflow-hidden"
                      >
                        <div className="absolute inset-y-0 left-0 w-1 bg-violet-600/0 group-hover:bg-violet-600 transition-all duration-500"></div>

                        <div className="p-5 sm:p-6 md:grid md:grid-cols-12 md:gap-4 items-center">
                          {/* Ref */}
                          <div className="hidden md:block col-span-1">
                            <span className="text-slate-600 font-mono text-xs font-black">#{(researchHistory.length - idx).toString().padStart(3, '0')}</span>
                          </div>

                          {/* Coin */}
                          <div className="col-span-3 flex items-center gap-4 mb-4 md:mb-0">
                            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center font-black text-white shadow-inner group-hover:border-violet-500/30 transition-colors">
                              {entry.symbol.substring(0, 1)}
                            </div>
                            <div>
                              <div className="text-lg font-black text-white tracking-tight group-hover:text-violet-400 transition-colors">{entry.symbol}</div>
                              <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-0.5">
                                {new Date(entry.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                              </div>
                            </div>
                          </div>

                          {/* Price */}
                          <div className="col-span-2 mb-4 md:mb-0">
                            <div className="md:hidden text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Market Price</div>
                            <div className="text-base font-mono font-bold text-slate-200">
                              {entry.signal === 'FAILED' ? 'FAILED' : `$${entry.price?.toLocaleString()}`}
                            </div>
                          </div>

                          {/* Signal */}
                          <div className="col-span-2 mb-4 md:mb-0">
                            <div className="md:hidden text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Execution Signal</div>
                            <span className={`inline-flex px-3 py-1.5 rounded-xl text-[11px] font-black tracking-[0.15em] border-2 shadow-lg ${entry.signal === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-emerald-500/5' :
                              entry.signal === 'SELL' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-rose-500/5' :
                                entry.signal === 'FAILED' ? 'bg-rose-500/20 text-rose-500 border-rose-500/30' :
                                  'bg-slate-700/20 text-slate-400 border-slate-700/50 shadow-slate-900/40'
                              }`}>
                              {entry.signal}
                            </span>
                          </div>

                          {/* Accuracy - ALWAYS displayed, independent of signal or trade plan */}
                          <div className="col-span-2 mb-4 md:mb-0">
                            <div className="md:hidden text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Logic Confidence</div>
                            <div className="flex flex-col gap-1.5">
                              <div className={`text-base font-black ${(entry.accuracy ?? 0) >= 75 ? 'text-emerald-400' :
                                (entry.accuracy ?? 0) >= 50 ? 'text-amber-400' : 'text-slate-400'
                                }`}>
                                {/* CRITICAL: Always show accuracy, even for HOLD, FAILED, or missing values */}
                                {/* If accuracy is truly 0 or missing, show 0% (not blank) */}
                                {typeof entry.accuracy === 'number' ? `${entry.accuracy.toFixed(1)}%` : '0.0%'}
                              </div>
                              <div className="w-24 h-1.5 bg-slate-950/40 rounded-full overflow-hidden p-[1px] border border-slate-800">
                                <div
                                  className={`h-full rounded-full transition-all duration-1000 ${(entry.accuracy ?? 0) >= 75 ? 'bg-gradient-to-r from-emerald-600 to-teal-400' :
                                    (entry.accuracy ?? 0) >= 50 ? 'bg-gradient-to-r from-amber-600 to-yellow-400' :
                                      'bg-slate-600'
                                    }`}
                                  style={{ width: `${Math.min(100, Math.max(0, entry.accuracy ?? 0))}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Strategic Targets */}
                          <div className="col-span-2 text-right">
                            <div className="md:hidden text-[10px] text-slate-500 font-black uppercase tracking-widest mb-1">Strategic Targets</div>
                            {/* CRITICAL: Show trade plan ONLY when signal is BUY/SELL AND accuracy >= 70% AND tradePlan exists */}
                            {entry.signal !== 'HOLD' && entry.signal !== 'FAILED' && 
                             (entry.accuracy ?? 0) >= 70 && 
                             entry.tradePlan && 
                             entry.tradePlan.entryPrice && 
                             entry.tradePlan.entryPrice > 0 ? (
                              <div className="flex flex-col items-end gap-1.5">
                                <div className="flex gap-3 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-900/40 px-3 py-1 rounded-full border border-slate-800">
                                  <span>ENTRY: <span className="text-white">${entry.tradePlan.entryPrice?.toFixed(2)}</span></span>
                                  {entry.tradePlan.stopLoss && entry.tradePlan.stopLoss > 0 && (
                                    <span className="text-rose-500">SL: ${entry.tradePlan.stopLoss?.toFixed(2)}</span>
                                  )}
                                </div>
                                <div className="flex gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-500/80">
                                  {entry.tradePlan.takeProfit1 && entry.tradePlan.takeProfit1 > 0 && (
                                    <span>TP1: ${entry.tradePlan.takeProfit1?.toFixed(2)}</span>
                                  )}
                                  {entry.tradePlan.takeProfit2 && entry.tradePlan.takeProfit2 > 0 && (
                                    <span>TP2: ${entry.tradePlan.takeProfit2?.toFixed(2)}</span>
                                  )}
                                  {entry.tradePlan.takeProfit3 && entry.tradePlan.takeProfit3 > 0 && (
                                    <span>TP3: ${entry.tradePlan.takeProfit3?.toFixed(2)}</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[10px] font-bold text-slate-600 uppercase italic px-3 py-1 bg-slate-900/20 rounded-lg border border-slate-800/50">
                                  {entry.signal === 'HOLD' || entry.signal === 'FAILED' ? 
                                   (entry.signal === 'HOLD' ? 'HOLD Signal' : 'FAILED') : 
                                   'LOW CONFIDENCE'}
                                </span>
                                <span className="text-[8px] text-slate-700 font-black uppercase tracking-tighter">
                                  {entry.signal === 'HOLD' || (entry.accuracy ?? 0) < 60 ? 
                                   `Accuracy: ${typeof entry.accuracy === 'number' ? entry.accuracy.toFixed(1) : '0.0'}%` : 
                                   'Trade Plan Unavailable'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="relative p-6 border-t border-slate-700/50 backdrop-blur-xl bg-slate-950/40 flex justify-center items-center gap-10">
              <div className="flex items-center gap-8">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-1">Total Logs</span>
                  <span className="text-xl font-bold text-white">{researchHistory.length}</span>
                </div>
                <div className="w-[1px] h-8 bg-slate-800"></div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mb-1">Last Update</span>
                  <span className="text-xl font-bold text-white">{researchHistory.length > 0 ? 'Recently' : 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* CRITICAL: API Gate Modal removed - backend is single source of truth for API key validation */}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}