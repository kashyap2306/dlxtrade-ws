import { AdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

const BASE_URL = 'https://newsdata.io/api/1/news';

// Simple in-memory cache for NewsData results
interface CacheEntry {
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

const newsDataCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 90 * 1000; // 90 seconds TTL for news (between 60-120s)

// NewsData sentiment calculation based on keywords
function calculateNewsSentiment(articles: any[]): number {
  if (!articles.length) return 0.5;

  let bullish = 0;
  let bearish = 0;

  articles.forEach(article => {
    const title = (article.title || '').toLowerCase();
    const description = (article.description || '').toLowerCase();

    const content = title + ' ' + description;

    // Bullish keywords
    if (content.includes('bull') || content.includes('rise') || content.includes('gain') ||
        content.includes('surge') || content.includes('rally') || content.includes('up')) {
      bullish++;
    }

    // Bearish keywords
    if (content.includes('bear') || content.includes('fall') || content.includes('drop') ||
        content.includes('crash') || content.includes('decline') || content.includes('down')) {
      bearish++;
    }
  });

  if (bullish + bearish === 0) return 0.5;

  // Calculate sentiment: 0.5 + (bullish - bearish) / total * 0.5
  const sentimentDiff = (bullish - bearish) / (bullish + bearish);
  return Math.max(0, Math.min(1, 0.5 + (sentimentDiff * 0.5)));
}

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

async function makeRequest(url: string, attempt?: number, apiKey?: string): Promise<any> {
  const headers: any = {
    'Accept': 'application/json',
    'User-Agent': 'DLXTrade/1.0'
  };

  if (apiKey) {
    headers['X-ACCESS-KEY'] = apiKey;
  }

  const response = await axios.get(url, {
    timeout: 10000,
    headers
  });

  if (response.status !== 200) {
    throw new AdapterError({
      adapter: 'NewsData',
      method: 'GET',
      url,
      errorMessage: `HTTP ${response.status}`,
      statusCode: response.status,
      isAuthError: response.status === 401 || response.status === 403
    });
  }

  return response;
}

async function attemptWithRetry(url: string, apiKey?: string): Promise<any> {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await makeRequest(url, attempt, apiKey);
    } catch (error: any) {
      attempt++;

      if (error.response?.status === 429 && attempt < maxRetries) {
        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delayMs = Math.pow(2, attempt - 1) * 500;
        console.log(`[NewsData] RETRY ${attempt} - Rate limited, waiting ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else if (error.response?.status === 429 && attempt >= maxRetries) {
        console.log('[NewsData] ALL RETRIES FAILED - Rate limited, using fallback');
        return null; // Signal to use fallback
      } else {
        // Non-rate-limit error, don't retry
        throw error;
      }
    }
  }

  // Should not reach here, but just in case
  return null;
}

export async function fetchNewsData(apiKey: string, symbol?: string): Promise<any> {
  const startTime = Date.now();

  console.log('[NewsData] START - Fetching news');

  try {
    // Check cache first
    const cacheKey = `newsdata_${symbol || 'general'}`;
    const cached = newsDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < cached.ttl) {
      console.log('[NewsData] CACHE HIT - Returning cached news');
      return cached.data;
    }

    if (!apiKey) {
      console.log('[NewsData] NO API KEY - Returning empty news');
      return {
        provider: 'newsdata',
        success: false,
        error: 'NewsData API key is required',
        articles: [],
        sentiment: 0.5,
        sentimentScore: 0.5,
        latency: Date.now() - startTime
      };
    }

    // Build NewsData query - search for crypto-related news
    let url = `${BASE_URL}?apikey=${apiKey}&category=business,technology&language=en`;

    if (symbol) {
      // Search for news related to specific cryptocurrency
      const searchTerms = symbol.replace('USDT', '').replace('BTC', 'bitcoin').replace('ETH', 'ethereum');
      url += `&q=${encodeURIComponent(searchTerms + ' cryptocurrency')}`;
    }

    const response = await attemptWithRetry(url);

    if (response === null) {
      // All retries failed due to rate limiting
      console.log('[NewsData] FALLBACK - Rate limited, returning empty news');
      return {
        provider: 'newsdata',
        success: true,
        articles: [],
        sentiment: 0.5,
        sentimentScore: 0.5,
        latency: Date.now() - startTime,
        message: "Rate-limited, using fallback empty news"
      };
    }

    const data = response.data;
    const articles = (data?.results || []).slice(0, 10);

    // Normalize the response to match expected format
    const normalizedArticles = articles.map((article: any) => ({
      title: article.title || 'Untitled',
      url: article.link || '',
      publishedAt: article.pubDate || new Date().toISOString(),
      summary: article.description || article.title || '',
      source: article.source_id || 'Unknown'
    }));

    const sentiment = calculateNewsSentiment(normalizedArticles);
    const latency = Date.now() - startTime;

    const result = {
      provider: 'newsdata',
      success: true,
      articles: normalizedArticles,
      sentiment,
      latency
    };

    // Cache the result
    newsDataCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
      ttl: CACHE_TTL_MS
    });

    console.log('[NewsData] SUCCESS - Cached result');

    return result;

  } catch (error: any) {
    console.log('[NewsData] FAILED');

    // For auth errors, still throw them
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new AdapterError({
        adapter: 'NewsData',
        method: 'GET',
        url: BASE_URL,
        errorMessage: 'Authentication failed - invalid NewsData API key',
        statusCode: error.response.status,
        isAuthError: true
      });
    }

    // For other errors (including final 429), return empty success to not break research
    console.log('[NewsData] FALLBACK - Error occurred, returning empty news');
    return {
      success: true,
      articles: [],
      sentiment: 0.5,
      latency: Date.now() - startTime,
      message: "Error occurred, using fallback empty news"
    };
  }
}
