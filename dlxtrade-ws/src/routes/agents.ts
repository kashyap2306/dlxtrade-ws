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
    try {
      const user = (request as any).user;
      const userData = await firestoreAdapter.getUser(user.uid);
      const unlockedAgents = userData?.unlockedAgents || [];
      
      // Also get from unlocks subcollection for completeness
      const unlocks = await firestoreAdapter.getUserAgentUnlocks(user.uid);
      const unlockNames = unlocks.map(u => u.agentName);
      
      // Combine and deduplicate
      const allUnlocked = [...new Set([...unlockedAgents, ...unlockNames])];
      
      return { unlocked: allUnlocked };
    } catch (err: any) {
      logger.error({ err }, 'Error getting unlocked agents');
      return reply.code(500).send({ error: err.message || 'Error fetching unlocked agents' });
    }
  });
}

