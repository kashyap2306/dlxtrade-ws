import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { verifyFirebaseToken } from '../utils/firebase';
import { ensureUser } from '../services/userOnboarding';
import { firestoreAdapter } from '../services/firestoreAdapter';

const afterSignInSchema = z.object({
  idToken: z.string().optional(),
  uid: z.string().optional(),
});

/**
 * Auth routes - handles user signup/login onboarding
 * All user document creation happens on backend only
 */
export async function authRoutes(fastify: FastifyInstance) {
  console.log("[RUNTIME] authRoutes executed");

  // POST /api/auth/afterSignIn - Called by frontend after successful Firebase Auth sign-in
  // Backend verifies idToken and runs idempotent user onboarding
  fastify.post('/afterSignIn', async (request: FastifyRequest, reply: FastifyReply) => {
    console.log("[RUNTIME] afterSignIn HIT");
    try {
      const body = afterSignInSchema.parse(request.body);

      let uid: string;
      let email: string | undefined;
      let name: string | undefined;

      if (body.idToken) {
        // Verify Firebase ID token
        try {
          const decodedToken = await verifyFirebaseToken(body.idToken);
          uid = decodedToken.uid;
          email = decodedToken.email;
          name = decodedToken.name || decodedToken.display_name;

          logger.info({ uid, email }, 'Firebase token verified');
        } catch (error: any) {
          logger.error({ error: error.message }, 'Firebase token verification failed');
          return reply.code(401).send({
            error: 'Invalid or expired token',
            details: error.message
          });
        }
      } else {
        return reply.code(400).send({
          error: 'Authentication required - provide valid idToken'
        });
      }

      // Ensure Firebase Admin is initialized
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const firebaseApp = getFirebaseAdmin();
      if (!firebaseApp) {
        // Fast fail/retry mechanism handled by ensureUser internal checks mostly, but we skip the rigorous wait here
      }

      // OPTIMIZATION: Check if user exists FIRST.
      // If user exists, return immediately and run ensureUser in background.
      // If user DOES NOT exist, we must wait for ensureUser.

      const userDocSnapshot = await firestoreAdapter.getUser(uid);

      if (userDocSnapshot) {
        // FAST PATH: User exists. Return immediately.
        logger.info({ uid, email }, '⚡ FAST LOGIN: User exists, returning immediately. Running maintenance in background.');

        // Run ensureUser in background (Fire-and-forget) to sync settings/integrations
        ensureUser(uid, { name, email, phone: null }).catch(err => {
          logger.error({ uid, err }, 'Background ensureUser failed');
        });

        // Parse dates for response
        const response: any = { ...userDocSnapshot };
        if (response.createdAt?.toDate) response.createdAt = response.createdAt.toDate().toISOString();
        if (response.updatedAt?.toDate) response.updatedAt = response.updatedAt.toDate().toISOString();
        if (response.lastLogin?.toDate) response.lastLogin = response.lastLogin.toDate().toISOString();

        return {
          success: true,
          createdNew: false,
          user: response
        };
      }

      // SLOW PATH: New User (First time login) - Must wait for onboarding
      logger.info({ uid, email }, '🆕 NEW USER: Running full blocking onboarding.');

      const result = await ensureUser(uid, {
        name,
        email,
        phone: null,
      });

      if (!result.success) {
        logger.error({ uid, error: result.error }, '❌ User onboarding failed in /afterSignIn');
        return reply.code(500).send({
          error: 'User onboarding failed',
          details: result.error
        });
      }

      // Fetch newly created doc
      const newUserDoc = await firestoreAdapter.getUser(uid);

      // Convert timestamps
      const response: any = { ...newUserDoc };
      if (response.createdAt?.toDate) response.createdAt = response.createdAt.toDate().toISOString();
      if (response.updatedAt?.toDate) response.updatedAt = response.updatedAt.toDate().toISOString();
      if (response.lastLogin?.toDate) response.lastLogin = response.lastLogin.toDate().toISOString();

      return {
        success: true,
        createdNew: true,
        user: response,
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid request body',
          details: err.errors
        });
      }

      logger.error({ err }, 'Error in afterSignIn endpoint');
      return reply.code(500).send({
        error: err.message || 'Internal server error'
      });
    }
  });

  // Health check endpoint to verify Firebase auth is working
  fastify.get('/verify', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    logger.info({ uid: user.uid, email: user.email }, 'Firebase auth verified');

    // Run ensureUser to create/update user documents
    logger.info({ uid: user.uid }, '🔧 Running ensureUser for uid: {uid}');
    const result = await ensureUser(user.uid, {
      email: user.email,
      name: user.name || user.displayName,
      phone: null,
    });

    if (!result.success) {
      logger.error({ uid: user.uid, error: result.error }, '❌ ensureUser failed in /auth/verify endpoint');
      return reply.code(500).send({
        error: 'User onboarding failed',
        details: result.error
      });
    }

    logger.info({ uid: user.uid }, '✅ ensureUser completed');

    return {
      authenticated: true,
      user: {
        uid: user.uid,
        email: user.email,
      },
    };
  });
}

