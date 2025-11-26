import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { fetchNewsData } from './newsDataAdapter';
import { fetchCoinMarketCapMetadata, fetchCoinMarketCapMarketData } from './coinMarketCapAdapter';
import { autoTradeExecutor } from './autoTradeExecutor';
import { tradingStrategies, OHLCData, StrategyResult, IndicatorResult } from './tradingStrategies';
import * as admin from 'firebase-admin';

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

  async runDeepResearch(symbol: string, uid: string): Promise<DeepResearchResult> {
    // For backward compatibility, run the legacy method and return legacy format
    const result = await this.runDeepResearchInternal(symbol, uid);
    return result.legacyResult;
  }

  async runNormalizedDeepResearch(symbol: string, uid: string): Promise<NormalizedDeepResearchResult> {
    const result = await this.runDeepResearchInternal(symbol, uid);
    return result.normalizedResult;
  }

  private async runDeepResearchInternal(symbol: string, uid: string): Promise<{
    legacyResult: DeepResearchResult;
    normalizedResult: NormalizedDeepResearchResult;
  }> {
    logger.info({ uid, symbol }, 'Starting comprehensive deep research analysis');

    // Get user integrations
    const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

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
        const cryptoCompareAdapter = new CryptoCompareAdapter(integrations.cryptocompare?.apiKey || '');

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
        if (!integrations.newsData?.apiKey) {
          throw new Error('NewsData API key is required');
        }
        newsData = await fetchNewsData(integrations.newsData.apiKey, symbol);
        providerLatencies.NewsData = Date.now() - newsDataStart;
        newsData.latencyMs = providerLatencies.NewsData;
        providersCalled.push('NewsData');
        console.log(`[NewsData] SUCCESS - ${symbol} (${providerLatencies.NewsData}ms)`);
        logger.info({ uid, symbol }, 'NewsData news data fetched successfully');
      } catch (err: any) {
        console.log(`[NewsData] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'NewsData news fetch failed');
        newsData = { error: err.message, latencyMs: Date.now() - newsDataStart };
      }

      // 3. Fetch CoinMarketCap data (optional backup)
      console.log(`[CoinMarketCap] START - ${symbol}`);
      const coinMarketCapStart = Date.now();
      try {
        coinMarketCapData = await fetchCoinMarketCapMarketData(symbol, integrations.coinmarketcap?.apiKey);
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

      logger.info({ uid, symbol, signal: legacyResult.combinedSignal, accuracy: legacyResult.accuracy },
        'Deep research analysis completed successfully');

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
      if (data && !data.error && (!data.rateLimited || providerName !== 'CoinGecko')) {
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
          cryptoPanic: result.providersCalled.includes('CryptoPanic'),
          cryptoCompare: result.providersCalled.includes('CryptoCompare'),
          googleFinance: result.providersCalled.includes('GoogleFinance'),
          binancePublic: result.providersCalled.includes('BinancePublic'),
          coinGecko: result.providersCalled.includes('CoinGecko'),
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
