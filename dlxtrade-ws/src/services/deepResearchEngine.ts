import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { fetchNewsData } from './newsDataAdapter';
import { fetchCoinMarketCapMetadata, fetchCoinMarketCapMarketData } from './coinMarketCapAdapter';
import { autoTradeExecutor } from './autoTradeExecutor';
import { tradingStrategies, OHLCData, StrategyResult, IndicatorResult } from './tradingStrategies';
import * as admin from 'firebase-admin';
import { config } from '../config';

/**
 * Semaphore for concurrency control
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    }
  }
}

/**
 * In-memory cache for symbol metadata
 */
const symbolCache = new Map<string, { data: string[]; timestamp: number; ttl: number }>();
const SYMBOL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ProviderConfirmation {
  name: string;
  status: 'success' | 'failed' | 'rate-limited' | 'fallback';
  latencyMs: number;
  confirmationDeltaPercent?: number;
  raw?: any;
}

export interface NormalizedDeepResearchResult {
  // Primary consolidated data
  primaryProvider: string;
  marketOverview: {
    price: number;
    priceChangePercent24h: number;
    volume24h: number;
    high24h: number;
    low24h: number;
    marketCap: number;
    vwapDeviation: number;
  };

  // Provider confirmations (non-primary providers)
  providers: ProviderConfirmation[];

  // News data
  news: {
    sentimentScore: number;
    articles: Array<{
      title: string;
      source: string;
      url: string;
      published_at: string;
    }>;
  };

  // Deep analysis results
  deepAnalysis: {
    finalSignal: 'BUY' | 'SELL' | 'HOLD';
    confidencePercent: number;
    indicators: {
      rsi: IndicatorResult;
      ema: IndicatorResult;
      sma: IndicatorResult;
      momentum: IndicatorResult;
      volume: IndicatorResult;
      vwap: IndicatorResult;
      atr: IndicatorResult;
      supportResistance: IndicatorResult;
      priceAction: IndicatorResult;
    };
    signals: StrategyResult[];
  };

  // Cooldown info (when request is blocked)
  cooldown?: {
    remainingSeconds: number;
  };
}

// Keep legacy interface for backward compatibility during transition
export interface DeepResearchResult {
  rsi: IndicatorResult;
  volume: IndicatorResult;
  momentum: IndicatorResult;
  trend: IndicatorResult;
  volatility: IndicatorResult;
  supportResistance: IndicatorResult;
  priceAction: IndicatorResult;
  vwap: IndicatorResult;
  signals: StrategyResult[];
  combinedSignal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  newsSentiment: number; // Aggregated sentiment score from news (0-1 scale)
  providersCalled: string[];
  raw: {
    cryptoCompare: any;
    newsData: any;
    coinMarketCap: any;
    binancePublic: any;
  };
  symbolSelection?: {
    selectedSymbol: string;
    expectedAccuracy: number;
    reason: string;
    selectionTimestamp: number;
  };
}

export class DeepResearchEngine {
  /**
   * Calculate fundamentals score (0-1 scale) based on market cap, volume, and other metrics
   */
  private calculateFundamentalsScore(coinMarketCapData: any, cryptoCompareData: any): number {
    let score = 0.5; // Default neutral score
    let factors = 0;

    try {
      // Market cap strength (larger cap = more stable = higher score)
      if (coinMarketCapData?.marketData?.marketCap) {
        const marketCap = coinMarketCapData.marketData.marketCap;
        if (marketCap > 1000000000) { // > 1B
          score += 0.2;
        } else if (marketCap > 100000000) { // > 100M
          score += 0.1;
        }
        factors++;
      }

      // Volume to market cap ratio (higher volume relative to market cap = more liquid = higher score)
      if (coinMarketCapData?.marketData?.volume24h && coinMarketCapData?.marketData?.marketCap) {
        const volumeToCapRatio = coinMarketCapData.marketData.volume24h / coinMarketCapData.marketData.marketCap;
        if (volumeToCapRatio > 0.1) { // Very high volume
          score += 0.15;
        } else if (volumeToCapRatio > 0.01) { // Good volume
          score += 0.1;
        }
        factors++;
      }

      // Price stability (lower volatility = higher score)
      if (cryptoCompareData?.priceChangePercent24h !== undefined) {
        const volatility = Math.abs(cryptoCompareData.priceChangePercent24h);
        if (volatility < 5) { // Low volatility
          score += 0.15;
        } else if (volatility < 15) { // Moderate volatility
          score += 0.05;
        } else { // High volatility
          score -= 0.1;
        }
        factors++;
      }

      // Normalize score based on factors considered
      if (factors > 0) {
        score = Math.max(0, Math.min(1, score));
      }

    } catch (error: any) {
      logger.debug({ error: error.message }, 'Error calculating fundamentals score, using default');
      score = 0.5;
    }

    return score;
  }

