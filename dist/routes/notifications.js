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
exports.notificationsRoutes = notificationsRoutes;
const logger_1 = require("../utils/logger");
const zod_1 = require("zod");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const db = () => admin.firestore((0, firebase_1.getFirebaseAdmin)());
async function notificationsRoutes(fastify) {
    // GET /api/notifications - Get user notifications
    fastify.get('/notifications', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const limit = request.query.limit ? parseInt(String(request.query.limit)) || 50 : 50;
        try {
            // Try new path first (notifications/{uid}/items), fallback to old path
            let snapshot;
            try {
                snapshot = await db()
                    .collection('notifications')
                    .doc(user.uid)
                    .collection('items')
                    .orderBy('timestamp', 'desc')
                    .limit(limit)
                    .get();
            }
            catch (err) {
                // Fallback to old path
                snapshot = await db()
                    .collection('users')
                    .doc(user.uid)
                    .collection('notifications')
                    .orderBy('timestamp', 'desc')
                    .limit(limit)
                    .get();
            }
            const notifications = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
            }));
            return notifications;
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error fetching notifications');
            return reply.code(500).send({
                error: 'Failed to fetch notifications',
            });
        }
    });
    // POST /api/notifications - Create notification
    fastify.post('/notifications', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            const body = zod_1.z.object({
                title: zod_1.z.string().min(1),
                message: zod_1.z.string().min(1),
                type: zod_1.z.enum(['success', 'warning', 'error', 'info']),
            }).parse(request.body);
            const notificationData = {
                title: body.title,
                message: body.message,
                type: body.type,
                read: false,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            };
            // Use new path: notifications/{uid}/items
            const docRef = await db()
                .collection('notifications')
                .doc(user.uid)
                .collection('items')
                .add(notificationData);
            return {
                id: docRef.id,
                title: body.title,
                message: body.message,
                type: body.type,
                read: false,
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({
                    error: 'Invalid notification data',
                    details: err.errors,
                });
            }
            logger_1.logger.error({ err, uid: user.uid }, 'Error creating notification');
            return reply.code(500).send({
                error: 'Failed to create notification',
            });
        }
    });
    // POST /api/notifications/mark-read - Mark notification as read (body parameter)
    fastify.post('/notifications/mark-read', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            const body = zod_1.z.object({
                notificationId: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]),
            }).parse(request.body);
            const notificationId = String(body.notificationId);
            // Try new path first, fallback to old
            try {
                await db()
                    .collection('notifications')
                    .doc(user.uid)
                    .collection('items')
                    .doc(notificationId)
                    .update({ read: true });
            }
            catch (err) {
                await db()
                    .collection('users')
                    .doc(user.uid)
                    .collection('notifications')
                    .doc(notificationId)
                    .update({ read: true });
            }
            return { success: true };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({
                    error: 'Invalid notification ID',
                    details: err.errors,
                });
            }
            logger_1.logger.error({ err, uid: user.uid, notificationId: String(request.body?.notificationId || 'unknown') }, 'Error marking notification as read');
            return reply.code(500).send({
                error: 'Failed to mark notification as read',
            });
        }
    });
    // POST /api/notifications/:id/read - Mark notification as read (URL parameter)
    fastify.post('/notifications/:id/read', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const { id } = request.params;
        try {
            // Try new path first, fallback to old
            try {
                await db()
                    .collection('notifications')
                    .doc(user.uid)
                    .collection('items')
                    .doc(id)
                    .update({ read: true });
            }
            catch (err) {
                await db()
                    .collection('users')
                    .doc(user.uid)
                    .collection('notifications')
                    .doc(id)
                    .update({ read: true });
            }
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid, notificationId: id }, 'Error marking notification as read');
            return reply.code(500).send({
                error: 'Failed to mark notification as read',
            });
        }
    });
    // POST /api/notifications/read-all - Mark all notifications as read
    fastify.post('/notifications/read-all', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            // Try new path first, fallback to old
            let snapshot;
            try {
                snapshot = await db()
                    .collection('notifications')
                    .doc(user.uid)
                    .collection('items')
                    .where('read', '==', false)
                    .get();
            }
            catch (err) {
                snapshot = await db()
                    .collection('users')
                    .doc(user.uid)
                    .collection('notifications')
                    .where('read', '==', false)
                    .get();
            }
            const batch = db().batch();
            snapshot.docs.forEach((doc) => {
                batch.update(doc.ref, { read: true });
            });
            await batch.commit();
            return { success: true, updated: snapshot.docs.length };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: user.uid }, 'Error marking all notifications as read');
            return reply.code(500).send({
                error: 'Failed to mark all notifications as read',
            });
        }
    });
    // POST /api/notifications/push - Push notification to user (and admin)
    fastify.post('/notifications/push', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const requestingUser = request.user;
        try {
            const body = zod_1.z.object({
                uid: zod_1.z.string().min(1),
                type: zod_1.z.enum(['success', 'warning', 'error', 'info']),
                title: zod_1.z.string().min(1),
                message: zod_1.z.string().min(1),
                timestamp: zod_1.z.number().optional(),
            }).parse(request.body);
            const notificationData = {
                title: body.title,
                message: body.message,
                type: body.type,
                read: false,
                timestamp: body.timestamp
                    ? admin.firestore.Timestamp.fromMillis(body.timestamp)
                    : admin.firestore.FieldValue.serverTimestamp(),
            };
            // Save to user's notifications
            const userDocRef = await db()
                .collection('notifications')
                .doc(body.uid)
                .collection('items')
                .add(notificationData);
            // Also save to admin's notifications
            const adminDocRef = await db()
                .collection('notifications')
                .doc('admin')
                .collection('items')
                .add({
                ...notificationData,
                originalUid: body.uid, // Track which user this notification is about
            });
            return {
                id: userDocRef.id,
                title: body.title,
                message: body.message,
                type: body.type,
                read: false,
                timestamp: body.timestamp ? new Date(body.timestamp).toISOString() : new Date().toISOString(),
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({
                    error: 'Invalid notification data',
                    details: err.errors,
                });
            }
            logger_1.logger.error({ err, uid: requestingUser.uid }, 'Error pushing notification');
            return reply.code(500).send({
                error: 'Failed to push notification',
            });
        }
    });
}
