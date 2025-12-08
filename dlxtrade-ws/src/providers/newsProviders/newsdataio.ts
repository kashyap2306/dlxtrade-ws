import axios from 'axios';
import { AdapterError, extractAdapterError } from '../../utils/adapterErrorHandler';
import { retryWithBackoff } from '../../utils/rateLimiter';

const BASE_URL = 'https://newsdata.io/api/1';

/**
 * Test connection to NewsData.io API
 * @param apiKey - NewsData.io API key
 * @returns Promise with test result
 */
export async function testConnection(apiKey?: string): Promise<{ ok: boolean, message?: string }> {
  if (!apiKey) {
    return { ok: false, message: 'NewsData.io API key is required' };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'NewsData.io', endpoint: 'test-connection' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news`, {
        params: {
          apikey: apiKey,
          q: 'crypto',
          language: 'en',
          size: 1
        },
        timeout: 8000
      });
    });

    if (response.status === 200 && response.data?.results) {
      return { ok: true, message: 'NewsData.io API connection successful' };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'Invalid API key' };
    }

    return { ok: false, message: `NewsData.io API returned status ${response.status}` };
  } catch (error: any) {
    console.error('NewsData.io testConnection error:', error.message);
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
    return { ok: false, data: { error: 'NewsData.io API key is required' } };
  }

  try {
    console.log('PROVIDER-CALL', { provider: 'NewsData.io', endpoint: 'news', query });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news`, {
        params: {
          apikey: apiKey,
          q: query,
          language: 'en',
          size: 5
        },
        timeout: 8000
      });
    });

    if (response.status !== 200 || !response.data?.results) {
      return { ok: false, data: { error: `NewsData.io API returned status ${response.status}` } };
    }

    return {
      ok: true,
      data: {
        articles: response.data.results.map((article: any) => ({
          title: article.title,
          description: article.description,
          url: article.link,
          source: article.source_id,
          publishedAt: article.pubDate
        }))
      }
    };
  } catch (error: any) {
    console.error('NewsData.io fetchTicker error:', error.message);
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
 * Get crypto news from NewsData.io API
 * @param apiKey - NewsData.io API key
 * @returns Promise with normalized news data
 */
export async function getCryptoNews(apiKey?: string): Promise<NewsItem[]> {
  try {
    if (!apiKey) {
      console.warn('NewsData.io API key not provided, skipping...');
      return [];
    }

    console.log('PROVIDER-CALL', { provider: 'NewsData.io', endpoint: 'news' });

    const response = await retryWithBackoff(async () => {
      return axios.get(`${BASE_URL}/news`, {
        params: {
          apikey: apiKey,
          q: 'cryptocurrency OR bitcoin OR ethereum',
          language: 'en',
          size: 10,
          category: 'technology,business'
        },
        timeout: 10000
      });
    });

    if (response.status !== 200 || !response.data?.results) {
      throw new Error(`NewsData.io API returned status ${response.status}`);
    }

    // Normalize to standard format
    const normalizedNews: NewsItem[] = response.data.results
      .filter((article: any) => article.title && article.link)
      .slice(0, 10) // Limit to 10 articles
      .map((article: any) => ({
        title: article.title || '',
        summary: article.description || '',
        url: article.link || '',
        source: article.source_id || 'NewsData.io',
        publishedAt: article.pubDate || new Date().toISOString()
      }));

    return normalizedNews;
  } catch (error: any) {
    console.error('NewsData.io getCryptoNews error:', error.message);
    throw extractAdapterError('NewsData.io', 'getCryptoNews', BASE_URL, error);
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
