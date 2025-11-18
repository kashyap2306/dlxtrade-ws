import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { userEngineManager } from '../services/userEngineManager';
import { z } from 'zod';
import { logger } from '../utils/logger';

const hftSettingsSchema = z.object({
  symbol: z.string().min(1),
  quoteSize: z.number().positive(),
  adversePct: z.number().min(0).max(1),
  cancelMs: z.number().int().positive(),
  maxPos: z.number().positive(),
  minSpreadPct: z.number().min(0),
  maxTradesPerDay: z.number().int().positive(),
  enabled: z.boolean(),
});

const hftQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

export async function hftRoutes(fastify: FastifyInstance) {
  // Get HFT status
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { uid?: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const { uid } = request.query;
    
    // Users can only view their own status unless they're admin
    const isAdmin = await firestoreAdapter.isAdmin(user.uid);
    const targetUid = uid || user.uid;
    
    if (targetUid !== user.uid && !isAdmin) {
      return reply.code(403).send({ error: 'Access denied' });
    }

    // Get status from engine manager
    const status = userEngineManager.getHFTStatus(targetUid);
    
    // Also get status from engineStatus collection
    const engineStatus = await firestoreAdapter.getEngineStatus(targetUid);
    
    return {
      running: status.running,
      hasEngine: status.hasEngine,
      engineStatus: engineStatus && engineStatus.engineType === 'hft' ? {
        active: engineStatus.active,
        symbol: engineStatus.symbol,
        config: engineStatus.config,
        updatedAt: engineStatus.updatedAt?.toDate().toISOString(),
      } : null,
    };
  });

  // Start HFT engine
  fastify.post('/start', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    
    try {
      await userEngineManager.startHFT(user.uid);
      
      // Notify admin WebSocket
      const { adminWebSocketManager } = await import('../services/adminWebSocketManager');
      const hftSettings = await firestoreAdapter.getHFTSettings(user.uid);
      adminWebSocketManager.notifyEngineStart(user.uid, hftSettings?.symbol || 'UNKNOWN');
      
      // Save engine status
      await firestoreAdapter.saveEngineStatus(user.uid, {
        active: true,
        engineType: 'hft',
        symbol: hftSettings?.symbol || 'UNKNOWN',
        config: hftSettings || {},
      });

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'HFT_ENGINE_STARTED', {
        symbol: hftSettings?.symbol || 'UNKNOWN',
      });
      
      return { message: 'HFT engine started' };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error starting HFT engine');
      return reply.code(400).send({ error: err.message || 'Error starting HFT engine' });
    }
  });

  // Stop HFT engine
  fastify.post('/stop', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    
    try {
      await userEngineManager.stopHFT(user.uid);
      
      // Notify admin WebSocket
      const { adminWebSocketManager } = await import('../services/adminWebSocketManager');
      adminWebSocketManager.notifyEngineStop(user.uid);
      
      // Update engine status
      await firestoreAdapter.saveEngineStatus(user.uid, {
        active: false,
        engineType: 'hft',
      });

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'HFT_ENGINE_STOPPED', {});
      
      return { message: 'HFT engine stopped' };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error stopping HFT engine');
      return reply.code(400).send({ error: err.message || 'Error stopping HFT engine' });
    }
  });

  // Get HFT execution logs
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const query = hftQuerySchema.parse(request.query);
    const logs = await firestoreAdapter.getHFTExecutionLogs(user.uid, query.limit);
    
    return logs.map((log) => ({
      id: log.id,
      symbol: log.symbol,
      timestamp: log.timestamp?.toDate().toISOString(),
      action: log.action,
      orderId: log.orderId,
      orderIds: log.orderIds,
      price: log.price,
      quantity: log.quantity,
      side: log.side,
      reason: log.reason,
      strategy: log.strategy,
      status: log.status,
      createdAt: log.createdAt?.toDate().toISOString(),
    }));
  });

  // Load HFT settings
  fastify.get('/settings/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const settings = await firestoreAdapter.getHFTSettings(user.uid);
    
    if (!settings) {
      // Return defaults
      return {
        symbol: 'BTCUSDT',
        quoteSize: 0.001,
        adversePct: 0.0002,
        cancelMs: 40,
        maxPos: 0.01,
        minSpreadPct: 0.01,
        maxTradesPerDay: 500,
        enabled: false,
      };
    }
    
    return {
      symbol: settings.symbol,
      quoteSize: settings.quoteSize,
      adversePct: settings.adversePct,
      cancelMs: settings.cancelMs,
      maxPos: settings.maxPos,
      minSpreadPct: settings.minSpreadPct,
      maxTradesPerDay: settings.maxTradesPerDay,
      enabled: settings.enabled,
    };
  });

  // Update HFT settings
  fastify.post('/settings/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = hftSettingsSchema.parse(request.body);
    
    try {
      await firestoreAdapter.saveHFTSettings(user.uid, body);
      return { message: 'HFT settings updated' };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error updating HFT settings');
      return reply.code(400).send({ error: err.message || 'Error updating HFT settings' });
    }
  });
}

