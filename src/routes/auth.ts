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
  // POST /api/auth/afterSignIn - Called by frontend after successful Firebase Auth sign-in
  // Backend verifies idToken and runs idempotent user onboarding
  fastify.post('/afterSignIn', async (request: FastifyRequest, reply: FastifyReply) => {
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

      // Run idempotent user onboarding
      logger.info({ uid, email }, 'Starting user onboarding from afterSignIn');
      const result = await ensureUser(uid, {
        name,
        email,
        phone: null,
      });

      if (!result.success) {
        logger.error({ uid, error: result.error }, 'User onboarding failed');
        return reply.code(500).send({ 
          error: 'User onboarding failed',
          details: result.error 
        });
      }

      // Post-onboarding verification: verify document exists in Firestore
      logger.info({ uid }, 'Verifying user document exists after onboarding');
      let userDoc = await firestoreAdapter.getUser(uid);
      if (!userDoc) {
        logger.error({ uid }, '❌ User document not found after onboarding - CRITICAL ERROR');
        
        // Retry onboarding once
        logger.info({ uid }, 'Retrying user onboarding after verification failure');
        const retryResult = await ensureUser(uid, {
          name,
          email,
          phone: null,
        });
        
        if (!retryResult.success) {
          logger.error({ uid, error: retryResult.error }, 'Retry onboarding also failed');
          return reply.code(500).send({ 
            error: 'User document not found after onboarding and retry failed',
            details: retryResult.error 
          });
        }
        
        // Try to get user doc again after retry
        userDoc = await firestoreAdapter.getUser(uid);
        if (!userDoc) {
          logger.error({ uid }, '❌ User document still not found after retry');
          return reply.code(500).send({ 
            error: 'User document creation failed after retry' 
          });
        }
        
        logger.info({ uid }, '✅ User document found after retry');
      } else {
        logger.info({ uid, hasEmail: !!userDoc.email, hasName: !!userDoc.name }, '✅ User document verified after onboarding');
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
    return {
      authenticated: true,
      user: {
        uid: user.uid,
        email: user.email,
      },
    };
  });
}

