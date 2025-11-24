"use strict";
/**
 * Order-Book Imbalance Strategy Module
 * Calculates orderbook imbalance and determines signal classification
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeOrderBook = analyzeOrderBook;
/**
 * Analyze orderbook imbalance
 * Signal logic:
 * - Imbalance > +0.33 → Buy Pressure → Bullish
 * - Imbalance < -0.33 → Sell Pressure → Bearish
 * - Between -0.33 and +0.33 → Balanced → Neutral
 *
 * @param orderbook Orderbook snapshot with bids and asks
 * @param depthLevels Number of levels to analyze (default: 10)
 */
function analyzeOrderBook(orderbook, depthLevels = 10) {
    if (!orderbook.bids || !orderbook.asks || orderbook.bids.length === 0 || orderbook.asks.length === 0) {
        return {
            imbalance: 0,
            imbalancePercent: 0,
            signal: 'Neutral',
            bidVolume: 0,
            askVolume: 0,
            totalVolume: 0,
        };
    }
    // Calculate total bid volume from top N levels
    const topBids = orderbook.bids.slice(0, depthLevels);
    const bidVolume = topBids.reduce((sum, bid) => {
        return sum + parseFloat(bid.quantity || '0');
    }, 0);
    // Calculate total ask volume from top N levels
    const topAsks = orderbook.asks.slice(0, depthLevels);
    const askVolume = topAsks.reduce((sum, ask) => {
        return sum + parseFloat(ask.quantity || '0');
    }, 0);
    const totalVolume = bidVolume + askVolume;
    if (totalVolume === 0) {
        return {
            imbalance: 0,
            imbalancePercent: 0,
            signal: 'Neutral',
            bidVolume: 0,
            askVolume: 0,
            totalVolume: 0,
        };
    }
    // Calculate imbalance: (bidVolume - askVolume) / (bidVolume + askVolume)
    const imbalance = (bidVolume - askVolume) / totalVolume;
    const imbalancePercent = imbalance * 100;
    // Determine signal based on thresholds
    let signal;
    if (imbalance > 0.33) {
        signal = 'Bullish'; // Strong buy pressure
    }
    else if (imbalance < -0.33) {
        signal = 'Bearish'; // Strong sell pressure
    }
    else {
        signal = 'Neutral'; // Balanced
    }
    return {
        imbalance,
        imbalancePercent,
        signal,
        bidVolume,
        askVolume,
        totalVolume,
    };
}
