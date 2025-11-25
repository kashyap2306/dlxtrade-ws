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
exports.autoTradeRoutes = autoTradeRoutes;
const zod_1 = require("zod");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const autoTradeEngine_1 = require("../services/autoTradeEngine");
const logger_1 = require("../utils/logger");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const adminAuth_1 = require("../middleware/adminAuth");
const toggleAutoTradeSchema = zod_1.z.object({
    enabled: zod_1.z.boolean(),
});
const configSchema = zod_1.z.object({
    autoTradeEnabled: zod_1.z.boolean().optional(),
    perTradeRiskPct: zod_1.z.number().min(0.1).max(10).optional(),
    maxConcurrentTrades: zod_1.z.number().int().min(1).max(10).optional(),
    maxDailyLossPct: zod_1.z.number().min(0.5).max(50).optional(),
    stopLossPct: zod_1.z.number().min(0.5).max(10).optional(),
    takeProfitPct: zod_1.z.number().min(0.5).max(20).optional(),
    manualOverride: zod_1.z.boolean().optional(),
    mode: zod_1.z.enum(['AUTO', 'MANUAL']).optional(),
});
const queueSignalSchema = zod_1.z.object({
    symbol: zod_1.z.string(),
    signal: zod_1.z.enum(['BUY', 'SELL']),
    entryPrice: zod_1.z.number().positive(),
    accuracy: zod_1.z.number().min(0).max(1),
    stopLoss: zod_1.z.number().positive().optional(),
    takeProfit: zod_1.z.number().positive().optional(),
    reasoning: zod_1.z.string().optional(),
    requestId: zod_1.z.string().optional(),
});
const executeTradeSchema = zod_1.z.object({
    requestId: zod_1.z.string(),
    signal: queueSignalSchema,
});
/**
 * Auto-Trade Routes
 * Handles comprehensive auto-trade functionality with risk management
 */
