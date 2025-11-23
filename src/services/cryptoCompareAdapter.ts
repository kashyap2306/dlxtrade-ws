import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { apiUsageTracker } from './apiUsageTracker';

export interface CryptoCompareData {
  whaleScore: number;
  reserveChange: number;
  minerOutflow: number;
  fundingRate: number;
  liquidations: number;
}

export class CryptoCompareAdapter {
  private apiKey: string;
  private baseUrl = 'https://min-api.cryptocompare.com';
  private httpClient: AxiosInstance;

  constructor(apiKey: string) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '') {
      logger.error('CryptoCompare API key is missing or invalid');
      throw new Error('CryptoCompare API key is required');
    }

    this.apiKey = apiKey.trim();
    logger.info({ apiKeyLength: this.apiKey.length, source: 'user_api_key' }, 'CryptoCompare adapter initialized with user\'s API key');

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      params: {
        api_key: this.apiKey,
      },
    });
  }

  /**
   * Get whale activity data (using blockchain histo/day endpoint)
   */
  async getWhaleActivity(symbol: string): Promise<number> {
    // Map symbol to CryptoCompare format (e.g., BTCUSDT -> BTC)
    const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');

    // Add DNS retry logic (max 3 retries) for all requests
    let lastError: any = null;
    const maxRetries = 3;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      try {
        const response = await this.httpClient.get('/data/blockchain/histo/day', {
          params: {
            fsym: baseSymbol,
            tsym: 'USD',
            limit: 1,
            api_key: this.apiKey,
          },
        });

        // Track API usage
        apiUsageTracker.increment('cryptocompare');

        // Extract whale activity score from blockchain data
        const data = response.data?.Data?.[0];
        if (!data) return 0;

        // Use transaction volume as whale activity proxy
        const transactionVolume = data.transaction_volume || 0;
        const activeAddresses = data.active_addresses || 0;

        // Normalize to 0-100 scale
        const whaleScore = Math.min(100, Math.max(0, (transactionVolume / 1000000) + (activeAddresses / 1000)));

        return whaleScore;
      } catch (error: any) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.Message || error.message;
        const errorCode = error.code || error.response?.data?.code;
        lastError = error;

        // Handle authentication errors immediately (no retry)
        if (status === 401 || status === 403) {
          logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
          throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
        }

        // Handle ENOTFOUND and other network/DNS issues with retry
        if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          if (retryCount < maxRetries - 1) {
            logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Progressive delay
            continue;
          } else {
            logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
            // Convert to 400 error instead of 500
            const researchError = new Error('CryptoCompare API unavailable, please try again.');
            (researchError as any).statusCode = 400;
            throw researchError;
          }
        }

        // For other errors, don't retry
        logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare API error');
        throw new Error(`CryptoCompare API error: ${errorMessage}`);
      }
    }

    // If we get here, all retries failed
    const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
    const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
    (researchError as any).statusCode = 400;
    throw researchError;
  }

  /**
   * Get exchange reserves data
   */
  async getExchangeReserves(symbol: string): Promise<number> {
    const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');

    let lastError: any = null;
    const maxRetries = 3;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      try {
        const response = await this.httpClient.get('/data/exchange/top/volumes', {
          params: {
            fsym: baseSymbol,
            tsym: 'USDT',
            limit: 10,
            api_key: this.apiKey,
          },
        });

        apiUsageTracker.increment('cryptocompare');

        // Extract reserve change from top exchange volumes
        const exchanges = response.data?.Data || [];
        if (exchanges.length === 0) return 0;

        // Calculate average volume change as reserve proxy
        let totalVolumeChange = 0;
        let count = 0;

        exchanges.forEach((exchange: any) => {
          if (exchange.VOLUME24HOURTO && exchange.VOLUME24HOURTO > 0) {
            const volumeChange = exchange.VOLUME24HOURTO;
            totalVolumeChange += volumeChange;
            count++;
          }
        });

        const avgVolumeChange = count > 0 ? totalVolumeChange / count : 0;

        // Normalize to percentage change
        const reserveChange = Math.max(-50, Math.min(50, (avgVolumeChange / 1000000) - 1));

        return reserveChange;
      } catch (error: any) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.Message || error.message;
        const errorCode = error.code || error.response?.data?.code;
        lastError = error;

        if (status === 401 || status === 403) {
          logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
          throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
        }

        if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          if (retryCount < maxRetries - 1) {
            logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            continue;
          } else {
            logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
            const researchError = new Error('CryptoCompare API unavailable, please try again.');
            (researchError as any).statusCode = 400;
            throw researchError;
          }
        }

        logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare reserves API error');
        throw new Error(`CryptoCompare API error: ${errorMessage}`);
      }
    }

    const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
    const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
    (researchError as any).statusCode = 400;
    throw researchError;
  }

  /**
   * Get on-chain metrics (mining data)
   */
  async getOnChainMetrics(symbol: string): Promise<number> {
    const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');

    let lastError: any = null;
    const maxRetries = 3;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      try {
        const response = await this.httpClient.get('/data/blockchain/mining', {
          params: {
            fsym: baseSymbol,
            tsym: 'USD',
            api_key: this.apiKey,
          },
        });

        apiUsageTracker.increment('cryptocompare');

        // Extract miner outflow from mining data
        const data = response.data?.Data;
        if (!data) return 0;

        // Use mining difficulty and hashrate as miner activity proxy
        const difficulty = data.difficulty || 0;
        const hashrate = data.hashrate || 0;

        // Normalize to 0-100 scale
        const minerOutflow = Math.min(100, Math.max(0, (difficulty / 1000000000000) + (hashrate / 1000000000000000)));

        return minerOutflow;
      } catch (error: any) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.Message || error.message;
        const errorCode = error.code || error.response?.data?.code;
        lastError = error;

        if (status === 401 || status === 403) {
          logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
          throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
        }

        if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          if (retryCount < maxRetries - 1) {
            logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            continue;
          } else {
            logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
            const researchError = new Error('CryptoCompare API unavailable, please try again.');
            (researchError as any).statusCode = 400;
            throw researchError;
          }
        }

        logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare on-chain API error');
        throw new Error(`CryptoCompare API error: ${errorMessage}`);
      }
    }

    const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
    const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
    (researchError as any).statusCode = 400;
    throw researchError;
  }

  /**
   * Get funding rate data
   */
  async getFundingRate(symbol: string): Promise<number> {
    const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');

    let lastError: any = null;
    const maxRetries = 3;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      try {
        const response = await this.httpClient.get('/data/futures', {
          params: {
            fsym: baseSymbol,
            tsym: 'USDT',
            api_key: this.apiKey,
          },
        });

        apiUsageTracker.increment('cryptocompare');

        // Extract funding rate from futures data
        const data = response.data?.Data;
        if (!data) return 0;

        // Look for funding rate in the response
        let fundingRate = 0;
        if (Array.isArray(data)) {
          const btcData = data.find((item: any) => item.symbol?.includes(baseSymbol));
          if (btcData?.funding_rate) {
            fundingRate = parseFloat(btcData.funding_rate) || 0;
          }
        } else if (data.funding_rate) {
          fundingRate = parseFloat(data.funding_rate) || 0;
        }

        // Convert to percentage and normalize
        return fundingRate * 100;
      } catch (error: any) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.Message || error.message;
        const errorCode = error.code || error.response?.data?.code;
        lastError = error;

        if (status === 401 || status === 403) {
          logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
          throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
        }

        if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          if (retryCount < maxRetries - 1) {
            logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            continue;
          } else {
            logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
            const researchError = new Error('CryptoCompare API unavailable, please try again.');
            (researchError as any).statusCode = 400;
            throw researchError;
          }
        }

        logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare funding rate API error');
        throw new Error(`CryptoCompare API error: ${errorMessage}`);
      }
    }

    const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
    const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
    (researchError as any).statusCode = 400;
    throw researchError;
  }

  /**
   * Get liquidation data
   */
  async getLiquidationData(symbol: string): Promise<number> {
    const baseSymbol = symbol.replace(/USDT$/i, '').replace(/USD$/i, '');

    let lastError: any = null;
    const maxRetries = 3;

    for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
      try {
        const response = await this.httpClient.get('/data/v2/liquidation', {
          params: {
            fsym: baseSymbol,
            tsym: 'USDT',
            limit: 1,
            api_key: this.apiKey,
          },
        });

        apiUsageTracker.increment('cryptocompare');

        // Extract liquidation data
        const data = response.data?.Data || [];
        if (data.length === 0) return 0;

        const latestData = data[0];
        const totalLiquidations = latestData.total || 0;

        // Normalize to 0-100 scale based on liquidation volume
        const liquidations = Math.min(100, Math.max(0, totalLiquidations / 1000000));

        return liquidations;
      } catch (error: any) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.Message || error.message;
        const errorCode = error.code || error.response?.data?.code;
        lastError = error;

        if (status === 401 || status === 403) {
          logger.warn({ status, errorMessage, symbol }, 'CryptoCompare API authentication failed');
          throw new Error(`CryptoCompare API authentication failed: ${errorMessage}`);
        }

        if (errorCode === 'ENOTFOUND' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
          if (retryCount < maxRetries - 1) {
            logger.warn({ errorCode, errorMessage, symbol, retryCount: retryCount + 1, maxRetries }, 'CryptoCompare API unavailable - network/DNS issue, retrying...');
            await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
            continue;
          } else {
            logger.error({ errorCode, errorMessage, symbol, retryCount }, 'CryptoCompare API unavailable after all retries');
            const researchError = new Error('CryptoCompare API unavailable, please try again.');
            (researchError as any).statusCode = 400;
            throw researchError;
          }
        }

        logger.warn({ error: errorMessage, status, symbol, errorCode }, 'CryptoCompare liquidations API error');
        throw new Error(`CryptoCompare API error: ${errorMessage}`);
      }
    }

    const errorMessage = lastError?.response?.data?.Message || lastError?.message || 'Unknown error';
    const researchError = new Error(`CryptoCompare API error after retries: ${errorMessage}`);
    (researchError as any).statusCode = 400;
    throw researchError;
  }

  /**
   * Get all metrics combined
   */
  async getAllMetrics(symbol: string): Promise<CryptoCompareData> {
    try {
      const [whaleScore, reserveChange, minerOutflow, fundingRate, liquidations] = await Promise.all([
        this.getWhaleActivity(symbol),
        this.getExchangeReserves(symbol),
        this.getOnChainMetrics(symbol),
        this.getFundingRate(symbol),
        this.getLiquidationData(symbol),
      ]);

      return {
        whaleScore,
        reserveChange,
        minerOutflow,
        fundingRate,
        liquidations,
      };
    } catch (error: any) {
      // Return default values if any metric fails
      logger.warn({ error: error.message, symbol }, 'Some CryptoCompare metrics failed, using defaults');
      return {
        whaleScore: 0,
        reserveChange: 0,
        minerOutflow: 0,
        fundingRate: 0,
        liquidations: 0,
      };
    }
  }
}
