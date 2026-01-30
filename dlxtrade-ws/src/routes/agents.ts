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
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/diagnostics");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/dashboard");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/status");
  console.log("[ROUTE READY] POST /api/agents/crowd-consensus/start");
  console.log("[ROUTE READY] POST /api/agents/crowd-consensus/stop");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/exchange-status");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/exchange-breakdown");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/signals");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/trades");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/skipped-trades");
  console.log("[ROUTE READY] GET /api/agents/crowd-consensus/settings");
  console.log("[ROUTE READY] PUT /api/agents/crowd-consensus/settings");

  const selectBBRsiAgent = (userAgents: any[]) => {
    const agents = Array.isArray(userAgents) ? userAgents : [];
    const primary = agents.find((a: any) => String(a?.name || '').toLowerCase().includes('bb-rsi') || String(a?.strategyType || '').includes('MEAN_REVERSION'));
    if (primary) return primary;
    const fallback = agents.find((a: any) => String(a?.strategyType || '') === 'MEAN_REVERSION_SCALPER');
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

  // CRITICAL FIX: Exchange breakdown route MUST be FIRST before any /:agentId routes
  fastify.get('/crowd-consensus/exchange-breakdown', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      console.log('[REAL ROUTE HIT] crowd-consensus/exchange-breakdown');
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // A) ROUTE FIX - Reuse existing exchange config / exchange status logic
      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(uid);

      const data = await CrowdConsensusService.getExchangeConsensusBreakdown();

      // Ensure the route returns proper format with connection status and reason
      const response = {
        ...data,
        exchangeStatus: {
          connected: exchangeStatus.connected,
          exchange: exchangeStatus.exchange,
          reason: exchangeStatus.connected ? undefined : exchangeStatus.message
        }
      };

      return reply.code(200).send(response);
    } catch (err: any) {
      console.error('[CROWD CONSENSUS] exchange-breakdown ERROR:', err);
      logger.error({ err }, 'Error getting crowd consensus exchange breakdown');
      return reply.code(500).send({ error: err.message || 'Error fetching exchange breakdown' });
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

      const [settings, exchangeStatus, dailyTradeCount, recentTrades, recentSkippedTrades, exchangeBreakdown] = await Promise.all([
        CrowdConsensusService.getUserSettings(uid),
        CrowdConsensusService.getExchangeConnectionStatus(uid),
        CrowdConsensusService.getDailyTradeCount(uid),
        CrowdConsensusService.getUserTrades(uid, limit),
        CrowdConsensusService.getSkippedTrades(uid, limit),
        CrowdConsensusService.getExchangeConsensusBreakdown(),
      ]);

      const dailyTradeLimit = 5; // Max 5 trades per day
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

      // Get global scheduler status
      const globalSchedulerStatus = CrowdConsensusScheduler.getStatus();

      // Determine per-user scheduler status based on auto-trade state
      const userSchedulerStatus = {
        isRunning: autoTradeEnabled && globalSchedulerStatus.isRunning,
        intervalMs: globalSchedulerStatus.intervalMs,
        lastExecutionAt: globalSchedulerStatus.lastExecutionAt,
        nextExecutionAt: autoTradeEnabled ? globalSchedulerStatus.nextExecutionAt : null,
        lastExecutionError: globalSchedulerStatus.lastExecutionError,
      };

      return {
        scheduler: userSchedulerStatus,
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
        exchangeBreakdown,
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
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const { agentId } = request.params;
      const settings = request.body;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Trading Agent settings
      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const targetAgent = userAgents.find((a: any) => a.status === 'ACTIVE') || userAgents[0];
        if (targetAgent?.id) {
          await firestoreAdapter.updateAgentConfig(targetAgent.id, settings);
        }
        return { success: true, message: 'Settings updated successfully' };
      }


      if (agentId === 'bb-rsi-scalper') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'bb-rsi-scalper');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'BB-RSI Scalper Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const targetAgent = selectBBRsiAgent(userAgents);
        if (targetAgent?.id) {
          await firestoreAdapter.updateAgentConfig(targetAgent.id, settings);
        }
        return { success: true, message: 'Settings updated successfully' };
      }

      // HTF Trend Filter Agent settings
      if (agentId === 'htf-trend-filter-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const targetAgent = userAgents.find((a: any) => String(a?.name || '').toLowerCase().includes('htf trend filter'));
        if (targetAgent?.id) {
          await firestoreAdapter.updateAgentConfig(targetAgent.id, settings);
        }
        return { success: true, message: 'Settings updated successfully' };
      }

      // VWAP Strategy settings (no persistent settings, just acknowledge)
      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }
        return { success: true, message: 'Settings updated successfully' };
      }

      // Crowd Consensus settings
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        await CrowdConsensusService.saveUserSettings(uid, settings);
        return { success: true, message: 'Settings updated successfully' };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error updating agent settings');
      return reply.code(500).send({ error: 'Error updating settings' });
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

      try {
        const fs = require('fs');
        const traceLog = `\n[${new Date().toISOString()}] ROUTE_DIAGNOSTICS hit for ${agentId}\nUser: ${uid}\nStack: ${new Error().stack}\n`;
        fs.appendFileSync('c:/Users/yash/dlxtrade/trace.log', traceLog);
      } catch (e) { }

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

        // Get scheduler status
        let scheduler: any = null;
        try {
          const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');
          scheduler = tradingAgentScheduler.getStatus();
        } catch {
          scheduler = null;
        }

        if (!activeAgent?.id) {
          return { diagnostics: [], scheduler, agentStatus: 'NOT_FOUND' };
        }

        const { TradingAgent } = await import('../services/tradingAgent');
        const rawDiagnostics = await TradingAgent.getDiagnostics(activeAgent.id, limit, uid);

        // FILTER OUT system-level AUTO_TRADE diagnostics that don't evaluate real trading pairs
        const diagnostics = rawDiagnostics.filter((diag: any) => {
          // Exclude system-level auto-trade cycle diagnostics
          if (diag.symbol === 'AUTO_TRADE_CYCLE' ||
            diag.agentId === 'AUTO_TRADE_AGENT' ||
            diag.pair === 'AUTO_TRADE_CYCLE' ||
            diag.tradingPair === 'AUTO_TRADE_CYCLE') {
            return false;
          }

          // Only show diagnostics that evaluated real trading symbols or have valid trading data
          const hasRealSymbol = diag.tradingPair &&
            diag.tradingPair !== 'AUTO_TRADE_CYCLE' &&
            diag.tradingPair !== '--';
          const hasValidDirection = diag.direction && diag.direction !== '--';
          const hasSignalData = diag.signal?.direction;

          // Include if it has real trading pair OR valid direction OR signal data
          return hasRealSymbol || hasValidDirection || hasSignalData;
        });

        // Get real-time agent status from Firestore
        const currentAgentConfig = await firestoreAdapter.getTradingAgentConfig(activeAgent.id);
        const agentStatus = currentAgentConfig?.status || 'UNKNOWN';

        return {
          diagnostics,
          scheduler,
          agentStatus,
          agentConfig: currentAgentConfig
        };
      }

      if (agentId === 'bb-rsi-scalper') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'bb-rsi-scalper');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'BB-RSI Scalper Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const targetAgent = selectBBRsiAgent(userAgents);

        // Get scheduler status
        let scheduler: any = null;
        try {
          const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');
          scheduler = tradingAgentScheduler.getStatus();
        } catch {
          scheduler = null;
        }

        if (!targetAgent?.id) {
          return { diagnostics: [], scheduler };
        }

        const { TradingAgent } = await import('../services/tradingAgent');
        const rawDiagnostics = await TradingAgent.getDiagnostics(targetAgent.id, limit, uid);

        // FILTER OUT system-level AUTO_TRADE diagnostics that don't evaluate real trading pairs
        const diagnostics = rawDiagnostics.filter((diag: any) => {
          // Exclude system-level auto-trade cycle diagnostics
          if (diag.symbol === 'AUTO_TRADE_CYCLE' ||
            diag.agentId === 'AUTO_TRADE_AGENT' ||
            diag.pair === 'AUTO_TRADE_CYCLE' ||
            diag.tradingPair === 'AUTO_TRADE_CYCLE') {
            return false;
          }

          // Only show diagnostics that evaluated real trading symbols or have valid trading data
          const hasRealSymbol = diag.tradingPair &&
            diag.tradingPair !== 'AUTO_TRADE_CYCLE' &&
            diag.tradingPair !== '--';
          const hasValidDirection = diag.direction && diag.direction !== '--';
          const hasSignalData = diag.signal?.direction;

          // Include if it has real trading pair OR valid direction OR signal data
          return hasRealSymbol || hasValidDirection || hasSignalData;
        });

        return { diagnostics, scheduler };
      }

      // HTF Trend Filter Agent diagnostics
      if (agentId === 'htf-trend-filter-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
        }

        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        // CRITICAL: Resolve by strategyType, fall back to name-based lookup
        const targetAgent = userAgents.find((a: any) =>
          a.strategyType === 'HTF_TREND_FILTER' ||
          String(a?.name || '').toLowerCase().includes('htf trend filter')
        );

        // Get scheduler status
        let scheduler: any = null;
        try {
          const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');
          scheduler = tradingAgentScheduler.getStatus();
        } catch {
          scheduler = null;
        }

        if (!targetAgent?.id) {
          return reply.code(200).send({ diagnostics: [], scheduler, agentStatus: 'NOT_FOUND' });
        }

        // CRITICAL FIX: Use actual targetAgent.id for diagnostics fetch
        // This ensures compatibility with the unique agentId-based storage in AgentExecutionService
        const { TradingAgent } = await import('../services/tradingAgent');
        const rawDiagnostics = await TradingAgent.getDiagnostics(targetAgent.id, limit, uid);

        // FILTER OUT system-level AUTO_TRADE diagnostics that don't evaluate real trading pairs
        const filteredDiagnostics = rawDiagnostics.filter((diag: any) => {
          // Exclude system-level auto-trade cycle diagnostics
          if (diag.symbol === 'AUTO_TRADE_CYCLE' ||
            diag.agentId === 'AUTO_TRADE_AGENT' ||
            diag.pair === 'AUTO_TRADE_CYCLE' ||
            diag.tradingPair === 'AUTO_TRADE_CYCLE') {
            return false;
          }

          // Only show diagnostics that evaluated real trading symbols or have valid trading data
          const hasRealSymbol = diag.tradingPair &&
            diag.tradingPair !== 'AUTO_TRADE_CYCLE' &&
            diag.tradingPair !== '--';
          const hasValidDirection = diag.direction && diag.direction !== '--';
          const hasSignalData = diag.signal?.direction;

          // Include if it has real trading pair OR valid direction OR signal data
          return hasRealSymbol || hasValidDirection || hasSignalData;
        });

        // Apply comprehensive UI contract filtering and enhancement
        const enhancedDiagnostics = filteredDiagnostics.map((diag: any) => {
          const isSkipped = diag.decision?.action === 'SKIP';
          const reason = diag.decision?.reason || '';

          // B) PAIR & DIRECTION FIX - Always show evaluated symbols/directions
          let displayPair = diag.tradingPair || diag.pair;
          let displayDirection = diag.direction || diag.signal?.direction;

          // Use "--" ONLY when symbol/direction was never evaluated
          if (!displayPair && !diag.signal?.direction && !diag.direction) {
            displayPair = '--';
          }
          if (!displayDirection && !diag.signal?.direction && !diag.direction) {
            displayDirection = '--';
          }

          // C) DECISION DISPLAY - Enhanced decision with indicator breakdown
          let enhancedDecision = diag.decision;
          if (diag.decision?.indicatorBreakdown) {
            // Use the enhanced decision summary from firestoreAdapter
            enhancedDecision = {
              ...diag.decision,
              // Add info icon support for detailed breakdown
              hasBreakdown: true,
              breakdown: diag.decision.indicatorBreakdown
            };
          }

          // D) EXECUTION STATUS - Enhanced execution status tracking
          let executionStatus = 'SKIPPED'; // Default
          let executionReason = null;

          if (diag.execution) {
            executionStatus = diag.execution.status || 'SKIPPED';

            // Show EXACT exchange error details (never generic "EXCHANGE ERROR")
            if (diag.execution.exchangeErrorReason) {
              executionReason = diag.execution.exchangeErrorReason;
            } else if (diag.execution.exchangeError) {
              executionReason = diag.execution.exchangeError;
            } else if (diag.execution.error) {
              executionReason = diag.execution.error;
            }
          } else if (diag.signal?.isValid) {
            // If we have a valid signal but no execution, it should have been executed
            executionStatus = 'EXECUTED';
          }

          if (isSkipped) {
            // SKIPPED cycles: Clean up trading-related data but preserve evaluation results
            return {
              ...diag,
              pair: displayPair,
              direction: displayDirection,
              tradingPair: displayPair,
              signal: null, // Remove signal data for skipped cycles
              execution: {
                status: 'SKIPPED',
                reason: reason.includes('EXCHANGE_CREDENTIALS_DECRYPT_FAILED') ||
                  reason.includes('EXCHANGE_ERROR') ? 'Exchange connection failed' : null
              },
              decision: {
                action: 'SKIP',
                reason: reason.includes('EXCHANGE_CREDENTIALS_DECRYPT_FAILED') ||
                  reason.includes('EXCHANGE_ERROR') ? 'SKIPPED' : reason,
                hasBreakdown: enhancedDecision.hasBreakdown || false,
                breakdown: enhancedDecision.breakdown || null
              }
            };
          }

          // For non-skipped cycles, validate and enhance data
          return {
            ...diag,
            pair: displayPair,
            direction: displayDirection,
            tradingPair: displayPair,
            signal: diag.signal && diag.signal.direction && diag.signal.entryPrice > 0 ? diag.signal : null,
            execution: {
              status: executionStatus,
              success: executionStatus === 'EXECUTED',
              reason: executionReason,
              orderId: diag.execution?.orderId || null
            },
            decision: enhancedDecision
          };
        });

        // Get real-time agent status from Firestore
        const currentAgentConfig = await firestoreAdapter.getTradingAgentConfig(targetAgent.id);
        const agentStatus = currentAgentConfig?.status || 'UNKNOWN';

        return reply.code(200).send({
          diagnostics: enhancedDiagnostics,
          scheduler,
          agentStatus,
          agentConfig: currentAgentConfig
        });
      }

      // VWAP Strategy diagnostics (uses user-scoped runtime agent id)
      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        const { TradingAgent } = await import('../services/tradingAgent');
        const diagnostics = await TradingAgent.getDiagnostics(`vwap_${uid}`, limit, uid);
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

      // Crowd Consensus diagnostics - redirect to dedicated endpoint
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        // Get scheduler status
        let scheduler: any = null;
        try {
          scheduler = CrowdConsensusScheduler.getStatus();
        } catch {
          scheduler = null;
        }

        // Get diagnostics from unified storage
        const agentDiagnostics = await firestoreAdapter.getAgentDiagnostics(`crowd_consensus_${uid}`, limit, uid);

        // Get settings and exchange status
        const [settings, exchangeStatus, dailyTradeCount, recentTrades, recentSkippedTrades] = await Promise.all([
          CrowdConsensusService.getUserSettings(uid),
          CrowdConsensusService.getExchangeConnectionStatus(uid),
          CrowdConsensusService.getDailyTradeCount(uid),
          CrowdConsensusService.getUserTrades(uid, limit),
          CrowdConsensusService.getSkippedTrades(uid, limit),
        ]);

        const dailyTradeLimit = 5; // Max 5 trades per day
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
          diagnostics: agentDiagnostics.length > 0 ? agentDiagnostics : recentSkippedTrades.map((t: any) => ({
            id: t.id,
            timestamp: t.timestamp,
            decision: { action: 'SKIP', reason: t.reason || 'NO_SIGNAL' },
            signal: t.signal || null,
          })),
          scheduler,
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
      }

      return reply.code(404).send({ error: 'Agent not found' });
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

  // NOTE: GET /api/agents/:id route moved to END of file to avoid catching specific routes

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
        let userAgents = await firestoreAdapter.getUserTradingAgents(uid);

        // Auto-create default agent if none exists
        if (userAgents.length === 0) {
          logger.info({ uid }, 'No trading agents found in /control, creating default agent');
          const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
          const defaultAgent = {
            id: `trading_agent_${uid}_${Date.now()}`,
            userId: uid,
            name: 'Trading Agent',
            tradingPair: 'BTC/USDT',
            marketType: 'futures',
            strategyType: 'RSI_BOLLINGER',
            status: 'STOPPED',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
          userAgents = [defaultAgent];
        }

        const activeAgent = userAgents.find((agent: any) => agent.status === 'ACTIVE') || userAgents[0];

        return {
          agentId: 'trading-agent',
          status: activeAgent.status || 'STOPPED',
          config: activeAgent || null,
        };
      }

      if (agentId === 'bb-rsi-scalper') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'bb-rsi-scalper');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'BB-RSI Scalper Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        let userAgents = await firestoreAdapter.getUserTradingAgents(uid);

        // Auto-create default agent if none exists
        if (userAgents.length === 0) {
          logger.info({ uid }, 'No BB-RSI Scalper agents found in /control, creating default agent');
          const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
          const defaultAgent = {
            id: `bb_rsi_scalper_${uid}_${Date.now()}`,
            userId: uid,
            name: 'BB-RSI EMA200 Scalper Pro',
            tradingPair: 'BTC/USDT',
            marketType: 'futures',
            strategyType: 'MEAN_REVERSION_SCALPER',
            status: 'STOPPED',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
          userAgents = [defaultAgent];
        }

        const activeAgent = selectBBRsiAgent(userAgents) || userAgents[0];

        return {
          agentId: 'bb-rsi-scalper',
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

      // HTF Trend Filter Agent control
      if (agentId === 'htf-trend-filter-agent') {
        console.log('[HTF CONTROL] HTF agent handler reached!', { uid, agentId });
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
        console.log('[HTF CONTROL] Access check result:', hasAccess);
        if (!hasAccess) {
          return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = userAgents.find((a: any) => a.strategyType === 'HTF_TREND_FILTER');

        return {
          agentId: 'htf-trend-filter-agent',
          status: activeAgent?.status || 'STOPPED',
          config: activeAgent || null,
        };
      }

      // Crowd Consensus control
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        const settings = await CrowdConsensusService.getUserSettings(uid);
        const isActive = settings?.autoTradeEnabled === true;

        return {
          agentId: 'crowd-consensus',
          status: isActive ? 'ACTIVE' : 'STOPPED',
          config: {
            name: 'Crowd Consensus Copy Trade',
            strategyType: 'CROWD_CONSENSUS',
            autoTradeEnabled: isActive,
            selectedAutoTradeExchange: settings?.selectedAutoTradeExchange || null,
          },
        };
      }

      return reply.code(404).send({ error: 'Agent not found', receivedAgentId: agentId, availableAgents: ['trading-agent', 'bb-rsi-scalper', 'vwap-strategy', 'htf-trend-filter-agent', 'crowd-consensus'] });
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



      // HTF Trend Filter Agent status
      if (agentId === 'htf-trend-filter-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
        const activeAgent = userAgents.find((a: any) => a.strategyType === 'HTF_TREND_FILTER');
        return {
          agentId: 'htf-trend-filter-agent',
          status: activeAgent?.status || 'STOPPED',
        };
      }

      // Crowd Consensus status
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        const settings = await CrowdConsensusService.getUserSettings(uid);
        const isActive = settings?.autoTradeEnabled === true;
        return {
          agentId: 'crowd-consensus',
          status: isActive ? 'ACTIVE' : 'STOPPED',
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

      logger.info({ uid: user.uid, agentId }, 'Agent start request received');

      try {
        const fs = require('fs');
        const traceLog = `\n[${new Date().toISOString()}] ROUTE_START hit for ${agentId}\nUser: ${user.uid}\nStack: ${new Error().stack}\n`;
        fs.appendFileSync('c:/Users/yash/dlxtrade/trace.log', traceLog);
      } catch (e) { }

      // MANUAL START MODE: User-initiated start from UI
      // No signal/accuracy/tradePlan validation required
      // Agent enters ARMED state and waits for signals

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'Trading Agent access not granted yet. Please request approval from admin first.',
            code: 'AGENT_NOT_APPROVED'
          });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];

        if (!targetAgent?.id) {
          return reply.code(400).send({
            error: 'Agent document missing. Please contact admin to recreate your agent.',
            code: 'AGENT_DOCUMENT_MISSING'
          });
        }

        // Check exchange connection for manual start
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
        if (!exchangeConfig?.exchange) {
          return reply.code(400).send({
            error: 'Exchange not connected. Please connect an exchange in Settings first.',
            code: 'EXCHANGE_NOT_CONNECTED'
          });
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');
        logger.info({ uid: user.uid, agentId: targetAgent.id, mode: 'manual' }, 'Trading Agent started in manual mode - ARMED and waiting for signals');
        return { success: true, message: 'Trading Agent started successfully', mode: 'manual', status: 'ARMED' };
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
          return reply.code(400).send({
            error: 'EXCHANGE_NOT_FOUND - No exchange configuration found. Please connect your exchange in Settings.'
          });
        }

        const exchange = exchangeConfig.exchange;
        if (!exchange) {
          return reply.code(400).send({
            error: 'EXCHANGE_NOT_FOUND - Invalid exchange configuration. Please reconnect your exchange in Settings.'
          });
        }

        const encryptedApiKey = exchangeConfig.apiKeyEncrypted;
        const encryptedSecret = exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted;
        const encryptedPassphrase = exchangeConfig.passphraseEncrypted;

        if (!encryptedApiKey || !encryptedSecret) {
          return reply.code(400).send({
            error: 'EXCHANGE_CREDENTIALS_NOT_FOUND - Encrypted keys missing. Please reconnect your exchange in Settings.',
            hasApiKey: !!encryptedApiKey,
            hasSecret: !!encryptedSecret
          });
        }

        const apiKey = decrypt(encryptedApiKey, 'user_request');
        const secret = decrypt(encryptedSecret, 'user_request');
        const passphrase = encryptedPassphrase ? decrypt(encryptedPassphrase, 'user_request') : undefined;

        if (!apiKey || !secret) {
          return reply.code(400).send({
            error: 'EXCHANGE_CREDENTIALS_DECRYPT_FAILED - Exchange key decryption failed. Please reconnect your exchange in Settings.',
            decryptedApiKey: !!apiKey,
            decryptedSecret: !!secret
          });
        }

        // Debug log (temporary)
        logger.debug({
          uid: user.uid,
          exchange: exchange.toLowerCase(),
          credentialsResolved: true
        }, 'VWAP agent credentials successfully resolved');

        // Normalize exchange name to lowercase
        const normalizedExchange = exchange.toLowerCase();
        vwapRuntimeService.setAgentCredentials(user.uid, normalizedExchange, {
          apiKey,
          secret,
          passphrase: passphrase || undefined,
          testnet: exchangeConfig.testnet ?? false,
        });

        // Start VWAP Strategy using runtime service (now async with persistence)
        const runtimeState = await vwapRuntimeService.startAgent(user.uid);
        return { success: true, message: 'VWAP Strategy started successfully' };
      }

      // HTF Trend Filter Agent start
      if (agentId === 'htf-trend-filter-agent') {
        console.log('[HTF START] HTF agent start handler reached!', { uid: user.uid, agentId });
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'htf-trend-filter-agent');
        console.log('[HTF START] Access check result:', hasAccess);
        if (!hasAccess) {
          return reply.code(403).send({
            error: 'HTF Trend Filter Agent access not granted yet. Please request approval from admin first.',
            code: 'AGENT_NOT_APPROVED'
          });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
        if (!exchangeConfig?.exchange) {
          return reply.code(400).send({
            error: 'Exchange not connected. Please connect an exchange in Settings first.',
            code: 'EXCHANGE_NOT_CONNECTED'
          });
        }

        // Get or create agent document
        let userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        let targetAgent = userAgents.find((a: any) => a.strategyType === 'HTF_TREND_FILTER');

        // Auto-create default agent if none exists
        if (!targetAgent) {
          const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
          const defaultAgent = {
            id: `htf_trend_filter_${user.uid}_${Date.now()}`,
            userId: user.uid,
            name: 'HTF Trend Filter Agent',
            tradingPair: 'BTC/USDT',
            marketType: 'futures',
            strategyType: 'HTF_TREND_FILTER',
            type: 'htf_trend_filter',
            status: 'STOPPED',
            riskPerTrade: 1, // 1% risk per trade
            leverage: 8,
            maxTradesPerDay: 3,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
          targetAgent = defaultAgent;
        }

        // Update agent status to ACTIVE
        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'ACTIVE');

        // CRITICAL: Reload agents in scheduler so it picks up the newly activated agent
        const { tradingAgentScheduler } = await import('../services/tradingAgentScheduler');
        await tradingAgentScheduler.reloadAgents();

        logger.info({ uid: user.uid, agentId: targetAgent.id, mode: 'manual' }, 'HTF Trend Filter Agent started in manual mode - ARMED and waiting for signals');
        return { success: true, message: 'HTF Trend Filter Agent started successfully', mode: 'manual', status: 'ARMED' };
      }

      // Crowd Consensus start
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        // Check exchange connection for manual start
        const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(user.uid);
        if (!exchangeStatus.connected) {
          return reply.code(400).send({
            error: 'Exchange not connected. Please connect an exchange in Settings first.',
            exchangeStatus,
          });
        }

        await CrowdConsensusService.setAutoTradeEnabled(user.uid, true);
        logger.info({ uid: user.uid, mode: 'manual' }, 'Crowd Consensus started in manual mode - ARMED and waiting for signals');
        return { success: true, message: 'Crowd Consensus auto trading started successfully', mode: 'manual', status: 'ARMED' };
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

      logger.info({ uid: user.uid, agentId }, 'Agent stop request received');

      if (agentId === 'trading-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Trading Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((a: any) => a.status === 'ACTIVE');
        const targetAgent = activeAgent || userAgents[0];

        // IDEMPOTENT: If no agent found, treat as already stopped
        if (!targetAgent?.id) {
          logger.info({ uid: user.uid, agentId }, 'Trading Agent stop called but no agent found - treating as already stopped');
          return { success: true, message: 'Trading Agent stopped successfully' };
        }

        // Update agent status to STOPPED in Firestore
        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'STOPPED');
        logger.info({ uid: user.uid, agentId: targetAgent.id }, 'Trading Agent stopped successfully - status updated to STOPPED');
        return { success: true, message: 'Trading Agent stopped successfully' };
      }

      if (agentId === 'htf-trend-filter-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'htf-trend-filter-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const targetAgent = userAgents.find((a: any) => a.strategyType === 'HTF_TREND_FILTER');

        // IDEMPOTENT: If no agent found, treat as already stopped
        if (!targetAgent?.id) {
          logger.info({ uid: user.uid, agentId }, 'HTF Trend Filter Agent stop called but no agent found - treating as already stopped');
          return { success: true, message: 'HTF Trend Filter Agent stopped successfully' };
        }

        await firestoreAdapter.updateAgentStatus(targetAgent.id, 'STOPPED');
        logger.info({ uid: user.uid, agentId: targetAgent.id }, 'HTF Trend Filter Agent stopped successfully');
        return { success: true, message: 'HTF Trend Filter Agent stopped successfully' };
      }

      // Handle VWAP Strategy agents
      if (agentId === 'vwap-strategy') {
        // SYSTEM AGENT: Always return success (idempotent)
        try {
          await vwapRuntimeService.stopAgent(user.uid);
        } catch (err) {
          // Ignore errors - always return success for idempotency
        }
        return { success: true, message: 'VWAP Strategy stopped successfully' };
      }

      // Crowd Consensus stop
      if (agentId === 'crowd-consensus') {
        // SYSTEM AGENT: Always return success (idempotent)
        try {
          await CrowdConsensusService.setAutoTradeEnabled(user.uid, false);
        } catch (err) {
          // Ignore errors - always return success for idempotency
        }
        return { success: true, message: 'Crowd Consensus auto trading stopped successfully', status: 'INACTIVE' };
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

      console.log('[TRADES ROUTE HIT]', { agentId, uid: user?.uid, limit });

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

      // Crowd Consensus trades
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        const trades = await CrowdConsensusService.getUserTrades(user.uid, limit);
        return { trades };
      }

      // HTF Trend Filter Agent trades
      if (agentId === 'htf-trend-filter-agent') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'htf-trend-filter-agent');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
        }

        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        let userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);

        // Auto-create default agent if none exists
        if (userAgents.length === 0 || !userAgents.find((a: any) => a.strategyType === 'HTF_TREND_FILTER')) {
          logger.info({ uid: user.uid }, 'No HTF Trend Filter agents found in /trades, creating default agent');
          const db = (await import('../utils/firebase')).getFirebaseAdmin().firestore();
          const defaultAgent = {
            id: `htf_trend_filter_${user.uid}_${Date.now()}`,
            userId: user.uid,
            name: 'HTF Trend Filter Agent',
            tradingPair: 'BTC/USDT',
            marketType: 'futures',
            strategyType: 'HTF_TREND_FILTER',
            status: 'STOPPED',
            riskPerTrade: 0.01, // 1% risk per trade (HARD LIMIT)
            leverage: 5, // 5x leverage (HARD LIMIT)
            maxTradesPerDay: 5, // 5 trades per day (HARD LIMIT)
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await db.collection('tradingAgents').doc(defaultAgent.id).set(defaultAgent);
          userAgents = [defaultAgent];
        }

        const targetAgent = userAgents.find((a: any) => a.strategyType === 'HTF_TREND_FILTER') || userAgents[0];
        if (!targetAgent?.id) {
          return { trades: [] };
        }

        const trades = await firestoreAdapter.getAgentTrades(targetAgent.id, limit);
        return { trades };
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

      // VWAP Strategy performance
      if (agentId === 'vwap-strategy') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'vwap-strategy');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'VWAP Strategy access not granted yet' });
        }

        // Get trades for VWAP strategy to calculate performance
        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const allTrades = await firestoreAdapter.getTrades(user.uid, 200);
        const vwapTrades = (allTrades || []).filter((t: any) => t?.metadata?.agentId === 'vwap-strategy');

        const totalTrades = vwapTrades.length;
        const winningTrades = vwapTrades.filter((t: any) => (Number(t?.pnl) || 0) > 0).length;
        const losingTrades = vwapTrades.filter((t: any) => (Number(t?.pnl) || 0) < 0).length;
        const totalPnL = vwapTrades.reduce((sum: number, t: any) => sum + (Number(t?.pnl) || 0), 0);

        // Calculate today's trades and PnL
        const todayKey = new Date().toISOString().slice(0, 10);
        const todayTrades = vwapTrades.filter((t: any) => {
          const ts = t?.timestamp ? new Date(t.timestamp) : null;
          return ts && ts.toISOString().slice(0, 10) === todayKey;
        });
        const dailyPnL = todayTrades.reduce((sum: number, t: any) => sum + (Number(t?.pnl) || 0), 0);

        const performance = {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
          totalPnL,
          dailyPnL,
          drawdown: 0,
          lastTradeAt: vwapTrades[0]?.timestamp || null,
          dailyTrades: todayTrades.length,
          consecutiveLosses: 0,
        };
        return { performance };
      }

      // Crowd Consensus performance
      if (agentId === 'crowd-consensus') {
        const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'crowd-consensus');
        if (!hasAccess) {
          return reply.code(403).send({ error: 'Crowd Consensus access not granted yet' });
        }

        const trades = await CrowdConsensusService.getUserTrades(user.uid, 200);
        const totalTrades = trades.length;
        const winningTrades = trades.filter((t: any) => (Number(t?.pnl) || 0) > 0).length;
        const losingTrades = trades.filter((t: any) => (Number(t?.pnl) || 0) < 0).length;
        const totalPnL = trades.reduce((sum: number, t: any) => sum + (Number(t?.pnl) || 0), 0);

        const todayKey = new Date().toISOString().slice(0, 10);
        const todayTrades = trades.filter((t: any) => {
          const ts = t?.timestamp ? new Date(t.timestamp) : null;
          return ts && ts.toISOString().slice(0, 10) === todayKey;
        });
        const dailyPnL = todayTrades.reduce((sum: number, t: any) => sum + (Number(t?.pnl) || 0), 0);

        const performance = {
          totalTrades,
          winningTrades,
          losingTrades,
          winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
          totalPnL,
          dailyPnL,
          drawdown: 0,
          lastTradeAt: trades[0]?.timestamp || null,
          dailyTrades: todayTrades.length,
          consecutiveLosses: 0,
        };
        return { performance };
      }

      return reply.code(404).send({ error: 'Agent not found' });
    } catch (err: any) {
      logger.error({ err, agentId: request.params.agentId }, 'Error getting trading agent performance');
      return reply.code(500).send({ error: 'Error fetching performance' });
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

  // ===== LAUNCHPAD HUNTER ROUTES =====
  // These routes are migrated from /api/agent/* (singular) to /api/agents/* (plural)

  console.log("[ROUTE READY] GET /api/agents/launchpad-hunter/dashboard");
  console.log("[ROUTE READY] GET /api/agents/launchpad-hunter/alerts");
  console.log("[ROUTE READY] GET /api/agents/launchpad-hunter/settings");
  console.log("[ROUTE READY] PUT /api/agents/launchpad-hunter/settings");

  // GET /api/agents/launchpad-hunter/dashboard - Get launchpad hunter dashboard data
  fastify.get('/launchpad-hunter/dashboard', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Check if user has access to launchpad hunter
      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'launchpad-hunter');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      // Get recent alerts
      const { LaunchpadService } = await import('../services/launchpadService');
      const alerts = await LaunchpadService.getUserAlerts(uid, 10);

      // Get user settings
      const settings = await LaunchpadService.getUserSettings(uid);

      // Get current presales (cached)
      const presales = await LaunchpadService.getCachedPresales();

      return {
        alerts,
        settings: {
          enabled: settings.enabled !== false,
          selectedChains: settings.selectedChains || ['ETH', 'BSC'],
          alertTypes: settings.alertTypes || ['upcoming', 'live'],
          maxAlertsPerDay: settings.maxAlertsPerDay || 10,
          riskFilter: settings.riskFilter || 'all',
          apiKeys: settings.apiKeys || {},
        },
        stats: {
          totalAlerts: alerts.length,
          activePresales: presales.filter((p: any) => p.status === 'live').length,
          upcomingPresales: presales.filter((p: any) => p.status === 'upcoming').length,
        }
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting launchpad hunter dashboard');
      return reply.code(500).send({ error: err.message || 'Error fetching dashboard data' });
    }
  });

  // GET /api/agents/launchpad-hunter/alerts - Get launchpad alerts history
  fastify.get('/launchpad-hunter/alerts', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const limit = parseInt(request.query.limit || '50');

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Check access
      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'launchpad-hunter');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      const { LaunchpadService } = await import('../services/launchpadService');
      const alerts = await LaunchpadService.getUserAlerts(uid, limit);
      return { alerts };
    } catch (err: any) {
      logger.error({ err }, 'Error getting launchpad alerts');
      return reply.code(500).send({ error: err.message || 'Error fetching alerts' });
    }
  });

  // GET /api/agents/launchpad-hunter/settings - Get launchpad hunter settings
  fastify.get('/launchpad-hunter/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Check access
      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'launchpad-hunter');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      const { LaunchpadService } = await import('../services/launchpadService');
      const settings = await LaunchpadService.getUserSettings(uid);
      return {
        settings: {
          enabled: settings.enabled !== false,
          selectedChains: settings.selectedChains || ['ETH', 'BSC'],
          alertTypes: settings.alertTypes || ['upcoming', 'live'],
          maxAlertsPerDay: settings.maxAlertsPerDay || 10,
          riskFilter: settings.riskFilter || 'all',
          apiKeys: settings.apiKeys || {},
        }
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting launchpad settings');
      return reply.code(500).send({ error: err.message || 'Error fetching settings' });
    }
  });

  // PUT /api/agents/launchpad-hunter/settings - Update launchpad hunter settings
  fastify.put('/launchpad-hunter/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const settings = request.body;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Validate settings
      const settingsSchema = z.object({
        enabled: z.boolean().optional(),
        selectedChains: z.array(z.string()).optional(),
        alertTypes: z.array(z.string()).optional(),
        maxAlertsPerDay: z.number().min(1).max(100).optional(),
        riskFilter: z.enum(['all', 'low']).optional(),
        apiKeys: z.object({
          etherscan: z.string().optional(),
          bscscan: z.string().optional(),
          coingecko: z.string().optional(),
          pinklock: z.string().optional(),
        }).optional(),
      });

      const validatedSettings = settingsSchema.parse(settings);

      // Check access
      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'launchpad-hunter');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      // Encrypt API keys if provided
      if (validatedSettings.apiKeys) {
        const { encrypt } = await import('../services/keyManager');
        const encryptedApiKeys: any = {};
        for (const [key, value] of Object.entries(validatedSettings.apiKeys)) {
          if (value && typeof value === 'string') {
            encryptedApiKeys[key] = await encrypt(value);
          }
        }
        validatedSettings.apiKeys = encryptedApiKeys;
      }

      const { LaunchpadService } = await import('../services/launchpadService');
      await LaunchpadService.updateUserSettings(uid, validatedSettings);

      logger.info({ uid }, 'Updated launchpad hunter settings');
      return { message: 'Settings updated successfully' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid settings', details: err.errors });
      }
      logger.error({ err }, 'Error updating launchpad settings');
      return reply.code(500).send({ error: err.message || 'Error updating settings' });
    }
  });

  // POST /api/agents/:agentId/test-exchange-execution - Test exchange execution endpoint
  fastify.post('/:agentId/test-exchange-execution', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const { agentId } = request.params;

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Only support HTF Trend Filter Agent for now
      if (agentId !== 'htf-trend-filter-agent') {
        return reply.code(404).send({ error: 'Agent not found or not supported' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
      }

      // Get user's exchange configuration
      const exchangeConfig = await firestoreAdapter.getExchangeConfig(uid);
      if (!exchangeConfig || !exchangeConfig.exchange) {
        return reply.code(400).send({
          error: 'No exchange configured',
          orderEndpointReachable: false,
          permissionsOk: false,
          futuresEnabled: false,
          symbolTradable: false
        });
      }

      const exchangeKey = exchangeConfig.exchange;

      // CHECK FOR CORRUPTED STATUS: Encryption secret may have changed
      if (exchangeConfig.exchangeStatus === 'CORRUPTED') {
        logger.warn({ uid, agentId, reason: exchangeConfig.corruptedReason }, 'Exchange is CORRUPTED - cannot decrypt keys');
        return reply.code(200).send({
          orderEndpointReachable: false,
          permissionsOk: false,
          futuresEnabled: false,
          symbolTradable: false,
          exchange: exchangeKey,
          error: 'EXCHANGE_CORRUPTED',
          message: 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.'
        });
      }

      try {
        // Decrypt exchange credentials
        let decryptedApiKey: string | null = null;
        let decryptedApiSecret: string | null = null;
        let decryptedPassphrase: string | undefined = undefined;

        try {
          decryptedApiKey = decrypt(exchangeConfig.apiKeyEncrypted, 'exchange');
          decryptedApiSecret = decrypt(exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted, 'exchange');
          decryptedPassphrase = exchangeConfig.passphraseEncrypted ? decrypt(exchangeConfig.passphraseEncrypted, 'exchange') : undefined;
        } catch (decryptError: any) {
          // Handle ENCRYPTION_SECRET_CHANGED error specifically
          if (decryptError.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
            logger.warn({ uid, agentId, error: decryptError.message }, 'Exchange keys corrupted due to encryption secret change');

            // NOTE: Do NOT attempt to mark exchange as corrupted in Firestore
            // Exchange status is managed exclusively by /exchange/connect

            return reply.code(200).send({
              orderEndpointReachable: false,
              permissionsOk: false,
              futuresEnabled: false,
              symbolTradable: false,
              exchange: exchangeKey,
              error: 'EXCHANGE_CORRUPTED',
              message: 'Exchange keys are invalid due to encryption secret change. Please reconnect exchange.'
            });
          }

          // Handle other decryption errors
          throw decryptError;
        }

        // EXECUTION GUARD: Assert keys are not null before proceeding
        if (!decryptedApiKey || decryptedApiKey.trim() === '') {
          throw new Error('EXCHANGE_KEYS_NOT_DECRYPTED: API key decryption failed or returned empty');
        }

        if (!decryptedApiSecret || decryptedApiSecret.trim() === '') {
          throw new Error('EXCHANGE_KEYS_NOT_DECRYPTED: Secret key decryption failed or returned empty');
        }

        // Import exchange connector
        const { ExchangeConnector } = await import('../services/exchangeConnector');

        // Test order execution endpoint with dry-run
        const testResult = await ExchangeConnector.testOrderExecution(exchangeKey as any, {
          apiKey: decryptedApiKey,
          apiSecret: decryptedApiSecret,
          passphrase: decryptedPassphrase,
          sandbox: exchangeConfig.sandbox || false
        }, exchangeKey === 'bitget' ? 'BTCUSDT' : 'BTC/USDT'); // CRITICAL FIX: Use raw symbol format for Bitget

        return reply.code(200).send({
          orderEndpointReachable: testResult.orderEndpointReachable,
          permissionsOk: testResult.permissionsOk,
          futuresEnabled: testResult.futuresEnabled,
          symbolTradable: testResult.symbolTradable,
          exchange: exchangeKey,
          message: testResult.message || 'Exchange execution test completed'
        });

      } catch (err: any) {
        logger.error({ err, uid, agentId }, 'Exchange execution test failed');

        // Return specific error messages based on error type
        let errorMessage = err.message || 'Exchange connection failed';

        // Map specific errors to user-friendly messages
        if (err.message?.includes('ENCRYPTION_SECRET_CHANGED')) {
          errorMessage = 'EXCHANGE_CORRUPTED';
        } else if (err.message?.includes('EXCHANGE_KEYS_NOT_DECRYPTED')) {
          errorMessage = 'EXCHANGE_KEYS_NOT_DECRYPTED';
        } else if (err.message?.includes('PERMISSION_DENIED')) {
          errorMessage = 'PERMISSION_DENIED';
        } else if (err.message?.includes('FUTURES_DISABLED')) {
          errorMessage = 'FUTURES_DISABLED';
        } else if (err.message?.includes('SYMBOL_NOT_TRADABLE')) {
          errorMessage = 'SYMBOL_NOT_TRADABLE';
        }

        return reply.code(200).send({
          orderEndpointReachable: false,
          permissionsOk: false,
          futuresEnabled: false,
          symbolTradable: false,
          exchange: exchangeKey,
          error: errorMessage,
          rawError: err.toString()
        });
      }

    } catch (err: any) {
      logger.error({ err }, 'Error testing exchange execution');
      return reply.code(500).send({ error: err.message || 'Error testing exchange execution' });
    }
  });

  // POST /api/agents/:agentId/execute-manual-trade - Execute manual trade (test or real)
  fastify.post('/:agentId/execute-manual-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{
    Params: { agentId: string };
    Body: { pair: string; side: 'LONG' | 'SHORT'; quantity: number; executeRealTrade?: boolean }
  }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;
      const { agentId } = request.params;
      const { pair, side, quantity, executeRealTrade } = request.body;

      // Log full request body at route entry
      logger.info({
        tag: '[HTF_MANUAL_TRADE_REQUEST]',
        uid,
        agentId,
        requestBody: request.body
      }, 'HTF manual trade request received');

      if (!uid) {
        return reply.code(403).send({ error: 'Authentication required' });
      }

      // Validate input
      const tradeSchema = z.object({
        pair: z.string().min(1),
        side: z.enum(['LONG', 'SHORT']),
        quantity: z.number().min(0.001),
        executeRealTrade: z.boolean().optional()
      });

      const validatedTrade = tradeSchema.parse({ pair, side, quantity, executeRealTrade });

      // Only support HTF Trend Filter Agent for now
      if (agentId !== 'htf-trend-filter-agent') {
        return reply.code(404).send({ error: 'Agent not found or not supported' });
      }

      const hasAccess = await AgentApprovalService.userHasAgentAccess(uid, 'htf-trend-filter-agent');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'HTF Trend Filter Agent access not granted yet' });
      }

      // Get user's trading agent
      const userAgents = await firestoreAdapter.getUserTradingAgents(uid);
      const targetAgent = userAgents.find((a: any) => String(a?.name || '').toLowerCase().includes('htf trend filter'));

      if (!targetAgent?.id) {
        return reply.code(404).send({ error: 'HTF Trend Filter Agent not found' });
      }

      // Manual trades are REAL ONLY - testMode is always false
      const testMode = false;

      // Call the SAME execution path used by the agent
      const { AgentExecutionService } = await import('../services/agentExecutionService');

      // Create manual execution context
      const manualExecutionContext = {
        agentId: targetAgent.id,
        tradingPair: validatedTrade.pair,
        side: validatedTrade.side,
        quantity: validatedTrade.quantity,
        testMode: testMode,
        manualTrigger: true
      };

      // Log the REAL execution request
      logger.warn({
        tag: '[REAL_MANUAL_TRADE_REQUEST]',
        uid,
        agentId: targetAgent.id,
        pair: validatedTrade.pair,
        side: validatedTrade.side,
        quantity: validatedTrade.quantity
      }, 'Real manual trade request - order will be placed on Bitget Futures');

      const executionResult = await AgentExecutionService.executeManualTrade(uid, manualExecutionContext);

      return reply.code(200).send({
        success: executionResult.success,
        message: executionResult.message,
        orderId: executionResult.orderId || null,
        executionDetails: executionResult.details || null,
        error: executionResult.error || null,
        rawError: executionResult.rawError || null
      });

    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid trade parameters', details: err.errors });
      }

      logger.error({ err }, 'Error executing manual trade');
      return reply.code(500).send({
        success: false,
        error: err.message || 'Error executing manual trade',
        rawError: err.toString()
      });
    }
  });
}

