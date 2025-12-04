import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.coinstats.app/public/v1';

/**
 * Get price data for a specific coin
 * @param coinId - Coin ID or symbol (e.g., 'bitcoin' or 'BTC')
 * @param apiKey - CoinStats API key
 * @returns Promise with price data
 */
export async function getPriceData(coinId: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinStats',
      method: 'getPriceData',
      url: `${BASE_URL}/coins/${coinId.toLowerCase()}`,
      statusCode: 401,
      errorMessage: 'CoinStats API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStats', endpoint: 'price', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId.toLowerCase()}`, {
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.coin) {
      throw new Error(`CoinStats API returned status ${response.status}`);
    }

    const coin = response.data.coin;
    return {
      symbol: coin.symbol || null,
      price: coin.price || null,
      marketCap: coin.marketCap || null,
      volume24h: coin.volume || null,
      change24h: coin.priceChange1d || null,
      lastUpdated: coin.lastUpdate || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinStats getPriceData error:', error.message);
    throw extractAdapterError('CoinStats', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param coinId - Coin ID or symbol (e.g., 'bitcoin' or 'BTC')
 * @param apiKey - CoinStats API key
 * @param interval - Time interval
 * @returns Promise with OHLC data
 */
export async function getOHLC(coinId: string, apiKey?: string, interval: string = '1d'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinStats',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinStats API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStats', endpoint: 'ohlc', coinId, interval });

    // Map interval to CoinStats format
    const intervalMap: { [key: string]: string } = {
      '1h': '1h',
      '24h': '1d',
      '1d': '1d',
      '7d': '7d',
      '30d': '30d'
    };

    const coinStatsInterval = intervalMap[interval] || '1d';

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/charts`, {
        params: {
          coinId: coinId.toLowerCase(),
          period: coinStatsInterval,
          limit: 1 // Get latest OHLC
        },
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.chart || response.data.chart.length === 0) {
      throw new Error(`CoinStats API returned status ${response.status}`);
    }

    const chart = response.data.chart[0];
    return {
      open: chart[1] || null, // [timestamp, open, high, low, close]
      high: chart[2] || null,
      low: chart[3] || null,
      close: chart[4] || null,
      volume: null, // CoinStats chart may not include volume
      timestamp: new Date(chart[0]).toISOString()
    };
  } catch (error: any) {
    console.error('CoinStats getOHLC error:', error.message);
    throw extractAdapterError('CoinStats', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param coinId - Coin ID or symbol (e.g., 'bitcoin' or 'BTC')
 * @param apiKey - CoinStats API key
 * @returns Promise with volume data
 */
export async function getVolume(coinId: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinStats',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinStats API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStats', endpoint: 'volume', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId.toLowerCase()}`, {
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.coin) {
      throw new Error(`CoinStats API returned status ${response.status}`);
    }

    const coin = response.data.coin;
    return {
      volume24h: coin.volume || null,
      volume7d: null, // CoinStats may not provide 7d/30d volume directly
      volume30d: null,
      lastUpdated: coin.lastUpdate || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinStats getVolume error:', error.message);
    throw extractAdapterError('CoinStats', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - CoinStats API key
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinStats',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinStats API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStats', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins`, {
        params: {
          skip: 0,
          limit: Math.min(limit, 1000), // CoinStats allows up to 1000
          currency: 'USD'
        },
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data?.coins)) {
      throw new Error(`CoinStats API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.coins.map((coin: any) => ({
      id: coin.id || null,
      symbol: coin.symbol || null,
      name: coin.name || null,
      price: coin.price || null,
      marketCap: coin.marketCap || null,
      volume24h: coin.volume || null,
      change24h: coin.priceChange1d || null,
      rank: coin.rank || null
    }));
  } catch (error: any) {
    console.error('CoinStats getTopCoins error:', error.message);
    throw extractAdapterError('CoinStats', 'getPriceData', BASE_URL, error);
  }
}
