/**
 * Volume Strategy Module
 * Analyzes volume trends and determines signal classification
 */

export interface CandleData {
  close: number;
  high?: number;
  low?: number;
  open?: number;
  volume?: number;
  timestamp?: number;
}

export interface VolumeResult {
  signal: 'Bullish' | 'Bearish' | 'Stable';
  relativeVolume?: number; // RVOL - current volume / average volume
  changePercent?: number; // Volume change percentage
}

/**
 * Analyze volume and determine signal
 * Signal logic:
 * - Increasing volume during price rise → Bullish
 * - Increasing volume during price drop → Bearish
 * - Flat or decreasing volume → Stable/Neutral
 */
export function analyzeVolume(candles: CandleData[], lookbackPeriod: number = 20): VolumeResult {
  if (candles.length < lookbackPeriod || !candles.some(c => c.volume && c.volume > 0)) {
    return {
      signal: 'Stable',
    };
  }

  const validCandles = candles.filter(c => c.volume && c.volume > 0 && c.close > 0);
  if (validCandles.length < lookbackPeriod) {
    return {
      signal: 'Stable',
    };
  }

  // Get recent candles for analysis
  const recent = validCandles.slice(-lookbackPeriod);
  const current = recent[recent.length - 1];
  const previous = recent[recent.length - 2];
  
  if (!current || !previous) {
    return {
      signal: 'Stable',
    };
  }

  // Calculate average volume over lookback period
  const volumes = recent.map(c => c.volume || 0);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  
  // Calculate relative volume (RVOL)
  const relativeVolume = avgVolume > 0 ? (current.volume || 0) / avgVolume : 1;
  
  // Calculate volume change percentage
  const volumeChange = previous.volume && previous.volume > 0
    ? ((current.volume || 0) - previous.volume) / previous.volume * 100
    : 0;

  // Calculate price change
  const priceChange = previous.close > 0
    ? ((current.close - previous.close) / previous.close) * 100
    : 0;

  // Determine signal based on volume and price relationship
  let signal: 'Bullish' | 'Bearish' | 'Stable';
  
  // Increasing volume during price rise → Bullish
  if (volumeChange > 20 && priceChange > 0) {
    signal = 'Bullish';
  }
  // Increasing volume during price drop → Bearish
  else if (volumeChange > 20 && priceChange < 0) {
    signal = 'Bearish';
  }
  // High relative volume with price rise → Bullish
  else if (relativeVolume > 1.5 && priceChange > 0) {
    signal = 'Bullish';
  }
  // High relative volume with price drop → Bearish
  else if (relativeVolume > 1.5 && priceChange < 0) {
    signal = 'Bearish';
  }
  // Decreasing volume or flat → Stable
  else if (volumeChange < -20 || Math.abs(volumeChange) < 10) {
    signal = 'Stable';
  }
  // Moderate volume increase with neutral price → Stable
  else {
    signal = 'Stable';
  }

  return {
    signal,
    relativeVolume,
    changePercent: volumeChange,
  };
}

