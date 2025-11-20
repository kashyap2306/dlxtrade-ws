import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { researchEngine } from '../services/researchEngine';
import { resolveExchangeConnector } from '../services/exchangeResolver';
import { z } from 'zod';
import { logger } from '../utils/logger';

const researchQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
});

export async function researchRoutes(fastify: FastifyInstance) {
  fastify.get('/logs', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: any }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const query = researchQuerySchema.parse(request.query);
    const logs = await firestoreAdapter.getResearchLogs(user.uid, query.limit);
    
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
  }, async (request: FastifyRequest<{ Body: { symbol?: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    
    // DEBUG: Log incoming request
    console.log('🔍 [RESEARCH/RUN] Incoming request:', {
      body: request.body,
      uid: user?.uid,
      hasUser: !!user,
    });
    logger.info({ body: request.body, uid: user?.uid }, 'Research/run request received');
    
    // Validate user is authenticated
    if (!user || !user.uid) {
      console.error('🔍 [RESEARCH/RUN] User not authenticated');
      reply.code(401).header('Content-Type', 'application/json').send({
        success: false,
        message: 'Authentication required',
        results: [],
      });
      return; // Explicit return to prevent further execution
    }
    
    // Wrap entire logic in try/catch for comprehensive error handling
    try {
      // Validate symbol is provided
      let symbol = request.body?.symbol;
      if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
        console.error('🔍 [RESEARCH/RUN] Symbol not provided');
        reply.code(400).header('Content-Type', 'application/json').send({
          success: false,
          message: 'Symbol not provided',
          results: [],
        });
        return;
      }
      
      symbol = symbol.trim().toUpperCase();
      console.log('🔍 [RESEARCH/RUN] Parsed symbol:', symbol);
      
      // Deep Research: Try to get user's exchange connector, but continue with fallback if not available
      // NEVER fail research if exchange API is missing - use fallback engines (CryptoQuant, CoinAPI, etc.)
      let exchangeAdapter = null;
      let detectedExchangeName: string = 'Unknown';
      let isFallback = true;
      let exchangeError: string | null = null;
      
      try {
        const resolved = await resolveExchangeConnector(user.uid);
        if (resolved && resolved.connector) {
          exchangeAdapter = resolved.connector;
          const exchangeLower = resolved.exchange.toLowerCase();
          
          // Format exchange name properly (capitalize first letter, handle special cases)
          switch (exchangeLower) {
            case 'binance':
              detectedExchangeName = 'Binance';
              break;
            case 'bitget':
              detectedExchangeName = 'Bitget';
              break;
            case 'bingx':
              detectedExchangeName = 'BingX';
              break;
            case 'weex':
              detectedExchangeName = 'WEEX';
              break;
            case 'bybit':
              detectedExchangeName = 'Bybit';
              break;
            case 'kucoin':
              detectedExchangeName = 'KuCoin';
              break;
            case 'okx':
              detectedExchangeName = 'OKX';
              break;
            default:
              // Capitalize first letter for unknown exchange types
              detectedExchangeName = exchangeLower.charAt(0).toUpperCase() + exchangeLower.slice(1);
          }
          
          isFallback = false;
          console.log('[DEEP-RESEARCH] Using exchange:', detectedExchangeName);
        } else {
          // No exchange API found - use fallback
          detectedExchangeName = 'Fallback (No Exchange API)';
          console.log('[DEEP-RESEARCH] No exchange API found, using fallback engines');
        }
      } catch (exchangeErr: any) {
        // Log error but continue with fallback
        exchangeError = exchangeErr.message || 'Exchange resolution failed';
        logger.warn({ err: exchangeErr, uid: user.uid }, 'Error resolving exchange connector, using fallback');
        console.log('[DEEP-RESEARCH] Exchange resolution failed, using fallback engines');
        // If there's an error during extraction, mark as Unknown (extraction failed)
        // This means we couldn't even check if exchange exists - extraction error
        if (detectedExchangeName === 'Unknown') {
          // Keep as Unknown since extraction actually failed
          console.log('[DEEP-RESEARCH] Exchange extraction failed, marking as Unknown');
        } else {
          // This shouldn't happen, but if exchange was already set, keep it
          // Otherwise, if we got here without setting exchange, it means extraction failed
          detectedExchangeName = 'Unknown';
        }
      }
      
      console.log('[DEEP-RESEARCH] Fallback mode:', isFallback);
      console.log('[DEEP-RESEARCH] Detected exchange:', detectedExchangeName);
      
      // Run research with or without exchange adapter
      let result;
      try {
        console.log('🔍 [RESEARCH/RUN] Calling researchEngine.runResearch with:', { symbol, uid: user.uid, hasAdapter: !!exchangeAdapter });
        result = await researchEngine.runResearch(symbol, user.uid, exchangeAdapter || undefined);
        console.log('🔍 [RESEARCH/RUN] researchEngine.runResearch returned - type:', typeof result);
        console.log('🔍 [RESEARCH/RUN] researchEngine.runResearch returned - keys:', result ? Object.keys(result) : 'null/undefined');
        console.log('🔍 [RESEARCH/RUN] researchEngine.runResearch returned - full:', JSON.stringify(result, null, 2));
      } catch (researchErr: any) {
        // If runResearch somehow still throws (shouldn't happen, but safety net)
        console.error('🔍 [RESEARCH/RUN] runResearch threw error:', researchErr);
        logger.error({ err: researchErr, symbol, uid: user.uid }, 'runResearch threw error (unexpected)');
        result = {
          symbol,
          signal: 'HOLD' as const,
          accuracy: 0.5,
          orderbookImbalance: 0,
          recommendedAction: 'Research encountered an error - please try again',
          microSignals: {
            spread: 0,
            volume: 0,
            priceMomentum: 0,
            orderbookDepth: 0,
          },
        };
      }
      
      // Ensure result is valid
      if (!result || typeof result !== 'object') {
        console.error('🔍 [RESEARCH/RUN] Invalid result from runResearch:', result);
        logger.error({ result, symbol, uid: user.uid }, 'Invalid result from runResearch');
        result = {
          symbol,
          signal: 'HOLD' as const,
          accuracy: 0.5,
          orderbookImbalance: 0,
          recommendedAction: 'Research encountered an error - please try again',
          microSignals: {
            spread: 0,
            volume: 0,
            priceMomentum: 0,
            orderbookDepth: 0,
          },
        };
      }
      
      // Validate symbol exists in result
      if (!result.symbol || result.symbol.trim() === '') {
        console.error('🔍 [RESEARCH/RUN] Result missing symbol, using provided symbol');
        result.symbol = symbol;
      }
      
      // Add timestamp and exchange info to result
      // Exchange name should always be set - either detected exchange, "Fallback (No Exchange API)", or "Unknown"
      // "Unknown" only occurs when extraction fails (error during resolution)
      // "Fallback (No Exchange API)" occurs when no exchange API is connected
      const resultWithMetadata = {
        ...result,
        timestamp: new Date().toISOString(),
        exchange: detectedExchangeName, // Always set - either exchange name, "Fallback (No Exchange API)", or "Unknown"
        isFallback: isFallback,
        exchangeError: exchangeError || undefined, // Include error if exchange resolution failed
      };
      
      console.log('[DEEP-RESEARCH] Final exchange name:', detectedExchangeName);
      console.log('[DEEP-RESEARCH] Is fallback:', isFallback);
      console.log('[DEEP-RESEARCH] Exchange error:', exchangeError || 'none');
      
      // Transform result into final response format - NO WRAPPERS
      const finalResponse = {
        success: true,
        results: Array.isArray(resultWithMetadata) ? resultWithMetadata : [resultWithMetadata],
      };
      
      console.log('[DEEP-RESEARCH] Final Response:', JSON.stringify(finalResponse, null, 2));
      console.log('🔍 [RESEARCH/RUN] Final response before sending:', JSON.stringify(finalResponse, null, 2));
      console.log('🔍 [RESEARCH/RUN] Response has success?', 'success' in finalResponse);
      console.log('🔍 [RESEARCH/RUN] Response has results?', 'results' in finalResponse);
      console.log('🔍 [RESEARCH/RUN] Response has data?', 'data' in finalResponse);
      console.log('🔍 [RESEARCH/RUN] Response has result?', 'result' in finalResponse);
      
      // Send notification (non-blocking - wrapped in try/catch so it doesn't block research)
      try {
        const { getFirebaseAdmin } = await import('../utils/firebase');
        const admin = getFirebaseAdmin();
        if (admin) {
          await firestoreAdapter.createNotification(user.uid, {
            title: 'Deep Research Completed',
            message: `Analyzed ${symbol} - Signal: ${result.signal}, Accuracy: ${(result.accuracy * 100).toFixed(1)}%`,
            type: result.signal === 'BUY' ? 'success' : result.signal === 'SELL' ? 'warning' : 'info',
          });
        }
      } catch (notifErr: any) {
        // Log but don't fail research if notification fails
        logger.warn({ err: notifErr, uid: user.uid }, 'Failed to send notification (non-critical)');
      }
      
      // Send response - NO WRAPPERS, NO RETURN OBJECT
      reply.code(200).header('Content-Type', 'application/json').send(finalResponse);
      return; // Explicit return to prevent further execution
    } catch (error: any) {
      fastify.log.error({ error: error.message, uid: user?.uid, stack: error.stack }, 'Error in research/run');
      logger.error({ error: error.message, uid: user?.uid, stack: error.stack }, 'Error in research/run');
      
      // Determine error type and status code
      let statusCode = 500;
      let errorMessage = error.message || 'Deep Research engine internal error';
      
      // Check for specific error types
      if (error.response) {
        // Axios error from external API
        statusCode = error.response.status || 500;
        errorMessage = error.response.data?.message || error.response.data?.error || errorMessage;
      } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        statusCode = 503;
        errorMessage = 'Service temporarily unavailable - request timeout';
      } else if (error.message?.includes('API key') || error.message?.includes('invalid key')) {
        statusCode = 401;
        errorMessage = 'API key invalid - check exchange credentials';
      } else if (error.message?.includes('rate limit')) {
        statusCode = 429;
        errorMessage = 'Rate limit exceeded - please try again later';
      }
      
      // Return proper error response
      reply.code(statusCode).header('Content-Type', 'application/json').send({
        success: false,
        message: errorMessage,
        results: [],
      });
      return;
    }
  });

  // Deep Research endpoint
  fastify.post('/deep-run', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { symbols?: string[]; topN?: number } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = z.object({
      symbols: z.array(z.string()).optional().default(['BTCUSDT']),
      topN: z.number().int().positive().max(10).optional().default(3),
    }).parse(request.body);

    try {
      // Try to get user's exchange connector (optional - fallback if not available)
      let exchangeAdapter = null;
      try {
        const resolved = await resolveExchangeConnector(user.uid);
        if (resolved && resolved.connector) {
          exchangeAdapter = resolved.connector;
          console.log('[DEEP-RESEARCH] Using exchange for deep-run:', resolved.exchange);
        }
      } catch (exchangeErr: any) {
        logger.warn({ err: exchangeErr, uid: user.uid }, 'Error resolving exchange connector for deep-run, using fallback');
      }
      
      // Deep Research works without exchange adapters - uses only external APIs
      // Run research for each symbol with optional exchange adapter
      const candidates: Array<{
        symbol: string;
        signal: 'BUY' | 'SELL' | 'HOLD';
        accuracy: number;
        entry?: number;
        size?: number;
        sl?: number;
        tp?: number;
        details: any;
      }> = [];

      for (const symbol of body.symbols) {
        try {
          // Run research with optional exchange adapter - uses external APIs (CryptoQuant, LunarCrush, CoinAPI) as fallback
          const research = await researchEngine.runResearch(symbol, user.uid, exchangeAdapter || undefined);
          
          // Entry, size, stop-loss, take-profit are optional and only calculated if adapter is available
          // For now, we skip price calculations since they require orderbook data
          // Research results still include signal, accuracy, and recommendations
          let entry: number | undefined;
          let size: number | undefined;
          let sl: number | undefined;
          let tp: number | undefined;

          // Only calculate entry/size/sl/tp if we have sufficient data and signal is not HOLD
          let settings;
          try {
            settings = await firestoreAdapter.getSettings(user.uid);
          } catch (settingsErr: any) {
            logger.debug({ err: settingsErr, uid: user.uid }, 'Could not fetch settings, using defaults');
            settings = null;
          }
          if (research.signal !== 'HOLD' && research.accuracy >= (settings?.minAccuracyThreshold || 0.85)) {
            // Without orderbook data, we can't calculate exact entry prices
            // These fields remain undefined, but research data is still valid
            const quoteSize = settings?.quoteSize || 0.001;
            size = quoteSize;
            
            // Note: entry, sl, tp require orderbook data which is not available without adapter
            // Research still provides signal and accuracy based on external APIs
          }

          candidates.push({
            symbol,
            signal: research.signal,
            accuracy: research.accuracy,
            entry,
            size,
            sl,
            tp,
            details: {
              orderbookImbalance: research.orderbookImbalance,
              recommendedAction: research.recommendedAction,
              microSignals: research.microSignals,
            },
          });
        } catch (err: any) {
          logger.error({ err, symbol, uid: user.uid }, 'Error in deep research for symbol');
        }
      }

      // Sort by accuracy and return top N
      candidates.sort((a, b) => b.accuracy - a.accuracy);
      const topCandidates = candidates.slice(0, body.topN).filter(c => c.signal !== 'HOLD');

      // If autoTrade is enabled and any candidate passes threshold, auto-execute
      let settings;
      try {
        settings = await firestoreAdapter.getSettings(user.uid);
      } catch (settingsErr: any) {
        logger.debug({ err: settingsErr, uid: user.uid }, 'Could not fetch settings for autoTrade check');
        settings = null;
      }
      if (settings?.autoTradeEnabled && topCandidates.length > 0) {
        const { accuracyEngine } = await import('../services/accuracyEngine');
        const { userEngineManager } = await import('../services/userEngineManager');
        const userEngine = userEngineManager.getUserEngine(user.uid);
        
        if (userEngine && userEngine.accuracyEngine) {
          // Let the accuracy engine handle execution
          logger.info({ uid: user.uid, candidates: topCandidates.length }, 'Auto-executing deep research candidates');
        }
      }

      const deepRunResponse = {
        success: true,
        results: topCandidates,
      };
      console.log('🔍 [RESEARCH/DEEP-RUN] Sending response:', {
        success: deepRunResponse.success,
        resultsCount: deepRunResponse.results.length,
      });
      reply.code(200).header('Content-Type', 'application/json').send(deepRunResponse);
      return; // Explicit return to prevent further execution
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error in deep research');
      // NEVER return 500 - always return 200 with error flag
      const deepRunErrorResponse = {
        success: false,
        error: error.message || 'Deep research failed',
        results: [],
      };
      reply.code(200).header('Content-Type', 'application/json').send(deepRunErrorResponse);
      return; // Explicit return to prevent further execution
    }
  });

  // Manual Deep Research endpoint - analyzes popular coins
  // Works without exchange adapter - uses only external APIs (CryptoQuant, LunarCrush, CoinAPI)
  fastify.get('/manual', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      // Use a hardcoded list of popular coins for analysis (no exchange adapter required)
      const popularSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'DOGEUSDT',
        'AVAXUSDT', 'SHIBUSDT', 'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'LINKUSDT', 'ATOMUSDT', 'ETCUSDT',
        'XLMUSDT', 'NEARUSDT', 'ALGOUSDT', 'VETUSDT', 'ICPUSDT', 'FILUSDT', 'TRXUSDT', 'EOSUSDT',
        'AAVEUSDT', 'AXSUSDT', 'THETAUSDT', 'SANDUSDT', 'MANAUSDT', 'GALAUSDT', 'CHZUSDT', 'ENJUSDT',
        'HBARUSDT', 'EGLDUSDT', 'FLOWUSDT', 'XTZUSDT', 'ZECUSDT', 'DASHUSDT', 'WAVESUSDT', 'ZILUSDT',
        'IOTAUSDT', 'ONTUSDT', 'QTUMUSDT', 'ZRXUSDT', 'BATUSDT', 'OMGUSDT', 'SNXUSDT', 'MKRUSDT',
        'COMPUSDT', 'YFIUSDT', 'SUSHIUSDT', 'CRVUSDT', '1INCHUSDT', 'ALPHAUSDT', 'RENUSDT', 'KSMUSDT',
        'GRTUSDT', 'BANDUSDT', 'OCEANUSDT', 'NMRUSDT', 'COTIUSDT', 'ANKRUSDT', 'BALUSDT', 'STORJUSDT',
        'KNCUSDT', 'LRCUSDT', 'CVCUSDT', 'FTMUSDT', 'ZENUSDT', 'SKLUSDT', 'LUNAUSDT', 'RUNEUSDT',
        'CAKEUSDT', 'BAKEUSDT', 'BURGERUSDT', 'SXPUSDT', 'XVSUSDT', 'ALPACAUSDT', 'AUTOUSDT', 'REEFUSDT',
        'DODOUSDT', 'LINAUSDT', 'PERPUSDT', 'RIFUSDT', 'OMUSDT', 'PONDUSDT', 'DEGOUSDT', 'ALICEUSDT',
        'LITUSDT', 'SFPUSDT', 'DYDXUSDT', 'GALAUSDT', 'CELRUSDT', 'KLAYUSDT', 'ARPAUSDT', 'CTSIUSDT',
        'LTOUSDT', 'FEARUSDT', 'ADXUSDT', 'AUCTIONUSDT', 'DARUSDT', 'BNXUSDT', 'RGTUSDT', 'MOVRUSDT',
        'CITYUSDT', 'ENSUSDT', 'KP3RUSDT', 'QIUSDT', 'PORTOUSDT', 'POWRUSDT', 'VGXUSDT', 'JASMYUSDT',
        'AMPUSDT', 'PLAUSDT', 'PYTHUSDT', 'PENDLEUSDT', 'PIXELUSDT', 'ACEUSDT', 'NFPUSDT', 'AIUSDT',
      ].slice(0, 100); // Limit to 100 symbols

      logger.info({ uid: user.uid, symbolCount: popularSymbols.length }, 'Starting manual deep research on popular coins (no exchange adapter required)');

      // Run research for each symbol without adapter
      const candidates: Array<{
        symbol: string;
        signal: 'BUY' | 'SELL' | 'HOLD';
        accuracy: number;
        entry?: number;
        exit?: number;
        tp?: number;
        sl?: number;
        trendDirection?: 'UP' | 'DOWN' | 'SIDEWAYS';
        reason?: string;
      }> = [];

      for (const symbol of popularSymbols) {
        try {
          // Run research without adapter - uses only external APIs
          const research = await researchEngine.runResearch(symbol, user.uid, undefined);
          
          // Skip HOLD signals
          if (research.signal === 'HOLD') continue;

          // Without orderbook data, we can't calculate exact entry/exit prices
          // But we can still provide research results with signal and accuracy
          let entry: number | undefined;
          let exit: number | undefined;
          let tp: number | undefined;
          let sl: number | undefined;
          let trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';

          // Build reason based on available research data
          const reason = `High accuracy signal (${(research.accuracy * 100).toFixed(1)}%) with ${research.signal} recommendation. Orderbook imbalance: ${(research.orderbookImbalance * 100).toFixed(2)}%. ${research.recommendedAction}`;

          candidates.push({
            symbol,
            signal: research.signal,
            accuracy: research.accuracy,
            entry,
            exit,
            tp,
            sl,
            trendDirection,
            reason,
          });
        } catch (err: any) {
          logger.error({ err, symbol, uid: user.uid }, 'Error in manual research for symbol');
          // Continue with next symbol
        }
      }

      // Sort by accuracy and find the best candidate
      candidates.sort((a, b) => b.accuracy - a.accuracy);
      const bestCandidate = candidates[0];

      if (!bestCandidate) {
        // Return 200 with error flag instead of 404
        const manualErrorResponse = {
          success: false,
          error: 'No profitable trade opportunities found in top 100 coins',
          results: [],
        };
        reply.code(200).header('Content-Type', 'application/json').send(manualErrorResponse);
        return; // Explicit return to prevent further execution
      }

      const manualResponse = {
        success: true,
        results: [{
          symbol: bestCandidate.symbol,
          accuracy: bestCandidate.accuracy,
          entryPrice: bestCandidate.entry ?? null,
          exitPrice: bestCandidate.exit ?? null,
          takeProfit: bestCandidate.tp ?? null,
          stopLoss: bestCandidate.sl ?? null,
          trendDirection: bestCandidate.trendDirection ?? 'SIDEWAYS',
          reason: bestCandidate.reason ?? 'No reason provided',
        }],
      };
      console.log('🔍 [RESEARCH/MANUAL] Sending response:', {
        success: manualResponse.success,
        resultsCount: manualResponse.results.length,
      });
      reply.code(200).header('Content-Type', 'application/json').send(manualResponse);
      return; // Explicit return to prevent further execution
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error in manual deep research');
      // NEVER return 500 - always return 200 with error flag
      const manualErrorResponse = {
        success: false,
        error: error.message || 'Manual deep research failed',
        results: [],
      };
      reply.code(200).header('Content-Type', 'application/json').send(manualErrorResponse);
      return; // Explicit return to prevent further execution
    }
  });
}

