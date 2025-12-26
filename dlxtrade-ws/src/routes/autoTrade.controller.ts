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
        console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Starting exchange key validation for auto-trade enable`);

        try {
          const db = getFirebaseAdmin().firestore();
          const exchangeConfigDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

          console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Firestore doc exists: ${exchangeConfigDoc.exists}`);

          if (exchangeConfigDoc.exists) {
            const exchangeConfig = exchangeConfigDoc.data();
            console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Raw exchangeConfig:`, {
              exchange: exchangeConfig?.exchange,
              hasApiKeyEncrypted: !!exchangeConfig?.apiKeyEncrypted,
              apiKeyEncryptedLength: exchangeConfig?.apiKeyEncrypted?.length || 0,
              hasSecretEncrypted: !!exchangeConfig?.secretEncrypted,
              hasSecretKeyEncrypted: !!exchangeConfig?.secretKeyEncrypted,
              secretEncryptedLength: (exchangeConfig?.secretEncrypted || exchangeConfig?.secretKeyEncrypted)?.length || 0,
              hasPassphraseEncrypted: !!exchangeConfig?.passphraseEncrypted,
              passphraseEncryptedLength: exchangeConfig?.passphraseEncrypted?.length || 0,
              exchangeStatus: exchangeConfig?.exchangeStatus,
              testnet: exchangeConfig?.testnet,
              updatedAt: exchangeConfig?.updatedAt?.toDate?.()?.toISOString()
            });

            // CRITICAL: Log if exchangeStatus is INVALID_KEYS - this might be the root cause
            if (exchangeConfig?.exchangeStatus === 'INVALID_KEYS') {
              console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - ⚠️  WARNING: exchangeStatus is 'INVALID_KEYS' in Firestore!`);
              console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - This indicates previous decryption failure, but new keys were saved`);
              console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Exchange connect/save should clear this status, but apparently didn't`);
            }

            const hasEncryptedKeys = !!(exchangeConfig?.apiKeyEncrypted &&
                                       (exchangeConfig?.secretEncrypted || exchangeConfig?.secretKeyEncrypted));

            console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - hasEncryptedKeys: ${hasEncryptedKeys}`);

            if (hasEncryptedKeys) {
              // Test decryption - this will throw if keys are corrupted
              const { decryptOrThrow } = await import('../services/keyManager');

              console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Starting decryption validation`);

              try {
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Testing apiKey decryption...`);
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - apiKey encrypted length: ${exchangeConfig.apiKeyEncrypted?.length}`);
                decryptOrThrow(exchangeConfig.apiKeyEncrypted, 'apiKey');
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - apiKey decryption SUCCESS`);

                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Testing secretKey decryption...`);
                const secretKeyField = exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted;
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - secretKey encrypted length: ${secretKeyField?.length}`);
                decryptOrThrow(secretKeyField, 'secretKey');
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - secretKey decryption SUCCESS`);

                if (exchangeConfig.passphraseEncrypted) {
                  console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Testing passphrase decryption...`);
                  console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - passphrase encrypted length: ${exchangeConfig.passphraseEncrypted?.length}`);
                  decryptOrThrow(exchangeConfig.passphraseEncrypted, 'passphrase');
                  console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - passphrase decryption SUCCESS`);
                } else {
                  console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - No passphrase to test`);
                }

                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - ALL decryption tests PASSED`);

              } catch (decryptErr: any) {
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - DECRYPTION FAILED at line ${new Error().stack?.split('\n')[2]?.match(/:(\d+):/)?.[1]}: ${decryptErr.message}`);
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Full error stack:`, decryptErr.stack);
                console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Setting exchangeKeysValid = false`);
                exchangeKeysValid = false;
                exchangeKeyError = decryptErr.message;
                logger.warn({ uid: user.uid, error: decryptErr.message }, 'Exchange key decryption failed during auto-trade enable');
              }
            } else {
              console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - CONDITION: hasEncryptedKeys = false, marking INVALID`);
              exchangeKeysValid = false;
              exchangeKeyError = 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT';
            }
          } else {
            console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - CONDITION: exchangeConfigDoc does not exist, marking INVALID`);
            exchangeKeysValid = false;
            exchangeKeyError = 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT';
          }
        } catch (err: any) {
          console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - EXCEPTION during validation: ${err.message}`);
          logger.warn({ uid: user.uid, error: err.message }, 'Error checking exchange keys during auto-trade enable');
          exchangeKeysValid = false;
          exchangeKeyError = 'EXCHANGE_KEYS_INVALID_OR_REQUIRES_RECONNECT';
        }

        console.log(`[DEBUG_AUTO_TRADE_TOGGLE] UID:${user.uid} - Final validation result: exchangeKeysValid = ${exchangeKeysValid}, error = ${exchangeKeyError}`);
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
