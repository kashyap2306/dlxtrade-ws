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

    // Test-mode bypass for automated testing (non-production)
    if (process.env.TEST_MODE === '1' && authHeader === 'Bearer mock-token') {
      (request as any).user = {
        uid: 'q8S8bOTaebd0af64PuTZdlpntg42',
        email: 'test-mode@local',
        emailVerified: true,
        claims: { testMode: true }
      };
      logger.warn({ uid: 'q8S8bOTaebd0af64PuTZdlpntg42' }, 'TEST_MODE bypass engaged (mock-token)');
      return;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return; // Don't throw, just return after sending response
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
      reply.code(401).send({ error: 'Invalid or expired token' });
      return; // Don't throw, just return after sending response
    }
  } catch (error: any) {
    // Catch any unexpected errors
    logger.error({ error, stack: error?.stack }, 'Unexpected error in Firebase auth middleware');
    reply.code(401).send({ error: 'Authentication failed' });
    return; // Don't throw, just return after sending response
  }
}

