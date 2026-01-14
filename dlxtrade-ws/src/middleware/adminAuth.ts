import { FastifyRequest, FastifyReply } from 'fastify';
import { getFirebaseAdmin } from '../utils/firebase';
import { AuthorizationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { query } from '../db';

export async function adminAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const user = (request as any).user;
    if (!user || !user.uid) {
      throw new AuthorizationError('User not authenticated');
    }

    // Check admin via Firestore root-only flags (primary check)
    const db = getFirebaseAdmin().firestore();
    const snapshot = await db.collection('users').doc(user.uid).get();
    let hasAdmin = false;

    if (snapshot.exists) {
      const userData: any = snapshot.data() || {};
      const roleRoot = userData.role;
      const isAdminRoot = userData.isAdmin === true;
      hasAdmin = roleRoot === 'admin' || isAdminRoot;
    }

    // Fallback: Check PostgreSQL users table if Firestore check failed
    if (!hasAdmin) {
      try {
        const pgUsers = await query(`
          SELECT role, is_admin FROM users WHERE firebase_uid = $1
        `, [user.uid]);

        if (Array.isArray(pgUsers) && pgUsers.length > 0) {
          const pgUser = pgUsers[0];
          hasAdmin = pgUser.role === 'admin' || pgUser.is_admin === true;
        }
      } catch (pgError: any) {
        logger.warn({ uid: user.uid, error: pgError.message }, 'PostgreSQL admin check failed, using Firestore only');
      }
    }

    if (!hasAdmin) {
        logger.warn({ uid: user.uid }, 'Non-admin user attempted to access admin route');
        throw new AuthorizationError('Access Denied');
    }

    logger.debug({ uid: user.uid }, 'Admin access granted');
  } catch (error: any) {
    if (error instanceof AuthorizationError) {
      logger.warn({ error: error.message }, 'Admin authorization failed');
      reply.code(403).send({ error: 'admin_access_denied' });
      return;
    } else {
      logger.error({ error }, 'Error in admin auth middleware');
      reply.code(403).send({ error: 'admin_access_denied' });
      return;
    }
  }
}

