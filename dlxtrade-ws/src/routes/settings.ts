import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { accuracyEngine } from '../services/accuracyEngine';

const settingsSchema = z.object({
  symbol: z.string().optional(),
  quoteSize: z.number().positive().optional(),
  adversePct: z.number().min(0).max(1).optional(),
  cancelMs: z.number().int().positive().optional(),
  maxPos: z.number().positive().optional(),
  minAccuracyThreshold: z.number().min(0).max(1).optional(),
  autoTradeEnabled: z.boolean().optional(),
  strategy: z.enum(['orderbook_imbalance', 'smc_hybrid', 'stat_arb']).optional(), // market_making_hft is handled by HFT engine
  liveMode: z.boolean().optional(),
  max_loss_pct: z.number().min(0).max(100).optional(),
  max_drawdown_pct: z.number().min(0).max(100).optional(),
  per_trade_risk_pct: z.number().min(0).max(100).optional(),
  status: z.enum(['active', 'paused_by_risk', 'paused_manual']).optional(),
});

// Trading Settings Schema
const positionSizingMapItemSchema = z.object({
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
  percent: z.number().min(0).max(100),
});

const tradingSettingsSchema = z.object({
  mode: z.enum(['MANUAL', 'TOP_100', 'TOP_10']),
  manualCoins: z.array(z.string()).min(1),
  maxPositionPerTrade: z.number().min(0.1).max(100),
  tradeType: z.enum(['Scalping', 'Swing', 'Position']),
  accuracyTrigger: z.number().min(0).max(100),
  maxDailyLoss: z.number().min(0).max(100),
  maxTradesPerDay: z.number().int().min(1).max(500),
  positionSizingMap: z.array(positionSizingMapItemSchema).min(1),
}).refine((data) => {
  // Validate position sizing map ranges don't overlap and cover 0-100
  const map = data.positionSizingMap.sort((a, b) => a.min - b.min);
  for (let i = 0; i < map.length - 1; i++) {
    if (map[i].max >= map[i + 1].min) {
      return false; // Overlapping ranges
    }
  }
  return map[0].min <= 0 && map[map.length - 1].max >= 100;
}, {
  message: 'Position sizing map ranges must not overlap and cover 0-100%',
});

