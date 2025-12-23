import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.livecoinwatch.com';

/**
 * Get price data for a specific coin
 * @param code - Coin code (e.g., 'BTC')
 * @param apiKey - LiveCoinWatch API key
 * @returns Promise with price data
 */
export async function getPriceData(code: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'LiveCoinWatch',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'LiveCoinWatch API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'LiveCoinWatch', endpoint: 'price', code });

    const response = await retryWithBackoff(async () => {
      return axios.post(`${BASE_URL}/coins/single`, {
        currency: 'USD',
        code: code.toUpperCase(),
        meta: true
      }, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`LiveCoinWatch API returned status ${response.status}`);
    }

    const data = response.data;
    return {
      symbol: data.code || null,
      price: data.rate || null,
      marketCap: data.cap || null,
      volume24h: data.volume || null,
      change24h: data.delta?.day || null,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('LiveCoinWatch getPriceData error:', error.message);
    throw extractAdapterError('LiveCoinWatch', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param code - Coin code (e.g., 'BTC')
 * @param apiKey - LiveCoinWatch API key
 * @param interval - Time interval (not used for LiveCoinWatch, uses 1d)
 * @returns Promise with OHLC data
 */
export async function getOHLC(code: string, apiKey?: string, interval: string = '1d'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'LiveCoinWatch',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'LiveCoinWatch API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'LiveCoinWatch', endpoint: 'ohlc', code, interval });

    const response = await retryWithBackoff(async () => {
      return axios.post(`${BASE_URL}/coins/single/history`, {
        currency: 'USD',
        code: code.toUpperCase(),
        start: Date.now() - (24 * 60 * 60 * 1000), // 1 day ago
        end: Date.now(),
        meta: true
      }, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.history || response.data.history.length === 0) {
      throw new Error(`LiveCoinWatch API returned status ${response.status}`);
    }

    const history = response.data.history;
    const latest = history[history.length - 1];

    // Calculate OHLC from history data
    const prices = history.map((item: any) => item.rate);
    const open = history[0]?.rate || null;
    const high = Math.max(...prices) || null;
    const low = Math.min(...prices) || null;
    const close = latest.rate || null;
    const volume = history.reduce((sum: number, item: any) => sum + (item.volume || 0), 0) || null;

    return {
      open,
      high,
      low,
      close,
      volume,
      timestamp: latest.date || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('LiveCoinWatch getOHLC error:', error.message);
    throw extractAdapterError('LiveCoinWatch', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param code - Coin code (e.g., 'BTC')
 * @param apiKey - LiveCoinWatch API key
 * @returns Promise with volume data
 */
export async function getVolume(code: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'LiveCoinWatch',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'LiveCoinWatch API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'LiveCoinWatch', endpoint: 'volume', code });

    const response = await retryWithBackoff(async () => {
      return axios.post(`${BASE_URL}/coins/single/history`, {
        currency: 'USD',
        code: code.toUpperCase(),
        start: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
        end: Date.now(),
        meta: true
      }, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.history) {
      throw new Error(`LiveCoinWatch API returned status ${response.status}`);
    }

    const history = response.data.history;
    if (history.length === 0) {
      return {
        volume24h: null,
        volume7d: null,
        volume30d: null,
        lastUpdated: new Date().toISOString()
      };
    }

    // Calculate volumes for different periods
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);

    const last24h = history.filter((item: any) => new Date(item.date).getTime() > oneDayAgo);
    const last7d = history.filter((item: any) => new Date(item.date).getTime() > sevenDaysAgo);

    const volume24h = last24h.reduce((sum: number, item: any) => sum + (item.volume || 0), 0) || null;
    const volume7d = last7d.reduce((sum: number, item: any) => sum + (item.volume || 0), 0) || null;
    const volume30d = history.reduce((sum: number, item: any) => sum + (item.volume || 0), 0) || null;

    return {
      volume24h,
      volume7d,
      volume30d,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('LiveCoinWatch getVolume error:', error.message);
    throw extractAdapterError('LiveCoinWatch', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - LiveCoinWatch API key
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'LiveCoinWatch',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'LiveCoinWatch API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'LiveCoinWatch', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.post(`${BASE_URL}/coins/list`, {
        currency: 'USD',
        sort: 'rank',
        order: 'ascending',
        offset: 0,
        limit: Math.min(limit, 250), // LiveCoinWatch allows max 250
        meta: true
      }, {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`LiveCoinWatch API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.map((coin: any) => ({
      id: coin.code?.toLowerCase() || null,
      symbol: coin.code || null,
      name: coin.name || null,
      price: coin.rate || null,
      marketCap: coin.cap || null,
      volume24h: coin.volume || null,
      change24h: coin.delta?.day || null,
      rank: coin.rank || null
    }));
  } catch (error: any) {
    console.error('LiveCoinWatch getTopCoins error:', error.message);
    throw extractAdapterError('LiveCoinWatch', 'getPriceData', BASE_URL, error);
  }
}
