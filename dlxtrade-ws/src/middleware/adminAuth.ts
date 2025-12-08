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

    // Check admin via Firestore root-only flags
    const db = getFirebaseAdmin().firestore();
    const snapshot = await db.collection('users').doc(user.uid).get();
    if (!snapshot.exists) {
      throw new AuthorizationError('User doc missing');
    }
    const userData: any = snapshot.data() || {};
    const roleRoot = userData.role;
    const isAdminRoot = userData.isAdmin === true;

    const hasAdmin = roleRoot === 'admin' || isAdminRoot;

    if (!hasAdmin) {
      logger.warn({ uid: user.uid, roleRoot, isAdminRoot }, 'Non-admin user attempted to access admin route');
      throw new AuthorizationError('Access Denied');
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

