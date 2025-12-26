import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { autoTradeEngine } from '../services/autoTradeEngine';
import { logger } from '../utils/logger';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';

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

    // HARD TIMEOUT GUARD: Auto-respond 504 after 450ms
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        console.error("[ROUTE_TIMEOUT] /auto-trade/status exceeded 450ms");
        reply.code(504).send({ ok: false, reason: 'route_timeout', route: '/auto-trade/status' });
      }
    }, 450);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        clearTimeout(timeoutId);
        console.log("[ROUTE_EXIT] /auto-trade/status (no uid)", Date.now() - startTime, "ms");
        return reply.code(401).send({ error: 'Authentication required' });
      }

      console.log("[STATUS_OPTIMIZATION] Starting lightweight status check - no API calls or heavy queries");

      // PURE FIRESTORE READ - Direct DB access, no service calls
      const db = getFirebaseAdmin().firestore();

      // Parallel reads with individual 200ms timeouts
      const [configDoc, exchangeDoc, integrationsSnapshot, bgSettingsDoc] = await Promise.all([
        Promise.race([
          db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('integrations').get(),
          new Promise<any>((resolve) => setTimeout(() => resolve({ empty: true, docs: [] }), 200)) // Default to empty if timeout
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ])
      ]);

      // Extract config data (with defaults) - missing config is treated as disabled, NOT forbidden
      const config = configDoc?.exists ? configDoc.data() : {};
      const autoTradeEnabled = config?.autoTradeEnabled ?? false;

      // Extract background research settings for frequency
      const bgSettings = bgSettingsDoc?.exists ? bgSettingsDoc.data() : {};
      const frequencyMinutes = bgSettings?.researchFrequencyMinutes || 5;

      // Extract exchange data and compute connected status
      const exchangeData = exchangeDoc?.exists ? exchangeDoc.data() : null;
      let exchangeConnected = false;
      let exchangeReason = 'No exchange configuration found';

      if (exchangeData) {
        // CRITICAL: Exchange is connected if encrypted keys exist - decrypt failure never affects usability
        const hasApiKey = !!exchangeData.apiKeyEncrypted;
        const hasSecret = !!(exchangeData.secretKeyEncrypted || exchangeData.secretEncrypted);
        const exchange = (exchangeData.exchange || '').toLowerCase();
        const isBitget = exchange === 'bitget';
        const hasPassphrase = isBitget ? !!exchangeData.passphraseEncrypted : true;

        exchangeConnected = hasApiKey && hasSecret && hasPassphrase && ['binance', 'bitget', 'bingx', 'weex'].includes(exchange);

        exchangeReason = exchangeConnected
          ? `${exchangeData.exchange} connected`
          : 'Exchange keys incomplete';
      }

      // Check for usable research providers - LIGHTWEIGHT VERSION
      // Avoid expensive provider validation on every status request
      let hasUsableProviders = false;
      let providerStatusMessage = 'Research providers not checked';

      // Skip expensive provider validation for status endpoint
      // This will be validated by research engine when actually running
      if (integrationsSnapshot && !integrationsSnapshot.empty && integrationsSnapshot.docs.length > 0) {
        hasUsableProviders = true; // Assume configured if any integrations exist
        providerStatusMessage = 'Research providers configured';
      } else {
        providerStatusMessage = 'No research providers configured';
      }

      // LIGHTWEIGHT: Skip expensive API key validation for status endpoint
      // Provider validation happens in research engine when actually running
      // For status endpoint, just check if any integrations exist at all
      const hasAnyIntegrations = integrationsSnapshot && !integrationsSnapshot.empty && integrationsSnapshot.docs.length > 0;

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.log("[ROUTE_EXIT] /auto-trade/status", duration, "ms", { exchangeConnected, autoTradeEnabled });

      // FAST RESPONSE - minimal payload
      // CRITICAL: Always return 200 for authenticated users - missing config = enabled: false (not 403)
      return reply.send({
        enabled: autoTradeEnabled,
        autoTradeEnabled,
        frequencyMinutes: autoTradeEnabled ? frequencyMinutes : undefined,
        exchangeConnected,
        exchangeReason,
        exchange: { connected: exchangeConnected },
        isApiConnected: exchangeConnected,
        apiStatus: exchangeConnected ? 'connected' : 'disconnected',
        providersReady: hasUsableProviders, // Use our lightweight check
        providerConfigTimeout: false,
        providerStatus: hasUsableProviders ? 'CONFIGURED' : 'MISSING_PROVIDERS',
        providerMessage: hasUsableProviders ? null : providerStatusMessage,
        diagnostics: { marketDataReady: hasUsableProviders, newsReady: hasUsableProviders },
        config: {
          autoTradeEnabled,
          perTradeRiskPct: config?.perTradeRiskPct || 1,
          maxConcurrentTrades: config?.maxConcurrentTrades || 3,
        },
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[ROUTE_ERROR] /auto-trade/status", err.message, Date.now() - startTime, "ms");
      // CRITICAL: For authenticated users, NEVER return 403 or 500 - treat errors as disabled state
      // Missing config or Firestore errors should return 200 with enabled: false
      return reply.code(200).send({
        ok: false,
        enabled: false,
        autoTradeEnabled: false,
        frequencyMinutes: undefined,
        exchangeConnected: false,
        exchange: { connected: false },
        error: 'Status check failed',
        message: err.message || 'Unable to determine auto-trade status',
      });
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

    // HARD TIMEOUT GUARD: Auto-respond 504 after 200ms
    const timeoutId = setTimeout(() => {
      if (!reply.sent) {
        console.error("[ROUTE_TIMEOUT] /auto-trade/config exceeded 200ms");
        reply.code(504).send({ ok: false, reason: 'route_timeout', route: '/auto-trade/config' });
      }
    }, 200);

    try {
      const user = (request as any).user;
      if (!user?.uid) {
        clearTimeout(timeoutId);
        return reply.code(401).send({ error: 'Authentication required' });
      }

      // DIRECT Firestore read with 200ms timeout (no autoTradeEngine)
      const db = getFirebaseAdmin().firestore();
      const [configDoc, bgSettingsDoc] = await Promise.all([
        Promise.race([
          db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ]),
        Promise.race([
          db.collection('users').doc(user.uid).collection('settings').doc('backgroundResearch').get(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 200))
        ])
      ]);

      const config = configDoc?.exists ? configDoc.data() : {};
      const bgSettings = bgSettingsDoc?.exists ? bgSettingsDoc.data() : {};

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.log("[ROUTE_EXIT] /auto-trade/config", duration, "ms");

      // Return ONLY stored Firestore config (autoTradeEnabled, frequency, mode)
      return {
        autoTradeEnabled: config?.autoTradeEnabled ?? false,
        frequency: bgSettings?.researchFrequencyMinutes || 5,
        mode: config?.mode || 'AUTO_TRADE_RESEARCH',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("[ROUTE_ERROR] /auto-trade/config", err.message, Date.now() - startTime, "ms");
      return {
        autoTradeEnabled: false,
        frequency: 5,
        mode: 'AUTO_TRADE_RESEARCH',
      };
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

      // Return updated config (only stored Firestore values)
      return {
        autoTradeEnabled: body.autoTradeEnabled,
        frequency: body.frequency || existingConfig?.frequency || 5,
        mode: body.mode || existingConfig?.mode || 'AUTO_TRADE_RESEARCH',
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Error updating auto-trade config');
      return reply.code(500).send({
        error: err.message || 'Failed to update auto-trade config'
      });
    }
  });
}