async function autoTradeRoutes(fastify) {
    // Decorate with admin auth middleware
    fastify.decorate('adminAuth', adminAuth_1.adminAuthMiddleware);
    fastify.get('/status', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const status = await autoTradeEngine_1.autoTradeEngine.getStatus(user.uid);
            const config = await autoTradeEngine_1.autoTradeEngine.loadConfig(user.uid);
            // Get engine status from Firestore
            const engineStatus = await firestoreAdapter_1.firestoreAdapter.getEngineStatus(user.uid);
            // Check if user has exchange API keys configured (read from exchangeConfig/current)
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
            const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;
            return {
                ...status,
                engineRunning: engineStatus?.engineRunning || false,
                isApiConnected: hasExchangeConfig || false,
                apiStatus: hasExchangeConfig ? 'connected' : 'disconnected',
                config: {
                    perTradeRiskPct: config.perTradeRiskPct,
                    maxConcurrentTrades: config.maxConcurrentTrades,
                    maxDailyLossPct: config.maxDailyLossPct,
                    stopLossPct: config.stopLossPct,
                    takeProfitPct: config.takeProfitPct,
                },
                stats: config.stats,
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting auto-trade status');
            return reply.code(500).send({ error: err.message || 'Error fetching auto-trade status' });
        }
    });
    fastify.post('/config', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = configSchema.parse(request.body);
            // Validate mode changes - require admin for AUTO mode
            if (body.mode === 'AUTO' && body.mode !== (await autoTradeEngine_1.autoTradeEngine.loadConfig(user.uid)).mode) {
                // Check if user is admin
                const db = (0, firebase_1.getFirebaseAdmin)().firestore();
                const userDoc = await db.collection('users').doc(user.uid).get();
                const userData = userDoc.data() || {};
                const isAdmin = userData.role === 'admin' || userData.isAdmin === true;
                if (!isAdmin) {
                    return reply.code(403).send({
                        error: 'Only admins can enable AUTO (live trading) mode.',
                    });
                }
            }
            const savedConfig = await autoTradeEngine_1.autoTradeEngine.saveConfig(user.uid, body);
            logger_1.logger.info({ uid: user.uid, config: savedConfig }, 'Auto-trade config updated and saved to Firestore');
            return {
                message: 'Configuration updated successfully',
                config: savedConfig,
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({ error: 'Invalid configuration', details: err.errors });
            }
            logger_1.logger.error({ err }, 'Error updating auto-trade config');
            return reply.code(500).send({ error: err.message || 'Error updating configuration' });
        }
    });
    // POST /api/auto-trade/queue - Queue trade signal (internal use)
    fastify.post('/queue', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = queueSignalSchema.parse(request.body);
            const signal = {
                symbol: body.symbol,
                signal: body.signal,
                entryPrice: body.entryPrice,
                accuracy: body.accuracy,
                stopLoss: body.stopLoss || body.entryPrice * 0.985, // Default 1.5% stop loss
                takeProfit: body.takeProfit || body.entryPrice * 1.03, // Default 3% take profit
                reasoning: body.reasoning || 'Auto-trade signal',
                requestId: body.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date(),
            };
            // Save to queue
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            await db.collection('users').doc(user.uid).collection('autoTradeQueue').add({
                ...signal,
                timestamp: admin.firestore.Timestamp.now(),
                status: 'QUEUED',
                userId: user.uid,
            });
            logger_1.logger.info({ uid: user.uid, requestId: signal.requestId, symbol: signal.symbol }, 'Trade signal queued');
            return {
                success: true,
                requestId: signal.requestId,
                message: 'Trade signal queued successfully',
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({ error: 'Invalid signal data', details: err.errors });
            }
            logger_1.logger.error({ err }, 'Error queueing trade signal');
            return reply.code(500).send({ error: err.message || 'Error queueing signal' });
        }
    });
    // POST /api/auto-trade/run - Run queued analyses (admin/manual trigger)
    fastify.post('/run', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const config = await autoTradeEngine_1.autoTradeEngine.loadConfig(user.uid);
            if (!config.autoTradeEnabled) {
                return reply.code(400).send({ error: 'Auto-trade is not enabled' });
            }
            // Get queued signals
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            const queueSnapshot = await db.collection('users').doc(user.uid)
                .collection('autoTradeQueue')
                .where('status', '==', 'QUEUED')
                .orderBy('timestamp', 'asc')
                .limit(10)
                .get();
            if (queueSnapshot.empty) {
                return {
                    message: 'No queued signals to process',
                    processed: 0,
                };
            }
            const results = [];
            for (const doc of queueSnapshot.docs) {
                const signalData = doc.data();
                const signal = {
                    symbol: signalData.symbol,
                    signal: signalData.signal,
                    entryPrice: signalData.entryPrice,
                    accuracy: signalData.accuracy,
                    stopLoss: signalData.stopLoss,
                    takeProfit: signalData.takeProfit,
                    reasoning: signalData.reasoning,
                    requestId: signalData.requestId,
                    timestamp: signalData.timestamp.toDate(),
                };
                try {
                    const trade = await autoTradeEngine_1.autoTradeEngine.executeTrade(user.uid, signal);
                    // Update queue status
                    await doc.ref.update({
                        status: trade.status,
                        tradeId: trade.tradeId,
                        orderId: trade.orderId,
                        processedAt: admin.firestore.Timestamp.now(),
                    });
                    results.push({ requestId: signal.requestId, status: trade.status, tradeId: trade.tradeId });
                }
                catch (error) {
                    await doc.ref.update({
                        status: 'FAILED',
                        error: error.message,
                        processedAt: admin.firestore.Timestamp.now(),
                    });
                    results.push({ requestId: signal.requestId, status: 'FAILED', error: error.message });
                }
            }
            return {
                message: `Processed ${results.length} queued signals`,
                processed: results.length,
                results,
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error running queued trades');
            return reply.code(500).send({ error: err.message || 'Error processing queue' });
        }
    });
    // POST /api/auto-trade/execute - Execute specific queued trade (auth + rate-limited)
    fastify.post('/execute', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = executeTradeSchema.parse(request.body);
            const signal = {
                symbol: body.signal.symbol,
                signal: body.signal.signal,
                entryPrice: body.signal.entryPrice,
                accuracy: body.signal.accuracy,
                stopLoss: body.signal.stopLoss || body.signal.entryPrice * 0.985,
                takeProfit: body.signal.takeProfit || body.signal.entryPrice * 1.03,
                reasoning: body.signal.reasoning || 'Manual execution',
                requestId: body.requestId,
                timestamp: new Date(),
            };
            const trade = await autoTradeEngine_1.autoTradeEngine.executeTrade(user.uid, signal);
            return {
                success: true,
                trade,
                message: 'Trade executed successfully',
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({ error: 'Invalid trade data', details: err.errors });
            }
            logger_1.logger.error({ err }, 'Error executing trade');
            return reply.code(500).send({ error: err.message || 'Error executing trade' });
        }
    });
    // POST /api/auto-trade/toggle - Toggle auto-trade ON/OFF (legacy compatibility)
    fastify.post('/toggle', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = toggleAutoTradeSchema.parse(request.body);
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
            if (!exchangeConfigDoc.exists) {
                return reply.code(400).send({
                    error: 'Exchange API keys not found. Please connect your exchange API keys first in Settings → API Integration.',
                });
            }
            const exchangeConfig = exchangeConfigDoc.data();
            if (!exchangeConfig?.apiKeyEncrypted || !exchangeConfig?.secretEncrypted) {
                return reply.code(400).send({
                    error: 'Exchange API keys not properly configured. Please connect your exchange API keys first.',
                });
            }
            // Verify it's a trading exchange (not research API)
            const exchange = exchangeConfig.exchange || exchangeConfig.type;
            if (!['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
                return reply.code(400).send({
                    error: 'Trading exchange API keys required. Please connect a trading exchange (Binance, Bitget, BingX, or WEEX) first.',
                });
            }
            // Update config
            await autoTradeEngine_1.autoTradeEngine.saveConfig(user.uid, { autoTradeEnabled: body.enabled });
            if (body.enabled) {
                // Initialize adapter
                await autoTradeEngine_1.autoTradeEngine.initializeAdapter(user.uid);
                // Update engineStatus in Firestore
                const engineStatusRef = db.collection('engineStatus').doc(user.uid);
                await engineStatusRef.set({
                    uid: user.uid,
                    engineRunning: true,
                    autoTradeEnabled: true,
                    lastStarted: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                }, { merge: true });
                await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_ENABLED', {
                    message: 'Auto-trade engine started',
                });
                logger_1.logger.info({ uid: user.uid }, 'Auto-trade enabled');
            }
            else {
                // Update engineStatus in Firestore
                const engineStatusRef = db.collection('engineStatus').doc(user.uid);
                await engineStatusRef.set({
                    uid: user.uid,
                    engineRunning: false,
                    autoTradeEnabled: false,
                    lastStopped: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                }, { merge: true });
                await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_DISABLED', {
                    message: 'Auto-trade engine stopped',
                });
                logger_1.logger.info({ uid: user.uid }, 'Auto-trade disabled');
            }
            return {
                message: body.enabled ? 'Auto-trade enabled successfully' : 'Auto-trade disabled successfully',
                enabled: body.enabled,
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error toggling auto-trade');
            return reply.code(500).send({ error: err.message || 'Error toggling auto-trade' });
        }
    });
    fastify.post('/reset-circuit-breaker', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const user = request.user;
            await autoTradeEngine_1.autoTradeEngine.resetCircuitBreaker(user.uid);
            return {
                message: 'Circuit breaker reset successfully',
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error resetting circuit breaker');
            return reply.code(500).send({ error: err.message || 'Error resetting circuit breaker' });
        }
    });
}
