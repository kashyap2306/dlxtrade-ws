import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { BinanceAdapter } from '../services/binanceAdapter';
import { logger } from '../utils/logger';
import { getValidSymbols } from '../scripts/fetchValidBinanceSymbols';

/**
 * Market Routes
 * Handles market data endpoints like top coins
 */
export async function marketRoutes(fastify: FastifyInstance) {
  // GET /api/market/top-coins - Get top coins by market cap/volume
  fastify.get('/top-coins', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      
      // Use Binance public API (free, no setup required)
      try {
        const binanceAdapter = new BinanceAdapter();
        
        // Get valid symbols from cache and use top ones
        const validSymbols = await getValidSymbols();
        const usdtSymbols = validSymbols.filter(symbol => symbol.endsWith('USDT'));
        const popularSymbols = usdtSymbols.slice(0, limit);
        
        const coins = [];
        for (const symbol of popularSymbols) {
          try {
            const marketData = await binanceAdapter.getMarketData(symbol);
            if (marketData.price && marketData.price > 0) {
              coins.push({
                symbol,
                name: symbol.replace('USDT', ''),
                price: marketData.price,
                change24h: marketData.priceChangePercent24h || 0,
                volume24h: marketData.volume24h || 0,
              });
            }
          } catch (err) {
            logger.debug({ err, symbol }, 'Error fetching market data for symbol');
          }
        }
        
        // Sort by volume descending
        coins.sort((a, b) => b.volume24h - a.volume24h);
        
        return {
          ok: true,
          coins: coins.slice(0, limit),
          total: coins.length,
        };
      } catch (err: any) {
        logger.error({ err }, 'Error fetching top coins from Binance');
        // Return default coins on error
        const popularCoins = [
          { symbol: 'BTCUSDT', name: 'Bitcoin', price: 0, change24h: 0, volume24h: 0 },
          { symbol: 'ETHUSDT', name: 'Ethereum', price: 0, change24h: 0, volume24h: 0 },
        ];
        return reply.code(200).send({
          ok: false,
          error: err.message || 'Error fetching top coins',
          coins: popularCoins,
          total: popularCoins.length,
        });
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid: (request as any).user?.uid }, 'Error in market/top-coins');
      // NEVER return 500 - always return 200 with error flag
      return reply.code(200).send({
        ok: false,
        error: error.message || 'Error fetching top coins',
        coins: [],
        total: 0,
      });
    }
  });
}

