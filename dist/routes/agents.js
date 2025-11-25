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
exports.agentsRoutes = agentsRoutes;
const zod_1 = require("zod");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
const unlockAgentSchema = zod_1.z.object({
    agentName: zod_1.z.string().min(1),
});
async function agentsRoutes(fastify) {
    // GET /api/agents - Get all agents
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const agents = await firestoreAdapter_1.firestoreAdapter.getAllAgents();
            return { agents };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting agents');
            return reply.code(500).send({ error: err.message || 'Error fetching agents' });
        }
    });
    // POST /api/agents/unlock - Unlock an agent for user
    fastify.post('/unlock', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = unlockAgentSchema.parse(request.body);
            // Unlock agent in user's subcollection
            await firestoreAdapter_1.firestoreAdapter.unlockAgent(user.uid, body.agentName);
            // Also create entry in agentUnlocks collection
            await firestoreAdapter_1.firestoreAdapter.createAgentUnlock(user.uid, body.agentName, {
                unlockedBy: user.uid,
            });
            // Update user's unlockedAgents array
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
            const currentUnlocked = userData?.unlockedAgents || [];
            if (!currentUnlocked.includes(body.agentName)) {
                await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                    unlockedAgents: [...currentUnlocked, body.agentName],
                });
            }
            // Log activity
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'AGENT_UNLOCKED', { agentName: body.agentName });
            return { message: 'Agent unlocked successfully', agentName: body.agentName };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error unlocking agent');
            return reply.code(500).send({ error: err.message || 'Error unlocking agent' });
        }
    });
    // GET /api/agents/unlocks - Get user's unlocked agents
    fastify.get('/unlocks', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const unlocks = await firestoreAdapter_1.firestoreAdapter.getUserAgentUnlocks(user.uid);
            return { unlocks };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting agent unlocks');
            return reply.code(500).send({ error: err.message || 'Error fetching agent unlocks' });
        }
    });
    // GET /api/agents/unlocked - Get user's unlocked agent names
    fastify.get('/unlocked', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
            const unlockedAgents = userData?.unlockedAgents || [];
            // Also get from unlocks subcollection for completeness
            const unlocks = await firestoreAdapter_1.firestoreAdapter.getUserAgentUnlocks(user.uid);
            const unlockNames = unlocks.map(u => u.agentName);
            // Combine and deduplicate
            const allUnlocked = [...new Set([...unlockedAgents, ...unlockNames])];
            return { unlocked: allUnlocked };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting unlocked agents');
            return reply.code(500).send({ error: err.message || 'Error fetching unlocked agents' });
        }
    });
    // GET /api/agents/:id - Get single agent by ID
    fastify.get('/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const agent = await firestoreAdapter_1.firestoreAdapter.getAgent(id);
            if (!agent) {
                return reply.code(404).send({ error: 'Agent not found' });
            }
            return { agent };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting agent');
            return reply.code(500).send({ error: err.message || 'Error fetching agent' });
        }
    });
    // POST /api/agents/submit-unlock-request - Submit unlock request (creates purchase)
    fastify.post('/submit-unlock-request', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = zod_1.z.object({
                agentId: zod_1.z.string().min(1),
                agentName: zod_1.z.string().min(1),
                fullName: zod_1.z.string().min(1),
                phoneNumber: zod_1.z.string().min(1),
                email: zod_1.z.string().email(),
            }).parse(request.body);
            // Save purchase request to Firestore
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
            const db = getFirebaseAdmin().firestore();
            const purchaseRef = db.collection('agentPurchases').doc();
            await purchaseRef.set({
                id: purchaseRef.id,
                uid: user.uid,
                agentId: body.agentId,
                agentName: body.agentName,
                fullName: body.fullName,
                phoneNumber: body.phoneNumber,
                email: body.email,
                status: 'pending',
                submittedAt: admin.firestore.Timestamp.now(),
                createdAt: admin.firestore.Timestamp.now(),
            });
            // Also create unlock request entry for backward compatibility
            const unlockRequestRef = db.collection('agentUnlockRequests').doc();
            await unlockRequestRef.set({
                uid: user.uid,
                agentId: body.agentId,
                agentName: body.agentName,
                fullName: body.fullName,
                phoneNumber: body.phoneNumber,
                email: body.email,
                submittedAt: admin.firestore.Timestamp.now(),
                status: 'pending',
            });
            // Log activity
            await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'AGENT_PURCHASE_REQUEST_SUBMITTED', {
                agentId: body.agentId,
                agentName: body.agentName,
                purchaseId: purchaseRef.id,
            });
            logger_1.logger.info({ uid: user.uid, agentName: body.agentName, purchaseId: purchaseRef.id }, 'Agent purchase request submitted');
            return {
                success: true,
                message: 'Purchase request submitted successfully',
                purchaseId: purchaseRef.id
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({ error: 'Invalid input', details: err.errors });
            }
            logger_1.logger.error({ err }, 'Error submitting purchase request');
            return reply.code(500).send({ error: err.message || 'Error submitting purchase request' });
        }
    });
    // PUT /api/agents/:agentId/settings - Update agent settings for user
    fastify.put('/:agentId/settings', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const { agentId } = request.params;
            const settings = request.body;
            // Get agent name from agentId
            const allAgents = await firestoreAdapter_1.firestoreAdapter.getAllAgents();
            const agent = allAgents.find((a) => a.id === agentId);
            if (!agent) {
                return reply.code(404).send({ error: 'Agent not found' });
            }
            // Update agent settings in user's subcollection
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
            const db = getFirebaseAdmin().firestore();
            const userAgentRef = db.collection('users').doc(user.uid).collection('agents').doc(agent.id);
            const updateData = {
                updatedAt: admin.firestore.Timestamp.now(),
            };
            Object.assign(updateData, settings);
            await userAgentRef.set(updateData, { merge: true });
            logger_1.logger.info({ uid: user.uid, agentName: agent.name }, 'Agent settings updated');
            return { message: 'Settings updated successfully' };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error updating agent settings');
            return reply.code(500).send({ error: err.message || 'Error updating agent settings' });
        }
    });
}
