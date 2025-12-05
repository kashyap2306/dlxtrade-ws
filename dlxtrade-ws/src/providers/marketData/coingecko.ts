import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.coingecko.com/api/v3';

/**
 * Test connection to CoinGecko API
 * @param apiKey - Not required for CoinGecko (free tier)
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinGecko', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/ping`, {
        timeout: 8000
      });
    });

    if (response.status === 200) {
      return { ok: true, message: 'CoinGecko API connection successful' };
    }

    return { ok: false, message: `CoinGecko API returned status ${response.status}` };
  } catch (error: any) {
    console.error('CoinGecko testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Fetch ticker data for a specific coin from CoinGecko
 * @param symbol - Coin symbol (e.g., 'bitcoin')
 * @param opts - Additional options
 * @returns Promise with ticker data
 */
export async function fetchTicker(symbol: string, opts?: any): Promise<{ ok: boolean, data?: any }> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinGecko', endpoint: 'ticker', symbol });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/simple/price`, {
        params: {
          ids: symbol.toLowerCase(),
          vs_currencies: 'usd',
          include_24hr_change: true,
          include_24hr_vol: true,
          include_market_cap: true,
          include_last_updated_at: true
        },
        timeout: 8000
      });
    });

    if (response.status !== 200 || !response.data) {
      return { ok: false, data: { error: `CoinGecko API returned status ${response.status}` } };
    }

    const coinData = response.data[symbol.toLowerCase()];
    if (!coinData) {
      return { ok: false, data: { error: `Coin ${symbol} not found in CoinGecko response` } };
    }

    return {
      ok: true,
      data: {
        symbol: symbol.toUpperCase(),
        price: coinData.usd || null,
        marketCap: coinData.usd_market_cap || null,
        volume24h: coinData.usd_24h_vol || null,
        change24h: coinData.usd_24h_change || null,
        lastUpdated: coinData.last_updated_at ? new Date(coinData.last_updated_at * 1000).toISOString() : new Date().toISOString()
      }
    };
  } catch (error: any) {
    console.error('CoinGecko fetchTicker error:', error.message);
    return { ok: false, data: { error: error.message } };
  }
}

/**
 * Get price data for a specific coin (legacy function for compatibility)
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - Not required for CoinGecko
 * @returns Promise with price data
 */
export async function getPriceData(symbol: string, apiKey?: string): Promise<any> {
  const result = await fetchTicker(symbol);
  if (!result.ok) {
    throw new Error(result.data?.error || 'Failed to fetch price data');
  }
  return result.data;
}

/**
 * Get OHLC data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - Not required for CoinGecko
 * @param interval - Time interval (1h, 24h, 7d, 30d, etc.)
 * @returns Promise with OHLC data
 */
export async function getOHLC(symbol: string, apiKey?: string, interval: string = '1d'): Promise<any> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinGecko', endpoint: 'ohlc', symbol, interval });

    // CoinGecko OHLC endpoint
    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/${symbol.toLowerCase()}/ohlc`, {
        params: {
          vs_currency: 'usd',
          days: interval === '1d' ? 1 : interval === '7d' ? 7 : interval === '30d' ? 30 : 1
        },
        timeout: 8000
      });
    });

    if (response.status !== 200 || !response.data || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error(`CoinGecko OHLC API returned status ${response.status} or invalid data`);
    }

    // CoinGecko OHLC format: [timestamp, open, high, low, close]
    const latestOHLC = response.data[response.data.length - 1];

    return {
      open: latestOHLC[1] || null,
      high: latestOHLC[2] || null,
      low: latestOHLC[3] || null,
      close: latestOHLC[4] || null,
      volume: null, // CoinGecko OHLC doesn't include volume
      timestamp: new Date(latestOHLC[0]).toISOString()
    };
  } catch (error: any) {
    console.error('CoinGecko getOHLC error:', error.message);
    throw extractAdapterError('CoinGecko', 'getOHLC', `${BASE_URL}/coins/${symbol.toLowerCase()}/ohlc`, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - Not required for CoinGecko
 * @returns Promise with volume data
 */
export async function getVolume(symbol: string, apiKey?: string): Promise<any> {
  const result = await fetchTicker(symbol);
  if (!result.ok) {
    throw new Error(result.data?.error || 'Failed to fetch volume data');
  }

  return {
    volume24h: result.data.volume24h || null,
    volume7d: null, // CoinGecko simple price doesn't provide 7d volume
    volume30d: null, // CoinGecko simple price doesn't provide 30d volume
    lastUpdated: result.data.lastUpdated || new Date().toISOString()
  };
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - Not required for CoinGecko
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  try {
    console.log('PROVIDER-CALL', { provider: 'CoinGecko', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/coins/markets`, {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: Math.min(limit, 250), // CoinGecko max is 250
          page: 1,
          sparkline: false,
          price_change_percentage: '24h'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`CoinGecko API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.map((coin: any, index: number) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price || null,
      marketCap: coin.market_cap || null,
      volume24h: coin.total_volume || null,
      change24h: coin.price_change_percentage_24h || null,
      rank: index + 1
    }));
  } catch (error: any) {
    console.error('CoinGecko getTopCoins error:', error.message);
    throw extractAdapterError('CoinGecko', 'getTopCoins', `${BASE_URL}/coins/markets`, error);
  }
}