  /**
   * Select the optimal symbol for research based on market cap and expected accuracy
   */
  /**
   * Select the optimal symbol batch for research - highest accuracy coin + small batch of others
   */
  async selectOptimalSymbolBatch(uid: string, batchSize: number = 4): Promise<{
    primarySymbol: string;
    batchSymbols: string[];
    expectedAccuracy: number;
    reason: string
  }> {
    try {
      logger.info({ uid, batchSize }, 'Starting optimal symbol batch selection');

      // Get top 100 symbols by market cap from CoinMarketCap
      const topSymbols = await this.getTopMarketCapSymbols(uid, 100);

      if (topSymbols.length === 0) {
        // Fallback to curated list without hard-coded BTC
        const fallbackSymbols = ['ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'SOLUSDT'];
        return {
          primarySymbol: fallbackSymbols[0],
          batchSymbols: fallbackSymbols.slice(1, batchSize),
          expectedAccuracy: 0.5,
          reason: 'Fallback: No market data available, using curated list'
        };
      }

      // Calculate expected accuracy for each symbol (limit to avoid rate limiting)
      const symbolScores = [];
      const maxSymbolsToCheck = Math.min(30, topSymbols.length); // Check up to 30 symbols

      for (let i = 0; i < maxSymbolsToCheck; i++) {
        const symbolData = topSymbols[i];
        try {
          const expectedAccuracy = await this.calculateExpectedAccuracy(uid, symbolData.symbol);
          symbolScores.push({
            symbol: symbolData.symbol,
            expectedAccuracy,
            marketCap: symbolData.marketCap,
            rank: symbolData.rank
          });
        } catch (error: any) {
          logger.debug({ uid, symbol: symbolData.symbol, error: error.message }, 'Failed to calculate expected accuracy');
          // Include with default accuracy
          symbolScores.push({
            symbol: symbolData.symbol,
            expectedAccuracy: 0.5,
            marketCap: symbolData.marketCap,
            rank: symbolData.rank
          });
        }
      }

      // Sort by expected accuracy (descending)
      symbolScores.sort((a, b) => b.expectedAccuracy - a.expectedAccuracy);

      // Primary symbol is the highest accuracy one
      const primarySymbol = symbolScores[0].symbol;

      // Batch includes primary + next few highest accuracy symbols (excluding primary)
      const batchSymbols = [primarySymbol];
      const remainingSymbols = symbolScores.slice(1).map(s => s.symbol);

      // Add symbols to batch, ensuring diversity (avoid too many similar pairs)
      for (const symbol of remainingSymbols) {
        if (batchSymbols.length >= batchSize) break;
        // Simple diversity check - avoid symbols that start with same base (BTC, ETH, etc.)
        const base = symbol.replace('USDT', '').replace('USD', '');
        const hasSimilar = batchSymbols.some(s => s.replace('USDT', '').replace('USD', '').startsWith(base.substring(0, 2)));
        if (!hasSimilar) {
          batchSymbols.push(symbol);
        }
      }

      // If we don't have enough diverse symbols, add more
      for (const symbol of remainingSymbols) {
        if (batchSymbols.length >= batchSize) break;
        if (!batchSymbols.includes(symbol)) {
          batchSymbols.push(symbol);
        }
      }

      const reason = `Selected ${primarySymbol} (highest accuracy: ${(symbolScores[0].expectedAccuracy * 100).toFixed(1)}%) + ${batchSymbols.length - 1} others from ${symbolScores.length} candidates`;

      logger.info({
        uid,
        primarySymbol,
        batchSymbols,
        batchSize: batchSymbols.length,
        expectedAccuracy: symbolScores[0].expectedAccuracy,
        candidatesProcessed: symbolScores.length,
        reason
      }, 'Optimal symbol batch selected');

      return {
        primarySymbol,
        batchSymbols,
        expectedAccuracy: symbolScores[0].expectedAccuracy,
        reason
      };
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to select optimal symbol batch, using fallback');
      const fallbackSymbols = ['ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT'];
      return {
        primarySymbol: fallbackSymbols[0],
        batchSymbols: fallbackSymbols.slice(0, batchSize),
        expectedAccuracy: 0.5,
        reason: `Error: ${error.message}, using fallback`
      };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async selectOptimalSymbol(uid: string): Promise<{ symbol: string; expectedAccuracy: number; reason: string }> {
    const result = await this.selectOptimalSymbolBatch(uid, 1);
    return {
      symbol: result.primarySymbol,
      expectedAccuracy: result.expectedAccuracy,
      reason: result.reason
    };
  }

  /**
   * Get top N symbols by market capitalization
   */
  private async getTopMarketCapSymbols(uid: string, limit: number): Promise<Array<{ symbol: string; marketCap: number; rank: number }>> {
    try {
      // Get user's CoinMarketCap integration
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

      if (!integrations.coinmarketcap?.apiKey) {
        logger.warn({ uid }, 'No CoinMarketCap API key available for market cap data');
        return [];
      }

      const { fetchCoinMarketCapListings } = await import('./coinMarketCapAdapter');
      const listings = await fetchCoinMarketCapListings(integrations.coinmarketcap.apiKey, limit);

      return listings
        .filter(item => item.symbol && item.quote?.USD?.market_cap)
        .map((item, index) => ({
          symbol: `${item.symbol}USDT`, // Convert to trading pair format
          marketCap: item.quote.USD.market_cap,
          rank: index + 1
        }));

    } catch (error: any) {
      logger.warn({ uid, error: error.message }, 'Failed to fetch market cap data');
      return [];
    }
  }

  /**
   * Calculate expected accuracy for a symbol based on historical performance
   */
  private async calculateExpectedAccuracy(uid: string, symbol: string): Promise<number> {
    try {
      // Get recent research logs for this symbol (last 50 entries)
      const researchLogs = await firestoreAdapter.getResearchLogs(uid, 50);

      // Filter logs for this symbol
      const symbolLogs = researchLogs.filter(log => log.symbol === symbol);

      if (symbolLogs.length === 0) {
        // No historical data, use base accuracy
        return 0.5;
      }

      // Calculate average accuracy from recent logs (weighted by recency)
      let totalWeight = 0;
      let weightedAccuracy = 0;

      symbolLogs.forEach((log, index) => {
        const weight = Math.max(0.1, 1 - (index * 0.02)); // Recent logs have higher weight
        weightedAccuracy += log.accuracy * weight;
        totalWeight += weight;
      });

      const expectedAccuracy = weightedAccuracy / totalWeight;

      // Add small boost for symbols with more data points
      const dataBoost = Math.min(0.1, symbolLogs.length * 0.005);

      return Math.min(0.95, expectedAccuracy + dataBoost);

    } catch (error: any) {
      logger.debug({ uid, symbol, error: error.message }, 'Failed to calculate expected accuracy');
      return 0.5; // Default accuracy
    }
  }

  /**
   * Get comprehensive symbol list for research processing
   */
  async getResearchSymbolList(uid: string, limit: number = 50): Promise<string[]> {
    const cacheKey = `symbols_${limit}`;
    const cached = symbolCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < cached.ttl) {
      logger.debug({ uid, symbolCount: cached.data.length }, 'Using cached symbol list');
      return cached.data;
    }

    try {
      logger.info({ uid, limit }, 'Getting comprehensive symbol list for research');

      // Try to get top symbols from CoinMarketCap first
      const topSymbols = await this.getTopMarketCapSymbols(uid, limit);
      if (topSymbols.length > 0) {
        const symbols = topSymbols.map(s => s.symbol);
        logger.info({ uid, symbolCount: symbols.length }, 'Using CoinMarketCap symbol list');

        // Cache the result
        symbolCache.set(cacheKey, { data: symbols, timestamp: now, ttl: SYMBOL_CACHE_TTL_MS });
        return symbols;
      }

      // Fallback: Use a curated list of major symbols
      const majorSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT',
        'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LTCUSDT',
        'MATICUSDT', 'ALGOUSDT', 'VETUSDT', 'ICPUSDT', 'FILUSDT',
        'TRXUSDT', 'ETCUSDT', 'XLMUSDT', 'THETAUSDT', 'FTTUSDT',
        'LINKUSDT', 'UNIUSDT', 'CAKEUSDT', 'SUSHIUSDT', 'COMPUSDT'
      ].slice(0, limit);

      logger.info({ uid, symbolCount: majorSymbols.length }, 'Using major symbols list');

      // Cache the result
      symbolCache.set(cacheKey, { data: majorSymbols, timestamp: now, ttl: SYMBOL_CACHE_TTL_MS });
      return majorSymbols;

    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to get symbol list, using minimal fallback');
      const fallbackSymbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];

      // Cache even the fallback
      symbolCache.set(cacheKey, { data: fallbackSymbols, timestamp: now, ttl: SYMBOL_CACHE_TTL_MS / 10 }); // Shorter TTL for fallback
      return fallbackSymbols;
    }
  }

