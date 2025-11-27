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

  // GET /api/users/:id/sessions - Get user login sessions
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

      // Get login sessions from activity logs (filter by USER_LOGIN type)
      const logs = await firestoreAdapter.getActivityLogs(id, 50);
      const loginSessions = logs
        .filter(log => log.type === 'USER_LOGIN')
        .slice(0, 5) // Last 5 sessions
        .map(log => ({
          id: log.id,
          timestamp: log.timestamp?.toDate?.()?.toISOString() || new Date(log.timestamp).toISOString(),
          device: log.details?.device || 'Unknown',
          ip: log.details?.ip || 'Unknown',
          location: log.details?.location || 'Unknown',
        }));

      return {
        sessions: loginSessions,
        count: loginSessions.length,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting user sessions');
      return reply.code(500).send({ error: err.message || 'Error fetching user sessions' });
    }
  });

  // POST /api/users/:id/logout-all - Logout all sessions
  fastify.post('/:id/logout-all', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only logout their own sessions unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Log the logout all sessions action
      await firestoreAdapter.logActivity(id, 'LOGOUT_ALL_SESSIONS', {
        message: `User ${user.email} logged out all sessions`,
        email: user.email,
      });

      // In a real implementation, you'd invalidate all refresh tokens
      // For now, we'll just log the action
      return { message: 'All sessions logged out successfully' };
    } catch (err: any) {
      logger.error({ err }, 'Error logging out all sessions');
      return reply.code(500).send({ error: err.message || 'Error logging out all sessions' });
    }
  });

  // POST /api/users/:id/request-delete - Request account deletion
  fastify.post('/:id/request-delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only request deletion of their own account
      if (id !== user.uid) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Update user status to pending deletion
      await firestoreAdapter.createOrUpdateUser(id, {
        deletionRequestedAt: new Date(),
      });

      // Log the deletion request
      await firestoreAdapter.logActivity(id, 'ACCOUNT_DELETION_REQUESTED', {
        message: `User ${user.email} requested account deletion`,
        email: user.email,
      });

      return { message: 'Account deletion request submitted. Waiting for admin approval.' };
    } catch (err: any) {
      logger.error({ err }, 'Error requesting account deletion');
      return reply.code(500).send({ error: err.message || 'Error requesting account deletion' });
    }
  });

  // GET /api/users/:id/exchange-status - Get connected exchange status
  fastify.get('/:id/exchange-status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only view their own exchange status unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Get exchange config
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();

      let exchangeStatus = {
        connected: false,
        exchange: null,
        accountId: null,
        autoTradeStatus: 'Inactive',
        lastTradeTimestamp: null,
      };

      if (exchangeConfigDoc.exists) {
        const config = exchangeConfigDoc.data();
        if (config?.apiKeyEncrypted && config?.secretEncrypted) {
          exchangeStatus.connected = true;
          exchangeStatus.exchange = config.exchange || 'binance';
          exchangeStatus.accountId = config.accountId || null;

          // Get auto-trade status
          const settingsDoc = await db.collection('users').doc(id).collection('settings').doc('current').get();
          if (settingsDoc.exists) {
            const settings = settingsDoc.data();
            exchangeStatus.autoTradeStatus = settings?.autoTradeEnabled ? 'Active' : 'Paused';
          }

          // Get last trade timestamp
          const trades = await firestoreAdapter.getTrades(id, 1);
          if (trades.length > 0) {
            exchangeStatus.lastTradeTimestamp = trades[0].createdAt?.toDate?.()?.toISOString() || new Date(trades[0].createdAt).toISOString();
          }
        }
      }

      return exchangeStatus;
    } catch (err: any) {
      logger.error({ err }, 'Error getting exchange status');
      return reply.code(500).send({ error: err.message || 'Error fetching exchange status' });
    }
  });

  // GET /api/users/:id/api-providers-status - Get API providers status
  fastify.get('/:id/api-providers-status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const { id } = request.params;
      const user = (request as any).user;

      // Users can only view their own API providers status unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (id !== user.uid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const integrations = await firestoreAdapter.getEnabledIntegrations(id);

      const providers = {
        binance: { name: 'Binance Public', status: 'Active', connected: true }, // Always active
        cryptoCompare: {
          name: 'CryptoCompare',
          status: integrations['cryptocompare'] ? 'Connected' : 'Not Connected',
          connected: !!integrations['cryptocompare']
        },
        newsData: {
          name: 'NewsData',
          status: integrations['newsdata'] ? 'Connected' : 'Not Connected',
          connected: !!integrations['newsdata']
        },
        coinMarketCap: {
          name: 'CoinMarketCap',
          status: integrations['coinmarketcap'] ? 'Connected' : 'Not Connected',
          connected: !!integrations['coinmarketcap']
        },
      };

      return { providers };
    } catch (err: any) {
      logger.error({ err }, 'Error getting API providers status');
      return reply.code(500).send({ error: err.message || 'Error fetching API providers status' });
    }
  });

  // GET /api/users/:id/usage-stats - Get usage statistics
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

      // Get research logs
      const researchLogs = await firestoreAdapter.getResearchLogs(id, 1000);

      // Get trades for auto-trade runs (trades that were executed automatically)
      const trades = await firestoreAdapter.getTrades(id, 1000);
      const autoTradeRuns = trades.filter(trade => trade.source === 'auto-trade' || trade.automated).length;

      // Calculate statistics
      const totalDeepResearchRuns = researchLogs.length;
      const totalAutoTradeRuns = autoTradeRuns;
      const totalManualResearchRuns = researchLogs.length; // automated field not available, count all as manual

      const lastResearchTimestamp = researchLogs.length > 0
        ? researchLogs[0].timestamp?.toDate?.()?.toISOString() || researchLogs[0].timestamp?.toISOString?.() || null
        : null;

      return {
        totalDeepResearchRuns,
        totalAutoTradeRuns,
        totalManualResearchRuns,
        lastResearchTimestamp,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting usage stats');
      return reply.code(500).send({ error: err.message || 'Error fetching usage stats' });
    }
  });
}

