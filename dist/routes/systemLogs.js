"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemLogsRoutes = systemLogsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
async function systemLogsRoutes(fastify) {
    // GET /api/logs - Get system logs (admin only)
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
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
            const logs = await firestoreAdapter_1.firestoreAdapter.getSystemLogs(limit);
            return { logs };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting system logs');
            return reply.code(500).send({ error: err.message || 'Error fetching system logs' });
        }
    });
}
