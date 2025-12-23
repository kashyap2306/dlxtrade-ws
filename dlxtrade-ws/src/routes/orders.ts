import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { orderManager } from '../services/orderManager';
import { ValidationError } from '../utils/errors';

const placeOrderSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  type: z.enum(['LIMIT', 'MARKET']),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
});

const listOrdersSchema = z.object({
  symbol: z.string().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

type ListOrdersQuery = {
  symbol?: string;
  status?: string;
  limit?: number;
  offset?: number;
};

type FillsQuery = {
  orderId?: string;
  symbol?: string;
  limit?: string;
  offset?: string;
};

type PlaceOrder = {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  quantity: number;
  price?: number;
};

export async function ordersRoutes(fastify: FastifyInstance) {
  fastify.get('/orders', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: ListOrdersQuery }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const filters = listOrdersSchema.parse(request.query);
    const orderManager = (await import('../services/userEngineManager')).userEngineManager.getOrderManager(user.uid);
    if (!orderManager) {
      // Return empty list instead of 400 to avoid frontend error spam before engine starts
      return [];
    }
    const orders = await orderManager.listOrders(user.uid, filters);
    return orders;
  });

  fastify.get('/orders/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const orderManager = (await import('../services/userEngineManager')).userEngineManager.getOrderManager(user.uid);
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
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = placeOrderSchema.parse(request.body) as PlaceOrder;
    const orderManager = (await import('../services/userEngineManager')).userEngineManager.getOrderManager(user.uid);
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
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const orderManager = (await import('../services/userEngineManager')).userEngineManager.getOrderManager(user.uid);
    if (!orderManager) {
      return reply.code(400).send({ error: 'Engine not initialized. Please start the engine first.' });
    }
    const order = await orderManager.cancelOrder(user.uid, request.params.id);
    return order;
  });

  fastify.get('/fills', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: FillsQuery }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const filters: any = {};
    if (request.query.orderId) filters.orderId = request.query.orderId;
    if (request.query.symbol) filters.symbol = request.query.symbol;
    if (request.query.limit) filters.limit = parseInt(request.query.limit, 10);
    if (request.query.offset) filters.offset = parseInt(request.query.offset, 10);

    const orderManager = (await import('../services/userEngineManager')).userEngineManager.getOrderManager(user.uid);
    if (!orderManager) {
      return reply.code(400).send({ error: 'Engine not initialized. Please start the engine first.' });
    }
    const fills = await orderManager.listFills(user.uid, filters);
    return fills;
  });
}

