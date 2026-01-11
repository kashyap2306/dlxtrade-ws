import axios from 'axios';
import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { getUserIntegrations } from '../routes/integrations';
import { FreeModeDeepResearchResult } from './researchTypes';

// Cache for top coins (module-level fallback)
export let cachedTop50Coins: any[] = [];

// CRITICAL: Stablecoin exclusion list - MUST be excluded from all trading/research
const STABLECOIN_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDE',
  'USDTUSDT', 'USDCUSDT', 'DAIUSDT', 'BUSDUSDT', 'TUSDUSDT', 'FDUSDUSDT', 'USDEUSDT'
]);

/**
 * Check if a coin is a stablecoin
 * CRITICAL: Excludes USDT, USDC, DAI, BUSD, TUSD, FDUSD, USDE and any coin with stablecoin in name
 */
function isStablecoin(coin: any): boolean {
  if (!coin) return false;
  const symbol = (coin.symbol || '').toUpperCase();
  const name = (coin.name || '').toUpperCase();

  // Direct symbol match (e.g., "USDT", "USDC")
  if (STABLECOIN_SYMBOLS.has(symbol)) return true;

  // Check if base symbol (before USDT/USDC/etc) is a stablecoin
  // Example: "USDTUSDT" -> base is "USDT" -> stablecoin
  // Example: "BTCUSDT" -> base is "BTC" -> NOT stablecoin
  for (const stable of ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDE']) {
    if (symbol.endsWith(stable) && symbol.length > stable.length) {
      const baseSymbol = symbol.slice(0, -stable.length);
      if (STABLECOIN_SYMBOLS.has(baseSymbol)) return true;
    }
  }

  // Check name for stablecoin keywords
  const stablecoinKeywords = ['STABLECOIN', 'STABLE COIN', 'USD PEGGED', 'FIAT PEGGED'];
  if (stablecoinKeywords.some(keyword => name.includes(keyword))) return true;

  return false;
}

/**
 * Filter out stablecoins from coin list
 * EXPORTED for use in routes
 */
export function filterStablecoins(coins: any[]): any[] {
  return coins.filter(coin => !isStablecoin(coin));
}

/**
 * Filter out invalid symbols that are not clean USDT perpetuals
 * Excludes wrapped, synthetic, alias, or spot-only symbols
 */
function filterInvalidSymbols(coins: any[]): any[] {
  return coins.filter(coin => {
    if (!coin || !coin.symbol) return false;
    const symbol = coin.symbol.toUpperCase();

    // Exclude invalid symbol patterns
    const invalidPatterns = [
      /^FIGR_/,  // FIGR_ prefixed symbols
      /^W/,      // W prefixed symbols (wrapped)
      /^WB/,     // WB prefixed symbols (Binance wrapped)
      /^ST/,     // ST prefixed symbols (synthetic)
      /^USDS/,   // USDS prefixed symbols
      /^BSC-/,   // BSC- prefixed symbols
    ];

    // Check if symbol matches any invalid pattern
    if (invalidPatterns.some(pattern => pattern.test(symbol))) {
      return false;
    }

    // Ensure symbol ends with USDT (perpetual style)
    return symbol.endsWith('USDT');
  });
}

// P1 FIX: Coin rotation cooldown (15 minutes)
const coinRotationCooldown = new Map<string, number>();
const ROTATION_COOLDOWN_MS = 15 * 60 * 1000;

// CRITICAL: Per-user cooldown for auto-select (prevents repeated selection of same coin)
// Format: `${uid}:${symbol}` -> timestamp
const autoSelectCooldown = new Map<string, number>();
const AUTO_SELECT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours - prevent same coin selection

// Coin cooldown map to prevent repeated selection (Coin -> LastSelectedTimestamp)
const coinCooldowns = new Map<string, number>();
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown

/**
 * Get top 25 coins by market cap for deep research (RESTRICTED TO TOP 25)
 * REFACTORED: Implementation of stale-while-revalidate pattern to guarantee < 2s response
 * CRITICAL: System is restricted to ONLY top 25 high-liquidity non-stablecoins by market cap (single source of truth)
 */
let lastFetchTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes list cache
let isFetchingTopCoins = false;
const TOP_COINS_LIMIT = 25; // HARD LIMIT: Top 25 high-liquidity non-stablecoins (single source of truth)

