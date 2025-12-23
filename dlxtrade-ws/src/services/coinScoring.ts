/**
 * Calculate indicators from OHLC data
 */
export function calculateIndicatorsFromOHLC(ohlc: any[]): any {
  console.log("OHLC length:", ohlc?.length, "Sample OHLC:", ohlc?.[0]);
  if (!ohlc || ohlc.length < 10) {
    console.log("Insufficient OHLC data (less than 10 candles), using defaults");
    return createDefaultIndicators();
  }

  try {
    // Handle different OHLC formats: normalize to {open, high, low, close, volume}
    const normalizedOHLC = ohlc.map(d => ({
      open: d.open || d.o || 0,
      high: d.high || d.h || 0,
      low: d.low || d.l || 0,
      close: d.close || d.c || 0,
      volume: d.volume || d.v || d.volumefrom || 0
    }));

    const closes = normalizedOHLC.map(d => d.close);
    const highs = normalizedOHLC.map(d => d.high);
    const lows = normalizedOHLC.map(d => d.low);
    const volumes = normalizedOHLC.map(d => d.volume);
    const currentPrice = closes[closes.length - 1];

    // INTRADAY TRADING: Meme/low-liquidity coin detection
    const atrRaw = calculateATR(normalizedOHLC);
    const isFlatMarket = normalizedOHLC.every(c => Math.abs(c.high - c.low) < currentPrice * 0.0001);
    const atr = isFlatMarket ? 0 : Math.max(atrRaw, currentPrice * 0.001);
    const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
    const clampedAtrPercent = Math.max(0, Math.min(50, atrPercent));

    // Check for sparse volume (average volume < 10% of max volume in last 20 candles)
    const recentVolumes = volumes.slice(-20);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const maxVolume = Math.max(...recentVolumes);
    const isSparseVolume = maxVolume > 0 && avgVolume < maxVolume * 0.1;

    // Meme/low-liquidity guard: Very low volatility OR sparse volume
    // Redefined to be less aggressive. Low ATR often means a stablecoin, not necessarily a meme.
    const isMemeCoin = isSparseVolume;

    if (isMemeCoin) {
      console.log(`[LOW_LIQUIDITY_GUARD] Detected low-liquidity coin: ATR=${clampedAtrPercent.toFixed(2)}%, sparseVolume=${isSparseVolume}`);
    }

    // RSI calculation (14-period)
    const rsi = calculateRSI(closes);

    // Moving averages
    const ma50 = calculateSMA(closes, 50);
    const ma200 = calculateSMA(closes, 200);
    const ema20 = calculateEMA(closes, 20);
    // INTRADAY TRADING: EMA50 - Use fallback if unavailable
    const ema50 = (normalizedOHLC.length >= 50) ? calculateEMA(closes, 50) : null;

    // MACD calculation
    const macd = calculateMACD(closes);

    // Volume analysis
    const volumeAnalysis = calculateVolumeAnalysis(normalizedOHLC);

    // INTRADAY TRADING: VWAP 
    let vwap: any = null;
    if (true) { // Always attempt VWAP now
      const vwapRaw = calculateVWAP(normalizedOHLC);
      vwap = vwapRaw && typeof vwapRaw.signal !== 'undefined' ? vwapRaw : {
        signal: 'neutral',
        deviation: 0,
        value: currentPrice
      };
    }

    // Momentum
    const momentum = calculateMomentum(closes);

    // Pattern recognition (simplified)
    const pattern = calculatePatternRecognition(normalizedOHLC);

    // INTRADAY TRADING: Support/Resistance from same timeframe OHLC
    // For intraday: Support = lowest low, Resistance = highest high (last N candles)
    let supportResistance: any = null;
    if (normalizedOHLC.length >= 20) {
      // Use last 50 candles for intraday (1h timeframe = ~2 days of data)
      const recent50 = normalizedOHLC.slice(-50);
      const recent100 = normalizedOHLC.length >= 100 ? normalizedOHLC.slice(-100) : recent50;

      // INTRADAY: Support = lowest low (not close) in last N candles
      const minorSupport = recent50.length > 0 ? Math.min(...recent50.map(c => c.low)) : null;
      const majorSupport = recent100.length > 0 ? Math.min(...recent100.map(c => c.low)) : minorSupport;

      // INTRADAY: Resistance = highest high (not close) in last N candles
      // Only disable resistance detection for meme coins (low liquidity/sparse volume)
      // Always calculate resistance if OHLC data exists and coin is not a meme coin
      let minorResistance: number | null = null;
      let majorResistance: number | null = null;

      if (!isMemeCoin) {
        // Calculate resistance from actual price history
        if (recent50.length > 0) {
          minorResistance = Math.max(...recent50.map(c => c.high));
        }
        if (recent100.length > 0) {
          majorResistance = Math.max(...recent100.map(c => c.high));
        } else if (recent50.length > 0) {
          // Fallback to recent50 if recent100 not available
          majorResistance = minorResistance;
        }
      }

      supportResistance = {
        minorSupport,
        majorSupport,
        minorResistance,
        majorResistance
      };
    }

    console.log("Calculated indicators - RSI:", rsi?.value, "MA50:", ma50?.value, "EMA20:", ema20?.value, "EMA50:", ema50?.value, "MACD:", macd?.value, "ATR:", atr, "VWAP:", vwap?.value);

    return {
      rsi,
      ma50: { value: ma50.value, smaTrend: ma50.value > currentPrice ? 'bearish' : 'bullish' },
      ma200: { value: ma200.value, smaTrend: ma200.value > currentPrice ? 'bearish' : 'bullish' },
      ema20: { value: ema20.value, emaTrend: ema20.value > currentPrice ? 'bearish' : 'bullish' },
      ema50: ema50 ? { value: ema50.value, emaTrend: ema50.value > currentPrice ? 'bearish' : 'bullish' } : null,
      macd,
      volume: volumeAnalysis,
      vwap: vwap.value ? { ...vwap, value: vwap.value } : vwap,
      atr: {
        value: atr,
        atrPercent: clampedAtrPercent,
        classification: clampedAtrPercent < 1 ? 'low' : clampedAtrPercent < 3 ? 'moderate' : clampedAtrPercent < 5 ? 'medium' : 'high'
      },
      pattern,
      momentum,
      price: currentPrice,
      supportResistance,
      isMemeCoin // Flag for meme coin detection
    };
  } catch (error) {
    console.error("Error calculating indicators from OHLC:", error);
    return createDefaultIndicators();
  }
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(closes: number[], period: number = 14): any {
  if (closes.length < period + 1) {
    return { value: 50, strength: 0.5 };
  }

  const gains = [];
  const losses = [];

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  let avgGain = gains.reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

  // Use Wilder's smoothing for subsequent values
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return { value: rsi, strength: Math.abs(50 - rsi) / 50 };
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(closes: number[], period: number): any {
  if (closes.length < period) {
    return { value: closes[closes.length - 1] || 0 };
  }

  const sum = closes.slice(-period).reduce((a, b) => a + b, 0);
  return { value: sum / period };
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(closes: number[], period: number): any {
  if (closes.length < period) {
    return { value: closes[closes.length - 1] || 0 };
  }

  const multiplier = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }

  return { value: ema };
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(closes: number[]): any {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  if (!ema12.value || !ema26.value) {
    return { value: 0, signal: 'neutral' };
  }

  const macdValue = ema12.value - ema26.value;
  const signal = macdValue > 0 ? 'bullish' : macdValue < 0 ? 'bearish' : 'neutral';

  return { value: macdValue, signal };
}

/**
 * Calculate ATR (Average True Range)
 * AUTO-TRADE SAFETY: Never returns 0 unless market is truly flat
 */
export function calculateATR(ohlc: any[], period: number = 14): number {
  if (ohlc.length < period + 1) {
    // AUTO-TRADE SAFETY: Return minimum ATR based on price if insufficient data
    const currentPrice = ohlc.length > 0 ? ohlc[ohlc.length - 1].close : 0;
    return currentPrice > 0 ? currentPrice * 0.001 : 0.01; // 0.1% of price as minimum
  }

  const trs = [];
  for (let i = 1; i < ohlc.length; i++) {
    const tr = Math.max(
      ohlc[i].high - ohlc[i].low,
      Math.abs(ohlc[i].high - ohlc[i - 1].close),
      Math.abs(ohlc[i].low - ohlc[i - 1].close)
    );
    trs.push(tr);
  }

  const atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;

  // AUTO-TRADE SAFETY: Ensure ATR is never 0 unless market is truly flat
  const currentPrice = ohlc[ohlc.length - 1].close;
  if (currentPrice > 0 && atr === 0) {
    // Check if market is flat (all candles have same high/low within 0.01% tolerance)
    const isFlat = ohlc.slice(-period).every(c => Math.abs(c.high - c.low) < currentPrice * 0.0001);
    return isFlat ? 0 : currentPrice * 0.001; // Return 0 only if truly flat, else minimum 0.1%
  }

  return atr;
}

/**
 * Calculate Volume Analysis
 */
export function calculateVolumeAnalysis(ohlc: any[]): any {
  if (ohlc.length < 10) {
    return { score: 0.5, trend: 'neutral' };
  }

  const volumes = ohlc.map(d => d.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;

  const trend = recentVolume > avgVolume * 1.2 ? 'increasing' :
    recentVolume < avgVolume * 0.8 ? 'decreasing' : 'neutral';
  const score = Math.min(1, recentVolume / avgVolume);

  return { score, trend };
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 */
export function calculateVWAP(ohlc: any[]): any {
  const currentPrice = ohlc.length > 0 ? ohlc[ohlc.length - 1].close : 0;

  if (ohlc.length < 10) {
    // AUTO-TRADE SAFETY: Return VWAP based on available data, not null
    return { signal: 'neutral', deviation: 0, value: currentPrice };
  }

  let priceVolumeSum = 0;
  let volumeSum = 0;

  for (const candle of ohlc) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    priceVolumeSum += typicalPrice * candle.volume;
    volumeSum += candle.volume;
  }

  // AUTO-TRADE SAFETY: If volume is 0, use current price as VWAP fallback
  const vwap = volumeSum > 0 ? priceVolumeSum / volumeSum : currentPrice;
  // AUTO-TRADE SAFETY: Clamp deviation to safe bounds (-100% to +1000%)
  const deviation = vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0;
  const clampedDeviation = Math.max(-100, Math.min(1000, deviation));

  const signal = clampedDeviation > 2 ? 'bullish' : clampedDeviation < -2 ? 'bearish' : 'neutral';

  return { signal, deviation: clampedDeviation, value: vwap };
}

/**
 * Calculate Momentum
 */
export function calculateMomentum(closes: number[], period: number = 10): any {
  if (closes.length < period + 1) {
    return { score: 0.5, direction: 'neutral' };
  }

  const current = closes[closes.length - 1];
  const past = closes[closes.length - period - 1];

  if (past === 0) {
    return { score: 0.5, direction: 'neutral' };
  }

  const momentum = ((current - past) / past) * 100;
  const direction = momentum > 1 ? 'bullish' : momentum < -1 ? 'bearish' : 'neutral';
  const score = Math.min(1, Math.max(0, 0.5 + momentum / 10));

  return { score, direction };
}

/**
 * Calculate Pattern Recognition (Improved)
 */
export function calculatePatternRecognition(ohlc: any[]): any {
  if (ohlc.length < 5) {
    return { confidence: 0, pattern: 'neutral' };
  }

  const lastCandle = ohlc[ohlc.length - 1];
  const prevCandle = ohlc[ohlc.length - 2];

  const isLastBullish = lastCandle.close > lastCandle.open;
  const isLastBearish = lastCandle.close < lastCandle.open;
  const isPrevBullish = prevCandle.close > prevCandle.open;
  const isPrevBearish = prevCandle.close < prevCandle.open;

  const lastBody = Math.abs(lastCandle.close - lastCandle.open);
  const prevBody = Math.abs(prevCandle.close - prevCandle.open);

  const lastRange = lastCandle.high - lastCandle.low;
  const prevRange = prevCandle.high - prevCandle.low;

  // 1. Bullish Engulfing
  if (isPrevBearish && isLastBullish && lastCandle.close > prevCandle.open && lastCandle.open < prevCandle.close) {
    return { confidence: 0.85, pattern: 'Bullish Engulfing' };
  }

  // 2. Bearish Engulfing
  if (isPrevBullish && isLastBearish && lastCandle.close < prevCandle.open && lastCandle.open > prevCandle.close) {
    return { confidence: 0.85, pattern: 'Bearish Engulfing' };
  }

  // 3. Doji (Indecision)
  if (lastRange > 0 && lastBody / lastRange < 0.1) {
    return { confidence: 0.6, pattern: 'Doji' };
  }

  // 4. Hammer (Bullish Reversal)
  const lowerWick = isLastBullish ? lastCandle.open - lastCandle.low : lastCandle.close - lastCandle.low;
  const upperWick = isLastBullish ? lastCandle.high - lastCandle.close : lastCandle.high - lastCandle.open;
  if (lastRange > 0 && lowerWick / lastRange > 0.6 && upperWick / lastRange < 0.1) {
    return { confidence: 0.8, pattern: 'Hammer' };
  }

  // 5. Shooting Star (Bearish Reversal)
  if (lastRange > 0 && upperWick / lastRange > 0.6 && lowerWick / lastRange < 0.1) {
    return { confidence: 0.8, pattern: 'Shooting Star' };
  }

  // Simple trend pattern detection (Fallback)
  const closes = ohlc.map(d => d.close);
  const recent = closes.slice(-5);
  const increasing = recent.every((price, i) => i === 0 || price >= recent[i - 1]);
  const decreasing = recent.every((price, i) => i === 0 || price <= recent[i - 1]);

  if (increasing) {
    return { confidence: 0.7, pattern: 'strong_bullish_trend' };
  } else if (decreasing) {
    return { confidence: 0.7, pattern: 'strong_bearish_trend' };
  }

  return { confidence: 0, pattern: 'neutral' };
}

/**
 * Create default indicators when no data is available
 */
export function createDefaultIndicators(): any {
  // Return sensible defaults that indicate neutral market conditions
  // rather than zeros which could be misleading
  // Return nulls for technical indicators to prevent false signals
  // when data is missing or insufficient (User Rule: Indicator Safety)
  return {
    rsi: null,
    ma50: null,
    ma200: null,
    ema20: null,
    ema50: null,
    macd: null,
    volume: { score: 0.5, trend: 'neutral' }, // Keep volume neutral
    vwap: null,
    atr: null,
    pattern: { confidence: 0, pattern: 'neutral' }, // No pattern detected
    momentum: { score: 0.5, direction: 'neutral' } // Neutral momentum
  };
}

/**
 * Create default indicators data structure
 */
export function createDefaultIndicatorsData(): any {
  return {
    ohlc: [],
    indicators: createDefaultIndicators(),
    latest: null
  };
}

/**
 * Calculate unified sentiment score (-1 to 1)
 * positive: +1, negative: -1, neutral: 0
 */
export function calculateUnifiedSentiment(text: string): number {
  const lowerText = text.toLowerCase();

  const positiveWords = ['bull', 'rise', 'gain', 'surge', 'rally', 'up', 'bullish', 'moon', 'pump', 'breakthrough', 'adoption', 'growth', 'success', 'profit', 'increase', 'high', 'strong', 'positive'];
  const negativeWords = ['bear', 'fall', 'drop', 'crash', 'decline', 'down', 'bearish', 'dump', 'sell-off', 'correction', 'loss', 'decrease', 'low', 'weak', 'negative', 'fail', 'crash', 'dump'];

  let positiveCount = 0;
  let negativeCount = 0;

  positiveWords.forEach(word => {
    if (lowerText.includes(word)) positiveCount++;
  });

  negativeWords.forEach(word => {
    if (lowerText.includes(word)) negativeCount++;
  });

  if (positiveCount > negativeCount) return 1; // positive
  if (negativeCount > positiveCount) return -1; // negative
  return 0; // neutral
}

/**
 * Calculate weighted sentiment score (0-1 scale with neutral at 0.5)
 */
export function calculateWeightedSentiment(articles: any[]): number {
  if (articles.length === 0) return 0.5;

  const sentiments = articles.map(article => article.sentiment || 0);
  const averageSentiment = sentiments.reduce((sum, sentiment) => sum + sentiment, 0) / sentiments.length;

  // Convert from -1/+1 scale to 0-1 scale (0.5 = neutral)
  return (averageSentiment + 1) / 2;
}

/**
 * Calculate comprehensive accuracy score based on multi-factor analysis
 */
export function calculateAccuracyScore(
  signal: 'BUY' | 'SELL' | 'HOLD',
  indicators: any,
  marketData: any,
  ccData: any,
  metadata: any,
  newsData: any,
  strategy?: string
): number {
  // 1. INDICATOR ALIGNMENT SCORE (0-100) - Weight: 40%
  let indicatorScore = 50; // Start at neutral

  // MACD strength alignment (+10 if matches signal)
  if (indicators.macd?.signal === 'bullish' && signal === 'BUY') indicatorScore += 10;
  else if (indicators.macd?.signal === 'bearish' && signal === 'SELL') indicatorScore += 10;

  // Price vs Moving Averages alignment
  const currentPrice = marketData?.price || indicators?.latest?.price || 0;

  // Define for wider scope (used in Risk Penalty)
  const ema20 = indicators.ema20?.value;
  const sma50 = indicators.ma50?.value;
  const sma200 = indicators.ma200?.value;

  if (currentPrice > 0) {
    if (signal === 'BUY') {
      // For BUY signals, price should be above key averages
      if (ema20 && currentPrice > ema20) indicatorScore += 3;
      if (sma50 && currentPrice > sma50) indicatorScore += 3;
      if (sma200 && currentPrice > sma200) indicatorScore += 4;
      // Bonus for trend alignment (EMA20 > SMA50 > SMA200)
      if (ema20 && sma50 && sma200 && ema20 > sma50 && sma50 > sma200) indicatorScore += 5;
    } else if (signal === 'SELL') {
      // For SELL signals, price should be below key averages
      if (ema20 && currentPrice < ema20) indicatorScore += 3;
      if (sma50 && currentPrice < sma50) indicatorScore += 3;
      if (sma200 && currentPrice < sma200) indicatorScore += 4;
      // Bonus for trend alignment (EMA20 < SMA50 < SMA200)
      if (ema20 && sma50 && sma200 && ema20 < sma50 && sma50 < sma200) indicatorScore += 5;
    }
  }

  // RSI support (+5 if supports direction, -10 if extreme against)
  const rsi = indicators.rsi?.value || 50;
  if (signal === 'BUY' && rsi < 70) indicatorScore += 5; // RSI supports BUY (not overbought)
  else if (signal === 'SELL' && rsi > 30) indicatorScore += 5; // RSI supports SELL (not oversold)
  else if (signal === 'BUY' && rsi > 80) indicatorScore -= 10; // RSI extreme against BUY
  else if (signal === 'SELL' && rsi < 20) indicatorScore -= 10; // RSI extreme against SELL

  // VWAP alignment (+5)
  if (indicators.vwap?.signal === 'bullish' && signal === 'BUY') indicatorScore += 5;
  else if (indicators.vwap?.signal === 'bearish' && signal === 'SELL') indicatorScore += 5;

  // Strategy-specific adjustments
  if (strategy === 'Scalping') {
    // Higher weight on momentum & EMA20
    if (indicators.ema20?.emaTrend === 'bullish' && signal === 'BUY') indicatorScore += 5;
    else if (indicators.ema20?.emaTrend === 'bearish' && signal === 'SELL') indicatorScore += 5;
  } else if (strategy === 'Swing') {
    // Higher weight on SMA50 & market regime
    if (indicators.ma50?.smaTrend === 'bullish' && signal === 'BUY') indicatorScore += 5;
    else if (indicators.ma50?.smaTrend === 'bearish' && signal === 'SELL') indicatorScore += 5;
  } else if (strategy === 'Breakout') {
    // Higher weight on volume & volatility patterns
    if (indicators.pattern?.confidence > 0.7) indicatorScore += 5;
  } else if (strategy === 'Trend-following') {
    // Higher weight on MA alignment & VWAP
    if (indicators.vwap?.signal === signal.toLowerCase()) indicatorScore += 5;
  }

  indicatorScore = Math.max(0, Math.min(100, indicatorScore));

  // 2. MARKET STRUCTURE SCORE (0-100) - Weight: 25%
  let marketStructureScore = 50; // Start at neutral

  // Trend alignment (+10 if 1h & 1d match)
  if (ccData?.trend1h && ccData?.trend1d) {
    if (ccData.trend1h === ccData.trend1d) {
      marketStructureScore += 10;
      if ((ccData.trend1h === 'bullish' && signal === 'BUY') ||
        (ccData.trend1h === 'bearish' && signal === 'SELL')) {
        marketStructureScore += 10; // Market regime aligns with signal
      }
    }
  }

  // Support/Resistance proximity (simplified - would need actual S/R levels)
  // Support/Resistance proximity (simplified - would need actual S/R levels)
  // For now, use VWAP as proxy for fair value
  if (indicators.vwap) {
    const vwap = indicators.vwap.value || currentPrice;
    const vwapDeviation = indicators.vwap.deviation || 0;

    if (signal === 'BUY' && currentPrice < vwap && vwapDeviation < -2) {
      marketStructureScore += 5; // Price in discount zone for BUY
    } else if (signal === 'SELL' && currentPrice > vwap && vwapDeviation > 2) {
      marketStructureScore += 5; // Price in premium zone for SELL
    } else if (signal === 'BUY' && currentPrice > vwap && vwapDeviation > 2) {
      marketStructureScore -= 10; // Price at resistance for BUY signal
    } else if (signal === 'SELL' && currentPrice < vwap && vwapDeviation < -2) {
      marketStructureScore -= 10; // Price at support for SELL signal
    }
  }

  marketStructureScore = Math.max(0, Math.min(100, marketStructureScore));

  // 3. MOMENTUM SCORE (0-100) - Weight: 15%
  let momentumScore = 50; // Start at neutral

  // Momentum indicator (convert 0-1 scale to 0-100)
  const momentum = indicators.momentum?.score || 0.5;
  momentumScore = momentum * 100;

  // ATR relative volatility penalty
  const atr = indicators.atr?.value || 0.01;
  const atrClassification = indicators.atr?.classification || 'medium';
  if (atrClassification === 'high') {
    momentumScore -= 15; // High volatility = risk penalty
  } else if (atrClassification === 'low') {
    momentumScore += 5; // Low volatility = more reliable
  }

  // Pattern confidence boost
  const patternConfidence = indicators.pattern?.confidence || 0;
  momentumScore += patternConfidence * 10; // Up to +10 for high confidence patterns

  momentumScore = Math.max(0, Math.min(100, momentumScore));

  // 4. VOLUME CONFIRMATION SCORE (0-100) - Weight: 10%
  let volumeScore = 50; // Start at neutral

  const volumeTrend = indicators.volume?.trend || 'neutral';
  const volumeStrength = indicators.volume?.score || 0.5;

  // High volume + trend alignment = +20
  if (volumeTrend === 'increasing' && volumeStrength > 0.7) {
    if (signal === 'BUY' && indicators.volume?.trend === 'increasing') volumeScore += 20;
    else if (signal === 'SELL' && indicators.volume?.trend === 'increasing') volumeScore += 20;
  }

  // Low volume penalty
  if (volumeStrength < 0.3) {
    volumeScore = Math.min(volumeScore, 20); // Cap at 20 for low volume
  }

  // Volume divergence penalty
  if (signal === 'BUY' && volumeTrend === 'decreasing') volumeScore -= 10;
  else if (signal === 'SELL' && volumeTrend === 'decreasing') volumeScore -= 10;

  volumeScore = Math.max(0, Math.min(100, volumeScore));

  // 5. NEWS & SENTIMENT SCORE (0-100) - Weight: 10%
  let newsScore = 50; // Start at neutral

  if (newsData?.sentimentScore !== undefined) {
    const sentimentScore = newsData.sentimentScore;
    newsScore = sentimentScore * 100; // Convert to 0-100 scale

    // Additional alignment bonuses
    if (sentimentScore > 0.6 && signal === 'BUY') newsScore += 10;
    else if (sentimentScore < 0.4 && signal === 'SELL') newsScore += 10;
    else if ((sentimentScore > 0.6 && signal === 'SELL') ||
      (sentimentScore < 0.4 && signal === 'BUY')) {
      newsScore -= 20; // Conflicting news = penalty
    }
  } else {
    // No news data available = neutral
    newsScore = 50;
  }

  newsScore = Math.max(0, Math.min(100, newsScore));

  // 6. VOLATILITY & RISK PENALTY (0 to -15%) - Weight: -10%
  let riskPenalty = 0;

  // ATR-based volatility penalty
  if (atrClassification === 'high') riskPenalty += 5;
  else if (atrClassification === 'medium') riskPenalty += 2;

  // Wrong-side EMA compression (high risk)
  if (ema20 && sma50 && sma200) {
    if (signal === 'BUY' && ema20 < sma50 && sma50 < sma200) riskPenalty += 5;
    else if (signal === 'SELL' && ema20 > sma50 && sma50 > sma200) riskPenalty += 5;
  }

  // High volatility + low volume mismatch
  if (atrClassification === 'high' && volumeStrength < 0.4) riskPenalty += 3;

  riskPenalty = Math.min(15, riskPenalty); // Max penalty of 15%

  // FINAL ACCURACY FORMULA
  let finalAccuracy = Math.max(0, Math.min(100,
    (indicatorScore * 0.40) +
    (marketStructureScore * 0.25) +
    (momentumScore * 0.15) +
    (volumeScore * 0.10) +
    (newsScore * 0.10) -
    (riskPenalty * 0.10)
  ));

  // Drop accuracy if critical providers fail (Softened and stabilized)
  if (!marketData?.success) finalAccuracy -= 10;
  if (!ccData?.success) finalAccuracy -= 5;
  if (!metadata?.success) finalAccuracy -= 2;
  if (!newsData?.success) finalAccuracy -= 2;

  // Scale to 0-100 range first, then clamp strictly
  // User Rule: Final accuracy MUST be between 0 and 100
  // Returning 0-1 range for internal logic compatibility (formatter applies *100)
  const clamped = Math.max(0, Math.min(100, finalAccuracy));
  return clamped / 100; // Return decimal 0.0 - 1.0
}

