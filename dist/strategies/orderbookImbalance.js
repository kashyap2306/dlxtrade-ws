"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orderbookImbalanceStrategy = exports.OrderbookImbalanceStrategy = void 0;
const logger_1 = require("../utils/logger");
class OrderbookImbalanceStrategy {
    constructor() {
        this.name = 'orderbook_imbalance';
        this.userConfigs = new Map();
    }
    async init(uid, config) {
        this.setConfig(uid, config);
        logger_1.logger.info({ uid, strategy: this.name }, 'Orderbook Imbalance strategy initialized');
    }
    async onResearch(uid, researchResult, orderbook) {
        const config = this.getConfig(uid);
        if (!config)
            return null;
        // Use research signal and imbalance
        if (researchResult.signal === 'HOLD') {
            return null;
        }
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        const midPrice = (bestBid + bestAsk) / 2;
        // Calculate orderbook imbalance
        const bidVolume = orderbook.bids.slice(0, 10).reduce((sum, level) => sum + parseFloat(level.quantity), 0);
        const askVolume = orderbook.asks.slice(0, 10).reduce((sum, level) => sum + parseFloat(level.quantity), 0);
        const totalVolume = bidVolume + askVolume;
        const imbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;
        // Determine trade based on signal and imbalance
        let action = 'HOLD';
        let price = midPrice;
        const stopLossPct = 0.005; // 0.5%
        const takeProfitPct = 0.01; // 1%
        let stopLoss;
        let takeProfit;
        if (researchResult.signal === 'BUY' && imbalance > 0.1) {
            action = 'BUY';
            price = bestBid * 1.0001; // Slightly above best bid for aggressive fill
            stopLoss = price * (1 - stopLossPct);
            takeProfit = price * (1 + takeProfitPct);
        }
        else if (researchResult.signal === 'SELL' && imbalance < -0.1) {
            action = 'SELL';
            price = bestAsk * 0.9999; // Slightly below best ask for aggressive fill
            stopLoss = price * (1 + stopLossPct);
            takeProfit = price * (1 - takeProfitPct);
        }
        else {
            return null;
        }
        return {
            action,
            quantity: config.quoteSize,
            price,
            type: 'LIMIT',
            reason: `Orderbook imbalance: ${(imbalance * 100).toFixed(2)}%, Signal: ${researchResult.signal}`,
            stopLoss,
            takeProfit,
        };
    }
    async onOrderUpdate(uid, orderStatus) {
        // Exit monitoring can be integrated here if order updates report fills and price updates are available.
    }
    async shutdown(uid) {
        logger_1.logger.info({ uid }, 'Orderbook Imbalance strategy shut down');
    }
    getConfig(uid) {
        return this.userConfigs.get(uid) || null;
    }
    setConfig(uid, config) {
        this.userConfigs.set(uid, config);
    }
}
exports.OrderbookImbalanceStrategy = OrderbookImbalanceStrategy;
exports.orderbookImbalanceStrategy = new OrderbookImbalanceStrategy();
