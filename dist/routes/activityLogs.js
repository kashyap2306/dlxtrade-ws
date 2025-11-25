"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityLogsRoutes = activityLogsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
async function activityLogsRoutes(fastify) {
    // GET /api/activity-logs - Get activity logs
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const { uid, limit } = request.query;
            // Users can only view their own logs unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            const targetUid = uid || (isAdmin ? undefined : user.uid);
            if (targetUid && targetUid !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const limitNum = limit ? parseInt(limit, 10) : 100;
            const logs = await firestoreAdapter_1.firestoreAdapter.getActivityLogs(targetUid, limitNum);
            return { logs };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting activity logs');
            return reply.code(500).send({ error: err.message || 'Error fetching activity logs' });
        }
    });
}
