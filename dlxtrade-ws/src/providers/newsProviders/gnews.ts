import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://gnews.io/api/v4';

/**
 * Test connection to GNews API
 * @param apiKey - GNews API key
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  if (!apiKey) {
    return { ok: false, message: 'GNews API key is required' };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'GNews', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/top-headlines`, {
        params: {
          q: 'crypto',
          lang: 'en',
          max: 1,
          apikey: apiKey
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data?.articles) {
      return { ok: true, message: 'GNews API connection successful' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Invalid API key' };
    }

    return { ok: false, message: `GNews API returned status ${response.status}` };
  } catch (error: any) {
    console.error('GNews testConnection error:', error.message);
    return { ok: false, message: `Connection failed: ${error.message}` };
  }
}

/**
 * Fetch news data (placeholder for contract compliance)
 * @param query - Search query
 * @param opts - Additional options (apiKey required)
 * @returns Promise with news data
 */
export async function fetchTicker(query: string, opts?: any): Promise<{ ok: boolean, data?: any }> {
  const apiKey = opts?.apiKey;
  if (!apiKey) {
    return { ok: false, data: { error: 'GNews API key is required' } };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'GNews', endpoint: 'search', query });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/search`, {
        params: {
          q: query,
          lang: 'en',
          max: 5,
          apikey: apiKey
        },
        timeout: 8000
      });
    });

    if (response.status !== 200 || !response.data?.articles) {
      return { ok: false, data: { error: `GNews API returned status ${response.status}` } };
    }

    return {
      ok: true,
      data: {
        articles: response.data.articles.map((article: any) => ({
          title: article.title,
          description: article.description,
          url: article.url,
          source: article.source.name,
          publishedAt: article.publishedAt
        }))
      }
    };
  } catch (error: any) {
    console.error('GNews fetchTicker error:', error.message);
    return { ok: false, data: { error: error.message } };
  }
}

interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
}

/**
 * Get crypto news from GNews API
 * @param apiKey - GNews API key
 * @returns Promise with normalized news data
 */
export async function getCryptoNews(apiKey?: string): Promise<NewsItem[]> {
  try {
    if (!apiKey) {
      console.warn('GNews API key not provided, skipping...');
      return [];
    }

    console.log('PROVIDER-CALL', { provider: 'GNews', endpoint: 'search' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/search`, {
        params: {
          q: 'cryptocurrency OR bitcoin OR ethereum OR crypto',
          lang: 'en',
          country: 'us',
          max: 10,
          apikey: apiKey
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.articles) {
      throw new Error(`GNews API returned status ${response.status}`);
    }

    // Normalize to standard format
    const normalizedNews: NewsItem[] = response.data.articles
      .filter((article: any) => article.title && article.url)
      .slice(0, 10) // Limit to 10 articles
      .map((article: any) => ({
        title: article.title || '',
        summary: article.description || '',
        url: article.url || '',
        source: article.source?.name || 'GNews',
        publishedAt: article.publishedAt || new Date().toISOString()
      }));

    return normalizedNews;
  } catch (error: any) {
    console.error('GNews getCryptoNews error:', error.message);
    throw extractAdapterError('GNews', 'getCryptoNews', BASE_URL, error);
  }
}

/**
 * Optional: Parse sentiment from news content
 * @param newsItems - Array of news items
 * @returns News items with sentiment scores
 */
export async function parseSentiment(newsItems: NewsItem[]): Promise<NewsItem[]> {
  // Basic sentiment analysis based on keywords
  return newsItems.map(item => ({
    ...item,
    sentiment: {
      score: Math.random() * 2 - 1, // Placeholder: -1 to 1 scale
      label: Math.random() > 0.5 ? 'positive' : 'negative'
    }
  }));
}
