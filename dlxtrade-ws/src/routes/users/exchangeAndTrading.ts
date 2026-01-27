import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter, isExchangeUsable } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../../services/keyManager';
import { routeEntryLog, routeExitLog, firestoreReadWithTimeout } from '../../utils/routeGuards';

export async function exchangeAndTradingRoutes(fastify: FastifyInstance) {
  // GET /api/users/:uid/exchange-config - Get exchange configuration
  fastify.get('/:uid/exchange-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      // Use SANITIZED exchange config - prevents INVALID_KEYS from reaching UI
      const data = await firestoreAdapter.getExchangeConfig(targetUid);

      if (!data) {
        return reply.send({ accounts: [] });
      }

      return reply.send({
        accounts: [{
          exchange: data.exchange,
          apiKey: data.apiKeyEncrypted ? '[ENCRYPTED]' : '',
          secret: (data.secretKeyEncrypted || data.secretEncrypted) ? '[ENCRYPTED]' : '',
          passphrase: data.passphraseEncrypted ? '[ENCRYPTED]' : '',
          testnet: data.testnet ?? true
        }]
      });
    } catch (err: any) {
      logger.error({ err }, 'Error getting exchange config');
      return reply.code(500).send({ error: 'Failed to get exchange config' });
    }
  });

  // GET /api/users/:uid/exchangeConfig/current - Get current exchange configuration (matches frontend expectation)
  // CRITICAL: This route must respond in < 500ms - uses fail-fast guards
  fastify.get('/:uid/exchangeConfig/current', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    // CRITICAL: This MUST log immediately - if not, request never reached route
    console.log("[ROUTE_HIT] /exchangeConfig/current PID:", process.pid, "at", Date.now());
    const startTime = routeEntryLog('GET /exchangeConfig/current');

    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      // If authentication missing, return deterministic disconnected object
      if (!authUid) {
        console.warn('[GET_EXCHANGE_CONFIG] No authUid, returning disconnected');
        routeExitLog('GET /exchangeConfig/current', startTime);
        return reply.send({ connected: false });
      }

      // Determine admin status safely with timeout
      let isAdmin = false;
      try {
        isAdmin = await firestoreReadWithTimeout(
          () => firestoreAdapter.isAdmin(authUid),
          false,
          'isAdmin-check'
        );
      } catch (err: any) {
        console.error('[GET_EXCHANGE_CONFIG_ERROR] isAdmin check failed:', err);
      }

      // Authorization check – only own config or admin
      if (paramUid !== authUid && !isAdmin) {
        console.warn('[GET_EXCHANGE_CONFIG] Unauthorized access attempt');
        routeExitLog('GET /exchangeConfig/current', startTime);
        return reply.send({ connected: false });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      // Use sanitized exchange config and proper usability check
      console.log('[EXCHANGE_CONFIG_READ] Using sanitized getExchangeConfig + isExchangeUsable');

      // First, read raw Firestore data to verify what's stored
      const rawDoc = await firestoreReadWithTimeout(
        async () => {
          const db = getFirebaseAdmin().firestore();
          return await db.collection('users').doc(targetUid).collection('exchangeConfig').doc('current').get();
        },
        null,
        'exchangeConfig-raw-read'
      );
      const rawData = rawDoc?.exists ? rawDoc.data() : null;
      console.log('[EXCHANGE_CONFIG_RAW] Raw Firestore data:', JSON.stringify(rawData, null, 2));
      console.log('[EXCHANGE_CONFIG_RAW] Raw exchange field:', rawData?.exchange);

      // Get sanitized exchange config (handles legacy INVALID_KEYS)
      const sanitizedConfig = await firestoreAdapter.getExchangeConfig(targetUid);
      console.log('[EXCHANGE_CONFIG_SANITIZED] Sanitized data:', JSON.stringify(sanitizedConfig, null, 2));
      console.log('[EXCHANGE_CONFIG_SANITIZED] Sanitized exchange field:', sanitizedConfig?.exchange);

      // Use isExchangeUsable with user_request context to properly determine connected status
      const usabilityResult = await isExchangeUsable(targetUid, "user_request");
      console.log('[EXCHANGE_CONFIG_USABILITY] isExchangeUsable result:', usabilityResult);

      const responsePayload = {
        exchange: sanitizedConfig?.exchange || null,
        apiKeyEncrypted: !!sanitizedConfig?.apiKeyEncrypted,
        secretKeyEncrypted: !!(sanitizedConfig?.secretKeyEncrypted || sanitizedConfig?.secretEncrypted),
        passphraseEncrypted: !!sanitizedConfig?.passphraseEncrypted,
        connected: usabilityResult.usable,
        disconnected: sanitizedConfig?.disconnected === true, // CRITICAL: Include disconnected flag for UI
        // Include corruption status for UI handling
        corrupted: sanitizedConfig?.exchangeStatus === 'CORRUPTED',
        corruptedReason: sanitizedConfig?.corruptedReason,
      };

      routeExitLog('GET /exchangeConfig/current', startTime);
      return reply.send(responsePayload);
    } catch (err: any) {
      console.error('[GET_EXCHANGE_CONFIG_ERROR] Unexpected error:', err.message);
      routeExitLog('GET /exchangeConfig/current (error)', startTime);
      return reply.send({ connected: false });
    }
  });



  // GET /api/users/:uid/trading-config - Get trading configuration
  fastify.get('/:uid/trading-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;

      if (!authUid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('trading-config').doc(targetUid).get();

      const data = doc.exists ? doc.data() : null;
      return reply.send({ ok: true, config: data });
    } catch (err: any) {
      logger.error({ err }, 'Failed to load trading-config');
      return reply.code(500).send({ error: 'Failed to load trading config' });
    }
  });
}