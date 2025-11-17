"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketMakingHFTStrategy = exports.MarketMakingHFTStrategy = void 0;
const metricsService_1 = require("../services/metricsService");
const logger_1 = require("../utils/logger");
class MarketMakingHFTStrategy {
    constructor() {
        this.name = 'market_making_hft';
        this.userConfigs = new Map();
        this.userAdapters = new Map();
        this.userOrderManagers = new Map();
        this.pendingOrders = new Map(); // uid -> orders
        this.userInventory = new Map(); // uid -> net position
    }
    async init(uid, config) {
        this.userConfigs.set(uid, config);
        logger_1.logger.info({ uid, strategy: this.name }, 'Market Making HFT strategy initialized');
    }
    setAdapter(uid, adapter) {
        this.userAdapters.set(uid, adapter);
    }
    setOrderManager(uid, orderManager) {
        this.userOrderManagers.set(uid, orderManager);
    }
    async onResearch(uid, researchResult, orderbook) {
        const config = this.userConfigs.get(uid);
        if (!config) {
            logger_1.logger.warn({ uid }, 'Strategy not initialized');
            return null;
        }
        // Only execute if accuracy is high (this is checked by accuracyEngine, but double-check)
        if (researchResult.accuracy < 0.85) {
            return null;
        }
        const adapter = this.userAdapters.get(uid);
        const orderManager = this.userOrderManagers.get(uid);
        if (!adapter || !orderManager) {
            logger_1.logger.warn({ uid }, 'Adapter or order manager not set');
            return null;
        }
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        const midPrice = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;
        const minSpread = config.minSpread || spread * 0.5;
        // Check if spread is too tight
        if (spread < minSpread) {
            return null;
        }
        // Get current inventory
        const inventory = this.userInventory.get(uid) || 0;
        const maxPos = config.maxPos || 0.01;
        // Cancel old pending orders if price moved adversely
        await this.cancelAdverseOrders(uid, midPrice, config);
        // Place maker orders on both sides if inventory is neutral
        if (Math.abs(inventory) < maxPos * 0.3) {
            // Place bid (buy) order
            const bidPrice = bestBid * (1 - config.adversePct * 0.5); // Slightly below best bid
            const bidQty = config.quoteSize;
            // Place ask (sell) order
            const askPrice = bestAsk * (1 + config.adversePct * 0.5); // Slightly above best ask
            const askQty = config.quoteSize;
            try {
                // Place bid order
                const bidOrder = await orderManager.placeOrder(uid, {
                    symbol: researchResult.symbol,
                    side: 'BUY',
                    type: 'LIMIT',
                    quantity: bidQty,
                    price: bidPrice,
                });
                if (bidOrder) {
                    this.addPendingOrder(uid, {
                        orderId: bidOrder.id,
                        symbol: researchResult.symbol,
                        side: 'BUY',
                        price: bidPrice,
                        quantity: bidQty,
                        placedAt: Date.now(),
                    });
                    this.scheduleCancel(uid, bidOrder.id, config.cancelMs);
                }
                // Place ask order
                const askOrder = await orderManager.placeOrder(uid, {
                    symbol: researchResult.symbol,
                    side: 'SELL',
                    type: 'LIMIT',
                    quantity: askQty,
                    price: askPrice,
                });
                if (askOrder) {
                    this.addPendingOrder(uid, {
                        orderId: askOrder.id,
                        symbol: researchResult.symbol,
                        side: 'SELL',
                        price: askPrice,
                        quantity: askQty,
                        placedAt: Date.now(),
                    });
                    this.scheduleCancel(uid, askOrder.id, config.cancelMs);
                }
                // Log quote placement event
                const { firestoreAdapter } = await Promise.resolve().then(() => __importStar(require('../services/firestoreAdapter')));
                const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                const orderIds = [bidOrder?.id, askOrder?.id].filter(Boolean);
                await firestoreAdapter.saveExecutionLog(uid, {
                    symbol: researchResult.symbol,
                    timestamp: admin.firestore.Timestamp.now(),
                    action: 'EXECUTED',
                    accuracy: researchResult.accuracy,
                    accuracyUsed: researchResult.accuracy,
                    orderIds,
                    strategy: 'market_making_hft',
                    signal: researchResult.signal,
                    status: 'NEW',
                    reason: 'Market making quotes placed',
                });
                logger_1.logger.info({ uid, symbol: researchResult.symbol, bidPrice, askPrice, orderIds }, 'Market making orders placed and logged');
            }
            catch (err) {
                logger_1.logger.error({ err, uid }, 'Error placing market making orders');
            }
        }
        else if (inventory > maxPos * 0.3) {
            // Too long, only place sell orders
            const askPrice = bestAsk * (1 + config.adversePct * 0.5);
            const askOrder = await orderManager.placeOrder(uid, {
                symbol: researchResult.symbol,
                side: 'SELL',
                type: 'LIMIT',
                quantity: config.quoteSize,
                price: askPrice,
            });
            if (askOrder) {
                this.addPendingOrder(uid, {
                    orderId: askOrder.id,
                    symbol: researchResult.symbol,
                    side: 'SELL',
                    price: askPrice,
                    quantity: config.quoteSize,
                    placedAt: Date.now(),
                });
                this.scheduleCancel(uid, askOrder.id, config.cancelMs);
            }
        }
        else if (inventory < -maxPos * 0.3) {
            // Too short, only place buy orders
            const bidPrice = bestBid * (1 - config.adversePct * 0.5);
            const bidOrder = await orderManager.placeOrder(uid, {
                symbol: researchResult.symbol,
                side: 'BUY',
                type: 'LIMIT',
                quantity: config.quoteSize,
                price: bidPrice,
            });
            if (bidOrder) {
                this.addPendingOrder(uid, {
                    orderId: bidOrder.id,
                    symbol: researchResult.symbol,
                    side: 'BUY',
                    price: bidPrice,
                    quantity: config.quoteSize,
                    placedAt: Date.now(),
                });
                this.scheduleCancel(uid, bidOrder.id, config.cancelMs);
            }
        }
        // Return null as we handle orders directly
        return null;
    }
    async onOrderUpdate(uid, orderStatus) {
        // Update inventory when orders fill
        if (orderStatus.status === 'FILLED' || orderStatus.status === 'PARTIALLY_FILLED') {
            const pending = this.pendingOrders.get(uid) || [];
            const order = pending.find((o) => o.orderId === orderStatus.id);
            if (order) {
                const qty = orderStatus.filledQty || order.quantity;
                const currentInventory = this.userInventory.get(uid) || 0;
                if (order.side === 'BUY') {
                    this.userInventory.set(uid, currentInventory + qty);
                }
                else {
                    this.userInventory.set(uid, currentInventory - qty);
                }
                // Log fill event
                const { firestoreAdapter } = await Promise.resolve().then(() => __importStar(require('../services/firestoreAdapter')));
                const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                await firestoreAdapter.saveExecutionLog(uid, {
                    symbol: orderStatus.symbol || 'UNKNOWN',
                    timestamp: admin.firestore.Timestamp.now(),
                    action: 'EXECUTED',
                    reason: `Order filled: ${order.side} ${qty} @ ${orderStatus.avgPrice || order.price}`,
                    orderId: order.orderId,
                    strategy: 'market_making_hft',
                    status: orderStatus.status,
                });
                // Remove from pending if fully filled
                if (orderStatus.status === 'FILLED') {
                    this.removePendingOrder(uid, order.orderId);
                }
            }
        }
    }
    async shutdown(uid) {
        // Cancel all pending orders
        const pending = this.pendingOrders.get(uid) || [];
        const orderManager = this.userOrderManagers.get(uid);
        if (orderManager) {
            for (const order of pending) {
                try {
                    await orderManager.cancelOrder(uid, order.orderId);
                    if (order.cancelTimer) {
                        clearTimeout(order.cancelTimer);
                    }
                }
                catch (err) {
                    logger_1.logger.error({ err, uid, orderId: order.orderId }, 'Error canceling order on shutdown');
                }
            }
        }
        this.pendingOrders.delete(uid);
        this.userConfigs.delete(uid);
        this.userAdapters.delete(uid);
        this.userOrderManagers.delete(uid);
        this.userInventory.delete(uid);
        logger_1.logger.info({ uid }, 'Market Making HFT strategy shut down');
    }
    addPendingOrder(uid, order) {
        const pending = this.pendingOrders.get(uid) || [];
        pending.push(order);
        this.pendingOrders.set(uid, pending);
    }
    removePendingOrder(uid, orderId) {
        const pending = this.pendingOrders.get(uid) || [];
        const filtered = pending.filter((o) => o.orderId !== orderId);
        this.pendingOrders.set(uid, filtered);
    }
    scheduleCancel(uid, orderId, cancelMs) {
        const pending = this.pendingOrders.get(uid) || [];
        const order = pending.find((o) => o.orderId === orderId);
        if (order) {
            order.cancelTimer = setTimeout(async () => {
                const orderManager = this.userOrderManagers.get(uid);
                if (orderManager) {
                    try {
                        await orderManager.cancelOrder(uid, orderId);
                        this.removePendingOrder(uid, orderId);
                        metricsService_1.metricsService.recordCancel(uid, 'market_making_hft');
                        // Log cancel event
                        const { firestoreAdapter } = await Promise.resolve().then(() => __importStar(require('../services/firestoreAdapter')));
                        const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                        await firestoreAdapter.saveExecutionLog(uid, {
                            symbol: order.symbol,
                            timestamp: admin.firestore.Timestamp.now(),
                            action: 'SKIPPED',
                            reason: `Order auto-canceled after ${cancelMs}ms timeout`,
                            orderId: order.orderId,
                            strategy: 'market_making_hft',
                        });
                        logger_1.logger.info({ uid, orderId }, 'Order auto-canceled after timeout');
                    }
                    catch (err) {
                        logger_1.logger.error({ err, uid, orderId }, 'Error auto-canceling order');
                    }
                }
            }, cancelMs);
        }
    }
    async cancelAdverseOrders(uid, currentMidPrice, config) {
        const pending = this.pendingOrders.get(uid) || [];
        const orderManager = this.userOrderManagers.get(uid);
        if (!orderManager)
            return;
        for (const order of pending) {
            const priceMove = order.side === 'BUY'
                ? (currentMidPrice - order.price) / order.price
                : (order.price - currentMidPrice) / order.price;
            // If price moved against us by more than adversePct, cancel
            if (priceMove > config.adversePct) {
                try {
                    await orderManager.cancelOrder(uid, order.orderId);
                    if (order.cancelTimer) {
                        clearTimeout(order.cancelTimer);
                    }
                    this.removePendingOrder(uid, order.orderId);
                    metricsService_1.metricsService.recordCancel(uid, 'market_making_hft');
                    // Log cancel event
                    const { firestoreAdapter } = await Promise.resolve().then(() => __importStar(require('../services/firestoreAdapter')));
                    const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                    await firestoreAdapter.saveExecutionLog(uid, {
                        symbol: order.symbol,
                        timestamp: admin.firestore.Timestamp.now(),
                        action: 'SKIPPED',
                        reason: `Order canceled due to adverse price move: ${(priceMove * 100).toFixed(2)}%`,
                        orderId: order.orderId,
                        strategy: 'market_making_hft',
                    });
                    logger_1.logger.info({ uid, orderId: order.orderId, priceMove }, 'Order canceled due to adverse move');
                }
                catch (err) {
                    logger_1.logger.error({ err, uid, orderId: order.orderId }, 'Error canceling adverse order');
                }
            }
        }
    }
}
exports.MarketMakingHFTStrategy = MarketMakingHFTStrategy;
exports.marketMakingHFTStrategy = new MarketMakingHFTStrategy();
