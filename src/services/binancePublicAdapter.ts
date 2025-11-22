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

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.httpClient.get('/api/v3/ping');
      return { success: true, message: 'Binance public API reachable' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Binance public API unreachable' };
    }
  }
}


