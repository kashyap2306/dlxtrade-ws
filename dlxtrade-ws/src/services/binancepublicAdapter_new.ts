import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff, rateLimiters } from '../utils/rateLimiter';
import axios from 'axios';

const BASE_URL = 'https://api.binance.com/api/v3';

// Simple in-memory cache for Binance Public data
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

const binanceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for market data

export class BinancePublicAdapter {
  private baseUrl: string;

  constructor() {
    this.baseUrl = BASE_URL;
  }

  /**
   * Get cached data or fetch fresh data
   */
  private async getCachedData(cacheKey: string, fetchFn: () => Promise<any>): Promise<any> {
    const cached = binanceCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < cached.ttl) {
      return cached.data;
    }

    try {
      const data = await fetchFn();
      binanceCache.set(cacheKey, {
        data,
        timestamp: now,
        ttl: CACHE_TTL_MS
      });
      return data;
    } catch (error) {
      // Return stale data if available and recent (within 5 minutes)
      if (cached && (now - cached.timestamp) < 300000) {
        console.warn(`[BinancePublic] Returning stale cached data for ${cacheKey}`);
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Test connectivity and API key validity
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/ping`, {
        timeout: 5000,
      });

      if (response.status === 200 && response.data === '{}') {
        return { success: true, message: 'Binance Public API accessible' };
      } else {
        return { success: false, message: `Unexpected response: ${response.status}` };
      }
    } catch (error: any) {
      return { success: false, message: `Connection failed: ${error.message}` };
    }
  }

  /**
   * Get comprehensive market data including OHLC and orderbook
   */
  async getPublicMarketData(symbol: string): Promise<any> {
    const cacheKey = `market_${symbol}`;
    return this.getCachedData(cacheKey, async () => {
      try {
        const response = await retryWithBackoff(
          async () => {
            const response = await axios.get(`${this.baseUrl}/ticker/24hr`, {
              params: { symbol: symbol.toUpperCase() },
              timeout: 5000,
            });

            if (response.status !== 200) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
          },
          3, // max retries
          1000, // base delay
          rateLimiters.binance // rate limiter
        );

        const data = response.data;

        return {
          symbol: data.symbol,
          price: parseFloat(data.lastPrice),
          priceChangePercent24h: parseFloat(data.priceChangePercent),
          volume24h: parseFloat(data.volume),
          high24h: parseFloat(data.highPrice),
          low24h: parseFloat(data.lowPrice),
          open24h: parseFloat(data.openPrice),
          count: parseInt(data.count),
          provider: 'binance',
          success: true,
          timestamp: Date.now()
        };
      } catch (error: any) {
        console.error(`[BinancePublic] Market data error for ${symbol}:`, error.message);
        return {
          provider: 'binance',
          success: false,
          error: error.message,
          symbol
        };
      }
    });
  }

  /**
   * Get orderbook snapshot
   */
  async getOrderbook(symbol: string, limit: number = 20): Promise<any> {
    const cacheKey = `orderbook_${symbol}_${limit}`;
    return this.getCachedData(cacheKey, async () => {
      try {
        const response = await axios.get(`${this.baseUrl}/depth`, {
          params: {
            symbol: symbol.toUpperCase(),
            limit: Math.min(limit, 100) // Binance max 100
          },
          timeout: 5000,
        });

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = response.data;

        return {
          symbol: data.symbol,
          bids: data.bids.map((bid: any) => ({
            price: parseFloat(bid[0]),
            quantity: parseFloat(bid[1])
          })),
          asks: data.asks.map((ask: any) => ({
            price: parseFloat(ask[0]),
            quantity: parseFloat(ask[1])
          })),
          provider: 'binance',
          success: true,
          timestamp: Date.now()
        };
      } catch (error: any) {
        console.error(`[BinancePublic] Orderbook error for ${symbol}:`, error.message);
        return {
          provider: 'binance',
          success: false,
          error: error.message,
          symbol
        };
      }
    });
  }

  /**
   * Get OHLC candlestick data
   */
  async getOHLCData(symbol: string, interval: string = '1h', limit: number = 100): Promise<any> {
    const cacheKey = `ohlc_${symbol}_${interval}_${limit}`;
    return this.getCachedData(cacheKey, async () => {
      try {
        const response = await axios.get(`${this.baseUrl}/klines`, {
          params: {
            symbol: symbol.toUpperCase(),
            interval,
            limit: Math.min(limit, 1000) // Binance max 1000
          },
          timeout: 5000,
        });

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = response.data;
        const ohlc = data.map((kline: any) => ({
          timestamp: parseInt(kline[0]),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5])
        }));

        return {
          symbol,
          interval,
          ohlc,
          provider: 'binance',
          success: true,
          timestamp: Date.now()
        };
      } catch (error: any) {
        console.error(`[BinancePublic] OHLC error for ${symbol}:`, error.message);
        return {
          provider: 'binance',
          success: false,
          error: error.message,
          symbol
        };
      }
    });
  }

  async getTickerPrice(symbol: string): Promise<number> {
    try {
      const marketData = await this.getPublicMarketData(symbol);
      if (marketData.success) {
        return marketData.price;
      }
      throw new Error('Failed to get ticker price');
    } catch (error: any) {
      console.error(`[BinancePublic] Ticker price error for ${symbol}:`, error.message);
      throw error;
    }
  }

  async get24hrStats(symbol: string): Promise<any> {
    return this.getPublicMarketData(symbol);
  }
}

