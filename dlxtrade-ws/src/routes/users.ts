console.log("[DEBUG] usersRoutes file EXECUTED");

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError, NotFoundError } from '../utils/errors';
import { ensureUser } from '../services/userOnboarding';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

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
  console.log("[CHECK] usersRoutes EXECUTED");
  console.log("[ROUTE READY] GET /api/users/:uid/exchange-config");
  console.log("[ROUTE READY] POST /api/users/:uid/exchange-config");
  console.log("[ROUTE READY] GET /api/users/:uid/trading-config");
  console.log("[ROUTE READY] POST /api/users/:uid/trading-config");

  console.log("[ROUTE READY] GET /api/users");
  console.log("[ROUTE READY] GET /api/users/:uid");
  console.log("[ROUTE READY] POST /api/users/create");
  console.log("[ROUTE READY] POST /api/users/update");
  console.log("[ROUTE READY] GET /api/users/:id/details");
  console.log("[ROUTE READY] GET /api/users/:id/stats");
  console.log("[ROUTE READY] GET /api/users/:id/pnl");
  console.log("[ROUTE READY] GET /api/users/:id/trades");
  console.log("[ROUTE READY] GET /api/users/:id/logs");
  console.log("[ROUTE READY] GET /api/users/:id/usage-stats");
  console.log("[ROUTE READY] GET /api/users/:id/sessions");
  console.log("[ROUTE READY] POST /api/users/:uid/provider-config");

  // GET /api/users/:uid/exchange-config - Get exchange configuration
  fastify.get('/:uid/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        return reply.send({ accounts: [] });
      }

      const data = doc.data() || {};
      return reply.send({
        accounts: [{
          exchange: data.exchange,
          apiKey: data.apiKeyEncrypted ? '[ENCRYPTED]' : '',
          secret: data.secretEncrypted ? '[ENCRYPTED]' : '',
          passphrase: data.passphraseEncrypted ? '[ENCRYPTED]' : '',
          testnet: data.testnet ?? true
        }]
      });
    } catch (err: any) {
      logger.error({ err }, 'Error getting exchange config');
      return reply.code(500).send({ error: 'Failed to get exchange config' });
    }
  });

  // POST /api/users/:uid/exchange-config - Save exchange configuration
  fastify.post('/:uid/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const configRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');

      await configRef.set({
        ...(request.body as any),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });

      return reply.send({ success: true });
    } catch (err: any) {
      logger.error({ err }, 'Error saving exchange config');
      return reply.code(500).send({ error: 'Failed to save exchange config' });
    }
  });

  // GET /api/users/:uid/trading-config - Get trading configuration
  fastify.get('/:uid/trading-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('trading-config').doc(uid).get();

      const data = doc.exists ? doc.data() : null;
      return reply.send({ ok: true, config: data });
    } catch (err: any) {
      logger.error({ err }, 'Failed to load trading-config');
      return reply.code(500).send({ error: 'Failed to load trading config' });
    }
  });

  // POST /api/users/:uid/trading-config - Save trading configuration
  fastify.post('/:uid/trading-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      await db.collection('trading-config').doc(uid).set(request.body, { merge: true });

      request.log.info({ uid, body: request.body }, 'Saved trading-config');

      return reply.send({ ok: true, config: request.body });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to save trading-config');
      return reply.code(500).send({ error: 'Failed to save trading config' });
    }
  });

  // GET /api/users/:uid/provider-config - Get provider configuration
  fastify.get('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('provider-config').doc(uid).get();

      const data = doc.exists ? doc.data() : null;
      return reply.send({ ok: true, config: data });
    } catch (err: any) {
      logger.error({ err }, 'Error getting provider config');
      return reply.code(500).send({ error: 'Failed to get provider config' });
    }
  });

  // POST /api/users/:uid/provider-config - Save provider configuration
  fastify.post('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Validate the provider config structure
      const requestBody = request.body as any;
      if (!requestBody || typeof requestBody !== 'object') {
        reply.status(400).send({ success: false, error: "invalid_request" });
        return;
      }

      const providerConfig = requestBody.providerConfig;
      if (!providerConfig || typeof providerConfig !== 'object') {
        reply.status(400).send({ success: false, error: "invalid_request" });
        return;
      }

      const providerName = providerConfig.providerName;
      const type = providerConfig.type;
      const enabled = providerConfig.enabled;
      const apiKey = providerConfig.apiKey;
      const usageStats = providerConfig.usageStats;

      if (!providerName || !type) {
        reply.status(400).send({ success: false, error: "invalid_request" });
        return;
      }

      const db = getFirebaseAdmin().firestore();

      // Save to users/{uid}/settings/providerConfig (DOC, not collection!)
      const userRef = db
        .collection('users')
        .doc(uid)
        .collection('settings')
        .doc('providerConfig');

      await userRef.set(
        {
          [providerName]: {
            providerName,
            type,
            enabled,
            apiKey,
            usageStats
          }
        },
        { merge: true }
      );

      console.log("[provider-config] Saved provider:", providerName);

      return { success: true };
    } catch (err: any) {
      console.error("[provider-config] Firestore error:", err);
      reply.status(500).send({ success: false, error: "firestore_write_failed" });
      return;
    }
  });

  // POST /api/users/:uid/request-delete - Request user account deletion
  fastify.post('/:uid/request-delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only request deletion for their own account unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (uid !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const db = getFirebaseAdmin().firestore();

      // Mark user for deletion
      await db.collection('users').doc(uid).update({
        deleteRequested: true,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log the deletion request
      await firestoreAdapter.logActivity(uid, 'ACCOUNT_DELETION_REQUESTED', {
        message: 'User requested account deletion',
        requestedAt: new Date().toISOString(),
      });

      return { success: true };
    } catch (err: any) {
      logger.error({ err }, 'Error requesting user deletion');
      return reply.code(500).send({ error: 'Failed to request account deletion' });
    }
  });

  // GET /api/users - Get all users (admin only)
  fastify.get('/users', {
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

      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;

      // Convert timestamps
      const result: any = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      // Override apiConnected with computed value from exchangeConfig/current
      result.apiConnected = hasExchangeConfig || false;

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
  fastify.post('/users/create', {
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
  fastify.post('/users/update', {
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

      return { success: true, updated: body };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error updating user');
      return reply.code(500).send({ error: err.message || 'Error updating user' });
    }
  });

  // GET /api/users/:id/details - Get user details
  fastify.get('/:id/details', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own data unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(id);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;

      // Convert timestamps
      const result: any = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      // Override apiConnected with computed value from exchangeConfig/current
      result.apiConnected = hasExchangeConfig || false;

      return result;
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user details');
      return reply.code(500).send({ error: err.message || 'Error fetching user details' });
    }
  });

  // GET /api/users/:id/stats - Get user statistics
  fastify.get('/:id/stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(id);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Get trades for PnL calculation
      const trades = await firestoreAdapter.getTrades(id, 1000);
      const totalPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
      const winningTrades = trades.filter(t => (t.pnl || 0) > 0).length;
      const losingTrades = trades.filter(t => (t.pnl || 0) < 0).length;

      return {
        totalPnL: userData.totalPnL || totalPnL,
        totalTrades: userData.totalTrades || trades.length,
        winningTrades,
        losingTrades,
        winRate: trades.length > 0 ? (winningTrades / trades.length) * 100 : 0,
        avgPnL: trades.length > 0 ? totalPnL / trades.length : 0,
      };
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user stats' });
    }
  });

  // GET /api/users/:id/pnl - Get user PnL
  fastify.get('/:id/pnl', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;
      
      // Users can only view their own PnL unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const userData = await firestoreAdapter.getUser(id);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Get trades for PnL calculation
      const trades = await firestoreAdapter.getTrades(id, 1000);
      const totalPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);

      return {
        totalPnL: userData.totalPnL || totalPnL,
        dailyPnL: trades
          .filter(t => {
            let tradeDate: Date;
            if (t.createdAt?.toDate) {
              tradeDate = t.createdAt.toDate();
            } else if (t.createdAt) {
              tradeDate = new Date(t.createdAt);
            } else {
              return false;
            }
            const today = new Date();
            return tradeDate.toDateString() === today.toDateString();
          })
          .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
        weeklyPnL: trades
          .filter(t => {
            let tradeDate: Date;
            if (t.createdAt?.toDate) {
              tradeDate = t.createdAt.toDate();
            } else if (t.createdAt) {
              tradeDate = new Date(t.createdAt);
            } else {
              return false;
            }
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            return tradeDate >= weekAgo;
          })
          .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
        monthlyPnL: trades
          .filter(t => {
            let tradeDate: Date;
            if (t.createdAt?.toDate) {
              tradeDate = t.createdAt.toDate();
            } else if (t.createdAt) {
              tradeDate = new Date(t.createdAt);
            } else {
              return false;
            }
            const monthAgo = new Date();
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return tradeDate >= monthAgo;
          })
          .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
      };
    } catch (err: any) {
      if (err instanceof NotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      logger.error({ err }, 'Error getting user PnL');
      return reply.code(500).send({ error: err.message || 'Error fetching user PnL' });
    }
  });

  // GET /api/users/:id/trades - Get user trades
  fastify.get('/:id/trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { limit = 100 } = request.query;
      const user = (request as any).user;
      
      // Users can only view their own trades unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const trades = await firestoreAdapter.getTrades(id, limit);
      
      return {
        trades: trades.map(trade => ({
          ...trade,
          createdAt: trade.createdAt?.toDate?.()?.toISOString() || new Date(trade.createdAt).toISOString(),
          updatedAt: trade.updatedAt?.toDate?.()?.toISOString() || new Date(trade.updatedAt).toISOString(),
        })),
        count: trades.length,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user trades');
      return reply.code(500).send({ error: err.message || 'Error fetching user trades' });
    }
  });

  // GET /api/users/:id/logs - Get user activity logs
  fastify.get('/:id/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: number } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const { limit = 100 } = request.query;
      const user = (request as any).user;
      
      // Users can only view their own logs unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const logs = await firestoreAdapter.getActivityLogs(id, limit);
      
      return {
        logs: logs.map(log => ({
          ...log,
          timestamp: log.timestamp?.toDate?.()?.toISOString() || new Date(log.timestamp).toISOString(),
        })),
        count: logs.length,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user logs');
      return reply.code(500).send({ error: err.message || 'Error fetching user logs' });
    }
  });

  // GET /api/users/:id/usage-stats - Get user usage statistics
  fastify.get('/:id/usage-stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only view their own usage stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const usageStats = await firestoreAdapter.getApiUsage(id);

      return {
        usageStats: usageStats || {
          totalRequests: 0,
          monthlyRequests: 0,
          lastRequest: null,
          apiLimits: {
            monthly: 10000,
            daily: 1000,
          },
        },
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user usage stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user usage stats' });
    }
  });

  // GET /api/users/:id/sessions - Get user sessions
  fastify.get('/:id/sessions', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only view their own sessions unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Get sessions from Firestore - assuming sessions are stored in a sessions collection
      const db = getFirebaseAdmin().firestore();
      const sessionsSnapshot = await db
        .collection('users')
        .doc(id)
        .collection('sessions')
        .orderBy('lastActive', 'desc')
        .limit(10)
        .get();

      const sessions = sessionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        lastActive: doc.data().lastActive?.toDate?.()?.toISOString() || null,
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
      }));

      return { sessions };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user sessions');
      return reply.code(500).send({ error: err.message || 'Error fetching user sessions' });
    }
  });

  // GET /user/profile - Get user profile
  fastify.get('/user/profile', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      const userData = await firestoreAdapter.getUser(user.uid);
      if (!userData) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if user has exchange API keys configured
      const db = admin.firestore(getFirebaseAdmin());
      const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted;

      // Convert timestamps
      const result = { ...userData };
      if (result.createdAt) {
        result.createdAt = result.createdAt.toDate().toISOString();
      }
      if (result.updatedAt) {
        result.updatedAt = result.updatedAt.toDate().toISOString();
      }

      // Override apiConnected with computed value
      result.apiConnected = hasExchangeConfig || false;

      return result;
    } catch (err: any) {
      logger.error({ err }, 'Error getting user profile');
      return reply.code(500).send({ error: err.message || 'Error fetching user profile' });
    }
  });

  // POST /user/profile/update - Update user profile
  fastify.post('/user/profile/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = updateUserSchema.parse(request.body);

    try {
      await firestoreAdapter.createOrUpdateUser(user.uid, body);

      // Log activity
      const changedFields = Object.keys(body);
      await firestoreAdapter.logActivity(user.uid, 'PROFILE_UPDATED', {
        fields: changedFields,
        hasName: !!body.name,
        hasPhone: !!body.phone,
        hasCountry: !!body.country,
      });

      return { success: true, message: 'Profile updated successfully', uid: user.uid };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid input', details: err.errors });
      }
      logger.error({ err }, 'Error updating user profile');
      return reply.code(500).send({ error: err.message || 'Error updating user profile' });
    }
  });

  // POST /api/users/test-route - Test route
  fastify.post('/test-route', {
    // preHandler: [fastify.authenticate], // Temporarily disabled for testing
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    console.log("[TEST ROUTE] Called!");
    return reply.send({ ok: true, message: "Test route works" });
  });
}

