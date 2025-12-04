import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.coinlore.net/api';

/**
 * Get price data for a specific coin
 * @param coinId - CoinLore coin ID (numeric string)
 * @returns Promise with price data
 */
export async function getPriceData(coinId: string): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinLore', endpoint: 'price', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/ticker/?id=${coinId}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error(`CoinLore API returned status ${response.status}`);
    }

    const coin = response.data[0];
    return {
      symbol: coin.symbol || null,
      price: parseFloat(coin.price_usd) || null,
      marketCap: parseFloat(coin.market_cap_usd) || null,
      volume24h: parseFloat(coin.volume24) || null,
      change24h: parseFloat(coin.percent_change_24h) || null,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinLore getPriceData error:', error.message);
    throw extractAdapterError('CoinLore', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * Note: CoinLore doesn't provide OHLC data directly, so we return basic price info
 * @param coinId - CoinLore coin ID (numeric string)
 * @param interval - Time interval (not used for CoinLore)
 * @returns Promise with basic price data (no true OHLC)
 */
export async function getOHLC(coinId: string, interval: string = '24h'): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinLore', endpoint: 'ohlc', coinId, interval });

    // CoinLore doesn't have OHLC endpoint, so get basic price data
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
    console.error('CoinLore getOHLC error:', error.message);
    throw extractAdapterError('CoinLore', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param coinId - CoinLore coin ID (numeric string)
 * @returns Promise with volume data
 */
export async function getVolume(coinId: string): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinLore', endpoint: 'volume', coinId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/ticker/?id=${coinId}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error(`CoinLore API returned status ${response.status}`);
    }

    const coin = response.data[0];
    return {
      volume24h: parseFloat(coin.volume24) || null,
      volume7d: null, // CoinLore doesn't provide 7d/30d volume
      volume30d: null,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinLore getVolume error:', error.message);
    throw extractAdapterError('CoinLore', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100): Promise<any[]> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinLore', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/tickers/?start=0&limit=${Math.min(limit, 100)}`, {
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data || !Array.isArray(response.data.data)) {
      throw new Error(`CoinLore API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.data.map((coin: any) => ({
      id: coin.id?.toString() || null,
      symbol: coin.symbol || null,
      name: coin.name || null,
      price: parseFloat(coin.price_usd) || null,
      marketCap: parseFloat(coin.market_cap_usd) || null,
      volume24h: parseFloat(coin.volume24) || null,
      change24h: parseFloat(coin.percent_change_24h) || null,
      rank: parseInt(coin.rank) || null
    }));
  } catch (error: any) {
    console.error('CoinLore getTopCoins error:', error.message);
    throw extractAdapterError('CoinLore', 'getPriceData', BASE_URL, error);
  }
}
