import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { agentAccessMiddleware } from '../middleware/agentAuth';
import { LaunchpadService } from '../services/launchpadService';
import { CrowdConsensusService } from '../services/crowdConsensusService';
import { AgentApprovalService } from '../services/agentApprovalService';
import { z } from 'zod';

export async function agentRoutes(fastify: FastifyInstance) {
  console.log("[AGENT ROUTES] Registering agent routes at", new Date().toISOString());
  console.log("[ROUTE READY] GET /api/agent/:agentId");
  console.log("[ROUTE READY] GET /api/agent/:agentId/dashboard");
  console.log("[ROUTE READY] GET /api/agent/:agentId/settings");
  console.log("[ROUTE READY] PUT /api/agent/:agentId/settings");
  console.log("[ROUTE READY] POST /api/agent/:agentId/start");
  console.log("[ROUTE READY] POST /api/agent/:agentId/stop");

  // HARD DEPRECATION: trading/vwap/liquidity-sweep agents must ONLY use /api/agents/:agentSlug/*
  const deprecatedAgentIds = new Set([
    'trading-agent',
    'vwap-strategy',
    'liquidity_sniper_arbitrage',
    'LIQUIDITY_SWEEP_AGENT',
  ]);

  // Launchpad Hunter specific routes
  console.log("[ROUTE READY] GET /api/agent/launchpad-hunter/dashboard");
  console.log("[ROUTE READY] GET /api/agent/launchpad-hunter/alerts");
  console.log("[ROUTE READY] GET /api/agent/launchpad-hunter/settings");
  console.log("[ROUTE READY] PUT /api/agent/launchpad-hunter/settings");

  // GET /api/agent/:agentId - Get agent dashboard data (requires access)
  fastify.get('/:agentId', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      if (deprecatedAgentIds.has(agentId)) {
        return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/:agentSlug/control.' });
      }

      // Get agent data from global agents collection
      const agent = await firestoreAdapter.getAgent(agentId);
      if (!agent) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      // Get user's agent data (includes settings, status, etc.)
      const userAgents = await firestoreAdapter.getUserAgents(user.uid);
      const userAgent = userAgents.find((ua: any) => ua.id === agentId);

      return {
        agent: {
          ...agent,
          userSettings: userAgent?.settings || {},
          status: userAgent?.status || 'inactive',
          enabled: userAgent?.enabled !== false,
        }
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent dashboard');
      return reply.code(500).send({ error: err.message || 'Error fetching agent data' });
    }
  });

  // GET /api/agent/:agentId/dashboard - Alias for above (requires access)
  fastify.get('/:agentId/dashboard', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      if (deprecatedAgentIds.has(agentId)) {
        return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/:agentSlug/control.' });
      }

      // Get agent data from global agents collection
      const agent = await firestoreAdapter.getAgent(agentId);
      if (!agent) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      // Get user's agent data
      const userAgents = await firestoreAdapter.getUserAgents(user.uid);
      const userAgent = userAgents.find((ua: any) => ua.id === agentId);

      // Get agent-specific dashboard data (mock for now)
      const dashboardData = {
        agent: {
          ...agent,
          userSettings: userAgent?.settings || {},
          status: userAgent?.status || 'inactive',
          enabled: userAgent?.enabled !== false,
        },
        stats: {
          totalTrades: 0,
          profitLoss: 0,
          winRate: 0,
          activeSignals: 0,
        },
        recentActivity: [],
        performance: {
          daily: [],
          weekly: [],
          monthly: [],
        }
      };

      return dashboardData;
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent dashboard');
      return reply.code(500).send({ error: err.message || 'Error fetching agent dashboard' });
    }
  });

  // GET /api/agent/:agentId/settings - Get agent settings (requires access)
  fastify.get('/:agentId/settings', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      if (deprecatedAgentIds.has(agentId)) {
        return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/:agentSlug/control.' });
      }

      // Get user's agent settings
      const userAgents = await firestoreAdapter.getUserAgents(user.uid);
      const userAgent = userAgents.find((ua: any) => ua.id === agentId);

      return {
        settings: userAgent?.settings || {},
        status: userAgent?.status || 'inactive',
        enabled: userAgent?.enabled !== false,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent settings');
      return reply.code(500).send({ error: err.message || 'Error fetching agent settings' });
    }
  });

  // PUT /api/agent/:agentId/settings - Update agent settings (requires access)
  fastify.put('/:agentId/settings', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;
      const settings = request.body;

      if (deprecatedAgentIds.has(agentId)) {
        return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/:agentSlug/settings.' });
      }

      // Update agent settings in user's subcollection
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const admin = await import('firebase-admin');
      const db = getFirebaseAdmin().firestore();
      const userAgentRef = db.collection('users').doc(user.uid).collection('agents').doc(agentId);
      const updateData: any = {
        settings,
        updatedAt: admin.firestore.Timestamp.now(),
      };
      await userAgentRef.set(updateData, { merge: true });

      logger.info({ uid: user.uid, agentId }, 'Agent settings updated');
      return { message: 'Settings updated successfully' };
    } catch (err: any) {
      logger.error({ err }, 'Error updating agent settings');
      return reply.code(500).send({ error: err.message || 'Error updating agent settings' });
    }
  });

  // POST /api/agent/:agentId/start - Start agent (requires access)
  fastify.post('/:agentId/start', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      if (deprecatedAgentIds.has(agentId)) {
        return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/:agentSlug/start.' });
      }

      // Update agent status to active
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const admin = await import('firebase-admin');
      const db = getFirebaseAdmin().firestore();
      const userAgentRef = db.collection('users').doc(user.uid).collection('agents').doc(agentId);
      await userAgentRef.set({
        status: 'active',
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });

      logger.info({ uid: user.uid, agentId }, 'Agent started');
      return { message: 'Agent started successfully', status: 'active' };
    } catch (err: any) {
      logger.error({ err }, 'Error starting agent');
      return reply.code(500).send({ error: err.message || 'Error starting agent' });
    }
  });

  // POST /api/agent/:agentId/stop - Stop agent (requires access)
  fastify.post('/:agentId/stop', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;

      if (deprecatedAgentIds.has(agentId)) {
        return reply.code(410).send({ error: 'This endpoint has been deprecated. Use /api/agents/:agentSlug/stop.' });
      }

      // Update agent status to inactive
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const admin = await import('firebase-admin');
      const db = getFirebaseAdmin().firestore();
      const userAgentRef = db.collection('users').doc(user.uid).collection('agents').doc(agentId);
      await userAgentRef.set({
        status: 'inactive',
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });

      logger.info({ uid: user.uid, agentId }, 'Agent stopped');
      return { message: 'Agent stopped successfully', status: 'inactive' };
    } catch (err: any) {
      logger.error({ err }, 'Error stopping agent');
      return reply.code(500).send({ error: err.message || 'Error stopping agent' });
    }
  });

  // ========== LAUNCHPAD HUNTER SPECIFIC ROUTES ==========

  // GET /api/agent/launchpad-hunter/dashboard - Get launchpad hunter dashboard data
  fastify.get('/launchpad-hunter/dashboard', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check if user has access to launchpad hunter
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('ai_launchpad_hunter');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists || !userAgentDoc.data()?.unlocked) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      // Get recent alerts
      const alerts = await LaunchpadService.getUserAlerts(user.uid, 10);

      // Get user settings
      const settings = await LaunchpadService.getUserSettings(user.uid);

      // Get current presales (cached)
      const presales = await LaunchpadService.getCachedPresales();

      return {
        alerts,
        settings: {
          enabled: settings.enabled !== false,
          selectedChains: settings.selectedChains || ['ETH', 'BSC'],
          alertTypes: settings.alertTypes || ['upcoming', 'live'],
          maxAlertsPerDay: settings.maxAlertsPerDay || 10,
          riskFilter: settings.riskFilter || 'all', // 'all' or 'low'
          apiKeys: settings.apiKeys || {},
        },
        stats: {
          totalAlerts: alerts.length,
          activePresales: presales.filter(p => p.status === 'live').length,
          upcomingPresales: presales.filter(p => p.status === 'upcoming').length,
        }
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting launchpad hunter dashboard');
      return reply.code(500).send({ error: err.message || 'Error fetching dashboard data' });
    }
  });

  // GET /api/agent/launchpad-hunter/alerts - Get launchpad alerts history
  fastify.get('/launchpad-hunter/alerts', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = parseInt(request.query.limit || '50');

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('ai_launchpad_hunter');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists || !userAgentDoc.data()?.unlocked) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      const alerts = await LaunchpadService.getUserAlerts(user.uid, limit);
      return { alerts };
    } catch (err: any) {
      logger.error({ err }, 'Error getting launchpad alerts');
      return reply.code(500).send({ error: err.message || 'Error fetching alerts' });
    }
  });

  // GET /api/agent/launchpad-hunter/settings - Get launchpad hunter settings
  fastify.get('/launchpad-hunter/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('ai_launchpad_hunter');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists || !userAgentDoc.data()?.unlocked) {
        return reply.code(403).send({ error: 'Access denied: Launchpad Hunter not approved' });
      }

      const settings = await LaunchpadService.getUserSettings(user.uid);
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

  // PUT /api/agent/launchpad-hunter/settings - Update launchpad hunter settings
  fastify.put('/launchpad-hunter/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const settings = request.body;

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
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('ai_launchpad_hunter');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists || !userAgentDoc.data()?.unlocked) {
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

      await LaunchpadService.updateUserSettings(user.uid, validatedSettings);

      logger.info({ uid: user.uid }, 'Updated launchpad hunter settings');
      return { message: 'Settings updated successfully' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid settings', details: err.errors });
      }
      logger.error({ err }, 'Error updating launchpad settings');
      return reply.code(500).send({ error: err.message || 'Error updating settings' });
    }
  });

  // ========== CROWD CONSENSUS COPY TRADE ROUTES ==========

  // GET /api/agent/crowd-consensus/dashboard - Get crowd consensus dashboard data
  fastify.get('/crowd-consensus/dashboard', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check if user has access to crowd consensus agent
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      // Get recent signals (decision validations)
      const signals = await CrowdConsensusService.getUserSignals(user.uid, 20);

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

  // GET /api/agent/crowd-consensus/signals - Get crowd consensus signals
  fastify.get('/crowd-consensus/signals', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = parseInt(request.query.limit || '50');

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        logger.error({ uid: user.uid, route: '/crowd-consensus/signals' }, 'Access denied: Crowd Consensus document not found');
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      logger.info({ uid: user.uid, route: '/crowd-consensus/signals', limit }, 'Access granted: fetching signals');
      const signals = await CrowdConsensusService.getUserSignals(user.uid, limit);
      return { signals };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error getting crowd consensus signals');
      return reply.code(500).send({ error: err.message || 'Error fetching signals' });
    }
  });

  // GET /api/agent/crowd-consensus/trades - Get crowd consensus executed trades
  fastify.get('/crowd-consensus/trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = parseInt(request.query.limit || '50');

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        logger.error({ uid: user.uid, route: '/crowd-consensus/trades' }, 'Access denied: Crowd Consensus document not found');
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      logger.info({ uid: user.uid, route: '/crowd-consensus/trades', limit }, 'Access granted: fetching trades');
      const trades = await CrowdConsensusService.getUserTrades(user.uid, limit);
      return { trades };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error getting crowd consensus trades');
      return reply.code(500).send({ error: err.message || 'Error fetching trades' });
    }
  });

  // GET /api/agent/crowd-consensus/settings - Get crowd consensus settings
  fastify.get('/crowd-consensus/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const settings = await CrowdConsensusService.getUserSettings(user.uid);
      return { settings };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus settings');
      return reply.code(500).send({ error: err.message || 'Error fetching settings' });
    }
  });

  // PUT /api/agent/crowd-consensus/settings - Update crowd consensus settings
  fastify.put('/crowd-consensus/settings', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const settings = request.body;

      // Validate settings
      const settingsSchema = z.object({
        autoTradeEnabled: z.boolean().optional(),
        selectedAutoTradeExchange: z.string().optional(),
        riskPercent: z.number().min(0.1).max(10).optional(),
        stopLossPercent: z.number().min(0.1).max(20).optional(),
        takeProfitPercent: z.number().min(0.1).max(50).optional(),
        leverage: z.number().min(1).max(100).optional(),
        maxDailyLossPercent: z.number().min(1).max(20).optional(),
      });

      const validatedSettings = settingsSchema.parse(settings);

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      await CrowdConsensusService.saveUserSettings(user.uid, validatedSettings);

      logger.info({ uid: user.uid }, 'Updated crowd consensus settings');
      return { message: 'Settings updated successfully' };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid settings', details: err.errors });
      }
      logger.error({ err }, 'Error updating crowd consensus settings');
      return reply.code(500).send({ error: err.message || 'Error updating settings' });
    }
  });

  // POST /api/agent/crowd-consensus/validate - Validate trade setup
  fastify.post('/crowd-consensus/validate', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const input = request.body as any;

      // Validate the trade setup
      const decision = CrowdConsensusService.validateTradeSetup(input);

      // Save the signal for user's history
      const signal = {
        id: `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        pair: input.pair,
        decision,
        timestamp: new Date(),
      };

      await CrowdConsensusService.saveUserSignal(user.uid, signal);

      return decision;
    } catch (err: any) {
      logger.error({ err }, 'Error validating trade setup');
      return reply.code(500).send({ error: err.message || 'Error validating trade setup' });
    }
  });

  // GET /api/agent/trading-agent/diagnostics - Get trading agent diagnostics
  fastify.get('/trading-agent/diagnostics', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string; agentId?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = parseInt(request.query.limit || '20');
      let agentId = request.query.agentId;

      const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'trading-agent');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Trading Agent not approved' });
      }

      // Handle special case: if no agentId provided or it's 'trading-agent', find the user's active trading agent
      if (!agentId || agentId === 'trading-agent') {
        const { firestoreAdapter } = await import('../services/firestoreAdapter');
        const userAgents = await firestoreAdapter.getUserTradingAgents(user.uid);
        const activeAgent = userAgents.find((agent: any) => agent.status === 'ACTIVE');
        if (!activeAgent) {
          return { diagnostics: [] }; // Return empty array if no active agent
        }
        agentId = activeAgent.id;
      }

      // Verify the agent belongs to the user
      const { firestoreAdapter } = await import('../services/firestoreAdapter');
      const config = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!config || config.userId !== user.uid) {
        return reply.code(403).send({ error: 'Agent access denied' });
      }

      const { TradingAgent } = await import('../services/tradingAgent');
      const diagnostics = await TradingAgent.getDiagnostics(agentId, limit);

      return { diagnostics };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trading agent diagnostics');
      return reply.code(500).send({ error: err.message || 'Error fetching diagnostics' });
    }
  });

  // GET /api/agent/crowd-consensus/status - Get auto trade status
  fastify.get('/crowd-consensus/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      // Get auto trade status
      const settings = await CrowdConsensusService.getUserSettings(user.uid);
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

  // POST /api/agent/crowd-consensus/start - Start auto trade
  fastify.post('/crowd-consensus/start', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      // Check exchange connection
      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(user.uid);
      if (!exchangeStatus.connected) {
        return reply.code(400).send({
          error: 'Exchange not connected. Please connect an exchange in Settings first.',
          exchangeStatus
        });
      }

      // Start auto trade
      await CrowdConsensusService.setAutoTradeEnabled(user.uid, true);

      logger.info({ uid: user.uid }, 'Crowd consensus auto trade started');

      return {
        success: true,
        message: 'Crowd consensus auto trading started successfully',
        status: 'ACTIVE'
      };
    } catch (err: any) {
      logger.error({ err }, 'Error starting crowd consensus auto trade');
      return reply.code(500).send({ error: err.message || 'Error starting auto trade' });
    }
  });

  // POST /api/agent/crowd-consensus/stop - Stop auto trade
  fastify.post('/crowd-consensus/stop', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      const hasAccess = await AgentApprovalService.userHasAgentAccess(user.uid, 'crowd-consensus');
      if (!hasAccess) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      // Stop auto trade
      await CrowdConsensusService.setAutoTradeEnabled(user.uid, false);

      logger.info({ uid: user.uid }, 'Crowd consensus auto trade stopped');

      return {
        success: true,
        message: 'Crowd consensus auto trading stopped successfully',
        status: 'INACTIVE'
      };
    } catch (err: any) {
      logger.error({ err }, 'Error stopping crowd consensus auto trade');
      return reply.code(500).send({ error: err.message || 'Error stopping auto trade' });
    }
  });

  // GET /api/agent/crowd-consensus/skipped-trades - Get skipped/rejected trades
  fastify.get('/crowd-consensus/skipped-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = parseInt(request.query.limit || '50');

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const skippedTrades = await CrowdConsensusService.getSkippedTrades(user.uid, limit);
      return { skippedTrades };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus skipped trades');
      return reply.code(500).send({ error: err.message || 'Error fetching skipped trades' });
    }
  });

  // GET /api/agent/crowd-consensus/exchange-status - Get exchange connection status
  fastify.get('/crowd-consensus/exchange-status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // Check access
      const userAgentRef = (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('agents').doc('crowd_consensus_copy_trade');
      const userAgentDoc = await userAgentRef.get();

      if (!userAgentDoc.exists) {
        return reply.code(403).send({ error: 'Access denied: Crowd Consensus Copy Trade not approved' });
      }

      const exchangeStatus = await CrowdConsensusService.getExchangeConnectionStatus(user.uid);
      return { exchangeStatus };
    } catch (err: any) {
      logger.error({ err }, 'Error getting crowd consensus exchange status');
      return reply.code(500).send({ error: err.message || 'Error fetching exchange status' });
    }
  });

  // POST /api/agent/crowd-consensus/analyze - Trigger consensus analysis (admin only for now)
  fastify.post('/crowd-consensus/analyze', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const CrowdConsensusAnalyzer = (await import('../services/crowdConsensusAnalyzer')).default;

      // Check if analysis is already running
      if (CrowdConsensusAnalyzer.isAnalysisRunning()) {
        return reply.code(409).send({
          success: false,
          error: 'Analysis already running',
          status: 'RUNNING'
        });
      }

      // Trigger background analysis
      CrowdConsensusAnalyzer.startBackgroundAnalysis().catch((error) => {
        logger.error({ error: error.message }, 'Failed to start background consensus analysis');
      });

      logger.info('Triggered background crowd consensus analysis');

      return reply.code(200).send({
        success: true,
        message: 'Analysis started in background',
        status: 'RUNNING',
        lastRunAt: CrowdConsensusAnalyzer.getLastRunAt()?.toISOString(),
      });
    } catch (err: any) {
      logger.error({ err }, 'Error triggering crowd consensus analysis');
      return reply.code(500).send({ error: err.message || 'Error triggering analysis' });
    }
  });

  // POST /api/agent/crowd-consensus/execute - Execute Crowd Consensus agent for user (admin/manual)
  fastify.post('/crowd-consensus/execute', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { uid?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const targetUid = request.body.uid || user.uid;

      // Allow admin to execute for any user, regular users only for themselves
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin && targetUid !== user.uid) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const { CrowdConsensusScheduler } = await import('../services/crowdConsensusScheduler');
      const result = await CrowdConsensusScheduler.executeUserAgent(targetUid);

      if (result.success) {
        return reply.code(200).send(result);
      } else {
        return reply.code(400).send({ error: result.message });
      }
    } catch (err: any) {
      logger.error({ err }, 'Error executing crowd consensus agent');
      return reply.code(500).send({ error: err.message || 'Error executing agent' });
    }
  });
}
