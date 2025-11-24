"use strict";
/**
 * MACD Strategy Module
 * Calculates MACD and determines signal classification
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeMACD = analyzeMACD;
/**
 * Calculate EMA (Exponential Moving Average)
 */
function calculateEMA(prices, period) {
    if (prices.length < period)
        return prices[prices.length - 1] || 0;
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
function getMACDHistory(prices, fastPeriod = 12, slowPeriod = 26) {
    const history = [];
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
function analyzeMACD(candles, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
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
    let trend;
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
        }
        else {
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
