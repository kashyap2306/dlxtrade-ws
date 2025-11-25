import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { fetchMarketAuxData } from './marketauxAdapter';
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
  providersCalled: string[];
  raw: {
    cryptoCompare: any;
    marketAux: any;
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
    let marketAuxData: any = {};
    let coinGeckoData: any = {};
    let googleFinanceData: any = {};
    let binancePublicData: any = {};
    let ohlcData: OHLCData[] = [];

    const providersCalled: string[] = [];

    try {
      // 1. Fetch CryptoCompare data (OHLC historical data)
      if (integrations.cryptocompare?.apiKey) {
        try {
          const { CryptoCompareAdapter } = await import('./cryptocompareAdapter');
          const cryptoCompareAdapter = new CryptoCompareAdapter(integrations.cryptocompare.apiKey);

          cryptoCompareData = await cryptoCompareAdapter.getMarketData(symbol);
          const ohlcResult = await cryptoCompareAdapter.getOHLCData(symbol);
          ohlcData = ohlcResult.ohlc;

          providersCalled.push('CryptoCompare');
          logger.info({ uid, symbol }, 'CryptoCompare data fetched successfully');
        } catch (err: any) {
          logger.warn({ err: err.message, symbol }, 'CryptoCompare fetch failed');
          cryptoCompareData = { error: err.message };
        }
      }

      // 2. Fetch MarketAux data (sentiment)
      if (integrations.marketaux?.apiKey) {
        try {
          marketAuxData = await fetchMarketAuxData(integrations.marketaux.apiKey, symbol);
          providersCalled.push('MarketAux');
          logger.info({ uid, symbol }, 'MarketAux data fetched successfully');
        } catch (err: any) {
          logger.warn({ err: err.message, symbol }, 'MarketAux fetch failed');
          marketAuxData = { error: err.message };
        }
      }

      // 3. Fetch CoinGecko data
      try {
        const { CoinGeckoAdapter } = await import('./coingeckoAdapter');
        const coinGeckoAdapter = new CoinGeckoAdapter();
        coinGeckoData = await coinGeckoAdapter.getMarketData(symbol);
        providersCalled.push('CoinGecko');
        logger.info({ uid, symbol }, 'CoinGecko data fetched successfully');
      } catch (err: any) {
        logger.warn({ err: err.message, symbol }, 'CoinGecko fetch failed');
        coinGeckoData = { error: err.message };
      }

      // 4. Fetch Google Finance data
      try {
        const { GoogleFinanceAdapter } = await import('./googleFinanceAdapter');
        const googleFinanceAdapter = new GoogleFinanceAdapter();
        googleFinanceData = await googleFinanceAdapter.getMarketData(symbol);
        providersCalled.push('GoogleFinance');
        logger.info({ uid, symbol }, 'Google Finance data fetched successfully');
      } catch (err: any) {
        logger.warn({ err: err.message, symbol }, 'Google Finance fetch failed');
        googleFinanceData = { error: err.message };
      }

      // 5. Fetch Binance Public data
      try {
        const { BinanceAdapter } = await import('./binanceAdapter');
        const binanceAdapter = new BinanceAdapter();
        binancePublicData = await binanceAdapter.getPublicMarketData(symbol);
        providersCalled.push('BinancePublic');
        logger.info({ uid, symbol }, 'Binance Public data fetched successfully');
      } catch (err: any) {
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

      // Calculate all indicators using the trading strategies engine
      const rsi = tradingStrategies.calculateRSI(ohlcData);
      const volume = tradingStrategies.calculateVolumeAnalysis(ohlcData);
      const momentum = tradingStrategies.calculateMomentum(ohlcData);
      const emaTrend = tradingStrategies.calculateEMATrend(ohlcData);
      const smaTrend = tradingStrategies.calculateSMATrend(ohlcData);
      const volatility = tradingStrategies.calculateVolatility(ohlcData);
      const supportResistance = tradingStrategies.calculateSupportResistance(ohlcData);
      const priceAction = tradingStrategies.calculatePriceAction(ohlcData);
      const vwap = tradingStrategies.calculateVWAP(ohlcData);

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
        providersCalled: providersCalled.length > 0 ? providersCalled : ['Fallback'],
        raw: {
          cryptoCompare: cryptoCompareData,
          marketAux: marketAuxData,
          coinGecko: coinGeckoData,
          googleFinance: googleFinanceData,
          binancePublic: binancePublicData
        }
      };

      // Save to Firestore
      await this.saveResearchResult(uid, symbol, result);

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
        providersCalled: ['None'],
        raw: {
          cryptoCompare: cryptoCompareData,
          marketAux: marketAuxData,
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
          marketAux: result.providersCalled.includes('MarketAux'),
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
          signals: result.signals
        }
      };

      await firestoreAdapter.saveResearchLog(uid, researchResult);
    } catch (error: any) {
      logger.warn({ error: error.message, uid, symbol }, 'Failed to save detailed research result');
    }
  }
}

export const deepResearchEngine = new DeepResearchEngine();
