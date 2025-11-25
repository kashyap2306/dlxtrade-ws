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
exports.engineRoutes = engineRoutes;
const zod_1 = require("zod");
const userEngineManager_1 = require("../services/userEngineManager");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const engineConfigSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1),
    quoteSize: zod_1.z.number().positive(),
    adversePct: zod_1.z.number().min(0).max(1),
    cancelMs: zod_1.z.number().int().positive(),
    maxPos: zod_1.z.number().positive(),
    enabled: zod_1.z.boolean(),
});
async function engineRoutes(fastify) {
    fastify.get('/status', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const { uid } = request.query;
        // Users can only view their own status unless they're admin
        const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
        const targetUid = uid || user.uid;
        if (targetUid !== user.uid && !isAdmin) {
            return reply.code(403).send({ error: 'Access denied' });
        }
        // Get status from engine manager
        const status = userEngineManager_1.userEngineManager.getUserEngineStatus(targetUid);
        // Also get status from engineStatus collection
        const engineStatus = await firestoreAdapter_1.firestoreAdapter.getEngineStatus(targetUid);
        return {
            engine: {
                running: status.running,
                hasEngine: status.hasEngine,
            },
            engineStatus: engineStatus ? {
                active: engineStatus.active,
                engineType: engineStatus.engineType,
                symbol: engineStatus.symbol,
                config: engineStatus.config,
                updatedAt: engineStatus.updatedAt?.toDate().toISOString(),
            } : null,
        };
    });
    fastify.post('/start', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = engineConfigSchema.parse(request.body);
        try {
            // Check if auto-trade is enabled
            const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(user.uid);
            if (settings?.autoTradeEnabled) {
                // Use new auto-trade flow
                await userEngineManager_1.userEngineManager.startAutoTrade(user.uid);
                return { message: 'Auto-trade started', config: body };
            }
            // Legacy flow for research-only mode
            const { resolveExchangeConnector } = await Promise.resolve().then(() => __importStar(require('../services/exchangeResolver')));
            const resolved = await resolveExchangeConnector(user.uid);
            if (!resolved) {
                return reply.code(400).send({
                    error: 'No exchange API keys configured. Please set up your exchange API credentials in Settings → API Integration.'
                });
            }
            // Create or get user engine using resolved credentials
            await userEngineManager_1.userEngineManager.createUserEngine(user.uid, resolved.credentials.apiKey, resolved.credentials.secret, resolved.credentials.testnet);
            // Load enabled integrations for research APIs (CryptoQuant, LunarCrush, CoinAPI)
            const integrations = await firestoreAdapter_1.firestoreAdapter.getEnabledIntegrations(user.uid);
            global.apiIntegrations = integrations;
            // Save settings
            await firestoreAdapter_1.firestoreAdapter.saveSettings(user.uid, {
                symbol: body.symbol,
                quoteSize: body.quoteSize,
                adversePct: body.adversePct,
                cancelMs: body.cancelMs,
                maxPos: body.maxPos,
            });
            // Start accuracy engine (which includes research)
            await userEngineManager_1.userEngineManager.startUserEngine(user.uid, body.symbol, 5000); // Research every 5 seconds
            // Notify admin WebSocket
            const { adminWebSocketManager } = await Promise.resolve().then(() => __importStar(require('../services/adminWebSocketManager')));
            adminWebSocketManager.notifyEngineStart(user.uid, body.symbol);
            // Save engine status
            await firestoreAdapter_1.firestoreAdapter.saveEngineStatus(user.uid, {
                active: true,
                engineType: 'auto',
                symbol: body.symbol,
                config: body,
            });
            // Log activity
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'ENGINE_STARTED', {
                symbol: body.symbol,
                engineType: 'auto',
            });
            logger_1.logger.info({ config: body, uid: user.uid }, 'Engine started');
            return { message: 'Engine started', config: body };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error starting engine');
            return reply.code(400).send({ error: err.message || 'Error starting engine' });
        }
    });
    fastify.post('/stop', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            // Check if auto-trade is running
            const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(user.uid);
            if (settings?.autoTradeEnabled) {
                await userEngineManager_1.userEngineManager.stopAutoTrade(user.uid);
            }
            else {
                await userEngineManager_1.userEngineManager.stopUserEngineRunning(user.uid);
            }
            // Notify admin WebSocket
            const { adminWebSocketManager } = await Promise.resolve().then(() => __importStar(require('../services/adminWebSocketManager')));
            adminWebSocketManager.notifyEngineStop(user.uid);
            // Update engine status
            await firestoreAdapter_1.firestoreAdapter.saveEngineStatus(user.uid, {
                active: false,
                engineType: 'auto',
            });
            // Log activity
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'ENGINE_STOPPED', {
                engineType: 'auto',
            });
            logger_1.logger.info({ uid: user.uid }, 'Engine stopped');
            return { message: 'Engine stopped' };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error stopping engine');
            return reply.code(400).send({ error: err.message || 'Error stopping engine' });
        }
    });
    fastify.put('/config', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const body = engineConfigSchema.partial().parse(request.body);
        // TODO: Update engine config dynamically
        return { message: 'Config update (implementation pending)', config: body };
    });
    // Risk management routes - can be implemented per-user if needed
    fastify.post('/risk/pause', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // TODO: Implement per-user risk manager
        return { message: 'Risk manager pause (per-user implementation pending)' };
    });
    fastify.post('/risk/resume', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // TODO: Implement per-user risk manager
        return { message: 'Risk manager resume (per-user implementation pending)' };
    });
    fastify.put('/risk/limits', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // TODO: Implement per-user risk manager
        return { message: 'Risk limits update (per-user implementation pending)' };
    });
}
