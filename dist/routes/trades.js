"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tradesRoutes = tradesRoutes;
const zod_1 = require("zod");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const addTradeSchema = zod_1.z.object({
    symbol: zod_1.z.string().min(1),
    side: zod_1.z.enum(['BUY', 'SELL', 'buy', 'sell']),
    price: zod_1.z.number().positive(),
    quantity: zod_1.z.number().positive(),
    entryPrice: zod_1.z.number().positive().optional(),
    exitPrice: zod_1.z.number().positive().optional(),
    orderId: zod_1.z.string().optional(),
    pnl: zod_1.z.number().optional(),
    strategy: zod_1.z.string().optional(),
    engineType: zod_1.z.enum(['AI', 'HFT', 'Manual']).optional(),
    metadata: zod_1.z.any().optional(),
});
async function tradesRoutes(fastify) {
    // GET /api/trades - Get trades
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const { uid, limit } = request.query;
            // Users can only view their own trades unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            const targetUid = uid || (isAdmin ? undefined : user.uid);
            if (targetUid && targetUid !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const limitNum = limit ? parseInt(limit, 10) : 100;
            const trades = await firestoreAdapter_1.firestoreAdapter.getTrades(targetUid, limitNum);
            return { trades };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting trades');
            return reply.code(500).send({ error: err.message || 'Error fetching trades' });
        }
    });
    // POST /api/trades/add - Add a trade
    fastify.post('/add', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = addTradeSchema.parse(request.body);
            // Convert to PART A schema
            const tradeId = await firestoreAdapter_1.firestoreAdapter.saveTrade(user.uid, {
                symbol: body.symbol,
                side: body.side,
                qty: body.quantity,
                entryPrice: body.price,
                exitPrice: body.price, // Use same as entry if not provided
                pnl: body.pnl || 0,
                engineType: body.strategy === 'HFT' ? 'HFT' : body.strategy === 'AI' ? 'AI' : 'Manual',
                orderId: body.orderId,
                metadata: body.metadata,
            });
            // Log activity with message
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'TRADE_EXECUTED', {
                message: `Trade executed: ${body.side} ${body.quantity} ${body.symbol} at ${body.price}`,
                symbol: body.symbol,
                side: body.side,
                price: body.price,
                quantity: body.quantity,
            });
            // Update user's totalTrades
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
            const currentTrades = userData?.totalTrades || 0;
            await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                totalTrades: currentTrades + 1,
            });
            // Update global stats
            const globalStats = await firestoreAdapter_1.firestoreAdapter.getGlobalStats();
            if (globalStats) {
                await firestoreAdapter_1.firestoreAdapter.updateGlobalStats({
                    totalTrades: (globalStats.totalTrades || 0) + 1,
                });
            }
            return { message: 'Trade saved successfully', tradeId };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error adding trade');
            return reply.code(500).send({ error: err.message || 'Error adding trade' });
        }
    });
}
