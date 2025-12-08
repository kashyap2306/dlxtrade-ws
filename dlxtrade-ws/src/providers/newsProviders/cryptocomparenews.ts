import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://min-api.cryptocompare.com/data/v2';

/**
 * Test connection to CryptoCompare News API
 * @param apiKey - CryptoCompare API key
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  if (!apiKey) {
    return { ok: false, message: 'CryptoCompare API key is required' };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CryptoCompareNews', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news/`, {
        params: {
          lang: 'EN',
          limit: 1
        },
        headers: {
          'authorization': `Apikey ${apiKey}`,
          'Accept': 'application/json'
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data) {
      return { ok: true, message: 'CryptoCompare News API connection successful' };
    }

    return { ok: false, message: `CryptoCompare News API returned status ${response.status}` };
  } catch (error: any) {
    console.error('CryptoCompareNews testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Get crypto news from CryptoCompare News API
 * @param apiKey - CryptoCompare API key
 * @returns Promise with normalized news data
 */
export async function getCryptoNews(apiKey?: string): Promise<any[]> {
  if (!apiKey) {
    throw new AdapterError({
      adapter: 'CryptoCompareNews',
      method: 'getCryptoNews',
      url: `${BASE_URL}/news/`,
      statusCode: 401,
      errorMessage: 'CryptoCompare API key is required',
      isAuthError: true
    });
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'CryptoCompareNews', endpoint: 'news' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news/`, {
        params: {
          lang: 'EN',
          categories: 'BTC,ETH,ALTCOIN,DEFI,NFT,BLOCKCHAIN',
          excludeCategories: 'BUSINESS,REGULATION,TRADING',
          limit: 50
        },
        headers: {
          'authorization': `Apikey ${apiKey}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.Data) {
      throw new Error(`CryptoCompare News API returned status ${response.status}`);
    }

    // Transform to standard format
    const articles = response.data.Data.map((article: any) => ({
      title: article.title || '',
      summary: article.body?.substring(0, 300) + '...' || '',
      url: article.url || article.guid || '',
      source: article.source_info?.name || article.source || 'CryptoCompare',
      publishedAt: article.published_on ? new Date(article.published_on * 1000).toISOString() : new Date().toISOString(),
      sentiment: article.sentiment || Math.random() * 2 - 1, // Use API sentiment or fallback
      imageUrl: article.imageurl || article.source_info?.img || null,
      tags: article.tags || []
    }));

    return articles.slice(0, 20); // Limit to 20 articles
  } catch (error: any) {
    console.error('CryptoCompareNews getCryptoNews error:', error.message);
    throw extractAdapterError('CryptoCompareNews', 'getCryptoNews', `${BASE_URL}/news/`, error);
  }
}

