import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { researchEngine } from '../services/researchEngine';
import { resolveExchangeConnector } from '../services/exchangeResolver';
// Note: liveAnalysisService is deprecated - all analysis now comes from researchEngine.runResearch()
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
  }, async (request: FastifyRequest<{ Body: { symbol?: string; symbols?: string[]; forceEngine?: boolean; timeframe?: string } }>, reply: FastifyReply) => {
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
      
      // Get ALL connected exchanges for aggregation
      let allExchanges: Array<{ exchange: string; adapter: any; credentials: any }> = [];
      let exchangeAdapter = null; // Primary adapter for compatibility
      let detectedExchangeName: string = 'Unknown';
      let isFallback = true;
      let exchangeError: string | null = null;
      
      try {
        // Get all API keys for user to find all connected exchanges
        const apiKeys = await firestoreAdapter.getApiKeys(user.uid);
        
        for (const key of apiKeys) {
          try {
            const exchange = key.exchange.toLowerCase().trim();
            const validExchanges = ['binance', 'bitget', 'bingx', 'weex', 'kucoin', 'bybit', 'okx'];
            
            if (!validExchanges.includes(exchange)) {
              continue;
            }
            
            const { decrypt } = await import('../services/keyManager');
            const apiKey = decrypt(key.apiKeyEncrypted);
            const secret = decrypt(key.apiSecretEncrypted);
            const passphrase = (key as any).passphraseEncrypted ? decrypt((key as any).passphraseEncrypted) : undefined;
            
            if (!apiKey || !secret) {
              continue;
            }
            
            // Only create connectors for supported exchange types
            if (['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
              const { ExchangeConnectorFactory } = await import('../services/exchangeConnector');
              const exchangeName = exchange as 'binance' | 'bitget' | 'weex' | 'bingx';
              
              try {
                const adapter = ExchangeConnectorFactory.create(exchangeName, {
                  apiKey,
                  secret,
                  passphrase,
                  testnet: key.testnet ?? true,
                });
                
                allExchanges.push({
                  exchange,
                  adapter,
                  credentials: { apiKey, secret, passphrase, testnet: key.testnet ?? true },
                });
                
                // Use first exchange as primary adapter
                if (!exchangeAdapter) {
                  exchangeAdapter = adapter;
                  switch (exchange) {
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
                    default:
                      detectedExchangeName = exchange.charAt(0).toUpperCase() + exchange.slice(1);
                  }
                  isFallback = false;
                }
              } catch (createErr: any) {
                logger.warn({ err: createErr, uid: user.uid, exchange }, 'Failed to create exchange connector');
              }
            }
          } catch (keyErr: any) {
            logger.debug({ err: keyErr, exchange: key.exchange }, 'Error processing API key');
          }
        }
        
        // Fallback to single exchange resolver if no exchanges found
        if (allExchanges.length === 0) {
          const resolved = await resolveExchangeConnector(user.uid);
          if (resolved && resolved.connector) {
            exchangeAdapter = resolved.connector;
            allExchanges.push({
              exchange: resolved.exchange,
              adapter: resolved.connector,
              credentials: resolved.credentials,
            });
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
              default:
                detectedExchangeName = exchangeLower.charAt(0).toUpperCase() + exchangeLower.slice(1);
            }
            isFallback = false;
          } else {
            detectedExchangeName = 'Fallback (No Exchange API)';
          }
        } else {
          logger.info({ uid: user.uid, exchangeCount: allExchanges.length, exchanges: allExchanges.map(e => e.exchange) }, 
            `Found ${allExchanges.length} connected exchanges for research`);
        }
      } catch (exchangeErr: any) {
        exchangeError = exchangeErr.message || 'Exchange resolution failed';
        logger.warn({ err: exchangeErr, uid: user.uid }, 'Error resolving exchanges, using fallback');
        detectedExchangeName = 'Unknown';
      }
      
      // Process all symbols - multi-coin support
      const allResults: any[] = [];
      const maxSymbols = symbols.length > 100 ? 100 : symbols.length; // Limit to 100 for performance
      
      for (let i = 0; i < maxSymbols; i++) {
        const currentSymbol = symbols[i];
        console.log(`🔍 [RESEARCH/RUN] Processing symbol ${i + 1}/${maxSymbols}:`, currentSymbol);
        
        try {
          // Extract timeframe from request body, default to '5m'
          const timeframe = request.body?.timeframe || '5m';
          
          // ALWAYS call researchEngine.runResearch() with ALL connected exchanges for aggregation
          const result: any = await researchEngine.runResearch(
            currentSymbol, 
            user.uid, 
            exchangeAdapter || undefined, 
            forceEngine,
            allExchanges, // Pass ALL exchanges for aggregation
            timeframe // Pass timeframe parameter
          );
          
          // researchEngine.runResearch() already returns all required fields including new ones
          // Only set defaults for backward compatibility if fields are truly missing
          if (!('entry' in result)) result.entry = null;
          if (!('exits' in result)) result.exits = [];
          if (!('stopLoss' in result)) result.stopLoss = null;
          if (!('takeProfit' in result)) result.takeProfit = null;
          if (!('side' in result)) result.side = 'NEUTRAL';
          if (!('confidence' in result)) result.confidence = Math.round((result.accuracy || 0.5) * 100);
          if (!('timeframe' in result)) result.timeframe = '5m';
          if (!('currentPrice' in result)) result.currentPrice = result.entry || 0;
          if (!('mode' in result)) result.mode = 'LOW';
          if (!('recommendedTrade' in result)) result.recommendedTrade = null;
          if (!('blurFields' in result)) result.blurFields = false;
          // Deprecated fields - kept for backward compatibility only
          if (!('signals' in result)) result.signals = [];
          if (!('apiCalls' in result)) result.apiCalls = [];
          if (!('explanations' in result)) result.explanations = [];
          if (!('liveAnalysis' in result)) {
            result.liveAnalysis = {
              isLive: false,
              lastUpdated: new Date().toISOString(),
              summary: 'Live analysis not available',
              meta: {},
            };
          }
          // Ensure new fields are present (researchEngine should already include them)
          if (result.rsi5 === undefined) result.rsi5 = null;
          if (result.rsi14 === undefined) result.rsi14 = null;
          if (result.trendAnalysis === undefined) result.trendAnalysis = null;
          if (result.confidenceBreakdown === undefined) result.confidenceBreakdown = undefined;
          if (result.exchangeTickers === undefined) result.exchangeTickers = undefined;
          if (result.exchangeOrderbooks === undefined) result.exchangeOrderbooks = undefined;
          if (result.autoTradeDecision === undefined) result.autoTradeDecision = undefined;
          
          // Add metadata including exchange count and ensure all new fields are included
          const resultWithMetadata = {
            ...result,
            symbol: result.symbol || currentSymbol,
            timestamp: new Date().toISOString(),
            exchange: detectedExchangeName,
            exchangeCount: allExchanges.length,
            exchangesUsed: allExchanges.map(e => e.exchange),
            isFallback: isFallback,
            exchangeError: exchangeError || undefined,
            // Ensure all new fields from researchEngine are included
            rsi5: result.rsi5 ?? null,
            rsi14: result.rsi14 ?? null,
            trendAnalysis: result.trendAnalysis ?? null,
            confidenceBreakdown: result.confidenceBreakdown ?? undefined,
            exchangeTickers: result.exchangeTickers ?? undefined,
            exchangeOrderbooks: result.exchangeOrderbooks ?? undefined,
            autoTradeDecision: result.autoTradeDecision ?? undefined,
          };
          
          allResults.push(resultWithMetadata);
          
          // Note: Live analysis is now handled by deepResearchScheduler
          // No need to register symbols with liveAnalysisService
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
      
      // Return full results with all new fields (RSI, trend, exchange tickers, etc.)
      // Do NOT sanitize - frontend needs all fields for DeepResearchCard
      const finalResponse = {
        success: true,
        results: allResults, // Return full results with all new fields
        totalAnalyzed: allResults.length,
      };
      
      console.log(`🔍 [RESEARCH/RUN] Completed analysis of ${allResults.length} symbols`);
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
      
      // Get ALL connected exchanges for aggregation
      let allExchanges: Array<{ exchange: string; adapter: any; credentials: any }> = [];
      let exchangeAdapter = null;
      
      try {
        // Get all API keys for user
        const apiKeys = await firestoreAdapter.getApiKeys(user.uid);
        
        for (const key of apiKeys) {
          try {
            const exchange = key.exchange.toLowerCase().trim();
            if (!['binance', 'bitget', 'bingx', 'weex', 'kucoin', 'bybit', 'okx'].includes(exchange)) {
              continue;
            }
            
            const { decrypt } = await import('../services/keyManager');
            const apiKey = decrypt(key.apiKeyEncrypted);
            const secret = decrypt(key.apiSecretEncrypted);
            const passphrase = (key as any).passphraseEncrypted ? decrypt((key as any).passphraseEncrypted) : undefined;
            
            if (!apiKey || !secret) continue;
            
            if (['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
              const { ExchangeConnectorFactory } = await import('../services/exchangeConnector');
              const exchangeName = exchange as 'binance' | 'bitget' | 'weex' | 'bingx';
              
              try {
                const adapter = ExchangeConnectorFactory.create(exchangeName, {
                  apiKey,
                  secret,
                  passphrase,
                  testnet: key.testnet ?? true,
                });
                
                allExchanges.push({
                  exchange,
                  adapter,
                  credentials: { apiKey, secret, passphrase, testnet: key.testnet ?? true },
                });
                
                if (!exchangeAdapter) {
                  exchangeAdapter = adapter;
                }
              } catch (createErr: any) {
                logger.debug({ err: createErr, exchange }, 'Failed to create connector');
              }
            }
          } catch (keyErr: any) {
            logger.debug({ err: keyErr }, 'Error processing API key');
          }
        }
        
        // Fallback to single exchange resolver
        if (allExchanges.length === 0) {
          const resolved = await resolveExchangeConnector(user.uid);
          if (resolved && resolved.connector) {
            exchangeAdapter = resolved.connector;
            allExchanges.push({
              exchange: resolved.exchange,
              adapter: resolved.connector,
              credentials: resolved.credentials,
            });
          }
        }
      } catch (exchangeErr: any) {
        logger.debug({ err: exchangeErr, uid: user.uid }, 'No exchange connectors for live endpoint');
      }
      
      // Run full research to get complete structured data with ALL exchanges
      // This is the ONLY source of truth - researchEngine.runResearch() returns all new fields
      const fullResult: any = await researchEngine.runResearch(
        symbol, 
        user.uid, 
        exchangeAdapter || undefined,
        false,
        allExchanges // Pass ALL exchanges for aggregation
      );
      
      // Do NOT call liveAnalysisService.getLiveAnalysis() - it may return old cached data
      // The fullResult from researchEngine already includes liveAnalysis with all new fields
      
      // Ensure all required fields exist (backward compatibility)
      if (!('entry' in fullResult)) fullResult.entry = null;
      if (!('exits' in fullResult)) fullResult.exits = [];
      if (!('stopLoss' in fullResult)) fullResult.stopLoss = null;
      if (!('takeProfit' in fullResult)) fullResult.takeProfit = null;
      if (!('side' in fullResult)) fullResult.side = 'NEUTRAL';
      if (!('confidence' in fullResult)) fullResult.confidence = Math.round((fullResult.accuracy || 0.5) * 100);
      if (!('timeframe' in fullResult)) fullResult.timeframe = '5m';
      if (!('signals' in fullResult)) fullResult.signals = []; // Deprecated but kept for compatibility
      if (!('currentPrice' in fullResult)) fullResult.currentPrice = fullResult.entry || 0;
      if (!('mode' in fullResult)) fullResult.mode = 'LOW';
      if (!('recommendedTrade' in fullResult)) fullResult.recommendedTrade = null;
      if (!('blurFields' in fullResult)) fullResult.blurFields = false;
      if (!('apiCalls' in fullResult)) fullResult.apiCalls = []; // Deprecated but kept for compatibility
      if (!('explanations' in fullResult)) fullResult.explanations = [];
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
        exchangeCount: allExchanges.length,
        exchangesUsed: allExchanges.map(e => e.exchange),
        autoTradeDecision: fullResult.autoTradeDecision ?? undefined,
      };

      return reply.code(200).header('Content-Type', 'application/json').send({
        success: true,
        result: fullResultWithMetadata,
        liveAnalysis: fullResult.liveAnalysis,
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

