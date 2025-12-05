import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { ExchangeError } from '../utils/errors';
import type { Orderbook, Trade, Quote } from '../types';
import type { ExchangeConnector, ExchangeName } from './exchangeConnector';

export class BitgetAdapter implements ExchangeConnector {
  private apiKey: string;
  private apiSecret: string;
  private passphrase: string;
  private baseUrl: string;
  private httpClient: AxiosInstance;

  constructor(apiKey: string, apiSecret: string, passphrase: string, testnet: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    this.baseUrl = testnet
      ? 'https://api-demo.bitget.com'
      : 'https://api.bitget.com';

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!passphrase) {
      logger.warn('BitgetAdapter initialized with missing passphrase, adapter will be disabled.');
    }
  }

  getExchangeName(): ExchangeName {
    return 'bitget';
  }

  private sign(timestamp: string, method: string, path: string, body: string = ''): string {
    const message = timestamp + method.toUpperCase() + path + body;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('base64');
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    params: Record<string, any> = {},
    signed: boolean = false
  ): Promise<any> {
    if (!this.passphrase) {
      throw new ExchangeError('Passphrase is required for Bitget API', 400);
    }

    const timestamp = Date.now().toString();
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');

    const fullUrl = queryString ? `${endpoint}?${queryString}` : endpoint;
    const body = method === 'POST' ? JSON.stringify(params) : '';

    const headers: any = {
      'ACCESS-KEY': this.apiKey,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
    };

    if (signed) {
      const signature = this.sign(timestamp, method, fullUrl, body);
      headers['ACCESS-SIGN'] = signature;
    }

    try {
      const response = await this.httpClient.request({
        method,
        url: fullUrl,
        data: body || undefined,
        headers,
      });
      return response.data;
    } catch (error: any) {
      logger.error({ error, endpoint, params }, 'Bitget API error');
      throw new ExchangeError(
        error.response?.data?.msg || error.message || 'Bitget API error',
        error.response?.status || 500
      );
    }
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    try {
      const data = await this.request('GET', '/api/v2/spot/market/orderbook', {
        symbol: symbol.toUpperCase(),
        limit: limit.toString(),
      });

      return {
        symbol: data.data?.symbol || symbol,
        bids: (data.data?.bids || []).map(([price, qty]: [string, string]) => ({
          price,
          quantity: qty,
        })),
        asks: (data.data?.asks || []).map(([price, qty]: [string, string]) => ({
          price,
          quantity: qty,
        })),
        lastUpdateId: data.data?.timestamp || Date.now(),
      };
    } catch (error: any) {
      logger.error({ error, symbol }, 'Error getting Bitget orderbook');
      // Return empty orderbook on error
      return {
        symbol,
        bids: [],
        asks: [],
        lastUpdateId: Date.now(),
      };
    }
  }

  async getTicker(symbol?: string): Promise<any> {
    try {
      if (symbol) {
        const data = await this.request('GET', '/api/v2/spot/market/tickers', {
          symbol: symbol.toUpperCase(),
        });
        return data.data?.[0] || {};
      } else {
        const data = await this.request('GET', '/api/v2/spot/market/tickers', {});
        return data.data || [];
      }
    } catch (error: any) {
      logger.error({ error, symbol }, 'Error getting Bitget ticker');
      return symbol ? {} : [];
    }
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    try {
      const data = await this.request('GET', '/api/v2/spot/market/candles', {
        symbol: symbol.toUpperCase(),
        granularity: interval,
        limit: limit.toString(),
      });
      return data.data || [];
    } catch (error: any) {
      logger.error({ error, symbol, interval }, 'Error getting Bitget klines');
      return [];
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.passphrase) {
        return { success: false, message: 'Passphrase is required for Bitget' };
      }

      // Test with account info endpoint
      const response = await this.request('GET', '/api/v2/spot/account/info', {}, true);
      if (response.code === '00000' || response.data) {
        return { success: true, message: 'Connection successful' };
      }
      return { success: false, message: response.msg || 'Connection test failed' };
    } catch (error: any) {
      const message = error.message || 'Connection test failed';
      if (message.includes('401') || message.includes('Unauthorized')) {
        return { success: false, message: 'Invalid API key, secret, or passphrase' };
      }
      return { success: false, message };
    }
  }

  async getAccount(): Promise<any> {
    try {
      return await this.request('GET', '/api/v2/spot/account/info', {}, true);
    } catch (error: any) {
      logger.error({ error }, 'Error getting Bitget account');
      return { error: error.message || 'Failed to get account' };
    }
  }

  async placeOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    type?: "MARKET" | "LIMIT";
    quantity: number;
    price?: number;
  }): Promise<any> {
    try {
      const { symbol, side, type = 'MARKET', quantity, price } = params;
      const orderParams: any = {
        symbol: symbol.toUpperCase(),
        side,
        orderType: type,
        size: quantity.toString(),
      };

      if (type === 'LIMIT' && price) {
        orderParams.price = price.toString();
      }

      const response = await this.request('POST', '/api/v2/spot/trade/orders', orderParams, true);
      return {
        id: response.data?.orderId?.toString() || Date.now().toString(),
        symbol,
        side,
        type,
        quantity,
        price: price || 0,
        status: 'NEW',
        exchangeOrderId: response.data?.orderId?.toString() || '',
      };
    } catch (error: any) {
      logger.error({ error }, 'Error placing Bitget order');
      throw error;
    }
  }
}