export async function settingsRoutes(fastify: FastifyInstance) {
  // Load user settings
  fastify.get('/settings/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const settings = await firestoreAdapter.getSettings(user.uid);
    
    if (!settings) {
      return {
        symbol: 'BTCUSDT',
        quoteSize: 0.001,
        adversePct: 0.0002,
        cancelMs: 40,
        maxPos: 0.01,
        minAccuracyThreshold: 0.85,
        autoTradeEnabled: false,
        strategy: 'orderbook_imbalance',
        liveMode: false,
        max_loss_pct: 5,
        max_drawdown_pct: 10,
        per_trade_risk_pct: 1,
        status: 'active',
      };
    }

    return {
      ...settings,
      updatedAt: settings.updatedAt?.toDate().toISOString(),
    };
  });

  // Update user settings
  fastify.post('/settings/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = settingsSchema.parse(request.body);
    
    // Safety check: Block liveMode if ENABLE_LIVE_TRADES is not set
    if (body.liveMode === true) {
      const enableLiveTrades = process.env.ENABLE_LIVE_TRADES === 'true';
      if (!enableLiveTrades) {
        return reply.code(403).send({ 
          error: 'Live trading is disabled globally. Set ENABLE_LIVE_TRADES=true in environment to enable.' 
        });
      }
    }
    
    await firestoreAdapter.saveSettings(user.uid, body);
    
    return { message: 'Settings updated', settings: body };
  });

  // Load global settings (admin only)
  fastify.get('/settings/global/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const settings = await firestoreAdapter.getGlobalSettings();
      return { settings: settings || {} };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error loading global settings' });
    }
  });

  // Update global settings (admin only)
  fastify.post('/settings/global/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const isAdmin = await firestoreAdapter.isAdmin(user.uid);
      if (!isAdmin) {
        return reply.code(403).send({ error: 'Admin access required' });
      }

      const body = request.body as any;
      await firestoreAdapter.updateGlobalSettings(body);

      return { message: 'Global settings updated successfully' };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error updating global settings' });
    }
  });

  // Trading Settings Routes
  // GET /api/trading/settings - Load trading settings
  fastify.get('/trading/settings', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const data = await firestoreAdapter.getTradingSettings((req as any).user.uid);
    return { success: true, data };
  });

  // POST /api/trading/settings - Update trading settings
  fastify.post('/trading/settings', {
    preHandler: [fastify.authenticate],
  }, async (req, reply) => {
    const saved = await firestoreAdapter.saveTradingSettings((req as any).user.uid, (req as any).body);
    return { success: true, data: saved };
  });

  // POST /api/trading/autotrade/toggle - Toggle auto-trade ON/OFF
  fastify.post('/trading/autotrade/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = z.object({ enabled: z.boolean() }).parse(request.body);

      const { autoTradeEngine } = await import('../services/autoTradeEngine');

      if (body.enabled) {
        await autoTradeEngine.startAutoTradeLoop(user.uid);
        await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_STARTED', {
          message: 'Auto-trade background research loop started',
          timestamp: new Date().toISOString(),
        });
        return { enabled: true, message: 'Auto-trade started successfully' };
      } else {
        await autoTradeEngine.stopAutoTradeLoop(user.uid);
        await firestoreAdapter.logActivity(user.uid, 'AUTO_TRADE_STOPPED', {
          message: 'Auto-trade background research loop stopped',
          timestamp: new Date().toISOString(),
        });
        return { enabled: false, message: 'Auto-trade stopped successfully' };
      }
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error toggling auto-trade' });
    }
  });

  // GET /api/trading/autotrade/status - Get auto-trade status
  fastify.get('/trading/autotrade/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { autoTradeEngine } = await import('../services/autoTradeEngine');

      const isRunning = await autoTradeEngine.isAutoTradeRunning(user.uid);
      const lastResearchAt = await autoTradeEngine.getLastResearchTime(user.uid);
      const nextScheduledAt = isRunning ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null;

      return {
        enabled: isRunning,
        lastResearchAt,
        nextScheduledAt,
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error getting auto-trade status' });
    }
  });

  // Analytics Routes for Accuracy Engine
  // GET /api/analytics/accuracy/snapshot - Get accuracy snapshot by requestId
  fastify.get('/analytics/accuracy/snapshot', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId } = request.query;

      if (!requestId) {
        return reply.code(400).send({ error: 'requestId is required' });
      }

      const snapshot = await firestoreAdapter.getPredictionSnapshot(requestId);

      if (!snapshot) {
        return reply.code(404).send({ error: 'Snapshot not found' });
      }

      // Check if user owns this snapshot
      if (snapshot.userId !== user.uid) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      return {
        snapshot,
        requestId,
        retrievedAt: new Date().toISOString()
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error retrieving accuracy snapshot' });
    }
  });

  // GET /api/analytics/accuracy/history - Get rolling accuracy stats
  fastify.get('/analytics/accuracy/history', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { strategy?: string; symbol?: string; limit?: number } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { strategy, symbol, limit = 100 } = request.query;

      const stats = await firestoreAdapter.getAccuracyHistory(user.uid, {
        strategy,
        symbol,
        limit: Math.min(limit, 500) // Cap at 500
      });

      return {
        stats,
        filters: { strategy, symbol, limit },
        retrievedAt: new Date().toISOString()
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error retrieving accuracy history' });
    }
  });

  // POST /api/analytics/accuracy/outcome - Record prediction outcome
  fastify.post('/analytics/accuracy/outcome', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string; win: boolean; pnl: number; durationSeconds?: number } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId, win, pnl, durationSeconds } = request.body;

      if (!requestId || typeof win !== 'boolean' || typeof pnl !== 'number') {
        return reply.code(400).send({ error: 'requestId, win (boolean), and pnl (number) are required' });
      }

      await accuracyEngine.recordPredictionOutcome(requestId, {
        win,
        pnl,
        durationSeconds
      });

      return {
        success: true,
        message: 'Prediction outcome recorded successfully',
        requestId,
        recordedAt: new Date().toISOString()
      };
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Error recording prediction outcome' });
    }
  });
}