export async function getTop100Coins(uid: string, limit: number = TOP_COINS_LIMIT): Promise<any[]> {
  // CRITICAL: Enforce top 25 limit - never exceed (single source of truth)
  const enforcedLimit = Math.min(limit, TOP_COINS_LIMIT);
  const now = Date.now();

  try {
    // CRITICAL FIX: Use MIN_THRESHOLD instead of requiring exactly enforcedLimit
    const MIN_THRESHOLD = 5;
    
    // 1. FAST PATH: Return cached data immediately if fresh enough (within 10 mins)
    // CRITICAL: Ensure cached coins are non-stablecoins (re-filter if needed)
    if (cachedTop50Coins.length >= MIN_THRESHOLD && (now - lastFetchTime < CACHE_TTL)) {
      const filtered = filterStablecoins(cachedTop50Coins);
      if (filtered.length >= MIN_THRESHOLD) {
        logger.info({ uid, limit: enforcedLimit, cacheAge: now - lastFetchTime, top25Count: filtered.length }, '✅ [TOP_25_LOADED] Serving Top 25 non-stablecoins from global cache (FRESH)');
        return filtered.slice(0, Math.min(enforcedLimit, filtered.length));
      }
    }

    // 2. BACKGROUND REFRESH: If cache exists but stale, return it and trigger background refresh
    if (cachedTop50Coins.length >= MIN_THRESHOLD && !isFetchingTopCoins) {
      const filtered = filterStablecoins(cachedTop50Coins);
      if (filtered.length >= MIN_THRESHOLD) {
        logger.info({ uid, limit: enforcedLimit, cacheAge: now - lastFetchTime, top25Count: filtered.length }, '✅ [TOP_25_LOADED] Serving Top 25 non-stablecoins from global cache (STALE), triggering background refresh');

        // Trigger background refresh (don't await)
        isFetchingTopCoins = true;
        (async () => {
          try {
            await refreshTop100Coins(uid);
          } catch (err) {
            logger.error({ error: (err as any).message }, 'Background Top 25 refresh failed');
          } finally {
            isFetchingTopCoins = false;
          }
        })();

        return filtered.slice(0, Math.min(enforcedLimit, filtered.length));
      }
    }

    // 3. COLD START / NO CACHE: Perform synchronous fetch with strict timeout
    if (isFetchingTopCoins) {
      // If already fetching, wait a bit then return whatever we have
      await new Promise(resolve => setTimeout(resolve, 500));
      const filtered = filterStablecoins(cachedTop50Coins);
      if (filtered.length > 0) return filtered.slice(0, enforcedLimit);
    }

    isFetchingTopCoins = true;
    try {
      const coins = await refreshTop100Coins(uid);
      // CRITICAL: Ensure returned coins are non-stablecoins
      const filtered = filterStablecoins(coins);
      // CRITICAL FIX: Do NOT require exactly 25 coins - use MIN_THRESHOLD (5 coins minimum)
      // If filtered non-stablecoins >= MIN_THRESHOLD, return available coins
      // NEVER return empty array if usable coins exist
      const MIN_THRESHOLD = 5;
      if (filtered.length < MIN_THRESHOLD) {
        logger.warn({ uid, filteredCount: filtered.length, minThreshold: MIN_THRESHOLD }, 'Insufficient non-stablecoins after filtering - below minimum threshold');
        return [];
      }
      // Return available coins (up to enforcedLimit, but allow fewer if >= MIN_THRESHOLD)
      return filtered.slice(0, Math.min(enforcedLimit, filtered.length));
    } finally {
      isFetchingTopCoins = false;
    }

  } catch (error) {
    logger.error({ uid, error: (error as any).message }, 'Error in getTop100Coins');
    // CRITICAL FIX: Use MIN_THRESHOLD instead of requiring exactly enforcedLimit
    const MIN_THRESHOLD = 5;
    const filtered = filterStablecoins(cachedTop50Coins);
    if (filtered.length < MIN_THRESHOLD) {
      logger.warn({ uid, filteredCount: filtered.length, minThreshold: MIN_THRESHOLD }, 'No cached non-stablecoins available - below minimum threshold');
      return [];
    }
    // Return available coins (up to enforcedLimit, but allow fewer if >= MIN_THRESHOLD)
    return filtered.slice(0, Math.min(enforcedLimit, filtered.length));
  }
}

/**
 * Internal helper to actually fetch from providers with strict timeouts
 * CRITICAL: Only fetches top 25 coins by market cap (single source of truth)
 */
