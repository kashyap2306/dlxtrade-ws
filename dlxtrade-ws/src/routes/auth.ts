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
      } else if (body.uid) {
        // If uid provided directly (for testing/backfill)
        uid = body.uid;
        // Try to get user from Firebase Auth
        try {
          const { getFirebaseAdmin } = await import('../utils/firebase');
          const admin = await import('firebase-admin');
          const userRecord = await admin.auth(getFirebaseAdmin()).getUser(uid);
          email = userRecord.email;
          name = userRecord.displayName || undefined;
        } catch (error) {
          logger.warn({ uid }, 'Could not fetch user from Firebase Auth, continuing with uid only');
        }
      } else {
        return reply.code(400).send({ 
          error: 'Either idToken or uid must be provided' 
        });
      }

      // Ensure Firebase Admin is initialized before proceeding
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const firebaseApp = getFirebaseAdmin();
      if (!firebaseApp) {
        logger.warn({ uid, email }, 'Firebase Admin not initialized yet, retrying user onboarding in 2 seconds');
        // Wait a bit for Firebase Admin to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));

        const firebaseAppRetry = getFirebaseAdmin();
        if (!firebaseAppRetry) {
          logger.error({ uid, email }, 'Firebase Admin still not initialized after retry - user onboarding failed');
          return reply.code(503).send({
            error: 'Service temporarily unavailable - Firebase initialization in progress',
            details: 'Please try logging in again in a few seconds'
          });
        }
      }

      // Run idempotent user onboarding
      // For OAuth logins, phone will be null initially
      logger.info({ uid, email }, '🔄 Starting user onboarding via /afterSignIn endpoint');

      const result = await ensureUser(uid, {
        name,
        email,
        phone: null, // Phone can be added during onboarding
      });

      logger.info({ uid, success: result.success, createdNew: result.createdNew, error: result.error }, 'User onboarding result from ensureUser');

      if (!result.success) {
        logger.error({ uid, error: result.error }, '❌ User onboarding failed in /afterSignIn');
        return reply.code(500).send({
          error: 'User onboarding failed',
          details: result.error
        });
      }

      // Get full user document to return
      const userDoc = await firestoreAdapter.getUser(uid);
      if (!userDoc) {
        logger.error({ uid }, 'User document not found after onboarding');
        return reply.code(500).send({ 
          error: 'User document not found after onboarding' 
        });
      }

      // Convert timestamps for JSON response
      const response: any = { ...userDoc };
      if (response.createdAt) {
        response.createdAt = response.createdAt.toDate().toISOString();
      }
      if (response.updatedAt) {
        response.updatedAt = response.updatedAt.toDate().toISOString();
      }
      if (response.lastLogin) {
        response.lastLogin = response.lastLogin.toDate().toISOString();
      }

      logger.info({ 
        uid, 
        createdNew: result.createdNew,
        email 
      }, '✅ User onboarding completed, returning user document');

      return {
        success: true,
        createdNew: result.createdNew,
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

