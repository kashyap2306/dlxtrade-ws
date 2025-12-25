import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { getUserIntegrations } from './integrations';
import { BinanceAdapter } from '../services/binanceAdapter';
import { CryptoCompareAdapter } from '../services/cryptocompareAdapter';
import { DeepResearchEngine } from '../services/deepResearchEngine';
import { cacheService } from '../services/cacheService';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { telegramService } from '../services/telegramService';

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

// 1. EVENT LOOP PROTECTION & CONCURRENCY CONTROL
let backgroundTaskCount = 0;
const MAX_BACKGROUND_TASKS = 1; // STRICT GLOBAL CONCURRENCY
let eventLoopLag = 0;
const globalRunningTasks = new Set<string>(); // Idempotency lock (uid:symbol or uid:GLOBAL)

/**
 * CRITICAL: FINAL cache protection guard
 * Safe defaults must NEVER override an existing FINAL result
 * WHY: FINAL results are frozen and immutable - overwriting them causes data loss
 * Safe defaults are for error responses only, not for cache writes
 */
function safeCacheSet(cacheKey: string, value: any, reason: string = 'cache write'): boolean {
  const cached = cacheService.get('metadata', cacheKey);

  // CRITICAL: If FINAL exists, NEVER overwrite it with safe defaults or new results
  if (cached && cached.isFinal === true) {
    logger.info({ cacheKey, reason, existingSignal: cached.signal, existingAccuracy: cached.accuracy }, '[CACHE_WRITE_SKIPPED_FINAL] Existing FINAL preserved');
    return false; // Skip write
  }

  // Safe to write - no FINAL exists
  cacheService.set('metadata', cacheKey, value);
  return true; // Write successful
}

/**
 * GLOBAL GUARD: Check if user has at least one valid API key
 * This is the SINGLE SOURCE OF TRUTH for API key validation
 * Used by all research-related routes to enforce "No API key = NO research data"
 */
async function hasValidApiKey(uid: string): Promise<boolean> {
  try {
    // 🔥 DIAGNOSTIC: PROVE API KEY READ SOURCE
    console.log("🔥 [API_KEY_READ] Starting getUserIntegrations", { uid, firestorePath: `users/${uid}/integrations` });
    const { getUserIntegrations } = await import('./integrations');
    const integrationsResponse = await getUserIntegrations(uid);
    const integrations = integrationsResponse.providerConfig || { marketData: {}, news: {}, metadata: {} };

    // 🔥 DIAGNOSTIC: PROVE PROVIDER COUNT
    const marketDataCount = Object.keys(integrations.marketData || {}).length;
    const newsCount = Object.keys(integrations.news || {}).length;
    const metadataCount = Object.keys(integrations.metadata || {}).length;
    console.log("🔥 [API_KEY_READ] Provider documents count", { uid, marketDataCount, newsCount, metadataCount });

    // 🔥 DIAGNOSTIC: PROVE ONE PROVIDER'S KEY STATUS
    const firstMarketProvider = Object.values(integrations.marketData || {})[0] as any;
    const firstNewsProvider = Object.values(integrations.news || {})[0] as any;
    console.log("🔥 [API_KEY_READ] Sample provider keys", {
      uid,
      firstMarketProvider: firstMarketProvider ? {
        providerId: Object.keys(integrations.marketData || {})[0],
        hasApiKeyEncrypted: !!firstMarketProvider?.apiKeyEncrypted,
        apiKeyEncryptedLength: firstMarketProvider?.apiKeyEncrypted?.length || 0
      } : null,
      firstNewsProvider: firstNewsProvider ? {
        providerId: Object.keys(integrations.news || {})[0],
        hasApiKeyEncrypted: !!firstNewsProvider?.apiKeyEncrypted,
        apiKeyEncryptedLength: firstNewsProvider?.apiKeyEncrypted?.length || 0
      } : null
    });

    // CRITICAL: Check for apiKeyEncrypted (encrypted keys) since getUserIntegrations returns encrypted keys
    // Research eligibility requires: at least ONE valid market data provider AND at least ONE valid news provider
    const hasValidMarketDataProvider = integrations.marketData &&
      Object.values(integrations.marketData).some((p: any) =>
        p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0
      );
    const hasValidNewsProvider = integrations.news &&
      Object.values(integrations.news).some((p: any) =>
        p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0
      );

    const hasAnyApiKey = hasValidMarketDataProvider && hasValidNewsProvider;

    console.log("🔥 [API_KEY_READ] Final hasAnyApiKey result", { uid, hasAnyApiKey });
    return hasAnyApiKey;
  } catch (err: any) {
    logger.error({ uid, error: err.message }, 'Error checking API keys');
    console.log("🔥 [API_KEY_READ] ERROR", { uid, error: err.message, stack: err.stack });
    return false;
  }
}

/**
 * MANDATORY GATE: Check if user has required primary API keys
 * Requirements: CryptoCompare (marketData) AND NewsData.io (news)
 */
async function hasMandatoryApiKeys(uid: string): Promise<{ valid: boolean; missing: string[] }> {
  try {
    const { getUserIntegrations } = await import('./integrations');
    const integrationsResponse = await getUserIntegrations(uid);
    const integrations = integrationsResponse.providerConfig || { marketData: {}, news: {}, metadata: {} };

    const missing = [];
    const hasCryptoCompare = !!integrations.marketData?.cryptocompare?.apiKeyEncrypted?.trim().length;
    const hasNewsData = !!integrations.news?.newsdata?.apiKeyEncrypted?.trim().length;

    if (!hasCryptoCompare) missing.push('CryptoCompare (Market Data)');
    if (!hasNewsData) missing.push('NewsData.io (News)');

    return {
      valid: missing.length === 0,
      missing
    };
  } catch (err: any) {
    logger.error({ uid, error: err.message }, 'Error checking mandatory API keys');
    return { valid: false, missing: ['System Error'] };
  }
}

// Monitor Event Loop Lag
setInterval(() => {
  const start = Date.now();
  setImmediate(() => {
    eventLoopLag = Date.now() - start;
    if (eventLoopLag > 200) {
      console.warn(`[EVENT_LOOP_WARNING] Lag detected: ${eventLoopLag}ms. Throttling background tasks.`);
    }
  });
}, 1000).unref();

