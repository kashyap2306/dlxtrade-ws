import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://data.messari.io/api/v1';

export async function fetchMessariMarketData(symbol: string, apiKey: string): Promise<any> {
  try {
    const url = `${BASE_URL}/assets/${symbol.toLowerCase()}/metrics`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        headers: {
          'x-messari-api-key': apiKey
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.data) {
      const metrics = response.data.data;
      return {
        symbol: symbol.toUpperCase(),
        name: metrics.name?.value,
        price: metrics.market_data?.price_usd,
        market_cap: metrics.marketcap?.current_marketcap_usd,
        volume_24h: metrics.market_data?.volume_last_24_hours,
        price_change_24h: metrics.market_data?.percent_change_usd_last_24_hours,
        all_time_high: metrics.all_time_high?.price,
        rank: metrics.marketcap?.rank
      };
    }

    throw new AdapterError({
      adapter: 'Messari',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from Messari API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message, symbol }, 'Messari adapter error');
    throw new AdapterError({
      adapter: 'Messari',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `Messari API error: ${error.message}`,
      isAuthError: false
    });
  }
}
