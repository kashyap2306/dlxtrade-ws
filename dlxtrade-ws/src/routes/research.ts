import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { runFreeModeDeepResearch, deepResearchEngine } from '../services/deepResearchEngine';
import { getUserIntegrations } from './integrations';
import { BinanceAdapter } from '../services/binanceAdapter';
import { CryptoCompareAdapter } from '../services/cryptocompareAdapter';
import { z } from 'zod';
import { logger } from '../utils/logger';

type ResearchResponse = {
  success: boolean;
  reason?: string;
  providersCalled: string[];
  raw?: any;
  analysis?: {
    signal?: string;
    accuracy?: number;
    [key: string]: any;
  };
};

const researchQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

export async function researchRoutes(fastify: FastifyInstance) {
  fastify.get("/background-research/settings", { preHandler: [fastify.authenticate] }, async (req) => {
    const data = await firestoreAdapter.getBackgroundResearchSettings((req as any).user.uid);
    return { success: true, data };
  });

  fastify.post("/background-research/settings", { preHandler: [fastify.authenticate] }, async (req) => {
    const saved = await firestoreAdapter.saveBackgroundResearchSettings((req as any).user.uid, (req as any).body);
    return { success: true, data: saved };
  });

  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const query = researchQuerySchema.parse(request.query);
    const logs = await firestoreAdapter.getResearchLogs(user.uid, query.limit);

    return logs.map((log) => ({
      id: log.id,
      symbol: log.symbol,
      timestamp: log.timestamp?.toDate().toISOString(),
      signal: log.signal,
      accuracy: log.accuracy,
      orderbookImbalance: log.orderbookImbalance,
      recommendedAction: log.recommendedAction,
      microSignals: log.microSignals,
      createdAt: log.createdAt?.toDate().toISOString(),
    }));
  });

  // POST /api/research/free-mode - Run FREE MODE Deep Research v1.5
  fastify.post('/free-mode', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { uid?: string; symbol?: string; symbols?: string[]; mode?: 'free' | 'premium' } }>, reply: FastifyReply) => {
    const body = z.object({
      uid: z.string().optional(),
      symbol: z.string().optional(),
      symbols: z.array(z.string()).optional(),
      mode: z.enum(['free', 'premium']).optional().default('free')
    }).parse(request.body || {});

    const uid = (request as any).user?.uid || body.uid;
    const mode = body.mode;

    if (!uid || typeof uid !== "string") {
      return reply.code(400).send({ error: "UID missing" });
    }

    try {
      logger.info({ uid, mode }, 'Starting FREE MODE Deep Research v1.5');

      // Determine symbols to analyze
      const symbols = body.symbols || (body.symbol ? [body.symbol] : ['BTCUSDT']);

      logger.info({ uid, symbols, mode }, 'Starting FREE MODE research for symbols');

      // Collect all results
      const results: any[] = [];

      for (const symbol of symbols) {
        const requestId = `free_research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const symbolStartTime = Date.now();

        try {
          logger.info({ uid, symbol, requestId, mode }, 'Running FREE MODE deep research for symbol');

          // ALWAYS load user integrations for API keys
          const integrations = await getUserIntegrations(uid);
          console.log("[DR] Integrations for", uid, integrations);

          // Check if integrations are empty - log but continue with FreeMode
          const hasAnyIntegrations = Object.values(integrations || {}).some((provider: any) =>
            provider?.apiKey || provider?.secret
          );

          if (!integrations || !hasAnyIntegrations) {
            console.log("No user API keys found → running FreeMode without premium providers.");
          }

          // Run FREE MODE Deep Research v1.5 with user integrations
          const result = await runFreeModeDeepResearch(uid, symbol, undefined, integrations);

          results.push({
            symbol,
            requestId,
            result,
            processingTimeMs: Date.now() - symbolStartTime,
            mode: 'free'
          });

          logger.info({ uid, symbol, requestId, signal: result.signal, accuracy: result.accuracy }, 'FREE MODE deep research completed successfully');
        } catch (err: any) {
          logger.error({ err: err.message, uid, symbol, requestId }, 'FREE MODE deep research execution failed');
          results.push({
            symbol,
            requestId,
            error: err.message,
            processingTimeMs: Date.now() - symbolStartTime,
            mode: 'free'
          });
        }
      }

      return {
        success: true,
        results,
        totalSymbols: symbols.length,
        timestamp: new Date().toISOString(),
        mode: 'free'
      };
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'FREE MODE Deep research route failed');
      return reply.code(500).send({
        error: 'FREE MODE Deep research failed',
        reason: error.message || 'Unknown error occurred',
      });
    }
  });

  // POST /api/research/run - Run FREE MODE Deep Research v1.5
  fastify.post('/run', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { uid?: string; symbol?: string; symbols?: string[] } }>, reply: FastifyReply) => {
    const body = z.object({ uid: z.string().optional(), symbol: z.string().optional(), symbols: z.array(z.string()).optional() }).parse(request.body || {});

    const uid = (request as any).user?.uid || body.uid;

    if (!uid || typeof uid !== "string") {
      return reply.code(400).send({ error: "UID missing" });
    }

    try {
      logger.info({ uid }, 'Starting FREE MODE Deep Research v1.5');

      // Determine symbols to analyze
      const symbols = body.symbols || (body.symbol ? [body.symbol] : ['BTCUSDT']);

      logger.info({ uid, symbols }, 'Starting FREE MODE research for symbols');

      // Collect all results
      const results: any[] = [];

      for (const symbol of symbols) {
        const requestId = `free_research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const symbolStartTime = Date.now();

        try {
          logger.info({ uid, symbol, requestId }, 'Running FREE MODE deep research for symbol');

          // Get user integrations for API keys
          const userIntegrations = await getUserIntegrations(uid);

          // Call FREE MODE Deep Research v1.5 with user integrations
          const result = await runFreeModeDeepResearch(uid, symbol, undefined, userIntegrations);

          results.push({
            symbol,
            requestId,
            result,
            processingTimeMs: Date.now() - symbolStartTime,
          });

          logger.info({ uid, symbol, requestId, signal: result.signal, accuracy: result.accuracy }, 'FREE MODE deep research completed successfully');
        } catch (err: any) {
          logger.error({ err: err.message, uid, symbol, requestId }, 'FREE MODE deep research execution failed');
          results.push({
            symbol,
            requestId,
            error: err.message,
            processingTimeMs: Date.now() - symbolStartTime,
          });
        }
      }

      return {
        success: true,
        results,
        totalSymbols: symbols.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'FREE MODE Deep research route failed');
      return reply.code(500).send({
        error: 'FREE MODE Deep research failed',
        reason: error.message || 'Unknown error occurred',
      });
    }
  });

  // TEST ENDPOINT - NO AUTH REQUIRED (for testing FREE MODE purposes)
  fastify.post('/test-run', async (request: FastifyRequest<{ Body: { symbols?: string[] } }>, reply: FastifyReply) => {
    const body = z.object({ symbols: z.array(z.string()).optional() }).parse(request.body || {});

    try {
      logger.info('Starting test FREE MODE Deep Research v1.5');

      // Use a test user ID
      const testUserId = 'test-user-' + Date.now();

      // Determine symbols to analyze
      const symbols = body.symbols || ['BTCUSDT'];

      logger.info({ testUserId, symbols }, 'Starting test FREE MODE research for symbols');

      // Run the FREE MODE research with manual loop for multiple symbols
      const results: any[] = [];

      for (const symbol of symbols) {
        const requestId = `test_free_research_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const symbolStartTime = Date.now();

        try {
          logger.info({ testUserId, symbol, requestId }, 'Running test FREE MODE deep research for symbol');

          // Create mock integrations for testing (empty keys = free mode)
          const mockIntegrations = {
            binance: { apiKey: '', secret: '' },
            cryptocompare: { apiKey: '' },
            cmc: { apiKey: '' },
            newsdata: { apiKey: '' }
          };

          const result = await runFreeModeDeepResearch(testUserId, symbol, {
            binance: { primary: 'binance', backups: ['bybit', 'okx', 'kucoin'] },
            cryptocompare: { primary: 'cryptocompare', backups: ['alphavantage', 'coingecko'] },
            cmc: { primary: 'coinmarketcap', backups: ['coingecko'] },
            news: { primary: 'newsdata', backups: ['cryptopanic', 'reddit'] }
          }, mockIntegrations);

          results.push({
            symbol,
            durationMs: Date.now() - symbolStartTime,
            result: {
              signal: result.signal,
              accuracy: result.accuracy,
              raw: result.raw
            },
            error: null
          });
          logger.info({ testUserId, symbol, requestId, signal: result.signal, accuracy: result.accuracy }, 'Test FREE MODE deep research completed successfully');
        } catch (err: any) {
          logger.error({ err: err.message, testUserId, symbol, requestId }, 'Test FREE MODE deep research execution failed');
          results.push({
            symbol,
            durationMs: Date.now() - symbolStartTime,
            result: null,
            error: err.message
          });
        }
      }

      const response = {
        success: true,
        requestedSymbols: symbols,
        results,
        mode: 'free'
      };

      logger.info({ responseCount: results.filter(r => r.result).length }, 'Test FREE MODE deep research completed');
      return response;

    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, 'Test FREE MODE deep research route failed');
      return reply.code(500).send({
        error: 'Test FREE MODE deep research failed',
        reason: error.message || 'Unknown error occurred',
      });
    }
  });

  // Build info endpoint for deployment verification
  fastify.get('/build-info', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const fs = require('fs');
      const path = require('path');

      // Try to get git hash from .git/HEAD
      let gitHash = 'unknown';
      try {
        const gitHead = path.join(process.cwd(), '.git', 'HEAD');
        if (fs.existsSync(gitHead)) {
          const headContent = fs.readFileSync(gitHead, 'utf8').trim();
          if (headContent.startsWith('ref: ')) {
            const refPath = path.join(process.cwd(), '.git', headContent.substring(5));
            if (fs.existsSync(refPath)) {
              gitHash = fs.readFileSync(refPath, 'utf8').trim().substring(0, 8);
            }
          }
        }
      } catch (gitError) {
        // Ignore git errors
      }

      return {
        version: "deep-research-v2",
        timestamp: Date.now(),
        gitHash: gitHash,
        buildTime: new Date().toISOString(),
        serverPath: __dirname,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production'
      };
    } catch (error: any) {
      return reply.code(500).send({
        error: 'Build info failed',
        reason: error.message
      });
    }
  });

  // Test endpoint to verify API calls work on Render
  fastify.get('/test/providers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      console.log('🔄 TEST ENDPOINT: Testing provider API calls...');

      // Test Binance public API
      const binanceAdapter = new BinanceAdapter('', '', true); // Public API only
      const binanceResult = await binanceAdapter.getPublicMarketData('BTCUSDT');

      // Test CryptoCompare API
      const ccAdapter = new CryptoCompareAdapter('');
      const ccResult = await ccAdapter.getOHLCData('BTCUSDT');

      console.log('✅ TEST ENDPOINT: Both providers called successfully');
      console.log('Binance result hasData:', binanceResult?.hasData);
      console.log('CryptoCompare OHLC length:', ccResult?.ohlc?.length);

      return {
        binance: binanceResult,
        cryptocompare: ccResult,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('❌ TEST ENDPOINT ERROR:', error.message, error.stack);
      return reply.code(500).send({
        error: 'Provider test failed',
        reason: error.message,
        stack: error.stack
      });
    }
  });
}
