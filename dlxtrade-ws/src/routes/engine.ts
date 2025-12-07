import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { userEngineManager } from '../services/userEngineManager';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';

const engineConfigSchema = z.object({
  symbol: z.string().min(1),
  quoteSize: z.number().positive(),
  adversePct: z.number().min(0).max(1),
  cancelMs: z.number().int().positive(),
  maxPos: z.number().positive(),
  enabled: z.boolean(),
});

export async function engineRoutes(fastify: FastifyInstance) {
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
    const status = userEngineManager.getUserEngineStatus(targetUid);
    
    // Also get status from engineStatus collection
    const engineStatus = await firestoreAdapter.getEngineStatus(targetUid);
    
    return {
      engine: {
        running: status.running,
        hasEngine: status.hasEngine,
      },
      engineStatus: engineStatus ? {
        active: engineStatus.active,
        engineType: engineStatus.engineType,
        symbol: engineStatus.symbol,
        config: engineStatus.config,
        updatedAt: engineStatus.updatedAt?.toDate().toISOString(),
      } : null,
    };
  });

  fastify.post('/start', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = engineConfigSchema.parse(request.body);

    try {
      // Check if auto-trade is enabled
      const settings = await firestoreAdapter.getSettings(user.uid);
      if (settings?.autoTradeEnabled) {
        // Use new auto-trade flow
        await userEngineManager.startAutoTrade(user.uid);
        return { message: 'Auto-trade started', config: body };
      }

      // Legacy flow for research-only mode
      // Use exchangeResolver to get trading exchange credentials (reads from exchangeConfig/current)
      const { resolveExchangeConnector } = await import('../services/exchangeResolver');
      const resolved = await resolveExchangeConnector(user.uid);
      
      if (!resolved) {
        return reply.code(400).send({ 
          error: 'No exchange API keys configured. Please set up your exchange API credentials in Settings → API Integration.' 
        });
      }

      // Create or get user engine using resolved credentials
      await userEngineManager.createUserEngine(
        user.uid, 
        resolved.credentials.apiKey, 
        resolved.credentials.secret, 
        resolved.credentials.testnet
      );
      
      // Load enabled integrations for research APIs (CryptoQuant, LunarCrush, CoinAPI)
      const integrations = await firestoreAdapter.getEnabledIntegrations(user.uid);

      // Store loaded integrations for other services (CryptoQuant, LunarCrush, CoinAPI)
      // These can be accessed by other services as needed
      (global as any).apiIntegrations = integrations;

      // Save settings
      await firestoreAdapter.saveSettings(user.uid, {
        symbol: body.symbol,
        quoteSize: body.quoteSize,
        adversePct: body.adversePct,
        cancelMs: body.cancelMs,
        maxPos: body.maxPos,
      });

      // Start accuracy engine (which includes research)
      await userEngineManager.startUserEngine(user.uid, body.symbol, 5000); // Research every 5 seconds

      // Notify admin WebSocket
      const { adminWebSocketManager } = await import('../services/adminWebSocketManager');
      adminWebSocketManager.notifyEngineStart(user.uid, body.symbol);

      // Save engine status
      await firestoreAdapter.saveEngineStatus(user.uid, {
        active: true,
        engineType: 'auto',
        symbol: body.symbol,
        config: body,
      });

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'ENGINE_STARTED', {
        symbol: body.symbol,
        engineType: 'auto',
      });

      logger.info({ config: body, uid: user.uid }, 'Engine started');
      return { message: 'Engine started', config: body };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error starting engine');
      return reply.code(400).send({ error: err.message || 'Error starting engine' });
    }
  });

  fastify.post('/stop', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      // Check if auto-trade is running
      const settings = await firestoreAdapter.getSettings(user.uid);
      if (settings?.autoTradeEnabled) {
        await userEngineManager.stopAutoTrade(user.uid);
      } else {
        await userEngineManager.stopUserEngineRunning(user.uid);
      }

      // Notify admin WebSocket
      const { adminWebSocketManager } = await import('../services/adminWebSocketManager');
      adminWebSocketManager.notifyEngineStop(user.uid);

      // Update engine status
      await firestoreAdapter.saveEngineStatus(user.uid, {
        active: false,
        engineType: 'auto',
      });

      // Log activity
      await firestoreAdapter.logActivity(user.uid, 'ENGINE_STOPPED', {
        engineType: 'auto',
      });

      logger.info({ uid: user.uid }, 'Engine stopped');
      return { message: 'Engine stopped' };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error stopping engine');
      return reply.code(400).send({ error: err.message || 'Error stopping engine' });
    }
  });

  fastify.put('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = engineConfigSchema.partial().parse(request.body);
    // TODO: Update engine config dynamically
    return { message: 'Config update (implementation pending)', config: body };
  });

  // Risk management routes - can be implemented per-user if needed
  fastify.post('/risk/pause', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Implement per-user risk manager
    return { message: 'Risk manager pause (per-user implementation pending)' };
  });

  fastify.post('/risk/resume', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Implement per-user risk manager
    return { message: 'Risk manager resume (per-user implementation pending)' };
  });

  fastify.put('/risk/limits', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // TODO: Implement per-user risk manager
    return { message: 'Risk limits update (per-user implementation pending)' };
  });

  // POST /engine/update - Update engine settings
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const settings = request.body;

    try {
      // Update settings if provided
      if (Object.keys(settings).length > 0) {
        await firestoreAdapter.saveSettings(user.uid, settings);
      }
      return { success: true, message: 'Engine updated successfully' };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Error updating engine');
      return reply.code(500).send({ error: err.message || 'Error updating engine' });
    }
  });

  // POST /engine/toggle - Start/stop engine
  fastify.post('/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = request.body as any;
    const { enabled, symbol } = body;

    try {
      if (enabled) {
        // Start engine
        const settings = await firestoreAdapter.getSettings(user.uid);
        if (!settings) {
          return reply.code(400).send({ error: 'No trading settings found. Please configure your settings first.' });
        }

        const config = {
          symbol: symbol || settings.symbol || 'BTCUSDT',
          quoteSize: settings.quoteSize || 0.001,
          adversePct: settings.adversePct || 0.0002,
          cancelMs: settings.cancelMs || 40,
          maxPos: settings.maxPos || 0.01,
          enabled: true,
        };

        // Check if auto-trade is enabled
        if (settings.autoTradeEnabled) {
          // Use auto-trade flow
          await userEngineManager.startAutoTrade(user.uid);
          return { success: true, message: 'Auto-trade started', config };
        } else {
          // Use legacy flow - need exchange credentials
          const exchangeCredentials = await firestoreAdapter.getExchangeCredentials(user.uid, 'binance');
          if (!exchangeCredentials) {
            return reply.code(400).send({
              error: 'No exchange API keys configured. Please set up your exchange API credentials first.'
            });
          }

          await userEngineManager.createUserEngine(
            user.uid,
            decrypt(exchangeCredentials.apiKeyEncrypted),
            decrypt(exchangeCredentials.secretEncrypted),
            exchangeCredentials.testnet
          );

          await userEngineManager.startUserEngine(user.uid, config.symbol, 5000);
          await firestoreAdapter.saveEngineStatus(user.uid, {
            active: true,
            engineType: 'auto',
            symbol: config.symbol,
            config,
          });

          return { success: true, message: 'Engine started', config };
        }
      } else {
        // Stop engine
        const settings = await firestoreAdapter.getSettings(user.uid);
        if (settings?.autoTradeEnabled) {
          await userEngineManager.stopAutoTrade(user.uid);
        } else {
          await userEngineManager.stopUserEngineRunning(user.uid);
        }

        await firestoreAdapter.saveEngineStatus(user.uid, {
          active: false,
          engineType: 'auto',
        });

        return { success: true, message: 'Engine stopped' };
      }
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, `Error ${enabled ? 'starting' : 'stopping'} engine`);
      return reply.code(500).send({ error: err.message || `Error ${enabled ? 'starting' : 'stopping'} engine` });
    }
  });
}

