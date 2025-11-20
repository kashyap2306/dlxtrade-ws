/**
 * Feature Engineering Service
 * Computes technical indicators, orderbook features, and normalized features
 * for ML model training and inference
 */

import { logger } from '../utils/logger';
import type { Orderbook, Trade } from '../types';

export interface TechnicalIndicators {
  rsi5: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  ema12: number;
  ema26: number;
  ema50: number;
  adx: number;
  adxPlus: number;
  adxMinus: number;
}

export interface OrderbookFeatures {
  bidVolumeTop10: number;
  askVolumeTop10: number;
  imbalance: number; // (bidVol - askVol) / (bidVol + askVol)
  spread: number;
  depth: number;
  midPrice: number;
}

export interface TradeFeatures {
  takerBuyVolume: number;
  takerSellVolume: number;
  takerBuySellRatio: number;
  aggressiveBuyRatio: number;
  tradeCount: number;
}

export interface VolumeFeatures {
  volume24h: number;
  volumeSpikePercent: number;
  vwap: number;
  vwapDeviation: number;
}

export interface TimeframeAggregate {
  return: number;
  volatility: number;
  volumeDelta: number;
  momentum: number;
}

export interface DeltaFeatures {
  ema12Minus26: number;
  ema26Minus50: number;
  rsiSpread: number;
  macdSignalGap: number;
  orderbookImbalanceDelta: number;
  takerFlowDelta: number;
}

export interface FeatureVector {
  // Technical indicators
  technical: TechnicalIndicators;
  // Orderbook features
  orderbook: OrderbookFeatures;
  // Trade features
  trades: TradeFeatures;
  // Volume features
  volume: VolumeFeatures;
  // Normalized features (z-scores)
  normalized: Record<string, number>;
  // Percentile features
  percentiles: Record<string, number>;
  // Binary flags
  flags: Record<string, boolean>;
  // Multi-timeframe aggregates
  multiTimeframe: Record<string, TimeframeAggregate>;
  // Delta features
  deltas: DeltaFeatures;
  // Timestamp
  timestamp: number;
}

export interface BatchFeatureInput {
  symbol: string;
  price: number;
  orderbook?: Orderbook | null;
  trades?: Trade[];
  volume24h: number;
  timeframe?: '1m' | '5m' | '15m' | '1h';
}

