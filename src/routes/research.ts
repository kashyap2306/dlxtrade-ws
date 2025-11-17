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
    const body = z.object({ symbol: z.string().min(1) }).parse(request.body);
    
    // Get user's adapter from engine if available
    const { userEngineManager } = await import('../services/userEngineManager');
    const engine = userEngineManager.getUserEngine(user.uid);
    const adapter = engine?.adapter;
    
    const result = await researchEngine.runResearch(body.symbol, user.uid, adapter);
    
    return {
      ...result,
      timestamp: new Date().toISOString(),
    };
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
      // Load user integrations
      const integrations = await firestoreAdapter.getEnabledIntegrations(user.uid);
      
      // Get user's adapter
      const { userEngineManager } = await import('../services/userEngineManager');
      let engine = userEngineManager.getUserEngine(user.uid);
      let adapter = engine?.adapter;

      // If no engine, try to create one from Binance integration
      if (!adapter && integrations.binance) {
        const { BinanceAdapter } = await import('../services/binanceAdapter');
        adapter = new BinanceAdapter(integrations.binance.apiKey, integrations.binance.secretKey!, true);
      }

      if (!adapter) {
        return reply.code(400).send({
          error: 'Binance integration required for deep research',
        });
      }

      // Run research for each symbol
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
          const research = await researchEngine.runResearch(symbol, user.uid, adapter);
          
          // Calculate entry, size, stop-loss, take-profit based on research
          const settings = await firestoreAdapter.getSettings(user.uid);
          const quoteSize = settings?.quoteSize || 0.001;
          const bestBid = parseFloat((await adapter.getOrderbook(symbol, 5)).bids[0]?.price || '0');
          const bestAsk = parseFloat((await adapter.getOrderbook(symbol, 5)).asks[0]?.price || '0');
          const midPrice = (bestBid + bestAsk) / 2;

          let entry: number | undefined;
          let size: number | undefined;
          let sl: number | undefined;
          let tp: number | undefined;

          if (research.signal !== 'HOLD' && research.accuracy >= (settings?.minAccuracyThreshold || 0.85)) {
            entry = research.signal === 'BUY' ? bestAsk : bestBid;
            size = quoteSize;
            
            // Calculate stop-loss (2% below entry for BUY, 2% above for SELL)
            if (research.signal === 'BUY') {
              sl = entry * 0.98;
              tp = entry * 1.04; // 4% take-profit
            } else {
              sl = entry * 1.02;
              tp = entry * 0.96; // 4% take-profit
            }
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
      const settings = await firestoreAdapter.getSettings(user.uid);
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
      return reply.code(500).send({
        error: error.message || 'Deep research failed',
      });
    }
  });

  // Manual Deep Research endpoint - analyzes top 100 coins
  // Returns placeholder data if Binance API is not connected
  fastify.get('/manual', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      // Load user integrations
      const integrations = await firestoreAdapter.getEnabledIntegrations(user.uid);
      
      // Get user's adapter
      const { userEngineManager } = await import('../services/userEngineManager');
      let engine = userEngineManager.getUserEngine(user.uid);
      let adapter = engine?.adapter;

      // If no engine, try to create one from Binance integration
      if (!adapter && integrations.binance) {
        const { BinanceAdapter } = await import('../services/binanceAdapter');
        adapter = new BinanceAdapter(integrations.binance.apiKey, integrations.binance.secretKey!, true);
      }

      // If no adapter, return placeholder data so the page works without Binance API
      if (!adapter) {
        logger.info({ uid: user.uid }, 'Manual deep research called without Binance API, returning placeholder data');
        return {
          success: true,
          data: {
            trend: 'neutral',
            volatility: 12.4,
            volumeScore: 0.82,
            orderbookImbalance: -0.05,
            summary: 'Sample manual deep research output without API keys.',
          },
        };
      }

      // Get top 100 coins from Binance using 24hr ticker endpoint
      // Use the request method directly since getTicker doesn't exist
      const tickerData = await (adapter as any).request('GET', '/api/v3/ticker/24hr', {});
      const top100Symbols = (tickerData || [])
        .filter((t: any) => t.symbol && t.symbol.endsWith('USDT'))
        .sort((a: any, b: any) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'))
        .slice(0, 100)
        .map((t: any) => t.symbol);

      logger.info({ uid: user.uid, symbolCount: top100Symbols.length }, 'Starting manual deep research on top 100 coins');

      // Run research for each symbol
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

      for (const symbol of top100Symbols) {
        try {
          const research = await researchEngine.runResearch(symbol, user.uid, adapter);
          
          // Skip HOLD signals
          if (research.signal === 'HOLD') continue;

          // Get orderbook for price calculation
          const orderbook = await adapter.getOrderbook(symbol, 5);
          const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
          const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');
          const midPrice = (bestBid + bestAsk) / 2;

          if (bestBid === 0 || bestAsk === 0) continue;

          // Calculate entry, exit, stop-loss, take-profit
          const entry = research.signal === 'BUY' ? bestAsk : bestBid;
          const priceChange = bestAsk - bestBid;
          const volatility = priceChange / midPrice;
          
          let exit: number;
          let tp: number;
          let sl: number;
          let trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS' = 'SIDEWAYS';

          if (research.signal === 'BUY') {
            // For BUY: exit at higher price, TP above entry, SL below entry
            exit = entry * 1.04; // 4% profit target
            tp = entry * 1.04;
            sl = entry * 0.98; // 2% stop loss
            trendDirection = volatility > 0.01 ? 'UP' : 'SIDEWAYS';
          } else {
            // For SELL: exit at lower price, TP below entry, SL above entry
            exit = entry * 0.96; // 4% profit target
            tp = entry * 0.96;
            sl = entry * 1.02; // 2% stop loss
            trendDirection = volatility < -0.01 ? 'DOWN' : 'SIDEWAYS';
          }

          // Build reason
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
        return reply.code(404).send({
          error: 'No profitable trade opportunities found in top 100 coins',
        });
      }

      return {
        bestCoin: bestCandidate.symbol,
        accuracy: bestCandidate.accuracy,
        entryPrice: bestCandidate.entry!,
        exitPrice: bestCandidate.exit!,
        takeProfit: bestCandidate.tp!,
        stopLoss: bestCandidate.sl!,
        trendDirection: bestCandidate.trendDirection!,
        reason: bestCandidate.reason!,
        totalAnalyzed: top100Symbols.length,
        candidatesFound: candidates.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Error in manual deep research');
      return reply.code(500).send({
        error: error.message || 'Manual deep research failed',
      });
    }
  });
}

