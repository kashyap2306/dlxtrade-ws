import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://pro-api.coinmarketcap.com/v1';

/**
 * Get price data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CoinMarketCap API key
 * @returns Promise with price data
 */
export async function getPriceData(symbol: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinMarketCap',
      method: 'getPriceData',
      url: `${BASE_URL}/cryptocurrency/quotes/latest`,
      statusCode: 401,
      errorMessage: 'CoinMarketCap API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinMarketCap', endpoint: 'price', symbol });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/cryptocurrency/quotes/latest`, {
        params: {
          symbol: symbol.toUpperCase(),
          convert: 'USD'
        },
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data) {
      throw new Error(`CoinMarketCap API returned status ${response.status}`);
    }

    const coinData = response.data.data[symbol.toUpperCase()];
    if (!coinData) {
      throw new Error(`Coin ${symbol} not found in CoinMarketCap response`);
    }

    const quote = coinData.quote?.USD;
    return {
      symbol: coinData.symbol,
      price: quote?.price || null,
      marketCap: quote?.market_cap || null,
      volume24h: quote?.volume_24h || null,
      change24h: quote?.percent_change_24h || null,
      lastUpdated: quote?.last_updated || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinMarketCap getPriceData error:', error.message);
    throw extractAdapterError('CoinMarketCap', 'getPriceData', `${BASE_URL}/cryptocurrency/quotes/latest`, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CoinMarketCap API key
 * @param interval - Time interval (1h, 24h, 7d, 30d, etc.)
 * @returns Promise with OHLC data
 */
export async function getOHLC(symbol: string, apiKey?: string, interval: string = '1d'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinMarketCap',
      method: 'getOHLC',
      url: `${BASE_URL}/cryptocurrency/ohlcv/historical`,
      statusCode: 401,
      errorMessage: 'CoinMarketCap API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinMarketCap', endpoint: 'ohlc', symbol, interval });

    // Map interval to CoinMarketCap format
    const intervalMap: { [key: string]: string } = {
      '1h': 'hourly',
      '24h': 'daily',
      '1d': 'daily',
      '7d': 'daily',
      '30d': 'daily'
    };

    const cmcInterval = intervalMap[interval] || 'daily';

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/cryptocurrency/ohlcv/historical`, {
        params: {
          symbol: symbol.toUpperCase(),
          time_period: cmcInterval,
          count: 1, // Get latest OHLC
          convert: 'USD'
        },
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data?.quotes) {
      throw new Error(`CoinMarketCap API returned status ${response.status}`);
    }

    const quotes = response.data.data.quotes;
    if (!quotes || quotes.length === 0) {
      throw new Error(`No OHLC data found for ${symbol}`);
    }

    const latestQuote = quotes[quotes.length - 1];
    const ohlc = latestQuote.quote?.USD;

    return {
      open: ohlc?.open || null,
      high: ohlc?.high || null,
      low: ohlc?.low || null,
      close: ohlc?.close || null,
      volume: ohlc?.volume || null,
      timestamp: latestQuote.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinMarketCap getOHLC error:', error.message);
    throw extractAdapterError('CoinMarketCap', 'getOHLC', `${BASE_URL}/cryptocurrency/ohlcv/historical`, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CoinMarketCap API key
 * @returns Promise with volume data
 */
export async function getVolume(symbol: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinMarketCap',
      method: 'getVolume',
      url: `${BASE_URL}/cryptocurrency/quotes/latest`,
      statusCode: 401,
      errorMessage: 'CoinMarketCap API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinMarketCap', endpoint: 'volume', symbol });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/cryptocurrency/quotes/latest`, {
        params: {
          symbol: symbol.toUpperCase(),
          convert: 'USD'
        },
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data) {
      throw new Error(`CoinMarketCap API returned status ${response.status}`);
    }

    const coinData = response.data.data[symbol.toUpperCase()];
    if (!coinData) {
      throw new Error(`Coin ${symbol} not found in CoinMarketCap response`);
    }

    const quote = coinData.quote?.USD;
    return {
      volume24h: quote?.volume_24h || null,
      volume7d: quote?.volume_7d || null,
      volume30d: quote?.volume_30d || null,
      lastUpdated: quote?.last_updated || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('CoinMarketCap getVolume error:', error.message);
    throw extractAdapterError('CoinMarketCap', 'getVolume', `${BASE_URL}/cryptocurrency/quotes/latest`, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - CoinMarketCap API key
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinMarketCap',
      method: 'getTopCoins',
      url: `${BASE_URL}/cryptocurrency/listings/latest`,
      statusCode: 401,
      errorMessage: 'CoinMarketCap API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinMarketCap', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/cryptocurrency/listings/latest`, {
        params: {
          start: 1,
          limit: Math.min(limit, 5000), // CMC allows max 5000
          convert: 'USD',
          sort: 'market_cap',
          sort_dir: 'desc'
        },
        headers: {
          'X-CMC_PRO_API_KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data?.data)) {
      throw new Error(`CoinMarketCap API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.data.map((coin: any) => ({
      id: coin.id.toString(),
      symbol: coin.symbol,
      name: coin.name,
      price: coin.quote?.USD?.price || null,
      marketCap: coin.quote?.USD?.market_cap || null,
      volume24h: coin.quote?.USD?.volume_24h || null,
      change24h: coin.quote?.USD?.percent_change_24h || null,
      rank: coin.cmc_rank || null
    }));
  } catch (error: any) {
    console.error('CoinMarketCap getTopCoins error:', error.message);
    throw extractAdapterError('CoinMarketCap', 'getTopCoins', `${BASE_URL}/cryptocurrency/listings/latest`, error);
  }
}