async function refreshTop100Coins(uid: string): Promise<any[]> {
  try {
    const integrationsResult: any = await getUserIntegrations(uid);
    const integrations = integrationsResult?.providerConfig || {};

    const hasAnyApiKey =
      (integrations.marketData && Object.values(integrations.marketData).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
      (integrations.news && Object.values(integrations.news).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
      (integrations.metadata && Object.values(integrations.metadata).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0));

    if (!hasAnyApiKey) {
      logger.warn({ uid }, 'refreshTop100Coins blocked - no API keys');
      return [];
    }

    // Try CoinMarketCap with STRICT 3s timeout - ONLY fetch top 25
    try {
      const cmcApiKey =
        integrations?.metadata?.coinmarketcap?.apiKey ||
        integrations?.marketData?.coinmarketcap?.apiKey ||
        integrations?.coinmarketcap?.apiKey;

      if (cmcApiKey) {
        const { fetchCoinMarketCapListings } = await import('./coinMarketCapAdapter');
        // CRITICAL: Only fetch top 25 coins
        const cmcData = await Promise.race([
          fetchCoinMarketCapListings(cmcApiKey, TOP_COINS_LIMIT),
          new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('CMC Timeout')), 3000))
        ]);

        if (cmcData && cmcData.length > 0) {
          const normalized = cmcData.map((coin: any, index: number) => ({
            symbol: `${coin.symbol}USDT`,
            name: coin.name,
            logo: coin.logo || `https://assets.coingecko.com/coins/images/${coin.id}/small/${coin.symbol.toLowerCase()}.png`,
            marketCap: coin.quote?.USD?.market_cap || 0,
            rank: coin.cmc_rank || (index + 1),
            current_price: coin.quote?.USD?.price || 0,
            price_change_percentage_24h: coin.quote?.USD?.percent_change_24h || 0,
            thumbnail: coin.logo || `https://assets.coingecko.com/coins/images/${coin.id}/small/${coin.symbol.toLowerCase()}.png`
          }));

        // CRITICAL: Filter out stablecoins FIRST, then filter invalid symbols, then take top 25
        const nonStablecoins = filterStablecoins(normalized);
        const validSymbols = filterInvalidSymbols(nonStablecoins);
        // Sort by market cap (descending) and take top 25
        const sortedByMarketCap = validSymbols.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
        cachedTop50Coins = sortedByMarketCap.slice(0, TOP_COINS_LIMIT);
        lastFetchTime = Date.now();

        logger.info({ uid, totalFetched: normalized.length, stablecoinsFiltered: normalized.length - nonStablecoins.length, invalidSymbolsFiltered: nonStablecoins.length - validSymbols.length, top25Count: cachedTop50Coins.length }, '✅ [TOP_25_CACHED] Top 25 valid non-stablecoins cached (CMC)');
        return cachedTop50Coins;
        }
      }
    } catch (error) {
      logger.warn({ error: (error as any).message }, 'CMC list fetch failed or timed out');
    }

    // Try CoinGecko with STRICT 5s timeout - ONLY fetch top 25
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: TOP_COINS_LIMIT, // CRITICAL: Only fetch top 25
          page: 1,
          sparkline: false,
          price_change_percentage: '24h'
        },
        timeout: 5000
      });

      if (response.data && response.data.length > 0) {
        const normalized = response.data.map((coin: any, index: number) => ({
          symbol: `${coin.symbol.toUpperCase()}USDT`,
          name: coin.name,
          logo: coin.image,
          marketCap: coin.market_cap,
          rank: index + 1,
          current_price: coin.current_price,
          price_change_percentage_24h: coin.price_change_percentage_24h,
          thumbnail: coin.image
        }));

        // CRITICAL: Filter out stablecoins FIRST, then filter invalid symbols, then take top 25
        const nonStablecoins = filterStablecoins(normalized);
        const validSymbols = filterInvalidSymbols(nonStablecoins);
        // Sort by market cap (descending) and take top 25
        const sortedByMarketCap = validSymbols.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
        cachedTop50Coins = sortedByMarketCap.slice(0, TOP_COINS_LIMIT);
        lastFetchTime = Date.now();

        logger.info({ uid, totalFetched: normalized.length, stablecoinsFiltered: normalized.length - nonStablecoins.length, invalidSymbolsFiltered: nonStablecoins.length - validSymbols.length, top25Count: cachedTop50Coins.length }, '✅ [TOP_25_CACHED] Top 25 valid non-stablecoins cached (CoinGecko)');
        return cachedTop50Coins;
      }
    } catch (error) {
      logger.warn({ error: (error as any).message }, 'CoinGecko list fetch failed');
    }

    // SAFETY: If market-cap data unavailable, return empty array (skip cycle)
    const filtered = filterStablecoins(cachedTop50Coins);
    if (filtered.length === 0) {
      logger.warn({ uid }, 'No market-cap data available for non-stablecoins - skipping cycle safely');
      return [];
    }

    // Return existing cache if all providers fail, but limit to top 25 non-stablecoins
    logger.warn({ uid, top25Count: filtered.length }, '⚠️ [TOP_25_FALLBACK] Using cached Top 25 non-stablecoins (all providers failed)');
    return filtered.slice(0, TOP_COINS_LIMIT);
  } catch (err) {
    logger.error({ error: (err as any).message }, 'Fatal error in refreshTop100Coins');
    // SAFETY: If error, return empty array to skip cycle
    const filtered = filterStablecoins(cachedTop50Coins);
    const result = filtered.length > 0 ? filtered.slice(0, TOP_COINS_LIMIT) : [];
    logger.warn({ uid, top25Count: result.length }, '⚠️ [TOP_25_ERROR] Fatal error - returning filtered Top 25 or empty array');
    return result;
  }
}


/**
 * Get top 50 coins (backward compatibility)
 * CRITICAL: Now restricted to top 10 coins only
 */
export async function getTop50Coins(uid: string): Promise<any[]> {
  return getTop100Coins(uid, TOP_COINS_LIMIT);
}

/**
 * Get top 10 non-stablecoins (for auto-trade + auto UI)
 * CRITICAL: Used by auto-trade, Telegram alerts, and auto-selection
 */
export async function getTop10NonStablecoins(uid: string): Promise<any[]> {
  return getTop100Coins(uid, TOP_COINS_LIMIT);
}

/**
 * Get top 100 non-stablecoins (for manual research UI)
 * CRITICAL: Used by manual research UI - allows broader coin selection
 */
