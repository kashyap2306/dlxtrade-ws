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
            if (!user || !user.uid) {
                return reply.code(401).send({ error: 'Unauthorized', notifications: [], unreadCount: 0 });
            }
            // Firestore requires manual composite index for this query:
            // Collection: notifications
            // Fields: (userId ASC, timestamp DESC)
            // Create this index in Firebase Console if you see index errors
            const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
            // Auto-correct limit to max 500 instead of throwing error
            // This prevents ZodError and Firestore index errors
            const safeLimit = Math.min(Math.max(1, limit), 500);
            let notifications = [];
            let unreadCount = 0;
            try {
                notifications = await firestoreAdapter_1.firestoreAdapter.getUserNotifications(user.uid, safeLimit);
                // Ensure all notifications have required fields and convert timestamps
                notifications = notifications.map((notif) => ({
                    id: notif.id || '',
                    title: notif.title || '',
                    message: notif.message || '',
                    type: notif.type || 'info',
                    read: notif.read || false,
                    timestamp: notif.timestamp || new Date().toISOString(),
                    createdAt: notif.createdAt?.toDate?.()?.toISOString() || notif.createdAt || new Date().toISOString(),
                })).filter((notif) => notif.id); // Remove any invalid entries
            }
            catch (notifErr) {
                logger_1.logger.error({ err: notifErr, uid: user.uid }, 'Error fetching notifications, returning empty array');
                notifications = [];
            }
            try {
                unreadCount = await firestoreAdapter_1.firestoreAdapter.getUnreadNotificationCount(user.uid);
            }
            catch (countErr) {
                logger_1.logger.error({ err: countErr, uid: user.uid }, 'Error fetching unread count, defaulting to 0');
                unreadCount = 0;
            }
            return {
                notifications: notifications || [],
                unreadCount: unreadCount || 0
            };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: request.user?.uid }, 'Error getting notifications');
            // Always return valid JSON structure even on error
            return reply.code(200).send({
                notifications: [],
                unreadCount: 0,
                error: err.message || 'Error fetching notifications'
            });
        }
    });
    // POST /api/notifications/push - Create a new notification
    fastify.post('/push', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { userId, uid, title, message, type } = request.body;
            // Support both userId and uid (frontend sends uid)
            const targetUserId = userId || uid;
            // Validate required fields
            if (!targetUserId || !title || !message || !type) {
                throw new errors_1.ValidationError('userId (or uid), title, message, and type are required');
            }
            // Validate userId is not empty
            if (typeof targetUserId !== 'string' || targetUserId.trim() === '') {
                throw new errors_1.ValidationError('userId (or uid) must be a non-empty string');
            }
            // Validate title is not empty
            if (typeof title !== 'string' || title.trim() === '') {
                throw new errors_1.ValidationError('title must be a non-empty string');
            }
            // Validate message is not empty
            if (typeof message !== 'string' || message.trim() === '') {
                throw new errors_1.ValidationError('message must be a non-empty string');
            }
            // Validate type is not empty
            if (typeof type !== 'string' || type.trim() === '') {
                throw new errors_1.ValidationError('type must be a non-empty string');
            }
            // Save notification to Firestore (notifications collection)
            const notificationId = await firestoreAdapter_1.firestoreAdapter.createNotification(targetUserId, {
                title: title.trim(),
                message: message.trim(),
                type: type.trim(),
            });
            logger_1.logger.info({ userId: targetUserId, notificationId, title }, 'Notification created via push endpoint');
            // Return success response
            reply.code(200).header('Content-Type', 'application/json').send({
                success: true,
            });
            return; // Explicit return to prevent further execution
        }
        catch (err) {
            if (err instanceof errors_1.ValidationError) {
                reply.code(400).header('Content-Type', 'application/json').send({
                    success: false,
                    error: err.message
                });
                return; // Explicit return to prevent further execution
            }
            logger_1.logger.error({ err }, 'Error creating notification');
            reply.code(500).header('Content-Type', 'application/json').send({
                success: false,
                error: err.message || 'Error creating notification'
            });
            return; // Explicit return to prevent further execution
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
