import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.kaiko.com/v2';

/**
 * Get price data for a specific coin
 * @param baseAsset - Base asset (e.g., 'btc')
 * @param quoteAsset - Quote asset (default: 'usd')
 * @param apiKey - Kaiko API key
 * @returns Promise with price data
 */
export async function getPriceData(baseAsset: string, apiKey?: string, quoteAsset: string = 'usd'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Kaiko',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Kaiko API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Kaiko', endpoint: 'price', baseAsset, quoteAsset });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/data/trades.v1/spot_exchange_rate/${baseAsset.toLowerCase()}/${quoteAsset.toLowerCase()}`, {
        headers: {
          'X-Api-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data) {
      throw new Error(`Kaiko API returned status ${response.status}`);
    }

    const data = response.data.data[0];
    if (!data) {
      throw new Error(`No data found for ${baseAsset}/${quoteAsset} pair`);
    }

    return {
      symbol: `${baseAsset.toUpperCase()}${quoteAsset.toUpperCase()}`,
      price: data.price || null,
      marketCap: null, // Kaiko may not provide market cap
      volume24h: null, // Kaiko may not provide volume in this endpoint
      change24h: null, // Kaiko may not provide change in this endpoint
      lastUpdated: data.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Kaiko getPriceData error:', error.message);
    throw extractAdapterError('Kaiko', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param baseAsset - Base asset (e.g., 'btc')
 * @param quoteAsset - Quote asset (default: 'usd')
 * @param apiKey - Kaiko API key
 * @param interval - Time interval
 * @returns Promise with OHLC data
 */
export async function getOHLC(baseAsset: string, apiKey?: string, quoteAsset: string = 'usd', interval: string = '1d'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Kaiko',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Kaiko API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Kaiko', endpoint: 'ohlc', baseAsset, quoteAsset, interval });

    // Map interval to Kaiko format
    const intervalMap: { [key: string]: string } = {
      '1h': '1h',
      '24h': '1d',
      '1d': '1d',
      '7d': '7d',
      '30d': '1M'
    };

    const kaikoInterval = intervalMap[interval] || '1d';

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/data/trades.v1/spot_exchange_rate/${baseAsset.toLowerCase()}/${quoteAsset.toLowerCase()}/ohlcv`, {
        params: {
          interval: kaikoInterval,
          limit: 1 // Get latest OHLC
        },
        headers: {
          'X-Api-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data || response.data.data.length === 0) {
      throw new Error(`Kaiko API returned status ${response.status}`);
    }

    const ohlc = response.data.data[0];
    return {
      open: ohlc.open || null,
      high: ohlc.high || null,
      low: ohlc.low || null,
      close: ohlc.close || null,
      volume: ohlc.volume || null,
      timestamp: ohlc.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Kaiko getOHLC error:', error.message);
    throw extractAdapterError('Kaiko', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param baseAsset - Base asset (e.g., 'btc')
 * @param quoteAsset - Quote asset (default: 'usd')
 * @param apiKey - Kaiko API key
 * @returns Promise with volume data
 */
export async function getVolume(baseAsset: string, apiKey?: string, quoteAsset: string = 'usd'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Kaiko',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Kaiko API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Kaiko', endpoint: 'volume', baseAsset, quoteAsset });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/data/trades.v1/spot_exchange_rate/${baseAsset.toLowerCase()}/${quoteAsset.toLowerCase()}/ohlcv`, {
        params: {
          interval: '1d',
          limit: 30 // Get last 30 days for volume analysis
        },
        headers: {
          'X-Api-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data) {
      throw new Error(`Kaiko API returned status ${response.status}`);
    }

    const data = response.data.data;
    if (data.length === 0) {
      return {
        volume24h: null,
        volume7d: null,
        volume30d: null,
        lastUpdated: new Date().toISOString()
      };
    }

    // Calculate volumes
    const latest = data[data.length - 1];
    const last7 = data.slice(-7);
    const last30 = data.slice(-30);

    const volume24h = latest.volume || null;
    const volume7d = last7.reduce((sum: number, item: any) => sum + (item.volume || 0), 0) || null;
    const volume30d = last30.reduce((sum: number, item: any) => sum + (item.volume || 0), 0) || null;

    return {
      volume24h,
      volume7d,
      volume30d,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('Kaiko getVolume error:', error.message);
    throw extractAdapterError('Kaiko', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * Note: Kaiko doesn't have a direct top coins endpoint, so we return major pairs
 * @param limit - Number of coins to return (default: 10)
 * @param apiKey - Kaiko API key
 * @returns Promise with major coin data
 */
export async function getTopCoins(limit: number = 10, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Kaiko',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'Kaiko API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Kaiko', endpoint: 'top-coins', limit });

    // Kaiko doesn't have a comprehensive top coins endpoint
    // We'll get exchange rates for major coins
    const majorCoins = ['btc', 'eth', 'bnb', 'ada', 'sol', 'dot', 'doge', 'avax', 'ltc', 'matic'];

    const coinPromises = majorCoins.slice(0, limit).map(async (coinSymbol, index) => {
      try {
        const response = await axios.get(`${BASE_URL}/data/trades.v1/spot_exchange_rate/${coinSymbol}/usd`, {
          headers: {
            'X-Api-Key': apiKey,
            'Accept': 'application/json'
          },
          timeout: 5000
        });

        const data = response.data?.data?.[0];
        return {
          id: coinSymbol,
          symbol: coinSymbol.toUpperCase(),
          name: coinSymbol.toUpperCase(), // Kaiko doesn't provide names
          price: data?.price || null,
          marketCap: null,
          volume24h: null,
          change24h: null,
          rank: index + 1
        };
      } catch (error) {
        // Return basic info if API call fails
        return {
          id: coinSymbol,
          symbol: coinSymbol.toUpperCase(),
          name: coinSymbol.toUpperCase(),
          price: null,
          marketCap: null,
          volume24h: null,
          change24h: null,
          rank: index + 1
        };
      }
    });

    const results = await Promise.all(coinPromises);
    return results.filter(coin => coin.price !== null);
  } catch (error: any) {
    console.error('Kaiko getTopCoins error:', error.message);
    throw extractAdapterError('Kaiko', 'getPriceData', BASE_URL, error);
  }
}
