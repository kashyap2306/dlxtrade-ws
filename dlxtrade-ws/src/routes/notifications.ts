import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { z } from 'zod';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

const db = () => admin.firestore(getFirebaseAdmin());

export async function notificationsRoutes(fastify: FastifyInstance) {
  // GET /api/notifications - Get user notifications
  fastify.get('/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: number } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const limit = request.query.limit ? parseInt(String(request.query.limit)) || 50 : 50;

    try {
      // Use optimized method that handles both paths efficiently
      const notifications = await firestoreAdapter.getUserNotificationsFromSubcollection(user.uid, limit);
      return notifications;
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error fetching notifications');
      return reply.code(500).send({
        error: 'Failed to fetch notifications',
      });
    }
  });

  // POST /api/notifications - Create notification
  fastify.post('/notifications', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { title: string; message: string; type: 'success' | 'warning' | 'error' | 'info' } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    
    try {
      const body = z.object({
        title: z.string().min(1),
        message: z.string().min(1),
        type: z.enum(['success', 'warning', 'error', 'info']),
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
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid notification data',
          details: err.errors,
        });
      }
      logger.error({ err, uid: user.uid }, 'Error creating notification');
      return reply.code(500).send({
        error: 'Failed to create notification',
      });
    }
  });

  // POST /api/notifications/mark-read - Mark notification as read (body parameter)
  fastify.post('/notifications/mark-read', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { notificationId: string | number } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    
    try {
      const body = z.object({
        notificationId: z.union([z.string(), z.number()]),
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
      } catch (err: any) {
        await db()
          .collection('users')
          .doc(user.uid)
          .collection('notifications')
          .doc(notificationId)
          .update({ read: true });
      }

      return { success: true };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid notification ID',
          details: err.errors,
        });
      }
      logger.error({ err, uid: user.uid, notificationId: String((request.body as any)?.notificationId || 'unknown') }, 'Error marking notification as read');
      return reply.code(500).send({
        error: 'Failed to mark notification as read',
      });
    }
  });

  // POST /api/notifications/:id/read - Mark notification as read (URL parameter)
  fastify.post('/notifications/:id/read', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
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
      } catch (err: any) {
        await db()
          .collection('users')
          .doc(user.uid)
          .collection('notifications')
          .doc(id)
          .update({ read: true });
      }

      return { success: true };
    } catch (err: any) {
      logger.error({ err, uid: user.uid, notificationId: id }, 'Error marking notification as read');
      return reply.code(500).send({
        error: 'Failed to mark notification as read',
      });
    }
  });

  // POST /api/notifications/read-all - Mark all notifications as read
  fastify.post('/notifications/read-all', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

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
      } catch (err: any) {
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
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error marking all notifications as read');
      return reply.code(500).send({
        error: 'Failed to mark all notifications as read',
      });
    }
  });

  // POST /api/notifications/push - Push notification to user (and admin)
  fastify.post('/notifications/push', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ 
    Body: { 
      uid: string;
      type: 'success' | 'warning' | 'error' | 'info';
      title: string;
      message: string;
      timestamp?: number;
    } 
  }>, reply: FastifyReply) => {
    const requestingUser = (request as any).user;
    
    try {
      const body = z.object({
        uid: z.string().min(1),
        type: z.enum(['success', 'warning', 'error', 'info']),
        title: z.string().min(1),
        message: z.string().min(1),
        timestamp: z.number().optional(),
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
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'Invalid notification data',
          details: err.errors,
        });
      }
      logger.error({ err, uid: requestingUser.uid }, 'Error pushing notification');
      return reply.code(500).send({
        error: 'Failed to push notification',
      });
    }
  });
}