export class FeatureEngine {
  private priceHistory: Map<string, number[]> = new Map();
  private volumeHistory: Map<string, number[]> = new Map();
  private tradeHistory: Map<string, Trade[]> = new Map();
  private featureStats: Map<string, { count: number; mean: number; m2: number }> = new Map();
  private featureHistory: Map<string, number[]> = new Map();
  private previousVectors: Map<string, FeatureVector> = new Map();
  private readonly maxHistoryLength = 500;
  private timeframeWindows: Record<'1m' | '5m' | '15m' | '1h', number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '1h': 60,
  };

  /**
   * Calculate RSI (Relative Strength Index)
   */
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50; // Neutral if insufficient data

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    if (prices.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Signal line is EMA of MACD (9 period)
    const macdHistory = this.getMACDHistory(prices);
    const signal = macdHistory.length >= 9 ? this.calculateEMA(macdHistory, 9) : macd;
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private getMACDHistory(prices: number[]): number[] {
    const history: number[] = [];
    for (let i = 26; i < prices.length; i++) {
      const slice = prices.slice(0, i + 1);
      const ema12 = this.calculateEMA(slice, 12);
      const ema26 = this.calculateEMA(slice, 26);
      history.push(ema12 - ema26);
    }
    return history;
  }

  /**
   * Calculate ADX (Average Directional Index) - simplified version
   */
  calculateADX(prices: number[]): { adx: number; plusDI: number; minusDI: number } {
    if (prices.length < 14) {
      return { adx: 25, plusDI: 0, minusDI: 0 }; // Neutral ADX
    }

    // Simplified ADX calculation
    const high = prices;
    const low = prices.map(p => p * 0.99); // Approximate low
    const close = prices;

    let plusDM = 0;
    let minusDM = 0;
    let tr = 0;

    for (let i = 1; i < Math.min(14, prices.length); i++) {
      const highDiff = high[i] - high[i - 1];
      const lowDiff = low[i - 1] - low[i];
      const trueRange = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1])
      );

      if (highDiff > lowDiff && highDiff > 0) plusDM += highDiff;
      if (lowDiff > highDiff && lowDiff > 0) minusDM += lowDiff;
      tr += trueRange;
    }

    const atr = tr / 14;
    const plusDI = atr > 0 ? (plusDM / atr) * 100 : 0;
    const minusDI = atr > 0 ? (minusDM / atr) * 100 : 0;
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.0001) * 100;
    const adx = dx; // Simplified - normally smoothed over 14 periods

    return { adx: Math.min(100, Math.max(0, adx)), plusDI, minusDI };
  }

  /**
   * Calculate orderbook features
   */
  calculateOrderbookFeatures(orderbook: Orderbook, topN: number = 10): OrderbookFeatures {
    const bids = orderbook.bids.slice(0, topN);
    const asks = orderbook.asks.slice(0, topN);

    const bidVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.quantity), 0);
    const askVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.quantity), 0);

    const bestBid = parseFloat(bids[0]?.price || '0');
    const bestAsk = parseFloat(asks[0]?.price || '0');
    const spread = bestAsk - bestBid;
    const midPrice = (bestBid + bestAsk) / 2;

    const imbalance = bidVolume + askVolume > 0
      ? (bidVolume - askVolume) / (bidVolume + askVolume)
      : 0;

    const depth = Math.min(bidVolume, askVolume);

    return {
      bidVolumeTop10: bidVolume,
      askVolumeTop10: askVolume,
      imbalance,
      spread,
      depth,
      midPrice,
    };
  }

  /**
   * Calculate trade features
   */
  calculateTradeFeatures(trades: Trade[], lookback: number = 100): TradeFeatures {
    const recentTrades = trades.slice(-lookback);
    
    let takerBuyVolume = 0;
    let takerSellVolume = 0;
    let aggressiveBuyCount = 0;
    let totalTrades = recentTrades.length;

    recentTrades.forEach(trade => {
      const volume = parseFloat(trade.quantity || '0');
      if (trade.isBuyerMaker === false) {
        // Taker buy
        takerBuyVolume += volume;
        aggressiveBuyCount++;
      } else {
        // Taker sell
        takerSellVolume += volume;
      }
    });

    const totalVolume = takerBuyVolume + takerSellVolume;
    const takerBuySellRatio = takerSellVolume > 0 ? takerBuyVolume / takerSellVolume : 1;
    const aggressiveBuyRatio = totalTrades > 0 ? aggressiveBuyCount / totalTrades : 0;

    return {
      takerBuyVolume,
      takerSellVolume,
      takerBuySellRatio,
      aggressiveBuyRatio,
      tradeCount: totalTrades,
    };
  }

  /**
   * Calculate volume features
   */
  calculateVolumeFeatures(
    currentVolume: number,
    volumeHistory: number[],
    currentPrice: number,
    priceHistory: number[]
  ): VolumeFeatures {
    const volume24h = volumeHistory.length > 0
      ? volumeHistory.reduce((a, b) => a + b, 0)
      : currentVolume;

    const avgVolume = volumeHistory.length > 0
      ? volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length
      : currentVolume;

    const volumeSpikePercent = avgVolume > 0
      ? ((currentVolume - avgVolume) / avgVolume) * 100
      : 0;

    // VWAP calculation
    let vwap = 0;
    if (priceHistory.length > 0 && volumeHistory.length > 0) {
      let totalValue = 0;
      let totalVolume = 0;
      const minLength = Math.min(priceHistory.length, volumeHistory.length);
      for (let i = 0; i < minLength; i++) {
        const value = priceHistory[i] * volumeHistory[i];
        totalValue += value;
        totalVolume += volumeHistory[i];
      }
      vwap = totalVolume > 0 ? totalValue / totalVolume : currentPrice;
    } else {
      vwap = currentPrice;
    }

    const vwapDeviation = vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0;

    return {
      volume24h,
      volumeSpikePercent,
      vwap,
      vwapDeviation,
    };
  }

  private calculateStd(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateMomentum(values: number[]): number {
    if (values.length < 2) return 0;
    const first = values[0];
    const last = values[values.length - 1];
    if (first === 0) return 0;
    return (last - first) / first;
  }

  private updateFeatureStats(featureName: string, value: number): { mean: number; std: number } {
    if (!Number.isFinite(value)) {
      value = 0;
    }
    const stats = this.featureStats.get(featureName) || { count: 0, mean: 0, m2: 0 };
    stats.count += 1;
    const delta = value - stats.mean;
    stats.mean += delta / stats.count;
    stats.m2 += delta * (value - stats.mean);
    const variance = stats.count > 1 ? stats.m2 / (stats.count - 1) : 0;
    this.featureStats.set(featureName, stats);
    return { mean: stats.mean, std: Math.sqrt(Math.max(variance, 0)) };
  }

  private recordFeatureHistory(featureName: string, value: number): number[] {
    const history = this.featureHistory.get(featureName) || [];
    history.push(value);
    if (history.length > this.maxHistoryLength) {
      history.shift();
    }
    this.featureHistory.set(featureName, history);
    return history;
  }

  private buildNormalizedFeatures(features: Record<string, number>): {
    normalized: Record<string, number>;
    percentiles: Record<string, number>;
  } {
    const normalized: Record<string, number> = {};
    const percentiles: Record<string, number> = {};
    Object.entries(features).forEach(([name, value]) => {
      const stats = this.updateFeatureStats(name, value);
      const history = this.recordFeatureHistory(name, value);
      normalized[`${name}_z`] = stats.std === 0 ? 0 : (value - stats.mean) / (stats.std || 1);
      percentiles[`${name}_pct`] = this.calculatePercentile(value, history);
    });
    return { normalized, percentiles };
  }

  private calculateTimeframeAggregates(prices: number[], volumes: number[]): Record<string, TimeframeAggregate> {
    const aggregates: Record<string, TimeframeAggregate> = {};
    (Object.keys(this.timeframeWindows) as Array<'1m' | '5m' | '15m' | '1h'>).forEach((tf) => {
      const window = this.timeframeWindows[tf];
      if (prices.length >= window) {
        const priceSlice = prices.slice(-window);
        const volumeSlice = volumes.slice(-window);
        const startPrice = priceSlice[0];
        const endPrice = priceSlice[priceSlice.length - 1];
        const startVolume = volumeSlice[0] || 0;
        const endVolume = volumeSlice[volumeSlice.length - 1] || 0;
        aggregates[tf] = {
          return: startPrice ? (endPrice - startPrice) / startPrice : 0,
          volatility: this.calculateStd(priceSlice),
          volumeDelta: startVolume ? (endVolume - startVolume) / startVolume : 0,
          momentum: this.calculateMomentum(priceSlice),
        };
      }
    });
    return aggregates;
  }

  private calculateDeltas(symbol: string, current: {
    technical: TechnicalIndicators;
    orderbook: OrderbookFeatures;
    trades: TradeFeatures;
  }): DeltaFeatures {
    const previous = this.previousVectors.get(symbol);
    return {
      ema12Minus26: current.technical.ema12 - current.technical.ema26,
      ema26Minus50: current.technical.ema26 - current.technical.ema50,
      rsiSpread: current.technical.rsi5 - current.technical.rsi14,
      macdSignalGap: current.technical.macd - current.technical.macdSignal,
      orderbookImbalanceDelta: previous ? current.orderbook.imbalance - previous.orderbook.imbalance : 0,
      takerFlowDelta: previous
        ? current.trades.takerBuySellRatio - previous.trades.takerBuySellRatio
        : 0,
    };
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(value: number, history: number[]): number {
    if (history.length === 0) return 50;
    const sorted = [...history].sort((a, b) => a - b);
    const index = sorted.findIndex(v => v >= value);
    return index >= 0 ? (index / sorted.length) * 100 : 100;
  }

  /**
   * Compute complete feature vector
   */
  computeFeatureVector(
    symbol: string,
    currentPrice: number,
    orderbook: Orderbook | null,
    trades: Trade[],
    volume24h: number,
    timeframe: '1m' | '5m' | '15m' | '1h' = '5m'
  ): FeatureVector {
    // Update history
    this.updateHistory(symbol, currentPrice, volume24h, trades);

    const prices = this.priceHistory.get(symbol) || [currentPrice];
    const volumes = this.volumeHistory.get(symbol) || [volume24h];

    // Technical indicators
    const rsi5 = this.calculateRSI(prices, 5);
    const rsi14 = this.calculateRSI(prices, 14);
    const macd = this.calculateMACD(prices);
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const ema50 = this.calculateEMA(prices, 50);
    const adx = this.calculateADX(prices);

    // Orderbook features
    const orderbookFeatures = orderbook
      ? this.calculateOrderbookFeatures(orderbook, 10)
      : {
          bidVolumeTop10: 0,
          askVolumeTop10: 0,
          imbalance: 0,
          spread: 0,
          depth: 0,
          midPrice: currentPrice,
        };

    // Trade features
    const tradeFeatures = this.calculateTradeFeatures(trades, 100);

    // Volume features
    const volumeFeatures = this.calculateVolumeFeatures(
      volume24h,
      volumes,
      currentPrice,
      prices
    );

    const multiTimeframe = this.calculateTimeframeAggregates(prices, volumes);
    const { normalized, percentiles } = this.buildNormalizedFeatures({
      rsi5,
      rsi14,
      macdHistogram: macd.histogram,
      orderbookImbalance: orderbookFeatures.imbalance,
      volumeSpikePercent: volumeFeatures.volumeSpikePercent,
      takerBuySellRatio: tradeFeatures.takerBuySellRatio,
      vwapDeviation: volumeFeatures.vwapDeviation,
    });

    // Binary flags
    const flags: Record<string, boolean> = {
      rsi5_oversold: rsi5 < 30,
      rsi5_overbought: rsi5 > 70,
      rsi14_oversold: rsi14 < 30,
      rsi14_overbought: rsi14 > 70,
      macd_bullish: macd.macd > macd.signal,
      macd_bearish: macd.macd < macd.signal,
      buy_imbalance: orderbookFeatures.imbalance > 0.1,
      sell_imbalance: orderbookFeatures.imbalance < -0.1,
      volume_spike: volumeFeatures.volumeSpikePercent > 20,
      price_above_vwap: volumeFeatures.vwapDeviation > 0,
      volatility_breakout: (multiTimeframe['5m']?.volatility || 0) > 0.5,
    };

    const deltas = this.calculateDeltas(symbol, {
      technical: {
        rsi5,
        rsi14,
        macd: macd.macd,
        macdSignal: macd.signal,
        macdHistogram: macd.histogram,
        ema12,
        ema26,
        ema50,
        adx: adx.adx,
        adxPlus: adx.plusDI,
        adxMinus: adx.minusDI,
      },
      orderbook: orderbookFeatures,
      trades: tradeFeatures,
    });

    const featureVector: FeatureVector = {
      technical: {
        rsi5,
        rsi14,
        macd: macd.macd,
        macdSignal: macd.signal,
        macdHistogram: macd.histogram,
        ema12,
        ema26,
        ema50,
        adx: adx.adx,
        adxPlus: adx.plusDI,
        adxMinus: adx.minusDI,
      },
      orderbook: orderbookFeatures,
      trades: tradeFeatures,
      volume: volumeFeatures,
      normalized,
      percentiles,
      flags,
      multiTimeframe,
      deltas,
      timestamp: Date.now(),
    };

    this.previousVectors.set(symbol, featureVector);

    return featureVector;
  }

  computeBatchFeatureVectors(samples: BatchFeatureInput[]): FeatureVector[] {
    return samples.map((sample) =>
      this.computeFeatureVector(
        sample.symbol,
        sample.price,
        sample.orderbook ?? null,
        sample.trades ?? [],
        sample.volume24h,
        sample.timeframe || '5m'
      )
    );
  }

  private updateHistory(symbol: string, price: number, volume: number, trades: Trade[]): void {
    // Update price history
    const prices = this.priceHistory.get(symbol) || [];
    prices.push(price);
    if (prices.length > this.maxHistoryLength) {
      prices.shift();
    }
    this.priceHistory.set(symbol, prices);

    // Update volume history
    const volumes = this.volumeHistory.get(symbol) || [];
    volumes.push(volume);
    if (volumes.length > this.maxHistoryLength) {
      volumes.shift();
    }
    this.volumeHistory.set(symbol, volumes);

    // Update trade history
    const existingTrades = this.tradeHistory.get(symbol) || [];
    const updatedTrades = [...existingTrades, ...trades].slice(-this.maxHistoryLength);
    this.tradeHistory.set(symbol, updatedTrades);
  }

  /**
   * Clear history for a symbol
   */
  clearHistory(symbol: string): void {
    this.priceHistory.delete(symbol);
    this.volumeHistory.delete(symbol);
    this.tradeHistory.delete(symbol);
  }
}

export const featureEngine = new FeatureEngine();

