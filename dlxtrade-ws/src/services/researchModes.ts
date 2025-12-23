import axios from 'axios';
import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { getUserIntegrations } from '../routes/integrations';
import { FreeModeDeepResearchResult } from './researchTypes';

// Cache for top coins (module-level fallback)
export let cachedTop50Coins: any[] = [];

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
 * Get top 100 coins by market cap for deep research
 * REFACTORED: Implementation of stale-while-revalidate pattern to guarantee < 2s response
 */
let lastFetchTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes list cache
let isFetchingTopCoins = false;

export async function getTop100Coins(uid: string, limit: number = 100): Promise<any[]> {
  const now = Date.now();

  try {
    // 1. FAST PATH: Return cached data immediately if fresh enough (within 10 mins)
    if (cachedTop50Coins.length >= limit && (now - lastFetchTime < CACHE_TTL)) {
      logger.info({ uid, limit, cacheAge: now - lastFetchTime }, 'Serving Top 100 coins from global cache (FRESH)');
      return cachedTop50Coins.slice(0, limit);
    }

    // 2. BACKGROUND REFRESH: If cache exists but stale, return it and trigger background refresh
    if (cachedTop50Coins.length >= limit && !isFetchingTopCoins) {
      logger.info({ uid, limit, cacheAge: now - lastFetchTime }, 'Serving Top 100 coins from global cache (STALE), triggering background refresh');

      // Trigger background refresh (don't await)
      isFetchingTopCoins = true;
      (async () => {
        try {
          await refreshTop100Coins(uid);
        } catch (err) {
          logger.error({ error: (err as any).message }, 'Background Top 100 refresh failed');
        } finally {
          isFetchingTopCoins = false;
        }
      })();

      return cachedTop50Coins.slice(0, limit);
    }

    // 3. COLD START / NO CACHE: Perform synchronous fetch with strict timeout
    if (isFetchingTopCoins) {
      // If already fetching, wait a bit then return whatever we have
      await new Promise(resolve => setTimeout(resolve, 500));
      if (cachedTop50Coins.length > 0) return cachedTop50Coins.slice(0, limit);
    }

    isFetchingTopCoins = true;
    try {
      const coins = await refreshTop100Coins(uid);
      return coins.slice(0, limit);
    } finally {
      isFetchingTopCoins = false;
    }

  } catch (error) {
    logger.error({ uid, error: (error as any).message }, 'Error in getTop100Coins');
    return cachedTop50Coins.slice(0, limit);
  }
}

/**
 * Internal helper to actually fetch from providers with strict timeouts
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

    // Try CoinMarketCap with STRICT 3s timeout
    try {
      const cmcApiKey =
        integrations?.metadata?.coinmarketcap?.apiKey ||
        integrations?.marketData?.coinmarketcap?.apiKey ||
        integrations?.coinmarketcap?.apiKey;

      if (cmcApiKey) {
        const { fetchCoinMarketCapListings } = await import('./coinMarketCapAdapter');
        // Add a promise-based timeout wrapper
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

          cachedTop50Coins = normalized;
          lastFetchTime = Date.now();
          return normalized;
        }
      }
    } catch (error) {
      logger.warn({ error: (error as any).message }, 'CMC list fetch failed or timed out');
    }

    // Try CoinGecko with STRICT 5s timeout
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
        timeout: 5000 // Reduced from 10s to 5s
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

        cachedTop50Coins = normalized;
        lastFetchTime = Date.now();
        return normalized;
      }
    } catch (error) {
      logger.warn({ error: (error as any).message }, 'CoinGecko list fetch failed');
    }

    return cachedTop50Coins; // Return existing cache if all providers fail
  } catch (err) {
    logger.error({ error: (err as any).message }, 'Fatal error in refreshTop100Coins');
    return cachedTop50Coins;
  }
}


/**
 * Get top 50 coins (backward compatibility)
 */
