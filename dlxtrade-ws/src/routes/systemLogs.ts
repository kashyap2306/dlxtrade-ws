import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';

export async function systemLogsRoutes(fastify: FastifyInstance) {
  // GET /api/logs - Get system logs (admin only)
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      
      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      const logs = await firestoreAdapter.getSystemLogs(limit);
      
      return { logs };
    } catch (err: any) {
      logger.error({ err }, 'Error getting system logs');
      return reply.code(500).send({ error: err.message || 'Error fetching system logs' });
    }
  });
}

