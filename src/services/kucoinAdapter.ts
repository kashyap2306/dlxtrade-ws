import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { apiUsageTracker } from './apiUsageTracker';
import { logger } from '../utils/logger';
import type { Orderbook } from '../types';
import type { ExchangeConnector, ExchangeName } from './exchangeConnector';

export class KucoinAdapter implements ExchangeConnector {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly passphrase: string;
  private readonly httpClient: AxiosInstance;

  constructor(apiKey: string, apiSecret: string, passphrase: string, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    const baseURL = testnet ? 'https://openapi-sandbox.kucoin.com' : 'https://api.kucoin.com';

    this.httpClient = axios.create({
      baseURL,
      timeout: 10000,
    });
  }

  getExchangeName(): ExchangeName {
    return 'kucoin';
  }

  private sign(timestamp: string, method: string, endpoint: string, params: Record<string, any>, body: any): string {
    const serializedParams = method.toUpperCase() === 'GET' && Object.keys(params).length > 0
      ? `?${Object.keys(params)
          .map((key) => `${key}=${encodeURIComponent(params[key])}`)
          .join('&')}`
      : '';

    const requestPath = `${endpoint}${serializedParams}`;
    const payload = method.toUpperCase() === 'GET' ? '' : JSON.stringify(body ?? {});
    const preSign = `${timestamp}${method.toUpperCase()}${requestPath}${payload}`;

    return crypto.createHmac('sha256', this.apiSecret).update(preSign).digest('base64');
  }

  private signPassphrase(): string {
    return crypto.createHmac('sha256', this.apiSecret).update(this.passphrase).digest('base64');
  }

  private async request(
    method: 'GET' | 'POST',
    endpoint: string,
    params: Record<string, any> = {},
    body?: Record<string, any>,
    signed: boolean = false
  ): Promise<any> {
    const timestamp = Date.now().toString();
    const headers: Record<string, string> = {};

    if (signed) {
      headers['KC-API-KEY'] = this.apiKey;
      headers['KC-API-TIMESTAMP'] = timestamp;
      headers['KC-API-SIGN'] = this.sign(timestamp, method, endpoint, params, body);
      headers['KC-API-PASSPHRASE'] = this.signPassphrase();
      headers['KC-API-KEY-VERSION'] = '2';
    }

    try {
      const response = await this.httpClient.request({
        method,
        url: endpoint,
        params: method === 'GET' ? params : undefined,
        data: method === 'POST' ? body : undefined,
        headers,
      });
      apiUsageTracker.increment('kucoin');
      return response.data?.data ?? response.data;
    } catch (error: any) {
      logger.error({ endpoint, params, error: error.message }, 'KuCoin API request failed');
      throw error;
    }
  }

  private normalizeSymbol(symbol: string): string {
    if (symbol.includes('-')) return symbol.toUpperCase();
    const upper = symbol.toUpperCase();
    if (upper.endsWith('USDT')) {
      return `${upper.slice(0, -4)}-USDT`;
    }
    return upper;
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const normalized = this.normalizeSymbol(symbol);
    const clampedLimit = Math.min(Math.max(limit, 5), 100);
    const level = clampedLimit <= 20 ? 'level2_20' : 'level2_100';
    const data = await this.request('GET', `/api/v1/market/orderbook/${level}`, { symbol: normalized });
    const bids = (data?.bids || []).map(([price, quantity]: [string, string]) => ({ price, quantity }));
    const asks = (data?.asks || []).map(([price, quantity]: [string, string]) => ({ price, quantity }));
    return {
      symbol: normalized,
      bids,
      asks,
      lastUpdateId: parseInt(data?.sequence || Date.now(), 10),
    };
  }

  async getTicker(symbol?: string): Promise<any> {
    if (symbol) {
      const normalized = this.normalizeSymbol(symbol);
      return this.request('GET', '/api/v1/market/orderbook/level1', { symbol: normalized });
    }
    return this.request('GET', '/api/v1/market/allTickers');
  }

  private mapTimeframe(timeframe: string): string {
    const mapping: Record<string, string> = {
      '1m': '1min',
      '3m': '3min',
      '5m': '5min',
      '15m': '15min',
      '30m': '30min',
      '1h': '1hour',
      '2h': '2hour',
      '4h': '4hour',
      '6h': '6hour',
      '8h': '8hour',
      '12h': '12hour',
      '1d': '1day',
      '1w': '1week',
    };
    return mapping[timeframe.toLowerCase()] || '5min';
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const normalized = this.normalizeSymbol(symbol);
    const data = await this.request('GET', '/api/v1/market/candles', {
      symbol: normalized,
      type: this.mapTimeframe(interval),
      limit: Math.min(Math.max(limit, 1), 1500),
    });
    return data || [];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.getAccount();
      return { success: true, message: 'KuCoin API connection successful' };
    } catch (error: any) {
      return { success: false, message: error.message || 'KuCoin API validation failed' };
    }
  }

  async getAccount(): Promise<any> {
    return this.request('GET', '/api/v1/accounts', {}, undefined, true);
  }
}



