import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface LunarCrushData {
  // Galaxy Score
  galaxyScore?: number;
  socialScore?: number; // Alias for galaxyScore
  
  // AltRank
  altRank?: number;
  
  // Social Dominance
  socialDominance?: number;
  
  // Social Volume
  socialVolume?: number;
  
  // Predicted Sentiment
  predictedSentiment?: number;
  sentiment?: number; // -1 to 1
  
  // Volatility
  volatility?: number;
  
  // Community Buzz Metrics
  communityBuzz?: number;
  bullishSentiment?: number; // 0 to 1
  bearishSentiment?: number; // 0 to 1
  
  // Additional metrics
  marketCapRank?: number;
  priceChange24h?: number;
  volume24h?: number;
}

export class LunarCrushAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.lunarcrush.com/v2';
  private httpClient: AxiosInstance;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      params: {
        key: this.apiKey,
      },
    });
  }

  async getCoinData(symbol: string): Promise<LunarCrushData> {
    try {
      // Map symbol to LunarCrush format (e.g., BTCUSDT -> BTC)
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      
      const response = await this.httpClient.get('/assets/coin', {
        params: {
          symbol: coinSymbol,
          data_points: 1,
        },
      });
      
      const data = response.data?.data?.[0];
      if (!data) {
        return {};
      }
      
      return {
        // Galaxy Score
        galaxyScore: data.galaxy_score || data.social_score || 0,
        socialScore: data.galaxy_score || data.social_score || 0,
        
        // AltRank
        altRank: data.alt_rank || 0,
        
        // Social Dominance
        socialDominance: data.social_dominance || 0,
        
        // Social Volume
        socialVolume: data.social_volume || 0,
        
        // Predicted Sentiment
        predictedSentiment: data.predicted_sentiment || data.sentiment || 0,
        sentiment: data.sentiment || 0,
        
        // Volatility
        volatility: data.volatility || 0,
        
        // Community Buzz Metrics
        communityBuzz: data.community_buzz || 0,
        bullishSentiment: data.bullish_sentiment || 0,
        bearishSentiment: data.bearish_sentiment || 0,
        
        // Additional metrics
        marketCapRank: data.market_cap_rank || 0,
        priceChange24h: data.price_change_24h || 0,
        volume24h: data.volume_24h || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'LunarCrush API error (non-critical)');
      // Return empty data on error - don't block research
      return {};
    }
  }

  // Get Galaxy Score specifically
  async getGalaxyScore(symbol: string): Promise<LunarCrushData> {
    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get('/assets/coin', {
        params: {
          symbol: coinSymbol,
          data_points: 1,
        },
      });
      
      const data = response.data?.data?.[0];
      return {
        galaxyScore: data?.galaxy_score || data?.social_score || 0,
        socialScore: data?.galaxy_score || data?.social_score || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'LunarCrush galaxy score error');
      return {};
    }
  }

  // Get AltRank specifically
  async getAltRank(symbol: string): Promise<LunarCrushData> {
    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get('/assets/coin', {
        params: {
          symbol: coinSymbol,
          data_points: 1,
        },
      });
      
      const data = response.data?.data?.[0];
      return {
        altRank: data?.alt_rank || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'LunarCrush altRank error');
      return {};
    }
  }

  // Get Social Metrics
  async getSocialMetrics(symbol: string): Promise<LunarCrushData> {
    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get('/assets/coin', {
        params: {
          symbol: coinSymbol,
          data_points: 1,
        },
      });
      
      const data = response.data?.data?.[0];
      return {
        socialDominance: data?.social_dominance || 0,
        socialVolume: data?.social_volume || 0,
        communityBuzz: data?.community_buzz || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'LunarCrush social metrics error');
      return {};
    }
  }

  // Get Sentiment Metrics
  async getSentimentMetrics(symbol: string): Promise<LunarCrushData> {
    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get('/assets/coin', {
        params: {
          symbol: coinSymbol,
          data_points: 1,
        },
      });
      
      const data = response.data?.data?.[0];
      return {
        predictedSentiment: data?.predicted_sentiment || data?.sentiment || 0,
        sentiment: data?.sentiment || 0,
        bullishSentiment: data?.bullish_sentiment || 0,
        bearishSentiment: data?.bearish_sentiment || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'LunarCrush sentiment metrics error');
      return {};
    }
  }

  // Get Volatility
  async getVolatility(symbol: string): Promise<LunarCrushData> {
    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get('/assets/coin', {
        params: {
          symbol: coinSymbol,
          data_points: 1,
        },
      });
      
      const data = response.data?.data?.[0];
      return {
        volatility: data?.volatility || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'LunarCrush volatility error');
      return {};
    }
  }

  // Comprehensive method to get all LunarCrush data
  async getAllData(symbol: string): Promise<LunarCrushData> {
    return this.getCoinData(symbol);
  }
}

