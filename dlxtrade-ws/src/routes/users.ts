import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError, NotFoundError } from '../utils/errors';
import { ensureUser } from '../services/userOnboarding';

const createUserSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  plan: z.string().optional(),
  apiConnected: z.boolean().optional(),
  unlockedAgents: z.array(z.string()).optional(),
  profilePicture: z.string().optional(),
  hftStatus: z.string().optional(),
  engineStatus: z.string().optional(),
  totalPnL: z.number().optional(),
  totalTrades: z.number().optional(),
  settings: z.any().optional(),
});

const updateUserSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  plan: z.string().optional(),
  apiConnected: z.boolean().optional(),
  unlockedAgents: z.array(z.string()).optional(),
  profilePicture: z.string().optional(),
  hftStatus: z.string().optional(),
  engineStatus: z.string().optional(),
  totalPnL: z.number().optional(),
  totalTrades: z.number().optional(),
  settings: z.any().optional(),
});

export async function usersRoutes(fastify: FastifyInstance) {
  // GET /api/users - Get all users (admin only)
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const users = await firestoreAdapter.getAllUsers();
      return { users };
    } catch (err: any) {
      logger.error({ err }, 'Error getting users');
      return reply.code(500).send({ error: err.message || 'Error fetching users' });
    }
  });

  // GET /api/users/:uid - Get specific user
  fastify.get('/:uid', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own data unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(uid);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Convert timestamps
      const result: any = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      return result;
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user');
      return reply.code(500).send({ error: err.message || 'Error fetching user' });
    }
  });

  // POST /api/users/create - Create user (called on sign-in)
  // PART 1: Creates ALL required Firestore documents
  fastify.post('/create', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = createUserSchema.parse(request.body);

      // PART 1: Comprehensive onboarding - creates ALL required documents (idempotent)
      const onboardingResult = await ensureUser(user.uid, {
        name: body.name || user.displayName || '',
        email: body.email || user.email || '',
        phone: body.phone || null,
      });

      if (!onboardingResult.success) {
        logger.error({ uid: user.uid, error: onboardingResult.error }, 'User onboarding failed');
        return reply.code(500).send({ 
          error: onboardingResult.error || 'User onboarding failed' 
        });
      }

      // Update additional fields if provided
      if (body.plan || body.profilePicture || body.unlockedAgents) {
        await firestoreAdapter.createOrUpdateUser(user.uid, {
          plan: body.plan,
          profilePicture: body.profilePicture,
          unlockedAgents: body.unlockedAgents,
        });
      }

      // Log login activity (signup already logged in onboardNewUser)
      const existingUser = await firestoreAdapter.getUser(user.uid);
      if (existingUser && existingUser.createdAt) {
        // Check if this is a returning user (created > 1 minute ago)
        const createdTime = existingUser.createdAt.toDate();
        const now = new Date();
        const minutesSinceCreation = (now.getTime() - createdTime.getTime()) / 1000 / 60;
        
        if (minutesSinceCreation > 1) {
          await firestoreAdapter.logActivity(user.uid, 'USER_LOGIN', {
            message: `User ${body.email || user.email} logged in`,
            email: body.email || user.email,
          });
        }
      }

      return { message: 'User created/updated successfully', uid: user.uid };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error creating user');
      return reply.code(500).send({ error: err.message || 'Error creating user' });
    }
  });

  // POST /api/users/update - Update user
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = updateUserSchema.parse(request.body);

      await firestoreAdapter.createOrUpdateUser(user.uid, body);

      // Log activity
      const changedFields = Object.keys(body);
      await firestoreAdapter.logActivity(user.uid, 'PROFILE_UPDATED', { 
        fields: changedFields,
        hasName: !!body.name,
        hasPhone: !!body.phone,
        hasCountry: !!body.country,
      });

      return { message: 'User updated successfully', uid: user.uid };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error updating user');
      return reply.code(500).send({ error: err.message || 'Error updating user' });
    }
  });
}

