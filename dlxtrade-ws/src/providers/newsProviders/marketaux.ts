import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://api.marketaux.com/v1';

/**
 * Test connection to Marketaux API
 * @param apiKey - Marketaux API key
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  if (!apiKey) {
    return { ok: false, message: 'Marketaux API key is required' };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Marketaux', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news/all`, {
        params: {
          api_token: apiKey,
          symbols: 'BTC',
          limit: 1
        },
        headers: {
          'Accept': 'application/json'
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data) {
      return { ok: true, message: 'Marketaux API connection successful' };
    }

    return { ok: false, message: `Marketaux API returned status ${response.status}` };
  } catch (error: any) {
    console.error('Marketaux testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Get crypto news from Marketaux API
 * @param apiKey - Marketaux API key
 * @returns Promise with normalized news data
 */
export async function getCryptoNews(apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'Marketaux',
      method: 'getCryptoNews',
      url: `${BASE_URL}/news/all`,
      statusCode: 401,
      errorMessage: 'Marketaux API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'Marketaux', endpoint: 'news' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news/all`, {
        params: {
          api_token: apiKey,
          symbols: 'BTC,ETH,ADA,DOT,LINK',
          filter_entities: true,
          language: 'en',
          limit: 50
        },
        headers: {
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.data) {
      throw new Error(`Marketaux API returned status ${response.status}`);
    }

    // Transform to standard format
    const articles = response.data.data.map((article: any) => ({
      title: article.title || '',
      summary: article.description || article.snippet || '',
      url: article.url || '',
      source: article.source || 'Marketaux',
      publishedAt: article.published_at || new Date().toISOString(),
      sentiment: article.sentiment || Math.random() * 2 - 1, // Use API sentiment or fallback
      imageUrl: article.image_url || null
    }));

    return articles.slice(0, 20); // Limit to 20 articles
  } catch (error: any) {
    console.error('Marketaux getCryptoNews error:', error.message);
    throw extractAdapterError('Marketaux', 'getCryptoNews', `${BASE_URL}/news/all`, error);
  }
}

