import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { autoTradeEngine, TradeSignal } from '../services/autoTradeEngine';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

/**
 * Auto-Trade Execution Routes
 * Contains execution, queue, approve/reject logic with history writing
 */
export async function executionRoutes(fastify: FastifyInstance) {
  // POST /api/auto-trade/queue - Queue trade signal (internal use)
  fastify.post('/queue', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = (request.body as any);

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
      const body = (request.body as any);

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
      logger.error({ err }, 'Error executing trade');
      return reply.code(500).send({ error: err.message || 'Error executing trade' });
    }
  });

  // GET /api/auto-trade/active-trades - Get active trades
  // CRITICAL: Early-exit guard - return immediately if auto-trade is disabled
  fastify.get('/active-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // CRITICAL: Early-exit guard - check if auto-trade is enabled
      // If disabled, return immediately with empty array (no heavy queries)
      const configDoc = await getFirebaseAdmin().firestore()
        .collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get();
      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      if (!autoTradeEnabled) {
        logger.debug({ uid: user.uid }, '⏭️ [EARLY_EXIT] /active-trades - auto-trade disabled, returning empty array');
        return { activeTrades: [] };
      }

      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const activeTrades = await firestoreAdapter.getActiveTrades(user.uid, limit);

      return { activeTrades };
    } catch (err: any) {
      logger.error({ err }, 'Error getting active trades');
      return reply.code(500).send({ error: err.message || 'Error fetching active trades' });
    }
  });

  // GET /api/auto-trade/pending-trades - Get pending trades requiring confirmation
  fastify.get('/pending-trades', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const pendingTrades = await firestoreAdapter.getPendingTrades(user.uid);
      // Ensure we always return an array, even if Firestore query fails or returns undefined
      return { pendingTrades: pendingTrades || [] };
    } catch (err: any) {
      // On any Firestore error (e.g., missing index), log and return empty list instead of 500
      logger.warn({ err }, 'Pending trades fetch failed – returning empty array');
      return { pendingTrades: [] };
    }
  });

  // POST /api/auto-trade/approve-trade - Approve and execute a pending trade
  fastify.post('/approve-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId } = request.body as any;

      if (!requestId) {
        return reply.code(400).send({ error: 'requestId is required' });
      }

      const execution = await autoTradeEngine.executeApprovedPendingTrade(user.uid, requestId);
      return {
        success: true,
        message: 'Trade approved and executed',
        execution,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error approving trade');
      return reply.code(500).send({ error: err.message || 'Error approving trade' });
    }
  });

  // POST /api/auto-trade/reject-trade - Reject a pending trade
  fastify.post('/reject-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { requestId: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { requestId } = request.body as any;

      if (!requestId) {
        return reply.code(400).send({ error: 'requestId is required' });
      }

      await autoTradeEngine.rejectPendingTrade(user.uid, requestId);
      return {
        success: true,
        message: 'Trade rejected',
      };
    } catch (err: any) {
      logger.error({ err }, 'Error rejecting trade');
      return reply.code(500).send({ error: err.message || 'Error rejecting trade' });
    }
  });
}
