import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyFirebaseToken } from '../utils/firebase';
import { AuthenticationError } from '../utils/errors';
import { logger } from '../utils/logger';

export async function firebaseAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const url = request.url || '';

  // 1. FAST BYPASS FOR CONTROL-PLANE ROUTES: Sync lightweight decode only
  // CRITICAL: /api/auto-trade/status must bypass all Firestore/admin checks for instant response
  if (url.startsWith('/api/research/run') || url === '/api/auto-trade/status') {
    try {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const parts = authHeader.substring(7).split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload?.user_id || payload?.uid) {
            const uid = payload.user_id || payload.uid;
            (request as any).userId = uid;
            (request as any).user = { uid, email: payload.email, emailVerified: payload.email_verified, claims: payload };
            return; // EXIT IMMEDIATELY - NO AWAIT
          }
        }
      }
    } catch (e) {
      // Ignore and proceed to full auth
    }
  }

  console.log("[AUTH] Incoming request to", request.url);
  try {
    const authHeader = request.headers.authorization;

    // Test-mode bypass for automated testing (non-production)
    if (process.env.TEST_MODE === '1' && authHeader === 'Bearer mock-token') {
      const mockUid = 'q8S8bOTaebd0af64PuTZdlpntg42';
      (request as any).userId = mockUid;
      (request as any).user = {
        uid: mockUid,
        email: 'test-mode@local',
        emailVerified: true,
        claims: { testMode: true }
      };
      logger.warn({ uid: mockUid }, 'TEST_MODE bypass engaged (mock-token)');
      return;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return; // Don't throw, just return after sending response
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      const decodedToken = await verifyFirebaseToken(token);
      console.log("[AUTH DEBUG] Token UID =", decodedToken.uid);

      // Attach user info + claims to request
      (request as any).userId = decodedToken.uid;
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

