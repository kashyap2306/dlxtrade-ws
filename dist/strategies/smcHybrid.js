"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smcHybridStrategy = exports.SMCHybridStrategy = void 0;
const logger_1 = require("../utils/logger");
class SMCHybridStrategy {
    constructor() {
        this.name = 'smc_hybrid';
        this.userConfigs = new Map();
    }
    async init(uid, config) {
        this.setConfig(uid, config);
        logger_1.logger.info({ uid, strategy: this.name }, 'SMC Hybrid strategy initialized');
    }
    async onResearch(uid, researchResult, orderbook) {
        const config = this.getConfig(uid);
        if (!config)
            return null;
        // Smart Money Concept + confirmation filters
        if (researchResult.signal === 'HOLD') {
            return null;
        }
        // Check micro-signals for confirmation
        const microSignals = researchResult.microSignals || {};
        const confirmations = this.countConfirmations(microSignals, researchResult.signal);
        // Require at least 2 confirmations
        if (confirmations < 2) {
            return null;
        }
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        const midPrice = (bestBid + bestAsk) / 2;
        // Calculate stop loss and take profit
        const stopLossPct = 0.01; // 1% stop loss
        const takeProfitPct = 0.02; // 2% take profit
        let price = midPrice;
        let stopLoss;
        let takeProfit;
        if (researchResult.signal === 'BUY') {
            price = bestAsk * 1.0002; // Market order equivalent
            stopLoss = price * (1 - stopLossPct);
            takeProfit = price * (1 + takeProfitPct);
        }
        else {
            price = bestBid * 0.9998; // Market order equivalent
            stopLoss = price * (1 + stopLossPct);
            takeProfit = price * (1 - takeProfitPct);
        }
        return {
            action: researchResult.signal,
            quantity: config.quoteSize,
            price,
            type: 'LIMIT',
            reason: `SMC Hybrid: ${confirmations} confirmations, accuracy: ${(researchResult.accuracy * 100).toFixed(1)}%`,
            stopLoss,
            takeProfit,
        };
    }
    async onOrderUpdate(uid, orderStatus) {
        // Monitor for stop loss / take profit triggers
        // This would typically be handled by a separate order monitoring service
    }
    async shutdown(uid) {
        logger_1.logger.info({ uid }, 'SMC Hybrid strategy shut down');
    }
    getConfig(uid) {
        return this.userConfigs.get(uid) || null;
    }
    setConfig(uid, config) {
        this.userConfigs.set(uid, config);
    }
    countConfirmations(microSignals, signal) {
        let count = 0;
        // Count positive signals that align with main signal
        if (microSignals.orderbookPressure && microSignals.orderbookPressure === signal)
            count++;
        if (microSignals.volumeSpike && microSignals.volumeSpike === signal)
            count++;
        if (microSignals.priceMomentum && microSignals.priceMomentum === signal)
            count++;
        return count;
    }
}
exports.SMCHybridStrategy = SMCHybridStrategy;
exports.smcHybridStrategy = new SMCHybridStrategy();
