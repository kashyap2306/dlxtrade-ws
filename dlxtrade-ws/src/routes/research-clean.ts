import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { deepResearchEngine } from '../services/deepResearchEngine';
import * as admin from 'firebase-admin';

// Global research rate limiter (max 10 concurrent research operations system-wide)
let activeResearchOperations = 0;
const MAX_CONCURRENT_RESEARCH = 10;

export async function researchRoutes(fastify: FastifyInstance) {
  // POST /api/research/run - Clean UI-friendly deep research endpoint
  fastify.post('/run', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      console.log('[RESEARCH API] START: Clean Deep Research');

      // Check global research rate limit
      if (activeResearchOperations >= MAX_CONCURRENT_RESEARCH) {
        return reply.code(429).send({
          error: true,
          message: 'System is at maximum research capacity. Please try again in a few moments.'
        });
      }

      // Increment active operations counter
      activeResearchOperations++;

      // Check 30-second cooldown
      const userDoc = await admin.firestore().collection('users').doc(user.uid).get();
      const userData = userDoc.data();
      const lastRun = userData?.deepResearchLastRun;

      if (lastRun) {
        const now = Date.now();
        const timeSinceLastRun = now - lastRun;
        const cooldownMs = 30 * 1000; // 30 seconds

        if (timeSinceLastRun < cooldownMs) {
          const remainingSeconds = Math.ceil((cooldownMs - timeSinceLastRun) / 1000);
          activeResearchOperations = Math.max(0, activeResearchOperations - 1);
          return reply.code(429).send({
            error: true,
            message: `Please wait ${remainingSeconds} seconds before next scan`
          });
        }
      }

      // Update last research timestamp
      await admin.firestore().collection('users').doc(user.uid).update({
        deepResearchLastRun: Date.now()
      });

      logger.info({ uid: user.uid }, 'Starting clean deep research with optimal symbol selection');

      // Run batch research with optimal symbol selection (primary + batch)
      const batchResults = await deepResearchEngine.runDeepResearchBatch(user.uid, undefined, 3);

      // Transform results to clean UI-friendly format
      const cleanResults = batchResults
        .filter(r => r.result && !r.error)
        .map(r => ({
          symbol: r.symbol,
          accuracy: r.result.accuracy,
          price: r.result.raw.binancePublic?.price || r.result.raw.coinMarketCap?.marketData?.price || 0,
          signal: r.result.combinedSignal,
          timestamp: new Date(r.timestamp).toISOString(),
        }))
        .sort((a, b) => b.accuracy - a.accuracy); // Sort by accuracy descending

      const response = {
        success: true,
        message: 'Deep research completed successfully',
        results: cleanResults,
        totalSymbols: batchResults.length,
        successfulAnalyses: cleanResults.length,
        timestamp: new Date().toISOString(),
      };

      console.log(`[RESEARCH API] Completed clean research for ${cleanResults.length} symbols`);

      // Decrement active operations counter
      activeResearchOperations = Math.max(0, activeResearchOperations - 1);

      return reply.code(200).send(response);

    } catch (error: any) {
      // Decrement active operations counter on error
      activeResearchOperations = Math.max(0, activeResearchOperations - 1);

      logger.error({ error: error.message, uid: user.uid }, 'Clean deep research failed');
      return reply.code(500).send({
        error: 'Research analysis failed',
        details: error.message,
      });
    }
  });

  // GET /api/research/results - Get clean research results for UI display
  fastify.get('/results', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      // Get recent research logs (last 20)
      const logs = await firestoreAdapter.getResearchLogs(user.uid, 20);

      // Transform to clean UI format
      const cleanResults = logs
        .filter(log => log.symbol && log.accuracy !== undefined)
        .map(log => ({
          symbol: log.symbol,
          accuracy: log.accuracy,
          price: 0, // Would need to fetch current price from market data
          signal: log.signal || 'HOLD',
          timestamp: log.timestamp?.toDate().toISOString() || new Date().toISOString(),
        }))
        .sort((a, b) => b.accuracy - a.accuracy)
        .slice(0, 10); // Top 10 by accuracy

      return reply.code(200).send({
        success: true,
        results: cleanResults,
        count: cleanResults.length,
        timestamp: new Date().toISOString(),
      });

    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Failed to get research results');
      return reply.code(500).send({
        error: 'Failed to retrieve research results',
        details: error.message,
      });
    }
  });
}
