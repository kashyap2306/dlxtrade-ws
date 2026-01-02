import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { agentAccessMiddleware } from '../middleware/agentAuth';

const unlockAgentSchema = z.object({
  agentName: z.string().min(1),
});

export async function agentsRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] GET /api/agents");
  console.log("[ROUTE READY] POST /api/agents/unlock");
  console.log("[ROUTE READY] GET /api/agents/unlocks");
  console.log("[ROUTE READY] GET /api/agents/unlocked");
  console.log("[ROUTE READY] GET /api/agents/:id");
  console.log("[ROUTE READY] POST /api/agents/submit-unlock-request");
  console.log("[ROUTE READY] PUT /api/agents/:agentId/settings");
  console.log("[ROUTE READY] GET /api/users/:uid/agents");
  console.log("[ROUTE READY] POST /api/agents/purchase-request");
  console.log("[ROUTE READY] GET /api/admin/agents/purchase-requests");
  console.log("[ROUTE READY] POST /api/admin/agents/approve");
  console.log("[ROUTE READY] GET /api/users/:uid/features");

  // GET /api/agents - Get user's available agents
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const t0 = Date.now();
    console.log("[AGENTS_GET_START]", { timestamp: new Date().toISOString(), uid: (request as any).user?.uid });

    try {
      const user = (request as any).user;
      console.log("[UID_ASSERT]", { authUid: user.uid });

      if (!user.uid) {
        throw new Error("Authentication failed: request.user.uid is missing");
      }

      const t1 = Date.now();
      console.log("[AGENTS_AUTH_COMPLETE]", { authTime: t1 - t0, uid: user.uid });

      // CRITICAL: reply.send() MUST be called exactly once - ensure early return
      let responseSent = false;

      const t2 = Date.now();
      console.log("[AGENTS_FIRESTORE_START]", { timeSinceAuth: t2 - t1 });

      // ISOLATE FIRESTORE READ: No heavy logic here - must complete within <500ms
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Firestore operation timeout')), 1500); // 1.5 second timeout
      });

      const firestoreOperation = async () => {
        // Use same base data source as /api/agents/unlocked: users/{uid}/agents
        return await firestoreAdapter.getUserAgents(user.uid);
      };

      let agents;
      try {
        agents = await Promise.race([firestoreOperation(), timeoutPromise]);
        const t3 = Date.now();
        console.log("[AGENTS_FIRESTORE_COMPLETE]", { firestoreTime: t3 - t2, agentCount: agents?.length || 0 });
      } catch (firestoreErr: any) {
        console.error("[AGENTS_FIRESTORE_TIMEOUT]", { error: firestoreErr?.message, time: Date.now() - t2 });
        console.log("[AGENTS_TIMEOUT_FALLBACK_USED]", { uid: user.uid, route: '/api/agents' });
        if (!responseSent) {
          responseSent = true;
          return reply.send({ agents: [] }); // Return empty array on timeout
        }
        return;
      }

      // CRITICAL: Send response immediately after Firestore read - no decryption/normalization loops
      const t4 = Date.now();
      console.log("[AGENTS_RESPONSE_SEND]", {
        totalTime: t4 - t0,
        firestoreTime: t4 - t2,
        agentsCount: agents?.length || 0
      });

      if (!responseSent) {
        responseSent = true;
        return reply.send({ agents: agents || [] });
      }

    } catch (err: any) {
      const errorTime = Date.now() - t0;
      console.error("[AGENTS_ERROR]", { error: err.message, totalTime: errorTime });
      logger.error({ err }, 'Error getting user agents');
      return reply.code(500).send({ error: err.message || 'Error fetching agents' });
    }
  });

  // POST /api/agents/unlock - Unlock an agent for user
  fastify.post('/unlock', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = unlockAgentSchema.parse(request.body);

      // Unlock agent in user's subcollection
      await firestoreAdapter.unlockAgent(user.uid, body.agentName);

      // Also create entry in agentUnlocks collection
      await firestoreAdapter.createAgentUnlock(user.uid, body.agentName, {
        unlockedBy: user.uid,
      });

      // Update user's unlockedAgents array
      const userData = await firestoreAdapter.getUser(user.uid);
      const currentUnlocked = userData?.unlockedAgents || [];
      if (!currentUnlocked.includes(body.agentName)) {
        await firestoreAdapter.createOrUpdateUser(user.uid, {
          unlockedAgents: [...currentUnlocked, body.agentName],
        });
      }

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'AGENT_UNLOCKED', { agentName: body.agentName });

      return { message: 'Agent unlocked successfully', agentName: body.agentName };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error unlocking agent');
      return reply.code(500).send({ error: err.message || 'Error unlocking agent' });
    }
  });

  // GET /api/agents/unlocks - Get user's unlocked agents
  fastify.get('/unlocks', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const unlocks = await firestoreAdapter.getUserAgentUnlocks(user.uid);
      return { unlocks };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent unlocks');
      return reply.code(500).send({ error: err.message || 'Error fetching agent unlocks' });
    }
  });

  // GET /api/agents/unlocked - Get user's unlocked agent names (HARDENED: 200ms timeout)
  fastify.get('/unlocked', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;

    if (!user?.uid) {
      logger.warn({}, 'GET /agents/unlocked - missing uid, returning safe default');
      return reply.send({ unlocked: [] });
    }

    try {
      // HARDENED: 200ms timeout - return safe default immediately
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation timeout')), 200);
      });

      const firestoreOperation = async () => {
        return await firestoreAdapter.getUserUnlockedAgents(user.uid);
      };

      const unlocked = await Promise.race([firestoreOperation(), timeoutPromise]) as any[];
      logger.info({ uid: user.uid, count: unlocked?.length || 0, duration: Date.now() - startTime }, 'GET /agents/unlocked success');
      return reply.send({ unlocked: unlocked || [] });
    } catch (err: any) {
      logger.warn({ uid: user.uid, error: err.message, duration: Date.now() - startTime }, 'GET /agents/unlocked timeout/error - returning safe default');
      // SAFE DEFAULT: Always return empty array
      return reply.send({ unlocked: [] });
    }
  });

  // GET /api/agents/:id - Get single agent by ID
  fastify.get('/:id', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const agent = await firestoreAdapter.getAgent(id);
      if (!agent) {
        return reply.code(404).send({ error: 'Agent not found' });
      }
      return { agent };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agent');
      return reply.code(500).send({ error: err.message || 'Error fetching agent' });
    }
  });

  // POST /api/agents/submit-unlock-request - Submit unlock request (creates purchase)
  fastify.post('/submit-unlock-request', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { agentId: string; agentName: string; fullName: string; phoneNumber: string; email: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({
        agentId: z.string().min(1),
        agentName: z.string().min(1),
        fullName: z.string().min(1),
        phoneNumber: z.string().min(1),
        email: z.string().email(),
      }).parse(request.body);

      // Save purchase request to Firestore
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const admin = await import('firebase-admin');
      const db = getFirebaseAdmin().firestore();

      const purchaseRef = db.collection('agentPurchases').doc();
      await purchaseRef.set({
        id: purchaseRef.id,
        uid: user.uid,
        agentId: body.agentId,
        agentName: body.agentName,
        fullName: body.fullName,
        phoneNumber: body.phoneNumber,
        email: body.email,
        status: 'pending',
        submittedAt: admin.firestore.Timestamp.now(),
        createdAt: admin.firestore.Timestamp.now(),
      });

      // Also create unlock request entry for backward compatibility
      const unlockRequestRef = db.collection('agentUnlockRequests').doc();
      await unlockRequestRef.set({
        uid: user.uid,
        agentId: body.agentId,
        agentName: body.agentName,
        fullName: body.fullName,
        phoneNumber: body.phoneNumber,
        email: body.email,
        submittedAt: admin.firestore.Timestamp.now(),
        status: 'pending',
      });

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'AGENT_PURCHASE_REQUEST_SUBMITTED', {
        agentId: body.agentId,
        agentName: body.agentName,
        purchaseId: purchaseRef.id,
      });

      logger.info({ uid: user.uid, agentName: body.agentName, purchaseId: purchaseRef.id }, 'Agent purchase request submitted');
      return {
        success: true,
        message: 'Purchase request submitted successfully',
        purchaseId: purchaseRef.id
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error submitting purchase request');
      return reply.code(500).send({ error: err.message || 'Error submitting purchase request' });
    }
  });

  // PUT /api/agents/:agentId/settings - Update agent settings for user
  fastify.put('/:agentId/settings', {
    preHandler: [fastify.authenticate, agentAccessMiddleware],
  }, async (request: FastifyRequest<{ Params: { agentId: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { agentId } = request.params;
      const settings = request.body;

      // Get agent name from agentId
      const allAgents = await firestoreAdapter.getAllAgents();
      const agent = allAgents.find((a: any) => a.id === agentId);
      if (!agent) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      // Update agent settings in user's subcollection
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const admin = await import('firebase-admin');
      const db = getFirebaseAdmin().firestore();
      const userAgentRef = db.collection('users').doc(user.uid).collection('agents').doc(agent.id);
      const updateData: any = {
        updatedAt: admin.firestore.Timestamp.now(),
      };
      Object.assign(updateData, settings);
      await userAgentRef.set(updateData, { merge: true });

      logger.info({ uid: user.uid, agentName: agent.name }, 'Agent settings updated');
      return { message: 'Settings updated successfully' };
    } catch (err: any) {
      logger.error({ err }, 'Error updating agent settings');
      return reply.code(500).send({ error: err.message || 'Error updating agent settings' });
    }
  });

  // GET /api/users/:uid/agents - Get specific user's agents (admin endpoint)
  fastify.get('/users/:uid/agents', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own agents unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const agents = await firestoreAdapter.getUserAgents(uid);
      return { agents };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user agents');
      return reply.code(500).send({ error: err.message || 'Error fetching user agents' });
    }
  });

  // POST /api/agents/purchase-request - Create agent purchase request
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

  // GET /api/admin/agents/purchase-requests - Admin get purchase requests
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

  // POST /api/admin/agents/approve - Admin approve agent purchase request
  fastify.post('/admin/approve', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }
      const admin = (request as any).user;
      const body = z.object({
        requestId: z.string().min(1),
      }).parse(request.body);

      await firestoreAdapter.approveAgentPurchaseRequest(body.requestId, admin.uid);

      logger.info({ requestId: body.requestId, approvedBy: admin.uid }, 'Agent purchase request approved');
      return {
        success: true,
        message: 'Agent purchase request approved and feature enabled',
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error approving purchase request');
      return reply.code(500).send({ error: err.message || 'Error approving purchase request' });
    }
  });

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

    try {
      // HARDENED: 200ms timeout - return safe default immediately
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Operation timeout')), 200);
      });

      const featuresOperation = async () => {
        // Skip admin check to save time - users can only see their own features anyway
        if (uid !== user.uid) {
          return {};
        }
        return await firestoreAdapter.getUserFeatures(uid);
      };

      const features = await Promise.race([featuresOperation(), timeoutPromise]) as any;
      logger.info({ uid, duration: Date.now() - startTime }, 'GET /users/:uid/features success');
      return reply.send({ features: features || {} });
    } catch (err: any) {
      logger.warn({ uid, error: err.message, duration: Date.now() - startTime }, 'GET /users/:uid/features timeout/error - returning safe default');
      // SAFE DEFAULT: Always return empty object
      return reply.send({ features: {} });
    }
  });
}

