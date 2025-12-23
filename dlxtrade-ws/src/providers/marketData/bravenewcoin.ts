import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://bravenewcoin.p.rapidapi.com';

/**
 * Get price data for a specific coin
 * @param assetId - BraveNewCoin asset ID
 * @param apiKey - RapidAPI key for BraveNewCoin
 * @returns Promise with price data
 */
export async function getPriceData(assetId: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'BraveNewCoin',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'BraveNewCoin API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'BraveNewCoin', endpoint: 'price', assetId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/market-cap`, {
        params: {
          assetId: assetId
        },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'bravenewcoin.p.rapidapi.com',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.content) {
      throw new Error(`BraveNewCoin API returned status ${response.status}`);
    }

    const data = response.data.content[0];
    if (!data) {
      throw new Error(`Asset ${assetId} not found in BraveNewCoin response`);
    }

    return {
      symbol: data.asset?.symbol || null,
      price: data.price?.value || null,
      marketCap: data.marketCap?.value || null,
      volume24h: data.volume?.value || null,
      change24h: data.changePercent24Hr?.value || null,
      lastUpdated: data.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('BraveNewCoin getPriceData error:', error.message);
    throw extractAdapterError('BraveNewCoin', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get OHLC data for a specific coin
 * @param assetId - BraveNewCoin asset ID
 * @param apiKey - RapidAPI key for BraveNewCoin
 * @param interval - Time interval
 * @returns Promise with OHLC data
 */
export async function getOHLC(assetId: string, apiKey?: string, interval: string = '1d'): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'BraveNewCoin',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'BraveNewCoin API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'BraveNewCoin', endpoint: 'ohlc', assetId, interval });

    // Map interval to BraveNewCoin format
    const intervalMap: { [key: string]: string } = {
      '1h': '1h',
      '24h': '1d',
      '1d': '1d',
      '7d': '7d',
      '30d': '30d'
    };

    const bncInterval = intervalMap[interval] || '1d';

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/ohlcv`, {
        params: {
          assetId: assetId,
          interval: bncInterval,
          limit: 1 // Get latest OHLC
        },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'bravenewcoin.p.rapidapi.com',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.content || response.data.content.length === 0) {
      throw new Error(`BraveNewCoin API returned status ${response.status}`);
    }

    const ohlc = response.data.content[0];
    return {
      open: ohlc.open?.value || null,
      high: ohlc.high?.value || null,
      low: ohlc.low?.value || null,
      close: ohlc.close?.value || null,
      volume: ohlc.volume?.value || null,
      timestamp: ohlc.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('BraveNewCoin getOHLC error:', error.message);
    throw extractAdapterError('BraveNewCoin', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get volume data for a specific coin
 * @param assetId - BraveNewCoin asset ID
 * @param apiKey - RapidAPI key for BraveNewCoin
 * @returns Promise with volume data
 */
export async function getVolume(assetId: string, apiKey?: string): Promise<any> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'BraveNewCoin',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'BraveNewCoin API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'BraveNewCoin', endpoint: 'volume', assetId });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/market-cap`, {
        params: {
          assetId: assetId
        },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'bravenewcoin.p.rapidapi.com',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.content) {
      throw new Error(`BraveNewCoin API returned status ${response.status}`);
    }

    const data = response.data.content[0];
    if (!data) {
      throw new Error(`Asset ${assetId} not found in BraveNewCoin response`);
    }

    return {
      volume24h: data.volume?.value || null,
      volume7d: null, // BraveNewCoin may not provide 7d/30d volume in this endpoint
      volume30d: null,
      lastUpdated: data.timestamp || new Date().toISOString()
    };
  } catch (error: any) {
    console.error('BraveNewCoin getVolume error:', error.message);
    throw extractAdapterError('BraveNewCoin', 'getPriceData', BASE_URL, error);
  }
}

/**
 * Get top coins by market cap
 * @param limit - Number of coins to return (default: 100)
 * @param apiKey - RapidAPI key for BraveNewCoin
 * @returns Promise with top coins data
 */
export async function getTopCoins(limit: number = 100, apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'BraveNewCoin',
      method: 'getPriceData',
      url: BASE_URL,
      statusCode: 401,
      errorMessage: 'BraveNewCoin API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'BraveNewCoin', endpoint: 'top-coins', limit });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/market-cap`, {
        params: {
          limit: Math.min(limit, 100), // BraveNewCoin may have limits
          sort: 'marketCap',
          order: 'desc'
        },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'bravenewcoin.p.rapidapi.com',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data?.content)) {
      throw new Error(`BraveNewCoin API returned status ${response.status}`);
    }

    // Transform to standard format
    return response.data.content.map((coin: any, index: number) => ({
      id: coin.asset?.id || null,
      symbol: coin.asset?.symbol || null,
      name: coin.asset?.name || null,
      price: coin.price?.value || null,
      marketCap: coin.marketCap?.value || null,
      volume24h: coin.volume?.value || null,
      change24h: coin.changePercent24Hr?.value || null,
      rank: index + 1
    }));
  } catch (error: any) {
    console.error('BraveNewCoin getTopCoins error:', error.message);
    throw extractAdapterError('BraveNewCoin', 'getPriceData', BASE_URL, error);
  }
}
