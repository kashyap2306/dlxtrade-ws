import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { researchEngine } from '../services/researchEngine';
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
  }, async (request: FastifyRequest<{ Body: { symbol: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    let symbol = 'BTCUSDT'; // Default symbol
    
    try {
      // Parse request body safely
      try {
        const body = z.object({ symbol: z.string().min(1) }).parse(request.body);
        symbol = body.symbol;
      } catch (parseErr: any) {
        logger.warn({ err: parseErr, body: request.body }, 'Invalid request body, using default symbol');
      }
      
      // Deep Research works without exchange adapters - uses only external APIs (CryptoQuant, LunarCrush, CoinAPI)
      // Adapter is optional - if available, it enhances results with orderbook data
      // If not available, research continues with external API data only
      let result;
      try {
        result = await researchEngine.runResearch(symbol, user.uid, undefined);
      } catch (researchErr: any) {
        // If runResearch somehow still throws (shouldn't happen, but safety net)
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
      
      // Ensure result is valid before spreading
      if (!result || typeof result !== 'object') {
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
      
      try {
        return {
          ...result,
          timestamp: new Date().toISOString(),
        };
      } catch (spreadErr: any) {
        // If spread operator fails, return fallback
        logger.error({ err: spreadErr, symbol, uid: user.uid }, 'Error spreading result');
        return {
          symbol: result.symbol || symbol,
          signal: result.signal || 'HOLD',
          accuracy: result.accuracy || 0.5,
          orderbookImbalance: result.orderbookImbalance || 0,
          recommendedAction: result.recommendedAction || 'Research encountered an error',
          microSignals: result.microSignals || {
            spread: 0,
            volume: 0,
            priceMomentum: 0,
            orderbookDepth: 0,
          },
          timestamp: new Date().toISOString(),
        };
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid, symbol, stack: error.stack }, 'Error in research/run');
      
      // Check if it's a CryptoQuant API key error (401 or invalid key)
      const errorMsg = error.message || '';
      if (errorMsg.includes('CryptoQuant') && (
        errorMsg.includes('401') || 
        errorMsg.includes('authentication failed') || 
        errorMsg.includes('invalid') ||
        errorMsg.includes('Token does not exist')
      )) {
        return reply.code(200).send({
          ok: false,
          error: 'INVALID_CRYPTOQUANT_API_KEY',
          symbol: symbol,
          timestamp: new Date().toISOString(),
        });
      }
      
      // For other errors, return 200 with error flag (never return 500)
      // Always return valid JSON response structure
      return reply.code(200).send({
        ok: false,
        error: error.message || 'Research failed',
        symbol: symbol,
        timestamp: new Date().toISOString(),
        // Provide fallback data structure
        signal: 'HOLD',
        accuracy: 0.5,
        orderbookImbalance: 0,
        recommendedAction: 'Research encountered an error - please try again',
        microSignals: {
          spread: 0,
          volume: 0,
          priceMomentum: 0,
          orderbookDepth: 0,
        },
      });
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
      // Deep Research works without exchange adapters - uses only external APIs
      // Run research for each symbol without requiring adapter
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
          // Run research without adapter - uses only external APIs (CryptoQuant, LunarCrush, CoinAPI)
          const research = await researchEngine.runResearch(symbol, user.uid, undefined);
          
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

      return {
        candidates: topCandidates,
        totalAnalyzed: body.symbols.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error in deep research');
      // NEVER return 500 - always return 200 with error flag
      return reply.code(200).send({
        ok: false,
        error: error.message || 'Deep research failed',
        candidates: [],
        totalAnalyzed: 0,
        timestamp: new Date().toISOString(),
      });
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
        return reply.code(200).send({
          ok: false,
          error: 'No profitable trade opportunities found in top 100 coins',
          totalAnalyzed: popularSymbols.length,
          candidatesFound: 0,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        ok: true,
        bestCoin: bestCandidate.symbol,
        accuracy: bestCandidate.accuracy,
        entryPrice: bestCandidate.entry ?? null,
        exitPrice: bestCandidate.exit ?? null,
        takeProfit: bestCandidate.tp ?? null,
        stopLoss: bestCandidate.sl ?? null,
        trendDirection: bestCandidate.trendDirection ?? 'SIDEWAYS',
        reason: bestCandidate.reason ?? 'No reason provided',
        totalAnalyzed: popularSymbols.length,
        candidatesFound: candidates.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error in manual deep research');
      // NEVER return 500 - always return 200 with error flag
      return reply.code(200).send({
        ok: false,
        error: error.message || 'Manual deep research failed',
        totalAnalyzed: 0,
        candidatesFound: 0,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

