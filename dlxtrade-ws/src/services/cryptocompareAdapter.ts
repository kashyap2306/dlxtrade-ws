import { AdapterError, extractAdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

// Simple in-memory cache for CryptoCompare data
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

const ccCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds TTL for market data

export class CryptoCompareAdapter {
  private apiKey: string;
  private baseUrl = 'https://min-api.cryptocompare.com/data';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get cached data or fetch fresh data
   */
  private async getCachedData(cacheKey: string, fetchFn: () => Promise<any>): Promise<any> {
    const cached = ccCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < cached.ttl) {
      return cached.data;
    }

    try {
      const data = await fetchFn();
      ccCache.set(cacheKey, {
        data,
        timestamp: now,
        ttl: CACHE_TTL_MS
      });
      return data;
    } catch (error) {
      // Return stale data if available and recent (within 5 minutes)
      if (cached && (now - cached.timestamp) < 300000) {
        console.warn(`[CryptoCompare] Returning stale cached data for ${cacheKey}`);
        return cached.data;
      }
      throw error;
    }
  }

  async getMarketData(symbol: string): Promise<any> {
    const cacheKey = `market_${symbol}`;
    return this.getCachedData(cacheKey, async () => {
      const url = `${this.baseUrl}/pricemultifull`;

      try {
        const response = await axios.get(url, {
          params: {
            fsyms: symbol.replace('USDT', '').replace('USD', ''),
            tsyms: 'USD',
            api_key: this.apiKey
          },
          timeout: 5000
        });

        if (response.status !== 200) {
          const errorDetails = extractAdapterError('CryptoCompare', 'GET', url, { response });
          throw new AdapterError(errorDetails);
        }

        const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
        const data = response.data.RAW?.[baseSymbol]?.USD;

        if (!data) {
          return {
            provider: 'cryptocompare',
            success: false,
            error: 'No data available for symbol',
            symbol
          };
        }

        return {
          price: data.PRICE,
          volume24h: data.VOLUME24HOUR,
          change24h: data.CHANGEPCT24HOUR,
          marketCap: data.MKTCAP,
          open: data.OPEN24HOUR,
          high: data.HIGH24HOUR,
          low: data.LOW24HOUR,
          priceChangePercent24h: data.CHANGEPCT24HOUR,
          provider: 'cryptocompare',
          success: true,
          symbol,
          timestamp: Date.now()
        };
      } catch (error: any) {
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new AdapterError({
            adapter: 'CryptoCompare',
            method: 'GET',
            url: url,
            statusCode: error.response.status,
            errorMessage: 'Authentication failed - invalid API key',
            isAuthError: true
          });
        }

        const errorDetails = extractAdapterError('CryptoCompare', 'GET', url, error);
        return {
          provider: 'cryptocompare',
          success: false,
          error: error.message || 'Failed to fetch market data',
          symbol
        };
      }
    });
  }

  /**
   * Get social sentiment data from CryptoCompare
   */
  async getSocialSentiment(symbol: string): Promise<any> {
    const cacheKey = `sentiment_${symbol}`;
    return this.getCachedData(cacheKey, async () => {
      const url = `${this.baseUrl}/social/coin/latest`;

      try {
        const response = await axios.get(url, {
          params: {
            coinId: symbol.replace('USDT', '').replace('USD', ''),
            api_key: this.apiKey
          },
          timeout: 5000
        });

        if (response.status !== 200) {
          return {
            provider: 'cryptocompare',
            success: false,
            error: `HTTP ${response.status}`,
            symbol
          };
        }

        const data = response.data.Data || {};

        return {
          sentiment: {
            score: data.sentiment || 0.5,
            socialScore: data.socialScore || 0.5,
            newsScore: data.newsScore || 0.5,
            socialVolume: data.socialVolume || 0,
            newsVolume: data.newsVolume || 0
          },
          provider: 'cryptocompare',
          success: true,
          symbol,
          timestamp: Date.now()
        };
      } catch (error: any) {
        return {
          provider: 'cryptocompare',
          success: false,
          error: error.message || 'Failed to fetch social sentiment',
          symbol
        };
      }
    });
  }

  async getHistoricalOHLC(symbol: string, limit: number = 100): Promise<any[]> {
    const url = `${this.baseUrl}/histohour`;

    try {
      const response = await axios.get(url, {
        params: {
          fsym: symbol.replace('USDT', ''),
          tsym: 'USD',
          limit,
          api_key: this.apiKey
        },
        timeout: 15000
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.data.Data || [];
    } catch (error: any) {
      console.warn(`CryptoCompare historical data fetch failed for ${symbol}:`, error.message);
      return [];
    }
  }

  async getOHLCData(symbol: string): Promise<any> {
    const historicalData = await this.getHistoricalOHLC(symbol, 300); // Get 300 hours of data for MA50/MA200

    if (historicalData.length === 0) {
      return {
        ohlc: [],
        latest: null
      };
    }

    // Convert to OHLC format expected by indicators
    const ohlc = historicalData.map((item: any) => ({
      timestamp: item.time * 1000,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volumefrom
    }));

    const latest = historicalData[historicalData.length - 1];

    return {
      ohlc,
      latest: {
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volumefrom
      }
    };
  }
}
