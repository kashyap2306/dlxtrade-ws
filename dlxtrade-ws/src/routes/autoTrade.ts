import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { userEngineManager } from '../services/userEngineManager';
import { autoTradeEngine, TradeSignal } from '../services/autoTradeEngine';
import { logger } from '../utils/logger';
import { decrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { adminAuthMiddleware } from '../middleware/adminAuth';

const toggleAutoTradeSchema = z.object({
  enabled: z.boolean(),
});

const configSchema = z.object({
  autoTradeEnabled: z.boolean().optional(),
  perTradeRiskPct: z.number().min(0.1).max(10).optional(),
  maxConcurrentTrades: z.number().int().min(1).max(10).optional(),
  maxDailyLossPct: z.number().min(0.5).max(50).optional(),
  stopLossPct: z.number().min(0.5).max(10).optional(),
  takeProfitPct: z.number().min(0.5).max(20).optional(),
  manualOverride: z.boolean().optional(),
  mode: z.enum(['AUTO', 'MANUAL']).optional(),
  maxTradesPerDay: z.number().int().min(1).max(500).optional(),
  cooldownSeconds: z.number().int().min(0).max(300).optional(),
  panicStopEnabled: z.boolean().optional(),
  slippageBlocker: z.boolean().optional(),
});

const queueSignalSchema = z.object({
  symbol: z.string(),
  signal: z.enum(['BUY', 'SELL']),
  entryPrice: z.number().positive(),
  accuracy: z.number().min(0).max(1),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  reasoning: z.string().optional(),
  requestId: z.string().optional(),
});

const executeTradeSchema = z.object({
  requestId: z.string(),
  signal: queueSignalSchema,
});

/**
 * Auto-Trade Routes
 * Handles comprehensive auto-trade functionality with risk management
 */
export async function autoTradeRoutes(fastify: FastifyInstance) {
  // Decorate with admin auth middleware
  fastify.decorate('adminAuth', adminAuthMiddleware);

  // GET /api/auto-trade/status - Get auto-trade status
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      
      const status = await autoTradeEngine.getStatus(user.uid);
      const config = await autoTradeEngine.loadConfig(user.uid);
      
      // Get engine status from Firestore
      const engineStatus = await firestoreAdapter.getEngineStatus(user.uid);
      
      // Check if user has exchange API keys configured (read from exchangeConfig/current)
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
      const hasExchangeConfig = exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted && exchangeConfigDoc.data()?.secretEncrypted;
      
      return {
        ...status,
        engineRunning: engineStatus?.engineRunning || false,
        isApiConnected: hasExchangeConfig || false,
        apiStatus: hasExchangeConfig ? 'connected' : 'disconnected',
        config: {
          perTradeRiskPct: config.perTradeRiskPct,
          maxConcurrentTrades: config.maxConcurrentTrades,
          maxDailyLossPct: config.maxDailyLossPct,
          stopLossPct: config.stopLossPct,
          takeProfitPct: config.takeProfitPct,
        },
        stats: config.stats,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade status');
      return reply.code(500).send({ error: err.message || 'Error fetching auto-trade status' });
    }
  });

  // GET /api/auto-trade/config - Get user auto-trade configuration
  fastify.get('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      const config = await autoTradeEngine.loadConfig(user.uid);
      const isRunning = await autoTradeEngine.isAutoTradeRunning(user.uid);
      const lastResearchAt = await autoTradeEngine.getLastResearchTime(user.uid);

      // Calculate next research time (5 minutes from last research if running)
      const nextResearchAt = isRunning && lastResearchAt
        ? new Date(new Date(lastResearchAt).getTime() + 5 * 60 * 1000).toISOString()
        : null;

      // ALWAYS return all expected keys with defaults
      return {
        autoTradeEnabled: config.autoTradeEnabled || false,
        maxConcurrentTrades: config.maxConcurrentTrades || 3,
        maxTradesPerDay: config.maxTradesPerDay || 50,
        cooldownSeconds: config.cooldownSeconds || 30,
        panicStopEnabled: config.panicStopEnabled || false,
        slippageBlocker: config.slippageBlocker || false,
        lastResearchAt: lastResearchAt,
        nextResearchAt: nextResearchAt,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade config');
      // Return success: false with error on database failure
      return {
        success: false,
        error: 'CONFIG_LOAD_FAILURE',
        message: 'Failed to load auto-trade configuration from database',
        details: err.message,
        // Provide fallback defaults so frontend doesn't break
        autoTradeEnabled: false,
        maxConcurrentTrades: 3,
        maxTradesPerDay: 50,
        cooldownSeconds: 30,
        panicStopEnabled: false,
        slippageBlocker: false,
        lastResearchAt: null,
        nextResearchAt: null,
      };
    }
  });

  // POST /api/auto-trade/config - Update user auto-trade configuration
  fastify.post('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = configSchema.parse(request.body);

      const savedConfig = await autoTradeEngine.saveConfig(user.uid, body);

      // Get updated status for response
      const isRunning = await autoTradeEngine.isAutoTradeRunning(user.uid);
      const lastResearchAt = await autoTradeEngine.getLastResearchTime(user.uid);
      const nextResearchAt = isRunning && lastResearchAt
        ? new Date(new Date(lastResearchAt).getTime() + 5 * 60 * 1000).toISOString()
        : null;

      logger.info({ uid: user.uid, config: savedConfig }, 'Auto-trade config updated and saved to Firestore');

      return {
        autoTradeEnabled: savedConfig.autoTradeEnabled || false,
        maxConcurrentTrades: savedConfig.maxConcurrentTrades || 3,
        maxTradesPerDay: savedConfig.maxTradesPerDay || 50,
        cooldownSeconds: savedConfig.cooldownSeconds || 30,
        panicStopEnabled: savedConfig.panicStopEnabled || false,
        slippageBlocker: savedConfig.slippageBlocker || false,
        lastResearchAt: lastResearchAt,
        nextResearchAt: nextResearchAt,
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return {
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Invalid auto-trade configuration data',
          details: err.errors
        };
      }
      logger.error({ err }, 'Error updating auto-trade config');
      // Return success: false with error on database failure
      return {
        success: false,
        error: 'CONFIG_SAVE_FAILURE',
        message: 'Failed to save auto-trade configuration to database',
        details: err.message
      };
    }
  });

  // POST /api/auto-trade/queue - Queue trade signal (internal use)
  fastify.post('/queue', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = queueSignalSchema.parse(request.body);

      const signal: TradeSignal = {
        symbol: body.symbol,
        signal: body.signal,
        entryPrice: body.entryPrice,
        accuracy: body.accuracy,
        stopLoss: body.stopLoss || body.entryPrice * 0.985, // Default 1.5% stop loss
        takeProfit: body.takeProfit || body.entryPrice * 1.03, // Default 3% take profit
        reasoning: body.reasoning || 'Auto-trade signal',
        requestId: body.requestId || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };

      // Save to queue
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(user.uid).collection('autoTradeQueue').add({
        ...signal,
        timestamp: admin.firestore.Timestamp.now(),
        status: 'QUEUED',
        userId: user.uid,
      });

      logger.info({ uid: user.uid, requestId: signal.requestId, symbol: signal.symbol }, 'Trade signal queued');

      return {
        success: true,
        requestId: signal.requestId,
        message: 'Trade signal queued successfully',
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid signal data', details: err.errors });
      }
      logger.error({ err }, 'Error queueing trade signal');
      return reply.code(500).send({ error: err.message || 'Error queueing signal' });
    }
  });

  // POST /api/auto-trade/run - Run queued analyses (admin/manual trigger)
  fastify.post('/run', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const config = await autoTradeEngine.loadConfig(user.uid);

      if (!config.autoTradeEnabled) {
        return reply.code(400).send({ error: 'Auto-trade is not enabled' });
      }

      // Get queued signals
      const db = getFirebaseAdmin().firestore();
      const queueSnapshot = await db.collection('users').doc(user.uid)
        .collection('autoTradeQueue')
        .where('status', '==', 'QUEUED')
        .orderBy('timestamp', 'asc')
        .limit(10)
        .get();

      if (queueSnapshot.empty) {
        return {
          message: 'No queued signals to process',
          processed: 0,
        };
      }

      const results = [];
      for (const doc of queueSnapshot.docs) {
        const signalData = doc.data();
        const signal: TradeSignal = {
          symbol: signalData.symbol,
          signal: signalData.signal,
          entryPrice: signalData.entryPrice,
          accuracy: signalData.accuracy,
          stopLoss: signalData.stopLoss,
          takeProfit: signalData.takeProfit,
          reasoning: signalData.reasoning,
          requestId: signalData.requestId,
          timestamp: signalData.timestamp.toDate(),
        };

        try {
          const trade = await autoTradeEngine.executeTrade(user.uid, signal);
          
          // Update queue status
          await doc.ref.update({
            status: trade.status,
            tradeId: trade.tradeId,
            orderId: trade.orderId,
            processedAt: admin.firestore.Timestamp.now(),
          });

          results.push({ requestId: signal.requestId, status: trade.status, tradeId: trade.tradeId });
        } catch (error: any) {
          await doc.ref.update({
            status: 'FAILED',
            error: error.message,
            processedAt: admin.firestore.Timestamp.now(),
          });
          results.push({ requestId: signal.requestId, status: 'FAILED', error: error.message });
        }
      }

      return {
        message: `Processed ${results.length} queued signals`,
        processed: results.length,
        results,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error running queued trades');
      return reply.code(500).send({ error: err.message || 'Error processing queue' });
    }
  });

  // POST /api/auto-trade/execute - Execute specific queued trade (auth + rate-limited)
  fastify.post('/execute', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = executeTradeSchema.parse(request.body);

      const signal: TradeSignal = {
        symbol: body.signal.symbol,
        signal: body.signal.signal,
        entryPrice: body.signal.entryPrice,
        accuracy: body.signal.accuracy,
        stopLoss: body.signal.stopLoss || body.signal.entryPrice * 0.985,
        takeProfit: body.signal.takeProfit || body.signal.entryPrice * 1.03,
        reasoning: body.signal.reasoning || 'Manual execution',
        requestId: body.requestId,
        timestamp: new Date(),
      };

      const trade = await autoTradeEngine.executeTrade(user.uid, signal);

      return {
        success: true,
        trade,
        message: 'Trade executed successfully',
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid trade data', details: err.errors });
      }
      logger.error({ err }, 'Error executing trade');
      return reply.code(500).send({ error: err.message || 'Error executing trade' });
    }
  });


  // POST /api/auto-trade/toggle - Toggle auto-trade ON/OFF (legacy compatibility)
  fastify.post('/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = toggleAutoTradeSchema.parse(request.body);

      // Verify user has connected exchange API keys (read from exchangeConfig/current)
      const db = getFirebaseAdmin().firestore();
      const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
      
      if (!exchangeConfigDoc.exists) {
        return reply.code(400).send({
          error: 'Exchange API keys not found. Please connect your exchange API keys first in Settings → API Integration.',
        });
      }

      const exchangeConfig = exchangeConfigDoc.data();
      if (!exchangeConfig?.apiKeyEncrypted || !exchangeConfig?.secretEncrypted) {
        return reply.code(400).send({
          error: 'Exchange API keys not properly configured. Please connect your exchange API keys first.',
        });
      }

      // Verify it's a trading exchange (not research API)
      const exchange = exchangeConfig.exchange || exchangeConfig.type;
      if (!['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
        return reply.code(400).send({
          error: 'Trading exchange API keys required. Please connect a trading exchange (Binance, Bitget, BingX, or WEEX) first.',
        });
      }

      // Update config
      await autoTradeEngine.saveConfig(user.uid, { autoTradeEnabled: body.enabled });

      if (body.enabled) {
        // Initialize adapter
        await autoTradeEngine.initializeAdapter(user.uid);

        // Update engineStatus in Firestore
        const engineStatusRef = db.collection('engineStatus').doc(user.uid);
        await engineStatusRef.set({
          uid: user.uid,
          engineRunning: true,
          autoTradeEnabled: true,
          lastStarted: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

        await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_ENABLED', {
          message: 'Auto-trade engine started',
        });

        logger.info({ uid: user.uid }, 'Auto-trade enabled');
      } else {
        // Update engineStatus in Firestore
        const engineStatusRef = db.collection('engineStatus').doc(user.uid);
        await engineStatusRef.set({
          uid: user.uid,
          engineRunning: false,
          autoTradeEnabled: false,
          lastStopped: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

        await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_DISABLED', {
          message: 'Auto-trade engine stopped',
        });

        logger.info({ uid: user.uid }, 'Auto-trade disabled');
      }

      return {
        message: body.enabled ? 'Auto-trade enabled successfully' : 'Auto-trade disabled successfully',
        enabled: body.enabled,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error toggling auto-trade');
      return reply.code(500).send({ error: err.message || 'Error toggling auto-trade' });
    }
  });

  // POST /api/auto-trade/reset-circuit-breaker - Reset circuit breaker (admin only)
  fastify.post('/reset-circuit-breaker', {
    preHandler: [fastify.authenticate, fastify.adminAuth],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      await autoTradeEngine.resetCircuitBreaker(user.uid);

      return {
        message: 'Circuit breaker reset successfully',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error resetting circuit breaker');
      return reply.code(500).send({ error: err.message || 'Error resetting circuit breaker' });
    }
  });

  // GET /api/auto-trade/active-trades - Get active trades
  fastify.get('/active-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

      const activeTrades = await firestoreAdapter.getActiveTrades(user.uid, limit);

      return { activeTrades };
    } catch (err: any) {
      logger.error({ err }, 'Error getting active trades');
      return reply.code(500).send({ error: err.message || 'Error fetching active trades' });
    }
  });

  // GET /api/auto-trade/activity - Get auto-trade activity logs
  fastify.get('/activity', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

      const activities = await firestoreAdapter.getAutoTradeActivity(user.uid, limit);

      return { activities };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade activity');
      return reply.code(500).send({ error: err.message || 'Error fetching auto-trade activity' });
    }
  });

  // GET /api/auto-trade/proposals - Get trade proposals
  fastify.get('/proposals', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      const proposals = await firestoreAdapter.getTradeProposals(user.uid);

      return { proposals };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trade proposals');
      return reply.code(500).send({ error: err.message || 'Error fetching trade proposals' });
    }
  });

  // GET /api/auto-trade/logs - Get auto-trade execution logs
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;

      const logs = await firestoreAdapter.getAutoTradeLogs(user.uid, limit);

      return { logs };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade logs');
      return reply.code(500).send({ error: err.message || 'Error fetching auto-trade logs' });
    }
  });
}
