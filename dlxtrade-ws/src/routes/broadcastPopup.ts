import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';

export async function broadcastPopupRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] GET /api/broadcast-popup/current");

// GET /api/broadcast-popup/current - Get current broadcast popup (HARDENED: 200ms timeout)
fastify.get('/broadcast-popup/current', async (request: FastifyRequest, reply: FastifyReply) => {
  const startTime = Date.now();
  
  try {
    // HARDENED: 200ms timeout - return safe default immediately
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), 200);
    });

    const firestoreOperation = async () => {
      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('broadcast_popup').doc('current').get();

      return !doc.exists ? { active: false } : {
        active: doc.data()?.active ?? false,
        message: doc.data()?.message || '',
        timestamp: doc.data()?.timestamp || Date.now()
      };
    };

    const result = await Promise.race([firestoreOperation(), timeoutPromise]);
    logger.info({ duration: Date.now() - startTime }, 'GET /broadcast-popup/current success');
    return reply.send(result);
  } catch (err: any) {
    logger.warn({ error: err.message, duration: Date.now() - startTime }, 'GET /broadcast-popup/current timeout/error - returning safe default');
    // SAFE DEFAULT: Always return inactive popup
    return reply.send({ active: false });
  }
});
}
