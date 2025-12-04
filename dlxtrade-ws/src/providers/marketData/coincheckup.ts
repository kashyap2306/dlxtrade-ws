import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.coincheckup.com/v1';

/**
 * Get price data for a specific coin
 * @param coinId - CoinCheckup coin ID or symbol
 * @returns Promise with price data
 */
export async function getPriceData(coinId: string): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinCheckup', endpoint: 'price', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`CoinCheckup API returned status ${response.status}`);
    }

    const data = response.data;
    return {
      symbol: data.symbol || null,
      price: data.price || null,
      marketCap: data.market_cap || null,
      volume24h: data.volume_24h || null,
      change24h: data.percent_change_24h || null,
      lastUpdated: data.last_updated || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinCheckup getPriceData error:', error.message);
    throw extractAdapterError('CoinCheckup', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * Note: CoinCheckup may not have dedicated OHLC endpoint, using price data
 * @param coinId - CoinCheckup coin ID or symbol
 * @param interval - Time interval (not used for CoinCheckup)
 * @returns Promise with basic price data (no true OHLC)
 */
export async function getOHLC(coinId: string, interval: string = '24h'): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinCheckup', endpoint: 'ohlc', coinId, interval });

    // CoinCheckup may not have OHLC, so get basic price data
    const priceData = await getPriceData(coinId);

    // Return OHLC-like structure with available data
    return {
      open: priceData.price || null,
      high: priceData.price || null,
      low: priceData.price || null,
      close: priceData.price || null,
      volume: priceData.volume24h || null,
      timestamp: priceData.lastUpdated
    };
  } catch (error: any) {
    console.error('CoinCheckup getOHLC error:', error.message);
    throw extractAdapterError('CoinCheckup', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param coinId - CoinCheckup coin ID or symbol
 * @returns Promise with volume data
 */
export async function getVolume(coinId: string): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinCheckup', endpoint: 'volume', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${coinId}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`CoinCheckup API returned status ${response.status}`);
    }

    const data = response.data;
    return {
      volume24h: data.volume_24h || null,
      volume7d: null, // CoinCheckup may not provide extended volume data
      volume30d: null,
      lastUpdated: data.last_updated || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinCheckup getVolume error:', error.message);
    throw extractAdapterError('CoinCheckup', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100): Promise<any[]> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinCheckup', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins`, {
        params: {
          limit: Math.min(limit, 250), // CoinCheckup may have limits
          sort: 'market_cap',
          order: 'desc'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`CoinCheckup API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.map((coin: any, index: number) => ({
      id: coin.id?.toString() || null,
      symbol: coin.symbol || null,
      name: coin.name || null,
      price: coin.price || null,
      marketCap: coin.market_cap || null,
      volume24h: coin.volume_24h || null,
      change24h: coin.percent_change_24h || null,
      rank: index + 1
    }));
  } catch (error: any) {
    console.error('CoinCheckup getTopCoins error:', error.message);
    throw extractAdapterError('CoinCheckup', 'getPriceData', BASE_URL, error);
  }
}
