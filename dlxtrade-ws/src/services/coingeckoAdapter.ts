import { AdapterError } from '../utils/adapterErrorHandler';
import { retryWithBackoff, rateLimiters } from '../utils/rateLimiter';
import axios from 'axios';
import { logger } from '../utils/logger';

const BASE_URL = 'https://api.coingecko.com/api/v3';

export async function fetchCoinGeckoMarketData(symbol: string, apiKey?: string): Promise<any> {
  const startTime = Date.now();

  try {
    const coinId = symbol.toLowerCase();
    console.log('[CoinGecko] START - Fetching market data for', symbol);

    const response = await retryWithBackoff(async () => {
      return await axios.get(`${BASE_URL}/coins/${coinId}`, {
        params: {
          localization: false,
          tickers: false,
          market_data: true,
          community_data: false,
          developer_data: false,
          sparkline: false
        },
        headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : {},
        timeout: 10000
      });
    });

    if (response.data && response.data.market_data) {
      const result = {
        provider: 'coingecko',
        success: true,
        symbol: symbol,
        price: response.data.market_data.current_price?.usd,
        market_cap: response.data.market_data.market_cap?.usd,
        volume_24h: response.data.market_data.total_volume?.usd,
        price_change_24h: response.data.market_data.price_change_percentage_24h,
        last_updated: response.data.last_updated,
        responseTime: Date.now() - startTime
      };

      console.log('[CoinGecko] SUCCESS - Market data fetched for', symbol, `(${Date.now() - startTime}ms)`);
      return result;
    }

    throw new AdapterError({
      adapter: 'CoinGecko',
      method: 'GET',
      url: BASE_URL,
      errorMessage: 'Invalid response from CoinGecko API Key',
      isAuthError: false
    });

  } catch (error: any) {
    logger.error({ error: error.message, symbol }, 'CoinGecko adapter error');

    return {
      provider: 'coingecko',
      success: false,
      symbol: symbol,
      error: error.message,
      responseTime: Date.now() - startTime
    };
  }
}