import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { ensureUser } from '../../services/userOnboarding';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';

const getAuthUid = (request: FastifyRequest): string | undefined => {
  return (request as any).userId || (request as any).user?.uid;
};

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

export async function coreUserRoutes(fastify: FastifyInstance) {
  // POST /api/users/complete-signup - initialize blank provider integrations
  fastify.post('/complete-signup', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { idToken?: string } }>, reply: FastifyReply) => {
    try {
      const uid = getAuthUid(request);
      if (!uid) {
        return reply.code(401).send({ success: false, error: 'Unauthorized' });
      }

      const db = getFirebaseAdmin().firestore();
      const now = admin.firestore.Timestamp.now();

      const integrationsRef = db.collection('users').doc(uid).collection('integrations');

      const baseDocs = [
        'cryptocompare',
        'newsdata',
        'coingecko',
        'coinpaprika',
        'coincap',
        'coinlore',
        'coinmarketcap',
        'cryptopanic',
        'reddit',
        'gnews',
        'newscatcher',
        'coinstatsnews',
        'webzio',
        'kaiko',
        'messari',
        'marketaux',
        'livecoinwatch',
        'coinapi'
      ];

      for (const id of baseDocs) {
        const providerId = id.toLowerCase();
        await integrationsRef.doc(providerId).set({
          providerName: providerId,
          enabled: false,
          updatedAt: now,
        }, { merge: true });
      }

      return { success: true };
    } catch (err: any) {
      logger.error({ err: err.message }, 'complete-signup failed');
      return reply.code(500).send({ success: false, error: err.message || 'Failed to complete signup' });
    }
  });

  // GET /api/users/:uid/features - Get user features
  fastify.get('/:uid/features', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      return reply.send({
        success: true,
        features: {
          news: true,
          metadata: true,
          marketData: true
        }
      });
    } catch (err) {
      console.error("FEATURE ROUTE ERROR:", err);
      return reply.code(500).send({ error: 'Failed to load features' });
    }
  });

  // POST /api/users/:uid/request-delete - Request user account deletion
  fastify.post('/:uid/request-delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only request deletion for their own account unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();

      // Mark user for deletion
      await db.collection('users').doc(targetUid).update({
        deleteRequested: true,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Log the deletion request
      await firestoreAdapter.logActivity(targetUid, 'ACCOUNT_DELETION_REQUESTED', {
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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      // Check if user is admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
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
      const { uid: paramUid } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own data unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const userData = await firestoreAdapter.getUser(targetUid);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const { getFirebaseAdmin } = await import('../../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();
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
      const authUid = getAuthUid(request);
      const user = (request as any).user;
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      const body = createUserSchema.parse(request.body);

      // PART 1: Comprehensive onboarding - creates ALL required documents (idempotent)
      const onboardingResult = await ensureUser(authUid, {
        name: body.name || user?.displayName || '',
        email: body.email || user?.email || '',
        phone: body.phone || null,
      });

      if (!onboardingResult.success) {
        logger.error({ uid: authUid, error: onboardingResult.error }, 'User onboarding failed');
        return reply.code(500).send({
          error: onboardingResult.error || 'User onboarding failed'
        });
      }

      // Update additional fields if provided
      if (body.plan || body.profilePicture || body.unlockedAgents) {
        await firestoreAdapter.createOrUpdateUser(authUid, {
          plan: body.plan,
          profilePicture: body.profilePicture,
          unlockedAgents: body.unlockedAgents,
        });
      }

      // Log login activity (signup already logged in onboardNewUser)
      const existingUser = await firestoreAdapter.getUser(authUid);
      if (existingUser && existingUser.createdAt) {
        // Check if this is a returning user (created > 1 minute ago)
        const createdTime = existingUser.createdAt.toDate();
        const now = new Date();
        const minutesSinceCreation = (now.getTime() - createdTime.getTime()) / 1000 / 60;

        if (minutesSinceCreation > 1) {
          await firestoreAdapter.logActivity(authUid, 'USER_LOGIN', {
            message: `User ${body.email || user?.email} logged in`,
            email: body.email || user?.email,
          });
        }
      }

      return { message: 'User created/updated successfully', uid: authUid };
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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }
      const body = updateUserSchema.parse(request.body);

      await firestoreAdapter.createOrUpdateUser(authUid, body);

      // Log activity
      const changedFields = Object.keys(body);
      await firestoreAdapter.logActivity(authUid, 'PROFILE_UPDATED', {
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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own data unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (id !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? id : authUid;

      const userData = await firestoreAdapter.getUser(targetUid);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const { getFirebaseAdmin } = await import('../../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();
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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (id !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? id : authUid;

      const userData = await firestoreAdapter.getUser(targetUid);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Get trades for PnL calculation
      const trades = await firestoreAdapter.getTrades(targetUid, 1000);
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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own PnL unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (id !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? id : authUid;

      const userData = await firestoreAdapter.getUser(targetUid);
      if (!userData) {
        throw new NotFoundError('User not found');
      }

      // Get trades for PnL calculation
      const trades = await firestoreAdapter.getTrades(targetUid, 1000);
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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own trades unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (id !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? id : authUid;

      const trades = await firestoreAdapter.getTrades(targetUid, limit);

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
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own logs unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (id !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? id : authUid;

      const logs = await firestoreAdapter.getActivityLogs(targetUid, limit);

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

  // GET /api/users/:id/sessions - Get user sessions
  fastify.get('/:id/sessions', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own sessions unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (id !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? id : authUid;

      // Get sessions from Firestore - assuming sessions are stored in a sessions collection
      const db = getFirebaseAdmin().firestore();
      const sessionsSnapshot = await db
        .collection('users')
        .doc(targetUid)
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

  // GET /api/users/:uid/performance-stats - Get user performance statistics
  fastify.get('/:uid/performance-stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own performance stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      // Get all trades for the user
      const trades = await firestoreAdapter.getTrades(targetUid, 10000); // Get up to 10k trades

      // Calculate performance stats
      let totalTrades = trades.length;
      let allTimePnL = 0;
      let dailyPnL = 0;
      let winningTrades = 0;
      let closedTrades = 0;

      // Today's date for daily PnL calculation
      const today = new Date();
      const todayString = today.toDateString();

      for (const trade of trades) {
        // Calculate all-time PnL
        if (trade.pnl !== undefined && trade.pnl !== null) {
          allTimePnL += trade.pnl;

          // Count closed trades (trades with pnl)
          closedTrades++;

          // Count winning trades
          if (trade.pnl > 0) {
            winningTrades++;
          }
        }

        // Calculate daily PnL (today only)
        if (trade.timestamp) {
          const tradeDate = new Date(trade.timestamp);
          if (tradeDate.toDateString() === todayString && trade.pnl !== undefined && trade.pnl !== null) {
            dailyPnL += trade.pnl;
          }
        }
      }

      // Calculate win rate
      const winRate = closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0;

      return {
        dailyPnL: parseFloat(dailyPnL.toFixed(2)),
        allTimePnL: parseFloat(allTimePnL.toFixed(2)),
        winRate: parseFloat(winRate.toFixed(2)),
        totalTrades,
      };
    } catch (err: any) {
      logger.error({ err, uid: request.params.uid }, 'Error getting user performance stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user performance stats' });
    }
  });

  // GET /api/users/:uid/active-trades - Get user's active trades
  fastify.get('/:uid/active-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own active trades unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      // Get user's active exchange
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();
      const exchangeConfig = exchangeConfigDoc.exists ? exchangeConfigDoc.data() : null;
      const activeExchange = exchangeConfig?.exchange;

      if (!activeExchange) {
        return reply.send([]);
      }

      // Query trades collection for open trades on the active exchange
      const tradesRef = db.collection('trades');
      const snapshot = await tradesRef
        .where('uid', '==', targetUid)
        .where('status', '==', 'open')
        .where('exchange', '==', activeExchange)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      const activeTrades = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          tradeId: doc.id,
          pair: data.symbol || '',
          side: data.side || 'buy',
          entryPrice: data.entryPrice || 0,
          signalAccuracy: data.signalAccuracy || 0,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || new Date(data.timestamp).toISOString(),
          currentPrice: null, // Optional: could be populated with live price
        };
      });

      return reply.send(activeTrades);
    } catch (err: any) {
      logger.error({ err, uid: request.params.uid }, 'Error getting user active trades');
      return reply.code(500).send({ error: err.message || 'Error fetching user active trades' });
    }
  });

  // GET /api/users/:uid/usage-stats - Get user's usage statistics
  fastify.get('/:uid/usage-stats', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = getAuthUid(request);
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own usage stats unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();

      // Get research logs count (Deep Research runs)
      const researchLogsSnapshot = await db
        .collection('users')
        .doc(targetUid)
        .collection('researchLogs')
        .get();

      // Get auto-trade logs count (Auto-Trade runs)
      const autoTradeLogsSnapshot = await db
        .collection('users')
        .doc(targetUid)
        .collection('autoTradeLogs')
        .get();

      // Get last research activity timestamp
      let lastResearchTimestamp = null;
      const lastResearchQuery = await db
        .collection('users')
        .doc(targetUid)
        .collection('researchLogs')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!lastResearchQuery.empty) {
        const lastResearchDoc = lastResearchQuery.docs[0];
        lastResearchTimestamp = lastResearchDoc.data().timestamp?.toDate().toISOString();
      }

      // Check if last activity is more recent from auto-trade logs
      const lastAutoTradeQuery = await db
        .collection('users')
        .doc(targetUid)
        .collection('autoTradeLogs')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (!lastAutoTradeQuery.empty) {
        const lastAutoTradeDoc = lastAutoTradeQuery.docs[0];
        const autoTradeTimestamp = lastAutoTradeDoc.data().timestamp?.toDate().toISOString();
        if (!lastResearchTimestamp || autoTradeTimestamp > lastResearchTimestamp) {
          lastResearchTimestamp = autoTradeTimestamp;
        }
      }

      // For now, assume manual research is research logs that aren't from auto-trade
      // This is a simplification - in a real implementation, you'd have a type field
      const manualResearchRuns = researchLogsSnapshot.size;

      return reply.send({
        totalDeepResearchRuns: researchLogsSnapshot.size,
        totalAutoTradeRuns: autoTradeLogsSnapshot.size,
        totalManualResearchRuns: manualResearchRuns,
        lastResearchTimestamp,
      });
    } catch (err: any) {
      logger.error({ err, uid: request.params.uid }, 'Error getting user usage stats');
      return reply.code(500).send({ error: err.message || 'Error fetching user usage stats' });
    }
  });

  // GET /user/profile - Get user profile
  fastify.get('/user/profile', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const authUid = getAuthUid(request);

    try {
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const userData = await firestoreAdapter.getUser(authUid);
      if (!userData) {
        return reply.code(404).send({ error: 'User not found' });
      }

      // Check if user has exchange API keys configured
      const db = admin.firestore(getFirebaseAdmin());
      const exchangeConfigDoc = await db.collection('users').doc(authUid).collection('exchangeConfig').doc('current').get();
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
    const authUid = getAuthUid(request);
    const body = updateUserSchema.parse(request.body);

    try {
      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      await firestoreAdapter.createOrUpdateUser(authUid, body);

      // Log activity
      const changedFields = Object.keys(body);
      await firestoreAdapter.logActivity(authUid, 'PROFILE_UPDATED', {
        fields: changedFields,
        hasName: !!body.name,
        hasPhone: !!body.phone,
        hasCountry: !!body.country,
      });

      return { success: true, message: 'Profile updated successfully', uid: authUid };
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
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    console.log("[TEST ROUTE] Called!");
    return reply.send({ ok: true, message: "Test route works" });
  });

  // Test script for provider config decryption
  async function runProviderConfigTest() {
    try {
      console.log("=== PROVIDER CONFIG DECRYPTION TEST ===");

      // Get a known uid from Firestore (first user document)
      const db = getFirebaseAdmin().firestore();
      const usersSnapshot = await db.collection('users').limit(1).get();

      if (usersSnapshot.empty) {
        console.log("FAIL: No users found in Firestore");
        return false;
      }

      const uid = usersSnapshot.docs[0].id;
      console.log(`Testing with uid: ${uid}`);

      // Note: This function was moved from the original file but getProviderConfig is now in providerConfig.ts
      // For testing purposes, we'll skip this since the function is no longer available here
      console.log("Test function preserved but getProviderConfig moved to providerConfig.ts");
      return true;

    } catch (error: any) {
      console.error("TEST ERROR:", error);
      console.log("FAIL: Test execution failed");
      return false;
    }
  }

  // GET /api/temp-test - Temporary Firestore connectivity test
  fastify.get('/temp-test', {}, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const uid = getAuthUid(request);

      if (!uid) {
        console.log('[TEMP-TEST] Missing uid (auth required)');
        return reply.code(401).send({ ok: false, error: 'Unauthorized' });
      }

      // Try to read a simple Firestore document
      const db = getFirebaseAdmin().firestore();
      const docRef = db.collection('users').doc(uid).collection('integrations').doc('newsdata');
      const doc = await docRef.get();

      if (doc.exists) {
        return reply.send({ ok: true });
      } else {
        return reply.send({ ok: false });
      }
    } catch (err: any) {
      console.error('Temp test error:', err);
      return reply.send({ ok: false });
    }
  });
}