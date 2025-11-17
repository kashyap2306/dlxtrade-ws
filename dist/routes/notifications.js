"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationsRoutes = notificationsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const errors_1 = require("../utils/errors");
async function notificationsRoutes(fastify) {
    // GET /api/notifications - Get user notifications
    fastify.get('/', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
            const notifications = await firestoreAdapter_1.firestoreAdapter.getUserNotifications(user.uid, limit);
            const unreadCount = await firestoreAdapter_1.firestoreAdapter.getUnreadNotificationCount(user.uid);
            return { notifications, unreadCount };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting notifications');
            return reply.code(500).send({ error: err.message || 'Error fetching notifications' });
        }
    });
    // POST /api/notifications/mark-read - Mark notification as read
    fastify.post('/mark-read', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { notificationId } = request.body;
            if (!notificationId) {
                throw new errors_1.ValidationError('Notification ID is required');
            }
            await firestoreAdapter_1.firestoreAdapter.markNotificationRead(notificationId);
            return { message: 'Notification marked as read' };
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                return reply.code(400).send({ error: err.message });
            }
            logger_1.logger.error({ err }, 'Error marking notification as read');
            return reply.code(500).send({ error: err.message || 'Error marking notification as read' });
        }
    });
}
