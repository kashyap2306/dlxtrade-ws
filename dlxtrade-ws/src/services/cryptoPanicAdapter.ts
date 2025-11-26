import { AdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

const BASE_URL = 'https://cryptopanic.com/api/v1/posts/';

function calculateSentiment(articles: any[]): number {
  if (!articles.length) return 0.5;

  let bullish = 0;
  let bearish = 0;

  articles.forEach(article => {
    const tags = article.tags || [];
    tags.forEach((tag: string) => {
      const tagLower = tag.toLowerCase();
      if (tagLower.includes('bullish') || tagLower.includes('positive') || tagLower.includes('bull')) {
        bullish++;
      } else if (tagLower.includes('bearish') || tagLower.includes('negative') || tagLower.includes('bear')) {
        bearish++;
      }
    });
  });

  if (bullish + bearish === 0) return 0.5;

  // Calculate sentiment: 0.5 + (bullish - bearish) / total * 0.5
  const sentimentDiff = (bullish - bearish) / (bullish + bearish);
  return Math.max(0, Math.min(1, 0.5 + (sentimentDiff * 0.5)));
}

export async function fetchCryptoPanicNews(apiKey?: string): Promise<any> {
  const startTime = Date.now();

  console.log('[CryptoPanic] START - Fetching news');

  try {
    let url = `${BASE_URL}?public=true&kind=news`;

    if (apiKey) {
      url = `${BASE_URL}?auth_token=${apiKey}&kind=news`;
    }

    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DLXTrade/1.0'
      }
    });

    if (response.status !== 200) {
      throw new AdapterError({
        adapter: 'CryptoPanic',
        method: 'GET',
        url,
        errorMessage: `HTTP ${response.status}`,
        statusCode: response.status,
        isAuthError: response.status === 401 || response.status === 403
      });
    }

    const data = response.data;
    const posts = data?.results || [];

    // Normalize the response
    const articles = posts.slice(0, 10).map((post: any) => ({
      title: post.title,
      url: post.url,
      source: post.source?.title || post.domain || 'Unknown',
      published_at: post.published_at,
      tags: post.tags || []
    }));

    const sentiment = calculateSentiment(articles);
    const latency = Date.now() - startTime;

    console.log('[CryptoPanic] SUCCESS');

    return {
      success: true,
      articles,
      sentiment,
      latency
    };

  } catch (error: any) {
    console.log('[CryptoPanic] FAILED');

    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new AdapterError({
        adapter: 'CryptoPanic',
        method: 'GET',
        url: BASE_URL,
        errorMessage: 'Authentication failed - invalid API key',
        statusCode: error.response.status,
        isAuthError: true
      });
    }

    throw new AdapterError({
      adapter: 'CryptoPanic',
      method: 'GET',
      url: BASE_URL,
      errorMessage: error.message || 'Network error',
      statusCode: error.response?.status,
      isAuthError: false
    });
  }
}
