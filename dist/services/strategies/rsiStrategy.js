"use strict";
/**
 * RSI Strategy Module
 * Calculates RSI and determines signal classification
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRSIFromCandles = calculateRSIFromCandles;
exports.analyzeRSI = analyzeRSI;
/**
 * Calculate RSI from candle data
 */
function calculateRSIFromCandles(candles, period = 14) {
    if (candles.length < period + 1)
        return 50; // Neutral if insufficient data
    const closes = candles.map(c => c.close).filter(c => c > 0);
    if (closes.length < period + 1)
        return 50;
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
        changes.push(closes[i] - closes[i - 1]);
    }
    const gains = changes.filter(c => c > 0);
    const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
    const avgGain = gains.length > 0
        ? gains.slice(-period).reduce((a, b) => a + b, 0) / period
        : 0;
    const avgLoss = losses.length > 0
        ? losses.slice(-period).reduce((a, b) => a + b, 0) / period
        : 0;
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}
/**
 * Analyze RSI and determine signal
 * Signal logic:
 * - RSI < 30 → Bullish (oversold)
 * - RSI > 70 → Bearish (overbought)
 * - RSI between 45–55 → Neutral
 * - Otherwise: RSI > 55 → Slightly Bullish, RSI < 45 → Slightly Bearish (but map to Neutral for simplicity)
 */
function analyzeRSI(candles, period = 14) {
    const rsiValue = calculateRSIFromCandles(candles, period);
    // Determine signal based on thresholds
    let signal;
    if (rsiValue < 30) {
        signal = 'Bullish'; // Oversold - bullish signal
    }
    else if (rsiValue > 70) {
        signal = 'Bearish'; // Overbought - bearish signal
    }
    else if (rsiValue >= 45 && rsiValue <= 55) {
        signal = 'Neutral'; // Neutral zone
    }
    else {
        // For values between 30-45 or 55-70, determine based on proximity
        if (rsiValue < 45) {
            signal = 'Bullish'; // Closer to oversold
        }
        else {
            signal = 'Bearish'; // Closer to overbought
        }
    }
    // Optional: Detect RSI trend (rising/falling) for advanced confidence
    let trend;
    if (candles.length >= period + 5) {
        const recentRSI = calculateRSIFromCandles(candles.slice(-period - 3), period);
        const currentRSI = rsiValue;
        const diff = currentRSI - recentRSI;
        if (Math.abs(diff) < 2) {
            trend = 'Flat';
        }
        else if (diff > 0) {
            trend = 'Rising';
        }
        else {
            trend = 'Falling';
        }
    }
    return {
        value: rsiValue,
        signal,
        trend,
    };
}
