import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';

export async function broadcastPopupRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] GET /api/broadcast-popup/current");

  // GET /api/broadcast-popup/current - Get current broadcast popup
  fastify.get('/broadcast-popup/current', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('broadcast_popup').doc('current').get();

      if (!doc.exists) {
        return reply.send({
          active: false
        });
      }

      const data = doc.data();
      return reply.send({
        active: data?.active ?? false,
        message: data?.message || '',
        timestamp: data?.timestamp || Date.now()
      });
    } catch (err: any) {
      logger.error({ err }, 'Error getting broadcast popup');
      return reply.code(500).send({
        active: false,
        error: 'Failed to load broadcast popup'
      });
    }
  });
}
