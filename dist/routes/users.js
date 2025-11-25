"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRoutes = usersRoutes;
const zod_1 = require("zod");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const userOnboarding_1 = require("../services/userOnboarding");
const createUserSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    plan: zod_1.z.string().optional(),
    apiConnected: zod_1.z.boolean().optional(),
    unlockedAgents: zod_1.z.array(zod_1.z.string()).optional(),
    profilePicture: zod_1.z.string().optional(),
    hftStatus: zod_1.z.string().optional(),
    engineStatus: zod_1.z.string().optional(),
    totalPnL: zod_1.z.number().optional(),
    totalTrades: zod_1.z.number().optional(),
    settings: zod_1.z.any().optional(),
});
const updateUserSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    country: zod_1.z.string().optional(),
    plan: zod_1.z.string().optional(),
    apiConnected: zod_1.z.boolean().optional(),
    unlockedAgents: zod_1.z.array(zod_1.z.string()).optional(),
    profilePicture: zod_1.z.string().optional(),
    hftStatus: zod_1.z.string().optional(),
    engineStatus: zod_1.z.string().optional(),
    totalPnL: zod_1.z.number().optional(),
    totalTrades: zod_1.z.number().optional(),
    settings: zod_1.z.any().optional(),
});
async function usersRoutes(fastify) {
    // GET /api/users - Get all users (admin only)
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            // Check if user is admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (!isAdmin) {
                return reply.code(403).send({ error: 'Admin access required' });
            }
            const users = await firestoreAdapter_1.firestoreAdapter.getAllUsers();
            return { users };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting users');
            return reply.code(500).send({ error: err.message || 'Error fetching users' });
        }
    });
    // GET /api/users/:uid - Get specific user
    fastify.get('/:uid', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const user = request.user;
            // Users can only view their own data unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (uid !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(uid);
            if (!userData) {
                throw new errors_1.NotFoundError('User not found');
            }
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
            const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;
            const result = { ...userData };
            if (result.createdAt) {
                result.createdAt = result.createdAt.toDate().toISOString();
            }
            if (result.updatedAt) {
                result.updatedAt = result.updatedAt.toDate().toISOString();
            }
            result.apiConnected = hasExchangeConfig || false;
            return result;
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return reply.code(404).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error getting user');
            return reply.code(500).send({ error: err.message || 'Error fetching user' });
        }
    });
    // POST /api/users/create - Create user (called on sign-in)
    // PART 1: Creates ALL required Firestore documents
    fastify.post('/create', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = createUserSchema.parse(request.body);
            // PART 1: Comprehensive onboarding - creates ALL required documents (idempotent)
            const onboardingResult = await (0, userOnboarding_1.ensureUser)(user.uid, {
                name: body.name || user.displayName || '',
                email: body.email || user.email || '',
                phone: body.phone || null,
            });
            if (!onboardingResult.success) {
                logger_1.logger.error({ uid: user.uid, error: onboardingResult.error }, 'User onboarding failed');
                return reply.code(500).send({
                    error: onboardingResult.error || 'User onboarding failed'
                });
            }
            // Update additional fields if provided
            if (body.plan || body.profilePicture || body.unlockedAgents) {
                await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                    plan: body.plan,
                    profilePicture: body.profilePicture,
                    unlockedAgents: body.unlockedAgents,
                });
            }
            // Log login activity (signup already logged in onboardNewUser)
            const existingUser = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
            if (existingUser && existingUser.createdAt) {
                // Check if this is a returning user (created > 1 minute ago)
                const createdTime = existingUser.createdAt.toDate();
                const now = new Date();
                const minutesSinceCreation = (now.getTime() - createdTime.getTime()) / 1000 / 60;
                if (minutesSinceCreation > 1) {
                    await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'USER_LOGIN', {
                        message: `User ${body.email || user.email} logged in`,
                        email: body.email || user.email,
                    });
                }
            }
            return { message: 'User created/updated successfully', uid: user.uid };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error creating user');
            return reply.code(500).send({ error: err.message || 'Error creating user' });
        }
    });
    // POST /api/users/update - Update user
    fastify.post('/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = updateUserSchema.parse(request.body);
            await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, body);
            // Log activity
            const changedFields = Object.keys(body);
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'PROFILE_UPDATED', {
                fields: changedFields,
                hasName: !!body.name,
                hasPhone: !!body.phone,
                hasCountry: !!body.country,
            });
            return { message: 'User updated successfully', uid: user.uid };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error updating user');
            return reply.code(500).send({ error: err.message || 'Error updating user' });
        }
    });
    fastify.get('/:id/details', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const user = request.user;
            // Users can only view their own data unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(id);
            if (!userData) {
                throw new errors_1.NotFoundError('User not found');
            }
            // Check if user has exchange API keys configured (read from exchangeConfig/current)
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const exchangeConfigDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
            const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;
            // Convert timestamps
            const result = { ...userData };
            if (result.createdAt) {
                result.createdAt = result.createdAt.toDate().toISOString();
            }
            if (result.updatedAt) {
                result.updatedAt = result.updatedAt.toDate().toISOString();
            }
            // Override apiConnected with computed value from exchangeConfig/current
            result.apiConnected = hasExchangeConfig || false;
            return result;
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return reply.code(404).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error getting user details');
            return reply.code(500).send({ error: err.message || 'Error fetching user details' });
        }
    });
    // GET /api/users/:id/stats - Get user statistics
    fastify.get('/:id/stats', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const user = request.user;
            // Users can only view their own stats unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(id);
            if (!userData) {
                throw new errors_1.NotFoundError('User not found');
            }
            // Get trades for PnL calculation
            const trades = await firestoreAdapter_1.firestoreAdapter.getTrades(id, 1000);
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
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return reply.code(404).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error getting user stats');
            return reply.code(500).send({ error: err.message || 'Error fetching user stats' });
        }
    });
    // GET /api/users/:id/pnl - Get user PnL
    fastify.get('/:id/pnl', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const user = request.user;
            // Users can only view their own PnL unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(id);
            if (!userData) {
                throw new errors_1.NotFoundError('User not found');
            }
            // Get trades for PnL calculation
            const trades = await firestoreAdapter_1.firestoreAdapter.getTrades(id, 1000);
            const totalPnL = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
            return {
                totalPnL: userData.totalPnL || totalPnL,
                dailyPnL: trades
                    .filter(t => {
                    let tradeDate;
                    if (t.createdAt?.toDate) {
                        tradeDate = t.createdAt.toDate();
                    }
                    else if (t.createdAt) {
                        tradeDate = new Date(t.createdAt);
                    }
                    else {
                        return false;
                    }
                    const today = new Date();
                    return tradeDate.toDateString() === today.toDateString();
                })
                    .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
                weeklyPnL: trades
                    .filter(t => {
                    let tradeDate;
                    if (t.createdAt?.toDate) {
                        tradeDate = t.createdAt.toDate();
                    }
                    else if (t.createdAt) {
                        tradeDate = new Date(t.createdAt);
                    }
                    else {
                        return false;
                    }
                    const weekAgo = new Date();
                    weekAgo.setDate(weekAgo.getDate() - 7);
                    return tradeDate >= weekAgo;
                })
                    .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
                monthlyPnL: trades
                    .filter(t => {
                    let tradeDate;
                    if (t.createdAt?.toDate) {
                        tradeDate = t.createdAt.toDate();
                    }
                    else if (t.createdAt) {
                        tradeDate = new Date(t.createdAt);
                    }
                    else {
                        return false;
                    }
                    const monthAgo = new Date();
                    monthAgo.setMonth(monthAgo.getMonth() - 1);
                    return tradeDate >= monthAgo;
                })
                    .reduce((sum, trade) => sum + (trade.pnl || 0), 0),
            };
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return reply.code(404).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error getting user PnL');
            return reply.code(500).send({ error: err.message || 'Error fetching user PnL' });
        }
    });
    // GET /api/users/:id/trades - Get user trades
    fastify.get('/:id/trades', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { limit = 100 } = request.query;
            const user = request.user;
            // Users can only view their own trades unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const trades = await firestoreAdapter_1.firestoreAdapter.getTrades(id, limit);
            return {
                trades: trades.map(trade => ({
                    ...trade,
                    createdAt: trade.createdAt?.toDate?.()?.toISOString() || new Date(trade.createdAt).toISOString(),
                    updatedAt: trade.updatedAt?.toDate?.()?.toISOString() || new Date(trade.updatedAt).toISOString(),
                })),
                count: trades.length,
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting user trades');
            return reply.code(500).send({ error: err.message || 'Error fetching user trades' });
        }
    });
    // GET /api/users/:id/logs - Get user activity logs
    fastify.get('/:id/logs', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const { limit = 100 } = request.query;
            const user = request.user;
            // Users can only view their own logs unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const logs = await firestoreAdapter_1.firestoreAdapter.getActivityLogs(id, limit);
            return {
                logs: logs.map(log => ({
                    ...log,
                    timestamp: log.timestamp?.toDate?.()?.toISOString() || new Date(log.timestamp).toISOString(),
                })),
                count: logs.length,
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting user logs');
            return reply.code(500).send({ error: err.message || 'Error fetching user logs' });
        }
    });
}