  /**
   * Run deep research on multiple symbols with concurrency control
   */
  async runDeepResearchBatch(uid: string, symbols?: string[], concurrency: number = 5): Promise<any[]> {
    const batchStartTime = Date.now();

    try {
      // Get optimal symbol batch if not provided
      if (!symbols || symbols.length === 0) {
        const { batchSymbols } = await this.selectOptimalSymbolBatch(uid, 5); // Get primary + 4 others
        symbols = batchSymbols;
      }

      logger.info({ uid, symbolCount: symbols.length, concurrency }, 'Starting batch deep research');

      const results = [];
      const semaphore = new Semaphore(concurrency);

      // Process symbols concurrently with semaphore
      const promises = symbols.map(async (symbol) => {
        const symbolStartTime = Date.now();
        const release = await semaphore.acquire();
        try {
          const result = await this.runDeepResearchInternal(symbol, uid);
          const duration = Date.now() - symbolStartTime;
          results.push({
            symbol,
            result: result.legacyResult,
            timestamp: Date.now(),
            durationMs: duration
          });
          logger.info({ uid, symbol, durationMs: duration }, 'Completed batch research for symbol');
        } catch (error: any) {
          const duration = Date.now() - symbolStartTime;
          logger.error({ uid, symbol, error: error.message, durationMs: duration }, 'Failed batch research for symbol');
          results.push({
            symbol,
            error: error.message,
            timestamp: Date.now(),
            durationMs: duration
          });
        } finally {
          release();
        }
      });

      await Promise.allSettled(promises); // Use allSettled to prevent one failure from stopping others

      const totalDuration = Date.now() - batchStartTime;
      const successful = results.filter(r => r.result).length;
      const failed = results.filter(r => r.error).length;

      logger.info({
        uid,
        processedCount: results.length,
        successful,
        failed,
        totalDurationMs: totalDuration,
        avgDurationMs: results.length > 0 ? totalDuration / results.length : 0
      }, 'Completed batch deep research');

      return results;
    } catch (error: any) {
      logger.error({ uid, error: error.message, batchDurationMs: Date.now() - batchStartTime }, 'Batch deep research failed catastrophically');
      return [{
        symbol: 'SYSTEM_ERROR',
        error: error.message,
        timestamp: Date.now()
      }];
    }
  }

