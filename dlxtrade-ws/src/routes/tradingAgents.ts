import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

const createTradingAgentSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(50),
  tradingPair: z.enum(['BTC/USDT', 'ETH/USDT']),
  marketType: z.enum(['spot', 'futures'])
});

const tradingAgentSettingsSchema = z.object({
  riskPerTrade: z.number().min(0.1).max(5).optional(),
  maxConcurrentTrades: z.number().min(1).max(2).optional(),
  maxTradesPerDay: z.number().min(1).max(10).optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional()
});

export async function tradingAgentsRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] POST /api/agents/trading-agent-request");
  console.log("[ROUTE READY] GET /api/admin/agents/trading-agent-requests");
  console.log("[ROUTE READY] POST /api/admin/agents/approve-trading-agent");
  console.log("[ROUTE READY] POST /api/admin/agents/reject-trading-agent");
  console.log("[ROUTE READY] GET /api/agents/trading-agents");
  console.log("[ROUTE READY] GET /api/agents/trading-agent/:agentId/control");
  console.log("[ROUTE READY] PUT /api/agents/trading-agent/:agentId/settings");
  console.log("[ROUTE READY] POST /api/agents/trading-agent/:agentId/start");
  console.log("[ROUTE READY] POST /api/agents/trading-agent/:agentId/stop");
  console.log("[ROUTE READY] POST /api/agents/trading-agent/:agentId/pause");
  console.log("[ROUTE READY] POST /api/agents/trading-agent/:agentId/resume");
  console.log("[ROUTE READY] GET /api/agents/trading-agent/:agentId/trades");
  console.log("[ROUTE READY] GET /api/agents/trading-agent/:agentId/performance");

  // Create trading agent request
  fastify.post('/trading-agent-request', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = createTradingAgentSchema.parse(request.body) as {
        userId: string;
        name: string;
        tradingPair: 'BTC/USDT' | 'ETH/USDT';
        marketType: 'spot' | 'futures';
      };

      // Verify user owns this request
      if (body.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      const agentId = await firestoreAdapter.createTradingAgentRequest(body);

      logger.info({ agentId, userId: user.uid }, 'Trading agent request created');
      return { success: true, agentId };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error creating trading agent request');
      return reply.code(500).send({ error: err.message || 'Error creating trading agent request' });
    }
  });

  // Get pending trading agent requests (admin only)
  fastify.get('/admin/trading-agent-requests', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const requests = await firestoreAdapter.getPendingTradingAgentRequests();
      return { requests };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trading agent requests');
      return reply.code(500).send({ error: err.message || 'Error fetching trading agent requests' });
    }
  });

  // Approve trading agent request (admin only)
  fastify.post('/admin/approve-trading-agent', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({ agentId: z.string().min(1) }).parse(request.body);

      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      await firestoreAdapter.approveTradingAgentRequest(body.agentId, user.uid);

      logger.info({ agentId: body.agentId, approvedBy: user.uid }, 'Trading agent request approved');
      return { success: true, message: 'Trading agent request approved' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error approving trading agent request');
      return reply.code(500).send({ error: err.message || 'Error approving trading agent request' });
    }
  });

  // Reject trading agent request (admin only)
  fastify.post('/admin/reject-trading-agent', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({ agentId: z.string().min(1) }).parse(request.body);

      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      await firestoreAdapter.rejectTradingAgentRequest(body.agentId, user.uid);

      logger.info({ agentId: body.agentId, rejectedBy: user.uid }, 'Trading agent request rejected');
      return { success: true, message: 'Trading agent request rejected' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error rejecting trading agent request');
      return reply.code(500).send({ error: err.message || 'Error rejecting trading agent request' });
    }
  });

  // Get user's trading agents
  fastify.get('/trading-agents', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const agents = await firestoreAdapter.getUserTradingAgents(user.uid);
      return { agents };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user trading agents');
      return reply.code(500).send({ error: err.message || 'Error fetching trading agents' });
    }
  });

  // Get trading agent control data
  fastify.get('/trading-agent/:agentId/control', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      // Get agent config
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent) {
        return reply.code(404).send({ error: 'Trading agent not found' });
      }

      // Verify ownership
      if (agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      // Get recent trades
      const trades = await firestoreAdapter.getAgentTrades(agentId, 20);

      // Get performance data
      const totalTrades = agent.totalTrades || 0;
      const winningTrades = agent.winningTrades || 0;
      const losingTrades = agent.losingTrades || 0;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      return {
        agent,
        control: {
          status: agent.status,
          lastTradeAt: agent.lastTradeAt,
          dailyTrades: agent.dailyTrades || 0,
          consecutiveLosses: agent.consecutiveLosses || 0,
          dailyPnL: agent.dailyPnL || 0
        },
        performance: {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate,
          totalPnL: agent.totalPnL || 0,
          drawdown: agent.drawdown || 0
        },
        trades
      };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent control');
      return reply.code(500).send({ error: err.message || 'Error fetching trading agent control' });
    }
  });

  // Update trading agent settings
  fastify.put('/trading-agent/:agentId/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;
      const settings = tradingAgentSettingsSchema.parse(request.body);

      // Verify ownership
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      await firestoreAdapter.updateAgentConfig(agentId, settings);

      logger.info({ agentId, userId: user.uid }, 'Trading agent settings updated');
      return { success: true, message: 'Settings updated successfully' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err, agentId: request.params.agentId }, 'Error updating trading agent settings');
      return reply.code(500).send({ error: err.message || 'Error updating settings' });
    }
  });

  // Start trading agent
  fastify.post('/trading-agent/:agentId/start', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      // Verify ownership and status
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      if (agent.status !== 'PAUSED' && agent.status !== 'STOPPED') {
        return reply.code(400).send({ error: 'Agent is not in a pausable state' });
      }

      await firestoreAdapter.updateAgentStatus(agentId, 'ACTIVE');

      logger.info({ agentId, userId: user.uid }, 'Trading agent started');
      return { success: true, message: 'Trading agent started successfully' };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error starting trading agent');
      return reply.code(500).send({ error: err.message || 'Error starting trading agent' });
    }
  });

  // Stop trading agent
  fastify.post('/trading-agent/:agentId/stop', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      // Verify ownership
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      await firestoreAdapter.updateAgentStatus(agentId, 'STOPPED');

      logger.info({ agentId, userId: user.uid }, 'Trading agent stopped');
      return { success: true, message: 'Trading agent stopped successfully' };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error stopping trading agent');
      return reply.code(500).send({ error: err.message || 'Error stopping trading agent' });
    }
  });

  // Pause trading agent
  fastify.post('/trading-agent/:agentId/pause', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      // Verify ownership
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      if (agent.status !== 'ACTIVE') {
        return reply.code(400).send({ error: 'Agent is not active' });
      }

      await firestoreAdapter.updateAgentStatus(agentId, 'PAUSED');

      logger.info({ agentId, userId: user.uid }, 'Trading agent paused');
      return { success: true, message: 'Trading agent paused successfully' };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error pausing trading agent');
      return reply.code(500).send({ error: err.message || 'Error pausing trading agent' });
    }
  });

  // Resume trading agent
  fastify.post('/trading-agent/:agentId/resume', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      // Verify ownership
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      if (agent.status !== 'PAUSED') {
        return reply.code(400).send({ error: 'Agent is not paused' });
      }

      await firestoreAdapter.updateAgentStatus(agentId, 'ACTIVE');

      logger.info({ agentId, userId: user.uid }, 'Trading agent resumed');
      return { success: true, message: 'Trading agent resumed successfully' };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error resuming trading agent');
      return reply.code(500).send({ error: err.message || 'Error resuming trading agent' });
    }
  });

  // Get trading agent trades
  fastify.get('/trading-agent/:agentId/trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;
      const limit = request.query.limit ? parseInt(request.query.limit) : 50;

      // Verify ownership
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      const trades = await firestoreAdapter.getAgentTrades(agentId, limit);
      return { trades };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent trades');
      return reply.code(500).send({ error: err.message || 'Error fetching trades' });
    }
  });

  // Get trading agent performance
  fastify.get('/trading-agent/:agentId/performance', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      // Verify ownership
      const agent = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agent || agent.userId !== user.uid) {
        return reply.code(403).send({ error: 'Unauthorized' });
      }

      const performance = {
        totalTrades: agent.totalTrades || 0,
        winningTrades: agent.winningTrades || 0,
        losingTrades: agent.losingTrades || 0,
        winRate: agent.totalTrades > 0 ? (agent.winningTrades / agent.totalTrades) * 100 : 0,
        totalPnL: agent.totalPnL || 0,
        dailyPnL: agent.dailyPnL || 0,
        drawdown: agent.drawdown || 0,
        lastTradeAt: agent.lastTradeAt,
        dailyTrades: agent.dailyTrades || 0,
        consecutiveLosses: agent.consecutiveLosses || 0
      };

      return { performance };
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent performance');
      return reply.code(500).send({ error: err.message || 'Error fetching performance' });
    }
  });
}