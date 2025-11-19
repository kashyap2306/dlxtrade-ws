import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

export async function notificationsRoutes(fastify: FastifyInstance) {
  // GET /api/notifications - Get user notifications
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user || !user.uid) {
        return reply.code(401).send({ error: 'Unauthorized', notifications: [], unreadCount: 0 });
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      
      // Ensure limit is within bounds
      const safeLimit = Math.min(Math.max(1, limit), 1000);
      
      let notifications: any[] = [];
      let unreadCount = 0;
      
      try {
        notifications = await firestoreAdapter.getUserNotifications(user.uid, safeLimit);
        // Ensure all notifications have required fields and convert timestamps
        notifications = notifications.map((notif: any) => ({
          id: notif.id || '',
          title: notif.title || '',
          message: notif.message || '',
          type: notif.type || 'info',
          read: notif.read || false,
          timestamp: notif.timestamp || new Date().toISOString(),
          createdAt: notif.createdAt?.toDate?.()?.toISOString() || notif.createdAt || new Date().toISOString(),
        })).filter((notif: any) => notif.id); // Remove any invalid entries
      } catch (notifErr: any) {
        logger.error({ err: notifErr, uid: user.uid }, 'Error fetching notifications, returning empty array');
        notifications = [];
      }
      
      try {
        unreadCount = await firestoreAdapter.getUnreadNotificationCount(user.uid);
      } catch (countErr: any) {
        logger.error({ err: countErr, uid: user.uid }, 'Error fetching unread count, defaulting to 0');
        unreadCount = 0;
      }
      
      return { 
        notifications: notifications || [], 
        unreadCount: unreadCount || 0 
      };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error getting notifications');
      // Always return valid JSON structure even on error
      return reply.code(200).send({ 
        notifications: [], 
        unreadCount: 0,
        error: err.message || 'Error fetching notifications' 
      });
    }
  });

  // POST /api/notifications/mark-read - Mark notification as read
  fastify.post('/mark-read', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { notificationId: string } }>, reply: FastifyReply) => {
    try {
      const { notificationId } = request.body;
      if (!notificationId) {
        throw new ValidationError('Notification ID is required');
      }

      await firestoreAdapter.markNotificationRead(notificationId);
      
      return { message: 'Notification marked as read' };
    } catch (err: any) {
      if (err instanceof ValidationError) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error({ err }, 'Error marking notification as read');
      return reply.code(500).send({ error: err.message || 'Error marking notification as read' });
    }
  });
}

