import { FastifyInstance } from 'fastify';
import { telegramService } from '../services/telegramService';
import { z } from 'zod';
import { logger } from '../utils/logger';

const testSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
});

export async function telegramRoutes(fastify: FastifyInstance) {
  // POST /api/telegram/test - Test Telegram bot connection
  fastify.post('/test', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    const body = testSchema.parse(request.body);

    try {
      logger.info({ uid: user.uid }, 'Testing Telegram bot connection');
      const result = await telegramService.testConnection(body.botToken, body.chatId);

      if (result.success) {
        return { success: true, message: 'Test message sent successfully!' };
      } else {
        return reply.code(400).send({
          success: false,
          error: result.error || 'Failed to send test message',
        });
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error testing Telegram connection');
      return reply.code(500).send({
        success: false,
        error: 'Failed to test Telegram connection',
        reason: error.message,
      });
    }
  });
}
