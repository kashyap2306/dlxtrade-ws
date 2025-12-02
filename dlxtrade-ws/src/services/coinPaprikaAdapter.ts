import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.coinpaprika.com/v1';

export async function fetchCoinPaprikaMarketData(coinId: string): Promise<any> {
  try {
    const url = `${BASE_URL}/coins/${coinId}`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        timeout: 10000
      });
    });

    if (response.data) {
      return {
        id: response.data.id,
        name: response.data.name,
        symbol: response.data.symbol,
        rank: response.data.rank,
        circulating_supply: response.data.circulating_supply,
        total_supply: response.data.total_supply,
        max_supply: response.data.max_supply,
        beta_value: response.data.beta_value,
        first_data_at: response.data.first_data_at,
        last_updated: response.data.last_updated
      };
    }

    throw new AdapterError({
      adapter: 'CoinPaprika',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from CoinPaprika API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message, coinId }, 'CoinPaprika adapter error');
    throw new AdapterError({
      adapter: 'CoinPaprika',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `CoinPaprika API error: ${error.message}`,
      isAuthError: false
    });
  }
}
