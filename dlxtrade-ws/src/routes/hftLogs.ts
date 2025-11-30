import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';

export async function hftLogsRoutes(fastify: FastifyInstance) {
  // GET /api/hft/logs - Get HFT logs (collection version)
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { uid?: string; limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { uid, limit } = request.query;
      
      // Users can only view their own logs unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      const targetUid = uid || (isAdmin ? undefined : user.uid);
      
      if (targetUid && targetUid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const limitNum = limit ? parseInt(limit, 10) : 100;
      const logs = await firestoreAdapter.getHFTLogs(targetUid, limitNum);
      
      return { logs };
    } catch (err: any) {
      logger.error({ err }, 'Error getting HFT logs');
      return reply.code(500).send({ error: err.message || 'Error fetching HFT logs' });
    }
  });
}

