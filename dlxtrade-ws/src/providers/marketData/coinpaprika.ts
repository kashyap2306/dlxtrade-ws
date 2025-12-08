import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.coinpaprika.com/v1';

/**
 * Get price data for a specific coin
 * @param coinId - CoinPaprika coin ID (e.g., 'btc-bitcoin')
 * @returns Promise with price data
 */
export async function getPriceData(coinId: string): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinPaprika', endpoint: 'price', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`CoinPaprika API returned status ${response.status}`);
    }

    // Transform CoinPaprika response to standard format
    const data = response.data;
    return {
      symbol: data.symbol,
      price: data.quotes?.USD?.price || null,
      marketCap: data.quotes?.USD?.market_cap || null,
      volume24h: data.quotes?.USD?.volume_24h || null,
      change24h: data.quotes?.USD?.percent_change_24h || null,
      lastUpdated: data.last_updated || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinPaprika getPriceData error:', error.message);
    throw extractAdapterError('CoinPaprika', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param coinId - CoinPaprika coin ID (e.g., 'btc-bitcoin')
 * @param interval - Time interval (1h, 24h, 7d, 30d, etc.)
 * @returns Promise with OHLC data
 */
export async function getOHLC(coinId: string, interval: string = '24h'): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinPaprika', endpoint: 'ohlc', coinId, interval });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId}/ohlcv/latest`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`CoinPaprika API returned status ${response.status}`);
    }

    // CoinPaprika returns OHLC data in a specific format
    const data = response.data;
    return {
      open: data.open || null,
      high: data.high || null,
      low: data.low || null,
      close: data.close || null,
      volume: data.volume || null,
      timestamp: data.time_open || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinPaprika getOHLC error:', error.message);
    throw extractAdapterError('CoinPaprika', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param coinId - CoinPaprika coin ID (e.g., 'btc-bitcoin')
 * @returns Promise with volume data
 */
export async function getVolume(coinId: string): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinPaprika', endpoint: 'volume', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`CoinPaprika API returned status ${response.status}`);
    }

    const data = response.data;
    return {
      volume24h: data.quotes?.USD?.volume_24h || null,
      volume7d: data.quotes?.USD?.volume_7d || null,
      volume30d: data.quotes?.USD?.volume_30d || null,
      lastUpdated: data.last_updated || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinPaprika getVolume error:', error.message);
    throw extractAdapterError('CoinPaprika', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100): Promise<any[]> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinPaprika', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins`, {
        params: {
          limit: Math.min(limit, 250) // CoinPaprika allows max 250
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`CoinPaprika API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.map((coin: any) => ({
      id: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      price: coin.quotes?.USD?.price || null,
      marketCap: coin.quotes?.USD?.market_cap || null,
      volume24h: coin.quotes?.USD?.volume_24h || null,
      change24h: coin.quotes?.USD?.percent_change_24h || null,
      rank: coin.rank || null
    }));
  } catch (error: any) {
    console.error('CoinPaprika getTopCoins error:', error.message);
    throw extractAdapterError('CoinPaprika', 'getPriceData', BASE_URL, error);
  }
}
