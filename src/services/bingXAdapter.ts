import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { ExchangeError } from '../utils/errors';
import type { Orderbook, Trade, Quote } from '../types';
import type { ExchangeConnector, ExchangeName } from './exchangeConnector';

export class BingXAdapter implements ExchangeConnector {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private httpClient: AxiosInstance;

  constructor(apiKey: string, apiSecret: string, testnet: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = testnet
      ? 'https://open-api-sandbox.bingx.com'
      : 'https://open-api.bingx.com';

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'X-BX-APIKEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  getExchangeName(): ExchangeName {
    return 'bingx';
  }

  private sign(timestamp: string, queryString: string): string {
    const message = timestamp + queryString;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(message)
      .digest('hex');
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    params: Record<string, any> = {},
    signed: boolean = false
  ): Promise<any> {
    const timestamp = Date.now().toString();
    let queryString = '';
    
    if (method === 'GET') {
      queryString = Object.keys(params)
        .map((key) => `${key}=${encodeURIComponent(params[key])}`)
        .join('&');
      endpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
    }

    const headers: any = {
      'X-BX-APIKEY': this.apiKey,
      'X-BX-TIMESTAMP': timestamp,
      'Content-Type': 'application/json',
    };

    if (signed) {
      const signature = this.sign(timestamp, queryString);
      headers['X-BX-SIGNATURE'] = signature;
    }

    try {
      const response = await this.httpClient.request({
        method,
        url: endpoint,
        params: method === 'GET' ? undefined : params,
        data: method !== 'GET' ? params : undefined,
        headers,
      });
      return response.data;
    } catch (error: any) {
      logger.error({ error, endpoint, params }, 'BingX API error');
      throw new ExchangeError(
        error.response?.data?.msg || error.message || 'BingX API error',
        error.response?.status || 500
      );
    }
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const data = await this.request('GET', '/openApi/spot/v1/market/depth', {
      symbol: symbol.toUpperCase(),
      limit,
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
      lastUpdateId: data.data?.lastUpdateId || Date.now(),
    };
  }

  async getTicker(symbol?: string): Promise<any> {
    if (symbol) {
      const data = await this.request('GET', '/openApi/spot/v1/ticker/24hr', {
        symbol: symbol.toUpperCase(),
      });
      return data.data;
    } else {
      // Get all tickers
      const data = await this.request('GET', '/openApi/spot/v1/ticker/24hr', {});
      return data.data || [];
    }
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const data = await this.request('GET', '/openApi/spot/v1/market/klines', {
      symbol: symbol.toUpperCase(),
      interval,
      limit,
    });
    return data.data || [];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test with account info endpoint
      const response = await this.request('GET', '/openApi/account/v1/info', {}, true);
      if (response.code === 0 || response.data) {
        return { success: true, message: 'Connection successful' };
      }
      return { success: false, message: response.msg || 'Connection test failed' };
    } catch (error: any) {
      const message = error.message || 'Connection test failed';
      if (message.includes('401') || message.includes('Unauthorized')) {
        return { success: false, message: 'Invalid API key or secret' };
      }
      return { success: false, message };
    }
  }

  async getAccount(): Promise<any> {
    try {
      return await this.request('GET', '/openApi/account/v1/info', {}, true);
    } catch (error: any) {
      logger.error({ error }, 'Error getting BingX account');
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
        type,
        quantity: quantity.toString(),
      };

      if (type === 'LIMIT' && price) {
        orderParams.price = price.toString();
      }

      const response = await this.request('POST', '/openApi/spot/v1/trade', orderParams, true);
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
      logger.error({ error }, 'Error placing BingX order');
      throw error;
    }
  }
}

