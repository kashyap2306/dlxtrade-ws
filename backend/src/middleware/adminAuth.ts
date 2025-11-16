import { FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAdmin } from '../utils/firebase';
import { AuthorizationError } from '../utils/errors';
import { logger } from '../utils/logger';

export async function adminAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const user = (request as any).user;
    if (!user || !user.uid) {
      throw new AuthorizationError('User not authenticated');
    }

    // Check if user has admin role in Firestore
    const db = getFirebaseAdmin().firestore();
    const userDoc = await db.collection('users').doc(user.uid).get();
    
    if (!userDoc.exists) {
      throw new AuthorizationError('User profile not found');
    }

    const userData = userDoc.data();
    const profile = userData?.profile || {};
    
    if (profile.role !== 'admin') {
      logger.warn({ uid: user.uid, role: profile.role }, 'Non-admin user attempted to access admin route');
      throw new AuthorizationError('Admin access required');
    }

    logger.debug({ uid: user.uid }, 'Admin access granted');
  } catch (error: any) {
    if (error instanceof AuthorizationError) {
      reply.code(403).send({ error: error.message });
    } else {
      logger.error({ error }, 'Error in admin auth middleware');
      reply.code(403).send({ error: 'Admin authorization failed' });
    }
    throw error;
  }
}