  async runDeepResearch(symbol: string, uid: string): Promise<DeepResearchResult> {
    // For backward compatibility, run the legacy method and return legacy format
    const result = await this.runDeepResearchInternal(symbol, uid);
    return result.legacyResult;
  }

  /**
   * Run deep research with automatic symbol selection
   */
  async runDeepResearchAuto(uid: string): Promise<DeepResearchResult> {
    // Select optimal symbol
    const { symbol, expectedAccuracy, reason } = await this.selectOptimalSymbol(uid);

    logger.info({ uid, selectedSymbol: symbol, expectedAccuracy, reason }, 'Running auto deep research');

    // Run research on selected symbol
    const result = await this.runDeepResearchInternal(symbol, uid);
    const legacyResult = result.legacyResult;

    // Add symbol selection metadata
    (legacyResult as any).symbolSelection = {
      selectedSymbol: symbol,
      expectedAccuracy,
      reason,
      selectionTimestamp: Date.now()
    };

    return legacyResult;
  }

  async runNormalizedDeepResearch(symbol: string, uid: string): Promise<NormalizedDeepResearchResult> {
    const result = await this.runDeepResearchInternal(symbol, uid);
    return result.normalizedResult;
  }

  private async runDeepResearchInternal(symbol: string, uid: string): Promise<{
    legacyResult: DeepResearchResult;
    normalizedResult: NormalizedDeepResearchResult;
  }> {
    const startTime = Date.now();
    logger.info({ uid, symbol }, 'Starting comprehensive deep research analysis');

    // Get user integrations
    const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

    // Log which keys are available
    console.log("DEEP-KEY", {
      cryptocompare: !!integrations.cryptocompare?.apiKey,
      newsdata: !!integrations.newsdata?.apiKey,
      coinmarketcap: !!integrations.coinmarketcap?.apiKey
    });

    // Initialize data containers with latency tracking
    let cryptoCompareData: any = {};
    let newsData: any = {};
    let coinMarketCapData: any = {};
    let binancePublicData: any = {};
    let ohlcData: OHLCData[] = [];

    const providersCalled: string[] = [];
    const providerLatencies: { [key: string]: number } = {};

    try {
      // ALWAYS EXECUTE ALL 5 PROVIDERS - regardless of user API keys

      // 1. Fetch CryptoCompare data (OHLC historical data)
      console.log(`[CryptoCompare] START - ${symbol}`);
      const cryptoCompareStart = Date.now();
      try {
        const { CryptoCompareAdapter } = await import('./cryptocompareAdapter');
        // Use user API key if available, otherwise fallback to service-level key
        const userApiKey = integrations.cryptocompare?.apiKey;
        const serviceApiKey = config.research.cryptocompare.apiKey;
        const apiKey = userApiKey || serviceApiKey;

        if (!apiKey) {
          throw new Error('No CryptoCompare API key available (user or service-level)');
        }

        if (userApiKey) {
          console.log("USING-KEY", { provider: 'CryptoCompare', source: 'user' });
        } else if (serviceApiKey) {
          console.log("USING-KEY", { provider: 'CryptoCompare', source: 'service' });
        } else {
          logger.warn({ uid, provider: 'CryptoCompare' }, 'No CryptoCompare API key available');
        }

        const cryptoCompareAdapter = new CryptoCompareAdapter(apiKey);

        cryptoCompareData = await cryptoCompareAdapter.getMarketData(symbol);
        const ohlcResult = await cryptoCompareAdapter.getOHLCData(symbol);
        ohlcData = ohlcResult.ohlc;

        providerLatencies.CryptoCompare = Date.now() - cryptoCompareStart;
        cryptoCompareData.latencyMs = providerLatencies.CryptoCompare;
        providersCalled.push('CryptoCompare');
        console.log(`[CryptoCompare] SUCCESS - ${symbol} (${providerLatencies.CryptoCompare}ms)`);
        logger.info({ uid, symbol }, 'CryptoCompare data fetched successfully');
      } catch (err: any) {
        console.log(`[CryptoCompare] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'CryptoCompare fetch failed');
        cryptoCompareData = { error: err.message, latencyMs: Date.now() - cryptoCompareStart };
      }

      // 2. Fetch NewsData news data (sentiment) - REQUIRED
      console.log(`[NewsData] START - ${symbol}`);
      const newsDataStart = Date.now();
      try {
        // Use user API key if available, otherwise fallback to service-level key
        const userApiKey = integrations.newsdata?.apiKey;
        const serviceApiKey = config.research.newsdata.apiKey;
        const apiKey = userApiKey || serviceApiKey;

        if (!apiKey) {
          throw new Error('No NewsData API key available (user or service-level) - skipping gracefully');
        }

        if (userApiKey) {
          console.log("USING-KEY", { provider: 'NewsData', source: 'user' });
        } else if (serviceApiKey) {
          console.log("USING-KEY", { provider: 'NewsData', source: 'service' });
        } else {
          logger.warn({ uid, provider: 'NewsData' }, 'No NewsData API key available');
        }

        newsData = await fetchNewsData(apiKey, symbol);
        providerLatencies.NewsData = Date.now() - newsDataStart;
        newsData.latencyMs = providerLatencies.NewsData;
        providersCalled.push('NewsData');
        console.log(`[NewsData] SUCCESS - ${symbol} (${providerLatencies.NewsData}ms)`);
        logger.info({ uid, symbol }, 'NewsData news data fetched successfully');
      } catch (err: any) {
        console.log(`[NewsData] SKIPPED: ${err.message} - ${symbol}`);
        logger.info({ uid, symbol }, 'NewsData skipped due to missing API key');
        newsData = { error: err.message, latencyMs: Date.now() - newsDataStart };
      }

      // 3. Fetch CoinMarketCap data (optional backup)
      console.log(`[CoinMarketCap] START - ${symbol}`);
      const coinMarketCapStart = Date.now();
      try {
        // Use user API key if available, otherwise fallback to service-level key
        const userCmcApiKey = integrations.coinmarketcap?.apiKey;
        const serviceCmcApiKey = config.research.coinmarketcap.apiKey;
        const cmcApiKey = userCmcApiKey || serviceCmcApiKey;

        if (userCmcApiKey) {
          console.log("USING-KEY", { provider: 'CoinMarketCap', source: 'user' });
        } else if (serviceCmcApiKey) {
          console.log("USING-KEY", { provider: 'CoinMarketCap', source: 'service' });
        } else {
          logger.info({ uid, provider: 'CoinMarketCap' }, 'No CoinMarketCap API key available');
        }

        coinMarketCapData = await fetchCoinMarketCapMarketData(symbol, cmcApiKey || undefined);
        providerLatencies.CoinMarketCap = Date.now() - coinMarketCapStart;
        coinMarketCapData.latencyMs = providerLatencies.CoinMarketCap;
        providersCalled.push('CoinMarketCap');
        console.log(`[CoinMarketCap] SUCCESS - ${symbol} (${providerLatencies.CoinMarketCap}ms)`);
        logger.info({ uid, symbol }, 'CoinMarketCap data fetched successfully');
      } catch (err: any) {
        console.log(`[CoinMarketCap] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'CoinMarketCap fetch failed');
        coinMarketCapData = { error: err.message, latencyMs: Date.now() - coinMarketCapStart };
      }

      // 4. Fetch Binance Public data
      console.log(`[BinancePublic] START - ${symbol}`);
      const binancePublicStart = Date.now();
      try {
        const { BinanceAdapter } = await import('./binanceAdapter');
        const binanceAdapter = new BinanceAdapter();
        binancePublicData = await binanceAdapter.getPublicMarketData(symbol);
        providerLatencies.BinancePublic = Date.now() - binancePublicStart;
        binancePublicData.latencyMs = providerLatencies.BinancePublic;
        providersCalled.push('BinancePublic');
        console.log(`[BinancePublic] SUCCESS - ${symbol} (${providerLatencies.BinancePublic}ms)`);
        logger.info({ uid, symbol }, 'Binance Public data fetched successfully');
      } catch (err: any) {
        console.log(`[BinancePublic] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'Binance Public fetch failed');
        binancePublicData = { error: err.message, latencyMs: Date.now() - binancePublicStart };
      }

      // Ensure we have at least some OHLC data for indicators
      if (ohlcData.length === 0) {
        // Create synthetic OHLC data from available price data
        ohlcData = this.createSyntheticOHLCData(
          cryptoCompareData,
          coinMarketCapData,
          binancePublicData,
          symbol
        );
      }

      // ALWAYS GENERATE ALL INDICATORS - even if some data is missing
      console.log('Indicators generated: START');
      const rsi = tradingStrategies.calculateRSI(ohlcData);
      console.log('Indicators generated: RSI calculated');

      const volume = tradingStrategies.calculateVolumeAnalysis(ohlcData);
      console.log('Indicators generated: Volume calculated');

      const momentum = tradingStrategies.calculateMomentum(ohlcData);
      console.log('Indicators generated: Momentum calculated');

      const emaTrend = tradingStrategies.calculateEMATrend(ohlcData);
      console.log('Indicators generated: EMA Trend calculated');

      const smaTrend = tradingStrategies.calculateSMATrend(ohlcData);
      console.log('Indicators generated: SMA Trend calculated');

      const volatility = tradingStrategies.calculateVolatility(ohlcData);
      console.log('Indicators generated: Volatility calculated');

      const supportResistance = tradingStrategies.calculateSupportResistance(ohlcData);
      console.log('Indicators generated: Support/Resistance calculated');

      const priceAction = tradingStrategies.calculatePriceAction(ohlcData);
      console.log('Indicators generated: Price Action calculated');

      const vwap = tradingStrategies.calculateVWAP(ohlcData);
      console.log('Indicators generated: VWAP calculated');
      console.log('Indicators generated: ALL COMPLETE');

      // Select primary provider and get confirmations
      const { primaryProvider, providerConfirmations } = this.selectPrimaryProvider(
        cryptoCompareData,
        coinMarketCapData,
        binancePublicData,
        providersCalled
      );

      // Calculate news sentiment score for legacy compatibility
      let newsSentimentScore = 0.5; // Neutral default
      if (newsData && newsData.success && newsData.sentiment !== undefined) {
        newsSentimentScore = newsData.sentiment;
      }

      // Get normalized news data
      const normalizedNewsData = this.normalizeNewsData(newsData);

      // Combine trend indicators
      const trend: IndicatorResult = {
        emaTrend: emaTrend.emaTrend,
        smaTrend: smaTrend.smaTrend
      };

      // Generate strategy signals
      const marketData = this.consolidateMarketData(
        cryptoCompareData,
        coinMarketCapData,
        binancePublicData
      );

      const signals = tradingStrategies.generateStrategies(ohlcData, marketData);

      // Calculate combined signal
      // Calculate fundamentals score (0-1 scale) from available data
      const fundamentalsScore = this.calculateFundamentalsScore(coinMarketCapData, cryptoCompareData);

      const combinedResult = tradingStrategies.calculateCombinedSignal(signals, newsSentimentScore, fundamentalsScore);

      // Create legacy result
      const legacyResult: DeepResearchResult = {
        rsi,
        volume,
        momentum,
        trend,
        volatility,
        supportResistance,
        priceAction,
        vwap,
        signals,
        combinedSignal: combinedResult.signal,
        accuracy: combinedResult.accuracy,
        newsSentiment: newsSentimentScore,
        providersCalled: providersCalled.length > 0 ? providersCalled : ['Fallback'],
        raw: {
          cryptoCompare: cryptoCompareData,
          newsData: newsData,
          coinMarketCap: coinMarketCapData,
          binancePublic: binancePublicData
        }
      };

      // Create normalized result
      const normalizedResult = this.convertToNormalizedResult(
        legacyResult,
        primaryProvider,
        providerConfirmations,
        normalizedNewsData,
        marketData
      );

      console.log('DeepAnalysis generated: COMPLETE', {
        rsi: !!legacyResult.rsi,
        volume: !!legacyResult.volume,
        momentum: !!legacyResult.momentum,
        trend: !!legacyResult.trend,
        volatility: !!legacyResult.volatility,
        supportResistance: !!legacyResult.supportResistance,
        priceAction: !!legacyResult.priceAction,
        vwap: !!legacyResult.vwap,
        signals: legacyResult.signals?.length || 0
      });

      console.log('Returning final research result now...');

      // Save to Firestore
      await this.saveResearchResult(uid, symbol, legacyResult);

      // Check for auto-trade execution if confidence is high enough
      if (legacyResult.accuracy >= 0.75 && (legacyResult.combinedSignal === 'BUY' || legacyResult.combinedSignal === 'SELL')) {
        // Execute auto-trade asynchronously (don't block research response)
        setImmediate(async () => {
          try {
            // Get current price from available data
            let currentPrice = 50000; // fallback
            if (binancePublicData?.price) currentPrice = binancePublicData.price;
            else if (coinMarketCapData?.marketData?.price) currentPrice = coinMarketCapData.marketData.price;

            const tradeResult = await autoTradeExecutor.executeAutoTrade({
              userId: uid,
              symbol,
              signal: legacyResult.combinedSignal as 'BUY' | 'SELL',
              confidencePercent: Math.round(legacyResult.accuracy * 100),
              researchRequestId: `deep_research_${Date.now()}_${symbol}_${uid}`,
              currentPrice
            });

            if (tradeResult.success) {
              logger.info({
                userId: uid.substring(0, 8) + '...',
                symbol,
                signal: legacyResult.combinedSignal,
                orderId: tradeResult.orderId,
                dryRun: tradeResult.dryRun
              }, 'Auto-trade executed from deep research');
            }
          } catch (error) {
            logger.error({
              error: error.message,
              userId: uid.substring(0, 8) + '...',
              symbol
            }, 'Auto-trade execution failed from deep research');
          }
        });
      }

            const totalDuration = Date.now() - startTime;
            logger.info({
              uid,
              symbol,
              signal: legacyResult.combinedSignal,
              accuracy: legacyResult.accuracy,
              durationMs: totalDuration,
              providersCalled: providersCalled.length,
              successfulProviders: providersCalled.length
            }, 'Deep research analysis completed successfully');

      return { legacyResult, normalizedResult };

    } catch (error: any) {
      logger.error({ error: error.message, uid, symbol }, 'Deep research analysis failed');

      // Return fallback results
      const fallbackLegacyResult: DeepResearchResult = {
        rsi: { value: 50, strength: 0.5 },
        volume: { score: 0.5, trend: 'neutral' },
        momentum: { score: 0.5, direction: 'neutral' },
        trend: { emaTrend: 'neutral', smaTrend: 'neutral' },
        volatility: { atrPct: 0, classification: 'unknown' },
        supportResistance: { nearSupport: false, nearResistance: false, breakout: false },
        priceAction: { pattern: 'none', confidence: 0 },
        vwap: { deviationPct: 0, signal: 'neutral' },
        signals: [],
        combinedSignal: 'HOLD',
        accuracy: 0.5,
        newsSentiment: 0.5,
        providersCalled: ['None'],
        raw: {
          cryptoCompare: cryptoCompareData,
          newsData: newsData,
          coinMarketCap: coinMarketCapData,
          binancePublic: binancePublicData
        }
      };

      const fallbackNormalizedResult: NormalizedDeepResearchResult = {
        primaryProvider: 'Fallback',
        marketOverview: {
          price: 0,
          priceChangePercent24h: 0,
          volume24h: 0,
          high24h: 0,
          low24h: 0,
          marketCap: 0,
          vwapDeviation: 0
        },
        providers: [],
        news: {
          sentimentScore: 0.5,
          articles: []
        },
        deepAnalysis: {
          finalSignal: 'HOLD',
          confidencePercent: 50,
          indicators: {
            rsi: fallbackLegacyResult.rsi,
            ema: fallbackLegacyResult.trend,
            sma: fallbackLegacyResult.trend,
            momentum: fallbackLegacyResult.momentum,
            volume: fallbackLegacyResult.volume,
            vwap: fallbackLegacyResult.vwap,
            atr: fallbackLegacyResult.volatility,
            supportResistance: fallbackLegacyResult.supportResistance,
            priceAction: fallbackLegacyResult.priceAction
          },
          signals: []
        }
      };

      return { legacyResult: fallbackLegacyResult, normalizedResult: fallbackNormalizedResult };
    }
  }

  private createSyntheticOHLCData(
    cryptoCompare: any,
    coinMarketCap: any,
    binancePublic: any,
    symbol: string
  ): OHLCData[] {
    // Get current price from available sources
    let currentPrice = 100; // fallback
    let change24h = 0;

    if (binancePublic && !binancePublic.error && binancePublic.price) {
      currentPrice = binancePublic.price;
      change24h = binancePublic.priceChangePercent24h || 0;
    } else if (cryptoCompare && !cryptoCompare.error && cryptoCompare.price) {
      currentPrice = cryptoCompare.price;
      change24h = cryptoCompare.priceChangePercent24h || 0;
    } else if (coinMarketCap && !coinMarketCap.error && coinMarketCap.marketData?.price) {
      currentPrice = coinMarketCap.marketData.price;
      change24h = coinMarketCap.marketData.priceChangePercent24h || 0;
    }

    // Create synthetic 24-hour OHLC data
    const basePrice = currentPrice / (1 + change24h / 100);
    const volatility = Math.abs(change24h) / 100;

    const ohlcData: OHLCData[] = [];
    const now = Date.now();

    for (let i = 23; i >= 0; i--) {
      const timestamp = now - (i * 60 * 60 * 1000); // Hourly data for 24 hours
      const hourChange = (Math.random() - 0.5) * volatility * currentPrice;
      const hourPrice = basePrice + (hourChange * (24 - i) / 24);

      const high = hourPrice * (1 + Math.random() * volatility * 0.5);
      const low = hourPrice * (1 - Math.random() * volatility * 0.5);
      const open = ohlcData.length > 0 ? ohlcData[ohlcData.length - 1].close : hourPrice;
      const close = hourPrice;
      const volume = Math.random() * 1000000 + 500000; // Random volume

      ohlcData.push({
        timestamp,
        open,
        high,
        low,
        close,
        volume
      });
    }

    return ohlcData;
  }

  private consolidateMarketData(
    cryptoCompare: any,
    coinMarketCap: any,
    binancePublic: any
  ): any {
    // Get the best available price and volume data with new priority order
    let price = 0;
    let volume24h = 0;
    let change24h = 0;

    // Priority: Binance > CryptoCompare > CoinMarketCap
    if (binancePublic && !binancePublic.error) {
      price = binancePublic.price || price;
      volume24h = binancePublic.volume24h || volume24h;
      change24h = binancePublic.priceChangePercent24h || change24h;
    }

    if (cryptoCompare && !cryptoCompare.error) {
      price = price || cryptoCompare.price;
      volume24h = volume24h || cryptoCompare.volume24h;
      change24h = change24h || cryptoCompare.priceChangePercent24h;
    }

    if (coinMarketCap && !coinMarketCap.error && coinMarketCap.marketData) {
      price = price || coinMarketCap.marketData.price;
      volume24h = volume24h || coinMarketCap.marketData.volume24h;
      change24h = change24h || coinMarketCap.marketData.priceChangePercent24h;
    }

    return {
      price,
      volume24h,
      change24h,
      priceChangePercent: change24h
    };
  }

  private getProviderPriority(): string[] {
    return ['BinancePublic', 'CryptoCompare', 'CoinMarketCap'];
  }

  private selectPrimaryProvider(
    cryptoCompare: any,
    coinMarketCap: any,
    binancePublic: any,
    providersCalled: string[]
  ): { primaryProvider: string; providerConfirmations: ProviderConfirmation[] } {
    const priorityOrder = this.getProviderPriority();
    const providerData = {
      CryptoCompare: cryptoCompare,
      CoinMarketCap: coinMarketCap,
      BinancePublic: binancePublic
    };

    let primaryProvider = '';
    let primaryPrice = 0;
    const confirmations: ProviderConfirmation[] = [];

    // Find the highest priority working provider
    for (const providerName of priorityOrder) {
      const data = providerData[providerName as keyof typeof providerData];
      if (data && !data.error && !data.rateLimited) {
        if (!primaryProvider) {
          primaryProvider = providerName;
          primaryPrice = data.price || 0;
        } else {
          // This is a confirmation provider
          const status = data.error ? 'failed' :
                        (data.rateLimited ? 'rate-limited' : 'success');
          const confirmationDeltaPercent = primaryPrice > 0 && data.price ?
            ((data.price - primaryPrice) / primaryPrice) * 100 : undefined;

          confirmations.push({
            name: providerName,
            status,
            latencyMs: data.latencyMs || 0,
            confirmationDeltaPercent,
            raw: data
          });
        }
      } else if (providersCalled.includes(providerName)) {
        // Provider was called but failed
        confirmations.push({
          name: providerName,
          status: data?.rateLimited ? 'rate-limited' : 'failed',
          latencyMs: data?.latencyMs || 0,
          raw: data
        });
      }
    }

    // If no primary provider found, use fallback
    if (!primaryProvider) {
      primaryProvider = 'Fallback';
    }

    return { primaryProvider, providerConfirmations: confirmations };
  }

  private normalizeNewsData(newsData: any): NormalizedDeepResearchResult['news'] {
    let sentimentScore = 0.5;
    let articles: NormalizedDeepResearchResult['news']['articles'] = [];

    if (newsData && newsData.success && newsData.articles) {
      articles = newsData.articles.slice(0, 5).map((article: any) => ({
        title: article.title || 'Untitled',
        source: article.source || 'Unknown',
        url: article.url || '',
        published_at: article.published_at || new Date().toISOString()
      }));

      // Use the sentiment score from NewsData adapter
      sentimentScore = newsData.sentiment || 0.5;
    }

    return { sentimentScore, articles };
  }

  private convertToNormalizedResult(
    legacyResult: DeepResearchResult,
    primaryProvider: string,
    providerConfirmations: ProviderConfirmation[],
    newsData: NormalizedDeepResearchResult['news'],
    marketOverview: any
  ): NormalizedDeepResearchResult {
    return {
      primaryProvider,
      marketOverview: {
        price: marketOverview.price || 0,
        priceChangePercent24h: marketOverview.priceChangePercent || 0,
        volume24h: marketOverview.volume24h || 0,
        high24h: 0, // Will be populated from primary provider data
        low24h: 0,  // Will be populated from primary provider data
        marketCap: 0, // Will be populated from primary provider data
        vwapDeviation: 0 // Will be calculated
      },
      providers: providerConfirmations,
      news: newsData,
      deepAnalysis: {
        finalSignal: legacyResult.combinedSignal,
        confidencePercent: Math.round(legacyResult.accuracy * 100),
        indicators: {
          rsi: legacyResult.rsi,
          ema: { value: 0, strength: 0.5, emaTrend: legacyResult.trend.emaTrend } as IndicatorResult,
          sma: { value: 0, strength: 0.5, smaTrend: legacyResult.trend.smaTrend } as IndicatorResult,
          momentum: legacyResult.momentum,
          volume: legacyResult.volume,
          vwap: legacyResult.vwap,
          atr: legacyResult.volatility, // ATR is volatility
          supportResistance: legacyResult.supportResistance,
          priceAction: legacyResult.priceAction
        },
        signals: legacyResult.signals
      }
    };
  }

  private async saveResearchResult(uid: string, symbol: string, result: DeepResearchResult): Promise<void> {
    try {
      const researchResult = {
        symbol,
        signal: result.combinedSignal,
        accuracy: result.accuracy,
        orderbookImbalance: 0,
        recommendedAction: result.combinedSignal,
        microSignals: {
          spread: 0,
          volume: 0,
          priceMomentum: 0,
          orderbookDepth: 0,
        },
        timestamp: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
        userId: uid,
        dataSources: {
          cryptoCompare: result.providersCalled.includes('CryptoCompare'),
          newsData: result.providersCalled.includes('NewsData'),
          coinMarketCap: result.providersCalled.includes('CoinMarketCap'),
          binancePublic: result.providersCalled.includes('BinancePublic'),
        },
        // Store detailed analysis
        deepAnalysis: {
          rsi: result.rsi,
          volume: result.volume,
          momentum: result.momentum,
          trend: result.trend,
          volatility: result.volatility,
          supportResistance: result.supportResistance,
          priceAction: result.priceAction,
          vwap: result.vwap,
          signals: result.signals,
          newsSentiment: result.newsSentiment
        }
      };

      await firestoreAdapter.saveResearchLog(uid, researchResult);
    } catch (error: any) {
      logger.warn({ error: error.message, uid, symbol }, 'Failed to save detailed research result');
    }
  }
}

export const deepResearchEngine = new DeepResearchEngine();
