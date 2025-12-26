import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diagnosticCheckRoute } from './autoTrade.diagnostic';
import { statusRoutes } from './autoTrade.status';
import { controllerRoutes } from './autoTrade.controller';
import { executionRoutes } from './autoTrade.execution';
import { routesRoutes } from './autoTrade.routes';
import { adminAuthMiddleware } from '../middleware/adminAuth';

// Export schemas for use by other modules
export const toggleAutoTradeSchema = z.object({
  enabled: z.boolean(),
  frequencyMinutes: z.number().optional()
});

export const configSchema = z.object({
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

export const queueSignalSchema = z.object({
  symbol: z.string(),
  signal: z.enum(['BUY', 'SELL']),
  entryPrice: z.number().positive(),
  accuracy: z.number().min(0).max(1),
  stopLoss: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  reasoning: z.string().optional(),
  requestId: z.string().optional(),
});

export const executeTradeSchema = z.object({
  requestId: z.string(),
  signal: queueSignalSchema,
});

/**
 * Auto-Trade Routes - Entry Point
 * Registers all auto-trade route modules with Fastify
 */
export async function autoTradeRoutes(fastify: FastifyInstance) {
  console.log('[AUTO-TRADE ROUTES] ENTRY POINT LOADED');

  // Register admin auth middleware
  fastify.decorate('adminAuth', adminAuthMiddleware);

  // Register all route modules
  await diagnosticCheckRoute(fastify);
  await statusRoutes(fastify);
  await controllerRoutes(fastify);
  await executionRoutes(fastify);
  await routesRoutes(fastify);

  console.log('[AUTO-TRADE ROUTES] All route modules registered successfully');
}