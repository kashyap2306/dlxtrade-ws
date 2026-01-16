import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AgentApprovalService } from '../services/agentApprovalService';
import { CrowdConsensusService } from '../services/crowdConsensusService';
import { CrowdConsensusScheduler } from '../services/crowdConsensusScheduler';
import { vwapRuntimeService } from '../services/vwapRuntimeService';
import { logger } from '../utils/logger';
import { agentAccessMiddleware } from '../middleware/agentAuth';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { decrypt } from '../services/keyManager';

const unlockAgentSchema = z.object({
  agentName: z.string().min(1),
});

export async function agentsRoutes(fastify: FastifyInstance) {
  console.log("[AGENTS ROUTES] Registering agents routes at", new Date().toISOString());
  console.log("[ROUTE READY] POST /api/agents/unlock");
  console.log("[ROUTE READY] GET /api/agents/unlocks");
  console.log("[ROUTE READY] GET /api/agents/unlocked");
  console.log("[ROUTE READY] POST /api/agents/submit-unlock-request");
  console.log("[ROUTE READY] PUT /api/agents/:agentId/settings");
  console.log("[ROUTE READY] GET /api/users/:uid/agents");
  console.log("[ROUTE READY] POST /api/agents/purchase-request");
  console.log("[ROUTE READY] GET /api/admin/agents/purchase-requests");
  console.log("[ROUTE READY] POST /api/admin/agents/approve");
  console.log("[ROUTE READY] GET /api/users/:uid/features");

  const selectLiquiditySweepAgent = (userAgents: any[]) => {
    const agents = Array.isArray(userAgents) ? userAgents : [];
    const primary = agents.find((a: any) => String(a?.name || '').toLowerCase().includes('liquidity sweep'));
    if (primary) return primary;
    const fallback = agents.find((a: any) => String(a?.name || '').toLowerCase().includes('liquidity'));
    return fallback || null;
  };

  // GET /api/agents - Get user's available agents
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user?.uid) {
        return reply.code(200).send({ agents: [] });
      }

      const agents = await AgentApprovalService.getAllAgents();
      return reply.code(200).send({ agents: Array.isArray(agents) ? agents : [] });
    } catch (err: any) {
      logger.error({ err }, 'Error getting user agents');
      return reply.code(200).send({ agents: [] });
    }
  });

  fastify.get('/crowd-consensus/diagnostics', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const parsedLimit = request.query.limit ? parseInt(request.query.limit, 10) : 5;
      const limit = Number.isFinite(parsedLimit) ? parsedLimit : 5;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const [settings, exchangeStatus, dailyTradeCount, recentTrades, recentSkippedTrades] = await Promise.all([
        CrowdConsensusService.getUserSettings(uid),
        CrowdConsensusService.getExchangeConnectionStatus(uid),
        CrowdConsensusService.getDailyTradeCount(uid),
        CrowdConsensusService.getUserTrades(uid, limit),
        CrowdConsensusService.getSkippedTrades(uid, limit),
      ]);

      const dailyTradeLimit = 6;
      const autoTradeEnabled = settings?.autoTradeEnabled === true;
      let gate = 'READY';
      let message = 'Ready for consensus scan.';

      if (!autoTradeEnabled) {
        gate = 'AUTO_TRADE_DISABLED';
        message = 'Auto trade is disabled.';
      } else if (!exchangeStatus.connected) {
        gate = 'EXCHANGE_NOT_CONNECTED';
        message = exchangeStatus.message || 'Exchange not connected.';
      } else if (dailyTradeCount >= dailyTradeLimit) {
        gate = 'DAILY_LIMIT_REACHED';
        message = 'Daily trade limit reached.';
      }

      return {
        scheduler: CrowdConsensusScheduler.getStatus(),
        status: {
          gate,
          message,
          autoTradeEnabled,
          dailyTradeCount,
          dailyTradeLimit,
          exchangeStatus,
          selectedAutoTradeExchange: settings?.selectedAutoTradeExchange || null,
          dryRun: settings?.dryRun || false,
          lastUpdated: settings?.lastUpdated || null,
        },
        recentTrades,
        recentSkippedTrades,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus diagnostics');
      return reply.code(500).send({ error: err.message || 'Error fetching diagnostics' });
    }
  });

  fastify.get('/crowd-consensus/dashboard', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const signals = await CrowdConsensusService.getUserSignals(uid, 20);

      return {
        signals,
        stats: {
          totalSignals: signals.length,
        },
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus dashboard');
      return reply.code(500).send({ error: err.message || 'Error fetching dashboard data' });
    }
  });

  fastify.get('/crowd-consensus/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const settings = await CrowdConsensusService.getUserSettings(uid);
      const isActive = settings.autoTradeEnabled === true;

      return {
        autoTradeEnabled: isActive,
        status: isActive ? 'ACTIVE' : 'INACTIVE',
        lastUpdated: settings.lastUpdated || null
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus status');
      return reply.code(500).send({ error: err.message || 'Error fetching status' });
    }
  });

  fastify.post('/crowd-consensus/start', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
      if (!exchangeStatus.connected) {
        return reply.code(400).send({
          error: 'Exchange not connected. Please connect an exchange in Settings first.',
          exchangeStatus,
        });
      }

      await CrowdConsensusService.setAutoTradeEnabled(uid, true);

      return {
        success: true,
        message: 'Crowd consensus auto trading started successfully',
        status: 'ACTIVE',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error starting crowd consensus auto trade');
      return reply.code(500).send({ error: err.message || 'Error starting auto trade' });
    }
  });

  fastify.post('/crowd-consensus/stop', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      await CrowdConsensusService.setAutoTradeEnabled(uid, false);

      return {
        success: true,
        message: 'Crowd consensus auto trading stopped successfully',
        status: 'INACTIVE',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error stopping crowd consensus auto trade');
      return reply.code(500).send({ error: err.message || 'Error stopping auto trade' });
    }
  });

  fastify.get('/crowd-consensus/exchange-status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);
      return { exchangeStatus };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus exchange status');
      return reply.code(500).send({ error: err.message || 'Error fetching exchange status' });
    }
  });

  fastify.get('/crowd-consensus/signals', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const parsedLimit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const signals = await CrowdConsensusService.getUserSignals(uid, limit);
      return { signals };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error getting crowd consensus signals');
      return reply.code(500).send({ error: err.message || 'Error fetching signals' });
    }
  });

  fastify.get('/crowd-consensus/trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const parsedLimit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const trades = await CrowdConsensusService.getUserTrades(uid, limit);
      return { trades };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error getting crowd consensus trades');
      return reply.code(500).send({ error: err.message || 'Error fetching trades' });
    }
  });

  fastify.get('/crowd-consensus/skipped-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const parsedLimit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const skippedTrades = await CrowdConsensusService.getSkippedTrades(uid, limit);
      return { skippedTrades };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus skipped trades');
      return reply.code(500).send({ error: err.message || 'Error fetching skipped trades' });
    }
  });

  fastify.get('/crowd-consensus/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const settings = await CrowdConsensusService.getUserSettings(uid);
      return { settings };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus settings');
      return reply.code(500).send({ error: err.message || 'Error fetching settings' });
    }
  });

  fastify.put('/crowd-consensus/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const settingsSchema = z.object({
        autoTradeEnabled: z.boolean().optional(),
        selectedAutoTradeExchange: z.string().optional(),
        riskPercent: z.number().min(0.1).max(10).optional(),
        stopLossPercent: z.number().min(0.1).max(20).optional(),
        takeProfitPercent: z.number().min(0.1).max(50).optional(),
        leverage: z.number().min(1).max(100).optional(),
        maxDailyLossPercent: z.number().min(1).max(20).optional(),
      });

      const validatedSettings = settingsSchema.parse(request.body);
      await CrowdConsensusService.saveUserSettings(uid, validatedSettings);

      return { message: 'Settings updated successfully' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid settings', details: err.errors });
      }
      logger.error({ err }, 'Error updating crowd consensus settings');
      return reply.code(500).send({ error: err.message || 'Error updating settings' });
    }
  });

  // DISABLED: POST /api/agents/unlock - Legacy route, use /api/admin/agents/assign instead
  /*
  fastify.post('/unlock', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // LEGACY ROUTE - DISABLED
    return reply.code(410).send({ error: 'This endpoint has been deprecated. Use admin assignment instead.' });
  });
  */

  // DISABLED: GET /api/agents/unlocks - Legacy route, use /api/agents/my-approved instead
  /*
  fastify.get('/unlocks', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // LEGACY ROUTE - DISABLED
    return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/my-approved instead.' });
  });
  */

  // DISABLED: GET /api/agents/unlocked - Legacy route, use /api/agents/my-approved instead
  /*
  fastify.get('/unlocked', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // LEGACY ROUTE - DISABLED
    return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/my-approved instead.' });
  });
  */

  // PUT /api/agents/:agentId/settings - Update agent settings for user
  fastify.put('/:agentId/settings', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Body: any }>, reply: FastifyReply) => {
    try {
      return reply.code(410).send({ error: 'This endpoint has been deprecated.' });
    } catch (err: any) {
      logger.error({ err }, 'Error updating agent settings');
      return reply.code(410).send({ error: 'This endpoint has been deprecated.' });
    }
  });

  // Get agent diagnostics
  fastify.get('/:agentId/diagnostics', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const { agentId } = request.params;
      const limit = request.query.limit ? parseInt(request.query.limit) : 20;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Trading Agent diagnostics
      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE') || userAgents[0];
        if (!activeAgent?.id) {
          return { diagnostics: [] };
        }

        const { TradingAgent } = await import('../services/tradingAgent');
        const diagnostics = await TradingAgent.getDiagnostics(activeAgent.id, limit);
        return { diagnostics };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent?.id) {
          return { diagnostics: [] };
        }

        const { TradingAgent } = await import('../services/tradingAgent');
        const diagnostics = await TradingAgent.getDiagnostics(targetAgent.id, limit);
        return { diagnostics };
      }

      // VWAP Strategy diagnostics (uses user-scoped runtime agent id)
      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        const { TradingAgent } = await import('../services/tradingAgent');
        const diagnostics = await TradingAgent.getDiagnostics(`vwap_${uid}`, limit);
        let scheduler: any = null;
        try {
          const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');
          scheduler = tradingAgentScheduler.getStatus();
        } catch {
          scheduler = null;
        }

        const runtimeState = vwapRuntimeService.getAgentState(uid);
        return {
          diagnostics,
          scheduler,
          runtime: {
            status: runtimeState?.status || 'STOPPED',
            stoppedReason: runtimeState?.stoppedReason || null,
            stoppedForDayKey: runtimeState?.stoppedForDayKey || null,
            lastHeartbeat: runtimeState?.lastHeartbeat || null,
            dayKey: runtimeState?.dayKey || null,
          }
        };
      }

      return reply.code(410).send({ error: 'This endpoint has been deprecated.' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting agent diagnostics');
      return reply.code(500).send({ error: 'Error fetching diagnostics' });
    }
  });


  // DISABLED: POST /api/agents/purchase-request - Legacy route, use /api/agents/request instead
  /*
  fastify.post('/purchase-request', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { agentId: string; agentName: string; userName: string; email: string; phoneNumber: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        agentId: z.string().min(1),
        agentName: z.string().min(1),
        userName: z.string().min(1),
        email: z.string().email(),
        phoneNumber: z.string().min(1),
      }).parse(request.body);

      // Create purchase request
      const requestId = await firestoreAdapter.createAgentPurchaseRequest({
        uid: user.uid,
        agentId: body.agentId,
        agentName: body.agentName,
        userName: body.userName,
        email: body.email,
        phoneNumber: body.phoneNumber,
        status: 'pending',
      });

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'AGENT_PURCHASE_REQUEST_CREATED', {
        agentId: body.agentId,
        agentName: body.agentName,
        requestId,
      });

      logger.info({ uid: user.uid, agentId: body.agentId, requestId }, 'Agent purchase request created');
      return {
        success: true,
        message: 'Purchase request submitted successfully',
        requestId,
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error creating purchase request');
      return reply.code(500).send({ error: err.message || 'Error creating purchase request' });
    }
  });
  */

  // DISABLED: GET /api/admin/agents/purchase-requests - Legacy route, use /api/admin/agents/requests instead
  /*
  fastify.get('/admin/purchase-requests', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }
      const { status } = request.query;
      let purchaseRequests = await firestoreAdapter.getAgentPurchaseRequests();

      // Filter by status if provided
      if (status) {
        purchaseRequests = purchaseRequests.filter(req => req.status === status);
      }

      return { purchaseRequests };
    } catch (err: any) {
      logger.error({ err }, 'Error getting purchase requests');
      return reply.code(500).send({ error: err.message || 'Error fetching purchase requests' });
    }
  });
  */

  // GET /api/users/:uid/features - Get user's enabled features (HARDENED: 200ms timeout)
  fastify.get('/users/:uid/features', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;
    const { uid } = request.params;

    if (!user?.uid) {
      logger.warn({}, 'GET /users/:uid/features - missing uid, returning safe default');
      return reply.send({ features: {} });
    }

    logger.info({ uid, duration: Date.now() - startTime }, 'GET /users/:uid/features returning safe default');
    return reply.send({ features: {} });
  });

  // ===== AGENT APPROVAL SYSTEM ROUTES =====

  console.log("[ROUTE READY] GET /api/agents/available");
  console.log("[ROUTE READY] POST /api/agents/request");
  console.log("[ROUTE READY] GET /api/agents/my-requests");
  console.log("[ROUTE READY] GET /api/agents/my-approved");

  // GET /api/agents/available - Get all available agents
  fastify.get('/available', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agents = await AgentApprovalService.getAllAgents();
      return reply.code(200).send({ agents: Array.isArray(agents) ? agents : [] });
    } catch (err: any) {
      logger.error({ err }, 'Error getting available agents');
      return reply.code(200).send({ agents: [] });
    }
  });

  // POST /api/agents/request - Firebase-only
  fastify.post('/request', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ source: 'firebase_only', status: 'handled_in_firestore' });
  });

  // GET /api/agents/my-requests - Firebase-only
  fastify.get('/my-requests', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ source: 'firebase_only', status: 'handled_in_firestore' });
  });


  // GET /api/agents/my-approved - Firebase-only
  fastify.get('/my-approved', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({ source: 'firebase_only', status: 'handled_in_firestore' });
  });

  // GET /api/agents/:id - Get agent by ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/available.' });
  });


  // ===== TRADING AGENT ROUTES =====

  console.log("[ROUTE READY] POST /api/agents/trading-agent-request");
  console.log("[ROUTE READY] GET /api/admin/agents/trading-agent-requests");
  console.log("[ROUTE READY] POST /api/admin/agents/approve-trading-agent");
  console.log("[ROUTE READY] POST /api/admin/agents/reject-trading-agent");
  console.log("[ROUTE READY] GET /api/agents/trading-agents");
  console.log("[ROUTE READY] GET /api/agents/:agentId/control");
  console.log("[ROUTE READY] PUT /api/agents/:agentId/settings");
  console.log("[ROUTE READY] POST /api/agents/:agentId/start");
  console.log("[ROUTE READY] POST /api/agents/:agentId/stop");
  console.log("[ROUTE READY] POST /api/agents/:agentId/pause");
  console.log("[ROUTE READY] POST /api/agents/:agentId/resume");
  console.log("[ROUTE READY] GET /api/agents/:agentId/trades");
  console.log("[ROUTE READY] GET /api/agents/:agentId/performance");

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

  // DISABLED: Create trading agent request - Legacy route, use /api/agents/request instead
  /*
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

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'TRADING_AGENT_REQUEST_CREATED', {
        agentId,
        name: body.name,
        tradingPair: body.tradingPair,
        marketType: body.marketType,
      });

      logger.info({ agentId, userId: user.uid }, 'Trading agent request created');
      return {
        success: true,
        message: 'Trading agent request submitted successfully',
        agentId,
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error creating trading agent request');
      return reply.code(500).send({ error: err.message || 'Error creating trading agent request' });
    }
  });
  */

  // DISABLED: Get pending trading agent requests - Legacy route, use /api/admin/agents/requests instead
  /*
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
  */

  // DISABLED: Approve trading agent request - Legacy route, use /api/admin/agents/approve instead
  /*
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
  */

  // DISABLED: Reject trading agent request - Legacy route, use /api/admin/agents/reject instead
  /*
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
  */

  // DISABLED: Get user's trading agents - Legacy route, use /api/agents/my-approved instead
  /*
  fastify.get('/trading-agents', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const agents = await firestoreAdapter.getUserTradingAgents(user.uid);
      return { agents: agents || [] }; // Always return array, never null
    } catch (err: any) {
      logger.error({ err }, 'Error getting user trading agents');
      // Return empty array on error instead of 500
      return { agents: [] };
    }
  });
  */

  // Get trading agent control data
  fastify.get('/:agentId/control', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      let { agentId } = request.params;

      console.log('TRADING AGENT CONTROL ROUTE HIT:', { agentId, uid });

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = userAgents.find((agent: any) => agent.status === 'ACTIVE') || userAgents[0];

        if (!activeAgent) {
          return {
            agentId: 'trading-agent',
            status: 'STOPPED',
            config: null,
          };
        }

        return {
          agentId: 'trading-agent',
          status: activeAgent.status || 'STOPPED',
          config: activeAgent || null,
        };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = selectLiquiditySweepAgent(userAgents);

        if (!activeAgent) {
          return {
            agentId: 'liquidity_sniper_arbitrage',
            status: 'STOPPED',
            config: null,
          };
        }

        return {
          agentId: 'liquidity_sniper_arbitrage',
          status: activeAgent.status || 'STOPPED',
          config: activeAgent || null,
        };
      }

      // Check if agentId is a special route (vwap-strategy)
      if (agentId === 'vwap-strategy') {
        // Access control: users/{uid}.approvedAgents ONLY (via AgentApprovalService)
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        // Get runtime state from VWAP runtime service
        const runtimeState = vwapRuntimeService.getAgentState(uid);
        const status = runtimeState?.status || 'STOPPED';

        return {
          agentId: 'vwap-strategy',
          status: status,
          stoppedReason: runtimeState?.stoppedReason || null,
          config: {
            name: 'VWAP Strategy',
            strategyType: 'VWAP_MEAN_REVERSION',
            tradingPair: 'BTC/USDT',
            marketType: 'futures'
          },
        };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent control');
      return reply.code(500).send({ error: 'Error getting agent control' });
    }
  });

  // Get agent status (slug-only agentId)
  fastify.get('/:agentId/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const { agentId } = request.params;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        const runtimeState = vwapRuntimeService.getAgentState(uid);
        return {
          agentId: 'vwap-strategy',
          status: runtimeState?.status || 'STOPPED',
          stoppedReason: runtimeState?.stoppedReason || null,
        };
      }

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = userAgents.find((agent: any) => agent.status === 'ACTIVE') || userAgents[0];
        return {
          agentId: 'trading-agent',
          status: activeAgent?.status || 'STOPPED',
        };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = selectLiquiditySweepAgent(userAgents);
        return {
          agentId: 'liquidity_sniper_arbitrage',
          status: activeAgent?.status || 'STOPPED',
        };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting agent status');
      return reply.code(500).send({ error: 'Error getting agent status' });
    }
  });

  // Start trading agent
  fastify.post('/:agentId/start', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      let { agentId } = request.params;

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Trading Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');
        return { success: true, message: 'Trading Agent started successfully' };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Liquidity Sweep Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');
        return { success: true, message: 'Liquidity Sweep Agent started successfully' };
      }

      // Handle VWAP Strategy agents
      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        const existingRuntime = vwapRuntimeService.getAgentState(user.uid);
        const todayKey = new Date().toISOString().slice(0, 10);
        if (existingRuntime?.stoppedForDayKey === todayKey) {
          return reply.code(400).send({
            error: 'VWAP Strategy is stopped for today',
            reason: existingRuntime?.stoppedReason || 'STOPPED_FOR_DAY',
          });
        }

        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
        if (!exchangeConfig) {
          return reply.code(400).send({ error: 'No exchange configuration found. Please connect your exchange in Settings.' });
        }

        const exchange = exchangeConfig.exchange;
        if (!exchange) {
          return reply.code(400).send({ error: 'Invalid exchange configuration. Please reconnect your exchange in Settings.' });
        }

        const apiKey = decrypt(exchangeConfig.apiKeyEncrypted, 'user_request');
        const secret = decrypt(exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted, 'user_request');
        const passphrase = exchangeConfig.passphraseEncrypted ? decrypt(exchangeConfig.passphraseEncrypted, 'user_request') : undefined;

        if (!apiKey || !secret) {
          return reply.code(400).send({ error: 'Exchange key decryption failed. Please reconnect your exchange in Settings.' });
        }

        vwapRuntimeService.setAgentCredentials(user.uid, exchange, {
          apiKey,
          secret,
          passphrase: passphrase || undefined,
          testnet: exchangeConfig.testnet ?? false,
        });

        // Start VWAP Strategy using runtime service
        const runtimeState = vwapRuntimeService.startAgent(user.uid);
        return { success: true, message: 'VWAP Strategy started successfully' };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error starting trading agent');
      return reply.code(500).send({ error: 'Error starting agent' });
    }
  });

  // Stop trading agent
  fastify.post('/:agentId/stop', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      let { agentId } = request.params;

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Trading Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'STOPPED');
        return { success: true, message: 'Trading Agent stopped successfully' };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Liquidity Sweep Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'STOPPED');
        return { success: true, message: 'Liquidity Sweep Agent stopped successfully' };
      }

      // Handle VWAP Strategy agents
      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        // Stop VWAP Strategy using runtime service
        const runtimeState = vwapRuntimeService.stopAgent(user.uid);
        return { success: true, message: 'VWAP Strategy stopped successfully' };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error stopping trading agent');
      return reply.code(500).send({ error: 'Error stopping agent' });
    }
  });

  // Pause trading agent
  fastify.post('/:agentId/pause', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      let { agentId } = request.params;

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Trading Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'PAUSED');
        return { success: true, message: 'Trading Agent paused successfully' };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Liquidity Sweep Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'PAUSED');
        return { success: true, message: 'Liquidity Sweep Agent paused successfully' };
      }
      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error pausing trading agent');
      return reply.code(500).send({ error: 'Error pausing agent' });
    }
  });

  // Resume trading agent
  fastify.post('/:agentId/resume', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      let { agentId } = request.params;

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'PAUSED');
        const targetAgent = activeAgent || userAgents[0];
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Trading Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');
        return { success: true, message: 'Trading Agent resumed successfully' };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent?.id) {
          return reply.code(400).send({ error: 'No Liquidity Sweep Agent configured for this user' });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');
        return { success: true, message: 'Liquidity Sweep Agent resumed successfully' };
      }
      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error resuming trading agent');
      return reply.code(500).send({ error: 'Error resuming agent' });
    }
  });

  // Get trading agent trades
  fastify.get('/:agentId/trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      let { agentId } = request.params;
      const limit = request.query.limit ? parseInt(request.query.limit) : 50;

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];
        if (!targetAgent?.id) {
          return { trades: [] };
        }

        const trades = await firestoreAdapter.getAgentTrades(targetAgent.id, limit);
        return { trades };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent?.id) {
          return { trades: [] };
        }

        const trades = await firestoreAdapter.getAgentTrades(targetAgent.id, limit);
        return { trades };
      }

      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const allTrades = await firestoreAdapter.getTrades(user.uid, Math.min(limit, 200));

        const todayKey = new Date().toISOString().slice(0, 10);
        const todayTrades = (allTrades || []).filter((t: any) => {
          const ts = t?.timestamp ? new Date(t.timestamp) : null;
          const tsKey = ts && !isNaN(ts.getTime()) ? ts.toISOString().slice(0, 10) : null;
          const metaAgentId = t?.metadata?.agentId;
          return tsKey === todayKey && metaAgentId === 'vwap-strategy';
        });

        return { trades: todayTrades };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent trades');
      return reply.code(500).send({ error: 'Error fetching trades' });
    }
  });

  // Get trading agent performance
  fastify.get('/:agentId/performance', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      let { agentId } = request.params;

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];
        if (!targetAgent) {
          return { performance: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnL: 0, dailyPnL: 0, drawdown: 0, lastTradeAt: null, dailyTrades: 0, consecutiveLosses: 0 } };
        }

        const totalTrades = targetAgent.totalTrades || 0;
        const winningTrades = targetAgent.winningTrades || 0;
        const losingTrades = targetAgent.losingTrades || 0;
        const performance = {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
          totalPnL: targetAgent.totalPnL || 0,
          dailyPnL: targetAgent.dailyPnL || 0,
          drawdown: targetAgent.drawdown || 0,
          lastTradeAt: targetAgent.lastTradeAt || null,
          dailyTrades: targetAgent.dailyTrades || 0,
          consecutiveLosses: targetAgent.consecutiveLosses || 0,
        };
        return { performance };
      }

      if (agentId === 'liquidity_sniper_arbitrage') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'liquidity_sniper_arbitrage');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Liquidity Sweep Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = selectLiquiditySweepAgent(userAgents);
        if (!targetAgent) {
          return { performance: { totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0, totalPnL: 0, dailyPnL: 0, drawdown: 0, lastTradeAt: null, dailyTrades: 0, consecutiveLosses: 0 } };
        }

        const totalTrades = targetAgent.totalTrades || 0;
        const winningTrades = targetAgent.winningTrades || 0;
        const losingTrades = targetAgent.losingTrades || 0;
        const performance = {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
          totalPnL: targetAgent.totalPnL || 0,
          dailyPnL: targetAgent.dailyPnL || 0,
          drawdown: targetAgent.drawdown || 0,
          lastTradeAt: targetAgent.lastTradeAt || null,
          dailyTrades: targetAgent.dailyTrades || 0,
          consecutiveLosses: targetAgent.consecutiveLosses || 0,
        };
        return { performance };
      }
      return reply.code(410).send({ error: 'This endpoint has been deprecated.' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent performance');
      return reply.code(410).send({ error: 'This endpoint has been deprecated.' });
    }
  });

  // ===== SCHEDULER INTEGRATION =====

  /**
   * Execute all trading agents (for n8n/cron integration)
   * This endpoint can be called by external schedulers every 5 minutes
   */
  fastify.post('/trading-agents/execute-all', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Import scheduler dynamically to avoid circular dependencies
      const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');

      // Execute all agents
      await tradingAgentScheduler.executeAllAgents();

      logger.info('Trading agents executed via scheduler endpoint');
      return { success: true, message: 'All trading agents executed successfully' };
    } catch (err: any) {
      logger.error({ err }, 'Error executing trading agents via scheduler');
      return reply.code(500).send({ error: err.message || 'Error executing trading agents' });
    }
  });

  /**
   * Execute specific trading agent (for testing/manual execution)
   */
  fastify.post('/trading-agents/:agentId/execute', async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const { agentId } = request.params;

      // Import scheduler dynamically
      const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');

      // Execute specific agent
      const result = await tradingAgentScheduler.executeAgent(agentId);

      logger.info({ agentId, success: result.success }, 'Trading agent executed manually');

      if (result.success) {
        return { success: true, message: result.message };
      } else {
        return reply.code(400).send({ error: result.message });
      }
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error executing trading agent manually');
      return reply.code(500).send({ error: err.message || 'Error executing trading agent' });
    }
  });

  /**
   * Get trading agents execution status (for monitoring)
   */
  fastify.get('/trading-agents/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Import scheduler dynamically
      const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');

      const status = tradingAgentScheduler.getStatus();
      return { status };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trading agents status');
      return reply.code(500).send({ error: err.message || 'Error getting status' });
    }
  });
}