export async function getTop100NonStablecoins(uid: string): Promise<any[]> {
  const now = Date.now();

  try {
    // Use existing cache but fetch more coins if needed
    if (cachedTop50Coins.length >= 100 && (now - lastFetchTime < CACHE_TTL)) {
      const filtered = filterStablecoins(cachedTop50Coins);
      logger.info({ uid, count: filtered.length, cacheAge: now - lastFetchTime }, 'Serving Top 100 non-stablecoins from cache (FRESH)');
      return filtered.slice(0, 100);
    }

    // If cache has less than 100, fetch more
    if (cachedTop50Coins.length < 100 || (now - lastFetchTime >= CACHE_TTL)) {
      if (!isFetchingTopCoins) {
        isFetchingTopCoins = true;
        try {
          // Fetch top 100 from providers
          const integrationsResult: any = await getUserIntegrations(uid);
          const integrations = integrationsResult?.providerConfig || {};

          const hasAnyApiKey =
            (integrations.marketData && Object.values(integrations.marketData).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
            (integrations.news && Object.values(integrations.news).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
            (integrations.metadata && Object.values(integrations.metadata).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0));

          if (!hasAnyApiKey) {
            logger.warn({ uid }, 'getTop100NonStablecoins blocked - no API keys');
            return filterStablecoins(cachedTop50Coins).slice(0, 100);
          }

          // Try CoinMarketCap first
          try {
            const cmcApiKey =
              integrations?.metadata?.coinmarketcap?.apiKey ||
              integrations?.marketData?.coinmarketcap?.apiKey ||
              integrations?.coinmarketcap?.apiKey;

            if (cmcApiKey) {
              const { fetchCoinMarketCapListings } = await import('./coinMarketCapAdapter');
              const cmcData = await Promise.race([
                fetchCoinMarketCapListings(cmcApiKey, 100),
                new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('CMC Timeout')), 3000))
              ]);

              if (cmcData && cmcData.length > 0) {
                const normalized = cmcData.map((coin: any, index: number) => ({
                  symbol: `${coin.symbol}USDT`,
                  name: coin.name,
                  logo: coin.logo || `https://assets.coingecko.com/coins/images/${coin.id}/small/${coin.symbol.toLowerCase()}.png`,
                  marketCap: coin.quote?.USD?.market_cap || 0,
                  rank: coin.cmc_rank || (index + 1),
                  current_price: coin.quote?.USD?.price || 0,
                  price_change_percentage_24h: coin.quote?.USD?.percent_change_24h || 0,
                  thumbnail: coin.logo || `https://assets.coingecko.com/coins/images/${coin.id}/small/${coin.symbol.toLowerCase()}.png`
                }));

                const nonStablecoins = filterStablecoins(normalized);
                const sortedByMarketCap = nonStablecoins.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
                cachedTop50Coins = sortedByMarketCap; // Update cache with full list
                lastFetchTime = Date.now();

                logger.info({ uid, totalFetched: normalized.length, stablecoinsFiltered: normalized.length - nonStablecoins.length, top100Count: sortedByMarketCap.length }, 'Top 100 non-stablecoins cached (CMC)');
                return sortedByMarketCap.slice(0, 100);
              }
            }
          } catch (error) {
            logger.warn({ error: (error as any).message }, 'CMC list fetch failed for top 100');
          }

          // Try CoinGecko fallback
          try {
            const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
              params: {
                vs_currency: 'usd',
                order: 'market_cap_desc',
                per_page: 100,
                page: 1,
                sparkline: false,
                price_change_percentage: '24h'
              },
              timeout: 5000
            });

            if (response.data && response.data.length > 0) {
              const normalized = response.data.map((coin: any, index: number) => ({
                symbol: `${coin.symbol.toUpperCase()}USDT`,
                name: coin.name,
                logo: coin.image,
                marketCap: coin.market_cap,
                rank: index + 1,
                current_price: coin.current_price,
                price_change_percentage_24h: coin.price_change_percentage_24h,
                thumbnail: coin.image
              }));

              const nonStablecoins = filterStablecoins(normalized);
              const sortedByMarketCap = nonStablecoins.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
              cachedTop50Coins = sortedByMarketCap; // Update cache
              lastFetchTime = Date.now();

              logger.info({ uid, totalFetched: normalized.length, stablecoinsFiltered: normalized.length - nonStablecoins.length, top100Count: sortedByMarketCap.length }, 'Top 100 non-stablecoins cached (CoinGecko)');
              return sortedByMarketCap.slice(0, 100);
            }
          } catch (error) {
            logger.warn({ error: (error as any).message }, 'CoinGecko list fetch failed for top 100');
          }
        } finally {
          isFetchingTopCoins = false;
        }
      }
    }

    // Return filtered cache
    const filtered = filterStablecoins(cachedTop50Coins);
    return filtered.slice(0, 100);
  } catch (error) {
    logger.error({ uid, error: (error as any).message }, 'Error in getTop100NonStablecoins');
    const filtered = filterStablecoins(cachedTop50Coins);
    return filtered.slice(0, 100);
  }
}

