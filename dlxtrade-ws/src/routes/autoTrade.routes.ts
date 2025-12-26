import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { routeEntryLog, routeExitLog, firestoreReadWithTimeout } from '../utils/routeGuards';

/**
 * Auto-Trade Routes - Activity, Proposals, and Logs
 * Contains remaining route handlers for activity monitoring and history
 */
export async function routesRoutes(fastify: FastifyInstance) {
  // GET /api/auto-trade/activity - Get auto-trade activity logs
  // CRITICAL: Must respond < 500ms - uses fail-fast guards
  // CRITICAL: Early-exit guard - return immediately if auto-trade is disabled
  fastify.get('/activity', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const startTime = routeEntryLog('GET /auto-trade/activity');

    try {
      const user = (request as any).user;

      // CRITICAL: Early-exit guard - check if auto-trade is enabled
      // If disabled, return immediately with empty array (no heavy queries)
      const configDoc = await (await import('../utils/firebase')).getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get();
      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      if (!autoTradeEnabled) {
        logger.debug({ uid: user.uid }, '⏭️ [EARLY_EXIT] /activity - auto-trade disabled, returning empty array');
        routeExitLog('GET /auto-trade/activity (early-exit)', startTime);
        return { activities: [] };
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;

      const activities = await firestoreReadWithTimeout(
        () => firestoreAdapter.getAutoTradeActivity(user.uid, limit),
        [],
        'getAutoTradeActivity'
      );

      routeExitLog('GET /auto-trade/activity', startTime);
      return { activities };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade activity');
      routeExitLog('GET /auto-trade/activity (error)', startTime);
      return { activities: [] };
    }
  });

  // GET /api/auto-trade/proposals - Get trade proposals
  // CRITICAL: Must respond < 500ms - uses fail-fast guards
  fastify.get('/proposals', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = routeEntryLog('GET /auto-trade/proposals');

    try {
      const user = (request as any).user;

      const proposals = await firestoreReadWithTimeout(
        () => firestoreAdapter.getTradeProposals(user.uid),
        [],
        'getTradeProposals'
      );

      routeExitLog('GET /auto-trade/proposals', startTime);
      return { proposals };
    } catch (err: any) {
      logger.error({ err }, 'Error getting trade proposals');
      routeExitLog('GET /auto-trade/proposals (error)', startTime);
      return { proposals: [] };
    }
  });

  // GET /api/auto-trade/logs - Get auto-trade execution logs
  // CRITICAL: Must respond < 500ms - uses fail-fast guards
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const startTime = routeEntryLog('GET /auto-trade/logs');

    try {
      const user = (request as any).user;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;

      const logs = await firestoreReadWithTimeout(
        () => firestoreAdapter.getAutoTradeLogs(user.uid, limit),
        [],
        'getAutoTradeLogs'
      );

      routeExitLog('GET /auto-trade/logs', startTime);
      return { logs };
    } catch (err: any) {
      logger.error({ err }, 'Error getting auto-trade logs');
      routeExitLog('GET /auto-trade/logs (error)', startTime);
      return { logs: [] };
    }
  });
}
