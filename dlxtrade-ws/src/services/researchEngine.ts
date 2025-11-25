import { logger } from '../utils/logger';
import { BinanceAdapter } from './binanceAdapter';
import { firestoreAdapter } from './firestoreAdapter';
// import { CryptoQuantAdapter } from './cryptoquantAdapter'; // DISABLED: CryptoQuant removed
import { LunarCrushAdapter } from './lunarcrushAdapter';
import { CoinAPIAdapter } from './coinapiAdapter';
import { fetchMarketAuxData } from './marketauxAdapter';
import type { Orderbook, Trade } from '../types';

export interface ResearchResult {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: {
    spread: number;
    volume: number;
    priceMomentum: number;
    orderbookDepth: number;
  };
}

export class ResearchEngine {
  private recentTrades: Map<string, Trade[]> = new Map();
  private orderbookHistory: Map<string, Orderbook[]> = new Map();
  private spreadHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private depthHistory: Map<string, number[]> = new Map();
  private imbalanceHistory: Map<string, number[]> = new Map();

  async runResearch(symbol: string, uid: string): Promise<ResearchResult> {
    // This method now works ENTIRELY on the 5 allowed research APIs only:
    // - CryptoCompare (user-provided)
    // - MarketAux (user-provided)
    // - Google Finance (auto-enabled)
    // - Binance Public API (auto-enabled)
    // - CoinGecko (auto-enabled)
    //
    // NO trading exchange adapters (Binance, Bitget, BingX, WEEX) are used
    // NO orderbook data is used in research flow

    const imbalance = 0;
    const microSignals: ResearchResult['microSignals'] = {
      spread: 0,
      volume: 0,
      priceMomentum: 0,
      orderbookDepth: 0,
    };

    // Calculate accuracy based on research APIs only
    let accuracy = await this.calculateAccuracyFromResearchAPIs(symbol, uid);

    // Determine signal using research APIs only
    const signal = await this.determineSignalFromResearchAPIs(symbol, accuracy, uid);

    // Recommended action
    const recommendedAction = this.getRecommendedAction(signal, accuracy);

    const result: ResearchResult = {
      symbol,
      signal,
      accuracy,
      orderbookImbalance: imbalance,
      recommendedAction,
      microSignals,
    };

    // Save to Firestore
    await firestoreAdapter.saveResearchLog(uid, {
      symbol,
      timestamp: require('firebase-admin').firestore.Timestamp.now(),
      signal,
      accuracy,
      orderbookImbalance: imbalance,
      recommendedAction,
      microSignals,
    });

    logger.info({ symbol, signal, accuracy }, 'Research completed (5 allowed APIs only)');

    return result;
  }

