import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.nomics.com/v1';

export async function fetchNomicsMarketData(symbol: string, apiKey: string): Promise<any> {
  try {
    const url = `${BASE_URL}/currencies/ticker`;

    const response = await retryWithBackoff(async () => {
      return await axios.get(url, {
        params: {
          key: apiKey,
          ids: symbol.toUpperCase(),
          interval: '1d',
          convert: 'USD'
        },
        timeout: 10000
      });
    });

    if (response.data && response.data.length > 0) {
      const data = response.data[0];
      return {
        id: data.id,
        currency: data.currency,
        symbol: data.symbol,
        name: data.name,
        price: parseFloat(data.price),
        price_date: data.price_date,
        price_timestamp: data.price_timestamp,
        market_cap: parseFloat(data.market_cap || '0'),
        circulating_supply: parseFloat(data.circulating_supply || '0'),
        max_supply: parseFloat(data.max_supply || '0')
      };
    }

    throw new AdapterError({
      adapter: 'Nomics',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Currency not found in Nomics API',
      isAuthError: false
    });
  } catch (error: any) {
    logger.error({ error: error.message, symbol }, 'Nomics adapter error');
    throw new AdapterError({
      adapter: 'Nomics',
      method: 'GET',
      url: BASE_URL,
      errorMessage: `Nomics API error: ${error.message}`,
      isAuthError: false
    });
  }
}
