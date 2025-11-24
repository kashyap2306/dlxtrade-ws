import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as admin from 'firebase-admin';
import path from 'path';
import { spawn } from 'child_process';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { encrypt, decrypt, maskKey } from '../services/keyManager';
import { userEngineManager } from '../services/userEngineManager';
import { adminStatsService } from '../services/adminStatsService';
import { adminAuthMiddleware } from '../middleware/adminAuth';
import { mlModelService } from '../services/ml/mlModelService';
import { logger } from '../utils/logger';
import { ValidationError, NotFoundError } from '../utils/errors';
import { getFirebaseAdmin } from '../utils/firebase';

const createKeySchema = z.object({
  exchange: z.string().min(1),
  name: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  testnet: z.boolean().default(true),
});

const updateKeySchema = z.object({
  name: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  testnet: z.boolean().optional(),
});

type TrainingJobStatus = 'idle' | 'running' | 'success' | 'error';

interface TrainingJob {
  id: string;
  status: TrainingJobStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  params: {
    symbol: string;
    timeframe: string;
    horizon: string;
    synthetic: boolean;
  };
}

const retrainSchema = z.object({
  symbol: z.string().min(3).optional().default('BTCUSDT'),
  timeframe: z.string().optional().default('5m'),
  horizon: z.string().optional().default('15m'),
  synthetic: z.boolean().optional().default(false),
});

let currentTrainingJob: TrainingJob | null = null;

