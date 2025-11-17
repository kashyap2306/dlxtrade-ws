"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserStreamListener = void 0;
const logger_1 = require("../utils/logger");
const orderManager_1 = require("../services/orderManager");
class UserStreamListener {
    constructor() {
        this.adapter = null;
        this.orderCallbacks = new Set();
        this.fillCallbacks = new Set();
    }
    setAdapter(adapter) {
        this.adapter = adapter;
    }
    subscribeOrderUpdates(callback) {
        this.orderCallbacks.add(callback);
    }
    subscribeFills(callback) {
        this.fillCallbacks.add(callback);
    }
    async start() {
        if (!this.adapter) {
            throw new Error('Adapter not set');
        }
        const listenKey = await this.adapter.startUserDataStream();
        logger_1.logger.info({ listenKey }, 'User data stream started');
        // Keep alive every 30 minutes
        const keepAliveInterval = setInterval(async () => {
            try {
                await this.adapter.keepAliveUserDataStream();
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error keeping user stream alive');
            }
        }, 30 * 60 * 1000);
        this.adapter.subscribeUserData((data) => {
            this.handleUserData(data);
        });
        // Cleanup on stop
        process.on('SIGINT', () => {
            clearInterval(keepAliveInterval);
            this.stop();
        });
    }
    async handleUserData(data) {
        try {
            if (data.e === 'executionReport') {
                // Order update
                const order = {
                    id: data.i.toString(),
                    symbol: data.s,
                    side: data.S,
                    type: data.o,
                    quantity: parseFloat(data.q),
                    price: parseFloat(data.p || '0'),
                    status: data.X,
                    clientOrderId: data.c,
                    exchangeOrderId: data.i.toString(),
                    filledQty: parseFloat(data.z || '0'),
                    avgPrice: parseFloat(data.p || '0'),
                    createdAt: new Date(data.T || Date.now()),
                    updatedAt: new Date(data.E || Date.now()),
                };
                this.orderCallbacks.forEach((cb) => cb(order));
                // If filled, record fill
                if (data.x === 'TRADE' && data.X === 'FILLED') {
                    const fill = await orderManager_1.orderManager.recordFill({
                        orderId: order.id,
                        symbol: order.symbol,
                        side: order.side,
                        quantity: parseFloat(data.l || '0'),
                        price: parseFloat(data.L || '0'),
                        fee: parseFloat(data.n || '0'),
                        feeAsset: data.N || 'USDT',
                    });
                    this.fillCallbacks.forEach((cb) => cb(fill));
                }
            }
        }
        catch (err) {
            logger_1.logger.error({ err, data }, 'Error handling user data');
        }
    }
    async stop() {
        if (this.adapter) {
            await this.adapter.closeUserDataStream();
        }
        this.orderCallbacks.clear();
        this.fillCallbacks.clear();
        logger_1.logger.info('User stream listener stopped');
    }
}
exports.UserStreamListener = UserStreamListener;
