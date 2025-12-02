import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

const unlockAgentSchema = z.object({
  agentName: z.string().min(1),
});

export async function agentsRoutes(fastify: FastifyInstance) {
  // GET /api/agents - Get all agents
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agents = await firestoreAdapter.getAllAgents();
      return { agents };
    } catch (err: any) {
      logger.error({ err }, 'Error getting agents');
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
}

