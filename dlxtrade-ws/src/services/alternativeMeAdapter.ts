import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.alternative.me';

export async function fetchAlternativeMeNews(): Promise<any> {
  try {
    const url = `${BASE_URL}/fng/`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        timeout: 10000
      });
    });

    if (response.data && response.data.data) {
      return response.data.data.map((item: any) => ({
        value: parseInt(item.value),
        value_classification: item.value_classification,
        timestamp: item.timestamp,
        time_until_update: item.time_until_update
      }));
    }

    throw new AdapterError({
      adapter: 'Alternative.me',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from Alternative.me API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Alternative.me adapter error');
    throw new AdapterError({
      adapter: 'Alternative.me',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `Alternative.me API error: ${error.message}`,
      isAuthError: false
    });
  }
}
