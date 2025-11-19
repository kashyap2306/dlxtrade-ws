import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { userEngineManager } from '../services/userEngineManager';
import { z } from 'zod';
import { logger } from '../utils/logger';

const executionQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

const closePositionSchema = z.object({
  symbol: z.string(),
  orderId: z.string().optional(),
});

export async function executionRoutes(fastify: FastifyInstance) {
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user || !user.uid) {
        return reply.code(401).send({ error: 'Unauthorized', logs: [] });
      }

      const query = executionQuerySchema.parse(request.query);
      const safeLimit = Math.min(Math.max(1, query.limit), 1000);
      
      let logs: any[] = [];
      try {
        logs = await firestoreAdapter.getExecutionLogs(user.uid, safeLimit);
      } catch (logErr: any) {
        logger.error({ err: logErr, uid: user.uid }, 'Error fetching execution logs, returning empty array');
        logs = [];
      }
      
      // Map logs with proper null checks and ensure all fields are defined
      const mappedLogs = logs.map((log: any) => {
        const mapped: any = {
          id: log.id || '',
          symbol: log.symbol || '',
          timestamp: log.timestamp?.toDate?.()?.toISOString() || log.timestamp || new Date().toISOString(),
          action: log.action || 'UNKNOWN',
          reason: log.reason || null,
          accuracy: log.accuracy ?? null,
          accuracyUsed: log.accuracyUsed ?? null,
          orderId: log.orderId || null,
          orderIds: log.orderIds || null,
          executionLatency: log.executionLatency ?? null,
          slippage: log.slippage ?? null,
          pnl: log.pnl ?? null,
          strategy: log.strategy || null,
          signal: log.signal || null,
          status: log.status || null,
          createdAt: log.createdAt?.toDate?.()?.toISOString() || log.createdAt || new Date().toISOString(),
        };
        
        // Remove null orderIds array if empty
        if (mapped.orderIds === null || (Array.isArray(mapped.orderIds) && mapped.orderIds.length === 0)) {
          delete mapped.orderIds;
        }
        
        return mapped;
      }).filter((log: any) => log.id); // Remove any invalid entries
      
      return mappedLogs;
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error getting execution logs');
      // Always return valid JSON structure even on error
      return reply.code(200).send({ 
        logs: [],
        error: err.message || 'Error fetching execution logs' 
      });
    }
  });

  fastify.post('/execute', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ 
    Body: { 
      symbol: string; 
      signal: 'BUY' | 'SELL'; 
      entry: number; 
      size: number; 
      sl?: number; 
      tp?: number;
    } 
  }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = z.object({
      symbol: z.string().min(1),
      signal: z.enum(['BUY', 'SELL']),
      entry: z.number().positive(),
      size: z.number().positive(),
      sl: z.number().optional(),
      tp: z.number().optional(),
    }).parse(request.body);

    try {
      const engine = userEngineManager.getUserEngine(user.uid);
      
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
      const admin = await import('firebase-admin');
      await firestoreAdapter.saveExecutionLog(user.uid, {
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
      await firestoreAdapter.saveTrade(user.uid, {
        symbol: body.symbol,
        side: body.signal.toLowerCase() as 'buy' | 'sell',
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

      logger.info({ uid: user.uid, symbol: body.symbol, signal: body.signal, orderId: order.id }, 'Manual trade executed');

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
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error executing manual trade');
      return reply.code(500).send({ error: error.message || 'Trade execution failed' });
    }
  });

  fastify.post('/close', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = closePositionSchema.parse(request.body);
    
    try {
      const orderManager = userEngineManager.getOrderManager(user.uid);
      if (!orderManager) {
        return reply.code(400).send({ error: 'Engine not initialized' });
      }

      // If orderId provided, cancel that specific order
      if (body.orderId) {
        await orderManager.cancelOrder(user.uid, body.orderId);
        logger.info({ uid: user.uid, orderId: body.orderId }, 'Order canceled manually');
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
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'Error canceling order');
        }
      }

      logger.info({ uid: user.uid, symbol: body.symbol, count: canceledOrders.length }, 'Orders canceled');
      return { message: 'Orders canceled', count: canceledOrders.length, orderIds: canceledOrders };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error closing position');
      return reply.code(400).send({ error: err.message || 'Error closing position' });
    }
  });
}