  /**
   * Determine signal from the 5 allowed research APIs only
   */
  private async determineSignalFromResearchAPIs(
    symbol: string,
    accuracy: number,
    uid: string
  ): Promise<'BUY' | 'SELL' | 'HOLD'> {
    if (accuracy < 0.5) {
      return 'HOLD';
    }

    try {
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);
      let bullishSignals = 0;
      let bearishSignals = 0;

      // Analyze CryptoCompare data (user-provided, required)
      if (integrations.cryptocompare) {
        try {
          const { CryptoCompareAdapter } = await import('./cryptocompareAdapter');
          const adapter = new CryptoCompareAdapter(integrations.cryptocompare.apiKey);
          const marketData = await adapter.getMarketData(symbol);
          if (marketData.priceChangePercent24h && marketData.priceChangePercent24h > 2) {
            bullishSignals++;
          } else if (marketData.priceChangePercent24h && marketData.priceChangePercent24h < -2) {
            bearishSignals++;
          }
        } catch (err) {
          logger.debug({ err, symbol }, 'CryptoCompare signal analysis error (non-critical)');
        }
      }

      // Analyze MarketAux news data (user-provided, required)
      if (integrations.marketaux) {
        try {
          const newsData = await fetchMarketAuxData(integrations.marketaux.apiKey, symbol);
          // MarketAux sentiment analysis would go here
          // For now, count positive mentions as bullish
          if (newsData.positiveMentions && newsData.positiveMentions > newsData.negativeMentions) {
            bullishSignals++;
          } else if (newsData.negativeMentions && newsData.negativeMentions > newsData.positiveMentions) {
            bearishSignals++;
          }
        } catch (err) {
          logger.debug({ err, symbol }, 'MarketAux signal analysis error (non-critical)');
        }
      }

      // Analyze Google Finance data (auto-enabled)
      try {
        const { GoogleFinanceAdapter } = await import('./googleFinanceAdapter');
        const adapter = new GoogleFinanceAdapter();
        const financeData = await adapter.getMarketData(symbol);
        if (financeData.priceChangePercent && financeData.priceChangePercent > 1) {
          bullishSignals++;
        } else if (financeData.priceChangePercent && financeData.priceChangePercent < -1) {
          bearishSignals++;
        }
      } catch (err) {
        logger.debug({ err, symbol }, 'Google Finance signal analysis error (non-critical)');
      }

      // Analyze Binance Public API data (auto-enabled)
      try {
        const { BinanceAdapter } = await import('./binanceAdapter');
        const adapter = new BinanceAdapter();
        const publicData = await adapter.getPublicMarketData(symbol);
        if (publicData.priceChangePercent && publicData.priceChangePercent > 1) {
          bullishSignals++;
        } else if (publicData.priceChangePercent && publicData.priceChangePercent < -1) {
          bearishSignals++;
        }
      } catch (err) {
        logger.debug({ err, symbol }, 'Binance Public API signal analysis error (non-critical)');
      }

      // Analyze CoinGecko data (auto-enabled)
      try {
        const { CoinGeckoAdapter } = await import('./coingeckoAdapter');
        const adapter = new CoinGeckoAdapter();
        const geckoData = await adapter.getMarketData(symbol);
        if (geckoData.priceChangePercent24h && geckoData.priceChangePercent24h > 1) {
          bullishSignals++;
        } else if (geckoData.priceChangePercent24h && geckoData.priceChangePercent24h < -1) {
          bearishSignals++;
        }
      } catch (err) {
        logger.debug({ err, symbol }, 'CoinGecko signal analysis error (non-critical)');
      }

      if (bullishSignals > bearishSignals) {
        return 'BUY';
      } else if (bearishSignals > bullishSignals) {
        return 'SELL';
      }
    } catch (err) {
      logger.debug({ err, symbol }, 'Error determining signal from research APIs');
    }

