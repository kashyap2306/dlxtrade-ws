"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.researchRoutes = researchRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const researchEngine_1 = require("../services/researchEngine");
const autoTradeController_1 = require("../services/autoTradeController");
const fetchValidBinanceSymbols_1 = require("../scripts/fetchValidBinanceSymbols");
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
/**
 * Extract user UID with priority order:
 * 1. request.body.userId
 * 2. request.user?.uid
 * 3. request.query.userId
 * 4. request.headers['x-user-id']
 */
function extractUserUid(request) {
    // Priority 1: request.body.userId
    if (request.body && typeof request.body === 'object' && 'userId' in request.body && request.body.userId) {
        const userId = request.body.userId;
        if (typeof userId === 'string' && userId.trim()) {
            logger_1.logger.debug({ uid: userId, source: 'request.body.userId' }, 'Extracted UID from request body');
            return userId.trim();
        }
    }
    // Priority 2: request.user?.uid (from Firebase auth)
    const user = request.user;
    if (user && user.uid) {
        logger_1.logger.debug({ uid: user.uid, source: 'request.user.uid' }, 'Extracted UID from Firebase auth');
        return user.uid;
    }
    // Priority 3: request.query.userId
    if (request.query && typeof request.query === 'object' && 'userId' in request.query && request.query.userId) {
        const userId = request.query.userId;
        if (typeof userId === 'string' && userId.trim()) {
            logger_1.logger.debug({ uid: userId, source: 'request.query.userId' }, 'Extracted UID from query params');
            return userId.trim();
        }
    }
    // Priority 4: request.headers['x-user-id']
    const headerUid = request.headers['x-user-id'];
    if (headerUid && typeof headerUid === 'string' && headerUid.trim()) {
        logger_1.logger.debug({ uid: headerUid, source: 'x-user-id header' }, 'Extracted UID from header');
        return headerUid.trim();
    }
    logger_1.logger.warn('No valid UID found in any source');
    return null;
}
// Firestore requires manual composite indexes for queries with multiple fields
// If you see index errors, create indexes in Firebase Console
const researchQuerySchema = zod_1.z.object({
    // Auto-correct limit to max 500 instead of throwing ZodError
    limit: zod_1.z.coerce.number().int().positive().transform((val) => Math.min(val, 500)).optional().default(100),
});
async function researchRoutes(fastify) {
    fastify.get('/logs', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const uid = extractUserUid(request);
        if (!uid) {
            return reply.code(401).header('Content-Type', 'application/json').send({
                success: false,
                message: 'Authentication required - no valid user ID found',
                results: [],
            });
        }
        const query = researchQuerySchema.parse(request.query);
        const logs = await firestoreAdapter_1.firestoreAdapter.getResearchLogs(uid, query.limit);
        return logs.map((log) => ({
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
    });
    fastify.post('/run', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // Extract UID using priority order - DO NOT use "system" or any hardcoded UID
        const uid = extractUserUid(request);
        const forceEngine = request.body?.forceEngine === true;
        logger_1.logger.info({ uid, forceEngine }, 'Research/run request received');
        // Validate UID is available
        if (!uid) {
            console.error('🔍 [RESEARCH/RUN] No valid UID found');
            reply.code(401).header('Content-Type', 'application/json').send({
                success: false,
                message: 'Authentication required - no valid user ID found',
                results: [],
            });
            return; // Explicit return to prevent further execution
        }
        // Wrap entire logic in try/catch for comprehensive error handling
        try {
            // ALWAYS auto-select BEST coin from top 100 (ignore any provided symbols)
            logger_1.logger.info({ uid, providedSymbol: request.body?.symbol }, 'AUTO-SELECTION: Starting for research/run');
            const { selectBestSymbolFromTop100 } = await Promise.resolve().then(() => __importStar(require('../services/researchEngine')));
            const selectionResult = await selectBestSymbolFromTop100(uid);
            const symbols = [selectionResult.selectedSymbol];
            logger_1.logger.info({
                uid,
                selectedSymbol: selectionResult.selectedSymbol,
                confidence: selectionResult.confidence,
                reason: selectionResult.reason,
                topCandidates: selectionResult.topCandidates.slice(0, 3) // Log top 3
            }, 'AUTO-SELECTED SYMBOL for research/run');
            if (symbols.length === 0) {
                console.error('🔍 [RESEARCH/RUN] No symbols available');
                reply.code(400).header('Content-Type', 'application/json').send({
                    success: false,
                    message: 'No symbols available for research',
                    results: [],
                });
                return;
            }
            const activeContext = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(uid);
            const detectedExchangeName = (activeContext && typeof activeContext === 'object' && 'exchangeConfigured' in activeContext && activeContext.exchangeConfigured === false)
                ? 'none'
                : (activeContext && 'name' in activeContext ? activeContext.name : 'none');
            const isFallback = false;
            const allResults = [];
            const maxSymbols = Math.min(symbols.length, 100);
            for (let i = 0; i < maxSymbols; i++) {
                const currentSymbol = symbols[i];
                try {
                    const timeframe = request.body?.timeframe || '5m';
                    // Handle fallback object - pass null to runResearch if exchange not configured
                    const contextForResearch = (activeContext && typeof activeContext === 'object' && 'exchangeConfigured' in activeContext && activeContext.exchangeConfigured === false)
                        ? null
                        : activeContext;
                    const result = await researchEngine_1.researchEngine.runResearch(currentSymbol, uid, undefined, false, undefined, timeframe, contextForResearch || undefined);
                    try {
                        const autoDecision = await autoTradeController_1.autoTradeController.processResearch(uid, result);
                        if (autoDecision && (autoDecision.eligible || autoDecision.requiresConfirmation)) {
                            result.autoTradeDecision = autoDecision;
                        }
                    }
                    catch (autoErr) {
                        logger_1.logger.warn({ error: autoErr.message, uid: uid, symbol: currentSymbol }, 'Auto-trade evaluation failed');
                    }
                    const enriched = {
                        ...result,
                        symbol: result.symbol || currentSymbol,
                        timestamp: new Date().toISOString(),
                        exchange: detectedExchangeName,
                        exchangeCount: 1,
                        exchangesUsed: [detectedExchangeName],
                        isFallback,
                        exchangeError: undefined,
                        rsi5: result.rsi5 ?? null,
                        rsi14: result.rsi14 ?? null,
                        trendAnalysis: result.trendAnalysis ?? null,
                        confidenceBreakdown: result.confidenceBreakdown ?? undefined,
                        exchangeTickers: result.exchangeTickers ?? undefined,
                        exchangeOrderbooks: result.exchangeOrderbooks ?? undefined,
                        autoTradeDecision: result.autoTradeDecision ?? undefined,
                    };
                    allResults.push(enriched);
                }
                catch (symbolErr) {
                    if (symbolErr?.missingDependencies?.length) {
                        throw symbolErr;
                    }
                    if (!isFallback) {
                        throw symbolErr;
                    }
                    logger_1.logger.error({ err: symbolErr, symbol: currentSymbol, uid }, 'Fallback research error');
                    const errorMessage = symbolErr?.message || 'Research error';
                    allResults.push({
                        symbol: currentSymbol,
                        status: 'error',
                        signal: 'HOLD',
                        accuracy: 0,
                        orderbookImbalance: 0,
                        recommendedAction: 'Research error for this symbol',
                        microSignals: { spread: 0, volume: 0, priceMomentum: 0, orderbookDepth: 0 },
                        entry: null,
                        exits: [],
                        stopLoss: null,
                        takeProfit: null,
                        side: 'NEUTRAL',
                        confidence: 0,
                        timeframe: request.body?.timeframe || '5m',
                        signals: [],
                        currentPrice: 0,
                        mode: 'LOW',
                        recommendedTrade: null,
                        blurFields: false,
                        apiCalls: [],
                        apiCallReport: [],
                        missingDependencies: [],
                        liveAnalysis: {
                            isLive: false,
                            lastUpdated: new Date().toISOString(),
                            summary: 'Research error',
                            meta: {},
                        },
                        message: `Error: ${errorMessage}`,
                        errorId: symbolErr?.errorId,
                        timestamp: new Date().toISOString(),
                        exchange: detectedExchangeName,
                        isFallback,
                    });
                }
            }
            // Send notification for first symbol only
            if (allResults.length > 0) {
                const firstResult = allResults[0];
                try {
                    const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
                    const admin = getFirebaseAdmin();
                    if (admin) {
                        await firestoreAdapter_1.firestoreAdapter.createNotification(uid, {
                            title: 'Deep Research Completed',
                            message: `Analyzed ${allResults.length} coin${allResults.length > 1 ? 's' : ''} - Top: ${firstResult.symbol} (${(firstResult.accuracy * 100).toFixed(1)}%)`,
                            type: firstResult.signal === 'BUY' ? 'success' : firstResult.signal === 'SELL' ? 'warning' : 'info',
                        });
                    }
                }
                catch (notifErr) {
                    logger_1.logger.warn({ err: notifErr, uid: uid }, 'Failed to send notification (non-critical)');
                }
                // Broadcast WebSocket update for first symbol
                try {
                    const { userWebSocketManager } = await Promise.resolve().then(() => __importStar(require('../services/userWebSocketManager')));
                    userWebSocketManager.broadcastResearchUpdate(firstResult.symbol, {
                        symbol: firstResult.symbol,
                        result: firstResult,
                    });
                }
                catch (wsErr) {
                    logger_1.logger.debug({ err: wsErr }, 'WebSocket broadcast failed (non-critical)');
                }
            }
            // Return full results with all new fields (RSI, trend, exchange tickers, etc.)
            // Do NOT sanitize - frontend needs all fields for DeepResearchCard
            const finalResponse = {
                success: true,
                results: allResults, // Return full results with all new fields
                totalAnalyzed: allResults.length,
            };
            logger_1.logger.info({
                symbolCount: allResults.length,
                forceEngine
            }, 'Multi-coin Deep Research completed');
            reply.code(200).header('Content-Type', 'application/json').send(finalResponse);
            return;
        }
        catch (error) {
            fastify.log.error({ error: error.message, uid, stack: error.stack }, 'Error in research/run');
            logger_1.logger.error({ error: error.message, uid, stack: error.stack }, 'Error in research/run');
            // Determine error type and status code
            let statusCode = 400;
            let errorMessage = error.message || 'Deep Research engine error';
            // Check for ResearchEngineError with custom status code
            if (error.name === 'ResearchEngineError' && error.statusCode) {
                statusCode = error.statusCode;
            }
            // Check for specific error types
            else if (error.response) {
                // Axios error from external API
                statusCode = error.response.status || 500;
                errorMessage = error.response.data?.message || error.response.data?.error || errorMessage;
            }
            else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                statusCode = 503;
                errorMessage = 'Service temporarily unavailable - request timeout';
            }
            else if (error.message?.includes('API key') || error.message?.includes('invalid key')) {
                statusCode = 401;
                errorMessage = 'API key invalid - check exchange credentials';
            }
            else if (error.message?.includes('rate limit')) {
                statusCode = 429;
                errorMessage = 'Rate limit exceeded - please try again later';
            }
            // Return proper error response
            reply.code(statusCode).header('Content-Type', 'application/json').send({
                success: false,
                message: errorMessage,
                results: [],
                missingDependencies: error.missingDependencies || undefined,
            });
            return;
        }
    });
    // MANUAL RESEARCH ROUTE: POST /api/research/manual - Trigger manual research (always returns response)
    fastify.post('/manual', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // Extract UID using priority order - DO NOT use "system" or any hardcoded UID
        const uid = extractUserUid(request);
        logger_1.logger.info({ uid: uid }, 'Manual Research triggered');
        // Validate UID is available
        if (!uid) {
            logger_1.logger.warn('Manual research: no valid UID found');
            reply.code(401).header('Content-Type', 'application/json').send({
                success: false,
                message: 'Authentication required - no valid user ID found',
                results: [],
            });
            return;
        }
        try {
            let symbol = request.body?.symbol; // May be undefined - will auto-pick if not provided
            const timeframe = request.body?.timeframe || '5m';
            const debug = request.body?.debug === true;
            const forceRefresh = request.body?.forceRefresh === true;
            let selectionResult = null;
            // ALWAYS auto-select best symbol from top 100 (ignore any provided symbol)
            logger_1.logger.info({ uid, providedSymbol: request.body?.symbol }, 'AUTO-SELECTION: Starting for manual research');
            const { selectBestSymbolFromTop100 } = await Promise.resolve().then(() => __importStar(require('../services/researchEngine')));
            selectionResult = await selectBestSymbolFromTop100(uid);
            symbol = selectionResult.selectedSymbol;
            logger_1.logger.info({
                uid,
                selectedSymbol: symbol,
                confidence: selectionResult.confidence,
                reason: selectionResult.reason,
                topCandidates: selectionResult.topCandidates.slice(0, 3) // Log top 3
            }, 'AUTO-SELECTED SYMBOL for manual research');
            // Validate that the selected symbol is a valid Binance trading pair
            // Note: This validation is now permissive and will allow research to proceed
            const isValid = await (0, fetchValidBinanceSymbols_1.isValidBinanceSymbol)(symbol);
            if (!isValid) {
                logger_1.logger.warn({ uid, symbol }, 'Symbol validation failed, but allowing research to proceed');
                // Don't reject - allow research to continue with fallback data
            }
            // Get exchange context (will return safe fallback if not configured)
            const activeContext = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(uid);
            // Handle fallback object - pass null to runResearch if exchange not configured
            const contextForResearch = (activeContext && typeof activeContext === 'object' && 'exchangeConfigured' in activeContext && activeContext.exchangeConfigured === false)
                ? null
                : activeContext;
            if (!contextForResearch) {
                logger_1.logger.info({ uid: uid }, 'Manual research: exchange integration not configured');
            }
            // Run research - will fetch API keys from Firestore, NO override keys
            try {
                const result = await researchEngine_1.researchEngine.runResearch(symbol, uid, // Use extracted UID
                undefined, false, undefined, timeframe, contextForResearch || undefined
                // NO overrideKeys - always use Firestore keys
                );
                // Prepare response
                const response = {
                    success: true,
                    message: 'Manual research completed',
                    results: [result],
                    exchangeConfigured: !(activeContext && typeof activeContext === 'object' && 'exchangeConfigured' in activeContext && activeContext.exchangeConfigured === false),
                };
                // Add debug information if requested
                if (debug) {
                    response.debug = {
                        uid,
                        symbol,
                        timeframe,
                        selectionResult,
                        providerDebug: result._providerDebug || {},
                        apiCallReport: result.apiCallReport || [],
                        apiCalls: result.apiCalls || [],
                    };
                }
                reply.code(200).header('Content-Type', 'application/json').send(response);
            }
            catch (researchError) {
                // Manual Research API must NEVER return 500 - convert ALL errors to 400
                reply.code(400).header('Content-Type', 'application/json').send({
                    success: false,
                    message: researchError.message || 'Research failed',
                    results: [],
                });
            }
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid }, 'Manual research failed');
            // Always return a valid response, never crash
            reply.code(500).header('Content-Type', 'application/json').send({
                success: false,
                message: error.message || 'Manual research failed',
                results: [],
                exchangeConfigured: false,
            });
        }
    });
    // TEST ROUTE: POST /api/research/test-run - Test research without authentication
    fastify.post('/test-run', async (request, reply) => {
        try {
            const uid = request.body?.uid || 'test-user-123';
            const timeframe = request.body?.timeframe || '5m';
            const debug = request.body?.debug === true;
            const forceRefresh = request.body?.forceRefresh === true;
            // ALWAYS auto-select best symbol (ignore any provided symbol)
            logger_1.logger.info({ uid, providedSymbol: request.body?.symbol }, 'AUTO-SELECTION: Starting for test-run');
            const { selectBestSymbolFromTop100 } = await Promise.resolve().then(() => __importStar(require('../services/researchEngine')));
            const selectionResult = await selectBestSymbolFromTop100(uid);
            const symbol = selectionResult.selectedSymbol;
            logger_1.logger.info({
                uid,
                selectedSymbol: symbol,
                confidence: selectionResult.confidence,
                reason: selectionResult.reason,
                topCandidates: selectionResult.topCandidates.slice(0, 3) // Log top 3
            }, 'AUTO-SELECTED SYMBOL for test-run');
            const activeContext = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(uid);
            // Handle fallback object - pass null to runResearch if exchange not configured
            const contextForResearch = (activeContext && typeof activeContext === 'object' && 'exchangeConfigured' in activeContext && activeContext.exchangeConfigured === false)
                ? null
                : activeContext;
            const results = await researchEngine_1.researchEngine.runResearch(symbol, uid, undefined, false, undefined, timeframe, contextForResearch || undefined);
            // Prepare response
            const response = {
                success: true,
                message: 'Test research completed',
                results: [results],
            };
            // Add debug information if requested
            if (debug) {
                response.debug = {
                    uid,
                    symbol,
                    timeframe,
                    selectionResult,
                    providerDebug: results._providerDebug || {},
                    apiCallReport: results.apiCallReport || [],
                    apiCalls: results.apiCalls || [],
                };
            }
            reply.code(200).header('Content-Type', 'application/json').send(response);
        }
        catch (error) {
            console.error('🧪 [TEST RESEARCH] Error:', error);
            // Test route must NEVER return 500 - convert ResearchEngineError to 400
            let statusCode = 500;
            if (error.name === 'ResearchEngineError' && error.statusCode) {
                statusCode = error.statusCode;
            }
            else {
                // For non-ResearchEngineError, still return 400 to prevent 500
                statusCode = 400;
            }
            reply.code(statusCode).header('Content-Type', 'application/json').send({
                success: false,
                message: error.message || 'Test research failed',
                results: [],
            });
        }
    });
    // GET /api/research/live/:symbol - Get latest live analysis for a symbol with full structured data
    fastify.get('/live/:symbol', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        // Extract UID using priority order
        const uid = extractUserUid(request);
        if (!uid) {
            return reply.code(401).header('Content-Type', 'application/json').send({
                success: false,
                message: 'Authentication required - no valid user ID found',
                result: null,
            });
        }
        try {
            const symbol = request.params.symbol.toUpperCase().trim();
            const activeContext = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(uid);
            // Handle fallback object - pass null to runResearch if exchange not configured
            const contextForResearch = (activeContext && typeof activeContext === 'object' && 'exchangeConfigured' in activeContext && activeContext.exchangeConfigured === false)
                ? null
                : activeContext;
            const fullResult = await researchEngine_1.researchEngine.runResearch(symbol, uid, undefined, false, undefined, '5m', contextForResearch || undefined);
            // Do NOT call liveAnalysisService.getLiveAnalysis() - it may return old cached data
            // The fullResult from researchEngine already includes liveAnalysis with all new fields
            // Ensure all required fields exist (backward compatibility)
            if (!('entry' in fullResult))
                fullResult.entry = null;
            if (!('exits' in fullResult))
                fullResult.exits = [];
            if (!('stopLoss' in fullResult))
                fullResult.stopLoss = null;
            if (!('takeProfit' in fullResult))
                fullResult.takeProfit = null;
            if (!('side' in fullResult))
                fullResult.side = 'NEUTRAL';
            if (!('confidence' in fullResult))
                fullResult.confidence = Math.round((fullResult.accuracy || 0.5) * 100);
            if (!('timeframe' in fullResult))
                fullResult.timeframe = '5m';
            if (!('signals' in fullResult))
                fullResult.signals = []; // Deprecated but kept for compatibility
            if (!('currentPrice' in fullResult))
                fullResult.currentPrice = fullResult.entry || 0;
            if (!('mode' in fullResult))
                fullResult.mode = 'LOW';
            if (!('recommendedTrade' in fullResult))
                fullResult.recommendedTrade = null;
            if (!('blurFields' in fullResult))
                fullResult.blurFields = false;
            if (!('apiCalls' in fullResult))
                fullResult.apiCalls = []; // Deprecated but kept for compatibility
            if (!('explanations' in fullResult))
                fullResult.explanations = [];
            if (!('liveAnalysis' in fullResult)) {
                fullResult.liveAnalysis = {
                    isLive: false,
                    lastUpdated: new Date().toISOString(),
                    summary: 'Live analysis not available',
                    meta: {},
                };
            }
            // Return full result with all new fields (RSI, trend, exchange tickers, etc.)
            // Do NOT sanitize - frontend needs all fields for DeepResearchCard
            const fullResultWithMetadata = {
                ...fullResult,
                timestamp: new Date().toISOString(),
                summary: fullResult.liveAnalysis?.summary || fullResult.recommendedAction || '',
                // Ensure all new fields are included
                rsi5: fullResult.rsi5 ?? null,
                rsi14: fullResult.rsi14 ?? null,
                trendAnalysis: fullResult.trendAnalysis ?? null,
                confidenceBreakdown: fullResult.confidenceBreakdown ?? undefined,
                exchangeTickers: fullResult.exchangeTickers ?? undefined,
                exchangeOrderbooks: fullResult.exchangeOrderbooks ?? undefined,
                exchangeCount: 1,
                exchangesUsed: [contextForResearch?.name || 'none'],
                autoTradeDecision: fullResult.autoTradeDecision ?? undefined,
            };
            return reply.code(200).header('Content-Type', 'application/json').send({
                success: true,
                result: fullResultWithMetadata,
                liveAnalysis: fullResult.liveAnalysis,
            });
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, symbol: request.params.symbol, uid }, 'Error getting live analysis');
            return reply.code(500).header('Content-Type', 'application/json').send({
                success: false,
                message: error.message || 'Error fetching live analysis',
                result: null,
            });
        }
    });
    // Health check endpoint for provider status
    fastify.get('/health', async (request, reply) => {
        try {
            const { getCircuitBreaker } = await Promise.resolve().then(() => __importStar(require('../utils/circuitBreaker')));
            const { cryptocompareCache, coingeckoCache } = await Promise.resolve().then(() => __importStar(require('../utils/lruCache')));
            // Check provider circuit breaker status
            const providers = {
                binance: { status: getCircuitBreaker('binance').isOpen() ? 'circuit_open' : 'healthy' },
                cryptocompare: { status: getCircuitBreaker('cryptocompare').isOpen() ? 'circuit_open' : 'healthy' },
                marketaux: { status: getCircuitBreaker('marketaux').isOpen() ? 'circuit_open' : 'healthy' },
                coingecko: { status: getCircuitBreaker('coingecko').isOpen() ? 'circuit_open' : 'healthy' },
                googlefinance: { status: getCircuitBreaker('googlefinance').isOpen() ? 'circuit_open' : 'healthy' }
            };
            // Check cache status
            const caches = {
                cryptocompare: {
                    size: cryptocompareCache.size(),
                    maxSize: 200
                },
                coingecko: {
                    size: coingeckoCache.size(),
                    maxSize: 100
                }
            };
            // Check symbol validation cache
            const fs = await Promise.resolve().then(() => __importStar(require('fs')));
            const path = await Promise.resolve().then(() => __importStar(require('path')));
            let symbolCacheStatus = 'missing';
            try {
                const cachePath = path.join(__dirname, '../cache/validSymbols.json');
                if (fs.existsSync(cachePath)) {
                    const stats = fs.statSync(cachePath);
                    symbolCacheStatus = `healthy (${Math.round((Date.now() - stats.mtime.getTime()) / 1000 / 60)} minutes old)`;
                }
            }
            catch (error) {
                symbolCacheStatus = 'error';
            }
            return reply.code(200).header('Content-Type', 'application/json').send({
                success: true,
                timestamp: new Date().toISOString(),
                version: '2.0.0',
                providers,
                caches,
                symbolCache: symbolCacheStatus,
                overall: Object.values(providers).every(p => p.status === 'healthy') ? 'healthy' : 'degraded'
            });
        }
        catch (error) {
            logger_1.logger.error({ error: error.message }, 'Health check failed');
            return reply.code(500).header('Content-Type', 'application/json').send({
                success: false,
                message: 'Health check failed',
                error: error.message
            });
        }
    });
}
