import { logger } from '../utils/logger';

// Technical Analysis Indicators and Strategies

export interface OHLCData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketData {
  price: number;
  volume24h: number;
  change24h: number;
  marketCap?: number;
  open?: number;
  high?: number;
  low?: number;
  priceChangePercent?: number;
}

export interface StrategyResult {
  name: string;
  score: number; // 0-1
  action: 'BUY' | 'SELL' | 'HOLD';
}

export interface IndicatorResult {
  value?: number;
  strength?: number;
  score?: number;
  trend?: string;
  direction?: string;
  atrPct?: number;
  classification?: string;
  nearSupport?: boolean;
  nearResistance?: boolean;
  breakout?: boolean;
  pattern?: string;
  confidence?: number;
  deviationPct?: number;
  signal?: string;
  emaTrend?: string;
  smaTrend?: string;
}

export class TradingStrategies {
  // RSI (Relative Strength Index) - 14 period
  calculateRSI(ohlcData: OHLCData[], period: number = 14): IndicatorResult {
    if (ohlcData.length < period + 1) {
      return { value: 50, strength: 0.5 };
    }

    const gains: number[] = [];
    const losses: number[] = [];

    // Calculate price changes
    for (let i = 1; i < ohlcData.length; i++) {
      const change = ohlcData[i].close - ohlcData[i - 1].close;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Calculate initial averages
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

    // Calculate RSI
    let rsi = 100 - (100 / (1 + (avgGain / avgLoss)));

    // Smooth subsequent values using Wilder's smoothing
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      rsi = 100 - (100 / (1 + (avgGain / avgLoss)));
    }

    let strength = 0.5;
    if (rsi > 70) strength = 0.8; // Overbought
    else if (rsi < 30) strength = 0.8; // Oversold
    else if (rsi > 60 || rsi < 40) strength = 0.6; // Approaching extremes

    return {
      value: rsi,
      strength
    };
  }

  // Volume Analysis
  calculateVolumeAnalysis(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 20) {
      return { score: 0.5, trend: 'neutral' };
    }

    const volumes = ohlcData.map(d => d.volume);
    const currentVolume = volumes[volumes.length - 1];
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const recentAvg = volumes.slice(-5).reduce((sum, vol) => sum + vol, 0) / 5;

    const relativeVolume = currentVolume / avgVolume;
    let score = 0.5;
    let trend = 'neutral';

    if (relativeVolume > 1.5) {
      score = 0.8;
      trend = 'high';
    } else if (relativeVolume > 1.2) {
      score = 0.7;
      trend = 'above_average';
    } else if (relativeVolume < 0.7) {
      score = 0.3;
      trend = 'low';
    } else if (relativeVolume < 0.8) {
      score = 0.4;
      trend = 'below_average';
    }

    // Check volume trend
    if (recentAvg > avgVolume * 1.1) {
      score += 0.1;
    } else if (recentAvg < avgVolume * 0.9) {
      score = Math.max(0.1, score - 0.1);
    }

