import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyFirebaseToken } from '../utils/firebase';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

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
      logger.warn({ error: error.message }, 'Firebase token verification failed');
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

