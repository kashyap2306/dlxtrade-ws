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
exports.hftRoutes = hftRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const userEngineManager_1 = require("../services/userEngineManager");
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
const hftSettingsSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1),
    quoteSize: zod_1.z.number().positive(),
    adversePct: zod_1.z.number().min(0).max(1),
    cancelMs: zod_1.z.number().int().positive(),
    maxPos: zod_1.z.number().positive(),
    minSpreadPct: zod_1.z.number().min(0),
    maxTradesPerDay: zod_1.z.number().int().positive(),
    enabled: zod_1.z.boolean(),
});
const hftQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().positive().max(500).optional().default(100),
});
async function hftRoutes(fastify) {
    // Get HFT status
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
        const status = userEngineManager_1.userEngineManager.getHFTStatus(targetUid);
        // Also get status from engineStatus collection
        const engineStatus = await firestoreAdapter_1.firestoreAdapter.getEngineStatus(targetUid);
        return {
            running: status.running,
            hasEngine: status.hasEngine,
            engineStatus: engineStatus && engineStatus.engineType === 'hft' ? {
                active: engineStatus.active,
                symbol: engineStatus.symbol,
                config: engineStatus.config,
                updatedAt: engineStatus.updatedAt?.toDate().toISOString(),
            } : null,
        };
    });
    // Start HFT engine
    fastify.post('/start', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            await userEngineManager_1.userEngineManager.startHFT(user.uid);
            // Notify admin WebSocket
            const { adminWebSocketManager } = await Promise.resolve().then(() => __importStar(require('../services/adminWebSocketManager')));
            const hftSettings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(user.uid);
            adminWebSocketManager.notifyEngineStart(user.uid, hftSettings?.symbol || 'UNKNOWN');
            // Save engine status
            await firestoreAdapter_1.firestoreAdapter.saveEngineStatus(user.uid, {
                active: true,
                engineType: 'hft',
                symbol: hftSettings?.symbol || 'UNKNOWN',
                config: hftSettings || {},
            });
            // Log activity
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'HFT_ENGINE_STARTED', {
                symbol: hftSettings?.symbol || 'UNKNOWN',
            });
            return { message: 'HFT engine started' };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error starting HFT engine');
            return reply.code(400).send({ error: err.message || 'Error starting HFT engine' });
        }
    });
    // Stop HFT engine
    fastify.post('/stop', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            await userEngineManager_1.userEngineManager.stopHFT(user.uid);
            // Notify admin WebSocket
            const { adminWebSocketManager } = await Promise.resolve().then(() => __importStar(require('../services/adminWebSocketManager')));
            adminWebSocketManager.notifyEngineStop(user.uid);
            // Update engine status
            await firestoreAdapter_1.firestoreAdapter.saveEngineStatus(user.uid, {
                active: false,
                engineType: 'hft',
            });
            // Log activity
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'HFT_ENGINE_STOPPED', {});
            return { message: 'HFT engine stopped' };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error stopping HFT engine');
            return reply.code(400).send({ error: err.message || 'Error stopping HFT engine' });
        }
    });
    // Get HFT execution logs
    fastify.get('/logs', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const query = hftQuerySchema.parse(request.query);
        const logs = await firestoreAdapter_1.firestoreAdapter.getHFTExecutionLogs(user.uid, query.limit);
        return logs.map((log) => ({
            id: log.id,
            symbol: log.symbol,
            timestamp: log.timestamp?.toDate().toISOString(),
            action: log.action,
            orderId: log.orderId,
            orderIds: log.orderIds,
            price: log.price,
            quantity: log.quantity,
            side: log.side,
            reason: log.reason,
            strategy: log.strategy,
            status: log.status,
            createdAt: log.createdAt?.toDate().toISOString(),
        }));
    });
    // Load HFT settings
    fastify.get('/settings/load', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const settings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(user.uid);
        if (!settings) {
            // Return defaults
            return {
                symbol: 'BTCUSDT',
                quoteSize: 0.001,
                adversePct: 0.0002,
                cancelMs: 40,
                maxPos: 0.01,
                minSpreadPct: 0.01,
                maxTradesPerDay: 500,
                enabled: false,
            };
        }
        return {
            symbol: settings.symbol,
            quoteSize: settings.quoteSize,
            adversePct: settings.adversePct,
            cancelMs: settings.cancelMs,
            maxPos: settings.maxPos,
            minSpreadPct: settings.minSpreadPct,
            maxTradesPerDay: settings.maxTradesPerDay,
            enabled: settings.enabled,
        };
    });
    // Update HFT settings
    fastify.post('/settings/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = hftSettingsSchema.parse(request.body);
        try {
            await firestoreAdapter_1.firestoreAdapter.saveHFTSettings(user.uid, body);
            return { message: 'HFT settings updated' };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error updating HFT settings');
            return reply.code(400).send({ error: err.message || 'Error updating HFT settings' });
        }
    });
}
