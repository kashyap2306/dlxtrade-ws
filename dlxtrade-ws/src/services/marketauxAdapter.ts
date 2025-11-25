import { AdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

const BASE_URL = 'https://api.marketaux.com/v1';

function analyzeSentiment(articles: any[]): 'bullish' | 'bearish' | 'neutral' {
  if (!articles.length) return 'neutral';

  let positive = 0;
  let negative = 0;

  articles.forEach(article => {
    const sentiment = article.sentiment?.toLowerCase();
    if (sentiment === 'positive' || sentiment === 'bullish') positive++;
    if (sentiment === 'negative' || sentiment === 'bearish') negative++;
  });

  if (positive > negative) return 'bullish';
  if (negative > positive) return 'bearish';
  return 'neutral';
}

export async function fetchMarketAuxData(apiKey: string, symbol: string): Promise<any> {
  try {
    const response = await axios.get(`${BASE_URL}/news/all`, {
      params: {
        symbols: symbol.replace('USDT', ''),
        api_token: apiKey,
        limit: 5,
        language: 'en'
      },
      timeout: 10000
    });

    if (response.status !== 200) {
      throw new AdapterError({
        adapter: 'MarketAux',
        method: 'GET',
        url: `${BASE_URL}/news/all?symbols=${symbol.replace('USDT', '')}`,
        errorMessage: `HTTP ${response.status}`,
        statusCode: response.status,
        isAuthError: response.status === 401 || response.status === 403
      });
    }

    const articles = response.data?.data || [];
    const sentiment = analyzeSentiment(articles);

    return {
      articleCount: articles.length,
      sentiment,
      topArticles: articles.slice(0, 3).map((article: any) => ({
        title: article.title,
        sentiment: article.sentiment || 'neutral'
      }))
    };
  } catch (error: any) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new AdapterError({
        adapter: 'MarketAux',
        method: 'GET',
        url: `${BASE_URL}/news/all?symbols=${symbol.replace('USDT', '')}`,
        errorMessage: 'Authentication failed - invalid API key',
        statusCode: error.response.status,
        isAuthError: true
      });
    }

    throw new AdapterError({
      adapter: 'MarketAux',
      method: 'GET',
      url: `${BASE_URL}/news/all?symbols=${symbol.replace('USDT', '')}`,
      errorMessage: error.message || 'Network error',
      statusCode: error.response?.status,
      isAuthError: false
    });
  }
}

export async function fetchMarketAuxNews(apiKey: string, symbol: string): Promise<any> {
  return fetchMarketAuxData(apiKey, symbol);
}

export async function fetchMarketAuxTrends(apiKey: string, symbol: string): Promise<any> {
  try {
    const newsData = await fetchMarketAuxData(apiKey, symbol);
    return {
      symbol,
      trend: newsData.sentiment,
      articleCount: newsData.articleCount,
      timeRange: 'recent'
    };
  } catch (error) {
    throw error;
  }
}