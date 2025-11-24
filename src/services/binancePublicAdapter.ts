import axios, { AxiosInstance } from 'axios';
import { apiUsageTracker } from './apiUsageTracker';
import { logger } from '../utils/logger';
import type { Orderbook } from '../types';
import type { ExchangeConnector, ExchangeName } from './exchangeConnector';

/**
 * Lightweight adapter that uses Binance PUBLIC endpoints only.
 * Used when the user has no active exchange connections (fallback mode).
 */
export class BinancePublicAdapter implements ExchangeConnector {
  private readonly httpClient: AxiosInstance;

  constructor(baseUrl: string = 'https://api.binance.com') {
    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
    });
  }

  getExchangeName(): ExchangeName {
    return 'binance';
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const finalSymbol = symbol.replace('-', '').toUpperCase();
    const params = { symbol: finalSymbol, limit: Math.min(Math.max(limit, 5), 1000) };
    try {
      const response = await this.httpClient.get('/api/v3/depth', { params });
      apiUsageTracker.increment('binance');
      const data = response.data;
      return {
        symbol: data.symbol || finalSymbol,
        bids: (data.bids || []).map(([price, quantity]: [string, string]) => ({ price, quantity })),
        asks: (data.asks || []).map(([price, quantity]: [string, string]) => ({ price, quantity })),
        lastUpdateId: data.lastUpdateId || Date.now(),
      };
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getOrderbook failed');
      throw error;
    }
  }

  async getTicker(symbol?: string): Promise<any> {
    try {
      const params = symbol ? { symbol: symbol.replace('-', '').toUpperCase() } : undefined;
      const response = await this.httpClient.get('/api/v3/ticker/24hr', { params });
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getTicker failed');
      throw error;
    }
  }

  async getBookTicker(symbol: string): Promise<any> {
    try {
      const params = { symbol: symbol.replace('-', '').toUpperCase() };
      const response = await this.httpClient.get('/api/v3/ticker/bookTicker', { params });
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getBookTicker failed');
      throw error;
    }
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const params = {
      symbol: symbol.replace('-', '').toUpperCase(),
      interval,
      limit: Math.min(Math.max(limit, 1), 1000),
    };
    try {
      const response = await this.httpClient.get('/api/v3/klines', { params });
      apiUsageTracker.increment('binance');
      return response.data || [];
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getKlines failed');
      throw error;
    }
  }

  async getVolatility(symbol: string): Promise<number | null> {
    try {
      // Fetch 5m candles for last 100 periods (about 8.3 hours)
      const candles = await this.getKlines(symbol, '5m', 100);
      if (!candles || candles.length < 10) {
        return null;
      }

      // Calculate log returns
      const returns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prevClose = parseFloat(candles[i - 1][4]); // close price
        const currClose = parseFloat(candles[i][4]); // close price
        if (prevClose > 0 && currClose > 0) {
          const logReturn = Math.log(currClose / prevClose);
          if (Number.isFinite(logReturn)) {
            returns.push(logReturn);
          }
        }
      }

      if (returns.length < 10) {
        return null;
      }

      // Calculate standard deviation of returns
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
      const dailyVolatility = Math.sqrt(variance);

      // Annualize volatility: sqrt(1440/5) = sqrt(288) ≈ 16.97
      // This converts 5-minute volatility to daily volatility
      const annualizedVolatility = dailyVolatility * Math.sqrt(1440 / 5);

      return Number.isFinite(annualizedVolatility) ? annualizedVolatility : null;
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getVolatility failed');
      return null;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.httpClient.get('/api/v3/ping');
      return { success: true, message: 'Binance public API reachable' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Binance public API unreachable' };
    }
  }
}


