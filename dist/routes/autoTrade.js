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
const userEngineManager_1 = require("../services/userEngineManager");
const logger_1 = require("../utils/logger");
const keyManager_1 = require("../services/keyManager");
const binanceAdapter_1 = require("../services/binanceAdapter");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const toggleAutoTradeSchema = zod_1.z.object({
    enabled: zod_1.z.boolean(),
});
/**
 * PART 3 & 4: Auto-Trade Routes
 * Handles starting/stopping per-user auto-trade engine
 */
async function autoTradeRoutes(fastify) {
    // GET /api/auto-trade/status - Get auto-trade status
    fastify.get('/status', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            // Get engine status from Firestore
            const engineStatus = await firestoreAdapter_1.firestoreAdapter.getEngineStatus(user.uid);
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
            return {
                autoTradeEnabled: engineStatus?.autoTradeEnabled || false,
                engineRunning: engineStatus?.engineRunning || false,
                isApiConnected: userData?.isApiConnected || false,
                apiStatus: userData?.apiStatus || 'disconnected',
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting auto-trade status');
            return reply.code(500).send({ error: err.message || 'Error fetching auto-trade status' });
        }
    });
    // POST /api/auto-trade/toggle - Toggle auto-trade ON/OFF
    fastify.post('/toggle', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = toggleAutoTradeSchema.parse(request.body);
            // PART 2: Verify user has connected API keys
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
            if (!userData?.apiConnected) {
                return reply.code(400).send({
                    error: 'Please connect your Binance API keys first in API Integrations',
                });
            }
            // Get API keys from apiKeys collection
            const db = admin.firestore((0, firebase_1.getFirebaseAdmin)());
            const apiKeysDoc = await db.collection('apiKeys').doc(user.uid).get();
            if (!apiKeysDoc.exists) {
                return reply.code(400).send({
                    error: 'API keys not found. Please connect your Binance API keys first.',
                });
            }
            const apiKeysData = apiKeysDoc.data();
            if (!apiKeysData?.apiKeyEncrypted || !apiKeysData?.apiSecretEncrypted || apiKeysData?.status !== 'connected') {
                return reply.code(400).send({
                    error: 'API keys not connected. Please connect your Binance API keys first.',
                });
            }
            // Decrypt API keys
            const apiKey = (0, keyManager_1.decrypt)(apiKeysData.apiKeyEncrypted);
            const apiSecret = (0, keyManager_1.decrypt)(apiKeysData.apiSecretEncrypted);
            if (body.enabled) {
                // PART 3 & 4: Start auto-trade engine
                try {
                    // Validate API keys again
                    const testAdapter = new binanceAdapter_1.BinanceAdapter(apiKey, apiSecret, true);
                    const validation = await testAdapter.validateApiKey();
                    if (!validation.valid || !validation.canTrade) {
                        return reply.code(400).send({
                            error: 'API key validation failed. Please check your API keys.',
                        });
                    }
                    // Get or create user engine
                    let engine = userEngineManager_1.userEngineManager.getUserEngine(user.uid);
                    if (!engine) {
                        await userEngineManager_1.userEngineManager.createUserEngine(user.uid, apiKey, apiSecret, true);
                        engine = userEngineManager_1.userEngineManager.getUserEngine(user.uid);
                    }
                    // Get settings to determine symbol
                    const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(user.uid);
                    const symbol = settings?.symbol || 'BTCUSDT';
                    // Start the auto-trade engine
                    await userEngineManager_1.userEngineManager.startAutoTrade(user.uid);
                    // Update engineStatus in Firestore
                    const engineStatusRef = db.collection('engineStatus').doc(user.uid);
                    await engineStatusRef.set({
                        uid: user.uid,
                        engineRunning: true,
                        autoTradeEnabled: true,
                        lastStarted: admin.firestore.Timestamp.now(),
                        updatedAt: admin.firestore.Timestamp.now(),
                    }, { merge: true });
                    // Update user document
                    await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                        autoTradeEnabled: true,
                        engineStatus: 'running',
                    });
                    // Update settings
                    await firestoreAdapter_1.firestoreAdapter.saveSettings(user.uid, {
                        ...settings,
                        autoTradeEnabled: true,
                    });
                    // PART 6: Log activity
                    await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_ENABLED', {
                        message: 'Auto-trade engine started',
                        symbol,
                    });
                    logger_1.logger.info({ uid: user.uid, symbol }, 'Auto-trade enabled');
                    return {
                        message: 'Auto-trade enabled successfully',
                        enabled: true,
                        status: 'running',
                    };
                }
                catch (error) {
                    logger_1.logger.error({ error: error.message, uid: user.uid }, 'Error starting auto-trade');
                    return reply.code(500).send({
                        error: `Failed to start auto-trade: ${error.message}`,
                    });
                }
            }
            else {
                // PART 3 & 4: Stop auto-trade engine
                try {
                    await userEngineManager_1.userEngineManager.stopAutoTrade(user.uid);
                    // Update engineStatus in Firestore
                    const engineStatusRef = db.collection('engineStatus').doc(user.uid);
                    await engineStatusRef.set({
                        uid: user.uid,
                        engineRunning: false,
                        autoTradeEnabled: false,
                        lastStopped: admin.firestore.Timestamp.now(),
                        updatedAt: admin.firestore.Timestamp.now(),
                    }, { merge: true });
                    // Update user document
                    await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                        autoTradeEnabled: false,
                        engineStatus: 'stopped',
                    });
                    // Update settings
                    const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(user.uid);
                    if (settings) {
                        await firestoreAdapter_1.firestoreAdapter.saveSettings(user.uid, {
                            ...settings,
                            autoTradeEnabled: false,
                        });
                    }
                    // PART 6: Log activity
                    await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_DISABLED', {
                        message: 'Auto-trade engine stopped',
                    });
                    logger_1.logger.info({ uid: user.uid }, 'Auto-trade disabled');
                    return {
                        message: 'Auto-trade disabled successfully',
                        enabled: false,
                        status: 'stopped',
                    };
                }
                catch (error) {
                    logger_1.logger.error({ error: error.message, uid: user.uid }, 'Error stopping auto-trade');
                    return reply.code(500).send({
                        error: `Failed to stop auto-trade: ${error.message}`,
                    });
                }
            }
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error toggling auto-trade');
            return reply.code(500).send({ error: err.message || 'Error toggling auto-trade' });
        }
    });
}
