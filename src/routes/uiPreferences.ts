import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';

const updatePreferencesSchema = z.object({
  dismissedAgents: z.array(z.string()).optional(),
  hideDashboardCard: z.array(z.string()).optional(),
  theme: z.enum(['light', 'dark']).optional(),
  sidebarPinned: z.boolean().optional(),
});

export async function uiPreferencesRoutes(fastify: FastifyInstance) {
  // GET /api/ui-preferences - Get user UI preferences
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const preferences = await firestoreAdapter.getUserUIPreferences(user.uid);
      
      return { preferences: preferences || {} };
    } catch (err: any) {
      logger.error({ err }, 'Error getting UI preferences');
      return reply.code(500).send({ error: err.message || 'Error fetching UI preferences' });
    }
  });

  // POST /api/ui-preferences/update - Update UI preferences
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = updatePreferencesSchema.parse(request.body);

      await firestoreAdapter.updateUIPreferences(user.uid, body);
      
      return { message: 'UI preferences updated successfully' };
    } catch (err: any) {
      logger.error({ err }, 'Error updating UI preferences');
      return reply.code(500).send({ error: err.message || 'Error updating UI preferences' });
    }
  });
}