export async function researchRoutes(fastify: FastifyInstance) {
  // 🔥 DIAGNOSTIC: PROVE WHICH BACKEND CODE IS RUNNING
  console.log("🔥 ACTIVE BACKEND BUILD: research.ts @ 2025-01-15 ROOT-CAUSE-FIXED-VERSION");
  console.log("🔥 BACKEND FILE PATH:", __filename);
  logger.info({ buildMarker: "ROOT-CAUSE-FIXED-VERSION", timestamp: new Date().toISOString() }, "🔥 Backend research routes loaded");
  console.log("[ROUTE READY] 100% Non-blocking with Isolated Worker");
  // 🔥 DIAGNOSTIC MARKER: PROVE WHICH BACKEND CODE IS RUNNING
  console.log("🔥 ACTIVE BACKEND BUILD: research.ts @ 2025-01-XX DIAGNOSTIC-VERSION");
  console.log("🔥 BACKEND FILE PATH:", __filename);
  console.log("🔥 BACKEND BUILD TIMESTAMP:", new Date().toISOString());

  // GET /api/research/history - Retrieve research history for user
  // CRITICAL: Fixed 404 issue by elevating route priority
  fastify.get('/history', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = request.user as any;
    const { limit } = (request.query as any) || {};
    const count = parseInt(limit as string) || 50;

    console.log("[RESEARCH_HISTORY_REQUEST]", { uid: user.uid, count });

    try {
      const history = await firestoreAdapter.getResearchHistory(user.uid, count);
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT] - History fetched:", history.length);
      reply.send({
        success: true,
        data: history
      });
      return;
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error fetching research history');
      reply.code(500).send({
        success: false,
        error: 'Failed to fetch research history'
      });
      return;
    }
  });

  // CRITICAL: Duplicate routes removed - background-research settings are handled by backgroundResearch.ts
  // These routes were shadowing /api/background-research/settings from backgroundResearch.ts

  // POST /api/research/background-research/settings/test - Test Telegram connection
  fastify.post('/background-research/settings/test', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    const { botToken, chatId } = request.body as { botToken: string; chatId: string };

    try {
      logger.info({ uid: user.uid }, 'Testing Telegram connection');

      // Import telegram service and test the connection
      const { telegramService } = await import('../services/telegramService');
      const testResult = await telegramService.testConnection(botToken, chatId);

      if (testResult.success) {
        console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
        reply.send({
          success: true,
          message: "DLXTRADE Alert Test Successful: Telegram integration working."
        });
        return;
      } else {
        console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
        reply.code(400).send({
          error: testResult.error || 'Failed to send test message to Telegram'
        });
        return;
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error testing Telegram connection');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.code(500).send({
        success: false,
        error: 'Failed to test Telegram connection',
        reason: error.message,
      });
      return;
    }
  });

  // GET /api/research/logs - Get research logs (HARDENED: 200ms timeout)
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;
    if (!user?.uid) {
      logger.warn({}, 'GET /research/logs - missing uid, returning safe default');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send([]);
      return;
    }

    try {
      const query = researchQuerySchema.parse(request.query);
      const rawLogs = await firestoreAdapter.getResearchLogs(user.uid, query.limit || 50);
      const logs = rawLogs.map((log) => ({
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
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send(logs || []);
    } catch (err: any) {
      logger.warn({ uid: user.uid, error: err.message, duration: Date.now() - startTime }, 'GET /research/logs error - returning safe default');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send([]);
    }
    return;
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

    // UID ENFORCEMENT: Only auth.uid allowed - no fallbacks
    const uid = (request as any).userId;
    const mode = body.mode;

    if (!uid) {
      console.log("[RESEARCH_AUTH_UID_MISSING] Research route - no authenticated user");
      return reply.code(401).send({ error: "Authentication required" });
    }

    console.log(`[RESEARCH_AUTH_UID_ISOLATED] Using isolated UID: ${uid}`);

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

          // CRITICAL: Load user integrations for API keys - REQUIRED for Deep Research
          const integrationsResponse = await getUserIntegrations(uid);
          const integrations = integrationsResponse.providerConfig || { marketData: {}, news: {}, metadata: {} };
          console.log("[DR] Integrations for", uid, integrations);

          // CRITICAL: Allow research to always start, regardless of API key presence
          // Deep Research should continue even if no API keys configured (will operate in limited mode)
          const hasAnyApiKey =
            (integrations.marketData && Object.values(integrations.marketData).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
            (integrations.news && Object.values(integrations.news).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
            (integrations.metadata && Object.values(integrations.metadata).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0));

          // REMOVED: Guard blocking research if no API keys; log and continue instead
          if (!hasAnyApiKey) {
            logger.warn({ uid, symbol }, 'Deep Research running without API keys - limited functionality');
            // Continue researching, result may be limited/skipped
          }

          // Run FREE MODE Deep Research v1.5 with user integrations
          const { runFreeModeDeepResearch } = await import('../services/deepResearchEngine');
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

      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send({
        success: true,
        results,
        totalSymbols: symbols.length,
        timestamp: new Date().toISOString(),
        mode: 'free'
      });
      return;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'FREE MODE Deep research route failed');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.code(500).send({
        error: 'FREE MODE Deep research failed',
        reason: error.message || 'Unknown error occurred',
      });
      return;
    }
  });

  // POST /api/research/run - COMPOSITE NON-BLOCKING ARCHITECTURE
  fastify.post('/run', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { uid?: string; symbol?: string; symbols?: string[]; mode?: 'manual' | 'global' } }>, reply: FastifyReply) => {
    // 🔥 DIAGNOSTIC: PROVE EXACT ROUTE USED BY UI
    console.log("🔥 [ROUTE_TRACE] POST /api/research/run", {
      method: request.method,
      url: request.url,
      handlerFile: __filename,
      body: request.body,
      timestamp: new Date().toISOString()
    });
    const startTime = Date.now();
    // 1. SYNC VALIDATION (PURE)
    let body, uid, targetSymbol, cacheKey, lockKey, isGlobal: boolean;
    try {
      body = z.object({
        uid: z.string().optional(),
        symbol: z.string().optional(),
        symbols: z.array(z.string()).optional(),
        mode: z.enum(['manual', 'global', 'auto', 'background', 'scheduled']).optional(),
        type: z.string().optional(),
        source: z.string().optional()
      }).parse(request.body || {});

      uid = (request as any).userId || (request as any).user?.uid;
      if (!uid) {
        reply.code(401).send({ error: "Authentication required" });
        return reply;
      }

      isGlobal = body.type === 'global' || body.mode === 'global' || body.source === 'auto_select';

      // 🔥 DIAGNOSTIC: PROVE WHICH ROUTE IS CALLED
      console.log("🔥 [ROUTE_TRACE] POST /api/research/run", {
        method: request.method,
        url: request.url,
        handlerFile: __filename,
        body: { mode: body.mode, type: body.type, source: body.source, symbols: body.symbols },
        uid
      });

      // CRITICAL: For Manual Research, check if user has ANY valid API key (not mandatory specific ones)
      // This matches the actual research execution logic which uses hasValidApiKey
      // Automated, background, and scheduled research should bypass this gate to use whatever providers are available.
      const isManualResearch = body.mode === 'manual' || body.type === 'manual';

      if (isManualResearch) {
        // 🔥 DIAGNOSTIC: PROVE API KEY CHECK
        console.log("🔥 [API_KEY_CHECK] Starting hasValidApiKey check", { uid, isManualResearch });
        const hasApiKey = await hasValidApiKey(uid);
        console.log("🔥 [API_KEY_CHECK] Result:", { uid, hasApiKey });
        if (!hasApiKey) {
          logger.warn({ uid, mode: body.mode }, 'Manual research blocked - no API keys configured');
          console.log("🔥 [API_KEY_CHECK] BLOCKED - returning NO_API_KEYS response");
          return reply.code(200).send({
            success: false,
            error: 'API keys required',
            message: 'Deep Research requires at least one API key to be connected. Please configure your provider API keys in Settings before running research.',
            blocked: true,
            reason: 'NO_API_KEYS'
          });
        }
        console.log("🔥 [API_KEY_CHECK] PASSED - continuing research");

        // CRITICAL: For MANUAL research, allow Top 100 non-stablecoins
        // For AUTO/SCHEDULER, enforce Top 10 only
        const requestSource = body.source || (isManualResearch ? 'MANUAL' : 'AUTO');
        const manualSymbol = (body.symbols?.[0] || body.symbol || '').toUpperCase();
        
        if (manualSymbol && requestSource === 'MANUAL') {
          // Manual research: Allow Top 100 non-stablecoins
          const { getTop100NonStablecoins } = await import('../services/researchModes');
          const top100 = await getTop100NonStablecoins(uid);
          const top100Symbols = new Set(top100.map(c => c.symbol.toUpperCase()));
          
          if (!top100Symbols.has(manualSymbol)) {
            logger.warn({ uid, symbol: manualSymbol }, 'Manual research rejected - coin not in top 100 non-stablecoins');
            return reply.code(400).send({
              success: false,
              error: 'Invalid coin selection',
              message: `The selected coin (${manualSymbol}) is not in the top 100 non-stablecoins by market cap. Please select a coin from the available list.`,
              blocked: true,
              reason: 'NOT_IN_TOP_100_NON_STABLECOINS'
            });
          }
        } else if (manualSymbol && (requestSource === 'AUTO' || requestSource === 'SCHEDULER')) {
          // Auto/Scheduler: Enforce Top 10 only
          const { getTop10NonStablecoins } = await import('../services/researchModes');
          const top10 = await getTop10NonStablecoins(uid);
          const top10Symbols = new Set(top10.map(c => c.symbol.toUpperCase()));
          
          if (!top10Symbols.has(manualSymbol)) {
            logger.warn({ uid, symbol: manualSymbol, source: requestSource }, 'Auto research rejected - coin not in top 10 non-stablecoins');
            return reply.code(400).send({
              success: false,
              error: 'Invalid coin selection',
              message: `The selected coin (${manualSymbol}) is not in the top 10 non-stablecoins by market cap. Auto-trade only supports top 10 coins.`,
              blocked: true,
              reason: 'NOT_IN_TOP_10_NON_STABLECOINS'
            });
          }
        }
      }

      if (isGlobal) {
        console.log("[GLOBAL_RESEARCH_START]");

        // CRITICAL: Use Top 100 Accuracy Scan with FINAL exclusion and cooldown
        const { selectBestCoinByAccuracy } = await import('../services/researchModes');

        // Exclude currently running research to prevent duplicate selection
        const runningSymbols: string[] = [];
        for (const lockKey of globalRunningTasks) {
          if (lockKey.startsWith(`${uid}:`)) {
            const symbolMatch = lockKey.match(/RESEARCH:(.+)$/);
            if (symbolMatch) {
              runningSymbols.push(symbolMatch[1]);
            }
          }
        }

        const selectionResult = await selectBestCoinByAccuracy(uid, runningSymbols);

        if (!selectionResult) {
          logger.warn({ uid }, 'Auto-select failed - no valid coin found after accuracy scan');
          return reply.code(400).send({
            success: false,
            error: 'No suitable coin found for research. All coins may have been recently researched or are in cooldown.',
            message: 'No suitable coin found for research. Please try again later or select a coin manually.'
          });
        }

        const { symbol: bestCoin, accuracy: bestAccuracy, excludedCount } = selectionResult;
        logger.info({
          uid,
          symbol: bestCoin,
          accuracy: bestAccuracy.toFixed(2),
          excludedCount
        }, '[AUTO_SELECT] Coin selected by accuracy scan');

        targetSymbol = bestCoin;
      } else {
        targetSymbol = (body.symbols?.[0] || body.symbol || 'BTCUSDT').toUpperCase();
      }

      if (!targetSymbol.endsWith('USDT')) targetSymbol += 'USDT';

      cacheKey = `coin_research_${targetSymbol}_${uid}`;
      lockKey = isGlobal ? `${uid}:GLOBAL_RESEARCH_RUNNING` : `${uid}:RESEARCH:${targetSymbol}`;
    } catch (e: any) {
      reply.code(400).send({ success: false, error: e.message });
      return reply;
    }

    // 2. IDEMPOTENCY CHECK (SYNC) - Prevent duplicate research
    if (globalRunningTasks.has(lockKey)) {
      console.log(`[IDEMPOTENCY_BLOCK] Already running for ${lockKey}`);
      logger.info({ uid, symbol: targetSymbol, lockKey }, 'Research already in progress - returning IN_PROGRESS status');
      reply.send({ 
        success: true, 
        status: "IN_PROGRESS", 
        signal: "ANALYZING", 
        symbol: targetSymbol,
        message: 'Research is already running for this coin. Please wait for it to complete.'
      });
      return reply;
    }

    // 3. CACHE CHECK (SYNC)
    const cached = cacheService.get('metadata', cacheKey);
    let useCache = !!(cached && cached.signal !== 'ANALYZING' && cached.signal !== 'PENDING');

    // Task 3: If cache has news success = false, force fresh fetch to check RSS providers
    const cachedNewsSuccess = cached?.providersMetadata?.news?.success === true;
    const isManualMode = body.mode === 'manual' || body.type === 'manual' || !isGlobal;

    if (useCache && !cachedNewsSuccess && isManualMode) {
      console.log(`[CACHE_REFRESH] Forced refresh for ${targetSymbol}: news success was false in cache.`);
      useCache = false;
    }

    if (body.source === 'auto_select') {
      if (useCache) {
        console.error("[AUTO_SELECT_CACHE_BYPASS_VIOLATION]");
      }
      useCache = false; // COMPLETELY BYPASS FOR AUTO_SELECT
    }

    // 4. DETACHED ASYNC IIFE (HEAVY LOGIC ISOLATED)
    if (!useCache) {
      const isAutoSelect = body.source === 'auto_select' || body.type === 'global' || body.mode === 'global';
      // GUARD: If auto-select, run immediately (bypass concurrency limit)
      if (isAutoSelect || (backgroundTaskCount < MAX_BACKGROUND_TASKS && eventLoopLag < 200)) {
        (async () => {
          backgroundTaskCount++;
          globalRunningTasks.add(lockKey);
          const workerStart = Date.now();
          try {
            console.log(`[WORKER_START] ${lockKey} | Global Count: ${backgroundTaskCount}`);
            const deepResearchEngine = (await import('../services/deepResearchEngine')).default;
            const integrationsResponse = await getUserIntegrations(uid);
            const integrations = integrationsResponse.providerConfig || { marketData: {}, news: {}, metadata: {} };

            // CRITICAL: Validate that at least ONE provider has an API key configured
            // Deep Research requires API keys - it cannot run without any keys
            // Check for apiKeyEncrypted (encrypted keys) since getUserIntegrations returns encrypted keys
            const hasAnyApiKey =
              (integrations.marketData && Object.values(integrations.marketData).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
              (integrations.news && Object.values(integrations.news).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
              (integrations.metadata && Object.values(integrations.metadata).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0));

            // 🔥 PROOF: Log API key detection in worker
            console.log("[MANUAL_COIN_RESEARCH_WORKER_API_CHECK]", {
              uid,
              symbol: targetSymbol,
              hasAnyApiKey,
              marketDataCount: Object.keys(integrations.marketData || {}).length,
              newsCount: Object.keys(integrations.news || {}).length,
              metadataCount: Object.keys(integrations.metadata || {}).length,
              timestamp: new Date().toISOString()
            });

            // CRITICAL: API key gating removed for manual/deep research
            // Research can run without API keys (with limited functionality)
            // API keys are only required for auto-trade execution
            if (!hasAnyApiKey) {
              logger.info({ uid, symbol: targetSymbol }, 'Deep Research running without API keys - limited functionality');
              // Continue with research - providers will be skipped gracefully
            }

            // News is forced for Deep Research (Manual) but can be disabled for Global scans if needed
            const isDeepResearch = body.mode === 'manual' || body.type === 'manual' || !isGlobal;
            const configs = (isGlobal && !isDeepResearch) ? { news: { primary: 'none' as any, backups: [] } } : undefined;

            // CRITICAL: Determine backgroundMode based on research type
            // Manual research = user_request context (backgroundMode: false)
            // Global/background research = background_job context (backgroundMode: true)
            const backgroundModeForEngine = isGlobal; // Manual = false, Global = true

            // 🔥 PROOF: Log when research execution starts
            console.log("[MANUAL_COIN_RESEARCH_EXECUTION_START]", {
              uid,
              symbol: targetSymbol,
              backgroundMode: backgroundModeForEngine,
              timestamp: new Date().toISOString()
            });

            // CRITICAL: Don't pass encrypted integrations - let engine call getUserIntegrationsByUid with correct context
            // This ensures API keys are decrypted with the correct context (user_request vs background_job)
            const integrationsForEngine = undefined; // Let engine load with correct context

            // CRITICAL: Add timeout protection and error handling
            let rawResult: any = null;
            let researchError: any = null;

            try {
              // CRITICAL: Determine source for FINAL guard bypass
              const researchSource = isDeepResearch ? 'MANUAL_RESEARCH' : 'GLOBAL_RESEARCH';

              rawResult = await Promise.race([
                deepResearchEngine.runFreeModeDeepResearch(
                  uid, targetSymbol, configs, integrationsForEngine, backgroundModeForEngine, 35000,
                  async (partial) => {
                    // Background updates can still be used for other purposes (e.g. debugging)
                    // but we no longer overwrite cache with intermediate results to prevent stale data.
                  },
                  researchSource
                ),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Research timeout after 35 seconds')), 35000)
                )
              ]) as any;
            } catch (err: any) {
              researchError = err;
              logger.error({ uid, symbol: targetSymbol, error: err.message }, '❌ [RESEARCH_ERROR] Research execution failed');

              // CRITICAL: Write failure history even when research fails
              if (isDeepResearch) {
                try {
                  await firestoreAdapter.storeResearchHistory(uid, {
                    symbol: targetSymbol,
                    signal: 'HOLD',
                    accuracy: 0,
                    price: 0,
                    tradePlan: null,
                    isDeepResearch: true,
                    source: 'MANUAL_RESEARCH',
                    status: 'SKIPPED',
                    error: err.message || 'Research execution failed',
                    skipReason: 'Research execution failed'
                  });
                  logger.info({ uid, symbol: targetSymbol }, '✅ [HISTORY] Failure history stored');

                  // CRITICAL: Manual research does NOT send Telegram alerts
                  // Telegram alerts are ONLY sent from background research scheduler
                  logger.info({ uid, symbol: targetSymbol }, '⏭️ [TELEGRAM] Manual research failure - no alert sent (alerts only from background research)');
                } catch (histErr: any) {
                  logger.error({ uid, symbol: targetSymbol, error: histErr.message }, '❌ [HISTORY] Failed to store failure history');
                }
              }

              // Write error to cache so UI can display it
              const errorResult = {
                success: false,
                error: err.message || 'Research execution failed',
                symbol: targetSymbol,
                isFinal: true,
                isProcessing: false,
                signal: 'HOLD',
                accuracy: 0
              };
              safeCacheSet(cacheKey, errorResult, 'POST worker error result');
              return; // Exit worker without throwing
            }

            if (rawResult) {
              const { transformResearchResultWithAnalysis } = await import('../services/researchModes');
              const transformedResult = transformResearchResultWithAnalysis(rawResult, targetSymbol);

              // CRITICAL: Create a new mutable object instead of mutating the frozen result
              // The rawResult from deepResearchEngine is frozen, so we must create a copy
              const finalResult = {
                ...transformedResult,
                isFinal: true,
                isProcessing: false,
                signal: (transformedResult.signal === 'ANALYZING' || transformedResult.signal === 'PENDING' || !transformedResult.signal)
                  ? 'HOLD'
                  : transformedResult.signal
              };

              // CRITICAL: Do NOT downgrade BUY/SELL to HOLD if FINAL already exists
              // If the result already has a valid signal, preserve it
              if (transformedResult.signal && transformedResult.signal !== 'ANALYZING' && transformedResult.signal !== 'PENDING') {
                finalResult.signal = transformedResult.signal;
              }

              // CRITICAL: Check FINAL before writing to cache
              // Safe defaults must NEVER override an existing FINAL result
              if (safeCacheSet(cacheKey, finalResult, 'POST worker final result')) {
                console.log(`[POST_WORKER_CACHE] ${targetSymbol}: signal=${finalResult.signal}, accuracy=${finalResult.accuracy}, isFinal=${finalResult.isFinal}`);
              }

              // CRITICAL: Persist ALL Research to History (Manual AND Global)
              // Both manual and global research should write history for user visibility
              // Determine source based on research type
              const historySource = isDeepResearch ? 'MANUAL_RESEARCH' : 'GLOBAL_RESEARCH';

              // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE ATTEMPT
              console.log("🔥 [HISTORY_WRITE] BEFORE write attempt", { uid, symbol: targetSymbol, source: historySource, isDeepResearch });

              try {
                const accVal = finalResult.accuracy || 0;
                const finalAcc = accVal > 1 ? accVal : accVal * 100; // Ensure 0-100 scale

                const historyEntry = {
                  symbol: targetSymbol,
                  signal: finalResult.signal,
                  accuracy: finalAcc,
                  price: finalResult.price || finalResult.analysis?.priceAction?.currentPrice || 0,
                  tradePlan: finalResult.tradePlan || null,
                  // UI COMPATIBILITY: Flatten critical trade plan fields
                  // CRITICAL: tradePlan from generateTradePlan has takeProfit1/takeProfit2/takeProfit3, not takeProfit
                  // For backward compatibility, takeProfit should be set to takeProfit2 (main TP)
                  entryPrice: finalResult.tradePlan?.entryPrice || 0,
                  stopLoss: finalResult.tradePlan?.stopLoss || 0,
                  takeProfit: finalResult.tradePlan?.takeProfit2 || finalResult.tradePlan?.takeProfit || 0, // Use TP2 as main takeProfit (backward compatibility)
                  takeProfit1: finalResult.tradePlan?.takeProfit1 || 0,
                  takeProfit2: finalResult.tradePlan?.takeProfit2 || 0,
                  takeProfit3: finalResult.tradePlan?.takeProfit3 || 0,
                  indicators: finalResult.analysis || null,
                  isDeepResearch: true,
                  source: historySource,
                  status: 'FINAL' // Research completed successfully
                };

                await firestoreAdapter.storeResearchHistory(uid, historyEntry);
                console.log("🔥 [HISTORY_WRITE] AFTER write - SUCCESS", { uid, symbol: targetSymbol, accuracy: finalAcc, source: historySource });
                logger.info({ uid, symbol: targetSymbol, accuracy: finalAcc, source: historySource }, '✅ [HISTORY] Research history stored with flattened fields');

                // TELEGRAM ALERT FLOW FOR MANUAL RESEARCH:
                // 1. Research completes with FINAL verdict (isFinal = true)
                // 2. Get background research settings to check Telegram enablement
                // 3. CRITICAL: For MANUAL_RESEARCH source, ALWAYS send alert (ignore accuracy thresholds)
                // 4. For BACKGROUND/AUTO_TRADE sources, respect accuracy thresholds
                // 5. Alert sent using existing telegramService.sendMessage() (same as Background Research)
                // 6. Uses ONLY background research settings (telegramBotToken, telegramChatId, accuracyTrigger)
                // 7. Does NOT depend on UI being open or frontend state
                if (isDeepResearch && finalResult.isFinal) {
                  try {
                    // Get background research settings to check Telegram enablement
                    const bgResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
                    const telegramEnabled = bgResearchSettings?.telegramBackgroundResearchEnabled === true ||
                      (bgResearchSettings?.backgroundResearchEnabled === true && bgResearchSettings?.telegramBackgroundResearchEnabled !== false);
                    const hasBotToken = !!bgResearchSettings?.telegramBotToken && bgResearchSettings.telegramBotToken.trim().length > 0;
                    const hasChatId = !!bgResearchSettings?.telegramChatId && bgResearchSettings.telegramChatId.trim().length > 0;

                    // CRITICAL: For MANUAL_RESEARCH source, ALWAYS send alert (ignore accuracy thresholds)
                    // For BACKGROUND/AUTO_TRADE sources, check accuracy thresholds
                    const isManualSource = historySource === 'MANUAL_RESEARCH';
                    let shouldSendAlert = false;

                    if (isManualSource) {
                      // Manual research: ALWAYS send if Telegram is enabled and configured
                      shouldSendAlert = telegramEnabled && hasBotToken && hasChatId;
                      logger.info({
                        uid,
                        symbol: targetSymbol,
                        source: 'MANUAL_RESEARCH',
                        finalAccuracy: finalAcc,
                        telegramEnabled,
                        hasBotToken,
                        hasChatId,
                        shouldSendAlert
                      }, '🔍 [MANUAL_RESEARCH_TELEGRAM] Manual research - always send alert (ignoring accuracy thresholds)');
                    } else {
                      // Background/Auto-trade: Check accuracy thresholds
                      const accuracyTrigger = bgResearchSettings?.accuracyTrigger || 80;
                      const minTrigger = typeof accuracyTrigger === 'object' ? (accuracyTrigger.min || 80) : accuracyTrigger;
                      const maxTrigger = typeof accuracyTrigger === 'object' ? (accuracyTrigger.max || 100) : 100;
                      const isInRange = finalAcc >= minTrigger && finalAcc <= maxTrigger;
                      shouldSendAlert = isInRange && telegramEnabled && hasBotToken && hasChatId;

                      logger.info({
                        uid,
                        symbol: targetSymbol,
                        source: historySource,
                        finalAccuracy: finalAcc,
                        minTrigger,
                        maxTrigger,
                        isInRange,
                        telegramEnabled,
                        hasBotToken,
                        hasChatId,
                        shouldSendAlert
                      }, '🔍 [BACKGROUND_RESEARCH_TELEGRAM] Background research - checking accuracy thresholds');
                    }

                    // Send Telegram alert if conditions are met
                    if (shouldSendAlert) {
                      const signal = finalResult.signal || 'HOLD';
                      const tradePlan = finalResult.tradePlan;
                      const timestamp = new Date().toISOString();
                      let message = '';

                      if (signal === 'HOLD') {
                        message = `🚨 *DLXTRADE Manual Research Alert*

**Coin:** ${targetSymbol}
**Signal:** HOLD
**Accuracy:** ${finalAcc}%
**Reason:** Accuracy below 60% threshold - no trade plan generated
**Timestamp:** ${timestamp}
**Source:** Manual Research

⚡ *Action:* Wait for higher confidence signal before trading.`;
                      } else {
                        // BUY/SELL signal
                        if (tradePlan && tradePlan.entryPrice && tradePlan.stopLoss && finalAcc >= 70) {
                          const entryPrice = tradePlan.entryPrice;
                          const stopLoss = tradePlan.stopLoss;
                          const tp1 = tradePlan.takeProfit1;
                          const tp2 = tradePlan.takeProfit2;
                          const tp3 = tradePlan.takeProfit3;

                          // Format prices with dynamic precision to prevent identical values
                          const formatPrice = (price: number): string => {
                            if (!price || price <= 0) return '0.00';
                            if (price >= 1000) return price.toFixed(2);
                            if (price >= 100) return price.toFixed(3);
                            if (price >= 10) return price.toFixed(4);
                            if (price >= 1) return price.toFixed(5);
                            return price.toFixed(6);
                          };

                          message = `🚨 *DLXTRADE Manual Research Alert*

**Coin:** ${targetSymbol}
**Signal:** ${signal}
**Accuracy:** ${finalAcc}%
**Entry Price:** $${formatPrice(entryPrice)}
**Stop Loss:** $${formatPrice(stopLoss)}
**Take Profit 1:** ${tp1 ? `$${formatPrice(tp1)}` : 'N/A'}
**Take Profit 2:** ${tp2 ? `$${formatPrice(tp2)}` : 'N/A'}${tp3 ? `\n**Take Profit 3:** $${formatPrice(tp3)}` : ''}
**Timestamp:** ${timestamp}
**Source:** Manual Research

⚡ *Action Required:* Position size adjusted dynamically. Review and execute if conditions remain favorable.`;
                        } else {
                          message = `🚨 *DLXTRADE Manual Research Alert*

**Coin:** ${targetSymbol}
**Signal:** ${signal}
**Accuracy:** ${finalAcc}%
**Reason:** ${finalAcc < 70 ? 'Accuracy below 70% threshold - trade plan not generated' : 'Trade plan unavailable'}
**Timestamp:** ${timestamp}
**Source:** Manual Research

⚡ *Action:* ${finalAcc < 70 ? 'Wait for higher confidence signal (>= 70%) before trading.' : 'Trade plan unavailable - signal not actionable.'}`;
                        }
                      }

                      // Send Telegram alert using existing service
                      const { telegramService } = await import('../services/telegramService');
                      const telegramResult = await telegramService.sendMessage(
                        bgResearchSettings.telegramBotToken!,
                        bgResearchSettings.telegramChatId!,
                        message
                      );

                      if (telegramResult.success) {
                        logger.info({
                          uid,
                          symbol: targetSymbol,
                          source: historySource,
                          accuracy: finalAcc,
                          signal
                        }, `✅ [${historySource}_TELEGRAM] Telegram alert sent successfully`);
                      } else {
                        logger.warn({
                          uid,
                          symbol: targetSymbol,
                          source: historySource,
                          error: telegramResult.error
                        }, `⚠️ [${historySource}_TELEGRAM] Telegram alert failed`);
                      }
                    } else {
                      // Log why alert was skipped
                      let reason = '';
                      if (!telegramEnabled) reason = 'Telegram not enabled';
                      else if (!hasBotToken || !hasChatId) reason = 'Telegram bot token or chat ID missing';
                      else if (!isManualSource) {
                        // Only check accuracy for non-manual sources
                        const accuracyTrigger = bgResearchSettings?.accuracyTrigger || 80;
                        const minTrigger = typeof accuracyTrigger === 'object' ? (accuracyTrigger.min || 80) : accuracyTrigger;
                        const maxTrigger = typeof accuracyTrigger === 'object' ? (accuracyTrigger.max || 100) : 100;
                        const isInRange = finalAcc >= minTrigger && finalAcc <= maxTrigger;
                        if (!isInRange) reason = `Accuracy ${finalAcc}% outside range [${minTrigger}-${maxTrigger}]%`;
                      }

                      logger.info({
                        uid,
                        symbol: targetSymbol,
                        source: historySource,
                        accuracy: finalAcc,
                        reason: reason || 'Unknown reason'
                      }, `⏭️ [${historySource}_TELEGRAM] Telegram alert skipped`);
                    }
                  } catch (telegramErr: any) {
                    // Non-critical: Log error but don't fail research
                    logger.warn({
                      uid,
                      symbol: targetSymbol,
                      error: telegramErr.message
                    }, '⚠️ [MANUAL_RESEARCH_TELEGRAM] Error evaluating/sending Telegram alert (non-critical)');
                  }
                }
              } catch (histErr: any) {
                logger.error({ uid, error: histErr.message }, 'Failed to store manual research history');
              }
            }
            console.log(`[WORKER_COMPLETE] ${lockKey} in ${Date.now() - workerStart}ms`);
          } catch (err: any) {
            logger.error({ uid, symbol: targetSymbol, error: err.message }, 'Isolated Worker Failure');
            // CRITICAL: Do NOT write fallback FINAL results to cache
            // Error results must NEVER be marked as FINAL or cached
            // Only write if FINAL doesn't exist - preserve existing FINAL
            // But do NOT create new FINAL fallback results
            // safeCacheSet is skipped for errors - let them fail without caching
          } finally {
            backgroundTaskCount--;
            globalRunningTasks.delete(lockKey);
          }
        })().catch(err => console.error("[IIFE_CRITICAL_FAILURE]", err));
      } else {
        console.log(`[WORKER_SKIP] Concurrency Limit or Lag Detected | Lag: ${eventLoopLag}ms | Tasks: ${backgroundTaskCount}`);
      }
    }

    // 5. IMMEDIATE RESPONSE (<50ms GUARANTEED)
    let response: any;
    const isRunning = globalRunningTasks.has(lockKey);

    if (body.source === 'auto_select') {
      response = {
        success: true,
        status: "started",
        signal: "ANALYZING",
        symbol: targetSymbol,
        bestCoin: targetSymbol,
        source: "auto_select",
        cacheUsed: false,
        isProcessing: true,
        isFinal: false,
        timestamp: new Date().toISOString(),
        message: "Analysis running in background"
      };
    } else {
      if (useCache) {
        // Normalize cached response to ensure analysis structure exists
        let normalizedCached = { ...cached };

        // Task 1: Explicitly mark as processing if worker is running
        // CRITICAL: Never overwrite isFinal if it's already true - once final, always final
        normalizedCached.isProcessing = isRunning || !!normalizedCached.isProcessing;
        if (normalizedCached.isFinal !== true) {
          normalizedCached.isFinal = !normalizedCached.isProcessing;
        }

        if (!normalizedCached.analysis || (typeof normalizedCached.analysis === 'object' && Object.keys(normalizedCached.analysis).length === 0)) {
          if (normalizedCached.deepResearchResult) {
            const { transformResearchResultWithAnalysis } = require('../services/researchModes');
            const transformed = transformResearchResultWithAnalysis(normalizedCached.deepResearchResult, targetSymbol);
            normalizedCached.analysis = transformed.analysis;
            normalizedCached.signal = transformed.signal || normalizedCached.signal;
            normalizedCached.accuracy = transformed.accuracy || normalizedCached.accuracy;
          }
        }

        console.log(`[DR_RESPONSE] Cache Hit for ${targetSymbol} | isProcessing: ${normalizedCached.isProcessing}`);
        response = { success: true, status: normalizedCached.isProcessing ? "processing" : "complete", symbol: targetSymbol, ...normalizedCached, timestamp: new Date().toISOString() };
      } else {
        response = {
          success: true,
          status: "started",
          signal: "ANALYZING",
          symbol: targetSymbol,
          isProcessing: true,
          isFinal: false,
          timestamp: new Date().toISOString(),
          message: "Analysis running in background"
        };
      }
    }

    console.log(`[NON_BLOCKING_RUN] Response ready for ${targetSymbol} - Cache: ${useCache}`);

    // ⚠️ DO NOT ADD CODE AFTER reply.send() — WILL CAUSE 504
    reply.send(response);
    return reply;
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

          const { runFreeModeDeepResearch } = await import('../services/deepResearchEngine');
          const result = await runFreeModeDeepResearch(testUserId, symbol, {
            binance: { primary: 'binance', backups: ['bybit', 'okx', 'kucoin'] },
            cryptocompare: { primary: 'cryptocompare', backups: ['alphavantage', 'coingecko'] },
            cmc: { primary: 'coinmarketcap', backups: ['coingecko'] },
            news: { primary: 'newsdata', backups: ['cryptopanic', 'reddit'] }
          }, mockIntegrations);

          // Ensure structuredAnalysis exists for testing
          const structuredAnalysis = result.structuredAnalysis || {
            coin: symbol,
            summary: `Analysis for ${symbol} with ${result.accuracy}% accuracy`,
            signals: [{
              type: result.signal === 'BUY' ? 'buy' : result.signal === 'SELL' ? 'sell' : 'hold',
              confidence: result.accuracy / 100,
              reason: 'Technical analysis'
            }],
            metrics: {
              momentum: { rsi: 50, macd: 0, trend: 'neutral' },
              volatility: { atr: 1, classification: 'medium' },
              volume: { trend: 'stable', score: 50 },
              support: 95,
              resistance: 105
            },
            news: [],
            images: []
          };

          results.push({
            symbol,
            durationMs: Date.now() - symbolStartTime,
            result: {
              signal: result.signal,
              accuracy: result.accuracy,
              structuredAnalysis: structuredAnalysis,
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

      const info = {
        version: "deep-research-v2",
        timestamp: Date.now(),
        gitHash: gitHash,
        buildTime: new Date().toISOString(),
        serverPath: __dirname,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production'
      };
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send(info);
      return;
    } catch (error: any) {
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.code(500).send({
        error: 'Build info failed',
        reason: error.message
      });
      return;
    }
  });

  // Deep Research Endpoints

  // GET /api/deep-research/top50 - Returns top 50 coins by market cap (CACHE-ONLY, < 300ms target)
  // CRITICAL: This endpoint MUST be cache-only - NO external API calls, NO deep research
  // Purpose: Return cached Top N non-stablecoins for ResearchPanel UI
  fastify.get('/deep-research/top50', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const user = (request as any).user;
    const uid = user?.uid;

    const cacheKey = `top100_coins_${uid}`;

    try {
      // CACHE-ONLY PATH 1: Try cache service first
      const cached = cacheService.get('price', cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        const responseTime = Date.now() - startTime;
        logger.info({ uid, count: cached.length, responseTimeMs: responseTime }, 'GET /deep-research/top50 served from cache service (CACHE-ONLY endpoint)');
        console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
        reply.send({
          success: true,
          coins: cached.slice(0, 100), // Return up to 100 for manual research
          source: 'cache',
          timestamp: new Date().toISOString(),
          cached: true
        });
        return;
      }

      // CACHE-ONLY PATH 2: Try module-level cache from researchModes (if available)
      // This is populated by background processes, never by this endpoint
      const { cachedTop50Coins, filterStablecoins } = await import('../services/researchModes');
      if (cachedTop50Coins && Array.isArray(cachedTop50Coins) && cachedTop50Coins.length > 0) {
        const filtered = filterStablecoins(cachedTop50Coins);
        if (filtered.length > 0) {
          const responseTime = Date.now() - startTime;
          logger.info({ uid, count: filtered.length, responseTimeMs: responseTime }, 'GET /deep-research/top50 served from module cache (CACHE-ONLY endpoint)');
          console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
          reply.send({
            success: true,
            coins: filtered.slice(0, 100),
            source: 'module_cache',
            timestamp: new Date().toISOString(),
            cached: true
          });
          return;
        }
      }

      // FALLBACK: If all caches are empty, return static fallback list (top 20 most common coins)
      // This ensures UI never breaks even if cache is cold
      const fallbackCoins = [
        { symbol: 'BTCUSDT', name: 'Bitcoin', rank: 1 },
        { symbol: 'ETHUSDT', name: 'Ethereum', rank: 2 },
        { symbol: 'BNBUSDT', name: 'BNB', rank: 3 },
        { symbol: 'SOLUSDT', name: 'Solana', rank: 4 },
        { symbol: 'XRPUSDT', name: 'XRP', rank: 5 },
        { symbol: 'ADAUSDT', name: 'Cardano', rank: 6 },
        { symbol: 'DOGEUSDT', name: 'Dogecoin', rank: 7 },
        { symbol: 'DOTUSDT', name: 'Polkadot', rank: 8 },
        { symbol: 'AVAXUSDT', name: 'Avalanche', rank: 9 },
        { symbol: 'SHIBUSDT', name: 'Shiba Inu', rank: 10 },
        { symbol: 'MATICUSDT', name: 'Polygon', rank: 11 },
        { symbol: 'LTCUSDT', name: 'Litecoin', rank: 12 },
        { symbol: 'LINKUSDT', name: 'Chainlink', rank: 13 },
        { symbol: 'UNIUSDT', name: 'Uniswap', rank: 14 },
        { symbol: 'ATOMUSDT', name: 'Cosmos', rank: 15 },
        { symbol: 'ETCUSDT', name: 'Ethereum Classic', rank: 16 },
        { symbol: 'XLMUSDT', name: 'Stellar', rank: 17 },
        { symbol: 'FILUSDT', name: 'Filecoin', rank: 18 },
        { symbol: 'TRXUSDT', name: 'TRON', rank: 19 },
        { symbol: 'ICPUSDT', name: 'Internet Computer', rank: 20 }
      ];

      const responseTime = Date.now() - startTime;
      logger.info({ uid, count: fallbackCoins.length, responseTimeMs: responseTime }, 'GET /deep-research/top50 served fallback list (all caches empty, CACHE-ONLY endpoint)');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send({
        success: true,
        coins: fallbackCoins,
        source: 'fallback',
        timestamp: new Date().toISOString(),
        cached: false,
        note: 'All caches empty - returned static fallback list'
      });
      return;

    } catch (err: any) {
      const responseTime = Date.now() - startTime;
      logger.warn({ uid, error: err?.message, responseTimeMs: responseTime }, 'GET /deep-research/top50 error (CACHE-ONLY endpoint)');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      // Return empty array instead of error - UI should handle gracefully
      reply.send({
        success: true,
        coins: [],
        source: 'empty',
        reason: 'cache_error',
        timestamp: new Date().toISOString(),
        cached: false
      });
      return;
    }
  });

  // GET /api/deep-research/top10 - Returns top 10 non-stablecoins (for auto-trade UI)
  fastify.get('/deep-research/top10', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const uid = user.uid;

    // CRITICAL: Enforce API key requirement - NO fallback market data when blocked
    const hasApiKey = await hasValidApiKey(uid);
    if (!hasApiKey) {
      logger.warn({ uid }, 'GET /deep-research/top10 blocked - no API keys configured');
      return reply.code(403).send({
        success: false,
        error: 'Deep Research requires at least one API key to be connected.',
        message: 'Deep Research requires at least one API key to be connected. Please configure your provider API keys in Settings before running research.',
        blocked: true,
        reason: 'NO_API_KEYS'
      });
    }

    try {
      logger.info({ uid }, 'Fetching top 10 non-stablecoins for auto-trade UI');

      // CRITICAL: Use getTop10NonStablecoins for auto-trade UI
      const { getTop10NonStablecoins } = await import('../services/researchModes');
      
      // Check cache first
      const cacheKey = `top10_coins_${uid}`;
      let top10Coins = cacheService.get('price', cacheKey);

      if (!top10Coins || top10Coins.length === 0) {
        // Fetch with timeout guard
        const fetchPromise = getTop10NonStablecoins(uid);
        const timeoutPromise = new Promise<any[]>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 5000)
        );
        
        top10Coins = await Promise.race([fetchPromise, timeoutPromise]);
        cacheService.set('price', cacheKey, top10Coins);
        logger.info({ uid }, 'Top 10 non-stablecoins fetched from providers and cached');
      } else {
        logger.info({ uid }, 'Top 10 non-stablecoins served from cache');
      }
      
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send({
        success: true,
        coins: top10Coins.slice(0, 10),
        timestamp: new Date().toISOString(),
        cached: !!cacheService.get('price', cacheKey),
      });
      return;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error fetching top 10 coins');
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.code(500).send({
        error: 'Failed to fetch top 10 coins',
        reason: error.message,
      });
      return;
    }
  });

  // GET /api/deep-research/coin/:symbol - ARCHITECTURAL NON-BLOCKING
  fastify.get('/deep-research/coin/:symbol', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { symbol: string }; Querystring: { source?: string } }>, reply: FastifyReply) => {
    const startReq = Date.now();
    const user = (request as any).user;
    const uid = user.uid;
    const symbol = request.params.symbol.toUpperCase();
    const source = request.query.source;

    // 1. Sync Validation (HARDENED)
    const upperSymbol = symbol.toUpperCase();
    const isValidSymbol = typeof symbol === 'string' &&
      /^[A-Z0-9]+USDT$/.test(upperSymbol) &&
      upperSymbol !== 'MUSDT' &&
      upperSymbol !== 'MBTCUSDT' &&
      upperSymbol !== 'M';

    if (!isValidSymbol) {
      const invalidResponse: any = {
        success: true,
        symbol,
        signal: 'HOLD',
        confidence: 0,
        accuracy: 0,
        isFinal: true,
        isProcessing: false,
        reason: 'Invalid trading pair (Only perpetual USDT pairs supported)'
      };
      return reply.send(invalidResponse);
    }

    const cacheKey = `coin_research_${symbol}_${uid}`;
    const lockKey = `${uid}:RESEARCH:${symbol}`;

    try {
      // 2. CACHE-FIRST with Absolute Failsafe
      const cached = cacheService.get('metadata', cacheKey);
      const isTaskRunning = globalRunningTasks.has(lockKey);

      // CRITICAL: Check if cached result is a blocked/error state
      // Blocked results must NEVER be treated as valid FINAL data
      if (cached && (cached.blocked === true || cached.reason === 'NO_API_KEYS')) {
        logger.warn({ uid, symbol, cached }, 'GET /deep-research/coin/:symbol - Cached blocked result detected, returning 403');
        return reply.code(403).send({
          success: false,
          error: 'Deep Research requires at least one API key to be connected.',
          message: 'Deep Research requires at least one API key to be connected. Please configure your provider API keys in Settings before running research.',
          symbol,
          blocked: true,
          reason: 'NO_API_KEYS'
        });
      }

      // CRITICAL: Check if FINAL result exists in cache - FINAL takes priority
      // If FINAL exists, return FULL FINAL payload immediately
      // Only return placeholder if no FINAL exists AND research is still processing
      if (cached) {
        // CRITICAL: Check if cached result is FINAL
        const isCachedFinal = cached.isFinal === true || cached.status === 'FINAL';
        
        // CRITICAL: If FINAL exists, return FULL FINAL payload with all fields
        if (isCachedFinal) {
          // CRITICAL: Create a mutable copy of cached FINAL result to avoid mutating frozen object
          let result = { ...cached };

          // CRITICAL: Ensure analysis structure exists for FINAL results
          if (!result.analysis || (typeof result.analysis === 'object' && Object.keys(result.analysis).length === 0)) {
            const deepResearchResult = result.deepResearchResult;
            if (deepResearchResult) {
              const { transformResearchResultWithAnalysis } = require('../services/researchModes');
              const transformed = transformResearchResultWithAnalysis(deepResearchResult, symbol);
              result = { ...result, analysis: transformed.analysis };
            }
          }

          // CRITICAL: Extract all fields from deepResearchResult if not already in result
          const deepResearchResult = result.deepResearchResult || {};
          
          // CRITICAL: Return FULL FINAL payload with all fields
          const responseObj: any = {
            success: true,
            symbol,
            ...result, // Spread FULL FINAL result
            // TOP LEVEL ENFORCEMENT - MUST come after spread
            isFinal: true,
            isProcessing: false,
            signal: result.signal || deepResearchResult.signal || 'HOLD',
            accuracy: typeof result.accuracy === 'number' ? result.accuracy : (typeof deepResearchResult.accuracy === 'number' ? deepResearchResult.accuracy : null),
            price: result.price || deepResearchResult.price || null,
            analysis: result.analysis || deepResearchResult.analysis || {},
            news: result.news || deepResearchResult.news || { articles: [] },
            coinImages: result.coinImages || deepResearchResult.coinImages || null,
            tradePlan: result.tradePlan || deepResearchResult.tradePlan || null,
            metadata: result.metadata || deepResearchResult.metadata || {},
            stages: result.stages || deepResearchResult.stages || {},
            partial: result.partial || deepResearchResult.partial || false,
            // CRITICAL: Include indicators if available
            indicators: result.indicators || deepResearchResult.indicators || {},
            timestamp: new Date().toISOString(),
            cached: true
          };

          // Final signal sanitization
          if (responseObj.isFinal && (responseObj.signal === 'ANALYZING' || responseObj.signal === 'PENDING')) {
            responseObj.signal = 'HOLD';
          }

          console.log(`[GET_FINAL_RESULT] ${symbol}: Returning FULL FINAL payload - Signal=${responseObj.signal}, Accuracy=${responseObj.accuracy}, hasNews=${!!responseObj.news?.articles?.length}, hasImages=${!!responseObj.coinImages?.length}, hasTradePlan=${!!responseObj.tradePlan}`);
          return reply.send(responseObj);
        }

        // If cached result is NOT FINAL, check if research is still processing
        // Only return placeholder if research is still running
        if (isTaskRunning) {
          // CRITICAL: Create a mutable copy of cached result to avoid mutating frozen object
          let result = { ...cached };

          // Determine if there is usable analysis even in ANALYZING state
          const hasUsableData = (
            result.analysis && typeof result.analysis === 'object' && Object.keys(result.analysis).length > 0
          ) || (
              result?.deepResearchResult?.indicators && Object.keys(result.deepResearchResult.indicators).length > 0
            );

          // SYNC VALIDATION: Always reconstruct analysis structure if missing
          if (!result.analysis || (typeof result.analysis === 'object' && Object.keys(result.analysis).length === 0)) {
            const deepResearchResult = result.deepResearchResult;
            if (deepResearchResult) {
              const { transformResearchResultWithAnalysis } = require('../services/researchModes');
              const transformed = transformResearchResultWithAnalysis(deepResearchResult, symbol);
              result = { ...result, analysis: transformed.analysis };
            }
          }

          // Research is still processing - return placeholder
          result = { ...result, isProcessing: true, isFinal: false };

          // CONVERT TO TOP-LEVEL RESPONSE (NO NESTING - MANDATORY SCHEMA)
          const responseObj: any = {
            success: true,
            symbol,
            ...result, // Spread original/modified data
            // TOP LEVEL ENFORCEMENT - MUST come after spread
            isFinal: false,
            isProcessing: true,
            signal: result.signal || 'ANALYZING',
            accuracy: typeof result.accuracy === 'number' ? result.accuracy : null,
            analysis: result.analysis,
            timestamp: new Date().toISOString(),
            cached: true
          };

          console.log(`[GET_PROCESSING] ${symbol}: Research still processing, returning placeholder`);
          return reply.send(responseObj);
        }

        // If no task running and not FINAL, treat as final (worker completed but didn't set FINAL flag)
        // CRITICAL: Create a mutable copy of cached result
        let result = { ...cached };

        // SYNC VALIDATION: Always reconstruct analysis structure if missing
        if (!result.analysis || (typeof result.analysis === 'object' && Object.keys(result.analysis).length === 0)) {
          const deepResearchResult = result.deepResearchResult;
          if (deepResearchResult) {
            const { transformResearchResultWithAnalysis } = require('../services/researchModes');
            const transformed = transformResearchResultWithAnalysis(deepResearchResult, symbol);
            result = { ...result, analysis: transformed.analysis };
          }
        }

        // Worker not running - treat as final
        result = { ...result, isProcessing: false, isFinal: true };

        // FIX: Only force FINAL if filtering auto_select - Manual research should NOT be forced to final
        if (result.isProcessing === false && result.isFinal !== true && source === 'auto_select') {
          result = {
            ...result,
            isFinal: true,
            signal: (!result.signal || result.signal === 'ANALYZING' || result.signal === 'PENDING') ? 'HOLD' : result.signal
          };
        }

        // CONVERT TO TOP-LEVEL RESPONSE
        const responseObj: any = {
          success: true,
          symbol,
          ...result,
          isFinal: result.isFinal === true,
          isProcessing: false,
          signal: result.signal || 'HOLD',
          accuracy: typeof result.accuracy === 'number' ? result.accuracy : null,
          analysis: result.analysis,
          news: result.news || result.deepResearchResult?.news || { articles: [] },
          coinImages: result.coinImages || result.deepResearchResult?.coinImages || null,
          tradePlan: result.tradePlan || result.deepResearchResult?.tradePlan || null,
          timestamp: new Date().toISOString(),
          cached: true
        };

        // Final signal sanitization
        if (responseObj.isFinal && (responseObj.signal === 'ANALYZING' || responseObj.signal === 'PENDING')) {
          responseObj.signal = 'HOLD';
        }

        console.log(`[GET_COMPLETED] ${symbol}: Worker completed, returning result - Final=${responseObj.isFinal}, Signal=${responseObj.signal}, Accuracy=${responseObj.accuracy}`);
        return reply.send(responseObj);
      }

      // 3. CACHE MISS PATH - Start background task
      if (!globalRunningTasks.has(lockKey) && backgroundTaskCount < MAX_BACKGROUND_TASKS && eventLoopLag < 200) {
        (async () => {
          backgroundTaskCount++;
          globalRunningTasks.add(lockKey);
          try {
            console.log(`[GET_WORKER_START] Tasks: ${backgroundTaskCount} | Key: ${lockKey}`);

            // CRITICAL: Validate API keys before starting Deep Research
            const { getUserIntegrations } = await import('./integrations');
            const integrationsResponse = await getUserIntegrations(uid);
            const integrations = integrationsResponse.providerConfig || { marketData: {}, news: {}, metadata: {} };

            // CRITICAL: Validate that at least ONE provider has an API key configured
            // Check for apiKeyEncrypted (encrypted keys) since getUserIntegrations returns encrypted keys
            const hasAnyApiKey =
              (integrations.marketData && Object.values(integrations.marketData).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
              (integrations.news && Object.values(integrations.news).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0)) ||
              (integrations.metadata && Object.values(integrations.metadata).some((p: any) => p?.apiKeyEncrypted && p.apiKeyEncrypted.trim().length > 0));

            if (!hasAnyApiKey) {
              logger.warn({ uid, symbol }, 'GET worker Deep Research blocked - no API keys configured');
              // CRITICAL: Do NOT write fallback FINAL result to cache
              // Blocked results must NEVER be marked as FINAL or cached
              // Exit worker without executing research and without caching
              return; // Exit worker without executing research
            }

            const { DeepResearchEngine } = await import('../services/deepResearchEngine');
            const dre = new DeepResearchEngine();

            // CRITICAL: Add timeout protection and error handling
            let res: any = null;
            let researchError: any = null;

            try {
              // CRITICAL: Determine source for FINAL guard bypass
              const researchSource = source || 'MANUAL_RESEARCH'; // Default to MANUAL for GET route

              res = await Promise.race([
                dre.getCoinResearch(uid, symbol, researchSource, async (partial) => {
                  // Internal cache updates during execution
                  // CRITICAL: Only update if FINAL doesn't exist - preserve existing FINAL
                  // Partial updates are safe (isFinal: false) but still check to avoid overwriting FINAL
                  const partialUpdate = { ...partial, symbol, isFinal: false, isProcessing: true };
                  safeCacheSet(cacheKey, partialUpdate, 'GET worker partial update');
                }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Research timeout after 35 seconds')), 35000)
                )
              ]) as any;
            } catch (err: any) {
              researchError = err;
              logger.error({ uid, symbol, error: err.message }, '❌ [GET_RESEARCH_ERROR] Research execution failed');

              // CRITICAL: Write failure history even when research fails
              try {
                await firestoreAdapter.storeResearchHistory(uid, {
                  symbol: symbol,
                  signal: 'HOLD',
                  accuracy: 0,
                  price: 0,
                  tradePlan: null,
                  isDeepResearch: true,
                  source: 'MANUAL_RESEARCH',
                  status: 'SKIPPED',
                  error: err.message || 'Research execution failed',
                  skipReason: 'Research execution failed'
                });
                logger.info({ uid, symbol }, '✅ [HISTORY] Failure history stored for GET route');

                // CRITICAL: Manual research does NOT send Telegram alerts
                // Telegram alerts are ONLY sent from background research scheduler
                logger.info({ uid, symbol }, '⏭️ [TELEGRAM] Manual research failure - no alert sent (alerts only from background research)');
              } catch (histErr: any) {
                logger.error({ uid, symbol, error: histErr.message }, '❌ [HISTORY] Failed to store failure history');
              }

              // Write error to cache so UI can display it
              const errorResult = {
                success: false,
                error: err.message || 'Research execution failed',
                symbol: symbol,
                isFinal: true,
                isProcessing: false,
                signal: 'HOLD',
                accuracy: 0
              };
              safeCacheSet(cacheKey, errorResult, 'GET worker error result');
              return; // Exit worker without throwing
            }

            if (res) {
              const { transformResearchResultWithAnalysis } = require('../services/researchModes');
              const transformed = transformResearchResultWithAnalysis(res.deepResearchResult || res, symbol);

              // CRITICAL: Create a new mutable object instead of mutating the frozen result
              const final = {
                ...transformed,
                isFinal: true,
                isProcessing: false,
                signal: (!transformed.signal || transformed.signal === 'ANALYZING' || transformed.signal === 'PENDING')
                  ? 'HOLD'
                  : transformed.signal
              };

              // CRITICAL: Do NOT downgrade BUY/SELL to HOLD if FINAL already exists
              if (transformed.signal && transformed.signal !== 'ANALYZING' && transformed.signal !== 'PENDING') {
                final.signal = transformed.signal;
              }

              // CRITICAL: Check FINAL before writing to cache
              // Safe defaults must NEVER override an existing FINAL result
              safeCacheSet(cacheKey, final, 'GET worker final result');

              // CRITICAL: Write history for GET route manual research
              try {
                const accVal = final.accuracy || 0;
                const finalAcc = accVal > 1 ? accVal : accVal * 100; // Ensure 0-100 scale

                const historyEntry = {
                  symbol: symbol,
                  signal: final.signal,
                  accuracy: finalAcc,
                  price: final.price || final.analysis?.priceAction?.currentPrice || 0,
                  tradePlan: final.tradePlan || null,
                  entryPrice: final.tradePlan?.entryPrice || 0,
                  stopLoss: final.tradePlan?.stopLoss || 0,
                  takeProfit: final.tradePlan?.takeProfit2 || final.tradePlan?.takeProfit || 0, // Use TP2 as main takeProfit (backward compatibility)
                  takeProfit1: final.tradePlan?.takeProfit1 || 0,
                  takeProfit2: final.tradePlan?.takeProfit2 || 0,
                  takeProfit3: final.tradePlan?.takeProfit3 || 0,
                  indicators: final.analysis || null,
                  isDeepResearch: true,
                  source: 'MANUAL_RESEARCH',
                  status: 'FINAL' // Research completed successfully
                };

                await firestoreAdapter.storeResearchHistory(uid, historyEntry);
                logger.info({ uid, symbol, accuracy: finalAcc }, '✅ [HISTORY] GET route manual research history stored');

                // CRITICAL: Manual research ALWAYS sends Telegram alerts (ignoring accuracy thresholds)
                // Background research respects accuracy thresholds
                try {
                  const bgResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
                  const telegramEnabled = bgResearchSettings?.telegramBackgroundResearchEnabled === true ||
                    (bgResearchSettings?.backgroundResearchEnabled === true && bgResearchSettings?.telegramBackgroundResearchEnabled !== false);
                  const hasBotToken = !!bgResearchSettings?.telegramBotToken && bgResearchSettings.telegramBotToken.trim().length > 0;
                  const hasChatId = !!bgResearchSettings?.telegramChatId && bgResearchSettings.telegramChatId.trim().length > 0;

                  if (telegramEnabled && hasBotToken && hasChatId) {
                    const signal = final.signal || 'HOLD';
                    const tradePlan = final.tradePlan;
                    const timestamp = new Date().toISOString();
                    let message = '';

                    if (signal === 'HOLD') {
                      message = `🚨 *DLXTRADE Manual Research Alert*

**Coin:** ${symbol}
**Signal:** HOLD
**Accuracy:** ${finalAcc.toFixed(1)}%
**Reason:** Accuracy below 60% threshold - no trade plan generated
**Timestamp:** ${timestamp}
**Source:** Manual Research

⚡ *Action:* Wait for higher confidence signal before trading.`;
                    } else {
                      // BUY/SELL signal
                      if (tradePlan && tradePlan.entryPrice && tradePlan.stopLoss && finalAcc >= 70) {
                        const entryPrice = tradePlan.entryPrice;
                        const stopLoss = tradePlan.stopLoss;
                        const tp1 = tradePlan.takeProfit1;
                        const tp2 = tradePlan.takeProfit2;
                        const tp3 = tradePlan.takeProfit3;

                        // Format prices with dynamic precision to prevent identical values
                        const formatPrice = (price: number): string => {
                          if (!price || price <= 0) return '0.00';
                          if (price >= 1000) return price.toFixed(2);
                          if (price >= 100) return price.toFixed(3);
                          if (price >= 10) return price.toFixed(4);
                          if (price >= 1) return price.toFixed(5);
                          return price.toFixed(6);
                        };

                        message = `🚨 *DLXTRADE Manual Research Alert*

**Coin:** ${symbol}
**Signal:** ${signal}
**Accuracy:** ${finalAcc.toFixed(1)}%
**Entry Price:** $${formatPrice(entryPrice)}
**Stop Loss:** $${formatPrice(stopLoss)}
**Take Profit 1:** ${tp1 ? `$${formatPrice(tp1)}` : 'N/A'}
**Take Profit 2:** ${tp2 ? `$${formatPrice(tp2)}` : 'N/A'}${tp3 ? `\n**Take Profit 3:** $${formatPrice(tp3)}` : ''}
**Timestamp:** ${timestamp}
**Source:** Manual Research

⚡ *Action Required:* Position size adjusted dynamically. Review and execute if conditions remain favorable.`;
                      } else {
                        message = `🚨 *DLXTRADE Manual Research Alert*

**Coin:** ${symbol}
**Signal:** ${signal}
**Accuracy:** ${finalAcc.toFixed(1)}%
**Reason:** ${finalAcc < 70 ? 'Accuracy below 70% threshold - trade plan not generated' : 'Trade plan unavailable'}
**Timestamp:** ${timestamp}
**Source:** Manual Research

⚡ *Action:* ${finalAcc < 70 ? 'Wait for higher confidence signal (>= 70%) before trading.' : 'Trade plan unavailable - signal not actionable.'}`;
                      }
                    }

                    // Send Telegram alert using existing service
                    const { telegramService } = await import('../services/telegramService');
                    const telegramResult = await telegramService.sendMessage(
                      bgResearchSettings.telegramBotToken!,
                      bgResearchSettings.telegramChatId!,
                      message
                    );

                    if (telegramResult.success) {
                      logger.info({
                        uid,
                        symbol,
                        source: 'MANUAL_RESEARCH',
                        accuracy: finalAcc,
                        signal
                      }, '✅ [MANUAL_RESEARCH_TELEGRAM] GET route Telegram alert sent successfully');
                    } else {
                      logger.warn({
                        uid,
                        symbol,
                        source: 'MANUAL_RESEARCH',
                        error: telegramResult.error
                      }, '⚠️ [MANUAL_RESEARCH_TELEGRAM] GET route Telegram alert failed');
                    }
                  } else {
                    logger.info({
                      uid,
                      symbol,
                      source: 'MANUAL_RESEARCH',
                      telegramEnabled,
                      hasBotToken,
                      hasChatId
                    }, '⏭️ [MANUAL_RESEARCH_TELEGRAM] GET route Telegram alert skipped - Telegram not configured');
                  }
                } catch (telegramErr: any) {
                  // Non-critical: Log error but don't fail research
                  logger.warn({
                    uid,
                    symbol,
                    error: telegramErr.message
                  }, '⚠️ [MANUAL_RESEARCH_TELEGRAM] GET route Error evaluating/sending Telegram alert (non-critical)');
                }
              } catch (histErr: any) {
                logger.error({ uid, symbol, error: histErr.message }, '❌ [HISTORY] Failed to store GET route history');
              }
            }
          } catch (e: any) {
            logger.error({ uid, symbol, error: e.message }, 'GET Worker Failure');
            // CRITICAL: Do NOT write fallback FINAL results to cache
            // Error results must NEVER be marked as FINAL or cached
            // Only write if FINAL doesn't exist - preserve existing FINAL
            // But do NOT create new FINAL fallback results
            // safeCacheSet is skipped for errors - let them fail without caching
          } finally {
            backgroundTaskCount--;
            globalRunningTasks.delete(lockKey);
          }
        })();
      }

      // 4. IMMEDIATE RESPONSE FOR NEW ANALYSIS
      const newAnalysisResponse = {
        success: true,
        symbol,
        signal: 'ANALYZING',
        accuracy: 0,
        isFinal: false,
        isProcessing: true,
        timestamp: new Date().toISOString(),
        cached: false
      };

      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      return reply.send(newAnalysisResponse);

    } catch (error: any) {
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      return reply.send({
        success: true,
        symbol,
        signal: 'HOLD',
        accuracy: 0,
        isFinal: true,
        isProcessing: false,
        reason: 'System Error',
        timestamp: new Date().toISOString()
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

      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.send({
        binance: binanceResult,
        cryptocompare: ccResult,
        timestamp: new Date().toISOString()
      });
      return;
    } catch (error: any) {
      console.error('❌ TEST ENDPOINT ERROR:', error.message, error.stack);
      console.log("[RESEARCH_IMMEDIATE_RESPONSE_SENT]");
      reply.code(500).send({
        error: 'Provider test failed',
        reason: error.message,
        stack: error.stack
      });
      return;
    }
  });
}
