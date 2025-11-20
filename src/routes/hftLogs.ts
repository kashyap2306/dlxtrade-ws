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

      // Firestore requires manual composite index for this query:
      // Collection: hftLogs
      // Fields: (userId ASC, timestamp DESC)
      // Create this index in Firebase Console if you see index errors
      
      const limitNum = limit ? parseInt(limit, 10) : 100;
      
      // Auto-correct limit to max 500 instead of throwing error
      // This prevents Firestore index errors
      const safeLimit = Math.min(Math.max(1, limitNum), 500);
      
      const logs = await firestoreAdapter.getHFTLogs(targetUid, safeLimit);
      
      return { logs };
    } catch (err: any) {
      logger.error({ err }, 'Error getting HFT logs');
      return reply.code(500).send({ error: err.message || 'Error fetching HFT logs' });
    }
  });
}

