import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';

export async function broadcastPopupRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] GET /api/broadcast-popup/current");

  // GET /api/broadcast-popup/current - Get current broadcast popup
  fastify.get('/broadcast-popup/current', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log("[DEBUG] GET /broadcast-popup/current - REQUEST ENTERS ROUTE");
    console.log("[DEBUG] GET /broadcast-popup/current - NO AUTH REQUIRED");

    try {
      const db = getFirebaseAdmin().firestore();
      console.log("[DEBUG] GET /broadcast-popup/current - BEFORE FIRESTORE READ");
      let doc;
      try {
        doc = await db.collection('broadcast_popup').doc('current').get();
        console.log("[DEBUG] GET /broadcast-popup/current - AFTER FIRESTORE READ");
      } catch (firestoreErr: any) {
        console.error("[DEBUG] GET /broadcast-popup/current - FIRESTORE ERROR:", firestoreErr?.message, firestoreErr?.stack);
        throw firestoreErr;
      }

      console.log("[DEBUG] GET /broadcast-popup/current - BEFORE DECRYPT/NORMALIZATION");
      console.log("[DEBUG] GET /broadcast-popup/current - AFTER DECRYPT/NORMALIZATION");

      console.log("[DEBUG] GET /broadcast-popup/current - BEFORE RESPONSE.SEND");
      let result;
      if (!doc.exists) {
        result = reply.send({
          active: false
        });
      } else {
        const data = doc.data();
        result = reply.send({
          active: data?.active ?? false,
          message: data?.message || '',
          timestamp: data?.timestamp || Date.now()
        });
      }
      console.log("[DEBUG] GET /broadcast-popup/current - AFTER RESPONSE.SEND");
      return result;
    } catch (err: any) {
      logger.error({ err }, 'Error getting broadcast popup');
      return reply.code(500).send({
        active: false,
        error: 'Failed to load broadcast popup'
      });
    }
  });
}
