import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.cryptorank.io/v1';

export async function fetchCryptoRankMarketData(): Promise<any> {
  try {
    const url = `${BASE_URL}/currencies`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        params: {
          limit: 100,
          sort: 'marketCap',
          order: 'desc'
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.data) {
      return response.data.data.map((coin: any) => ({
        id: coin.id,
        name: coin.name,
        symbol: coin.symbol,
        slug: coin.slug,
        rank: coin.rank,
        price: coin.values?.USD?.price,
        marketCap: coin.values?.USD?.marketCap,
        volume24h: coin.values?.USD?.volume24h,
        change24h: coin.values?.USD?.change24h,
        circulatingSupply: coin.circulatingSupply,
        totalSupply: coin.totalSupply,
        maxSupply: coin.maxSupply
      }));
    }

    throw new AdapterError({
      adapter: 'CryptoRank',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from CryptoRank API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'CryptoRank adapter error');
    throw new AdapterError({
      adapter: 'CryptoRank',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `CryptoRank API error: ${error.message}`,
      isAuthError: false
    });
  }
}
