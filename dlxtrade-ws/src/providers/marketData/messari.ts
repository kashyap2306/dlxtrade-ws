import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://data.messari.io/api/v1';

/**
 * Get price data for a specific coin
 * @param assetKey - Messari asset key (e.g., 'bitcoin')
 * @param apiKey - Messari API key
 * @returns Promise with price data
 */
export async function getPriceData(assetKey: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Messari',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Messari API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Messari', endpoint: 'price', assetKey });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/assets/${assetKey}`, {
        headers: {
          'x-messari-api-key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data) {
      throw new Error(`Messari API returned status ${response.status}`);
    }

    const data = response.data.data;
    const metrics = data.metrics?.market_data || {};

    return {
      symbol: data.symbol || null,
      price: metrics.price_usd || null,
      marketCap: metrics.marketcap?.current_marketcap_usd || null,
      volume24h: metrics.volume_last_24_hours || null,
      change24h: metrics.percent_change_usd_last_24_hours || null,
      lastUpdated: data.updated_at || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Messari getPriceData error:', error.message);
    throw extractAdapterError('Messari', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param assetKey - Messari asset key (e.g., 'bitcoin')
 * @param apiKey - Messari API key
 * @param interval - Time interval
 * @returns Promise with OHLC data
 */
export async function getOHLC(assetKey: string, apiKey?: string, interval: string = '1d'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Messari',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Messari API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Messari', endpoint: 'ohlc', assetKey, interval });

    // Map interval to Messari format
    const intervalMap: { [key: string]: string } = {
      '1h': '1h',
      '24h': '1d',
      '1d': '1d',
      '7d': '7d',
      '30d': '30d'
    };

    const messariInterval = intervalMap[interval] || '1d';

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/assets/${assetKey}/metrics/price/time-series`, {
        params: {
          interval: messariInterval,
          limit: 1, // Get latest OHLC
          columns: 'timestamp,open,high,low,close,volume'
        },
        headers: {
          'x-messari-api-key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data?.values || response.data.data.values.length === 0) {
      throw new Error(`Messari API returned status ${response.status}`);
    }

    const values = response.data.data.values[0];
    return {
      open: values[1] || null, // values: [timestamp, open, high, low, close, volume]
      high: values[2] || null,
      low: values[3] || null,
      close: values[4] || null,
      volume: values[5] || null,
      timestamp: new Date(values[0] * 1000).toISOString() // Convert Unix timestamp
    };
  } catch (error: any) {
    console.error('Messari getOHLC error:', error.message);
    throw extractAdapterError('Messari', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param assetKey - Messari asset key (e.g., 'bitcoin')
 * @param apiKey - Messari API key
 * @returns Promise with volume data
 */
export async function getVolume(assetKey: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Messari',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Messari API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Messari', endpoint: 'volume', assetKey });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/assets/${assetKey}/metrics/price/time-series`, {
        params: {
          interval: '1d',
          limit: 30, // Get last 30 days for volume analysis
          columns: 'timestamp,volume'
        },
        headers: {
          'x-messari-api-key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data?.values) {
      throw new Error(`Messari API returned status ${response.status}`);
    }

    const values = response.data.data.values;
    if (values.length === 0) {
      return {
        volume24h: null,
        volume7d: null,
        volume30d: null,
        lastUpdated: new Date().toISOString()
      };
    }

    // Calculate volumes
    const latest = values[values.length - 1];
    const last7 = values.slice(-7);
    const last30 = values.slice(-30);

    const volume24h = latest[1] || null; // Latest volume
    const volume7d = last7.reduce((sum: number, item: any[]) => sum + (item[1] || 0), 0) || null;
    const volume30d = last30.reduce((sum: number, item: any[]) => sum + (item[1] || 0), 0) || null;

    return {
      volume24h,
      volume7d,
      volume30d,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Messari getVolume error:', error.message);
    throw extractAdapterError('Messari', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - Messari API key
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Messari',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Messari API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Messari', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/assets`, {
        params: {
          limit: Math.min(limit, 500), // Messari allows up to 500
          fields: 'id,symbol,name,metrics/market_data/price_usd,metrics/market_data/marketcap/current_marketcap_usd,metrics/market_data/volume_last_24_hours,metrics/market_data/percent_change_usd_last_24_hours'
        },
        headers: {
          'x-messari-api-key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data?.data)) {
      throw new Error(`Messari API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.data.map((coin: any, index: number) => ({
      id: coin.id || null,
      symbol: coin.symbol || null,
      name: coin.name || null,
      price: coin.metrics?.market_data?.price_usd || null,
      marketCap: coin.metrics?.market_data?.marketcap?.current_marketcap_usd || null,
      volume24h: coin.metrics?.market_data?.volume_last_24_hours || null,
      change24h: coin.metrics?.market_data?.percent_change_usd_last_24_hours || null,
      rank: index + 1
    }));
  } catch (error: any) {
    console.error('Messari getTopCoins error:', error.message);
    throw extractAdapterError('Messari', 'getPriceData', BASE_URL, error);
  }
}