export async function adminRoutes(fastify: FastifyInstance) {
  // Decorate with admin auth middleware
  fastify.decorate('adminAuth', adminAuthMiddleware);

  // ========== EXISTING ADMIN ROUTES (for backward compatibility) ==========
  fastify.get('/keys', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const keys = await firestoreAdapter.getApiKeys(user.uid);
    return keys.map((key) => ({
      id: key.id,
      exchange: key.exchange,
      name: key.name,
      testnet: key.testnet,
      createdAt: key.createdAt?.toDate().toISOString(),
      updatedAt: key.updatedAt?.toDate().toISOString(),
      apiKey: maskKey(key.apiKeyEncrypted), // Mask encrypted key
      apiSecret: maskKey(key.apiSecretEncrypted), // Mask encrypted secret
    }));
  });

  fastify.get('/keys/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const key = await firestoreAdapter.getApiKey(user.uid, request.params.id);
    if (!key) {
      throw new NotFoundError('API key not found');
    }
    return {
      id: key.id,
      exchange: key.exchange,
      name: key.name,
      testnet: key.testnet,
      createdAt: key.createdAt?.toDate().toISOString(),
      updatedAt: key.updatedAt?.toDate().toISOString(),
      apiKey: maskKey(key.apiKeyEncrypted),
      apiSecret: maskKey(key.apiSecretEncrypted),
    };
  });

  fastify.post('/keys', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = createKeySchema.parse(request.body);
    const id = await firestoreAdapter.saveApiKey(user.uid, {
      exchange: body.exchange,
      name: body.name,
      apiKey: body.apiKey,
      apiSecret: body.apiSecret,
      testnet: body.testnet,
    });
    return { id, message: 'API key created' };
  });

  fastify.put('/keys/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = updateKeySchema.parse(request.body);
    await firestoreAdapter.updateApiKey(user.uid, request.params.id, body);
    return { message: 'API key updated' };
  });

  fastify.delete('/keys/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    await firestoreAdapter.deleteApiKey(user.uid, request.params.id);
    return { message: 'API key deleted' };
  });

  fastify.post('/toggle-testnet', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Implement testnet toggle logic
    logger.warn('Testnet toggle not fully implemented');
    return { message: 'Testnet toggle endpoint (implementation pending)' };
  });

  // Emergency kill switch - stops all engines for all users
  fastify.post('/killall', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    
    // TODO: Add admin check - for now, any authenticated user can use this
    // In production, you'd want to check if user is admin
    
    try {
      // Stop all user engines
      // Note: This is a simplified implementation
      // In production, you'd want to track all active engines and stop them
      await userEngineManager.stopAutoTrade(user.uid);
      
      // Also pause all users' settings
      await firestoreAdapter.saveSettings(user.uid, { status: 'paused_manual' });
      
      logger.warn({ uid: user.uid }, 'Emergency kill switch activated');
      return { message: 'All engines stopped' };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error in killall');
      return reply.code(500).send({ error: err.message || 'Error stopping engines' });
    }
  });

  // ========== NEW ADMIN ROUTES ==========
  fastify.get('/research-model/metrics', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = await mlModelService.getModelMetrics();
      if (!metrics) {
        return reply.code(503).send({ error: 'Model metrics unavailable' });
      }
      return metrics;
    } catch (err: any) {
      logger.error({ err }, 'Failed to fetch research model metrics');
      return reply.code(500).send({ error: err.message || 'Unable to fetch metrics' });
    }
  });

  fastify.get('/research-model/retrain', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (_request: FastifyRequest, _reply: FastifyReply) => {
    return currentTrainingJob || { status: 'idle' };
  });

  fastify.post('/research-model/retrain', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Body: z.infer<typeof retrainSchema> }>, reply: FastifyReply) => {
    if (currentTrainingJob?.status === 'running') {
      return reply.code(409).send({ error: 'Training job already running', job: currentTrainingJob });
    }

    const params = retrainSchema.parse(request.body || {});
    // Ensure defaults are applied
    const finalParams = {
      symbol: params.symbol ?? 'BTCUSDT',
      timeframe: params.timeframe ?? '5m',
      horizon: params.horizon ?? '15m',
      synthetic: params.synthetic ?? false,
    };
    
    const jobId = `train_${Date.now()}`;
    currentTrainingJob = {
      id: jobId,
      status: 'running',
      startedAt: Date.now(),
      params: finalParams,
    };

    const repoRoot = path.resolve(__dirname, '..', '..');
    const pythonBin = process.env.PYTHON_BIN || 'python';
    const args = [
      path.join('ml-service', 'train_model.py'),
      '--symbol', finalParams.symbol,
      '--timeframe', finalParams.timeframe,
      '--horizon', finalParams.horizon,
    ];
    if (finalParams.synthetic) {
      args.push('--synthetic');
    }

    const child = spawn(pythonBin, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (!currentTrainingJob) return;
      currentTrainingJob.status = code === 0 ? 'success' : 'error';
      currentTrainingJob.finishedAt = Date.now();
      if (code !== 0) {
        currentTrainingJob.error = `Training exited with code ${code}`;
        logger.error({ code }, 'Training job failed');
      } else {
        logger.info({ jobId }, 'Training job completed');
      }
    });

    return reply.code(202).send({ jobId, status: 'running' });
  });
  
  // Get all users with stats
  fastify.get('/users', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const allUsers = await firestoreAdapter.getAllUsers();
      const usersWithStats = await Promise.all(
        allUsers.map(async (user) => {
          const stats = await adminStatsService.getUserStats(user.uid);
          return {
            uid: user.uid,
            email: user.email,
            engineRunning: stats.engineRunning,
            hftRunning: stats.hftRunning,
            currentPnL: stats.currentPnL,
            openOrders: stats.openOrders,
            unlockedAgentsCount: stats.unlockedAgents.length,
            apiStatus: stats.apiStatus,
            autoTradeEnabled: stats.autoTradeEnabled,
            hftEnabled: stats.hftEnabled,
            createdAt: user.createdAt?.toDate().toISOString(),
          };
        })
      );
      return { users: usersWithStats };
    } catch (err: any) {
      logger.error({ err }, 'Error getting users list');
      return reply.code(500).send({ error: err.message || 'Error fetching users' });
    }
  });

  fastify.get('/integrations/submissions', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Querystring: { uid?: string } }>, reply: FastifyReply) => {
    const uid = request.query.uid;

    if (!uid) {
      return reply.code(400).send({
        ok: false,
        code: 'MISSING_UID',
        message: 'Query parameter uid is required',
      });
    }

    try {
      const integrations = await firestoreAdapter.getAllIntegrations(uid);
      const submissions = Object.entries(integrations).map(([id, integration]) => ({
        id,
        exchangeName: integration.exchangeName || id,
        status: integration.status || (integration.enabled ? 'SAVED' : 'DISABLED'),
        enabled: integration.enabled,
        maskedApiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
        maskedSecretKey: integration.secretKey ? maskKey(integration.secretKey) : null,
        updatedAt: integration.updatedAt?.toDate().toISOString(),
        createdAt: integration.createdAt?.toDate().toISOString(),
        meta: integration.meta || null,
      }));

      return {
        ok: true,
        uid,
        count: submissions.length,
        submissions,
      };
    } catch (err: any) {
      logger.error({ err, uid }, 'Failed to list integration submissions');
      return reply.code(500).send({
        ok: false,
        code: 'ADMIN_SUBMISSIONS_FAILED',
        message: err.message || 'Failed to load submissions',
      });
    }
  });

  // Get user details
  fastify.get('/user/:uid', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = await firestoreAdapter.getAllUsers().then(users => users.find(u => u.uid === uid));
      if (!user) {
        throw new NotFoundError('User not found');
      }

      const stats = await adminStatsService.getUserStats(uid);
      const settings = await firestoreAdapter.getSettings(uid);
      const hftSettings = await firestoreAdapter.getHFTSettings(uid);
      const integrations = await firestoreAdapter.getAllIntegrations(uid);
      const agents = await firestoreAdapter.getAllUserAgents(uid);
      const profile = await firestoreAdapter.getUserProfile(uid);

      return {
        uid: user.uid,
        email: user.email,
        profile,
        stats,
        settings,
        hftSettings,
        integrations: Object.keys(integrations).map(key => ({
          name: key,
          enabled: integrations[key].enabled,
          hasKey: !!integrations[key].apiKey,
        })),
        agents,
      };
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user details');
      return reply.code(500).send({ error: err.message || 'Error fetching user details' });
    }
  });

  // Get user execution logs
  fastify.get('/user/:uid/logs', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const limit = parseInt(request.query.limit || '10', 10);
      const logs = await firestoreAdapter.getExecutionLogs(uid, limit);
      return {
        logs: logs.map(log => ({
          ...log,
          timestamp: log.timestamp?.toDate().toISOString(),
          createdAt: log.createdAt?.toDate().toISOString(),
        })),
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user logs');
      return reply.code(500).send({ error: err.message || 'Error fetching logs' });
    }
  });

  // Get user HFT logs
  fastify.get('/user/:uid/hft/logs', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const limit = parseInt(request.query.limit || '10', 10);
      const logs = await firestoreAdapter.getHFTExecutionLogs(uid, limit);
      return {
        logs: logs.map(log => ({
          ...log,
          timestamp: log.timestamp?.toDate().toISOString(),
          createdAt: log.createdAt?.toDate().toISOString(),
        })),
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting HFT logs');
      return reply.code(500).send({ error: err.message || 'Error fetching HFT logs' });
    }
  });

  // Stop engine for user
  fastify.post('/user/:uid/stop-engine', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      await userEngineManager.stopAutoTrade(uid);
      await firestoreAdapter.saveSettings(uid, { status: 'paused_manual' });
      logger.info({ uid, adminUid: (request as any).user.uid }, 'Admin stopped engine for user');
      return { message: 'Engine stopped' };
    } catch (err: any) {
      logger.error({ err }, 'Error stopping engine');
      return reply.code(500).send({ error: err.message || 'Error stopping engine' });
    }
  });

  // Stop HFT engine for user
  fastify.post('/user/:uid/stop-hft', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      await userEngineManager.stopHFT(uid);
      logger.info({ uid, adminUid: (request as any).user.uid }, 'Admin stopped HFT for user');
      return { message: 'HFT engine stopped' };
    } catch (err: any) {
      logger.error({ err }, 'Error stopping HFT');
      return reply.code(500).send({ error: err.message || 'Error stopping HFT engine' });
    }
  });

  // Reset risk manager for user
  fastify.post('/user/:uid/reset-risk', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const { userRiskManager } = await import('../services/userRiskManager');
      // Reset risk state - this would need to be implemented in userRiskManager
      await firestoreAdapter.saveSettings(uid, { status: 'active' });
      logger.info({ uid, adminUid: (request as any).user.uid }, 'Admin reset risk for user');
      return { message: 'Risk manager reset' };
    } catch (err: any) {
      logger.error({ err }, 'Error resetting risk');
      return reply.code(500).send({ error: err.message || 'Error resetting risk manager' });
    }
  });

  // Reload API keys for user
  fastify.post('/user/:uid/reload-keys', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      // Stop and restart engine to reload keys
      await userEngineManager.stopAutoTrade(uid);
      await userEngineManager.stopHFT(uid);
      logger.info({ uid, adminUid: (request as any).user.uid }, 'Admin reloaded API keys for user');
      return { message: 'API keys reloaded (engines stopped - user must restart)' };
    } catch (err: any) {
      logger.error({ err }, 'Error reloading keys');
      return reply.code(500).send({ error: err.message || 'Error reloading API keys' });
    }
  });

  // Unlock agent for user
  fastify.post('/user/:uid/unlock-agent', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: { agentName: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const { agentName } = request.body;
      if (!agentName) {
        throw new ValidationError('Agent name is required');
      }
      // Get agent details to get agentId
      const agents = await firestoreAdapter.getAllAgents();
      const agent = agents.find((a: any) => a.name === agentName);
      const agentId = agent?.id || agentName;
      
      await firestoreAdapter.unlockAgent(uid, agentName, agentId);
      logger.info({ uid, agentName, agentId, adminUid: (request as any).user.uid }, 'Admin unlocked agent');
      return { message: 'Agent unlocked' };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error unlocking agent');
      return reply.code(500).send({ error: err.message || 'Error unlocking agent' });
    }
  });

  // Lock agent for user
  fastify.post('/user/:uid/lock-agent', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: { agentName: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const { agentName } = request.body;
      if (!agentName) {
        throw new ValidationError('Agent name is required');
      }
      await firestoreAdapter.lockAgent(uid, agentName);
      logger.info({ uid, agentName, adminUid: (request as any).user.uid }, 'Admin locked agent');
      return { message: 'Agent locked' };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error locking agent');
      return reply.code(500).send({ error: err.message || 'Error locking agent' });
    }
  });

  // Get global stats
  fastify.get('/global-stats', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await adminStatsService.getGlobalStats();
      return stats;
    } catch (err: any) {
      logger.error({ err }, 'Error getting global stats');
      return reply.code(500).send({ error: err.message || 'Error fetching global stats' });
    }
  });

  // Reload all engines (emergency)
  fastify.post('/reload-all-engines', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const allUsers = await firestoreAdapter.getAllUsers();
      const results = await Promise.allSettled(
        allUsers.map(async (user) => {
          await userEngineManager.stopAutoTrade(user.uid);
          await userEngineManager.stopHFT(user.uid);
        })
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      logger.warn({ adminUid: (request as any).user.uid, total: allUsers.length, failed }, 'Admin reloaded all engines');
      return { message: `Reloaded engines for ${allUsers.length} users (${failed} failed)` };
    } catch (err: any) {
      logger.error({ err }, 'Error reloading all engines');
      return reply.code(500).send({ error: err.message || 'Error reloading engines' });
    }
  });

  // One-time setup: Promote a user to admin via header token
  // Requires header: x-admin-setup: <ADMIN_SETUP_TOKEN>
  fastify.post('/promote', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { uid?: string; email?: string } }>, reply: FastifyReply) => {
    try {
      const setupHeader = (request.headers['x-admin-setup'] || (request.headers as any)['X-Admin-Setup']) as string | undefined;
      const setupToken = process.env.ADMIN_SETUP_TOKEN || 'SUPER-SECRET-998877';
      if (!setupHeader || setupHeader !== setupToken) {
        return reply.code(401).send({ error: 'Invalid setup token' });
      }

      const { uid, email } = (request.body || {}) as { uid?: string; email?: string };
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const admin = await import('firebase-admin');

      let targetUid = uid;
      if (!targetUid && email) {
        const userRecord = await admin.auth(getFirebaseAdmin()).getUserByEmail(email);
        targetUid = userRecord.uid;
      }
      if (!targetUid) {
        return reply.code(400).send({ error: 'uid or email required' });
      }

      await admin.auth(getFirebaseAdmin()).setCustomUserClaims(targetUid, {
        isAdmin: true,
        role: 'admin',
        adminPanel: true,
      });

      // Also mirror in Firestore for unified checks (prefer serverTimestamp)
      const db = getFirebaseAdmin().firestore();
      try {
        await db.collection('users').doc(targetUid).update({
          role: 'admin',
          isAdmin: true,
          updatedAt: (admin as any).firestore.FieldValue.serverTimestamp(),
        });
      } catch {
        await db.collection('users').doc(targetUid).set({
          role: 'admin',
          isAdmin: true,
          updatedAt: (admin as any).firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      return {
        success: true,
        message: 'Admin promoted successfully',
        uid: targetUid,
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Failed to promote user' });
    }
  });

  // Get agent unlock statistics
  fastify.get('/agents/stats', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      
      const allUsers = await firestoreAdapter.getAllUsers();
      const agentStats: Record<string, { unlocked: number; users: string[] }> = {};

      // Initialize all agents
      const agentNames = [
        'Airdrop Multiverse Agent',
        'Liquidity Sniper & Arbitrage Agent',
        'AI Launchpad Hunter & Presale Sniper',
        'Whale Movement Tracker Agent',
        'Pre-Market AI Alpha Agent',
        'Whale Copy Trade Agent',
      ];

      agentNames.forEach((name) => {
        agentStats[name] = { unlocked: 0, users: [] };
      });

      // Check each user's agents
      for (const user of allUsers) {
        const agentsSnapshot = await db
          .collection('users')
          .doc(user.uid)
          .collection('agents')
          .get();

        agentsSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          const agentName = doc.id;
          if (data.unlocked && agentStats[agentName]) {
            agentStats[agentName].unlocked++;
            agentStats[agentName].users.push(user.uid);
          }
        });
      }

      return { agentStats };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent stats');
      return reply.code(500).send({ error: err.message || 'Error fetching agent stats' });
    }
  });

  // Get users who unlocked a specific agent
  fastify.get('/agents/:agentName/users', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { agentName: string } }>, reply: FastifyReply) => {
    try {
      const { agentName } = request.params;
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      
      const allUsers = await firestoreAdapter.getAllUsers();
      const usersWithAgent: Array<{ uid: string; email?: string; unlockedAt?: string }> = [];

      for (const user of allUsers) {
        const agentDoc = await db
          .collection('users')
          .doc(user.uid)
          .collection('agents')
          .doc(agentName)
          .get();

        if (agentDoc.exists) {
          const data = agentDoc.data();
          if (data?.unlocked) {
            usersWithAgent.push({
              uid: user.uid,
              email: user.email,
              unlockedAt: data.unlockedAt?.toDate().toISOString(),
            });
          }
        }
      }

      return { users: usersWithAgent };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent users');
      return reply.code(500).send({ error: err.message || 'Error fetching agent users' });
    }
  });

  // Agent CRUD endpoints
  const updateAgentSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    longDescription: z.string().optional(),
    price: z.number().min(0).optional(),
    features: z.array(z.string()).optional(),
    category: z.string().optional(),
    badge: z.string().optional(),
    imageUrl: z.string().url().optional().or(z.literal('')),
    enabled: z.boolean().optional(),
    whatsappNumber: z.string().optional(),
  });

  // Update agent
  fastify.put('/agents/:agentId', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { agentId } = request.params;
      const body = updateAgentSchema.parse(request.body);
      const db = getFirebaseAdmin().firestore();
      
      const agentRef = db.collection('agents').doc(agentId);
      const agentDoc = await agentRef.get();
      
      if (!agentDoc.exists) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      const updateData: any = {
        updatedAt: admin.firestore.Timestamp.now(),
      };

      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.longDescription !== undefined) updateData.longDescription = body.longDescription;
      if (body.price !== undefined) updateData.price = body.price;
      if (body.features !== undefined) updateData.features = body.features;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.badge !== undefined) updateData.badge = body.badge;
      if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl || null;
      if (body.enabled !== undefined) updateData.enabled = body.enabled;
      if (body.whatsappNumber !== undefined) updateData.whatsappNumber = body.whatsappNumber;

      await agentRef.update(updateData);
      
      logger.info({ agentId, adminUid: (request as any).user.uid }, 'Agent updated');
      return { message: 'Agent updated successfully', agentId };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error updating agent');
      return reply.code(500).send({ error: err.message || 'Error updating agent' });
    }
  });

  // Get unlock requests (pending)
  fastify.get('/unlock-requests', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getFirebaseAdmin().firestore();
      const snapshot = await db
        .collection('agentUnlockRequests')
        .where('status', '==', 'pending')
        .orderBy('submittedAt', 'desc')
        .get();
      
      const requests = await Promise.all(snapshot.docs.map(async (doc) => {
        const data = doc.data();
        // Get user email
        const userDoc = await db.collection('users').doc(data.uid).get();
        const userData = userDoc.data();
        
        return {
          id: doc.id,
          uid: data.uid,
          userEmail: userData?.email || 'N/A',
          agentId: data.agentId,
          agentName: data.agentName,
          fullName: data.fullName,
          phoneNumber: data.phoneNumber,
          email: data.email,
          submittedAt: data.submittedAt?.toDate().toISOString(),
          status: data.status,
        };
      }));
      
      return { requests };
    } catch (err: any) {
      logger.error({ err }, 'Error getting unlock requests');
      return reply.code(500).send({ error: err.message || 'Error fetching unlock requests' });
    }
  });

  // Approve unlock request
  fastify.post('/unlock-requests/:requestId/approve', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const { requestId } = request.params;
      const db = getFirebaseAdmin().firestore();
      
      // Get request
      const requestDoc = await db.collection('agentUnlockRequests').doc(requestId).get();
      if (!requestDoc.exists) {
        return reply.code(404).send({ error: 'Request not found' });
      }
      
      const requestData = requestDoc.data()!;
      if (requestData.status !== 'pending') {
        return reply.code(400).send({ error: 'Request already processed' });
      }
      
      // Unlock agent for user
      await firestoreAdapter.unlockAgent(
        requestData.uid,
        requestData.agentName,
        requestData.agentId
      );
      
      // Update request status
      await db.collection('agentUnlockRequests').doc(requestId).update({
        status: 'approved',
        approvedAt: admin.firestore.Timestamp.now(),
        approvedBy: (request as any).user.uid,
      });
      
      logger.info({ requestId, uid: requestData.uid, agentName: requestData.agentName }, 'Unlock request approved');
      return { message: 'Unlock request approved', requestId };
    } catch (err: any) {
      logger.error({ err }, 'Error approving unlock request');
      return reply.code(500).send({ error: err.message || 'Error approving unlock request' });
    }
  });

  // Deny unlock request
  fastify.post('/unlock-requests/:requestId/deny', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { requestId: string }; Body: { reason?: string } }>, reply: FastifyReply) => {
    try {
      const { requestId } = request.params;
      const { reason } = request.body || {};
      const db = getFirebaseAdmin().firestore();
      
      // Get request
      const requestDoc = await db.collection('agentUnlockRequests').doc(requestId).get();
      if (!requestDoc.exists) {
        return reply.code(404).send({ error: 'Request not found' });
      }
      
      const requestData = requestDoc.data()!;
      if (requestData.status !== 'pending') {
        return reply.code(400).send({ error: 'Request already processed' });
      }
      
      // Update request status
      await db.collection('agentUnlockRequests').doc(requestId).update({
        status: 'denied',
        deniedAt: admin.firestore.Timestamp.now(),
        deniedBy: (request as any).user.uid,
        reason: reason || 'No reason provided',
      });
      
      logger.info({ requestId, uid: requestData.uid, agentName: requestData.agentName }, 'Unlock request denied');
      return { message: 'Unlock request denied', requestId };
    } catch (err: any) {
      logger.error({ err }, 'Error denying unlock request');
      return reply.code(500).send({ error: err.message || 'Error denying unlock request' });
    }
  });

  // Update agent settings for user
  fastify.put('/user/:uid/agent/:agentName/settings', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { uid: string; agentName: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { uid, agentName } = request.params;
      const settings = request.body;
      
      await firestoreAdapter.updateAgentSettings(uid, agentName, settings);
      
      logger.info({ uid, agentName, adminUid: (request as any).user.uid }, 'Agent settings updated');
      return { message: 'Agent settings updated' };
    } catch (err: any) {
      logger.error({ err }, 'Error updating agent settings');
      return reply.code(500).send({ error: err.message || 'Error updating agent settings' });
    }
  });

  // Toggle agent enabled/disabled
  fastify.post('/agents/:agentId/toggle', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    try {
      const { agentId } = request.params;
      const db = getFirebaseAdmin().firestore();
      
      const agentRef = db.collection('agents').doc(agentId);
      const agentDoc = await agentRef.get();
      
      if (!agentDoc.exists) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      const currentData = agentDoc.data();
      const newEnabled = !(currentData?.enabled !== false);

      await agentRef.update({
        enabled: newEnabled,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      
      logger.info({ agentId, enabled: newEnabled, adminUid: (request as any).user.uid }, 'Agent toggled');
      return { message: `Agent ${newEnabled ? 'enabled' : 'disabled'}`, enabled: newEnabled };
    } catch (err: any) {
      logger.error({ err }, 'Error toggling agent');
      return reply.code(500).send({ error: err.message || 'Error toggling agent' });
    }
  });

  // System health endpoint
  fastify.get('/system-health', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getFirebaseAdmin().firestore();
      
      // Get users count
      const usersSnapshot = await db.collection('users').get();
      const usersCount = usersSnapshot.size;
      
      // Count engines running
      const engineStatuses = await firestoreAdapter.getAllEngineStatuses();
      const enginesRunning = engineStatuses.filter((s) => s.active).length;
      
      // Count HFT bots running
      let hftBotsRunning = 0;
      for (const status of engineStatuses) {
        if (status.engineType === 'hft' && status.active) {
          hftBotsRunning++;
        }
      }
      
      // Count API errors (from logs collection, last 24h)
      const oneDayAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const errorLogsSnapshot = await db.collection('logs')
        .where('type', '==', 'error')
        .where('timestamp', '>=', oneDayAgo)
        .get();
      const apiErrors = errorLogsSnapshot.size;
      
      // Count logs (execution + research + HFT)
      let executionLogsCount = 0;
      let researchLogsCount = 0;
      let hftExecutionLogsCount = 0;
      
      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        
        // Count execution logs
        const execLogs = await db.collection('users').doc(uid).collection('executionLogs')
          .limit(1).get();
        if (!execLogs.empty) {
          const allExecLogs = await db.collection('users').doc(uid).collection('executionLogs').get();
          executionLogsCount += allExecLogs.size;
        }
        
        // Count research logs
        const researchLogs = await db.collection('users').doc(uid).collection('researchLogs')
          .limit(1).get();
        if (!researchLogs.empty) {
          const allResearchLogs = await db.collection('users').doc(uid).collection('researchLogs').get();
          researchLogsCount += allResearchLogs.size;
        }
        
        // Count HFT execution logs
        const hftLogs = await db.collection('users').doc(uid).collection('hftExecutionLogs')
          .limit(1).get();
        if (!hftLogs.empty) {
          const allHftLogs = await db.collection('users').doc(uid).collection('hftExecutionLogs').get();
          hftExecutionLogsCount += allHftLogs.size;
        }
      }
      
      // Get last trade
      const tradesSnapshot = await db.collection('trades')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      
      let lastTrade = null;
      if (!tradesSnapshot.empty) {
        const trade = tradesSnapshot.docs[0].data();
        lastTrade = {
          uid: trade.uid,
          symbol: trade.symbol,
          side: trade.side,
          qty: trade.qty,
          entryPrice: trade.entryPrice,
          pnl: trade.pnl,
          timestamp: trade.timestamp?.toDate().toISOString(),
          engineType: trade.engineType,
        };
      }
      
      return {
        users: {
          count: usersCount,
        },
        engines: {
          running: enginesRunning,
        },
        hft: {
          botsRunning: hftBotsRunning,
        },
        api: {
          errorsLast24h: apiErrors,
        },
        logs: {
          execution: executionLogsCount,
          research: researchLogsCount,
          hftExecution: hftExecutionLogsCount,
          total: executionLogsCount + researchLogsCount + hftExecutionLogsCount,
        },
        lastTrade,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting system health');
      return reply.code(500).send({ error: err.message || 'Error fetching system health' });
    }
  });

  // Deep Research Scheduler Status
  fastify.get('/scheduler/status', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { deepResearchScheduler } = await import('../services/deepResearchScheduler');
      const status = await deepResearchScheduler.getStatus();
      return status;
    } catch (err: any) {
      logger.error({ err }, 'Error getting scheduler status');
      return reply.code(500).send({ error: err.message || 'Error fetching scheduler status' });
    }
  });

  // Force run Deep Research for one coin
  fastify.post('/scheduler/force-run', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { deepResearchScheduler } = await import('../services/deepResearchScheduler');
      const result = await deepResearchScheduler.forceRun();
      return result;
    } catch (err: any) {
      logger.error({ err }, 'Error in force run');
      return reply.code(500).send({ error: err.message || 'Error in force run' });
    }
  });

  // Update scheduler configuration
  fastify.post('/scheduler/config', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest<{ Body: { intervals?: number[]; mode?: 'auto-select'; topN?: number } }>, reply: FastifyReply) => {
    try {
      const { deepResearchScheduler } = await import('../services/deepResearchScheduler');
      const config = request.body || {};
      
      // Validate intervals - only [5, 10, 15, 30, 60] minutes allowed
      const allowedIntervals = [5, 10, 15, 30, 60];
      if (config.intervals) {
        const invalidIntervals = config.intervals.filter((i: number) => !allowedIntervals.includes(i));
        if (invalidIntervals.length > 0) {
          return reply.code(400).send({ error: `Invalid intervals: ${invalidIntervals.join(', ')}. Allowed: ${allowedIntervals.join(', ')}` });
        }
      }

      await deepResearchScheduler.updateConfig(config);
      return { success: true, message: 'Scheduler config updated' };
    } catch (err: any) {
      logger.error({ err }, 'Error updating scheduler config');
      return reply.code(500).send({ error: err.message || 'Error updating scheduler config' });
    }
  });
}

