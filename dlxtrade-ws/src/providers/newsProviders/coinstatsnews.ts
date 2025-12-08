import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.coinstats.app/public/v1';

/**
 * Test connection to CoinStats News API
 * @param apiKey - CoinStats API key
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  if (!apiKey) {
    return { ok: false, message: 'CoinStats API key is required' };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStatsNews', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news`, {
        params: {
          skip: 0,
          limit: 1
        },
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data) {
      return { ok: true, message: 'CoinStats News API connection successful' };
    }

    return { ok: false, message: `CoinStats News API returned status ${response.status}` };
  } catch (error: any) {
    console.error('CoinStatsNews testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Get crypto news from CoinStats News API
 * @param apiKey - CoinStats API key
 * @returns Promise with normalized news data
 */
export async function getCryptoNews(apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CoinStatsNews',
      method: 'getCryptoNews',
      url: `${BASE_URL}/news`,
      statusCode: 401,
      errorMessage: 'CoinStats API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CoinStatsNews', endpoint: 'news' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news`, {
        params: {
          skip: 0,
          limit: 50
        },
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !Array.isArray(response.data)) {
      throw new Error(`CoinStats News API returned status ${response.status}`);
    }

    // Transform to standard format
    const articles = response.data
      .filter((article: any) => {
        // Filter for crypto-related news
        const title = article.title || '';
        const description = article.description || '';
        return /bitcoin|ethereum|crypto|blockchain|nft|defi/i.test(title + description);
      })
      .map((article: any) => ({
        title: article.title || '',
        summary: article.description || '',
        url: article.link || '',
        source: article.source || 'CoinStats',
        publishedAt: article.feedDate || new Date().toISOString(),
        sentiment: Math.random() * 2 - 1, // Placeholder sentiment
        imageUrl: article.imgURL || null
      }));

    return articles.slice(0, 20); // Limit to 20 articles
  } catch (error: any) {
    console.error('CoinStatsNews getCryptoNews error:', error.message);
    throw extractAdapterError('CoinStatsNews', 'getCryptoNews', `${BASE_URL}/news`, error);
  }
}

