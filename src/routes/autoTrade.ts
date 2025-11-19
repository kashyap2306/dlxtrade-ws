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
  trailingStop: z.boolean().optional(),
  trailingPct: z.number().min(0.1).max(5).optional(),
  manualOverride: z.boolean().optional(),
  mode: z.enum(['AUTO', 'MANUAL', 'SIMULATION']).optional(),
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
          trailingStop: config.trailingStop,
          trailingPct: config.trailingPct,
        },
        stats: config.stats,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade status');
      return reply.code(500).send({ error: err.message || 'Error fetching auto-trade status' });
    }
  });

  // POST /api/auto-trade/config - Update user auto-trade configuration
  fastify.post('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = configSchema.parse(request.body);

      // Validate mode changes - require admin for AUTO mode
      if (body.mode === 'AUTO' && body.mode !== (await autoTradeEngine.loadConfig(user.uid)).mode) {
        // Check if user is admin
        const db = getFirebaseAdmin().firestore();
        const userDoc = await db.collection('users').doc(user.uid).get();
        const userData = userDoc.data() || {};
        const isAdmin = userData.role === 'admin' || userData.isAdmin === true;

        if (!isAdmin) {
          return reply.code(403).send({
            error: 'Only admins can enable AUTO (live trading) mode. Use SIMULATION mode for testing.',
          });
        }
      }

      const savedConfig = await autoTradeEngine.saveConfig(user.uid, body);

      logger.info({ uid: user.uid, config: savedConfig }, 'Auto-trade config updated and saved to Firestore');

      return {
        message: 'Configuration updated successfully',
        config: savedConfig,
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid configuration', details: err.errors });
      }
      logger.error({ err }, 'Error updating auto-trade config');
      return reply.code(500).send({ error: err.message || 'Error updating configuration' });
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
        message: trade.mode === 'SIMULATION' 
          ? 'Trade simulated successfully (SIMULATION mode)' 
          : 'Trade executed successfully',
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid trade data', details: err.errors });
      }
      logger.error({ err }, 'Error executing trade');
      return reply.code(500).send({ error: err.message || 'Error executing trade' });
    }
  });

  // POST /api/auto-trade/simulate - Run in dry-run mode (no real orders)
  fastify.post('/simulate', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = queueSignalSchema.parse(request.body);

      // Temporarily set mode to SIMULATION
      const originalConfig = await autoTradeEngine.loadConfig(user.uid);
      await autoTradeEngine.saveConfig(user.uid, { mode: 'SIMULATION' });

      try {
        const signal: TradeSignal = {
          symbol: body.symbol,
          signal: body.signal,
          entryPrice: body.entryPrice,
          accuracy: body.accuracy,
          stopLoss: body.stopLoss || body.entryPrice * 0.985,
          takeProfit: body.takeProfit || body.entryPrice * 1.03,
          reasoning: body.reasoning || 'Simulation test',
          requestId: body.requestId || `sim_${Date.now()}`,
          timestamp: new Date(),
        };

        const trade = await autoTradeEngine.executeTrade(user.uid, signal);

        // Restore original mode
        await autoTradeEngine.saveConfig(user.uid, { mode: originalConfig.mode });

        return {
          success: true,
          trade,
          message: 'Trade simulated successfully (no real orders placed)',
          simulation: true,
        };
      } catch (error: any) {
        // Restore original mode on error
        await autoTradeEngine.saveConfig(user.uid, { mode: originalConfig.mode });
        throw error;
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({ error: 'Invalid signal data', details: err.errors });
      }
      logger.error({ err }, 'Error simulating trade');
      return reply.code(500).send({ error: err.message || 'Error simulating trade' });
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
}
