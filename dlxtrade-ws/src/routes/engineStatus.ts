import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';

export async function engineStatusRoutes(fastify: FastifyInstance) {
  // GET /api/engine/status - Get engine status (already exists in engine.ts, but adding collection version)
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { uid?: string } }>, reply: FastifyReply) => {
    console.log('GET /api/engine-status/status called');
    try {
      const user = (request as any).user;
      const { uid } = request.query;
      
      // Users can only view their own status unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      const targetUid = uid || user.uid;
      
      if (targetUid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const status = await firestoreAdapter.getEngineStatus(targetUid);
      
      if (!status) {
        return { active: false, engineType: null, symbol: null, config: null };
      }

      // Convert timestamps
      const result: any = { ...status };
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }
      
      return result;
    } catch (err: any) {
      logger.error({ err }, 'Error getting engine status');
      return reply.code(500).send({ error: err.message || 'Error fetching engine status' });
    }
  });
}

