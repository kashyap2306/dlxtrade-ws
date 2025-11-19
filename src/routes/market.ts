import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { CoinAPIAdapter } from '../services/coinapiAdapter';
import { logger } from '../utils/logger';

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
      
      // Get user's CoinAPI integration
      const integrations = await firestoreAdapter.getEnabledIntegrations(user.uid);
      const coinapiMarket = integrations['coinapi_market'];
      
      if (!coinapiMarket?.apiKey) {
        // Return default popular coins if no CoinAPI integration
        const popularCoins = [
          { symbol: 'BTCUSDT', name: 'Bitcoin', price: 0, change24h: 0, volume24h: 0 },
          { symbol: 'ETHUSDT', name: 'Ethereum', price: 0, change24h: 0, volume24h: 0 },
          { symbol: 'BNBUSDT', name: 'BNB', price: 0, change24h: 0, volume24h: 0 },
          { symbol: 'SOLUSDT', name: 'Solana', price: 0, change24h: 0, volume24h: 0 },
          { symbol: 'ADAUSDT', name: 'Cardano', price: 0, change24h: 0, volume24h: 0 },
        ];
        return reply.code(200).send({
          ok: false,
          error: 'CoinAPI Market integration not configured',
          coins: popularCoins.slice(0, limit),
          total: popularCoins.length,
        });
      }
      
      // Use CoinAPI to fetch top coins
      try {
        const coinapiAdapter = new CoinAPIAdapter(coinapiMarket.apiKey, 'market');
        
        // Popular symbols to fetch
        const popularSymbols = [
          'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'DOGEUSDT',
          'AVAXUSDT', 'SHIBUSDT', 'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'LINKUSDT', 'ATOMUSDT', 'ETCUSDT',
        ].slice(0, limit);
        
        const coins = [];
        for (const symbol of popularSymbols) {
          try {
            const marketData = await coinapiAdapter.getMarketData(symbol);
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
        logger.error({ err }, 'Error fetching top coins from CoinAPI');
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

