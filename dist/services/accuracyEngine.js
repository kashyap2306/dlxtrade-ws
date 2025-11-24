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
exports.accuracyEngine = exports.AccuracyEngine = void 0;
const logger_1 = require("../utils/logger");
const researchEngine_1 = require("./researchEngine");
const firestoreAdapter_1 = require("./firestoreAdapter");
const strategyManager_1 = require("../strategies/strategyManager");
const userRiskManager_1 = require("./userRiskManager");
const metricsService_1 = require("./metricsService");
class AccuracyEngine {
    constructor() {
        this.adapter = null;
        this.uid = null;
        this.orderManager = null;
        this.isRunning = false;
        this.researchInterval = null;
        this.wsClients = new Set();
        // Best-effort exit monitoring cadence
        this.lastExitCheckAt = 0;
    }
    setAdapter(adapter) {
        this.adapter = adapter;
    }
    setOrderManager(orderManager) {
        this.orderManager = orderManager;
    }
    // Minimal, defensive exit monitor. Uses optional methods on orderManager if present.
    async monitorExits(symbol) {
        // Throttle checks to at most once per 2 seconds
        const now = Date.now();
        if (now - this.lastExitCheckAt < 2000)
            return;
        this.lastExitCheckAt = now;
        if (!this.uid || !this.adapter || !this.orderManager)
            return;
        try {
            // Fetch current mid price
            const ob = await this.adapter.getOrderbook(symbol, 5);
            const bb = parseFloat(ob.bids[0]?.price || '0');
            const ba = parseFloat(ob.asks[0]?.price || '0');
            const mid = (bb + ba) / 2;
            if (!mid)
                return;
            // Try to get open positions and their SL/TP (if orderManager implements these)
            const getPositions = this.orderManager.getOpenPositions;
            const closePosition = this.orderManager.closePosition;
            if (typeof getPositions !== 'function')
                return;
            const positions = await getPositions(this.uid, symbol);
            if (!Array.isArray(positions) || positions.length === 0)
                return;
            for (const pos of positions) {
                const side = (pos.side || '').toUpperCase();
                const sl = pos.stopLoss;
                const tp = pos.takeProfit;
                const qty = pos.quantity || pos.qty || 0;
                if (!qty || typeof closePosition !== 'function')
                    continue;
                let hit = false;
                let reason = '';
                if (typeof sl === 'number') {
                    if ((side === 'BUY' && mid <= sl) || (side === 'SELL' && mid >= sl)) {
                        hit = true;
                        reason = 'Stop loss hit';
                    }
                }
                if (!hit && typeof tp === 'number') {
                    if ((side === 'BUY' && mid >= tp) || (side === 'SELL' && mid <= tp)) {
                        hit = true;
                        reason = 'Take profit hit';
                    }
                }
                // Time-based exit if configured on the position (ttlMs)
                if (!hit && pos.openedAt && pos.ttlMs) {
                    const openedAt = typeof pos.openedAt === 'number' ? pos.openedAt : new Date(pos.openedAt).getTime();
                    if (now - openedAt >= pos.ttlMs) {
                        hit = true;
                        reason = 'Time-based exit';
                    }
                }
                if (hit) {
                    try {
                        await closePosition(this.uid, symbol, pos.id);
                        const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                        await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(this.uid, {
                            symbol,
                            timestamp: admin.firestore.Timestamp.now(),
                            action: 'EXECUTED',
                            reason,
                            status: 'FILLED',
                        });
                        this.broadcast({
                            type: 'execution',
                            data: { symbol, action: 'EXECUTED', reason, timestamp: new Date().toISOString() },
                        });
                    }
                    catch (err) {
                        logger_1.logger.error({ err, symbol, posId: pos.id }, 'Error closing position on exit monitor');
                    }
                }
            }
        }
        catch (err) {
            logger_1.logger.debug({ err }, 'Exit monitor skipped due to error');
        }
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
    async start(symbol, researchIntervalMs = 5000) {
        if (this.isRunning) {
            throw new Error('Accuracy engine already running');
        }
        if (!this.uid) {
            throw new Error('User ID not set');
        }
        this.isRunning = true;
        logger_1.logger.info({ symbol, interval: researchIntervalMs }, 'Accuracy engine started');
        // Start research loop
        this.researchInterval = setInterval(async () => {
            try {
                await this.runResearchCycle(symbol);
            }
            catch (err) {
                logger_1.logger.error({ err }, 'Error in research cycle');
            }
        }, researchIntervalMs);
        // Run first cycle immediately
        await this.runResearchCycle(symbol);
    }
    async stop() {
        if (!this.isRunning)
            return;
        this.isRunning = false;
        if (this.researchInterval) {
            clearInterval(this.researchInterval);
            this.researchInterval = null;
        }
        logger_1.logger.info('Accuracy engine stopped');
    }
    async runResearchCycle(symbol) {
        if (!this.uid || !this.adapter)
            return;
        const startTime = Date.now();
        // Run research with this user's adapter
        const research = await researchEngine_1.researchEngine.runResearch(symbol, this.uid, this.adapter);
        // Get settings
        const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(this.uid);
        const minAccuracy = settings?.minAccuracyThreshold || 0.85;
        const autoTradeEnabled = settings?.autoTradeEnabled || false;
        // Broadcast research result
        this.broadcast({
            type: 'research',
            data: {
                symbol: research.symbol,
                signal: research.signal,
                accuracy: research.accuracy,
                orderbookImbalance: research.orderbookImbalance,
                recommendedAction: research.recommendedAction,
                timestamp: new Date().toISOString(),
            },
        });
        // Check if we should execute
        if (autoTradeEnabled && research.accuracy >= minAccuracy && research.signal !== 'HOLD') {
            await this.executeTrade(symbol, research, startTime);
        }
        else {
            // Log skipped trade
            const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
            await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(this.uid, {
                symbol,
                timestamp: admin.firestore.Timestamp.now(),
                action: 'SKIPPED',
                reason: research.accuracy < minAccuracy
                    ? `Accuracy ${(research.accuracy * 100).toFixed(1)}% below threshold ${(minAccuracy * 100).toFixed(1)}%`
                    : !autoTradeEnabled
                        ? 'Auto-trade disabled'
                        : 'HOLD signal',
                accuracy: research.accuracy,
            });
            this.broadcast({
                type: 'execution',
                data: {
                    symbol,
                    action: 'SKIPPED',
                    reason: research.accuracy < minAccuracy
                        ? `Accuracy ${(research.accuracy * 100).toFixed(1)}% below threshold`
                        : 'HOLD signal',
                    accuracy: research.accuracy,
                    timestamp: new Date().toISOString(),
                },
            });
        }
        // Passive exit monitoring (non-blocking)
        try {
            await this.monitorExits(symbol);
        }
        catch (e) {
            logger_1.logger.debug({ e }, 'Exit monitor error (non-fatal)');
        }
    }
    async executeTrade(symbol, research, startTime) {
        if (!this.uid || !this.adapter || !this.orderManager)
            return;
        try {
            // Get settings
            const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(this.uid);
            if (!settings) {
                throw new Error('Settings not found');
            }
            const strategyName = settings.strategy || 'orderbook_imbalance';
            const quoteSize = settings.quoteSize || 0.001;
            // Get current orderbook
            const orderbook = await this.adapter.getOrderbook(symbol, 20);
            const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
            const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
            const midPrice = (bestBid + bestAsk) / 2;
            // Check risk limits before executing (use price-aware risk)
            const assumedAdverseMove = 0.01; // default 1% until volatility is wired here
            const riskCheck = await userRiskManager_1.userRiskManager.canTrade(this.uid, symbol, quoteSize, midPrice, assumedAdverseMove);
            if (!riskCheck.allowed) {
                logger_1.logger.warn({ uid: this.uid, reason: riskCheck.reason }, 'Trade blocked by risk manager');
                const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(this.uid, {
                    symbol,
                    timestamp: admin.firestore.Timestamp.now(),
                    action: 'SKIPPED',
                    reason: riskCheck.reason || 'Risk check failed',
                    accuracy: research.accuracy,
                });
                this.broadcast({
                    type: 'risk:alert',
                    data: {
                        symbol,
                        reason: riskCheck.reason,
                        timestamp: new Date().toISOString(),
                    },
                });
                return;
            }
            // orderbook already fetched above
            // Skip market_making_hft - that's handled by HFT engine only
            if (strategyName === 'market_making_hft') {
                logger_1.logger.warn({ uid: this.uid, symbol }, 'market_making_hft should be run via HFT engine, not AI engine');
                return;
            }
            // Initialize strategy if not already done
            const strategyConfig = {
                quoteSize,
                adversePct: settings.adversePct || 0.0002,
                cancelMs: settings.cancelMs || 40,
                maxPos: settings.maxPos || 0.01,
            };
            try {
                await strategyManager_1.strategyManager.initializeStrategy(this.uid, strategyName, strategyConfig, this.adapter, this.orderManager);
            }
            catch (err) {
                // Strategy might already be initialized, that's okay
                logger_1.logger.debug({ uid: this.uid, strategy: strategyName }, 'Strategy initialization (may already be initialized)');
            }
            // Execute strategy
            const tradeDecision = await strategyManager_1.strategyManager.executeStrategy(this.uid, strategyName, research, orderbook);
            // For other strategies, execute the trade decision
            if (tradeDecision && tradeDecision.action !== 'HOLD') {
                let order = null;
                if (tradeDecision.action === 'BUY' || tradeDecision.action === 'SELL') {
                    order = await this.orderManager.placeOrder(this.uid, {
                        symbol,
                        side: tradeDecision.action,
                        type: tradeDecision.type,
                        quantity: tradeDecision.quantity,
                        price: tradeDecision.price,
                    });
                }
                if (order) {
                    const executionLatency = Date.now() - startTime;
                    const slippage = tradeDecision.price
                        ? Math.abs((order.avgPrice || order.price || 0) - tradeDecision.price) / tradeDecision.price
                        : 0;
                    // Record trade result (success for now, will update on fill)
                    await userRiskManager_1.userRiskManager.recordTradeResult(this.uid, 0, true);
                    // PART 4: Save trade to Firestore trades collection with full schema
                    const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                    const entryPrice = order.avgPrice || order.price || tradeDecision.price || 0;
                    const tradeId = await firestoreAdapter_1.firestoreAdapter.saveTrade(this.uid, {
                        symbol,
                        side: order.side.toLowerCase(),
                        qty: order.quantity,
                        entryPrice,
                        exitPrice: undefined, // Will be set when trade closes
                        pnl: undefined, // Will be calculated when trade closes
                        timestamp: admin.firestore.Timestamp.now(),
                        engineType: 'auto',
                        orderId: order.id,
                    });
                    // PART 4: Update user's totalTrades
                    const userData = await firestoreAdapter_1.firestoreAdapter.getUser(this.uid);
                    const currentTrades = userData?.totalTrades || 0;
                    await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(this.uid, {
                        totalTrades: currentTrades + 1,
                    });
                    // PART 4: Update globalStats
                    const globalStats = await firestoreAdapter_1.firestoreAdapter.getGlobalStats();
                    if (globalStats) {
                        await firestoreAdapter_1.firestoreAdapter.updateGlobalStats({
                            totalTrades: (globalStats.totalTrades || 0) + 1,
                        });
                    }
                    // PART 6: Log execution with all required fields
                    await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(this.uid, {
                        symbol,
                        timestamp: admin.firestore.Timestamp.now(),
                        action: 'EXECUTED',
                        accuracy: research.accuracy,
                        accuracyUsed: research.accuracy, // The accuracy used for this decision
                        orderId: order.id,
                        orderIds: [order.id], // For market making, could be multiple
                        executionLatency,
                        slippage,
                        strategy: strategyName,
                        signal: research.signal,
                        pnl: 0, // Will be updated when position closes
                        status: order.status,
                    });
                    // PART 6: Log activity
                    await firestoreAdapter_1.firestoreAdapter.logActivity(this.uid, 'TRADE_EXECUTED', {
                        message: `Auto-trade executed: ${order.side} ${order.quantity} ${symbol} at ${entryPrice}`,
                        symbol,
                        side: order.side,
                        price: entryPrice,
                        quantity: order.quantity,
                        orderId: order.id,
                        tradeId,
                    });
                    // Also save to Postgres (orderManager already does this, but we can add strategy field)
                    // The order is already in Postgres via orderManager.placeOrder
                    this.broadcast({
                        type: 'execution',
                        data: {
                            symbol,
                            action: 'EXECUTED',
                            orderId: order.id,
                            side: order.side,
                            quantity: order.quantity,
                            price: order.price,
                            accuracy: research.accuracy,
                            executionLatency,
                            slippage,
                            strategy: strategyName,
                            timestamp: new Date().toISOString(),
                        },
                    });
                    // Record metrics
                    metricsService_1.metricsService.recordTrade(this.uid, strategyName, true, executionLatency);
                    // Notify admin WebSocket
                    const { adminWebSocketManager } = await Promise.resolve().then(() => __importStar(require('./adminWebSocketManager')));
                    adminWebSocketManager.notifyExecutionTrade(this.uid, {
                        symbol,
                        action: 'EXECUTED',
                        orderId: order.id,
                        side: order.side,
                        quantity: order.quantity,
                        price: order.price,
                        accuracy: research.accuracy,
                        strategy: strategyName,
                    });
                    logger_1.logger.info({ symbol, orderId: order.id, accuracy: research.accuracy, strategy: strategyName }, 'Trade executed via strategy');
                }
            }
            else {
                // Strategy decided to hold or returned null
                const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(this.uid, {
                    symbol,
                    timestamp: admin.firestore.Timestamp.now(),
                    action: 'SKIPPED',
                    reason: tradeDecision?.reason || 'Strategy returned HOLD',
                    accuracy: research.accuracy,
                    strategy: strategyName,
                });
            }
        }
        catch (err) {
            logger_1.logger.error({ err, symbol, uid: this.uid }, 'Error executing trade');
            // Record failure
            const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(this.uid);
            const strategyName = settings?.strategy || 'orderbook_imbalance';
            metricsService_1.metricsService.recordTrade(this.uid, strategyName, false);
            await userRiskManager_1.userRiskManager.recordTradeResult(this.uid, 0, false);
            const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
            await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(this.uid, {
                symbol,
                timestamp: admin.firestore.Timestamp.now(),
                action: 'SKIPPED',
                reason: `Execution error: ${err instanceof Error ? err.message : 'Unknown error'}`,
                accuracy: research.accuracy,
            });
        }
    }
}
exports.AccuracyEngine = AccuracyEngine;
exports.accuracyEngine = new AccuracyEngine();
