import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://min-api.cryptocompare.com/data';

/**
 * Test connection to CryptoCompare API
 * @param apiKey - CryptoCompare API key
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  if (!apiKey) {
    return { ok: false, message: 'CryptoCompare API key is required' };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CryptoCompare', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/price`, {
        params: {
          fsym: 'BTC',
          tsyms: 'USD',
          api_key: apiKey
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data?.USD) {
      return { ok: true, message: 'CryptoCompare API connection successful' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Invalid API key' };
    }

    return { ok: false, message: `CryptoCompare API returned status ${response.status}` };
  } catch (error: any) {
    console.error('CryptoCompare testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Fetch metadata for a coin (placeholder for contract compliance)
 * @param symbol - Coin symbol
 * @param opts - Additional options (apiKey required)
 * @returns Promise with metadata
 */
export async function fetchTicker(symbol: string, opts?: any): Promise<{ ok: boolean, data?: any }> {
  const apiKey = opts?.apiKey;
  if (!apiKey) {
    return { ok: false, data: { error: 'CryptoCompare API key is required' } };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CryptoCompare', endpoint: 'metadata', symbol });

    // Get price data
    const priceResponse = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/price`, {
        params: {
          fsym: symbol.toUpperCase(),
          tsyms: 'USD',
          api_key: apiKey
        },
        timeout: 8000
      });
    });

    // Get general coin info
    const infoResponse = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/all/coinlist`, {
        params: {
          api_key: apiKey
        },
        timeout: 8000
      });
    });

    if (priceResponse.status !== 200 || infoResponse.status !== 200) {
      return { ok: false, data: { error: 'Failed to fetch data from CryptoCompare' } };
    }

    const priceData = priceResponse.data;
    const coinList = infoResponse.data?.Data || {};
    const coinInfo = Object.values(coinList).find((coin: any) =>
      coin.Symbol === symbol.toUpperCase()
    ) as any;

    return {
      ok: true,
      data: {
        symbol: symbol.toUpperCase(),
        name: coinInfo?.FullName || symbol,
        price: priceData.USD || null,
        description: coinInfo?.Description || '',
        supply: coinInfo?.TotalCoinSupply ? parseFloat(coinInfo.TotalCoinSupply) : null,
        maxSupply: coinInfo?.MaxSupply ? parseFloat(coinInfo.MaxSupply) : null
      }
    };
  } catch (error: any) {
    console.error('CryptoCompare fetchTicker error:', error.message);
    return { ok: false, data: { error: error.message } };
  }
}

interface MetadataItem {
  symbol: string;
  name: string;
  marketCap: number | null;
  supply: number | null;
  maxSupply: number | null;
  description: string;
}

/**
 * Get metadata for a specific coin by symbol from CryptoCompare
 * @param symbol - Coin symbol (e.g., 'BTC')
 * @param apiKey - CryptoCompare API key
 * @returns Promise with normalized metadata
 */
export async function getMetadataBySymbol(symbol: string, apiKey?: string): Promise<MetadataItem[]> {
  try {
    if (!apiKey) {
      console.warn('CryptoCompare API key not provided, skipping...');
      return [];
    }

    console.log('PROVIDER-CALL', { provider: 'CryptoCompare', endpoint: 'all/coinlist', symbol });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/all/coinlist`, {
        params: {
          api_key: apiKey
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.Data) {
      throw new Error(`CryptoCompare API returned status ${response.status}`);
    }

    const coinData = Object.values(response.data.Data).find((coin: any) =>
      coin.Symbol === symbol.toUpperCase()
    ) as any;

    if (!coinData) {
      throw new Error(`Coin ${symbol} not found in CryptoCompare data`);
    }

    // Normalize to standard format
    const normalizedMetadata: MetadataItem = {
      symbol: coinData.Symbol?.toUpperCase() || symbol.toUpperCase(),
      name: coinData.CoinName || coinData.FullName || '',
      marketCap: null, // CryptoCompare doesn't provide market cap in coinlist
      supply: coinData.TotalCoinSupply ? parseFloat(coinData.TotalCoinSupply) : null,
      maxSupply: coinData.TotalCoinSupply ? parseFloat(coinData.TotalCoinSupply) : null,
      description: coinData.Description || ''
    };

    return [normalizedMetadata];
  } catch (error: any) {
    console.error('CryptoCompare getMetadataBySymbol error:', error.message);
    throw extractAdapterError('CryptoCompare', 'getMetadataBySymbol', BASE_URL, error);
  }
}
