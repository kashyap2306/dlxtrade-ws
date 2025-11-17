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
exports.HFTEngine = void 0;
const firestoreAdapter_1 = require("./firestoreAdapter");
const metricsService_1 = require("./metricsService");
const logger_1 = require("../utils/logger");
class HFTEngine {
    constructor() {
        this.adapter = null;
        this.orderManager = null;
        this.uid = null;
        this.isRunning = false;
        this.tradingInterval = null;
        this.wsClients = new Set();
        // Per-user state
        this.pendingOrders = new Map(); // uid -> orders
        this.userInventory = new Map(); // uid -> net position
        this.dailyTradeCount = new Map(); // uid -> trade count
    }
    setAdapter(adapter) {
        this.adapter = adapter;
    }
    setOrderManager(orderManager) {
        this.orderManager = orderManager;
    }
    setUserId(uid) {
        this.uid = uid;
    }
    registerWebSocketClient(ws) {
        this.wsClients.add(ws);
    }
    unregisterWebSocketClient(ws) {
        this.wsClients.delete(ws);
    }
    broadcast(data) {
        const message = JSON.stringify(data);
        this.wsClients.forEach((ws) => {
            try {
                if (ws.readyState === 1) { // WebSocket.OPEN
                    ws.send(message);
                }
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error broadcasting to WebSocket client');
            }
        });
    }
    async start(symbol, intervalMs = 100) {
        if (this.isRunning) {
            throw new Error('HFT engine already running');
        }
        if (!this.uid || !this.adapter || !this.orderManager) {
            throw new Error('HFT engine not initialized');
        }
        this.isRunning = true;
        logger_1.logger.info({ uid: this.uid, symbol, interval: intervalMs }, 'HFT engine started');
        // Start user data stream to listen for order updates
        try {
            const { UserStreamListener } = await Promise.resolve().then(() => __importStar(require('../workers/userStreamListener')));
            const userStreamListener = new UserStreamListener();
            userStreamListener.setAdapter(this.adapter);
            // Subscribe to order updates
            userStreamListener.subscribeOrderUpdates((order) => {
                this.onOrderUpdate({
                    id: order.id,
                    symbol: order.symbol,
                    status: order.status,
                    filledQty: order.filledQty,
                    avgPrice: order.avgPrice,
                });
            });
            await userStreamListener.start();
            this.userStreamListener = userStreamListener;
        }
        catch (err) {
            logger_1.logger.warn({ err, uid: this.uid }, 'Could not start user stream listener (non-critical)');
        }
        // Start high-frequency trading loop
        this.tradingInterval = setInterval(async () => {
            try {
                await this.runHFTCycle(symbol);
            }
            catch (err) {
                logger_1.logger.error({ err, uid: this.uid }, 'Error in HFT cycle');
            }
        }, intervalMs);
        // Run first cycle immediately
        await this.runHFTCycle(symbol);
    }
    async stop() {
        if (!this.isRunning)
            return;
        this.isRunning = false;
        if (this.tradingInterval) {
            clearInterval(this.tradingInterval);
            this.tradingInterval = null;
        }
        // Stop user stream listener
        if (this.userStreamListener) {
            try {
                await this.userStreamListener.stop();
            }
            catch (err) {
                logger_1.logger.warn({ err, uid: this.uid }, 'Error stopping user stream listener');
            }
        }
        // Cancel all pending orders
        if (this.uid && this.orderManager) {
            const pending = this.pendingOrders.get(this.uid) || [];
            for (const order of pending) {
                try {
                    await this.orderManager.cancelOrder(this.uid, order.orderId);
                    if (order.cancelTimer) {
                        clearTimeout(order.cancelTimer);
                    }
                }
                catch (err) {
                    logger_1.logger.error({ err, uid: this.uid, orderId: order.orderId }, 'Error canceling order on stop');
                }
            }
            this.pendingOrders.delete(this.uid);
        }
        logger_1.logger.info({ uid: this.uid }, 'HFT engine stopped');
    }
    async runHFTCycle(symbol) {
        if (!this.uid || !this.adapter || !this.orderManager)
            return;
        // Get HFT settings
        const settings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(this.uid);
        if (!settings || !settings.enabled) {
            return;
        }
        // Check trade frequency limit
        if (!this.canTradeMore(settings.maxTradesPerDay)) {
            logger_1.logger.debug({ uid: this.uid }, 'HFT trade frequency limit reached');
            return;
        }
        // Get current orderbook
        const orderbook = await this.adapter.getOrderbook(symbol, 20);
        // Calculate spread and liquidity metrics
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
        const midPrice = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;
        const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
        const minSpreadPct = settings.minSpreadPct || 0.01;
        // Check if spread is sufficient
        if (spreadPct < minSpreadPct) {
            return; // Spread too tight, skip
        }
        // Get current inventory
        const inventory = this.userInventory.get(this.uid) || 0;
        const maxPos = settings.maxPos || 0.01;
        // Cancel adverse orders
        await this.cancelAdverseOrders(midPrice, settings);
        // Place maker orders based on inventory
        if (Math.abs(inventory) < maxPos * 0.3) {
            // Neutral inventory - place both sides
            await this.placeMakerOrders(symbol, bestBid, bestAsk, settings, orderbook);
        }
        else if (inventory > maxPos * 0.3) {
            // Too long - only place sell orders
            await this.placeSellOrder(symbol, bestAsk, settings, orderbook);
        }
        else if (inventory < -maxPos * 0.3) {
            // Too short - only place buy orders
            await this.placeBuyOrder(symbol, bestBid, settings, orderbook);
        }
    }
    async placeMakerOrders(symbol, bestBid, bestAsk, settings, orderbook) {
        if (!this.uid || !this.orderManager)
            return;
        const bidPrice = bestBid * (1 - settings.adversePct * 0.5);
        const askPrice = bestAsk * (1 + settings.adversePct * 0.5);
        try {
            // Place bid order
            const bidOrder = await this.orderManager.placeOrder(this.uid, {
                symbol,
                side: 'BUY',
                type: 'LIMIT',
                quantity: settings.quoteSize,
                price: bidPrice,
            });
            if (bidOrder) {
                this.addPendingOrder({
                    orderId: bidOrder.id,
                    symbol,
                    side: 'BUY',
                    price: bidPrice,
                    quantity: settings.quoteSize,
                    placedAt: Date.now(),
                });
                this.scheduleCancel(bidOrder.id, settings.cancelMs);
                this.incrementTradeCount();
                await this.logHFTExecution('BID_PLACED', symbol, bidOrder, settings);
            }
            // Place ask order
            const askOrder = await this.orderManager.placeOrder(this.uid, {
                symbol,
                side: 'SELL',
                type: 'LIMIT',
                quantity: settings.quoteSize,
                price: askPrice,
            });
            if (askOrder) {
                this.addPendingOrder({
                    orderId: askOrder.id,
                    symbol,
                    side: 'SELL',
                    price: askPrice,
                    quantity: settings.quoteSize,
                    placedAt: Date.now(),
                });
                this.scheduleCancel(askOrder.id, settings.cancelMs);
                this.incrementTradeCount();
                await this.logHFTExecution('ASK_PLACED', symbol, askOrder, settings);
            }
            this.broadcast({
                type: 'hft:quote',
                data: {
                    symbol,
                    bidPrice,
                    askPrice,
                    timestamp: new Date().toISOString(),
                },
            });
        }
        catch (err) {
            logger_1.logger.error({ err, uid: this.uid }, 'Error placing maker orders');
        }
    }
    async placeBuyOrder(symbol, bestBid, settings, orderbook) {
        if (!this.uid || !this.orderManager)
            return;
        const bidPrice = bestBid * (1 - settings.adversePct * 0.5);
        try {
            const bidOrder = await this.orderManager.placeOrder(this.uid, {
                symbol,
                side: 'BUY',
                type: 'LIMIT',
                quantity: settings.quoteSize,
                price: bidPrice,
            });
            if (bidOrder) {
                this.addPendingOrder({
                    orderId: bidOrder.id,
                    symbol,
                    side: 'BUY',
                    price: bidPrice,
                    quantity: settings.quoteSize,
                    placedAt: Date.now(),
                });
                this.scheduleCancel(bidOrder.id, settings.cancelMs);
                this.incrementTradeCount();
                await this.logHFTExecution('BID_PLACED', symbol, bidOrder, settings);
            }
        }
        catch (err) {
            logger_1.logger.error({ err, uid: this.uid }, 'Error placing buy order');
        }
    }
    async placeSellOrder(symbol, bestAsk, settings, orderbook) {
        if (!this.uid || !this.orderManager)
            return;
        const askPrice = bestAsk * (1 + settings.adversePct * 0.5);
        try {
            const askOrder = await this.orderManager.placeOrder(this.uid, {
                symbol,
                side: 'SELL',
                type: 'LIMIT',
                quantity: settings.quoteSize,
                price: askPrice,
            });
            if (askOrder) {
                this.addPendingOrder({
                    orderId: askOrder.id,
                    symbol,
                    side: 'SELL',
                    price: askPrice,
                    quantity: settings.quoteSize,
                    placedAt: Date.now(),
                });
                this.scheduleCancel(askOrder.id, settings.cancelMs);
                this.incrementTradeCount();
                await this.logHFTExecution('ASK_PLACED', symbol, askOrder, settings);
            }
        }
        catch (err) {
            logger_1.logger.error({ err, uid: this.uid }, 'Error placing sell order');
        }
    }
    async cancelAdverseOrders(currentMidPrice, settings) {
        if (!this.uid || !this.orderManager)
            return;
        const pending = this.pendingOrders.get(this.uid) || [];
        for (const order of pending) {
            const priceMove = order.side === 'BUY'
                ? (currentMidPrice - order.price) / order.price
                : (order.price - currentMidPrice) / order.price;
            if (priceMove > settings.adversePct) {
                try {
                    await this.orderManager.cancelOrder(this.uid, order.orderId);
                    if (order.cancelTimer) {
                        clearTimeout(order.cancelTimer);
                    }
                    this.removePendingOrder(order.orderId);
                    metricsService_1.metricsService.recordCancel(this.uid, 'market_making_hft');
                    await this.logHFTExecution('CANCELED', order.symbol, null, settings, `Adverse price move: ${(priceMove * 100).toFixed(2)}%`);
                }
                catch (err) {
                    logger_1.logger.error({ err, uid: this.uid, orderId: order.orderId }, 'Error canceling adverse order');
                }
            }
        }
    }
    scheduleCancel(orderId, cancelMs) {
        if (!this.uid)
            return;
        const pending = this.pendingOrders.get(this.uid) || [];
        const order = pending.find((o) => o.orderId === orderId);
        if (order) {
            order.cancelTimer = setTimeout(async () => {
                if (this.orderManager && this.uid) {
                    try {
                        await this.orderManager.cancelOrder(this.uid, orderId);
                        this.removePendingOrder(orderId);
                        metricsService_1.metricsService.recordCancel(this.uid, 'market_making_hft');
                        const settings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(this.uid);
                        await this.logHFTExecution('CANCELED', order.symbol, null, settings, `Auto-canceled after ${cancelMs}ms`);
                    }
                    catch (err) {
                        logger_1.logger.error({ err, uid: this.uid, orderId }, 'Error auto-canceling order');
                    }
                }
            }, cancelMs);
        }
    }
    addPendingOrder(order) {
        if (!this.uid)
            return;
        const pending = this.pendingOrders.get(this.uid) || [];
        pending.push(order);
        this.pendingOrders.set(this.uid, pending);
    }
    removePendingOrder(orderId) {
        if (!this.uid)
            return;
        const pending = this.pendingOrders.get(this.uid) || [];
        const filtered = pending.filter((o) => o.orderId !== orderId);
        this.pendingOrders.set(this.uid, filtered);
    }
    canTradeMore(maxTradesPerDay) {
        if (!this.uid)
            return false;
        const today = new Date().toISOString().split('T')[0];
        const tradeCount = this.dailyTradeCount.get(this.uid);
        if (!tradeCount || tradeCount.date !== today) {
            this.dailyTradeCount.set(this.uid, { count: 0, date: today });
            return true;
        }
        return tradeCount.count < maxTradesPerDay;
    }
    incrementTradeCount() {
        if (!this.uid)
            return;
        const today = new Date().toISOString().split('T')[0];
        const tradeCount = this.dailyTradeCount.get(this.uid);
        if (!tradeCount || tradeCount.date !== today) {
            this.dailyTradeCount.set(this.uid, { count: 1, date: today });
        }
        else {
            tradeCount.count++;
        }
    }
    async logHFTExecution(action, symbol, order, settings, reason) {
        if (!this.uid)
            return;
        const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
        await firestoreAdapter_1.firestoreAdapter.saveHFTExecutionLog(this.uid, {
            symbol,
            timestamp: admin.firestore.Timestamp.now(),
            action,
            orderId: order?.id,
            orderIds: order ? [order.id] : undefined,
            price: order?.price,
            quantity: order?.quantity,
            side: order?.side,
            reason,
            strategy: 'market_making_hft',
            status: order?.status,
        });
    }
    async onOrderUpdate(orderStatus) {
        if (!this.uid)
            return;
        if (orderStatus.status === 'FILLED' || orderStatus.status === 'PARTIALLY_FILLED') {
            const pending = this.pendingOrders.get(this.uid) || [];
            const order = pending.find((o) => o.orderId === orderStatus.id);
            if (order) {
                const qty = orderStatus.filledQty || order.quantity;
                const currentInventory = this.userInventory.get(this.uid) || 0;
                if (order.side === 'BUY') {
                    this.userInventory.set(this.uid, currentInventory + qty);
                }
                else {
                    this.userInventory.set(this.uid, currentInventory - qty);
                }
                // Log fill
                const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                const settings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(this.uid);
                await firestoreAdapter_1.firestoreAdapter.saveHFTExecutionLog(this.uid, {
                    symbol: orderStatus.symbol || 'UNKNOWN',
                    timestamp: admin.firestore.Timestamp.now(),
                    action: 'FILLED',
                    orderId: order.orderId,
                    price: orderStatus.avgPrice || order.price,
                    quantity: qty,
                    side: order.side,
                    strategy: 'market_making_hft',
                    status: orderStatus.status,
                });
                if (orderStatus.status === 'FILLED') {
                    this.removePendingOrder(order.orderId);
                }
            }
        }
    }
    getStatus() {
        return {
            running: this.isRunning,
            hasEngine: !!this.adapter && !!this.orderManager && !!this.uid,
        };
    }
}
exports.HFTEngine = HFTEngine;
