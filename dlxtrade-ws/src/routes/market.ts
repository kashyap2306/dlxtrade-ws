import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { GoogleFinanceAdapter } from '../services/googleFinanceAdapter';
import { CoinGeckoAdapter } from '../services/coingeckoAdapter';
import { BinanceAdapter } from '../services/binanceAdapter';
import { logger } from '../utils/logger';

export async function marketRoutes(fastify: FastifyInstance) {
  // GET /api/market/top-coins - Get top 20 coins using available providers
  fastify.get('/top-coins', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const googleFinanceAdapter = new GoogleFinanceAdapter();
      const coinGeckoAdapter = new CoinGeckoAdapter();
      const binanceAdapter = new BinanceAdapter();

      const topCoins = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT',
        'SOLUSDT', 'DOTUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LTCUSDT',
        'TRXUSDT', 'ETCUSDT', 'BCHUSDT', 'LINKUSDT', 'XLMUSDT',
        'ICPUSDT', 'FILUSDT', 'HBARUSDT', 'NEARUSDT', 'FTMUSDT'
      ];

      const results = [];

      for (const symbol of topCoins.slice(0, 20)) {
        try {
          let price = 0;
          let volume24h = 0;
          let priceChangePercent24h = 0;

          // Try Binance first (most reliable)
          try {
            const binanceData = await binanceAdapter.getPublicMarketData(symbol);
            if (binanceData && binanceData.lastPrice) {
              price = binanceData.lastPrice;
              volume24h = binanceData.volume24h || 0;
              priceChangePercent24h = binanceData.priceChangePercent24h || 0;
            }
          } catch (binanceErr) {
            logger.debug({ symbol }, 'Binance data unavailable, trying alternatives');
          }

          // Fallback to CoinGecko
          if (price === 0) {
            try {
              const coinGeckoData = await coinGeckoAdapter.getMarketData(symbol);
              if (coinGeckoData && coinGeckoData.price) {
                price = coinGeckoData.price;
                volume24h = coinGeckoData.volume24h || 0;
                priceChangePercent24h = coinGeckoData.change24h || 0;
              }
            } catch (cgErr) {
              logger.debug({ symbol }, 'CoinGecko data unavailable, trying Google Finance');
            }
          }

          // Final fallback to Google Finance
          if (price === 0) {
            try {
              const googleData = await googleFinanceAdapter.getMarketData(symbol);
              if (googleData && googleData.price) {
                price = googleData.price;
                volume24h = googleData.volume24h || 0;
                priceChangePercent24h = googleData.priceChangePercent || 0;
              }
            } catch (gfErr) {
              logger.debug({ symbol }, 'All data providers failed');
            }
          }

          if (price > 0) {
            results.push({
              symbol,
              price: parseFloat(price.toFixed(6)),
              volume24h: parseFloat(volume24h.toFixed(2)),
              priceChangePercent24h: parseFloat(priceChangePercent24h.toFixed(2)),
            });
          }
        } catch (error: any) {
          logger.debug({ symbol, error: error.message }, 'Error fetching market data for symbol');
          // Continue with next symbol
        }
      }

      // Sort by volume (descending) and return top 20
      results.sort((a, b) => b.volume24h - a.volume24h);

      return {
        coins: results.slice(0, 20),
        total: results.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error fetching top coins data');
      return reply.code(500).send({
        error: 'Failed to fetch market data',
        details: error.message,
      });
    }
  });
}
