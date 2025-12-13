import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

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
    console.log("[DEBUG] GET /agents - REQUEST ENTERS ROUTE");
    try {
      const user = (request as any).user;
      console.log("[DEBUG] GET /agents - AUTH UID VERIFIED:", user.uid);

      console.log("[DEBUG] GET /agents - BEFORE FIRESTORE READ");
      let agents;
      try {
        agents = await firestoreAdapter.getUserAgents(user.uid);
        console.log("[DEBUG] GET /agents - AFTER FIRESTORE READ");
      } catch (firestoreErr: any) {
        console.error("[DEBUG] GET /agents - FIRESTORE ERROR:", firestoreErr?.message, firestoreErr?.stack);
        throw firestoreErr;
      }

      console.log("[DEBUG] GET /agents - BEFORE DECRYPT/NORMALIZATION");
      console.log("[DEBUG] GET /agents - AFTER DECRYPT/NORMALIZATION");

      console.log("[DEBUG] GET /agents - BEFORE RESPONSE.SEND");
      const result = reply.send({ agents });
      console.log("[DEBUG] GET /agents - AFTER RESPONSE.SEND");
      return result;
    } catch (err: any) {
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

  // GET /api/agents/unlocked - Get user's unlocked agent names
  fastify.get('/unlocked', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('GET /api/agents/unlocked called');
    try {
      const user = (request as any).user;
      // Use optimized method that combines queries
      const unlocked = await firestoreAdapter.getUserUnlockedAgents(user.uid);
      return { unlocked };
    } catch (err: any) {
      logger.error({ err }, 'Error getting unlocked agents');
      return reply.code(500).send({ error: err.message || 'Error fetching unlocked agents' });
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
    preHandler: [fastify.authenticate],
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

  // GET /api/users/:uid/features - Get user's enabled features
  fastify.get('/users/:uid/features', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { uid } = request.params;

      // Users can only see their own features, admins can see anyone's
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const features = await firestoreAdapter.getUserFeatures(uid);
      return { features };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user features');
      return reply.code(500).send({ error: err.message || 'Error fetching user features' });
    }
  });
}

