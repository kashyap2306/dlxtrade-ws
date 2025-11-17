"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WSListener = void 0;
const logger_1 = require("../utils/logger");
class WSListener {
    constructor() {
        this.adapter = null;
        this.orderbookCallbacks = new Set();
        this.tradesCallbacks = new Set();
    }
    setAdapter(adapter) {
        this.adapter = adapter;
    }
    subscribeOrderbook(callback) {
        this.orderbookCallbacks.add(callback);
    }
    subscribeTrades(callback) {
        this.tradesCallbacks.add(callback);
    }
    start(symbol) {
        if (!this.adapter) {
            throw new Error('Adapter not set');
        }
        this.adapter.subscribeOrderbook(symbol, (orderbook) => {
            this.orderbookCallbacks.forEach((cb) => cb(orderbook));
        });
        this.adapter.subscribeTrades(symbol, (trade) => {
            this.tradesCallbacks.forEach((cb) => cb(trade));
        });
        logger_1.logger.info({ symbol }, 'WebSocket listeners started');
    }
    stop() {
        if (this.adapter) {
            this.adapter.disconnect();
        }
        this.orderbookCallbacks.clear();
        this.tradesCallbacks.clear();
        logger_1.logger.info('WebSocket listeners stopped');
    }
}
exports.WSListener = WSListener;