/**
 * Transform FreeModeDeepResearchResult to include analysis structure
 * This is used to ensure cached results always have the analysis field
 */
export function transformResearchResultWithAnalysis(result: FreeModeDeepResearchResult, symbol: string): any {
  const indicators = result.indicators || {} as any;
  const marketDataResult = result.providers.marketData;
  const metadataResult = result.providers.metadata;
  const newsResult = result.providers.news;
  const providerUsage = (result as any).providersMetadata?.providersUsed || {};
  // Collect coin images from multiple sources
  const coinImages: string[] = [];

  // 1. From metadata logo
  if ((result.metadata as any)?.logo) {
    coinImages.push((result.metadata as any).logo);
  }

  // 2. From structuredAnalysis images (if available)
  if (result.structuredAnalysis?.images && Array.isArray(result.structuredAnalysis.images)) {
    result.structuredAnalysis.images.forEach((img: string) => {
      if (img && !coinImages.includes(img)) {
        coinImages.push(img);
      }
    });
  }

  // 3. From result.images (if available)
  if ((result as any).images && Array.isArray((result as any).images)) {
    (result as any).images.forEach((img: string) => {
      if (img && !coinImages.includes(img)) {
        coinImages.push(img);
      }
    });
  }
  const stages = (result as any).stages || {};
  const news = result.news?.articles && Array.isArray(result.news.articles) ? result.news.articles :
    (Array.isArray(result.news) ? result.news : []);

  // TASK 7: Use consolidated analysis structure from result
  // This eliminates duplicate logic and ensures a single source of truth
  const analysis = (result as any).analysis || {};

  const finalResult = {
    marketData: marketDataResult,
    metadata: metadataResult,
    news: news,
    coinImages,
    providerUsage,
    deepResearchResult: result,
    status: result.isFinal ? 'completed' :
      result.isProcessing ? 'running' :
        Object.values(stages).some((s: any) => s.status === 'running') ? 'running' : 'completed',
    currentStage: Object.keys(stages).find(name => stages[name].status === 'running') || (result.isFinal ? 'Finished' : 'Processing'),
    stages: stages,
    tradePlan: result.tradePlan || null,
    analysis,
    signal: result.signal,
    accuracy: result.accuracy,
    isFinal: result.isFinal,
    isProcessing: result.isProcessing,
  };

  return finalResult;
}

/**
 * Get comprehensive research data for a specific coin
 */
