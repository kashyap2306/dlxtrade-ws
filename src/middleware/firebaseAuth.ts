import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyFirebaseToken } from '../utils/firebase';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

// Rate limiting for Firebase token error logs (once per user per 10 minutes)
const tokenErrorLogCache = new Map<string, number>();
const TOKEN_ERROR_LOG_COOLDOWN = 10 * 60 * 1000; // 10 minutes in milliseconds

export async function firebaseAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const decodedToken = await verifyFirebaseToken(token);

      // Attach user info + claims to request
      (request as any).user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        emailVerified: decodedToken.email_verified,
        claims: decodedToken, // contains custom claims (e.g., role, isAdmin)
      };

      logger.debug({ uid: decodedToken.uid }, 'Firebase token verified');
    } catch (error: any) {
      // Rate limit Firebase token error logs (once per IP per 10 minutes)
      const clientIP = request.ip || 'unknown';
      const cacheKey = `token_error_${clientIP}`;
      const now = Date.now();
      const lastLogTime = tokenErrorLogCache.get(cacheKey) || 0;

      if (now - lastLogTime > TOKEN_ERROR_LOG_COOLDOWN) {
        logger.warn({ error: error.message, ip: clientIP }, 'Firebase token verification failed');
        tokenErrorLogCache.set(cacheKey, now);
      }

      throw new AuthenticationError('Invalid or expired token');
    }
  } catch (error: any) {
    if (error instanceof AuthenticationError) {
      reply.code(401).send({ error: error.message });
    } else {
      logger.error({ error }, 'Error in Firebase auth middleware');
      reply.code(401).send({ error: 'Authentication failed' });
    }
    throw error;
  }
}

