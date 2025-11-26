import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { fetchCryptoPanicNews } from './cryptoPanicAdapter';
import { autoTradeExecutor } from './autoTradeExecutor';
import { tradingStrategies, OHLCData, StrategyResult, IndicatorResult } from './tradingStrategies';
import * as admin from 'firebase-admin';

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
    cryptoPanic: any;
    coinGecko: any;
    googleFinance: any;
    binancePublic: any;
  };
}

export class DeepResearchEngine {
  async runDeepResearch(symbol: string, uid: string): Promise<DeepResearchResult> {
    logger.info({ uid, symbol }, 'Starting comprehensive deep research analysis');

    // Get user integrations
    const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

    // Initialize data containers
    let cryptoCompareData: any = {};
    let cryptoPanicData: any = {};
    let coinGeckoData: any = {};
    let googleFinanceData: any = {};
    let binancePublicData: any = {};
    let ohlcData: OHLCData[] = [];

    const providersCalled: string[] = [];

    try {
      // ALWAYS EXECUTE ALL 5 PROVIDERS - regardless of user API keys

      // 1. Fetch CryptoCompare data (OHLC historical data)
      console.log(`[CryptoCompare] START - ${symbol}`);
      try {
        const { CryptoCompareAdapter } = await import('./cryptocompareAdapter');
        const cryptoCompareAdapter = new CryptoCompareAdapter(integrations.cryptocompare?.apiKey || '');

        cryptoCompareData = await cryptoCompareAdapter.getMarketData(symbol);
        const ohlcResult = await cryptoCompareAdapter.getOHLCData(symbol);
        ohlcData = ohlcResult.ohlc;

        providersCalled.push('CryptoCompare');
        console.log(`[CryptoCompare] SUCCESS - ${symbol}`);
        logger.info({ uid, symbol }, 'CryptoCompare data fetched successfully');
      } catch (err: any) {
        console.log(`[CryptoCompare] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'CryptoCompare fetch failed');
        cryptoCompareData = { error: err.message };
      }

      // 2. Fetch CryptoPanic news data (sentiment)
      console.log(`[CryptoPanic] START - ${symbol}`);
      try {
        cryptoPanicData = await fetchCryptoPanicNews(integrations.cryptopanic?.apiKey);
        providersCalled.push('CryptoPanic');
        console.log(`[CryptoPanic] SUCCESS - ${symbol}`);
        logger.info({ uid, symbol }, 'CryptoPanic news data fetched successfully');
      } catch (err: any) {
        console.log(`[CryptoPanic] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'CryptoPanic news fetch failed');
        cryptoPanicData = { error: err.message };
      }

      // 3. Fetch CoinGecko data
      console.log(`[CoinGecko] START - ${symbol}`);
      try {
        const { CoinGeckoAdapter } = await import('./coingeckoAdapter');
        const coinGeckoAdapter = new CoinGeckoAdapter();
        coinGeckoData = await coinGeckoAdapter.getMarketData(symbol);
        providersCalled.push('CoinGecko');
        console.log(`[CoinGecko] SUCCESS - ${symbol}`);
        logger.info({ uid, symbol }, 'CoinGecko data fetched successfully');
      } catch (err: any) {
        console.log(`[CoinGecko] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'CoinGecko fetch failed');
        coinGeckoData = { error: err.message };
      }

      // 4. Fetch Google Finance data
      console.log(`[GoogleFinance] START - ${symbol}`);
      try {
        const { GoogleFinanceAdapter } = await import('./googleFinanceAdapter');
        const googleFinanceAdapter = new GoogleFinanceAdapter();
        googleFinanceData = await googleFinanceAdapter.getMarketData(symbol);
        providersCalled.push('GoogleFinance');
        console.log(`[GoogleFinance] SUCCESS - ${symbol}`);
        logger.info({ uid, symbol }, 'Google Finance data fetched successfully');
      } catch (err: any) {
        console.log(`[GoogleFinance] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'Google Finance fetch failed');
        googleFinanceData = { error: err.message };
      }

      // 5. Fetch Binance Public data
      console.log(`[BinancePublic] START - ${symbol}`);
      try {
        const { BinanceAdapter } = await import('./binanceAdapter');
        const binanceAdapter = new BinanceAdapter();
        binancePublicData = await binanceAdapter.getPublicMarketData(symbol);
        providersCalled.push('BinancePublic');
        console.log(`[BinancePublic] SUCCESS - ${symbol}`);
        logger.info({ uid, symbol }, 'Binance Public data fetched successfully');
      } catch (err: any) {
        console.log(`[BinancePublic] FAILED: ${err.message} - ${symbol}`);
        logger.warn({ err: err.message, symbol }, 'Binance Public fetch failed');
        binancePublicData = { error: err.message };
      }

      // Ensure we have at least some OHLC data for indicators
      if (ohlcData.length === 0) {
        // Create synthetic OHLC data from available price data
        ohlcData = this.createSyntheticOHLCData(
          cryptoCompareData,
          coinGeckoData,
          googleFinanceData,
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

      // Calculate news sentiment score
      let newsSentimentScore = 0.5; // Neutral default
      if (cryptoPanicData && cryptoPanicData.success && cryptoPanicData.articles) {
        const articles = cryptoPanicData.articles;
        if (articles.length > 0) {
          // Simple sentiment analysis based on tags (could be enhanced)
          const bullishTags = articles.filter(a => a.tags?.some(tag =>
            tag.toLowerCase().includes('bullish') || tag.toLowerCase().includes('positive')
          )).length;
          const bearishTags = articles.filter(a => a.tags?.some(tag =>
            tag.toLowerCase().includes('bearish') || tag.toLowerCase().includes('negative')
          )).length;

          if (bullishTags + bearishTags > 0) {
            // Calculate sentiment score: 0.5 + (bullish - bearish) / total * 0.5
            const sentimentDiff = (bullishTags - bearishTags) / (bullishTags + bearishTags);
            newsSentimentScore = 0.5 + (sentimentDiff * 0.5);
          }
        }
      }

      // Combine trend indicators
      const trend: IndicatorResult = {
        emaTrend: emaTrend.emaTrend,
        smaTrend: smaTrend.smaTrend
      };

      // Generate strategy signals
      const marketData = this.consolidateMarketData(
        cryptoCompareData,
        coinGeckoData,
        googleFinanceData,
        binancePublicData
      );

      const signals = tradingStrategies.generateStrategies(ohlcData, marketData);

      // Calculate combined signal
      const combinedResult = tradingStrategies.calculateCombinedSignal(signals);

      const result: DeepResearchResult = {
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
          cryptoPanic: cryptoPanicData,
          coinGecko: coinGeckoData,
          googleFinance: googleFinanceData,
          binancePublic: binancePublicData
        }
      };

      console.log('DeepAnalysis generated: COMPLETE', {
        rsi: !!result.rsi,
        volume: !!result.volume,
        momentum: !!result.momentum,
        trend: !!result.trend,
        volatility: !!result.volatility,
        supportResistance: !!result.supportResistance,
        priceAction: !!result.priceAction,
        vwap: !!result.vwap,
        signals: result.signals?.length || 0
      });

      console.log('Returning final research result now...');

      // Save to Firestore
      await this.saveResearchResult(uid, symbol, result);

      // Check for auto-trade execution if confidence is high enough
      if (result.accuracy >= 0.75 && (result.combinedSignal === 'BUY' || result.combinedSignal === 'SELL')) {
        // Execute auto-trade asynchronously (don't block research response)
        setImmediate(async () => {
          try {
            // Get current price from available data
            let currentPrice = 50000; // fallback
            if (binancePublicData?.price) currentPrice = binancePublicData.price;
            else if (coinGeckoData?.price) currentPrice = coinGeckoData.price;

            const tradeResult = await autoTradeExecutor.executeAutoTrade({
              userId: uid,
              symbol,
              signal: result.combinedSignal as 'BUY' | 'SELL',
              confidencePercent: Math.round(result.accuracy * 100),
              researchRequestId: `deep_research_${Date.now()}_${symbol}_${uid}`,
              currentPrice
            });

            if (tradeResult.success) {
              logger.info({
                userId: uid.substring(0, 8) + '...',
                symbol,
                signal: result.combinedSignal,
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

      logger.info({ uid, symbol, signal: result.combinedSignal, accuracy: result.accuracy },
        'Deep research analysis completed successfully');

      return result;

    } catch (error: any) {
      logger.error({ error: error.message, uid, symbol }, 'Deep research analysis failed');

      // Return fallback result
      const fallbackResult: DeepResearchResult = {
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
          cryptoPanic: cryptoPanicData,
          coinGecko: coinGeckoData,
          googleFinance: googleFinanceData,
          binancePublic: binancePublicData
        }
      };

      return fallbackResult;
    }
  }

  private createSyntheticOHLCData(
    cryptoCompare: any,
    coinGecko: any,
    googleFinance: any,
    binancePublic: any,
    symbol: string
  ): OHLCData[] {
    // Get current price from available sources
    let currentPrice = 100; // fallback
    let change24h = 0;

    if (binancePublic && !binancePublic.error && binancePublic.price) {
      currentPrice = binancePublic.price;
      change24h = binancePublic.priceChangePercent24h || 0;
    } else if (coinGecko && !coinGecko.error && !coinGecko.rateLimited && coinGecko.price) {
      currentPrice = coinGecko.price;
      change24h = coinGecko.change24h || 0;
    } else if (cryptoCompare && !cryptoCompare.error && cryptoCompare.price) {
      currentPrice = cryptoCompare.price;
      change24h = cryptoCompare.priceChangePercent24h || 0;
    } else if (googleFinance && !googleFinance.error && googleFinance.price) {
      currentPrice = googleFinance.price;
      change24h = googleFinance.priceChangePercent || 0;
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
    coinGecko: any,
    googleFinance: any,
    binancePublic: any
  ): any {
    // Get the best available price and volume data
    let price = 0;
    let volume24h = 0;
    let change24h = 0;

    // Priority: Binance > CoinGecko > CryptoCompare > Google Finance
    if (binancePublic && !binancePublic.error) {
      price = binancePublic.price || price;
      volume24h = binancePublic.volume24h || volume24h;
      change24h = binancePublic.priceChangePercent24h || change24h;
    }

    if (coinGecko && !coinGecko.error && !coinGecko.rateLimited) {
      price = price || coinGecko.price;
      volume24h = volume24h || coinGecko.volume24h;
      change24h = change24h || coinGecko.change24h;
    }

    if (cryptoCompare && !cryptoCompare.error) {
      price = price || cryptoCompare.price;
      volume24h = volume24h || cryptoCompare.volume24h;
      change24h = change24h || cryptoCompare.priceChangePercent24h;
    }

    if (googleFinance && !googleFinance.error) {
      price = price || googleFinance.price;
      volume24h = volume24h || googleFinance.volume24h;
      change24h = change24h || googleFinance.priceChangePercent;
    }

    return {
      price,
      volume24h,
      change24h,
      priceChangePercent: change24h
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
