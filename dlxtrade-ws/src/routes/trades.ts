import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

const addTradeSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL', 'buy', 'sell']),
  price: z.number().positive(),
  quantity: z.number().positive(),
  entryPrice: z.number().positive().optional(),
  exitPrice: z.number().positive().optional(),
  orderId: z.string().optional(),
  pnl: z.number().optional(),
  strategy: z.string().optional(),
  engineType: z.enum(['AI', 'HFT', 'Manual']).optional(),
  metadata: z.any().optional(),
});

export async function tradesRoutes(fastify: FastifyInstance) {
  // GET /api/trades - Get trades
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { uid?: string; limit?: string } }>, reply: FastifyReply) => {
    console.log('GET /api/trades called');
    try {
      const user = (request as any).user;
      const { uid, limit } = request.query;
      
      // Users can only view their own trades unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      const targetUid = uid || (isAdmin ? undefined : user.uid);
      
      if (targetUid && targetUid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const limitNum = limit ? parseInt(limit, 10) : 100;
      const trades = await firestoreAdapter.getTrades(targetUid, limitNum);
      
      return { trades };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trades');
      return reply.code(500).send({ error: err.message || 'Error fetching trades' });
    }
  });

  // POST /api/trades/add - Add a trade
  fastify.post('/add', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = addTradeSchema.parse(request.body);

      // Convert to PART A schema
      const tradeId = await firestoreAdapter.saveTrade(user.uid, {
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
      await firestoreAdapter.logActivity(user.uid, 'TRADE_EXECUTED', {
        message: `Trade executed: ${body.side} ${body.quantity} ${body.symbol} at ${body.price}`,
        symbol: body.symbol,
        side: body.side,
        price: body.price,
        quantity: body.quantity,
      });

      // Update user's totalTrades
      const userData = await firestoreAdapter.getUser(user.uid);
      const currentTrades = userData?.totalTrades || 0;
      await firestoreAdapter.createOrUpdateUser(user.uid, {
        totalTrades: currentTrades + 1,
      });

      // Update global stats
      const globalStats = await firestoreAdapter.getGlobalStats();
      if (globalStats) {
        await firestoreAdapter.updateGlobalStats({
          totalTrades: (globalStats.totalTrades || 0) + 1,
        });
      }

      return { message: 'Trade saved successfully', tradeId };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error adding trade');
      return reply.code(500).send({ error: err.message || 'Error adding trade' });
    }
  });
}

