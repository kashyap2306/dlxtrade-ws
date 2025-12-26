import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { autoTradeEngine } from '../services/autoTradeEngine';
import { backgroundResearchScheduler } from '../services/backgroundResearchScheduler';
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

      // CRITICAL: Log UID consistency for auto-trade toggle
      logger.info({
        uid: user.uid,
        uidSource: 'auth_middleware_request_user_uid',
        uidLength: user.uid.length,
        toggleAction: 'auto_trade_toggle_attempt'
      }, 'AUTO_TRADE_TOGGLE_UID_CONSISTENCY_CHECK');

      const body = (request.body as any);
      const enabled = body?.enabled;

      // Validate only: enabled is boolean
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled must be a boolean' });
      }

      // CRITICAL: Check exchange key validity BEFORE enabling auto-trade using unified logic
      let exchangeKeysValid = true;
      let exchangeKeyError = null;

      if (enabled) {
        try {
          // Use unified isExchangeUsable() for consistent validation
          const { isExchangeUsable } = await import('../services/firestoreAdapter');
          const usability = await isExchangeUsable(user.uid);

          if (!usability.usable) {
            exchangeKeysValid = false;
            exchangeKeyError = usability.reason;

            // Log detailed exchange config status for debugging
            logger.warn({
              uid: user.uid,
              exchange: usability.exchange,
              reason: usability.reason,
              toggleBlocked: true
            }, 'AUTO_TRADE_TOGGLE_BLOCKED_EXCHANGE_NOT_USABLE');
          } else {
            // Log successful validation
            logger.info({
              uid: user.uid,
              exchange: usability.exchange,
              reason: usability.reason,
              toggleAllowed: true
            }, 'AUTO_TRADE_TOGGLE_ALLOWED_EXCHANGE_USABLE');
          }
        } catch (err: any) {
          exchangeKeysValid = false;
          exchangeKeyError = `Exchange validation error: ${err.message}`;

          logger.error({
            uid: user.uid,
            error: err.message,
            toggleBlocked: true
          }, 'AUTO_TRADE_TOGGLE_BLOCKED_EXCHANGE_VALIDATION_ERROR');
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

      // CRITICAL: Update cached flags for control-plane routes (background process)
      try {
        const { updateCachedFlags } = await import('../services/firestoreAdapter');
        await updateCachedFlags(user.uid);
      } catch (flagError: any) {
        logger.warn({
          uid: user.uid,
          error: flagError.message
        }, '⚠️ [AUTO_TRADE_TOGGLE] Failed to update cached flags');
      }

      // CRITICAL: Bind auto-trade toggle to scheduler registration
      try {
        if (enabled) {
          // Register user with scheduler when auto-trade is enabled
          logger.info({ uid: user.uid }, '🔗 [AUTO_TRADE_TOGGLE] Registering user with scheduler');
          const scheduleResult = await backgroundResearchScheduler.ensureUserResearchScheduled(user.uid);
          if (!scheduleResult.scheduled) {
            logger.warn({
              uid: user.uid,
              reason: scheduleResult.reason
            }, '⚠️ [AUTO_TRADE_TOGGLE] Failed to register user with scheduler');
          }
        } else {
          // Unregister user from scheduler when auto-trade is disabled
          logger.info({ uid: user.uid }, '🔗 [AUTO_TRADE_TOGGLE] Unregistering user from scheduler');
          await backgroundResearchScheduler.onUserSettingsChanged(user.uid);
        }
      } catch (schedulerErr: any) {
        logger.error({
          uid: user.uid,
          error: schedulerErr.message,
          enabled
        }, '❌ [AUTO_TRADE_TOGGLE] Scheduler binding failed - auto-trade state updated but scheduler may be out of sync');
        // Don't fail the toggle request - state is updated, just log the scheduler error
      }

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
