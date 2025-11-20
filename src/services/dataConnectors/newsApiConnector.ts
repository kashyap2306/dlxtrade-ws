/**
 * News API Connector
 * Fetches crypto news headlines and computes sentiment
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { apiUsageTracker } from '../apiUsageTracker';

export interface NewsData {
  headlines: Array<{
    title: string;
    description: string;
    url: string;
    publishedAt: string;
    source: string;
  }>;
  sentiment: number; // -1 to 1
  sentimentScore: number; // 0 to 100
  mentionCount: number;
  timestamp?: number;
}

export class NewsApiConnector {
  private baseUrl = 'https://newsapi.org/v2';
  private httpClient: AxiosInstance;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      params: this.apiKey ? {
        apiKey: this.apiKey,
      } : {},
    });
  }

  /**
   * Simple sentiment analysis (keyword-based)
   */
  private analyzeSentiment(text: string): number {
    const lowerText = text.toLowerCase();
    
    // Positive keywords
    const positiveKeywords = ['bullish', 'surge', 'rally', 'gain', 'up', 'rise', 'breakthrough', 'pump', 'moon'];
    // Negative keywords
    const negativeKeywords = ['bearish', 'crash', 'drop', 'fall', 'down', 'decline', 'dump', 'crash', 'bear'];
    
    let positiveCount = 0;
    let negativeCount = 0;
    
    positiveKeywords.forEach(keyword => {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      positiveCount += matches;
    });
    
    negativeKeywords.forEach(keyword => {
      const matches = (lowerText.match(new RegExp(keyword, 'g')) || []).length;
      negativeCount += matches;
    });
    
    const total = positiveCount + negativeCount;
    if (total === 0) return 0;
    
    // Return sentiment from -1 to 1
    return (positiveCount - negativeCount) / total;
  }

  /**
   * Get crypto news for a symbol
   */
  async getCryptoNews(symbol: string, limit: number = 10): Promise<NewsData> {
    try {
      const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
      const query = `${baseSymbol} OR bitcoin OR cryptocurrency OR crypto`;
      
      const response = await this.httpClient.get('/everything', {
        params: {
          q: query,
          sortBy: 'publishedAt',
          language: 'en',
          pageSize: limit,
        },
      });

      apiUsageTracker.increment('newsapi');

      const articles = response.data?.articles || [];
      
      const headlines = articles.map((article: any) => ({
        title: article.title || '',
        description: article.description || '',
        url: article.url || '',
        publishedAt: article.publishedAt || '',
        source: article.source?.name || 'Unknown',
      }));

      // Compute sentiment from headlines
      const allText = headlines.map(h => `${h.title} ${h.description}`).join(' ');
      const sentiment = this.analyzeSentiment(allText);
      const sentimentScore = ((sentiment + 1) / 2) * 100; // Convert to 0-100 scale

      return {
        headlines,
        sentiment,
        sentimentScore,
        mentionCount: headlines.length,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.warn({ error: error.message, symbol }, 'News API fetch failed');
      return {
        headlines: [],
        sentiment: 0,
        sentimentScore: 50,
        mentionCount: 0,
        timestamp: Date.now(),
      };
    }
  }
}

