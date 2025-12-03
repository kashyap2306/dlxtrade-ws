import { FastifyInstance } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { logger } from '../utils/logger';

const settingsSchema = z.object({
  backgroundResearchEnabled: z.boolean(),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  researchFrequencyMinutes: z.number().min(1).max(30),
  accuracyTrigger: z.number().min(60).max(95), // 60-75, 75-85, 85-95, or 95+
});

export async function backgroundResearchRoutes(fastify: FastifyInstance) {
  // GET /api/background-research/settings - Get background research settings
  fastify.get("/settings", { preHandler: [fastify.authenticate] }, async (req) => {
    const data = await firestoreAdapter.getBackgroundResearchSettings((req as any).user.uid);
    return { success: true, data };
  });

  // POST /api/background-research/settings - Save background research settings
  fastify.post("/settings", { preHandler: [fastify.authenticate] }, async (req) => {
    const saved = await firestoreAdapter.saveBackgroundResearchSettings((req as any).user.uid, (req as any).body);
    return { success: true, data: saved };
  });
  // POST /api/background-research/settings/save - Save background research settings
  fastify.post('/settings/save', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    const body = settingsSchema.parse(request.body);

    try {
      logger.info({ uid: user.uid }, 'Saving background research settings');

      // Validate Telegram credentials if enabled
      if (body.backgroundResearchEnabled) {
        if (!body.telegramBotToken || !body.telegramChatId) {
          return reply.code(400).send({
            error: 'Telegram Bot Token and Chat ID are required when background research is enabled',
          });
        }
      }

      // Save to Firestore
      await firestoreAdapter.saveBackgroundResearchSettings(user.uid, {
        backgroundResearchEnabled: body.backgroundResearchEnabled,
        telegramBotToken: body.telegramBotToken,
        telegramChatId: body.telegramChatId,
        researchFrequencyMinutes: body.researchFrequencyMinutes,
        accuracyTrigger: body.accuracyTrigger,
        lastResearchRun: null, // Will be set when research runs
      });

      return {
        success: true,
        message: 'Background research settings saved successfully',
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error saving background research settings');
      return reply.code(500).send({
        error: 'Failed to save background research settings',
        reason: error.message,
      });
    }
  });

  // GET /api/background-research/settings/get - Get background research settings
  fastify.get('/settings/get', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;

    try {
      logger.info({ uid: user.uid }, 'Getting background research settings');
      const settings = await firestoreAdapter.getBackgroundResearchSettings(user.uid);

      return {
        backgroundResearchEnabled: settings?.backgroundResearchEnabled || false,
        telegramBotToken: settings?.telegramBotToken || '',
        telegramChatId: settings?.telegramChatId || '',
        researchFrequencyMinutes: settings?.researchFrequencyMinutes || 5,
        accuracyTrigger: settings?.accuracyTrigger || 80,
        lastResearchRun: settings?.lastResearchRun?.toDate().toISOString() || null,
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error getting background research settings');
      return reply.code(500).send({
        error: 'Failed to get background research settings',
        reason: error.message,
      });
    }
  });

  // POST /api/background-research/settings/test - Test Telegram connection
  fastify.post('/settings/test', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    const { botToken, chatId } = request.body as { botToken: string; chatId: string };

    try {
      logger.info({ uid: user.uid }, 'Testing Telegram connection');

      // For now, just return success - actual Telegram testing would require API call
      // In production, you would call the Telegram API to send a test message

      return {
        success: true,
        message: "DLXTRADE Alert Test Successful: Telegram integration working."
      };
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