    return 'HOLD';
  }

  private calculateOrderbookImbalance(orderbook: Orderbook): number {
    if (orderbook.bids.length === 0 || orderbook.asks.length === 0) {
      return 0;
    }

    const bidVolume = orderbook.bids.slice(0, 10).reduce((sum, bid) => {
      return sum + parseFloat(bid.quantity);
    }, 0);

    const askVolume = orderbook.asks.slice(0, 10).reduce((sum, ask) => {
      return sum + parseFloat(ask.quantity);
    }, 0);

    const totalVolume = bidVolume + askVolume;
    if (totalVolume === 0) return 0;

    // Imbalance: positive = more bids (bullish), negative = more asks (bearish)
    return (bidVolume - askVolume) / totalVolume;
  }

  private calculateMicroSignals(symbol: string, orderbook: Orderbook): ResearchResult['microSignals'] {
    const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;
    const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    const bidDepth = orderbook.bids.slice(0, 5).reduce((sum, bid) => {
      return sum + parseFloat(bid.quantity) * parseFloat(bid.price);
    }, 0);

    const askDepth = orderbook.asks.slice(0, 5).reduce((sum, ask) => {
      return sum + parseFloat(ask.quantity) * parseFloat(ask.price);
    }, 0);

    // Simple volume calculation
    const volume = bidDepth + askDepth;

    // Price momentum from per-symbol history: (currentMid - prevMid) / prevMid
    let priceMomentum = 0;
    const history = this.orderbookHistory.get(symbol);
    if (midPrice > 0 && history && history.length >= 1) {
      const prev = history[history.length - 1];
      const prevBid = parseFloat(prev.bids[0]?.price || '0');
      const prevAsk = parseFloat(prev.asks[0]?.price || '0');
      const prevMid = prevBid > 0 && prevAsk > 0 ? (prevBid + prevAsk) / 2 : 0;
      if (prevMid > 0) {
        priceMomentum = (midPrice - prevMid) / prevMid;
      }
    }

    // Rolling volatility (stddev of mid returns) over last N snapshots
    const volatility = this.computeVolatility(symbol, 20);

    return {
      spread: spreadPct,
      volume,
      priceMomentum,
      orderbookDepth: bidDepth + askDepth,
      // @ts-ignore: extend runtime shape
      volatility,
    };
  }

  private async calculateAccuracyFromResearchAPIs(
    symbol: string,
    uid: string
  ): Promise<number> {
    // Accuracy calculation using only the 5 allowed research APIs
    let accuracy = 0.5; // Base accuracy
    let apiSuccessCount = 0;

    try {
      const integrations = await firestoreAdapter.getEnabledIntegrations(uid);

      // CryptoCompare data (user-provided, required)
      if (integrations.cryptocompare) {
        try {
          const { CryptoCompareAdapter } = await import('./cryptocompareAdapter');
          const adapter = new CryptoCompareAdapter(integrations.cryptocompare.apiKey);
          const marketData = await adapter.getMarketData(symbol);

          // Positive price change boosts accuracy
          if (marketData.priceChangePercent24h && marketData.priceChangePercent24h > 1) {
            accuracy += 0.03;
          }

          // High volume indicates liquidity
          if (marketData.volume24h && marketData.volume24h > 1000000) {
            accuracy += 0.02;
          }

          apiSuccessCount++;
        } catch (err) {
          logger.debug({ err, symbol }, 'CryptoCompare accuracy calculation error (non-critical)');
        }
      }

      // MarketAux news data (user-provided, required)
      if (integrations.marketaux) {
        try {
          const newsData = await fetchMarketAuxData(integrations.marketaux.apiKey, symbol);

          // News sentiment affects accuracy
          if (newsData.overallSentiment && newsData.overallSentiment > 0.5) {
            accuracy += 0.03;
          } else if (newsData.overallSentiment && newsData.overallSentiment < -0.5) {
            accuracy -= 0.02;
          }

          apiSuccessCount++;
        } catch (err) {
          logger.debug({ err, symbol }, 'MarketAux accuracy calculation error (non-critical)');
        }
      }

      // Google Finance data (auto-enabled)
      try {
        const { GoogleFinanceAdapter } = await import('./googleFinanceAdapter');
        const adapter = new GoogleFinanceAdapter();
        const financeData = await adapter.getMarketData(symbol);

        if (financeData.priceChangePercent && financeData.priceChangePercent > 0.5) {
          accuracy += 0.02;
        }

        apiSuccessCount++;
      } catch (err) {
        logger.debug({ err, symbol }, 'Google Finance accuracy calculation error (non-critical)');
      }

      // Binance Public API data (auto-enabled)
      try {
        const { BinanceAdapter } = await import('./binanceAdapter');
        const adapter = new BinanceAdapter();
        const publicData = await adapter.getPublicMarketData(symbol);

        if (publicData.volume24h && publicData.volume24h > 500000) {
          accuracy += 0.02;
        }

        apiSuccessCount++;
      } catch (err) {
        logger.debug({ err, symbol }, 'Binance Public API accuracy calculation error (non-critical)');
      }

      // CoinGecko data (auto-enabled)
      try {
        const { CoinGeckoAdapter } = await import('./coingeckoAdapter');
        const adapter = new CoinGeckoAdapter();
        const geckoData = await adapter.getMarketData(symbol);

        if (geckoData.marketCap && geckoData.marketCap > 1000000000) { // $1B+ market cap
          accuracy += 0.02;
        }

        apiSuccessCount++;
      } catch (err) {
        logger.debug({ err, symbol }, 'CoinGecko accuracy calculation error (non-critical)');
      }

      // Base accuracy boost from API success (each API adds 5%)
      const apiBoost = Math.min(0.25, apiSuccessCount * 0.05); // Max 25% boost
      accuracy = accuracy + apiBoost;

    } catch (err) {
      logger.debug({ err }, 'Error fetching external data sources for accuracy');
    }

    // Cap at 0.95 max (never 100% confidence)
    return Math.min(0.95, Math.max(0.1, accuracy));
  }

  private determineSignalDynamic(
    symbol: string,
    imbalance: number,
    microSignals: ResearchResult['microSignals'],
    accuracy: number
  ): 'BUY' | 'SELL' | 'HOLD' {
    if (accuracy < 0.5) {
      return 'HOLD';
    }

    const dynamic = this.computeDynamicThresholds(symbol);
    const thr = Math.max(0.05, Math.min(0.4, dynamic.imbalanceThreshold));

    if (imbalance > thr) {
      return 'BUY';
    } else if (imbalance < -thr) {
      return 'SELL';
    }

    return 'HOLD';
  }

  private getRecommendedAction(signal: 'BUY' | 'SELL' | 'HOLD', accuracy: number): string {
    if (signal === 'HOLD') {
      return 'Wait for better signal';
    }

    if (accuracy >= 0.85) {
      return `Execute ${signal} trade (high confidence)`;
    } else if (accuracy >= 0.7) {
      return `Consider ${signal} trade (moderate confidence)`;
    } else {
      return `Monitor ${signal} signal (low confidence)`;
    }
  }

  addTrade(symbol: string, trade: Trade): void {
    if (!this.recentTrades.has(symbol)) {
      this.recentTrades.set(symbol, []);
    }
    const trades = this.recentTrades.get(symbol)!;
    trades.push(trade);
    // Keep only last 100 trades
    if (trades.length > 100) {
      trades.shift();
    }
  }

  addOrderbook(symbol: string, orderbook: Orderbook): void {
    if (!this.orderbookHistory.has(symbol)) {
      this.orderbookHistory.set(symbol, []);
    }
    const history = this.orderbookHistory.get(symbol)!;
    history.push(orderbook);
    // Keep only last 50 snapshots
    if (history.length > 50) {
      history.shift();
    }
  }

  private updateSignalHistories(symbol: string, micro: ResearchResult['microSignals'], imbalance: number): void {
    const pushWithCap = (map: Map<string, number[]>, value: number, cap: number = 200) => {
      if (!map.has(symbol)) map.set(symbol, []);
      const arr = map.get(symbol)!;
      arr.push(value);
      if (arr.length > cap) arr.shift();
    };

    pushWithCap(this.spreadHistory, micro.spread);
    pushWithCap(this.volumeHistory, micro.volume);
    pushWithCap(this.depthHistory, micro.orderbookDepth);
    pushWithCap(this.imbalanceHistory, Math.abs(imbalance));
  }

  private computeVolatility(symbol: string, window: number = 20): number {
    const history = this.orderbookHistory.get(symbol);
    if (!history || history.length < 2) return 0;
    const mids: number[] = history.map((ob) => {
      const b = parseFloat(ob.bids[0]?.price || '0');
      const a = parseFloat(ob.asks[0]?.price || '0');
      return b > 0 && a > 0 ? (b + a) / 2 : 0;
    }).filter((m) => m > 0);
    if (mids.length < 2) return 0;
    const rets: number[] = [];
    const start = Math.max(1, mids.length - window);
    for (let i = start; i < mids.length; i++) {
      const r = (mids[i] - mids[i - 1]) / mids[i - 1];
      rets.push(r);
    }
    if (rets.length === 0) return 0;
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + (v - mean) * (v - mean), 0) / rets.length;
    return Math.sqrt(variance);
  }

  private percentile(values: number[], p: number): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
    return sorted[idx];
  }

  private median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private computeDynamicThresholds(symbol: string): {
    spreadP20: number;
    spreadP40: number;
    spreadP60: number;
    volumeMedian: number;
    depthMedian: number;
    imbalanceStd: number;
    imbalanceThreshold: number;
  } {
    const spreads = this.spreadHistory.get(symbol) || [];
    const volumes = this.volumeHistory.get(symbol) || [];
    const depths = this.depthHistory.get(symbol) || [];
    const imbs = this.imbalanceHistory.get(symbol) || [];

    const spreadP20 = this.percentile(spreads, 20);
    const spreadP40 = this.percentile(spreads, 40);
    const spreadP60 = this.percentile(spreads, 60);
    const volumeMedian = this.median(volumes);
    const depthMedian = this.median(depths);

    const imbMean = imbs.length ? imbs.reduce((s, v) => s + v, 0) / imbs.length : 0;
    const imbVar = imbs.length ? imbs.reduce((s, v) => s + (v - imbMean) * (v - imbMean), 0) / imbs.length : 0;
    const imbalanceStd = Math.sqrt(imbVar);

    const imbP70 = this.percentile(imbs, 70);
    const imbalanceThreshold = imbP70 || 0.2;

    return { spreadP20, spreadP40, spreadP60, volumeMedian, depthMedian, imbalanceStd, imbalanceThreshold };
  }

  private shouldBlockForLiquidity(symbol: string, micro: ResearchResult['microSignals']): boolean {
    const dynamic = this.computeDynamicThresholds(symbol);
    const spread80 = this.percentile(this.spreadHistory.get(symbol) || [micro.spread], 80);
    const spreadTooWide = spread80 > 0 ? micro.spread > spread80 : false;
    const depthTooLow = dynamic.depthMedian > 0 ? micro.orderbookDepth < dynamic.depthMedian * 0.5 : false;
    const volumeTooLow = dynamic.volumeMedian > 0 ? micro.volume < dynamic.volumeMedian * 0.5 : false;
    return spreadTooWide || depthTooLow || volumeTooLow;
  }
}

export const researchEngine = new ResearchEngine();


