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

async function makeRequest(url: string, attempt: number): Promise<any> {
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

  return response;
}

async function attemptWithRetry(url: string): Promise<any> {
  // Try 1
  try {
    return await makeRequest(url, 1);
  } catch (error: any) {
    if (error.statusCode === 429 && error.statusCode !== 401 && error.statusCode !== 403) {
      console.log('[CryptoPanic] RETRY 1 - Rate limited, waiting 500ms');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Try 2
      try {
        return await makeRequest(url, 2);
      } catch (error2: any) {
        if (error2.statusCode === 429 && error2.statusCode !== 401 && error2.statusCode !== 403) {
          console.log('[CryptoPanic] RETRY 2 - Rate limited again, waiting 1000ms');
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Try 3
          try {
            return await makeRequest(url, 3);
          } catch (error3: any) {
            if (error3.statusCode === 429 && error3.statusCode !== 401 && error3.statusCode !== 403) {
              console.log('[CryptoPanic] RETRY 3 FAILED - Rate limited, using fallback');
              return null; // Signal to use fallback
            }
            throw error3;
          }
        }
        throw error2;
      }
    }
    throw error;
  }
}

export async function fetchCryptoPanicNews(apiKey?: string): Promise<any> {
  const startTime = Date.now();

  console.log('[CryptoPanic] START - Fetching news');

  try {
    // Determine which API key to use
    let effectiveApiKey = apiKey;
    if (!effectiveApiKey) {
      // Fall back to system-level default API key
      effectiveApiKey = process.env.CRYPTOPANIC_DEFAULT_KEY;
    }

    let url = `${BASE_URL}?public=true&kind=news`;
    if (effectiveApiKey) {
      url = `${BASE_URL}?auth_token=${effectiveApiKey}&kind=news`;
    }

    const response = await attemptWithRetry(url);

    if (response === null) {
      // All retries failed due to rate limiting
      console.log('[CryptoPanic] FALLBACK - Rate limited, returning empty news');
      return {
        success: true,
        articles: [],
        sentiment: 0.5,
        latency: Date.now() - startTime,
        message: "Rate-limited, using fallback empty news"
      };
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

    // For auth errors, still throw them
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

    // For other errors (including final 429), return empty success to not break research
    console.log('[CryptoPanic] FALLBACK - Error occurred, returning empty news');
    return {
      success: true,
      articles: [],
      sentiment: 0.5,
      latency: Date.now() - startTime,
      message: "Error occurred, using fallback empty news"
    };
  }
}
