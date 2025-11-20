import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { researchEngine } from '../services/researchEngine';
import { resolveExchangeConnector } from '../services/exchangeResolver';
import { liveAnalysisService } from '../services/liveAnalysisService';
import { topCoinsService } from '../services/topCoinsService';
import { z } from 'zod';
import { logger } from '../utils/logger';

// Firestore requires manual composite indexes for queries with multiple fields
// If you see index errors, create indexes in Firebase Console
const researchQuerySchema = z.object({
  // Auto-correct limit to max 500 instead of throwing ZodError
  limit: z.coerce.number().int().positive().transform((val) => Math.min(val, 500)).optional().default(100),
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
  }, async (request: FastifyRequest<{ Body: { symbol?: string; symbols?: string[]; forceEngine?: boolean } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const forceEngine = request.body?.forceEngine === true;
    
    // DEBUG: Log incoming request
    console.log('🔍 [RESEARCH/RUN] Incoming request:', {
      body: request.body,
      uid: user?.uid,
      hasUser: !!user,
      forceEngine,
    });
    logger.info({ body: request.body, uid: user?.uid, forceEngine }, 'Research/run request received');
    
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
      // Handle symbol or multi-coin scanning
      let symbols: string[] = [];
      let symbol = request.body?.symbol;
      
      if (symbol && typeof symbol === 'string' && symbol.trim() !== '') {
        // Single symbol provided
        symbols = [symbol.trim().toUpperCase()];
      } else if (request.body?.symbols && Array.isArray(request.body.symbols) && request.body.symbols.length > 0) {
        // Multiple symbols provided
        symbols = request.body.symbols.map((s: string) => s.trim().toUpperCase()).filter((s: string) => s.length > 0);
      } else {
        // No symbol provided - auto pick top 100 coins
        logger.info({ uid: user.uid }, 'No symbol provided, fetching top 100 coins');
        symbols = await topCoinsService.getTop100Coins();
        logger.info({ uid: user.uid, count: symbols.length }, 'Fetched top 100 coins for multi-coin scanning');
      }
      
      if (symbols.length === 0) {
        console.error('🔍 [RESEARCH/RUN] No symbols available');
        reply.code(400).header('Content-Type', 'application/json').send({
          success: false,
          message: 'No symbols available for research',
          results: [],
        });
        return;
      }
      
      // Get exchange adapter once for all symbols
      let exchangeAdapter = null;
      let detectedExchangeName: string = 'Unknown';
      let isFallback = true;
      let exchangeError: string | null = null;
      
      try {
        const resolved = await resolveExchangeConnector(user.uid);
        if (resolved && resolved.connector) {
          exchangeAdapter = resolved.connector;
          const exchangeLower = resolved.exchange.toLowerCase();
          
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
              detectedExchangeName = exchangeLower.charAt(0).toUpperCase() + exchangeLower.slice(1);
          }
          
          isFallback = false;
        } else {
          detectedExchangeName = 'Fallback (No Exchange API)';
        }
      } catch (exchangeErr: any) {
        exchangeError = exchangeErr.message || 'Exchange resolution failed';
        logger.warn({ err: exchangeErr, uid: user.uid }, 'Error resolving exchange connector, using fallback');
        detectedExchangeName = 'Unknown';
      }
      
      // Process all symbols - multi-coin support
      const allResults: any[] = [];
      const maxSymbols = symbols.length > 100 ? 100 : symbols.length; // Limit to 100 for performance
      
      for (let i = 0; i < maxSymbols; i++) {
        const currentSymbol = symbols[i];
        console.log(`🔍 [RESEARCH/RUN] Processing symbol ${i + 1}/${maxSymbols}:`, currentSymbol);
        
        try {
          // ALWAYS call researchEngine.runResearch() once per symbol
          const result: any = await researchEngine.runResearch(currentSymbol, user.uid, exchangeAdapter || undefined, forceEngine);
          
          // Ensure all required fields exist
          if (!('entry' in result)) result.entry = null;
          if (!('exits' in result)) result.exits = [];
          if (!('stopLoss' in result)) result.stopLoss = null;
          if (!('takeProfit' in result)) result.takeProfit = null;
          if (!('side' in result)) result.side = 'NEUTRAL';
          if (!('confidence' in result)) result.confidence = Math.round((result.accuracy || 0.5) * 100);
          if (!('timeframe' in result)) result.timeframe = '5m';
          if (!('signals' in result)) result.signals = [];
          if (!('currentPrice' in result)) result.currentPrice = result.entry || 0;
          if (!('mode' in result)) result.mode = 'LOW';
          if (!('recommendedTrade' in result)) result.recommendedTrade = null;
          if (!('blurFields' in result)) result.blurFields = false;
          if (!('apiCalls' in result)) result.apiCalls = [];
          if (!('liveAnalysis' in result)) {
            result.liveAnalysis = {
              isLive: false,
              lastUpdated: new Date().toISOString(),
              summary: 'Live analysis not available',
              meta: {},
            };
          }
          
          // Add metadata
          const resultWithMetadata = {
            ...result,
            symbol: result.symbol || currentSymbol,
            timestamp: new Date().toISOString(),
            exchange: detectedExchangeName,
            isFallback: isFallback,
            exchangeError: exchangeError || undefined,
          };
          
          allResults.push(resultWithMetadata);
          
          // Register symbol for live analysis (only first symbol for WebSocket)
          if (i === 0) {
            liveAnalysisService.registerSymbol(currentSymbol);
          }
        } catch (symbolErr: any) {
          logger.error({ err: symbolErr, symbol: currentSymbol, uid: user.uid }, 'Error processing symbol in multi-coin scan');
          // Add error result for this symbol
          allResults.push({
            symbol: currentSymbol,
            signal: 'HOLD' as const,
            accuracy: 0.5,
            orderbookImbalance: 0,
            recommendedAction: 'Research error for this symbol',
            microSignals: { spread: 0, volume: 0, priceMomentum: 0, orderbookDepth: 0 },
            entry: null,
            exits: [],
            stopLoss: null,
            takeProfit: null,
            side: 'NEUTRAL' as const,
            confidence: 50,
            timeframe: '5m',
            signals: [],
            currentPrice: 0,
            mode: 'LOW' as const,
            recommendedTrade: null,
            blurFields: false,
            apiCalls: [],
            liveAnalysis: {
              isLive: false,
              lastUpdated: new Date().toISOString(),
              summary: 'Research error',
              meta: {},
            },
            message: `Error: ${symbolErr.message || 'Unknown error'}`,
            timestamp: new Date().toISOString(),
            exchange: detectedExchangeName,
            isFallback: isFallback,
          });
        }
      }
      
      // Send notification for first symbol only
      if (allResults.length > 0) {
        const firstResult = allResults[0];
        try {
          const { getFirebaseAdmin } = await import('../utils/firebase');
          const admin = getFirebaseAdmin();
          if (admin) {
            await firestoreAdapter.createNotification(user.uid, {
              title: 'Deep Research Completed',
              message: `Analyzed ${allResults.length} coin${allResults.length > 1 ? 's' : ''} - Top: ${firstResult.symbol} (${(firstResult.accuracy * 100).toFixed(1)}%)`,
              type: firstResult.signal === 'BUY' ? 'success' : firstResult.signal === 'SELL' ? 'warning' : 'info',
            });
          }
        } catch (notifErr: any) {
          logger.warn({ err: notifErr, uid: user.uid }, 'Failed to send notification (non-critical)');
        }
        
        // Broadcast WebSocket update for first symbol
        try {
          const { userWebSocketManager } = await import('../services/userWebSocketManager');
          userWebSocketManager.broadcastResearchUpdate(firstResult.symbol, {
            symbol: firstResult.symbol,
            result: firstResult,
          });
        } catch (wsErr: any) {
          logger.debug({ err: wsErr }, 'WebSocket broadcast failed (non-critical)');
        }
      }
      
      // Return all results
      const finalResponse = {
        success: true,
        results: allResults,
      };
      
      console.log(`🔍 [RESEARCH/RUN] Completed analysis of ${allResults.length} symbols`);
      console.log('[ENGINE RESULT]', JSON.stringify(finalResponse, null, 2));
      logger.info({ 
        symbolCount: allResults.length,
        forceEngine 
      }, 'Multi-coin Deep Research completed');
      
      reply.code(200).header('Content-Type', 'application/json').send(finalResponse);
      return;
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


  // GET /api/research/live/:symbol - Get latest live analysis for a symbol with full structured data
  fastify.get('/live/:symbol', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { symbol: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      if (!user || !user.uid) {
        return reply.code(401).header('Content-Type', 'application/json').send({
          success: false,
          message: 'Authentication required',
          result: null,
        });
      }

      const symbol = request.params.symbol.toUpperCase().trim();
      
      // Get exchange adapter if available
      let exchangeAdapter = null;
      try {
        const resolved = await resolveExchangeConnector(user.uid);
        if (resolved && resolved.connector) {
          exchangeAdapter = resolved.connector;
        }
      } catch (exchangeErr: any) {
        logger.debug({ err: exchangeErr, uid: user.uid }, 'No exchange connector for live endpoint');
      }
      
      // Run full research to get complete structured data
      const fullResult = await researchEngine.runResearch(symbol, user.uid, exchangeAdapter || undefined);
      
      // Get live analysis if available
      const liveAnalysis = await liveAnalysisService.getLiveAnalysis(symbol, user.uid);
      
      // Build complete response with all fields
      const resultWithMetadata = {
        ...fullResult,
        timestamp: new Date().toISOString(),
        liveAnalysis: liveAnalysis || fullResult.liveAnalysis,
      };

      return reply.code(200).header('Content-Type', 'application/json').send({
        success: true,
        result: resultWithMetadata,
      });
    } catch (error: any) {
      logger.error({ error: error.message, symbol: request.params.symbol }, 'Error getting live analysis');
      return reply.code(500).header('Content-Type', 'application/json').send({
        success: false,
        message: error.message || 'Error fetching live analysis',
        result: null,
      });
    }
  });
}

