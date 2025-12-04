import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://rest.coinapi.io/v1';

/**
 * Get price data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CoinAPI key
 * @returns Promise with price data
 */
export async function getPriceData(symbol: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinAPI',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinAPI key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinAPI', endpoint: 'price', symbol });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/exchangerate/${symbol}/USD`, {
        headers: {
          'X-CoinAPI-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data) {
      throw new Error(`CoinAPI returned status ${response.status}`);
    }

    const data = response.data;
    return {
      symbol: symbol.toUpperCase(),
      price: data.rate || null,
      marketCap: null, // CoinAPI doesn't provide market cap in this endpoint
      volume24h: null, // CoinAPI doesn't provide volume in this endpoint
      change24h: null, // CoinAPI doesn't provide change in this endpoint
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinAPI getPriceData error:', error.message);
    throw extractAdapterError('CoinAPI', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CoinAPI key
 * @param interval - Time interval (1H, 1D, etc.)
 * @returns Promise with OHLC data
 */
export async function getOHLC(symbol: string, apiKey?: string, interval: string = '1DAY'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinAPI',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinAPI key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinAPI', endpoint: 'ohlc', symbol, interval });

    // Map interval to CoinAPI format
    const intervalMap: { [key: string]: string } = {
      '1h': '1HRS',
      '24h': '1DAY',
      '1d': '1DAY',
      '7d': '7DAY',
      '30d': '30DAY'
    };

    const coinapiInterval = intervalMap[interval] || '1DAY';

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/ohlcv/BINANCE_SPOT_${symbol}_USDT/history`, {
        params: {
          period_id: coinapiInterval,
          limit: 1, // Get latest OHLC
          include_empty_items: false
        },
        headers: {
          'X-CoinAPI-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data) || response.data.length === 0) {
      throw new Error(`CoinAPI returned status ${response.status}`);
    }

    const ohlc = response.data[0];
    return {
      open: ohlc.price_open || null,
      high: ohlc.price_high || null,
      low: ohlc.price_low || null,
      close: ohlc.price_close || null,
      volume: ohlc.volume_traded || null,
      timestamp: ohlc.time_period_start || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinAPI getOHLC error:', error.message);
    throw extractAdapterError('CoinAPI', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CoinAPI key
 * @returns Promise with volume data
 */
export async function getVolume(symbol: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinAPI',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinAPI key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinAPI', endpoint: 'volume', symbol });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/ohlcv/BINANCE_SPOT_${symbol}_USDT/history`, {
        params: {
          period_id: '1DAY',
          limit: 30, // Get last 30 days for volume analysis
          include_empty_items: false
        },
        headers: {
          'X-CoinAPI-Key': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`CoinAPI returned status ${response.status}`);
    }

    if (response.data.length === 0) {
      return {
        volume24h: null,
        volume7d: null,
        volume30d: null,
        lastUpdated: new Date().toISOString()
      };
    }

    // Calculate volumes from available data
    const latest = response.data[response.data.length - 1];
    const last7 = response.data.slice(-7);
    const last30 = response.data.slice(-30);

    const volume24h = latest?.volume_traded || null;
    const volume7d = last7.reduce((sum: number, item: any) => sum + (item.volume_traded || 0), 0) || null;
    const volume30d = last30.reduce((sum: number, item: any) => sum + (item.volume_traded || 0), 0) || null;

    return {
      volume24h,
      volume7d,
      volume30d,
      lastUpdated: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinAPI getVolume error:', error.message);
    throw extractAdapterError('CoinAPI', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * Note: CoinAPI doesn't have a direct top coins endpoint, so we return limited data
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - CoinAPI key
 * @returns Promise with basic coin data (limited by CoinAPI's capabilities)
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinAPI',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'CoinAPI key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinAPI', endpoint: 'top-coins', limit });

    // CoinAPI doesn't have a comprehensive top coins endpoint
    // We'll get exchange rates for major coins
    const majorCoins = ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'DOGE', 'AVAX', 'LTC', 'MATIC'];

    const coinPromises = majorCoins.slice(0, limit).map(async (coinSymbol) => {
      try {
        const response = await axios.get(`${BASE_URL}/exchangerate/${coinSymbol}/USD`, {
          headers: {
            'X-CoinAPI-Key': apiKey,
            'Accept': 'application/json'
          },
          timeout: 5000
        });

        return {
          id: coinSymbol.toLowerCase(),
          symbol: coinSymbol,
          name: coinSymbol, // CoinAPI doesn't provide names in this endpoint
          price: response.data?.rate || null,
          marketCap: null,
          volume24h: null,
          change24h: null,
          rank: null
        };
      } catch (error) {
        // Return basic info if API call fails
        return {
          id: coinSymbol.toLowerCase(),
          symbol: coinSymbol,
          name: coinSymbol,
          price: null,
          marketCap: null,
          volume24h: null,
          change24h: null,
          rank: null
        };
      }
    });

    const results = await Promise.all(coinPromises);
    return results.filter(coin => coin.price !== null);
  } catch (error: any) {
    console.error('CoinAPI getTopCoins error:', error.message);
    throw extractAdapterError('CoinAPI', 'getPriceData', BASE_URL, error);
  }
}
