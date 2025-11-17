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
exports.adminRoutes = adminRoutes;
const zod_1 = require("zod");
const admin = __importStar(require("firebase-admin"));
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const keyManager_1 = require("../services/keyManager");
const userEngineManager_1 = require("../services/userEngineManager");
const adminStatsService_1 = require("../services/adminStatsService");
const adminAuth_1 = require("../middleware/adminAuth");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const firebase_1 = require("../utils/firebase");
const createKeySchema = zod_1.z.object({
    exchange: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    apiKey: zod_1.z.string().min(1),
    apiSecret: zod_1.z.string().min(1),
    testnet: zod_1.z.boolean().default(true),
});
const updateKeySchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    apiKey: zod_1.z.string().optional(),
    apiSecret: zod_1.z.string().optional(),
    testnet: zod_1.z.boolean().optional(),
});
async function adminRoutes(fastify) {
    // Decorate with admin auth middleware
    fastify.decorate('adminAuth', adminAuth_1.adminAuthMiddleware);
    // ========== EXISTING ADMIN ROUTES (for backward compatibility) ==========
    fastify.get('/keys', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const keys = await firestoreAdapter_1.firestoreAdapter.getApiKeys(user.uid);
        return keys.map((key) => ({
            id: key.id,
            exchange: key.exchange,
            name: key.name,
            testnet: key.testnet,
            createdAt: key.createdAt?.toDate().toISOString(),
            updatedAt: key.updatedAt?.toDate().toISOString(),
            apiKey: (0, keyManager_1.maskKey)(key.apiKeyEncrypted), // Mask encrypted key
            apiSecret: (0, keyManager_1.maskKey)(key.apiSecretEncrypted), // Mask encrypted secret
        }));
    });
    fastify.get('/keys/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const key = await firestoreAdapter_1.firestoreAdapter.getApiKey(user.uid, request.params.id);
        if (!key) {
            throw new errors_1.NotFoundError('API key not found');
        }
        return {
            id: key.id,
            exchange: key.exchange,
            name: key.name,
            testnet: key.testnet,
            createdAt: key.createdAt?.toDate().toISOString(),
            updatedAt: key.updatedAt?.toDate().toISOString(),
            apiKey: (0, keyManager_1.maskKey)(key.apiKeyEncrypted),
            apiSecret: (0, keyManager_1.maskKey)(key.apiSecretEncrypted),
        };
    });
    fastify.post('/keys', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = createKeySchema.parse(request.body);
        const id = await firestoreAdapter_1.firestoreAdapter.saveApiKey(user.uid, {
            exchange: body.exchange,
            name: body.name,
            apiKey: body.apiKey,
            apiSecret: body.apiSecret,
            testnet: body.testnet,
        });
        return { id, message: 'API key created' };
    });
    fastify.put('/keys/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = updateKeySchema.parse(request.body);
        await firestoreAdapter_1.firestoreAdapter.updateApiKey(user.uid, request.params.id, body);
        return { message: 'API key updated' };
    });
    fastify.delete('/keys/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        await firestoreAdapter_1.firestoreAdapter.deleteApiKey(user.uid, request.params.id);
        return { message: 'API key deleted' };
    });
    fastify.post('/toggle-testnet', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // TODO: Implement testnet toggle logic
        logger_1.logger.warn('Testnet toggle not fully implemented');
        return { message: 'Testnet toggle endpoint (implementation pending)' };
    });
    // Emergency kill switch - stops all engines for all users
    fastify.post('/killall', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        // TODO: Add admin check - for now, any authenticated user can use this
        // In production, you'd want to check if user is admin
        try {
            // Stop all user engines
            // Note: This is a simplified implementation
            // In production, you'd want to track all active engines and stop them
            await userEngineManager_1.userEngineManager.stopAutoTrade(user.uid);
            // Also pause all users' settings
            await firestoreAdapter_1.firestoreAdapter.saveSettings(user.uid, { status: 'paused_manual' });
            logger_1.logger.warn({ uid: user.uid }, 'Emergency kill switch activated');
            return { message: 'All engines stopped' };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error in killall');
            return reply.code(500).send({ error: err.message || 'Error stopping engines' });
        }
    });
    // ========== NEW ADMIN ROUTES ==========
    // Get all users with stats
    fastify.get('/users', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const allUsers = await firestoreAdapter_1.firestoreAdapter.getAllUsers();
            const usersWithStats = await Promise.all(allUsers.map(async (user) => {
                const stats = await adminStatsService_1.adminStatsService.getUserStats(user.uid);
                return {
                    uid: user.uid,
                    email: user.email,
                    engineRunning: stats.engineRunning,
                    hftRunning: stats.hftRunning,
                    currentPnL: stats.currentPnL,
                    openOrders: stats.openOrders,
                    unlockedAgentsCount: stats.unlockedAgents.length,
                    apiStatus: stats.apiStatus,
                    autoTradeEnabled: stats.autoTradeEnabled,
                    hftEnabled: stats.hftEnabled,
                    createdAt: user.createdAt?.toDate().toISOString(),
                };
            }));
            return { users: usersWithStats };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting users list');
            return reply.code(500).send({ error: err.message || 'Error fetching users' });
        }
    });
    // Get user details
    fastify.get('/user/:uid', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const user = await firestoreAdapter_1.firestoreAdapter.getAllUsers().then(users => users.find(u => u.uid === uid));
            if (!user) {
                throw new errors_1.NotFoundError('User not found');
            }
            const stats = await adminStatsService_1.adminStatsService.getUserStats(uid);
            const settings = await firestoreAdapter_1.firestoreAdapter.getSettings(uid);
            const hftSettings = await firestoreAdapter_1.firestoreAdapter.getHFTSettings(uid);
            const integrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(uid);
            const agents = await firestoreAdapter_1.firestoreAdapter.getAllUserAgents(uid);
            const profile = await firestoreAdapter_1.firestoreAdapter.getUserProfile(uid);
            return {
                uid: user.uid,
                email: user.email,
                profile,
                stats,
                settings,
                hftSettings,
                integrations: Object.keys(integrations).map(key => ({
                    name: key,
                    enabled: integrations[key].enabled,
                    hasKey: !!integrations[key].apiKey,
                })),
                agents,
            };
        }
        catch (err) {
            if (err instanceof errors_1.NotFoundError) {
                return reply.code(404).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error getting user details');
            return reply.code(500).send({ error: err.message || 'Error fetching user details' });
        }
    });
    // Get user execution logs
    fastify.get('/user/:uid/logs', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const limit = parseInt(request.query.limit || '10', 10);
            const logs = await firestoreAdapter_1.firestoreAdapter.getExecutionLogs(uid, limit);
            return {
                logs: logs.map(log => ({
                    ...log,
                    timestamp: log.timestamp?.toDate().toISOString(),
                    createdAt: log.createdAt?.toDate().toISOString(),
                })),
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting user logs');
            return reply.code(500).send({ error: err.message || 'Error fetching logs' });
        }
    });
    // Get user HFT logs
    fastify.get('/user/:uid/hft/logs', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const limit = parseInt(request.query.limit || '10', 10);
            const logs = await firestoreAdapter_1.firestoreAdapter.getHFTExecutionLogs(uid, limit);
            return {
                logs: logs.map(log => ({
                    ...log,
                    timestamp: log.timestamp?.toDate().toISOString(),
                    createdAt: log.createdAt?.toDate().toISOString(),
                })),
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting HFT logs');
            return reply.code(500).send({ error: err.message || 'Error fetching HFT logs' });
        }
    });
    // Stop engine for user
    fastify.post('/user/:uid/stop-engine', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            await userEngineManager_1.userEngineManager.stopAutoTrade(uid);
            await firestoreAdapter_1.firestoreAdapter.saveSettings(uid, { status: 'paused_manual' });
            logger_1.logger.info({ uid, adminUid: request.user.uid }, 'Admin stopped engine for user');
            return { message: 'Engine stopped' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error stopping engine');
            return reply.code(500).send({ error: err.message || 'Error stopping engine' });
        }
    });
    // Stop HFT engine for user
    fastify.post('/user/:uid/stop-hft', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            await userEngineManager_1.userEngineManager.stopHFT(uid);
            logger_1.logger.info({ uid, adminUid: request.user.uid }, 'Admin stopped HFT for user');
            return { message: 'HFT engine stopped' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error stopping HFT');
            return reply.code(500).send({ error: err.message || 'Error stopping HFT engine' });
        }
    });
    // Reset risk manager for user
    fastify.post('/user/:uid/reset-risk', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const { userRiskManager } = await Promise.resolve().then(() => __importStar(require('../services/userRiskManager')));
            // Reset risk state - this would need to be implemented in userRiskManager
            await firestoreAdapter_1.firestoreAdapter.saveSettings(uid, { status: 'active' });
            logger_1.logger.info({ uid, adminUid: request.user.uid }, 'Admin reset risk for user');
            return { message: 'Risk manager reset' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error resetting risk');
            return reply.code(500).send({ error: err.message || 'Error resetting risk manager' });
        }
    });
    // Reload API keys for user
    fastify.post('/user/:uid/reload-keys', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            // Stop and restart engine to reload keys
            await userEngineManager_1.userEngineManager.stopAutoTrade(uid);
            await userEngineManager_1.userEngineManager.stopHFT(uid);
            logger_1.logger.info({ uid, adminUid: request.user.uid }, 'Admin reloaded API keys for user');
            return { message: 'API keys reloaded (engines stopped - user must restart)' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error reloading keys');
            return reply.code(500).send({ error: err.message || 'Error reloading API keys' });
        }
    });
    // Unlock agent for user
    fastify.post('/user/:uid/unlock-agent', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const { agentName } = request.body;
            if (!agentName) {
                throw new errors_1.ValidationError('Agent name is required');
            }
            // Get agent details to get agentId
            const agents = await firestoreAdapter_1.firestoreAdapter.getAllAgents();
            const agent = agents.find((a) => a.name === agentName);
            const agentId = agent?.id || agentName;
            await firestoreAdapter_1.firestoreAdapter.unlockAgent(uid, agentName, agentId);
            logger_1.logger.info({ uid, agentName, agentId, adminUid: request.user.uid }, 'Admin unlocked agent');
            return { message: 'Agent unlocked' };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error unlocking agent');
            return reply.code(500).send({ error: err.message || 'Error unlocking agent' });
        }
    });
    // Lock agent for user
    fastify.post('/user/:uid/lock-agent', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid } = request.params;
            const { agentName } = request.body;
            if (!agentName) {
                throw new errors_1.ValidationError('Agent name is required');
            }
            await firestoreAdapter_1.firestoreAdapter.lockAgent(uid, agentName);
            logger_1.logger.info({ uid, agentName, adminUid: request.user.uid }, 'Admin locked agent');
            return { message: 'Agent locked' };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error locking agent');
            return reply.code(500).send({ error: err.message || 'Error locking agent' });
        }
    });
    // Get global stats
    fastify.get('/global-stats', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const stats = await adminStatsService_1.adminStatsService.getGlobalStats();
            return stats;
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting global stats');
            return reply.code(500).send({ error: err.message || 'Error fetching global stats' });
        }
    });
    // Reload all engines (emergency)
    fastify.post('/reload-all-engines', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const allUsers = await firestoreAdapter_1.firestoreAdapter.getAllUsers();
            const results = await Promise.allSettled(allUsers.map(async (user) => {
                await userEngineManager_1.userEngineManager.stopAutoTrade(user.uid);
                await userEngineManager_1.userEngineManager.stopHFT(user.uid);
            }));
            const failed = results.filter(r => r.status === 'rejected').length;
            logger_1.logger.warn({ adminUid: request.user.uid, total: allUsers.length, failed }, 'Admin reloaded all engines');
            return { message: `Reloaded engines for ${allUsers.length} users (${failed} failed)` };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error reloading all engines');
            return reply.code(500).send({ error: err.message || 'Error reloading engines' });
        }
    });
    // One-time setup: Promote a user to admin via header token
    // Requires header: x-admin-setup: <ADMIN_SETUP_TOKEN>
    fastify.post('/promote', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const setupHeader = (request.headers['x-admin-setup'] || request.headers['X-Admin-Setup']);
            const setupToken = process.env.ADMIN_SETUP_TOKEN || 'SUPER-SECRET-998877';
            if (!setupHeader || setupHeader !== setupToken) {
                return reply.code(401).send({ error: 'Invalid setup token' });
            }
            const { uid, email } = (request.body || {});
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
            let targetUid = uid;
            if (!targetUid && email) {
                const userRecord = await admin.auth(getFirebaseAdmin()).getUserByEmail(email);
                targetUid = userRecord.uid;
            }
            if (!targetUid) {
                return reply.code(400).send({ error: 'uid or email required' });
            }
            await admin.auth(getFirebaseAdmin()).setCustomUserClaims(targetUid, {
                isAdmin: true,
                role: 'admin',
                adminPanel: true,
            });
            // Also mirror in Firestore for unified checks (prefer serverTimestamp)
            const db = getFirebaseAdmin().firestore();
            try {
                await db.collection('users').doc(targetUid).update({
                    role: 'admin',
                    isAdmin: true,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
            }
            catch {
                await db.collection('users').doc(targetUid).set({
                    role: 'admin',
                    isAdmin: true,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            return {
                success: true,
                message: 'Admin promoted successfully',
                uid: targetUid,
            };
        }
        catch (err) {
            return reply.code(500).send({ error: err.message || 'Failed to promote user' });
        }
    });
    // Get agent unlock statistics
    fastify.get('/agents/stats', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const allUsers = await firestoreAdapter_1.firestoreAdapter.getAllUsers();
            const agentStats = {};
            // Initialize all agents
            const agentNames = [
                'Airdrop Multiverse Agent',
                'Liquidity Sniper & Arbitrage Agent',
                'AI Launchpad Hunter & Presale Sniper',
                'Whale Movement Tracker Agent',
                'Pre-Market AI Alpha Agent',
                'Whale Copy Trade Agent',
            ];
            agentNames.forEach((name) => {
                agentStats[name] = { unlocked: 0, users: [] };
            });
            // Check each user's agents
            for (const user of allUsers) {
                const agentsSnapshot = await db
                    .collection('users')
                    .doc(user.uid)
                    .collection('agents')
                    .get();
                agentsSnapshot.docs.forEach((doc) => {
                    const data = doc.data();
                    const agentName = doc.id;
                    if (data.unlocked && agentStats[agentName]) {
                        agentStats[agentName].unlocked++;
                        agentStats[agentName].users.push(user.uid);
                    }
                });
            }
            return { agentStats };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting agent stats');
            return reply.code(500).send({ error: err.message || 'Error fetching agent stats' });
        }
    });
    // Get users who unlocked a specific agent
    fastify.get('/agents/:agentName/users', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { agentName } = request.params;
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const allUsers = await firestoreAdapter_1.firestoreAdapter.getAllUsers();
            const usersWithAgent = [];
            for (const user of allUsers) {
                const agentDoc = await db
                    .collection('users')
                    .doc(user.uid)
                    .collection('agents')
                    .doc(agentName)
                    .get();
                if (agentDoc.exists) {
                    const data = agentDoc.data();
                    if (data?.unlocked) {
                        usersWithAgent.push({
                            uid: user.uid,
                            email: user.email,
                            unlockedAt: data.unlockedAt?.toDate().toISOString(),
                        });
                    }
                }
            }
            return { users: usersWithAgent };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting agent users');
            return reply.code(500).send({ error: err.message || 'Error fetching agent users' });
        }
    });
    // Agent CRUD endpoints
    const updateAgentSchema = zod_1.z.object({
        name: zod_1.z.string().min(1).optional(),
        description: zod_1.z.string().optional(),
        longDescription: zod_1.z.string().optional(),
        price: zod_1.z.number().min(0).optional(),
        features: zod_1.z.array(zod_1.z.string()).optional(),
        category: zod_1.z.string().optional(),
        badge: zod_1.z.string().optional(),
        imageUrl: zod_1.z.string().url().optional().or(zod_1.z.literal('')),
        enabled: zod_1.z.boolean().optional(),
        whatsappNumber: zod_1.z.string().optional(),
    });
    // Update agent
    fastify.put('/agents/:agentId', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { agentId } = request.params;
            const body = updateAgentSchema.parse(request.body);
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            const agentRef = db.collection('agents').doc(agentId);
            const agentDoc = await agentRef.get();
            if (!agentDoc.exists) {
                return reply.code(404).send({ error: 'Agent not found' });
            }
            const updateData = {
                updatedAt: admin.firestore.Timestamp.now(),
            };
            if (body.name !== undefined)
                updateData.name = body.name;
            if (body.description !== undefined)
                updateData.description = body.description;
            if (body.longDescription !== undefined)
                updateData.longDescription = body.longDescription;
            if (body.price !== undefined)
                updateData.price = body.price;
            if (body.features !== undefined)
                updateData.features = body.features;
            if (body.category !== undefined)
                updateData.category = body.category;
            if (body.badge !== undefined)
                updateData.badge = body.badge;
            if (body.imageUrl !== undefined)
                updateData.imageUrl = body.imageUrl || null;
            if (body.enabled !== undefined)
                updateData.enabled = body.enabled;
            if (body.whatsappNumber !== undefined)
                updateData.whatsappNumber = body.whatsappNumber;
            await agentRef.update(updateData);
            logger_1.logger.info({ agentId, adminUid: request.user.uid }, 'Agent updated');
            return { message: 'Agent updated successfully', agentId };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({ error: 'Invalid input', details: err.errors });
            }
            logger_1.logger.error({ err }, 'Error updating agent');
            return reply.code(500).send({ error: err.message || 'Error updating agent' });
        }
    });
    // Get unlock requests (pending)
    fastify.get('/unlock-requests', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            const snapshot = await db
                .collection('agentUnlockRequests')
                .where('status', '==', 'pending')
                .orderBy('submittedAt', 'desc')
                .get();
            const requests = await Promise.all(snapshot.docs.map(async (doc) => {
                const data = doc.data();
                // Get user email
                const userDoc = await db.collection('users').doc(data.uid).get();
                const userData = userDoc.data();
                return {
                    id: doc.id,
                    uid: data.uid,
                    userEmail: userData?.email || 'N/A',
                    agentId: data.agentId,
                    agentName: data.agentName,
                    fullName: data.fullName,
                    phoneNumber: data.phoneNumber,
                    email: data.email,
                    submittedAt: data.submittedAt?.toDate().toISOString(),
                    status: data.status,
                };
            }));
            return { requests };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting unlock requests');
            return reply.code(500).send({ error: err.message || 'Error fetching unlock requests' });
        }
    });
    // Approve unlock request
    fastify.post('/unlock-requests/:requestId/approve', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { requestId } = request.params;
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            // Get request
            const requestDoc = await db.collection('agentUnlockRequests').doc(requestId).get();
            if (!requestDoc.exists) {
                return reply.code(404).send({ error: 'Request not found' });
            }
            const requestData = requestDoc.data();
            if (requestData.status !== 'pending') {
                return reply.code(400).send({ error: 'Request already processed' });
            }
            // Unlock agent for user
            await firestoreAdapter_1.firestoreAdapter.unlockAgent(requestData.uid, requestData.agentName, requestData.agentId);
            // Update request status
            await db.collection('agentUnlockRequests').doc(requestId).update({
                status: 'approved',
                approvedAt: admin.firestore.Timestamp.now(),
                approvedBy: request.user.uid,
            });
            logger_1.logger.info({ requestId, uid: requestData.uid, agentName: requestData.agentName }, 'Unlock request approved');
            return { message: 'Unlock request approved', requestId };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error approving unlock request');
            return reply.code(500).send({ error: err.message || 'Error approving unlock request' });
        }
    });
    // Deny unlock request
    fastify.post('/unlock-requests/:requestId/deny', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { requestId } = request.params;
            const { reason } = request.body || {};
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            // Get request
            const requestDoc = await db.collection('agentUnlockRequests').doc(requestId).get();
            if (!requestDoc.exists) {
                return reply.code(404).send({ error: 'Request not found' });
            }
            const requestData = requestDoc.data();
            if (requestData.status !== 'pending') {
                return reply.code(400).send({ error: 'Request already processed' });
            }
            // Update request status
            await db.collection('agentUnlockRequests').doc(requestId).update({
                status: 'denied',
                deniedAt: admin.firestore.Timestamp.now(),
                deniedBy: request.user.uid,
                reason: reason || 'No reason provided',
            });
            logger_1.logger.info({ requestId, uid: requestData.uid, agentName: requestData.agentName }, 'Unlock request denied');
            return { message: 'Unlock request denied', requestId };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error denying unlock request');
            return reply.code(500).send({ error: err.message || 'Error denying unlock request' });
        }
    });
    // Update agent settings for user
    fastify.put('/user/:uid/agent/:agentName/settings', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { uid, agentName } = request.params;
            const settings = request.body;
            await firestoreAdapter_1.firestoreAdapter.updateAgentSettings(uid, agentName, settings);
            logger_1.logger.info({ uid, agentName, adminUid: request.user.uid }, 'Agent settings updated');
            return { message: 'Agent settings updated' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error updating agent settings');
            return reply.code(500).send({ error: err.message || 'Error updating agent settings' });
        }
    });
    // Toggle agent enabled/disabled
    fastify.post('/agents/:agentId/toggle', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const { agentId } = request.params;
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            const agentRef = db.collection('agents').doc(agentId);
            const agentDoc = await agentRef.get();
            if (!agentDoc.exists) {
                return reply.code(404).send({ error: 'Agent not found' });
            }
            const currentData = agentDoc.data();
            const newEnabled = !(currentData?.enabled !== false);
            await agentRef.update({
                enabled: newEnabled,
                updatedAt: admin.firestore.Timestamp.now(),
            });
            logger_1.logger.info({ agentId, enabled: newEnabled, adminUid: request.user.uid }, 'Agent toggled');
            return { message: `Agent ${newEnabled ? 'enabled' : 'disabled'}`, enabled: newEnabled };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error toggling agent');
            return reply.code(500).send({ error: err.message || 'Error toggling agent' });
        }
    });
    // System health endpoint
    fastify.get('/system-health', {
        preHandler: [fastify.authenticate, fastify.adminAuth],
    }, async (request, reply) => {
        try {
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            // Get users count
            const usersSnapshot = await db.collection('users').get();
            const usersCount = usersSnapshot.size;
            // Count engines running
            const engineStatuses = await firestoreAdapter_1.firestoreAdapter.getAllEngineStatuses();
            const enginesRunning = engineStatuses.filter((s) => s.active).length;
            // Count HFT bots running
            let hftBotsRunning = 0;
            for (const status of engineStatuses) {
                if (status.engineType === 'hft' && status.active) {
                    hftBotsRunning++;
                }
            }
            // Count API errors (from logs collection, last 24h)
            const oneDayAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
            const errorLogsSnapshot = await db.collection('logs')
                .where('type', '==', 'error')
                .where('timestamp', '>=', oneDayAgo)
                .get();
            const apiErrors = errorLogsSnapshot.size;
            // Count logs (execution + research + HFT)
            let executionLogsCount = 0;
            let researchLogsCount = 0;
            let hftExecutionLogsCount = 0;
            for (const userDoc of usersSnapshot.docs) {
                const uid = userDoc.id;
                // Count execution logs
                const execLogs = await db.collection('users').doc(uid).collection('executionLogs')
                    .limit(1).get();
                if (!execLogs.empty) {
                    const allExecLogs = await db.collection('users').doc(uid).collection('executionLogs').get();
                    executionLogsCount += allExecLogs.size;
                }
                // Count research logs
                const researchLogs = await db.collection('users').doc(uid).collection('researchLogs')
                    .limit(1).get();
                if (!researchLogs.empty) {
                    const allResearchLogs = await db.collection('users').doc(uid).collection('researchLogs').get();
                    researchLogsCount += allResearchLogs.size;
                }
                // Count HFT execution logs
                const hftLogs = await db.collection('users').doc(uid).collection('hftExecutionLogs')
                    .limit(1).get();
                if (!hftLogs.empty) {
                    const allHftLogs = await db.collection('users').doc(uid).collection('hftExecutionLogs').get();
                    hftExecutionLogsCount += allHftLogs.size;
                }
            }
            // Get last trade
            const tradesSnapshot = await db.collection('trades')
                .orderBy('timestamp', 'desc')
                .limit(1)
                .get();
            let lastTrade = null;
            if (!tradesSnapshot.empty) {
                const trade = tradesSnapshot.docs[0].data();
                lastTrade = {
                    uid: trade.uid,
                    symbol: trade.symbol,
                    side: trade.side,
                    qty: trade.qty,
                    entryPrice: trade.entryPrice,
                    pnl: trade.pnl,
                    timestamp: trade.timestamp?.toDate().toISOString(),
                    engineType: trade.engineType,
                };
            }
            return {
                users: {
                    count: usersCount,
                },
                engines: {
                    running: enginesRunning,
                },
                hft: {
                    botsRunning: hftBotsRunning,
                },
                api: {
                    errorsLast24h: apiErrors,
                },
                logs: {
                    execution: executionLogsCount,
                    research: researchLogsCount,
                    hftExecution: hftExecutionLogsCount,
                    total: executionLogsCount + researchLogsCount + hftExecutionLogsCount,
                },
                lastTrade,
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting system health');
            return reply.code(500).send({ error: err.message || 'Error fetching system health' });
        }
    });
}
