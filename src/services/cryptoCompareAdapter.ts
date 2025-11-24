import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { apiUsageTracker } from './apiUsageTracker';

export interface CryptoCompareData {
  ohlc?: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  indicators?: {
    rsi?: number;
    macd?: {
      value: number;
      signal: number;
      histogram: number;
    };
    ema12?: number;
    ema26?: number;
    sma20?: number;
  };
  volume?: {
    volume24h?: number;
    volumeChange24h?: number;
  };
  market?: {
    marketCap?: number;
    priceChange24h?: number;
    priceChangePercent24h?: number;
  };
}

export interface MTFIndicators {
  timeframe: "5m" | "15m" | "1h";
  rsi: number | null;
  macd: { value: number; signal: number; histogram: number } | null;
  ema12: number | null;
  ema26: number | null;
  sma20: number | null;
}

export interface MTFConfluenceResult {
  score: number;
  maxScore: number;
  label: string;
  details: {
    "5m": string;
    "15m": string;
    "1h": string;
  };
}

export class CryptoCompareAdapter {
  private apiKey: string | null;
  private baseUrl = 'https://min-api.cryptocompare.com';
  private httpClient: AxiosInstance | null;

  constructor(apiKey: string | null) {
    this.apiKey = apiKey;

    if (apiKey != null && typeof apiKey === 'string' && apiKey.trim() !== '') {
      this.apiKey = apiKey.trim();
      logger.info({ apiKeyLength: this.apiKey.length, source: 'user_api_key' }, 'CryptoCompare adapter initialized with API key');

        this.httpClient = axios.create({
          baseURL: this.baseUrl,
          timeout: 10000,
          params: {
            api_key: this.apiKey,
        },
      });
    } else {
      logger.warn('CryptoCompare adapter initialized without API key - will return neutral defaults');
      this.httpClient = null;
    }
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
   * Get OHLC data and calculate indicators
   */
  async getAllMetrics(symbol: string): Promise<CryptoCompareData> {
    // Return neutral defaults if no API key
    if (!this.apiKey || !this.httpClient) {
      logger.debug({ symbol }, 'CryptoCompare returning neutral defaults (no API key)');
      return {
        ohlc: [],
        indicators: {
          rsi: 50, // Neutral RSI
          macd: { value: 0, signal: 0, histogram: 0 }, // Neutral MACD
          ema12: null,
          ema26: null,
          sma20: null,
        },
        market: {},
      };
    }

    try {
      // Get OHLC data for the last 100 periods (5m intervals = ~8 hours)
      const ohlc = await this.getOHLC(symbol, '5m', 100);

      // Calculate indicators
      const indicators = this.calculateIndicators(ohlc);

      // Get market data
      const market = await this.getMarketData(symbol);

      return {
        ohlc,
        indicators,
        market,
      };
    } catch (error: any) {
      // Since we have an API key, we should not fall back to empty data - throw error instead
      logger.warn({ error: error.message, symbol }, 'CryptoCompare data fetch failed');
      throw new Error(`CryptoCompare data fetch failed: ${error.message}`);
    }
  }

  /**
   * Get OHLC data from CryptoCompare for specific timeframes
   */
  async getOHLC(symbol: string, timeframe: "5m" | "15m" | "1h", limit: number = 200): Promise<Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>> {
    // Return fallback OHLC data if no API key
    if (!this.apiKey || !this.httpClient) {
      logger.debug({ symbol, timeframe }, 'CryptoCompare OHLC returning fallback data (no API key)');
      return this.getFallbackOHLC(symbol, timeframe, limit);
    }

    try {
      // Map timeframe to CryptoCompare aggregate values
      const aggregateMap: Record<typeof timeframe, number> = {
        '5m': 5,
        '15m': 15,
        '1h': 60,
      };

      const response = await this.httpClient.get('/data/histominute', {
        params: {
          fsym: symbol.replace('USDT', '').replace('USD', ''),
          tsym: 'USD',
          limit,
          aggregate: aggregateMap[timeframe],
        },
      });

      apiUsageTracker.increment('cryptocompare');

      // Try multiple possible data paths
      let raw = response.data?.Data?.Data?.Candles || response.data?.Data?.Data || response.data?.Data || [];
      if (!Array.isArray(raw)) {
        logger.warn({ symbol, timeframe }, 'CryptoCompare OHLC data not in expected array format, using fallback');
        return this.getFallbackOHLC(symbol, timeframe, limit);
      }

      const result = raw.map((item: any) => ({
        time: item.time,
        open: parseFloat(item.open) || 0,
        high: parseFloat(item.high) || 0,
        low: parseFloat(item.low) || 0,
        close: parseFloat(item.close) || 0,
        volume: parseFloat(item.volumefrom) || 0,
      }));

      logger.debug({ symbol, timeframe, count: result.length }, 'CryptoCompare OHLC data parsed successfully');
      return result;

    } catch (error: any) {
      logger.warn({ symbol, timeframe, error: error.message }, 'Failed to get OHLC data from CryptoCompare');
      // Since we have an API key, we should not fall back to synthetic data - throw error instead
      throw new Error(`CryptoCompare OHLC data fetch failed: ${error.message}`);
    }
  }

  private getFallbackOHLC(symbol: string, timeframe: "5m" | "15m" | "1h", limit: number): Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> {
    // Generate synthetic OHLC data for fallback
    const now = Date.now();
    const intervalMs = timeframe === '5m' ? 5 * 60 * 1000 :
                      timeframe === '15m' ? 15 * 60 * 1000 : 60 * 60 * 1000;

    const fallback = [];
    for (let i = 0; i < Math.min(limit, 50); i++) {
      const time = now - (i * intervalMs);
      const basePrice = 50000; // Neutral BTC price
      const variance = basePrice * 0.01; // 1% variance

      const open = basePrice + (Math.random() - 0.5) * variance;
      const close = basePrice + (Math.random() - 0.5) * variance;
      const high = Math.max(open, close) + Math.random() * variance * 0.5;
      const low = Math.min(open, close) - Math.random() * variance * 0.5;

      fallback.push({
        time: Math.floor(time / 1000),
        open,
        high,
        low,
        close,
        volume: Math.random() * 1000,
      });
    }

    logger.debug({ symbol, timeframe, count: fallback.length }, 'Generated fallback OHLC data');
    return fallback.reverse(); // Return in chronological order
  }

  /**
   * Get MTF indicators for a specific timeframe
   */
  async getMTFIndicators(symbol: string, timeframe: "5m" | "15m" | "1h"): Promise<MTFIndicators> {
    // Return neutral defaults if no API key
    if (!this.apiKey || !this.httpClient) {
      logger.debug({ symbol, timeframe }, 'CryptoCompare MTF returning neutral defaults (no API key)');
      return {
        timeframe,
        rsi: 50, // Neutral RSI
        macd: { value: 0, signal: 0, histogram: 0 }, // Neutral MACD
        ema12: null,
        ema26: null,
        sma20: null,
      };
    }

    try {
      const ohlc = await this.getOHLC(symbol, timeframe, 200);

      if (ohlc.length < 26) { // Need at least 26 periods for MACD
        return {
          timeframe,
          rsi: null,
          macd: null,
          ema12: null,
          ema26: null,
          sma20: null,
        };
      }

      const closes = ohlc.map(c => c.close).filter(Number.isFinite);

      const rsi = this.calculateRSI(closes, 14);
      const macd = this.calculateMACD(closes, 12, 26, 9);
      const ema12 = this.calculateEMA(closes, 12);
      const ema26 = this.calculateEMA(closes, 26);
      const sma20 = this.calculateSMA(closes, 20);

      return {
        timeframe,
        rsi: rsi || null,
        macd: macd || null,
        ema12: ema12 || null,
        ema26: ema26 || null,
        sma20: sma20 || null,
      };
    } catch (error: any) {
      logger.warn({ symbol, timeframe, error: error.message }, 'Failed to get MTF indicators from CryptoCompare');
      // Since we have an API key, we should not fall back to defaults - throw error instead
      throw new Error(`CryptoCompare MTF indicators failed: ${error.message}`);
    }
  }

  /**
   * Calculate MTF confluence score
   */
  calculateMTFConfluence(mtfData: Record<"5m" | "15m" | "1h", MTFIndicators>): MTFConfluenceResult {
    let points = 0;
    const details: Record<"5m" | "15m" | "1h", string> = {
      "5m": "No data",
      "15m": "No data",
      "1h": "No data",
    };

    // 5m RSI > 55
    if (mtfData["5m"].rsi && mtfData["5m"].rsi > 55) {
      points += 1;
      details["5m"] = `RSI ${mtfData["5m"].rsi?.toFixed(1)} > 55`;
    } else if (mtfData["5m"].rsi) {
      details["5m"] = `RSI ${mtfData["5m"].rsi?.toFixed(1)} ≤ 55`;
    }

    // 15m MACD histogram > 0
    if (mtfData["15m"].macd && mtfData["15m"].macd.histogram > 0) {
      points += 1;
      details["15m"] = `MACD hist ${mtfData["15m"].macd.histogram.toFixed(4)} > 0`;
    } else if (mtfData["15m"].macd) {
      details["15m"] = `MACD hist ${mtfData["15m"].macd?.histogram.toFixed(4)} ≤ 0`;
    }

    // 1h EMA12 > EMA26
    if (mtfData["1h"].ema12 && mtfData["1h"].ema26 && mtfData["1h"].ema12 > mtfData["1h"].ema26) {
      points += 1;
      details["1h"] = `EMA12 ${mtfData["1h"].ema12?.toFixed(2)} > EMA26 ${mtfData["1h"].ema26?.toFixed(2)}`;
    } else if (mtfData["1h"].ema12 && mtfData["1h"].ema26) {
      details["1h"] = `EMA12 ${mtfData["1h"].ema12?.toFixed(2)} ≤ EMA26 ${mtfData["1h"].ema26?.toFixed(2)}`;
    }

    return {
      score: points,
      maxScore: 3,
      label: `${points}/3`,
      details,
    };
  }

  /**
   * Calculate technical indicators from OHLC data
   */
  calculateIndicators(ohlc: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>): CryptoCompareData['indicators'] {
    if (!ohlc || ohlc.length < 14) {
      return {};
    }

    const closes = ohlc.map(c => c.close).filter(Number.isFinite);
    const volumes = ohlc.map(c => c.volume).filter(Number.isFinite);

    if (closes.length < 14) {
      return {};
    }

    const indicators: CryptoCompareData['indicators'] = {};

    try {
      // RSI (14 period)
      indicators.rsi = this.calculateRSI(closes, 14);

      // MACD (12, 26, 9)
      indicators.macd = this.calculateMACD(closes, 12, 26, 9);

      // EMA12
      indicators.ema12 = this.calculateEMA(closes, 12);

      // EMA26
      indicators.ema26 = this.calculateEMA(closes, 26);

      // SMA20
      indicators.sma20 = this.calculateSMA(closes, 20);

    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to calculate indicators');
    }

    return indicators;
  }

  /**
   * Get market data from CryptoCompare
   */
  async getMarketData(symbol: string): Promise<CryptoCompareData['market']> {
    try {
      const response = await this.httpClient.get('/data/pricemultifull', {
        params: {
          fsyms: symbol.replace('USDT', '').replace('USD', ''),
          tsyms: 'USD',
        },
      });

      apiUsageTracker.increment('cryptocompare');

      const data = response.data?.RAW?.[symbol.replace('USDT', '').replace('USD', '')]?.USD;
      if (!data) {
        return {};
      }

      return {
        marketCap: parseFloat(data.MKTCAP) || undefined,
        priceChange24h: parseFloat(data.CHANGE24HOUR) || undefined,
        priceChangePercent24h: parseFloat(data.CHANGEPCT24HOUR) || undefined,
      };
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, 'Failed to get market data from CryptoCompare');
      return {};
    }
  }

