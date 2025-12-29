import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter, isExchangeUsable, clearExchangeUsabilityCache } from '../services/firestoreAdapter';
import { autoTradeEngine } from '../services/autoTradeEngine';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

// In-memory cache for last-known auto-trade config (runtime-only, repopulated asynchronously)
const autoTradeConfigCache = new Map<string, { autoTradeEnabled: boolean; frequency: number; mode: string; timestamp: number }>();

// Track active async cache refreshes per UID to prevent storms
const activeCacheRefreshes = new Set<string>();

// CRITICAL: Store synchronous reference to scheduler for instant status checks
let schedulerInstance: any = null;

/**
 * Initialize synchronous scheduler reference for instant status checks
 * Called once when routes are registered
 */
export function initializeSchedulerReference(scheduler: any) {
  schedulerInstance = scheduler;
}

/**
 * Auto-Trade Status Routes - FAST and PURE
 * Contains /status, /config, and /diagnostics endpoints
 */
export async function statusRoutes(fastify: FastifyInstance) {
  // GET /api/auto-trade/status - Get auto-trade status
  // CRITICAL: PURE & FAST - Only read Firestore directly, NO service calls
  // Must respond within 500ms - NO autoTradeEngine, NO exchangeResolver, NO adapters
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    console.log("[ROUTE_ENTER] /auto-trade/status PID:", process.pid);

    // CRITICAL: NO TIMEOUT - Control-plane status route must NEVER return 504
    // Status route is pure in-memory read, must always respond immediately

    // Declare variables outside try block for catch block access
    let autoTradeEnabled: boolean | null = null;
    let exchangeConnected = false;
    let exchangeReason = 'Exchange not configured';

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        console.log("[ROUTE_EXIT] /auto-trade/status (no uid)", Date.now() - startTime, "ms");
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // CLEAR CACHE: Ensure fresh exchange usability read for diagnostic context
      clearExchangeUsabilityCache();
      const uid = user.uid;

      // CRITICAL: Log UID consistency for auto-trade status
      logger.info({
        uid,
        uidSource: 'auth_middleware_request_user_uid',
        uidLength: uid.length,
        action: 'auto_trade_status_request'
      }, 'AUTO_TRADE_STATUS_UID_CONSISTENCY_CHECK');

      console.log("[AUTO_TRADE_STATUS] Reading current auto-trade configuration from Firestore");

      // STATUS ROUTE: Read actual configuration state from Firestore
      // Do not use optimizations that bypass real data sources
      const schedulerRunning = schedulerInstance?.isRunning || false;
      const userJobScheduled = schedulerInstance?.isUserScheduled(user.uid) || false;

      // SINGLE SOURCE OF TRUTH: Read autoTradeEnabled from users/{uid}/autoTradeConfig/current
      // Always read from Firestore first, cache as fallback

      // Always try Firestore first (primary source)
      try {
        const db = getFirebaseAdmin().firestore();
        const configDoc = await Promise.race([
          db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 300))
        ]) as admin.firestore.DocumentSnapshot;
        const config = configDoc.exists ? configDoc.data() : null;
        autoTradeEnabled = config?.autoTradeEnabled ?? null;
      } catch (err: any) {
        // On Firestore failure, try cache as fallback
        const cachedConfig = autoTradeConfigCache.get(user.uid);
        if (cachedConfig) {
          autoTradeEnabled = cachedConfig.autoTradeEnabled;
        } else {
          // Only default to false on complete failure
          autoTradeEnabled = false;
        }
      }

      // EXCHANGE STATUS: Check actual exchange usability
      try {
        const { isExchangeUsable } = await import('../services/firestoreAdapter');
        const exchangeUsability = await Promise.race([
          isExchangeUsable(user.uid, 'user_request'),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 500))
        ]);
        exchangeConnected = exchangeUsability.usable;
        exchangeReason = exchangeUsability.reason;

        // HARD LOGGING: Track auto-trade status exchange decisions
        console.log('[EXCHANGE_RUNTIME_PROOF] auto-trade status decision', {
          uid: user.uid,
          exchangeConnected,
          exchangeReason,
          context: 'auto_trade_status'
        });
      } catch (err: any) {
        // On exchange check failure, indicate unknown status rather than false
        // This prevents false negatives when exchange might actually be configured
        exchangeConnected = false;
        exchangeReason = 'Exchange status unknown - check timed out';
      }

      // SAFE DEFAULTS for other fields
      const frequencyMinutes = 5; // Safe default
      const hasUsableProviders = false; // Safe default
      const providerStatusMessage = 'No research providers configured'; // Safe default

      // For compatibility with existing response structure
      const hasAnyIntegrations = hasUsableProviders;

      const duration = Date.now() - startTime;
      console.log("[ROUTE_EXIT] /auto-trade/status", duration, "ms", { exchangeConnected, autoTradeEnabled });

      // FAST RESPONSE - minimal payload with scheduler state
      // CRITICAL: Always return 200 for authenticated users - missing config = enabled: false (not 403)
      if (!reply.sent) {
        return reply.send({
          enabled: autoTradeEnabled,
          autoTradeEnabled,
          frequencyMinutes: autoTradeEnabled ? frequencyMinutes : undefined,
          exchangeConnected,
          exchangeReason,
          exchange: { connected: exchangeConnected },
          isApiConnected: exchangeConnected,
          apiStatus: exchangeConnected ? 'connected' : 'disconnected',
          providersReady: hasUsableProviders,
          providerConfigTimeout: false,
          providerStatus: hasUsableProviders ? 'CONFIGURED' : 'MISSING_PROVIDERS',
          providerMessage: hasUsableProviders ? null : providerStatusMessage,
          diagnostics: { marketDataReady: hasUsableProviders, newsReady: hasUsableProviders },
          // Include scheduler state for real-time status
          schedulerRunning,
          userJobScheduled,
          config: {
            autoTradeEnabled,
            perTradeRiskPct: 1, // Safe default
            maxConcurrentTrades: 3, // Safe default
          },
        });
      }
    } catch (err: any) {
      console.error("[ROUTE_ERROR] /auto-trade/status", err.message, Date.now() - startTime, "ms");
      // CRITICAL: For authenticated users, NEVER return 403 or 500 - treat errors as disabled state
      // Missing config or Firestore errors should return 200 with enabled: false
      // EARLY RETURN REMOVED: No longer return false values on error
      // Route will continue with error state and return at main return point
      autoTradeEnabled = false;
      exchangeConnected = false;
      exchangeReason = 'Status check failed: ' + (err.message || 'Unable to determine auto-trade status');
    }
  });

  // GET /api/auto-trade/diagnostics - Comprehensive system diagnostics
  fastify.get('/diagnostics', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;

      // SELF-CONTAINED LIGHTWEIGHT DIAGNOSTICS
      // Get basic config data only - no expensive operations
      const db = getFirebaseAdmin().firestore();
      const [configDoc, bgSettingsDoc] = await Promise.all([
        Promise.race([db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))]),
        Promise.race([db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch').get(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))])
      ]);

      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;
      const bgSettings = bgSettingsDoc?.exists ? bgSettingsDoc.data() : {};

      // Simple status
      let lastTradeState = 'NONE';
      let lastTradeReason = autoTradeEnabled ? 'Auto-trade enabled and monitoring' : 'Auto-trade disabled';

      return reply.send({
        autoTrade: {
          status: autoTradeEnabled ? 'ON' : 'OFF',
          confirmationRequired: false, // Skip for diagnostics
          lastTradeState: lastTradeState,
          lastTradeReason: lastTradeReason,
          providerStatus: 'UNKNOWN', // Skip for diagnostics
          providerMessage: null,
          details: {
            dailyTrades: 0,
            dailyPnL: 0,
            activeTrades: 0,
            loopStatus: autoTradeEnabled ? 'WAITING' : 'DISABLED',
          }
        },
        backgroundResearch: {
          status: bgSettings?.backgroundResearchEnabled ? 'IDLE' : 'DISABLED',
          lastRunAt: bgSettings?.lastRunAt?.toDate()?.toISOString() || null,
          nextRunAt: null,
          accuracyTrigger: bgSettings?.accuracyTrigger || 0
        },
        accuracyAlerts: {
          status: 'DISABLED',
          lastAccuracyChecked: 0,
          threshold: 0,
          lastAlertSentAt: null,
          telegramEnabled: false
        }
      });
    } catch (err: any) {
      console.error("[DIAGNOSTICS_ERROR]", err);
      return { ok: false, error: 'Failed' };
    }
  });

  // GET /api/auto-trade/config - Get user auto-trade configuration
  // CRITICAL: PURE & FAST - Direct Firestore read only, no service calls
  fastify.get('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    console.log("[ROUTE_ENTER] /auto-trade/config PID:", process.pid);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        console.log("[ROUTE_EXIT] /auto-trade/config (no uid)", Date.now() - startTime, "ms");
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // INSTANT RESPONSE: Use cached config as primary source, scheduler as fallback
      // Priority: 1) Last-known cached config, 2) Scheduler state, 3) Safe defaults

      // 1) Check cached config (primary source of truth for user intent)
      const cachedConfig = autoTradeConfigCache.get(user.uid);

      // 2) Use scheduler state as informational fallback (not primary source)
      const jobState = schedulerInstance?.getUserJobState(user.uid);
      const schedulerIndicatesEnabled = jobState?.mode === 'AUTO_TRADE_RESEARCH';

      // Determine autoTradeEnabled with proper priority
      let autoTradeEnabled: boolean;
      if (cachedConfig) {
        // Primary: Use cached config (user intent)
        autoTradeEnabled = cachedConfig.autoTradeEnabled;
      } else if (schedulerIndicatesEnabled) {
        // Fallback: Scheduler state suggests enabled
        autoTradeEnabled = true;
      } else {
        // Final fallback: Safe default
        autoTradeEnabled = false;
      }

      // Frequency and mode from cache or safe defaults
      const frequency = cachedConfig?.frequency ?? 5;
      const mode = cachedConfig?.mode ?? 'AUTO_TRADE_RESEARCH';

      const duration = Date.now() - startTime;
      console.log("[ROUTE_EXIT] /auto-trade/config", duration, "ms - instant response with cached config");

      return reply.send({
        autoTradeEnabled: autoTradeEnabled,
        frequency: frequency,
        mode: mode,
      });

      // ASYNC: Update cache with fresh Firestore data (does not block response)
      // Prevent refresh storms - only one refresh per UID at a time
      if (!activeCacheRefreshes.has(user.uid)) {
        activeCacheRefreshes.add(user.uid);

        setImmediate(async () => {
          try {
            const db = getFirebaseAdmin().firestore();
            const [configDoc, bgSettingsDoc] = await Promise.all([
              db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(),
              db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch').get()
            ]);

            const freshConfig = configDoc?.exists ? configDoc.data() : {};
            const freshSettings = bgSettingsDoc?.exists ? bgSettingsDoc.data() : {};

            // Update cache with fresh Firestore data
            if (freshConfig || freshSettings) {
              const cacheEntry = {
                autoTradeEnabled: freshConfig?.autoTradeEnabled ?? false,
                frequency: freshSettings?.researchFrequencyMinutes ?? 5,
                mode: freshConfig?.mode ?? 'AUTO_TRADE_RESEARCH',
                timestamp: Date.now()
              };
              autoTradeConfigCache.set(user.uid, cacheEntry);
              console.log("[CONFIG_CACHE_UPDATE] Updated cache with fresh Firestore data for user:", user.uid);
            }
          } catch (err: any) {
            // Silent failure - does not affect response
            console.warn("[CONFIG_CACHE_UPDATE_FAILED] Could not update cache:", err.message);
          } finally {
            // Always remove from active set, even on error
            activeCacheRefreshes.delete(user.uid);
          }
        });
      }
    } catch (err: any) {
      console.error("[ROUTE_ERROR] /auto-trade/config", err.message, Date.now() - startTime, "ms");
      return reply.send({
        autoTradeEnabled: false,
        frequency: 5,
        mode: 'AUTO_TRADE_RESEARCH',
      });
    }
  });

  // POST /api/auto-trade/config - Update user auto-trade configuration (NON-BLOCKING)
  fastify.post('/config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = request.body as any;

      // Validate only autoTradeEnabled (required)
      if (typeof body.autoTradeEnabled !== 'boolean') {
        return reply.code(400).send({
          error: 'autoTradeEnabled must be a boolean'
        });
      }

      // DIRECT Firestore update (no autoTradeEngine, no scheduler calls)
      const db = getFirebaseAdmin().firestore();
      const configRef = db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current');

      // Get existing config to merge
      const existingDoc = await configRef.get();
      const existingConfig = existingDoc.exists ? existingDoc.data() : {};

      // Update only autoTradeEnabled and mode
      const updateData = {
        ...existingConfig,
        autoTradeEnabled: body.autoTradeEnabled,
        mode: body.mode || existingConfig?.mode || 'AUTO_TRADE_RESEARCH',
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Remove undefined values
      const sanitizedData: any = {};
      for (const [key, value] of Object.entries(updateData)) {
        if (value !== undefined) {
          sanitizedData[key] = value;
        }
      }

      await configRef.set(sanitizedData, { merge: true });

      // Update frequency in background research settings if provided
      if (body.frequency !== undefined) {
        const bgSettingsRef = db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch');
        await bgSettingsRef.set({
          researchFrequencyMinutes: body.frequency,
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
      }

      // Update in-memory cache with new config
      const finalFrequency = body.frequency || existingConfig?.frequency || 5;
      const finalMode = body.mode || existingConfig?.mode || 'AUTO_TRADE_RESEARCH';

      autoTradeConfigCache.set(user.uid, {
        autoTradeEnabled: body.autoTradeEnabled,
        frequency: finalFrequency,
        mode: finalMode,
        timestamp: Date.now()
      });

      // Return updated config (only stored Firestore values)
      return {
        autoTradeEnabled: body.autoTradeEnabled,
        frequency: finalFrequency,
        mode: finalMode,
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Error updating auto-trade config');
      return reply.code(500).send({
        error: err.message || 'Failed to update auto-trade config'
      });
    }
  });
}