export async function getCoinResearch(
  uid: string,
  symbol: string,
  runFreeMode: (uid: string, symbol: string, providerConfigs?: any, integrations?: any, backgroundMode?: boolean, timeoutMs?: number, onUpdate?: (data: any) => Promise<void>) => Promise<FreeModeDeepResearchResult>,
  source?: string,
  onUpdate?: (data: any) => Promise<void>
): Promise<any> {
  const startTime = Date.now();
  try {
    logger.info({ uid, symbol, source }, 'Starting comprehensive coin research via DeepResearchEngine');

    // CRITICAL: Determine backgroundMode from source parameter
    // Manual research (no source or 'manual') = user_request context (backgroundMode: false)
    // Background/scheduled research = background_job context (backgroundMode: true)
    const isManualResearch = !source || source === 'manual' || source === 'user_request';
    const backgroundMode = !isManualResearch; // Manual = false, Background = true

    // Use the robust Free Mode engine to get all data + indicators
    // CRITICAL: Don't pass integrations - let engine call getUserIntegrationsByUid with correct context
    const result = await runFreeMode(uid, symbol, undefined, undefined, backgroundMode, 35000, onUpdate);

    const totalLatency = Date.now() - startTime;
    logger.info({ uid, symbol, totalLatency }, 'Coin research completed (powered by DeepResearchEngine)');

    // Use the transformation helper to ensure analysis structure
    const returnObj = transformResearchResultWithAnalysis(result, symbol);
    return returnObj;

  } catch (error: any) {
    logger.error({ uid, symbol, error: error.message }, 'Error in coin research');
    // CRITICAL: Do NOT throw - return safe fallback result instead (FreeMode must never throw)
    return {
      marketData: { success: false, data: null, error: error.message },
      metadata: { success: false, data: null, error: error.message },
      news: { success: false, data: null, error: error.message },
      coinImages: [],
      analysisSummary: {
        rsi: 50,
        maSignal: 'neutral',
        volatility: 'medium',
        signals: {
          momentum: 'neutral',
          trend: 'neutral',
          risk: 'medium'
        },
        summary: `Research failed for ${symbol}: ${error.message}`
      },
      providerUsage: {
        marketData: { provider: 'none', success: false },
        metadata: { provider: 'none', success: false },
        news: { provider: 'none', success: false }
      },
      deepResearchResult: {
        signal: 'HOLD',
        accuracy: 0,
        indicators: {},
        metadata: { name: symbol.replace('USDT', ''), symbol: symbol },
        news: []
      },
      // Ensure specific failed flags for UI
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Select coins for research based on trading settings
 * P1 FIX: Added volatility-based selection and removed hardcoded list loops
 */
export async function selectCoinsForResearch(uid: string): Promise<string[]> {
  try {
    // CRITICAL: Check if user has at least one API key before auto-selecting
    // NO auto-select when no API keys - block must be absolute
    const integrationsResult: any = await getUserIntegrations(uid);
    const integrations = integrationsResult?.providerConfig || {};
    const hasAnyApiKey =
      (integrations.marketData && Object.values(integrations.marketData).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
      (integrations.news && Object.values(integrations.news).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
      (integrations.metadata && Object.values(integrations.metadata).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0));

    if (!hasAnyApiKey) {
      logger.warn({ uid }, 'selectCoinsForResearch blocked - no API keys configured');
      return []; // Return empty array - NO auto-select when blocked
    }

    // Get trading settings
    const tradingSettings = await firestoreAdapter.getTradingSettings(uid);

    if (!tradingSettings) {
      // Default to manual mode with some coins
      return ['ETHUSDT', 'SOLUSDT'];
    }

    const coinSelectionMode = tradingSettings.coinSelectionMode ||
      (tradingSettings.mode === 'MANUAL' ? 'manual' :
        tradingSettings.mode === 'TOP_100' ? 'top100' : 'top10');

    const selectedCoins = tradingSettings.selectedCoins || tradingSettings.manualCoins || [];

    if (coinSelectionMode === 'manual') {
      // CRITICAL: Manual coins must be from top 25 non-stablecoins only
      const top25 = await getTop100Coins(uid, TOP_COINS_LIMIT);
      const top25Symbols = new Set(top25.map(c => c.symbol.toUpperCase()));
      logger.info({ uid, top25Count: top25.length }, '✅ [TOP_25_LOADED] Top 25 non-stablecoins loaded for manual coin validation');

      // Filter manual coins to only include those in top 25 non-stablecoins
      const validManualCoins = selectedCoins.filter(symbol =>
        top25Symbols.has(symbol.toUpperCase())
      );

      if (validManualCoins.length > 0) {
        const invalidCoins = selectedCoins.filter(s => !top25Symbols.has(s.toUpperCase()));
        if (invalidCoins.length > 0) {
          logger.error({ uid, invalidCoins, stack: new Error().stack }, '❌ [TOP_25_VIOLATION] Manual coins outside Top 25 detected and filtered');
        }
        logger.info({ uid, validCoins: validManualCoins, invalidCoins }, '✅ [TOP_25_FILTER] Manual coins filtered to top 25 non-stablecoins');
        return validManualCoins;
      }

      // If no valid manual coins, return top coins from top 25
      if (top25.length > 0) {
        const fallback = top25.slice(0, 2).map(c => c.symbol);
        logger.info({ uid, fallback }, 'No valid manual coins in top 25, using top coins from top 25 non-stablecoins');
        return fallback;
      }

      return [];
    }

    // CRITICAL: RESTRICTED TO TOP 25 COINS ONLY (single source of truth)
    // Fetch top 25 coins from live sources (CMC/CG) - system is restricted to top 25
    const top25 = await getTop100Coins(uid, TOP_COINS_LIMIT);
    const now = Date.now();
    logger.info({ uid, top25Count: top25.length, symbols: top25.map(c => c.symbol) }, '✅ [TOP_25_LOADED] Top 25 coins loaded for coin selection');

    // CRITICAL FIX: Do NOT require exactly 25 coins - use MIN_THRESHOLD (5 coins minimum)
    // If filtered non-stablecoins >= MIN_THRESHOLD, run coin selection
    // NEVER return empty array if usable coins exist
    const MIN_THRESHOLD = 5;
    if (!top25 || top25.length < MIN_THRESHOLD) {
      logger.error({ uid, top25Count: top25?.length || 0, minThreshold: MIN_THRESHOLD, stack: new Error().stack }, '❌ [TOP_25_ERROR] Insufficient coins available - below minimum threshold');
      return [];
    }

    // Filter out coins currently in cooldown
    const availableCoins = top25.filter(coin => {
      // Validate symbol format (alphanumeric + USDT only)
      if (!/^[A-Z0-9]+USDT$/.test(coin.symbol)) return false;

      const lastSelected = coinRotationCooldown.get(coin.symbol);
      return !lastSelected || (now - lastSelected > ROTATION_COOLDOWN_MS);
    });

    // If all coins are in cooldown, reset cooldowns to allow selection from top 25
    let filteredCoins = availableCoins;
    if (availableCoins.length === 0 && top25.length > 0) {
      logger.info({ uid, top25Count: top25.length }, 'All top 25 coins in cooldown, resetting cooldowns');
      // Reset all cooldowns for top 25 coins
      top25.forEach(coin => coinRotationCooldown.delete(coin.symbol));
      filteredCoins = top25.filter(coin => /^[A-Z0-9]+USDT$/.test(coin.symbol));
    }

    // Sort by absolute 24h price change percentage (proxy for volatility)
    const sortedByVolatility = [...filteredCoins]
      .sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0));

    let finalCoins: string[] = [];

    // CRITICAL: All modes now restricted to top 25 coins only
    if (coinSelectionMode === 'top10' || coinSelectionMode === 'top100') {
      // Both top10 and top100 modes now use top 25 coins (system restriction)
      finalCoins = sortedByVolatility.slice(0, Math.min(25, filteredCoins.length)).map(c => c.symbol);
      logger.info({ uid, coins: finalCoins, mode: coinSelectionMode, top25Count: top25.length }, '✅ [TOP_25_SELECT] Selected coins from top 25 by market cap (volatility sorted)');
    } else {
      // Manual mode: only allow coins from top 25 non-stablecoins
      const top25Symbols = new Set(top25.map(c => c.symbol.toUpperCase()));
      const manualCoinsInTop25 = selectedCoins.filter(symbol =>
        top25Symbols.has(symbol.toUpperCase())
      );
      if (manualCoinsInTop25.length > 0) {
        finalCoins = manualCoinsInTop25;
        const invalidCoins = selectedCoins.filter(s => !top25Symbols.has(s.toUpperCase()));
        if (invalidCoins.length > 0) {
          logger.error({ uid, invalidCoins, stack: new Error().stack }, '❌ [TOP_25_VIOLATION] Manual coins outside Top 25 detected and filtered');
        }
        logger.info({ uid, coins: finalCoins }, '✅ [TOP_25_FILTER] Manual coins filtered to top 25 non-stablecoins only');
      } else {
        // Fallback: use top coins from top 25 non-stablecoins
        finalCoins = sortedByVolatility.slice(0, Math.min(2, filteredCoins.length)).map(c => c.symbol);
        logger.info({ uid, coins: finalCoins }, 'No manual coins in top 25 non-stablecoins, using top coins from top 25');
      }
    }

    // Mark selected coins as recently researched
    finalCoins.forEach(sym => coinRotationCooldown.set(sym, now));

    return finalCoins.length > 0 ? finalCoins : ['ETHUSDT', 'SOLUSDT'];
  } catch (error) {
    logger.error({ uid, error }, 'Error selecting coins for research');
    return ['ETHUSDT', 'SOLUSDT'];
  }
}

/**
 * CRITICAL: Top 25 Accuracy Scan with FINAL Exclusion and Cooldown
 * This is the SINGLE SOURCE OF TRUTH for auto-select coin selection
 * RESTRICTED TO TOP 25 COINS ONLY
 * 
 * Rules:
 * 1. Fetch Top 25 coins (system restriction - single source of truth)
 * 2. Exclude coins with FINAL research (already researched)
 * 3. Exclude coins in cooldown (recently selected)
 * 4. Compute/check accuracy for each coin
 * 5. Select ONLY the coin with highest accuracy
 * 6. Never short-circuit on cached results
 * 7. If none of top 25 qualify → return null (system must WAIT)
 * 
 * @param uid User ID
 * @param excludeSymbols Additional symbols to exclude (e.g., currently running research)
 * @returns Selected symbol or null if no valid coin found
 */
export async function selectBestCoinByAccuracy(
  uid: string,
  excludeSymbols: string[] = []
): Promise<{ symbol: string; accuracy: number; excludedCount: number } | null> {
  try {
    const { cacheService } = await import('./cacheService');
    // CRITICAL: Only fetch top 25 coins (single source of truth)
    const candidates = await getTop100Coins(uid, TOP_COINS_LIMIT);
    logger.info({ uid, top25Count: candidates.length, symbols: candidates.map(c => c.symbol) }, '✅ [TOP_25_LOADED] Top 25 coins loaded for accuracy scan');

    // CRITICAL FIX: Do NOT require exactly 25 coins - use MIN_THRESHOLD (5 coins minimum)
    // If filtered non-stablecoins >= MIN_THRESHOLD, run accuracy scan
    // NEVER return null if usable coins exist
    const MIN_THRESHOLD = 5;
    if (!candidates || candidates.length < MIN_THRESHOLD) {
      logger.error({ uid, candidateCount: candidates?.length || 0, minThreshold: MIN_THRESHOLD, stack: new Error().stack }, '❌ [TOP_25_ERROR] Insufficient coins available for accuracy scan - below minimum threshold');
      return null;
    }

    const now = Date.now();
    const excludedSymbolsSet = new Set(excludeSymbols.map(s => s.toUpperCase()));
    let excludedCount = 0;
    let finalExcludedCount = 0;
    let cooldownExcludedCount = 0;

    let bestAccuracy = -1;
    let bestCoin = '';
    const coinScores: Array<{ symbol: string; accuracy: number }> = [];

    // SCAN ALL TOP 25 COINS - no short-circuiting
    const scanStartTime = Date.now();
    logger.info({ uid, top25Count: candidates.length, startTime: new Date().toISOString() }, '🔍 [TOP_25_SCAN] Starting accuracy scan for all Top 25 coins');
    for (const c of candidates) {
      const symbol = c.symbol?.toUpperCase() || '';
      if (!symbol.endsWith('USDT')) continue;

      // EXCLUDE: Already in exclude list
      if (excludedSymbolsSet.has(symbol)) {
        excludedCount++;
        continue;
      }

      // EXCLUDE: FINAL research already exists (IMMUTABLE)
      // FINAL results are frozen and should not be re-calculated or re-selected
      const cacheKey = `coin_research_${symbol}_${uid}`;
      const cached = cacheService.get('metadata', cacheKey);
      if (cached && cached.isFinal === true) {
        finalExcludedCount++;
        continue;
      }

      // EXCLUDE: In cooldown (recently selected)
      const cooldownKey = `${uid}:${symbol}`;
      const lastSelected = autoSelectCooldown.get(cooldownKey);
      if (lastSelected && (now - lastSelected < AUTO_SELECT_COOLDOWN_MS)) {
        cooldownExcludedCount++;
        continue;
      }

      // COMPUTE ACCURACY: Use cached if available, otherwise compute lightweight score
      let accuracy = -1;

      if (cached && cached.accuracy !== undefined && cached.accuracy !== -1 &&
        cached.signal && cached.signal !== 'ANALYZING' && cached.signal !== 'PENDING') {
        // Use cached accuracy
        accuracy = cached.accuracy;

        // Softened pump penalty: if 24h change > 15%, reduce accuracy slightly
        const priceChange24h = Math.abs(c.price_change_percentage_24h || 0);
        if (priceChange24h > 15) {
          accuracy *= 0.8;
        }
      } else {
        // LIGHTWEIGHT ACCURACY COMPUTATION: Based on volatility
        // Goal: Pick coins with high movement potential (proxy for signal quality)
        // Ensure price_change is treated as number
        const priceChange24h = Math.abs(Number(c.price_change_percentage_24h) || 0);
        const marketCap = Number(c.marketCap) || 0;

        // Base score from volatility (0-70 range) - Stronger weight
        // We want highly volatile alts to beat stable BTC
        // Market cap bonus (0-5 range) - Reduced influence to prevent BTC dominance
        // BTC (large cap) gets 5. Alts get 1-3.
        // If Volatility is 0, BTC wins (5 vs 1).
        // Any coin with > 1% volatility (score 7) will beat flat BTC.
        const marketCapScore = marketCap > 10000000000 ? 5 : marketCap > 1000000000 ? 3 : marketCap > 100000000 ? 2 : 1;

        // Boost volatility impact (multiplier 7x)
        const volatilityScore = Math.min(70, priceChange24h * 7);

        accuracy = volatilityScore + marketCapScore;

        // Random tie-breaker (+/- 1-2 points) to prevent sticky selection
        accuracy += (Math.random() * 2);
      }

      // Track all valid coins with their accuracy
      coinScores.push({ symbol, accuracy });

      // SELECT highest accuracy
      if (accuracy > bestAccuracy) {
        bestAccuracy = accuracy;
        bestCoin = symbol;
      }
    }

    // Log top 5 candidates for debugging
    coinScores.sort((a, b) => b.accuracy - a.accuracy);
    const top5 = coinScores.slice(0, 5);
    logger.info({ uid, topCandidates: top5 }, '[ACCURACY_SCAN] Top candidates');

    // If no valid coin found, return null
    if (!bestCoin || bestAccuracy < 0) {
      logger.warn({
        uid,
        excludedCount,
        finalExcludedCount,
        cooldownExcludedCount,
        totalCandidates: candidates.length
      }, 'No valid coin found after accuracy scan');
      return null;
    }

    // Mark selected coin as recently used (cooldown)
    const cooldownKey = `${uid}:${bestCoin}`;
    autoSelectCooldown.set(cooldownKey, now);

    // Mark in rotation cooldown too (global)
    coinRotationCooldown.set(bestCoin, now);

    // INSTRUMENTATION: Log scan completion
    const scanDurationMs = Date.now() - scanStartTime;
    logger.info({
      uid,
      top25Count: candidates.length,
      symbolsScanned: candidates.map(c => c.symbol),
      bestSymbol: bestCoin,
      bestAccuracy: bestAccuracy,
      scanDurationMs: scanDurationMs,
      excludedCount,
      finalExcludedCount,
      cooldownExcludedCount,
      endTime: new Date().toISOString()
    }, '✅ [TOP_25_SCAN] Accuracy scan completed - Top 25 coins scanned');

    // Cleanup old cooldown entries (older than 24 hours)
    if (now % 10 === 0) { // Periodic cleanup
      for (const [key, timestamp] of autoSelectCooldown.entries()) {
        if (now - timestamp > 24 * 60 * 60 * 1000) {
          autoSelectCooldown.delete(key);
        }
      }
    }

    logger.info({
      uid,
      symbol: bestCoin,
      accuracy: bestAccuracy.toFixed(2),
      finalExcluded: finalExcludedCount,
      cooldownExcluded: cooldownExcludedCount,
      totalCandidates: candidates.length
    }, '[AUTO_SELECT] Best coin selected by accuracy (Top 25 Scan - RESTRICTED)');

    return {
      symbol: bestCoin,
      accuracy: bestAccuracy,
      excludedCount: finalExcludedCount + cooldownExcludedCount + excludedCount
    };
  } catch (error: any) {
    logger.error({ uid, error: error.message }, 'Error in selectBestCoinByAccuracy');
    return null;
  }
}