  /**
   * Calculate RSI
   */
  private calculateRSI(prices: number[], period: number = 14): number | undefined {
    if (prices.length < period + 1) return undefined;

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(Math.max(change, 0));
      losses.push(Math.max(-change, 0));
    }

    // Calculate initial averages
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

    // Smooth the averages
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return Number.isFinite(rsi) ? rsi : undefined;
  }

  /**
   * Calculate MACD
   */
  private calculateMACD(prices: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): { value: number; signal: number; histogram: number } | undefined {
    if (prices.length < slowPeriod + signalPeriod) return undefined;

    const ema12 = this.calculateEMA(prices, fastPeriod);
    const ema26 = this.calculateEMA(prices, slowPeriod);

    if (!ema12 || !ema26) return undefined;

    const macd = ema12 - ema26;

    // Calculate signal line (EMA9 of MACD)
    const macdValues: number[] = [];
    for (let i = slowPeriod - 1; i < prices.length; i++) {
      const fastEMA = this.calculateEMA(prices.slice(0, i + 1), fastPeriod);
      const slowEMA = this.calculateEMA(prices.slice(0, i + 1), slowPeriod);
      if (fastEMA && slowEMA) {
        macdValues.push(fastEMA - slowEMA);
      }
    }

    if (macdValues.length < signalPeriod) return undefined;

    const signal = this.calculateEMA(macdValues, signalPeriod);
    if (!signal) return undefined;

    const histogram = macd - signal;

    return {
      value: macd,
      signal,
      histogram,
    };
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(prices: number[], period: number): number | undefined {
    if (prices.length < period) return undefined;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return Number.isFinite(ema) ? ema : undefined;
  }

  /**
   * Calculate SMA
   */
  private calculateSMA(prices: number[], period: number): number | undefined {
    if (prices.length < period) return undefined;

    const sum = prices.slice(-period).reduce((acc, price) => acc + price, 0);
    const sma = sum / period;

    return Number.isFinite(sma) ? sma : undefined;
  }
}
