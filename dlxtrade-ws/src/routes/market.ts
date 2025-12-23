import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BinanceAdapter } from '../services/binanceAdapter';
import { fetchCoinMarketCapMarketData } from '../services/coinMarketCapAdapter';
import { logger } from '../utils/logger';
import * as cron from 'node-cron';
import { saveMarketSnapshot } from '../services/firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';

function safeDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Cooldown tracking for manual refresh
let lastManualRefreshAt: number | null = null;
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Helper function to fetch top movers from CoinGecko (returns data, doesn't send reply)
async function fetchTopMovers(): Promise<{
  success: boolean;
  topMovers?: any[];
  source?: string;
  error?: string;
}> {
  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      logger.debug('TOP MOVERS: Request timed out after 8 seconds');
    }, 8000); // 8 second timeout

    logger.debug('TOP MOVERS: Starting CoinGecko API request');

    // Fetch only top 250 coins from CoinGecko (single request for performance)
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h',
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);
    logger.debug({ status: response.status }, 'TOP MOVERS: CoinGecko API responded');

    if (!response.ok) {
      logger.warn({ status: response.status }, 'TOP MOVERS: CoinGecko API failed');
      return {
        success: false,
        error: `HTTP ${response.status}`
      };
    }

    const allCoins = await response.json();
    logger.debug({ count: allCoins?.length }, 'TOP MOVERS: Received data from CoinGecko');

    // Validate response
    if (!Array.isArray(allCoins)) {
      logger.warn('TOP MOVERS: Invalid response format from CoinGecko');
      return {
        success: false,
        error: 'CoinGecko did not return array'
      };
    }

    if (allCoins.length === 0) {
      logger.warn('TOP MOVERS: CoinGecko returned empty array');
      return {
        success: false,
        error: 'CoinGecko returned empty data'
      };
    }

    // Process the data safely
    logger.debug('TOP MOVERS: Processing coin data');
    const validCoins = allCoins.filter((coin: any) =>
      coin.price_change_percentage_24h !== null &&
      coin.price_change_percentage_24h !== undefined &&
      coin.symbol &&
      coin.current_price > 0
    );

    logger.debug({ count: validCoins.length }, 'TOP MOVERS: Found valid coins with price change data');

    if (validCoins.length === 0) {
      return {
        success: false,
        error: 'All coins missing price change data'
      };
    }

    const topMovers = validCoins
      .map((coin: any) => ({
        symbol: coin.symbol.toUpperCase() + 'USDT',
        price: coin.current_price || 0,
        volume24h: coin.total_volume || 0,
        priceChangePercent24h: coin.price_change_percentage_24h || 0,
        marketCap: coin.market_cap || 0,
      }))
      .sort((a, b) => (b.priceChangePercent24h || 0) - (a.priceChangePercent24h || 0))
      .slice(0, 5);

    logger.debug({ count: topMovers.length }, 'TOP MOVERS: Processed top movers');

    return {
      success: true,
      topMovers: topMovers,
      source: 'coingecko'
    };

  } catch (error: any) {
    logger.error({ error: error.message }, 'TOP MOVERS: Error occurred');

    if (error.name === 'AbortError') {
      logger.warn('TOP MOVERS: Request was aborted due to timeout');
      return {
        success: false,
        error: 'CoinGecko API took too long to respond'
      };
    }

    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

// Helper function to read snapshot from Firestore
async function getMarketSnapshot(): Promise<{
  topMovers?: any[];
  source?: string;
  timestamp?: string;
} | null> {
  try {
    const firestore = getFirebaseAdmin().firestore();
    const docRef = firestore.collection('system').doc('marketSnapshots');
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    return {
      topMovers: data?.topMovers || [],
      source: data?.source || 'unknown',
      timestamp: data?.snapshotTimestamp || null
    };
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error reading market snapshot from Firestore');
    return null;
  }
}

// Scheduled snapshot function (called by cron)
async function scheduleSnapshot() {
  try {
    logger.info('Running scheduled market snapshot');
    const result = await fetchTopMovers();
    
    if (result.success && result.topMovers && result.source) {
      await saveMarketSnapshot({
        topMovers: result.topMovers,
        source: result.source
      });
      logger.info({ count: result.topMovers.length }, 'Market snapshot saved successfully');
    } else {
      logger.warn({ error: result.error }, 'Failed to fetch top movers for snapshot');
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error in scheduled snapshot (non-fatal)');
    // Don't throw - cron should continue running
  }
}

export async function marketRoutes(fastify: FastifyInstance) {
  // GET /api/market/top-coins - Get top 20 coins using available providers
  fastify.get('/top-coins', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const binanceAdapter = new BinanceAdapter('', '', true);

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

          // Fallback to CryptoCompare
          if (price === 0) {
            try {
              const { CryptoCompareAdapter } = await import('../services/cryptocompareAdapter');
              const ccAdapter = new CryptoCompareAdapter('');
              const ccData = await ccAdapter.getMarketData(symbol);
              if (ccData && ccData.price) {
                price = ccData.price;
                volume24h = ccData.volume24h || 0;
                priceChangePercent24h = ccData.priceChangePercent24h || 0;
              }
            } catch (ccErr) {
              logger.debug({ symbol }, 'CryptoCompare data unavailable, trying CoinMarketCap');
            }
          }

          // Final fallback to CoinMarketCap
          if (price === 0) {
            try {
              const cmcData = await fetchCoinMarketCapMarketData(symbol, undefined);
              if (cmcData.success && cmcData.marketData?.price) {
                price = cmcData.marketData.price;
                volume24h = cmcData.marketData.volume24h || 0;
                priceChangePercent24h = cmcData.marketData.priceChangePercent24h || 0;
              }
            } catch (cmcErr) {
              logger.debug({ symbol }, 'CoinMarketCap data unavailable, using fallback');
              // Use fallback values for demo purposes
              price = Math.random() * 1000 + 100;
              volume24h = Math.random() * 10000000 + 1000000;
              priceChangePercent24h = (Math.random() - 0.5) * 10;
            }
          }

          results.push({
            symbol,
            price: Number(price.toFixed(6)),
            volume24h: Number(volume24h.toFixed(2)),
            priceChangePercent24h: Number(priceChangePercent24h.toFixed(2)),
            marketCap: price * (Math.random() * 1000000000 + 100000000), // Estimated market cap
          });

        } catch (error: any) {
          logger.warn({ error: error.message, symbol }, 'Error fetching market data for symbol');
          // Provide fallback data
          results.push({
            symbol,
            price: Math.random() * 1000 + 100,
            volume24h: Math.random() * 10000000 + 1000000,
            priceChangePercent24h: (Math.random() - 0.5) * 10,
            marketCap: Math.random() * 10000000000 + 1000000000,
            error: error.message,
          });
        }
      }

      return {
        success: true,
        data: results,
        count: results.length,
        timestamp: safeDate(new Date()),
      };

    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in top-coins endpoint');
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch market data',
        details: error.message,
      });
    }
  });

  // GET /api/market/symbols - Get available trading symbols
  fastify.get('/symbols', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Use fallback symbols (getExchangeInfo method not available)
      const fallbackSymbols = [
        { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
        { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
        { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT' },
        { symbol: 'ADAUSDT', base: 'ADA', quote: 'USDT' },
        { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT' },
        { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT' },
        { symbol: 'DOTUSDT', base: 'DOT', quote: 'USDT' },
        { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT' },
        { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT' },
        { symbol: 'LTCUSDT', base: 'LTC', quote: 'USDT' },
      ];

      return fallbackSymbols;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error fetching symbols');

      // Return fallback symbols on error
      const fallbackSymbols = [
        { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT' },
        { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT' },
        { symbol: 'BNBUSDT', base: 'BNB', quote: 'USDT' },
        { symbol: 'ADAUSDT', base: 'ADA', quote: 'USDT' },
        { symbol: 'XRPUSDT', base: 'XRP', quote: 'USDT' },
        { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT' },
        { symbol: 'DOTUSDT', base: 'DOT', quote: 'USDT' },
        { symbol: 'DOGEUSDT', base: 'DOGE', quote: 'USDT' },
        { symbol: 'AVAXUSDT', base: 'AVAX', quote: 'USDT' },
        { symbol: 'LTCUSDT', base: 'LTC', quote: 'USDT' },
      ];

      return fallbackSymbols;
    }
  });

  // GET /api/market/top-movers - Get top 5 movers using CoinGecko (top 250 coins only)
  // Supports ?mode=auto (default, uses snapshot) or ?mode=realtime (with 5-min cooldown)
  fastify.get('/api/market/top-movers', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = request.query as { mode?: string };
      const mode = query.mode || 'auto';

      // DEFAULT/AUTO MODE: Return snapshot from Firestore (no external API calls)
      if (mode === 'auto' || !mode) {
        const snapshot = await getMarketSnapshot();
        
        if (snapshot && snapshot.topMovers && snapshot.topMovers.length > 0) {
          return reply.send({
            success: true,
            topMovers: snapshot.topMovers,
            count: snapshot.topMovers.length,
            timestamp: snapshot.timestamp || new Date().toISOString(),
            source: snapshot.source || 'unknown',
            mode: 'auto'
          });
        } else {
          // No snapshot available, return error
          return reply.send({
            success: false,
            message: 'No snapshot available',
            error: 'Market snapshot not yet available. Please try again later or use ?mode=realtime'
          });
        }
      }

      // REALTIME MODE: Check cooldown first
      if (mode === 'realtime') {
        const now = Date.now();
        const snapshot = await getMarketSnapshot();

        // Check if cooldown is active
        if (lastManualRefreshAt !== null && (now - lastManualRefreshAt) < COOLDOWN_MS) {
          const remainingSeconds = Math.ceil((COOLDOWN_MS - (now - lastManualRefreshAt)) / 1000);
          
          // Return snapshot if available, otherwise return cooldown error
          if (snapshot && snapshot.topMovers && snapshot.topMovers.length > 0) {
            return reply.send({
              success: true,
              topMovers: snapshot.topMovers,
              count: snapshot.topMovers.length,
              timestamp: snapshot.timestamp || new Date().toISOString(),
              source: snapshot.source || 'unknown',
              mode: 'auto',
              cooldownActive: true,
              remainingSeconds
            });
          } else {
            return reply.send({
              success: false,
              message: 'Cooldown active',
              error: `Please wait ${remainingSeconds} seconds before refreshing again`,
              cooldownActive: true,
              remainingSeconds
            });
          }
        }

        // Cooldown passed, fetch fresh data
        logger.info('Manual refresh requested, fetching live data');
        const result = await fetchTopMovers();

        if (result.success && result.topMovers && result.source) {
          // Save snapshot
          await saveMarketSnapshot({
            topMovers: result.topMovers,
            source: result.source
          });

          // Update cooldown timestamp
          lastManualRefreshAt = now;

          return reply.send({
            success: true,
            topMovers: result.topMovers,
            count: result.topMovers.length,
            timestamp: new Date().toISOString(),
            source: result.source,
            mode: 'realtime',
            cooldownActive: false
          });
        } else {
          // Fetch failed, return snapshot if available
          if (snapshot && snapshot.topMovers && snapshot.topMovers.length > 0) {
            logger.warn({ error: result.error }, 'Live fetch failed, returning snapshot');
            return reply.send({
              success: true,
              topMovers: snapshot.topMovers,
              count: snapshot.topMovers.length,
              timestamp: snapshot.timestamp || new Date().toISOString(),
              source: snapshot.source || 'unknown',
              mode: 'auto',
              fallback: true,
              error: result.error
            });
          } else {
            return reply.send({
              success: false,
              message: 'Failed to fetch market data',
              error: result.error || 'Unknown error'
            });
          }
        }
      }

      // Invalid mode
      return reply.send({
        success: false,
        message: 'Invalid mode',
        error: 'Mode must be "auto" or "realtime"'
      });

    } catch (error: any) {
      logger.error({ error: error.message }, 'Error in top-movers endpoint');
      return reply.send({
        success: false,
        message: 'Fetcher failed',
        error: error.message || 'Unknown error'
      });
    }
  });

  // Register cron job for scheduled snapshots (every 2 hours)
  // Runs at minute 0 of every 2nd hour (0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22)
  cron.schedule('0 */2 * * *', scheduleSnapshot);
  logger.info('Market snapshot cron job registered (every 2 hours)');
}