export async function getTop50Coins(uid: string): Promise<any[]> {
  return getTop100Coins(uid, 50);
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

    // Use the robust Free Mode engine to get all data + indicators
    const result = await runFreeMode(uid, symbol, undefined, undefined, true, 35000, onUpdate);

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
      return selectedCoins.length > 0 ? selectedCoins : ['ETHUSDT', 'SOLUSDT'];
    }

    // P1: VOLATILITY-BASED SELECTION FROM TOP 100
    // Fetch top 100 coins from live sources (CMC/CG)
    const top100 = await getTop100Coins(uid, 100);
    const now = Date.now();

    // Filter out coins currently in cooldown
    const availableCoins = top100.filter(coin => {
      // Validate symbol format (alphanumeric + USDT only) - reject e.g. "UNKNOWN" or "1000PEPE" if undesired
      if (!/^[A-Z0-9]+USDT$/.test(coin.symbol)) return false;

      const lastSelected = coinRotationCooldown.get(coin.symbol);
      return !lastSelected || (now - lastSelected > ROTATION_COOLDOWN_MS);
    });

    // If too many coins are in cooldown, reset half of them to ensure variety but still allow selection
    let filteredCoins = availableCoins;
    if (availableCoins.length < 20 && top100.length > 50) {
      logger.info({ uid, availableCount: availableCoins.length }, 'Coin cooldown filter too restrictive, partial reset');
      // Reset coins that have been in cooldown the longest
      const sortedByTime = Array.from(coinRotationCooldown.entries()).sort((a, b) => a[1] - b[1]);
      const toReset = sortedByTime.slice(0, Math.floor(sortedByTime.length / 2));
      toReset.forEach(([sym]) => coinRotationCooldown.delete(sym));

      // Re-filter
      filteredCoins = top100.filter(coin => {
        const lastSelected = coinRotationCooldown.get(coin.symbol);
        return !lastSelected || (now - lastSelected > ROTATION_COOLDOWN_MS);
      });
    }

    // Sort by absolute 24h price change percentage (proxy for volatility)
    const sortedByVolatility = [...filteredCoins]
      .sort((a, b) => Math.abs(b.price_change_percentage_24h || 0) - Math.abs(a.price_change_percentage_24h || 0));

    let finalCoins: string[] = [];

    // If coinSelectionMode is top10, pick top 10 most volatile
    if (coinSelectionMode === 'top10') {
      finalCoins = sortedByVolatility.slice(0, 10).map(c => c.symbol);
      logger.info({ uid, coins: finalCoins }, 'Selected Top 10 coins by volatility (rotated)');
    } else if (coinSelectionMode === 'top100') {
      // If coinSelectionMode is top100, pick top 25 most volatile (cap at 25 for engine performance)
      finalCoins = sortedByVolatility.slice(0, 25).map(c => c.symbol);
      logger.info({ uid, count: finalCoins.length }, 'Selected Top 25 coins by volatility (rotated)');
    } else {
      finalCoins = ['ETHUSDT', 'SOLUSDT'];
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
 * CRITICAL: Top 100 Accuracy Scan with FINAL Exclusion and Cooldown
 * This is the SINGLE SOURCE OF TRUTH for auto-select coin selection
 * 
 * Rules:
 * 1. Fetch Top 100 coins
 * 2. Exclude coins with FINAL research (already researched)
 * 3. Exclude coins in cooldown (recently selected)
 * 4. Compute/check accuracy for each coin
 * 5. Select ONLY the coin with highest accuracy
 * 6. Never short-circuit on cached results
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
    const candidates = await getTop100Coins(uid, 100);

    if (!candidates || candidates.length === 0) {
      logger.warn({ uid }, 'No candidates available for accuracy scan');
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

    // SCAN ALL TOP 100 COINS - no short-circuiting
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
        const volatilityScore = Math.min(70, priceChange24h * 5); // Increased multiplier to 5x

        // Market cap bonus (0-20 range) - Reduced influence
        // BTC (large cap) gets 20. Alts might get 5-10.
        // If Volatility is 0, BTC wins (20 vs 5).
        // If Volatility > 4% (4*5=20), Alts catch up.
        const marketCapScore = marketCap > 10000000000 ? 20 : marketCap > 1000000000 ? 15 : marketCap > 100000000 ? 10 : 5;

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
    }, '[AUTO_SELECT] Best coin selected by accuracy (Top 100 Scan)');

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

