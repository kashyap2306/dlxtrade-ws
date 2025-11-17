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
exports.ordersRoutes = ordersRoutes;
const zod_1 = require("zod");
const placeOrderSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(['BUY', 'SELL']),
    type: zod_1.z.enum(['LIMIT', 'MARKET']),
    quantity: zod_1.z.number().positive(),
    price: zod_1.z.number().positive().optional(),
});
const listOrdersSchema = zod_1.z.object({
    symbol: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    limit: zod_1.z.coerce.number().int().positive().max(100).optional(),
    offset: zod_1.z.coerce.number().int().nonnegative().optional(),
});
async function ordersRoutes(fastify) {
    fastify.get('/orders', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const filters = listOrdersSchema.parse(request.query);
        const orderManager = (await Promise.resolve().then(() => __importStar(require('../services/userEngineManager')))).userEngineManager.getOrderManager(user.uid);
        if (!orderManager) {
            // Return empty list instead of 400 to avoid frontend error spam before engine starts
            return [];
        }
        const orders = await orderManager.listOrders(user.uid, filters);
        return orders;
    });
    fastify.get('/orders/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const orderManager = (await Promise.resolve().then(() => __importStar(require('../services/userEngineManager')))).userEngineManager.getOrderManager(user.uid);
        if (!orderManager) {
            return reply.code(400).send({ error: 'Engine not initialized. Please start the engine first.' });
        }
        const order = await orderManager.getOrder(user.uid, request.params.id);
        if (!order) {
            return reply.code(404).send({ error: 'Order not found' });
        }
        return order;
    });
    fastify.post('/orders', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = placeOrderSchema.parse(request.body);
        const orderManager = (await Promise.resolve().then(() => __importStar(require('../services/userEngineManager')))).userEngineManager.getOrderManager(user.uid);
        if (!orderManager) {
            return reply.code(400).send({ error: 'Engine not initialized. Please start the engine first.' });
        }
        const order = await orderManager.placeOrder(user.uid, body);
        if (!order) {
            return reply.code(500).send({ error: 'Failed to place order' });
        }
        return order;
    });
    fastify.delete('/orders/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const orderManager = (await Promise.resolve().then(() => __importStar(require('../services/userEngineManager')))).userEngineManager.getOrderManager(user.uid);
        if (!orderManager) {
            return reply.code(400).send({ error: 'Engine not initialized. Please start the engine first.' });
        }
        const order = await orderManager.cancelOrder(user.uid, request.params.id);
        return order;
    });
    fastify.get('/fills', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const filters = {};
        if (request.query.orderId)
            filters.orderId = request.query.orderId;
        if (request.query.symbol)
            filters.symbol = request.query.symbol;
        if (request.query.limit)
            filters.limit = parseInt(request.query.limit, 10);
        if (request.query.offset)
            filters.offset = parseInt(request.query.offset, 10);
        const orderManager = (await Promise.resolve().then(() => __importStar(require('../services/userEngineManager')))).userEngineManager.getOrderManager(user.uid);
        if (!orderManager) {
            return reply.code(400).send({ error: 'Engine not initialized. Please start the engine first.' });
        }
        const fills = await orderManager.listFills(user.uid, filters);
        return fills;
    });
}
