import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';

export async function globalStatsRoutes(fastify: FastifyInstance) {
  // GET /api/global-stats - Get global stats
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    console.log('GET /api/global-stats called');
    try {
      const stats = await firestoreAdapter.getGlobalStats();
      
      // If no stats exist, return default structure
      if (!stats) {
        return {
          totalUsers: 0,
          totalTrades: 0,
          activeEngines: 0,
          activeHFT: 0,
          totalVolume: 0,
        };
      }

      // Convert timestamps
      const result: any = { ...stats };
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }
      
      return result;
    } catch (err: any) {
      logger.error({ err }, 'Error getting global stats');
      return reply.code(500).send({ error: err.message || 'Error fetching global stats' });
    }
  });
}