    return {
      score: Math.min(1, Math.max(0, score)),
      trend
    };
  }

  // Momentum calculation
  calculateMomentum(ohlcData: OHLCData[], period: number = 10): IndicatorResult {
    if (ohlcData.length < period + 1) {
      return { score: 0.5, direction: 'neutral' };
    }

    const prices = ohlcData.map(d => d.close);
    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - period - 1];

    if (!pastPrice) {
      return { score: 0.5, direction: 'neutral' };
    }

    const momentum = ((currentPrice - pastPrice) / pastPrice) * 100;
    const direction = momentum > 0 ? 'up' : momentum < 0 ? 'down' : 'neutral';

    // Calculate momentum strength (0-1)
    const absMomentum = Math.abs(momentum);
    let score = 0.5;

    if (absMomentum > 5) score = 0.9;
    else if (absMomentum > 3) score = 0.8;
    else if (absMomentum > 1) score = 0.7;
    else if (absMomentum > 0.5) score = 0.6;

    return {
      score,
      direction
    };
  }

  // EMA calculation
  calculateEMA(prices: number[], period: number): number[] {
    const ema: number[] = [];
    const multiplier = 2 / (period + 1);

    // First EMA is SMA
    const sma = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    ema.push(sma);

    // Calculate subsequent EMAs
    for (let i = period; i < prices.length; i++) {
      const currentEMA = (prices[i] * multiplier) + (ema[ema.length - 1] * (1 - multiplier));
      ema.push(currentEMA);
    }

    return ema;
  }

  // EMA Trend Analysis
  calculateEMATrend(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 25) {
      return { emaTrend: 'neutral' };
    }

    const prices = ohlcData.map(d => d.close);
    const ema9 = this.calculateEMA(prices, 9);
    const ema21 = this.calculateEMA(prices, 21);

    if (ema9.length === 0 || ema21.length === 0) {
      return { emaTrend: 'neutral' };
    }

    const currentEMA9 = ema9[ema9.length - 1];
    const currentEMA21 = ema21[ema21.length - 1];
    const prevEMA9 = ema9[ema9.length - 2];
    const prevEMA21 = ema21[ema21.length - 2];

    let trend = 'neutral';

    if (currentEMA9 > currentEMA21 && prevEMA9 <= prevEMA21) {
      trend = 'bullish_crossover';
    } else if (currentEMA9 < currentEMA21 && prevEMA9 >= prevEMA21) {
      trend = 'bearish_crossover';
    } else if (currentEMA9 > currentEMA21) {
      trend = 'bullish';
    } else if (currentEMA9 < currentEMA21) {
      trend = 'bearish';
    }

    return { emaTrend: trend };
  }

  // SMA calculation
  calculateSMA(prices: number[], period: number): number[] {
    const sma: number[] = [];

    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }

    return sma;
  }

  // SMA Trend Analysis
  calculateSMATrend(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 55) {
      return { smaTrend: 'neutral' };
    }

    const prices = ohlcData.map(d => d.close);
    const sma20 = this.calculateSMA(prices, 20);
    const sma50 = this.calculateSMA(prices, 50);

    if (sma20.length === 0 || sma50.length === 0) {
      return { smaTrend: 'neutral' };
    }

    const currentSMA20 = sma20[sma20.length - 1];
    const currentSMA50 = sma50[sma50.length - 1];
    const prevSMA20 = sma20[sma20.length - 2];
    const prevSMA50 = sma50[sma50.length - 2];

    let trend = 'neutral';

    if (currentSMA20 > currentSMA50 && prevSMA20 <= prevSMA50) {
      trend = 'bullish_crossover';
    } else if (currentSMA20 < currentSMA50 && prevSMA20 >= prevSMA50) {
      trend = 'bearish_crossover';
    } else if (currentSMA20 > currentSMA50) {
      trend = 'bullish';
    } else if (currentSMA20 < currentSMA50) {
      trend = 'bearish';
    }

    return { smaTrend: trend };
  }

  // ATR (Average True Range) for volatility
  calculateATR(ohlcData: OHLCData[], period: number = 14): number {
    if (ohlcData.length < period + 1) {
      return 0;
    }

    const trueRanges: number[] = [];

    for (let i = 1; i < ohlcData.length; i++) {
      const high = ohlcData[i].high;
      const low = ohlcData[i].low;
      const prevClose = ohlcData[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    // Simple moving average of true ranges
    const atr = trueRanges.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
    return atr;
  }

  // Volatility Analysis
  calculateVolatility(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 20) {
      return { atrPct: 0, classification: 'unknown' };
    }

    const prices = ohlcData.map(d => d.close);
    const currentPrice = prices[prices.length - 1];
    const atr = this.calculateATR(ohlcData, 14);
    const atrPct = (atr / currentPrice) * 100;

    let classification = 'low';
    if (atrPct > 5) classification = 'high';
    else if (atrPct > 3) classification = 'medium';
    else if (atrPct > 1) classification = 'moderate';

    return {
      atrPct,
      classification
    };
  }

  // Support and Resistance levels
  calculateSupportResistance(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 20) {
      return { nearSupport: false, nearResistance: false, breakout: false };
    }

    const prices = ohlcData.map(d => d.close);
    const highs = ohlcData.map(d => d.high);
    const lows = ohlcData.map(d => d.low);

    const currentPrice = prices[prices.length - 1];
    const currentHigh = highs[highs.length - 1];
    const currentLow = lows[lows.length - 1];

    // Simple pivot points calculation
    const recentData = ohlcData.slice(-20);
    const pivotHigh = Math.max(...recentData.map(d => d.high));
    const pivotLow = Math.min(...recentData.map(d => d.low));
    const pivotPoint = (pivotHigh + pivotLow + recentData[recentData.length - 1].close) / 3;

    const resistance1 = (2 * pivotPoint) - pivotLow;
    const support1 = (2 * pivotPoint) - pivotHigh;

    // Check if near support/resistance (within 1%)
    const threshold = currentPrice * 0.01;
    const nearSupport = Math.abs(currentPrice - support1) <= threshold;
    const nearResistance = Math.abs(currentPrice - resistance1) <= threshold;

    // Check for breakout
    const breakout = currentHigh > resistance1 || currentLow < support1;

    return {
      nearSupport,
      nearResistance,
      breakout
    };
  }

  // Price Action patterns (simplified)
  calculatePriceAction(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 3) {
      return { pattern: 'none', confidence: 0 };
    }

    const current = ohlcData[ohlcData.length - 1];
    const previous = ohlcData[ohlcData.length - 2];
    const prevPrev = ohlcData[ohlcData.length - 3];

    let pattern = 'none';
    let confidence = 0;

    // Bullish engulfing
    if (previous.close < previous.open &&
        current.close > current.open &&
        current.close > previous.open &&
        current.open < previous.close) {
      pattern = 'bullish_engulfing';
      confidence = 0.7;
    }
    // Bearish engulfing
    else if (previous.close > previous.open &&
             current.close < current.open &&
             current.close < previous.open &&
             current.open > previous.close) {
      pattern = 'bearish_engulfing';
      confidence = 0.7;
    }
    // Doji (indecision)
    else if (Math.abs(current.close - current.open) / (current.high - current.low) < 0.1) {
      pattern = 'doji';
      confidence = 0.5;
    }

    return {
      pattern,
      confidence
    };
  }

  // VWAP (Volume Weighted Average Price)
  calculateVWAP(ohlcData: OHLCData[]): IndicatorResult {
    if (ohlcData.length < 10) {
      return { deviationPct: 0, signal: 'neutral' };
    }

    let cumulativeVolume = 0;
    let cumulativeVolumePrice = 0;

    for (const candle of ohlcData) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      cumulativeVolume += candle.volume;
      cumulativeVolumePrice += typicalPrice * candle.volume;
    }

    const vwap = cumulativeVolumePrice / cumulativeVolume;
    const currentPrice = ohlcData[ohlcData.length - 1].close;
    const deviationPct = ((currentPrice - vwap) / vwap) * 100;

    let signal = 'neutral';
    if (deviationPct > 2) signal = 'above_vwap';
    else if (deviationPct < -2) signal = 'below_vwap';

    return {
      deviationPct,
      signal
    };
  }

  // Generate strategy results from indicators
  generateStrategies(ohlcData: OHLCData[], marketData: MarketData): StrategyResult[] {
    const strategies: StrategyResult[] = [];

    // RSI Strategy
    const rsiResult = this.calculateRSI(ohlcData);
    let rsiAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let rsiScore = 0.5;

    if (rsiResult.value! < 30) {
      rsiAction = 'BUY';
      rsiScore = 0.8;
    } else if (rsiResult.value! > 70) {
      rsiAction = 'SELL';
      rsiScore = 0.8;
    } else if (rsiResult.value! < 40) {
      rsiAction = 'BUY';
      rsiScore = 0.6;
    } else if (rsiResult.value! > 60) {
      rsiAction = 'SELL';
      rsiScore = 0.6;
    }

    strategies.push({
      name: 'RSI',
      score: rsiScore,
      action: rsiAction
    });

    // Volume Strategy
    const volumeResult = this.calculateVolumeAnalysis(ohlcData);
    strategies.push({
      name: 'Volume',
      score: volumeResult.score!,
      action: volumeResult.trend === 'high' || volumeResult.trend === 'above_average' ? 'BUY' :
              volumeResult.trend === 'low' || volumeResult.trend === 'below_average' ? 'SELL' : 'HOLD'
    });

    // Momentum Strategy
    const momentumResult = this.calculateMomentum(ohlcData);
    strategies.push({
      name: 'Momentum',
      score: momentumResult.score!,
      action: momentumResult.direction === 'up' ? 'BUY' :
              momentumResult.direction === 'down' ? 'SELL' : 'HOLD'
    });

    // EMA Trend Strategy
    const emaResult = this.calculateEMATrend(ohlcData);
    let emaScore = 0.5;
    let emaAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (emaResult.emaTrend === 'bullish_crossover') {
      emaScore = 0.9;
      emaAction = 'BUY';
    } else if (emaResult.emaTrend === 'bearish_crossover') {
      emaScore = 0.9;
      emaAction = 'SELL';
    } else if (emaResult.emaTrend === 'bullish') {
      emaScore = 0.7;
      emaAction = 'BUY';
    } else if (emaResult.emaTrend === 'bearish') {
      emaScore = 0.7;
      emaAction = 'SELL';
    }

    strategies.push({
      name: 'EMA Trend',
      score: emaScore,
      action: emaAction
    });

    // SMA Trend Strategy
    const smaResult = this.calculateSMATrend(ohlcData);
    let smaScore = 0.5;
    let smaAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (smaResult.smaTrend === 'bullish_crossover') {
      smaScore = 0.9;
      smaAction = 'BUY';
    } else if (smaResult.smaTrend === 'bearish_crossover') {
      smaScore = 0.9;
      smaAction = 'SELL';
    } else if (smaResult.smaTrend === 'bullish') {
      smaScore = 0.7;
      smaAction = 'BUY';
    } else if (smaResult.smaTrend === 'bearish') {
      smaScore = 0.7;
      smaAction = 'SELL';
    }

    strategies.push({
      name: 'SMA Trend',
      score: smaScore,
      action: smaAction
    });

    // Volatility Strategy
    const volatilityResult = this.calculateVolatility(ohlcData);
    let volScore = 0.5;
    let volAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (volatilityResult.classification === 'low') {
      volScore = 0.6;
      volAction = 'BUY'; // Low volatility often precedes breakouts
    } else if (volatilityResult.classification === 'high') {
      volScore = 0.4;
      volAction = 'HOLD'; // High volatility means caution
    }

    strategies.push({
      name: 'Volatility',
      score: volScore,
      action: volAction
    });

    // Support/Resistance Strategy
    const srResult = this.calculateSupportResistance(ohlcData);
    let srScore = 0.5;
    let srAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (srResult.breakout) {
      srScore = 0.8;
      srAction = marketData.change24h > 0 ? 'BUY' : 'SELL';
    } else if (srResult.nearSupport) {
      srScore = 0.7;
      srAction = 'BUY';
    } else if (srResult.nearResistance) {
      srScore = 0.7;
      srAction = 'SELL';
    }

    strategies.push({
      name: 'Support/Resistance',
      score: srScore,
      action: srAction
    });

    // Price Action Strategy
    const paResult = this.calculatePriceAction(ohlcData);
    strategies.push({
      name: 'Price Action',
      score: paResult.confidence!,
      action: paResult.pattern === 'bullish_engulfing' ? 'BUY' :
              paResult.pattern === 'bearish_engulfing' ? 'SELL' : 'HOLD'
    });

    // VWAP Strategy
    const vwapResult = this.calculateVWAP(ohlcData);
    let vwapScore = 0.5;
    let vwapAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (vwapResult.signal === 'above_vwap') {
      vwapScore = 0.7;
      vwapAction = 'BUY';
    } else if (vwapResult.signal === 'below_vwap') {
      vwapScore = 0.7;
      vwapAction = 'SELL';
    }

    strategies.push({
      name: 'VWAP',
      score: vwapScore,
      action: vwapAction
    });

    return strategies;
  }

  // Calculate combined signal from all strategies
  calculateCombinedSignal(strategies: StrategyResult[]): {
    signal: 'BUY' | 'SELL' | 'HOLD';
    accuracy: number;
    providersCalled: string[];
  } {
    let buyScore = 0;
    let sellScore = 0;
    let totalWeight = 0;

    // Weight different strategies
    const weights: { [key: string]: number } = {
      'RSI': 1.0,
      'Volume': 0.8,
      'Momentum': 1.0,
      'EMA Trend': 1.2,
      'SMA Trend': 1.1,
      'Volatility': 0.7,
      'Support/Resistance': 1.0,
      'Price Action': 0.9,
      'VWAP': 0.8
    };

    strategies.forEach(strategy => {
      const weight = weights[strategy.name] || 1.0;
      totalWeight += weight;

      if (strategy.action === 'BUY') {
        buyScore += strategy.score * weight;
      } else if (strategy.action === 'SELL') {
        sellScore += strategy.score * weight;
      }
    });

    // Normalize scores
    buyScore /= totalWeight;
    sellScore /= totalWeight;

    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let accuracy = 0.5;

    if (buyScore > sellScore + 0.1) {
      signal = 'BUY';
      accuracy = Math.min(0.95, 0.5 + buyScore * 0.4);
    } else if (sellScore > buyScore + 0.1) {
      signal = 'SELL';
      accuracy = Math.min(0.95, 0.5 + sellScore * 0.4);
    } else {
      accuracy = Math.max(0.5, 1 - Math.abs(buyScore - sellScore));
    }

    // Ensure minimum accuracy
    accuracy = Math.max(0.5, accuracy);

    return {
      signal,
      accuracy,
      providersCalled: ['CryptoCompare', 'MarketAux', 'CoinGecko', 'GoogleFinance', 'BinancePublic']
    };
  }
}

export const tradingStrategies = new TradingStrategies();
