import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { apiUsageTracker } from './apiUsageTracker';

export interface LunarCrushData {
  socialScore?: number;
  socialVolume?: number;
  marketCapRank?: number;
  altRank?: number;
  sentiment?: number; // -1 to 1
  bullishSentiment?: number; // 0 to 1
}

export class LunarCrushAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.lunarcrush.com/v2';
  private httpClient: AxiosInstance;

  constructor(apiKey: string) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      logger.error('LunarCrush API key is missing or invalid');
      throw new Error('LunarCrush API key is required');
    }

    this.apiKey = apiKey.trim();
    logger.info({ apiKeyLength: this.apiKey.length, source: 'user_api_key' }, 'LunarCrush adapter initialized with user\'s API key');

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      params: {
        key: this.apiKey,
      },
    });
  }

  /**
   * Get sentiment data (alias for getCoinData for consistency)
   */
  async getSentiment(symbol: string, since?: number): Promise<LunarCrushData> {
    // LunarCrush getCoinData already includes sentiment, so we can use it
    // The 'since' parameter could be used for historical data if needed
    return this.getCoinData(symbol);
  }

  async getCoinData(symbol: string): Promise<LunarCrushData> {
    // Map symbol to LunarCrush format (e.g., BTCUSDT -> BTC)
    const coinSymbol = symbol.replace('USDT', '').replace('USD', '');

    // Add DNS retry logic (max 3 retries) for all requests
    let lastError: any = null;
    const maxRetries = 3;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      try {
        const response = await this.httpClient.get('/assets/coin', {
          params: {
            symbol: coinSymbol,
            data_points: 1,
          },
        });

        // Track API usage
        apiUsageTracker.increment('lunarcrush');

        const data = response.data?.data?.[0];
        if (!data) {
          return {};
        }

        return {
          socialScore: data.social_score || 0,
          socialVolume: data.social_volume || 0,
          marketCapRank: data.market_cap_rank || 0,
          altRank: data.alt_rank || 0,
          sentiment: data.sentiment || 0,
          bullishSentiment: data.bullish_sentiment || 0,
        };
      } catch (error: any) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.message || error.message;
        const errorCode = error.code || error.response?.data?.code;
        lastError = error;

        // Handle authentication errors immediately (no retry)
        if (status === 401 || status === 403) {
          logger.warn({ status, errorMessage, symbol }, 'LunarCrush API authentication failed');
          throw new Error(`LunarCrush API authentication failed: ${errorMessage}`);
        }

        // Handle ENOTFOUND and other network/DNS issues with retry
        if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          if (retryCount < maxRetries - 1) {
            logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'LunarCrush API unavailable - network/DNS issue, retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Progressive delay
            continue;
          } else {
            logger.error({ errorCode, errorMessage, symbol, retryCount }, 'LunarCrush API unavailable after all retries');
            // Convert to 400 error instead of 500
            const researchError = new Error('LunarCrush API unavailable, please try again.');
            (researchError as any).statusCode = 400;
            throw researchError;
          }
        }

        // For other errors, don't retry
        logger.warn({ error: errorMessage, status, symbol, errorCode }, 'LunarCrush API error');
        throw new Error(`LunarCrush API error: ${errorMessage}`);
      }
    }

    // If we get here, all retries failed
    const errorMessage = lastError?.response?.data?.message || lastError?.message || 'Unknown error';
    const researchError = new Error(`LunarCrush API error after retries: ${errorMessage}`);
    (researchError as any).statusCode = 400;
    throw researchError;
  }
}

