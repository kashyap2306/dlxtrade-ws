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
exports.executionRoutes = executionRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const userEngineManager_1 = require("../services/userEngineManager");
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
const executionQuerySchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().int().positive().max(500).optional().default(100),
});
const closePositionSchema = zod_1.z.object({
    symbol: zod_1.z.string(),
    orderId: zod_1.z.string().optional(),
});
async function executionRoutes(fastify) {
    fastify.get('/logs', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const query = executionQuerySchema.parse(request.query);
        const logs = await firestoreAdapter_1.firestoreAdapter.getExecutionLogs(user.uid, query.limit);
        return logs.map((log) => ({
            id: log.id,
            symbol: log.symbol,
            timestamp: log.timestamp?.toDate().toISOString(),
            action: log.action,
            reason: log.reason,
            accuracy: log.accuracy,
            accuracyUsed: log.accuracyUsed,
            orderId: log.orderId,
            orderIds: log.orderIds,
            executionLatency: log.executionLatency,
            slippage: log.slippage,
            pnl: log.pnl,
            strategy: log.strategy,
            signal: log.signal,
            status: log.status,
            createdAt: log.createdAt?.toDate().toISOString(),
        }));
    });
    fastify.post('/execute', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = zod_1.z.object({
            symbol: zod_1.z.string().min(1),
            signal: zod_1.z.enum(['BUY', 'SELL']),
            entry: zod_1.z.number().positive(),
            size: zod_1.z.number().positive(),
            sl: zod_1.z.number().optional(),
            tp: zod_1.z.number().optional(),
        }).parse(request.body);
        try {
            const engine = userEngineManager_1.userEngineManager.getUserEngine(user.uid);
            if (!engine) {
                return reply.code(400).send({ error: 'Engine not initialized. Please start engine first.' });
            }
            const order = await engine.orderManager.placeOrder(user.uid, {
                symbol: body.symbol,
                side: body.signal,
                type: 'LIMIT',
                quantity: body.size,
                price: body.entry,
            });
            // Log execution
            const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
            await firestoreAdapter_1.firestoreAdapter.saveExecutionLog(user.uid, {
                symbol: body.symbol,
                timestamp: admin.firestore.Timestamp.now(),
                action: 'EXECUTED',
                orderId: order.id,
                accuracy: 1.0, // Manual execution
                accuracyUsed: 1.0,
                strategy: 'manual',
                signal: body.signal,
                status: order.status,
                executionLatency: 0,
            });
            // Save trade
            await firestoreAdapter_1.firestoreAdapter.saveTrade(user.uid, {
                symbol: body.symbol,
                side: body.signal.toLowerCase(),
                qty: body.size,
                entryPrice: body.entry,
                exitPrice: body.tp,
                pnl: body.tp ? (body.signal === 'BUY' ? (body.tp - body.entry) * body.size : (body.entry - body.tp) * body.size) : undefined,
                timestamp: admin.firestore.Timestamp.now(),
                engineType: 'Manual',
                orderId: order.id,
                metadata: {
                    stopLoss: body.sl,
                    takeProfit: body.tp,
                },
            });
            logger_1.logger.info({ uid: user.uid, symbol: body.symbol, signal: body.signal, orderId: order.id }, 'Manual trade executed');
            return {
                success: true,
                order: {
                    id: order.id,
                    symbol: order.symbol,
                    side: order.side,
                    quantity: order.quantity,
                    price: order.price,
                    status: order.status,
                },
            };
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid: user.uid }, 'Error executing manual trade');
            return reply.code(500).send({ error: error.message || 'Trade execution failed' });
        }
    });
    fastify.post('/close', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = closePositionSchema.parse(request.body);
        try {
            const orderManager = userEngineManager_1.userEngineManager.getOrderManager(user.uid);
            if (!orderManager) {
                return reply.code(400).send({ error: 'Engine not initialized' });
            }
            // If orderId provided, cancel that specific order
            if (body.orderId) {
                await orderManager.cancelOrder(user.uid, body.orderId);
                logger_1.logger.info({ uid: user.uid, orderId: body.orderId }, 'Order canceled manually');
                return { message: 'Order canceled', orderId: body.orderId };
            }
            // Otherwise, cancel all pending orders for the symbol
            const orders = await orderManager.listOrders(user.uid, {
                symbol: body.symbol,
                status: 'NEW',
                limit: 100,
            });
            const canceledOrders = [];
            for (const order of orders) {
                try {
                    await orderManager.cancelOrder(user.uid, order.id);
                    canceledOrders.push(order.id);
                }
                catch (err) {
                    logger_1.logger.error({ err, orderId: order.id }, 'Error canceling order');
                }
            }
            logger_1.logger.info({ uid: user.uid, symbol: body.symbol, count: canceledOrders.length }, 'Orders canceled');
            return { message: 'Orders canceled', count: canceledOrders.length, orderIds: canceledOrders };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error closing position');
            return reply.code(400).send({ error: err.message || 'Error closing position' });
        }
    });
}
