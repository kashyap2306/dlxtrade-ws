"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.engineStatusRoutes = engineStatusRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
async function engineStatusRoutes(fastify) {
    // GET /api/engine/status - Get engine status (already exists in engine.ts, but adding collection version)
    fastify.get('/status', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const { uid } = request.query;
            // Users can only view their own status unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            const targetUid = uid || user.uid;
            if (targetUid !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const status = await firestoreAdapter_1.firestoreAdapter.getEngineStatus(targetUid);
            if (!status) {
                return { active: false, engineType: null, symbol: null, config: null };
            }
            // Convert timestamps
            const result = { ...status };
            if (result.updatedAt) {
                result.updatedAt = result.updatedAt.toDate().toISOString();
            }
            return result;
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting engine status');
            return reply.code(500).send({ error: err.message || 'Error fetching engine status' });
        }
    });
}
