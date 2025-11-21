/**
 * MACD Strategy Module
 * Calculates MACD and determines signal classification
 */

export interface CandleData {
  close: number;
  high?: number;
  low?: number;
  open?: number;
  volume?: number;
  timestamp?: number;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  trend: 'Bullish' | 'Bearish' | 'Neutral';
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;

  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Get MACD history for signal line calculation
 */
function getMACDHistory(prices: number[], fastPeriod: number = 12, slowPeriod: number = 26): number[] {
  const history: number[] = [];
  for (let i = slowPeriod; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    const emaFast = calculateEMA(slice, fastPeriod);
    const emaSlow = calculateEMA(slice, slowPeriod);
    history.push(emaFast - emaSlow);
  }
  return history;
}

/**
 * Analyze MACD and determine signal
 * Signal logic:
 * - Histogram > 0 and MACD > Signal → Bullish
 * - Histogram < 0 and MACD < Signal → Bearish
 * - Flat histogram or crossover zone → Neutral
 */
export function analyzeMACD(
  candles: CandleData[], 
  fastPeriod: number = 12, 
  slowPeriod: number = 26, 
  signalPeriod: number = 9
): MACDResult {
  const closes = candles.map(c => c.close).filter(c => c > 0);
  
  if (closes.length < slowPeriod) {
    return {
      macd: 0,
      signal: 0,
      histogram: 0,
      trend: 'Neutral',
    };
  }

  // Calculate EMAs
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  const macd = emaFast - emaSlow;

  // Calculate signal line (EMA of MACD)
  const macdHistory = getMACDHistory(closes, fastPeriod, slowPeriod);
  const signal = macdHistory.length >= signalPeriod 
    ? calculateEMA(macdHistory, signalPeriod) 
    : macd;
  
  const histogram = macd - signal;

  // Determine trend based on signal logic
  let trend: 'Bullish' | 'Bearish' | 'Neutral';
  
  // Histogram > 0 and MACD > Signal → Bullish
  if (histogram > 0 && macd > signal) {
    trend = 'Bullish';
  } 
  // Histogram < 0 and MACD < Signal → Bearish
  else if (histogram < 0 && macd < signal) {
    trend = 'Bearish';
  } 
  // Flat histogram or crossover zone → Neutral
  else {
    // Check if we're in a crossover zone (histogram close to zero)
    const histogramThreshold = Math.abs(macd) * 0.01; // 1% of MACD magnitude
    if (Math.abs(histogram) < histogramThreshold) {
      trend = 'Neutral'; // Flat histogram
    } else {
      // Mixed signals - default to Neutral
      trend = 'Neutral';
    }
  }

  return {
    macd,
    signal,
    histogram,
    trend,
  };
}

