"use strict";
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
    // GET /api/users/:uid/details - Get user details (MUST be before /:uid route)
    fastify.get('/:uid/details', {
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
                return reply.code(404).send({ error: 'User not found' });
            }
            // Convert timestamps and ensure all fields are properly formatted
            const result = { ...userData };
            // Convert Firestore timestamps to ISO strings
            if (result.createdAt && result.createdAt.toDate) {
                result.createdAt = result.createdAt.toDate().toISOString();
            }
            else if (result.createdAt) {
                result.createdAt = new Date(result.createdAt).toISOString();
            }
            if (result.updatedAt && result.updatedAt.toDate) {
                result.updatedAt = result.updatedAt.toDate().toISOString();
            }
            else if (result.updatedAt) {
                result.updatedAt = new Date(result.updatedAt).toISOString();
            }
            // Ensure all required profile fields are present
            return {
                uid: result.uid || uid,
                name: result.name || '',
                email: result.email || '',
                phone: result.phone || '',
                plan: result.plan || 'free',
                createdAt: result.createdAt || new Date().toISOString(),
                updatedAt: result.updatedAt || new Date().toISOString(),
                ...result, // Include any additional fields
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting user details');
            return reply.code(500).send({ error: err.message || 'Error fetching user details' });
        }
    });
    // GET /api/users/:uid/stats - Get user statistics (MUST be before /:uid route)
    fastify.get('/:uid/stats', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const user = request.user;
            // Users can only view their own stats unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (uid !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(uid);
            if (!userData) {
                return reply.code(404).send({ error: 'User not found' });
            }
            // Get trades for lastTrade and dailyPnl calculation
            const trades = await firestoreAdapter_1.firestoreAdapter.getTrades(uid, 100);
            const lastTrade = trades.length > 0 ? trades[0] : null;
            // Calculate daily PnL (today's trades)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dailyPnl = trades
                .filter((trade) => {
                if (!trade.timestamp)
                    return false;
                const tradeDate = new Date(trade.timestamp);
                return tradeDate >= today;
            })
                .reduce((sum, trade) => sum + (trade.pnl || 0), 0);
            // Get active agents count
            const unlockedAgents = await firestoreAdapter_1.firestoreAdapter.getUserUnlockedAgents(uid);
            const activeAgents = unlockedAgents.filter((agent) => agent.status === 'active').length;
            // Get active strategies count from settings
            const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(uid);
            const activeStrategies = settings?.strategy ? 1 : 0; // Count enabled strategies
            // Calculate win rate if not already stored
            let winRate = userData.winRate || 0;
            if (userData.totalTrades && userData.totalTrades > 0 && !userData.winRate) {
                // Calculate from trades if available
                const winningTrades = trades.filter((t) => (t.pnl || 0) > 0).length;
                winRate = (winningTrades / Math.min(trades.length, userData.totalTrades)) * 100;
            }
            // Return user statistics matching Dashboard.tsx expectations
            const stats = {
                totalTrades: userData.totalTrades || 0,
                totalPnl: userData.totalPnL || 0, // Note: stored as totalPnL in DB
                dailyPnl: dailyPnl,
                winRate: winRate,
                lastTrade: lastTrade ? {
                    id: lastTrade.id,
                    symbol: lastTrade.symbol,
                    pnl: lastTrade.pnl || 0,
                    timestamp: lastTrade.timestamp,
                    side: lastTrade.side,
                } : null,
                activeAgents: activeAgents,
                activeStrategies: activeStrategies,
            };
            return stats;
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting user stats');
            return reply.code(500).send({ error: err.message || 'Error fetching user stats' });
        }
    });
    // GET /api/users/:uid - Get specific user (MUST be after /:uid/details and /:uid/stats)
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
            // Convert timestamps
            const result = { ...userData };
            if (result.createdAt) {
                result.createdAt = result.createdAt.toDate().toISOString();
            }
            if (result.updatedAt) {
                result.updatedAt = result.updatedAt.toDate().toISOString();
            }
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
}
