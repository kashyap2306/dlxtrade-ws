import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';

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

export async function settingsRoutes(fastify: FastifyInstance) {
  // Load user settings
  fastify.get('/load', {
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
  fastify.post('/update', {
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
  fastify.get('/global/load', {
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
  fastify.post('/global/update', {
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
}

