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
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      
      const notifications = await firestoreAdapter.getUserNotifications(user.uid, limit);
      const unreadCount = await firestoreAdapter.getUnreadNotificationCount(user.uid);
      
      return { notifications, unreadCount };
    } catch (err: any) {
      logger.error({ err }, 'Error getting notifications');
      return reply.code(500).send({ error: err.message || 'Error fetching notifications' });
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

