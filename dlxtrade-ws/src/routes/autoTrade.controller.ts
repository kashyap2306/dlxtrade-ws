import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { autoTradeEngine } from '../services/autoTradeEngine';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

/**
 * Auto-Trade Controller Routes
 * Contains pure state toggle logic
 */
export async function controllerRoutes(fastify: FastifyInstance) {
  // POST /api/auto-trade/toggle - PURE STATE UPDATE
  fastify.post('/toggle', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user?.uid) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const body = (request.body as any);
      const enabled = body?.enabled;

      // Validate only: enabled is boolean
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled must be a boolean' });
      }

      // CRITICAL: Check exchange key validity BEFORE enabling auto-trade
      let exchangeKeysValid = true;
      let exchangeKeyError = null;

      if (enabled) {
          try {
          const db = getFirebaseAdmin().firestore();
          const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

          if (exchangeConfigDoc.exists) {
            const exchangeConfig = exchangeConfigDoc.data();
            const hasApiKey = !!exchangeConfig?.apiKeyEncrypted;
            const hasSecret = !!(exchangeConfig?.secretEncrypted || exchangeConfig?.secretKeyEncrypted);
            const hasEncryptedKeys = hasApiKey && hasSecret;

            if (hasEncryptedKeys) {
              // DEFENSIVE: If encrypted keys exist but status is INVALID_KEYS, clear it immediately
              if (exchangeConfig?.exchangeStatus === 'INVALID_KEYS') {
                await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').update({
                  exchangeStatus: admin.firestore.FieldValue.delete()
                }).catch(err => {
                  logger.debug({ uid: user.uid, error: err.message }, 'Failed to clear stale INVALID_KEYS status (non-critical)');
                });
              }

              // SUCCESS: Encrypted keys exist - treat as valid for auto-trade
            } else {
              exchangeKeysValid = false;
              exchangeKeyError = 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT';
            }
          } else {
            exchangeKeysValid = false;
            exchangeKeyError = 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT';
          }
        } catch (err: any) {
          logger.warn({ uid: user.uid, error: err.message }, 'Error checking exchange keys during auto-trade enable');
          exchangeKeysValid = false;
          exchangeKeyError = 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT';
        }
      }

      // BLOCK: Do not enable auto-trade if exchange keys are invalid
      if (enabled && !exchangeKeysValid) {
        return reply.code(400).send({
          ok: false,
          enabled: false,
          error: {
            type: 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT',
            message: 'Exchange API keys are invalid or corrupted. Please reconnect your exchange.'
          }
        });
      }

      // PURE STATE UPDATE: Update Firestore autoTradeEnabled flag only
      const db = getFirebaseAdmin().firestore();
      const configDocRef = db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current');

      await configDocRef.set({
        autoTradeEnabled: enabled,
        updatedAt: admin.firestore.Timestamp.now(),
        lastToggledAt: admin.firestore.Timestamp.now(),
      }, { merge: true });

      // HARD RETURN: Nothing below this line can execute
      return reply.send({
        ok: true,
        enabled,
        success: true
      });

    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Toggle endpoint error');
      return reply.code(500).send({
        ok: false,
        success: false,
        error: err.message || 'Failed to toggle auto-trade'
      });
    }
  });

  // POST /api/auto-trade/reset-circuit-breaker - Reset circuit breaker
  fastify.post('/reset-circuit-breaker', {
    preHandler: [fastify.authenticate],
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
