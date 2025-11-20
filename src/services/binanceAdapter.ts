import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import WebSocket from 'ws';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ExchangeError } from '../utils/errors';
import { apiUsageTracker } from './apiUsageTracker';
import type { Order, Orderbook, Trade, Quote } from '../types';
import type { ExchangeConnector, ExchangeName } from './exchangeConnector';

export class BinanceAdapter implements ExchangeConnector {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private wsUrl: string;
  private httpClient: AxiosInstance;
  private orderbookWs: WebSocket | null = null;
  private tradesWs: WebSocket | null = null;
  private userStreamWs: WebSocket | null = null;
  private listenKey: string | null = null;

  constructor(apiKey: string, apiSecret: string, testnet: boolean = true) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = testnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';
    this.wsUrl = testnet
      ? 'wss://testnet.binance.vision'
      : 'wss://stream.binance.com:9443';

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
      },
    });
  }

  getExchangeName(): ExchangeName {
    return 'binance';
  }

  private sign(params: Record<string, any>): string {
    const queryString = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    params: Record<string, any> = {},
    signed: boolean = false
  ): Promise<any> {
    if (signed) {
      params.timestamp = Date.now();
      params.signature = this.sign(params);
    }

    try {
      const response = await this.httpClient.request({
        method,
        url: endpoint,
        params: method === 'GET' ? params : undefined,
        data: method !== 'GET' ? params : undefined,
      });
      // Track API usage
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.error({ error, endpoint, params }, 'Binance API error');
      throw new ExchangeError(
        error.response?.data?.msg || error.message || 'Exchange API error',
        error.response?.status || 500
      );
    }
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const data = await this.request('GET', '/api/v3/depth', {
      symbol: symbol.toUpperCase(),
      limit,
    });

    return {
      symbol: data.symbol,
      bids: data.bids.map(([price, qty]: [string, string]) => ({
        price,
        quantity: qty,
      })),
      asks: data.asks.map(([price, qty]: [string, string]) => ({
        price,
        quantity: qty,
      })),
      lastUpdateId: data.lastUpdateId,
    };
  }

  async getAccount(): Promise<any> {
    return await this.request('GET', '/api/v3/account', {}, true);
  }

  async placeOrder(params: {
    symbol: string;
    side: "BUY" | "SELL";
    type?: "MARKET" | "LIMIT";
    quantity: number;
    price?: number;
  }): Promise<Order> {
    const { symbol, side, type = 'MARKET', quantity, price } = params;
    const timeInForce = 'GTC';
    const orderParams: Record<string, any> = {
      symbol: symbol.toUpperCase(),
      side,
      type,
      quantity: quantity.toString(),
    };

    if (type === 'LIMIT') {
      if (!price) throw new Error('Price required for LIMIT orders');
      orderParams.price = price.toString();
      orderParams.timeInForce = timeInForce;
    }

    const data = await this.request('POST', '/api/v3/order', orderParams, true);

    return {
      id: data.orderId.toString(),
      symbol: data.symbol,
      side: data.side as 'BUY' | 'SELL',
      type: data.type as 'LIMIT' | 'MARKET',
      quantity: parseFloat(data.executedQty || data.origQty),
      price: parseFloat(data.price || '0'),
      status: data.status as Order['status'],
      clientOrderId: data.clientOrderId,
      exchangeOrderId: data.orderId.toString(),
      filledQty: parseFloat(data.executedQty || '0'),
      avgPrice: parseFloat(data.price || '0'),
      createdAt: new Date(data.transactTime || Date.now()),
      updatedAt: new Date(data.updateTime || Date.now()),
    };
  }

  async getTicker(symbol?: string): Promise<any> {
    if (symbol) {
      const data = await this.request('GET', '/api/v3/ticker/24hr', {
        symbol: symbol.toUpperCase(),
      });
      return data;
    } else {
      // Get all tickers
      const data = await this.request('GET', '/api/v3/ticker/24hr', {});
      return data;
    }
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const data = await this.request('GET', '/api/v3/klines', {
      symbol: symbol.toUpperCase(),
      interval,
      limit,
    });
    return data || [];
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test with account info endpoint
      await this.request('GET', '/api/v3/account', {}, true);
      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      const message = error.message || 'Connection test failed';
      if (message.includes('401') || message.includes('Unauthorized')) {
        return { success: false, message: 'Invalid API key or secret' };
      }
      return { success: false, message };
    }
  }

  async validateApiKey(): Promise<{ valid: boolean; canTrade: boolean; canWithdraw: boolean; error?: string }> {
    try {
      // Try to get account info - this validates the key
      const accountInfo = await this.request('GET', '/api/v3/account', {}, true);
      
      // Check permissions (Binance doesn't expose this directly, but we can infer from account access)
      // If we can access account, trading is likely enabled
      // Withdrawal permission is harder to check without attempting a withdrawal
      // For safety, we'll assume withdrawals are possible if account access works
      // In production, you'd want to check API key restrictions via Binance API key management
      
      return {
        valid: true,
        canTrade: true, // If we can access account, trading should work
        canWithdraw: false, // Assume false for safety - user should verify manually
      };
    } catch (error: any) {
      logger.error({ error }, 'API key validation failed');
      return {
        valid: false,
        canTrade: false,
        canWithdraw: false,
        error: error.message || 'Invalid API key',
      };
    }
  }

  async cancelOrder(
    symbol: string,
    orderId?: string,
    clientOrderId?: string
  ): Promise<Order> {
    const params: Record<string, any> = {
      symbol: symbol.toUpperCase(),
    };

    if (orderId) params.orderId = orderId;
    if (clientOrderId) params.origClientOrderId = clientOrderId;

    const data = await this.request('DELETE', '/api/v3/order', params, true);

    return {
      id: data.orderId.toString(),
      symbol: data.symbol,
      side: data.side as 'BUY' | 'SELL',
      type: data.type as 'LIMIT' | 'MARKET',
      quantity: parseFloat(data.origQty),
      price: parseFloat(data.price || '0'),
      status: data.status as Order['status'],
      clientOrderId: data.clientOrderId,
      exchangeOrderId: data.orderId.toString(),
      filledQty: parseFloat(data.executedQty || '0'),
      avgPrice: parseFloat(data.price || '0'),
      createdAt: new Date(data.time || Date.now()),
      updatedAt: new Date(data.updateTime || Date.now()),
    };
  }

  async getOrderStatus(
    symbol: string,
    orderId?: string,
    clientOrderId?: string
  ): Promise<Order> {
    const params: Record<string, any> = {
      symbol: symbol.toUpperCase(),
    };

    if (orderId) params.orderId = orderId;
    if (clientOrderId) params.origClientOrderId = clientOrderId;

    const data = await this.request('GET', '/api/v3/order', params, true);

    return {
      id: data.orderId.toString(),
      symbol: data.symbol,
      side: data.side as 'BUY' | 'SELL',
      type: data.type as 'LIMIT' | 'MARKET',
      quantity: parseFloat(data.origQty),
      price: parseFloat(data.price || '0'),
      status: data.status as Order['status'],
      clientOrderId: data.clientOrderId,
      exchangeOrderId: data.orderId.toString(),
      filledQty: parseFloat(data.executedQty || '0'),
      avgPrice: parseFloat(data.price || '0'),
      createdAt: new Date(data.time || Date.now()),
      updatedAt: new Date(data.updateTime || Date.now()),
    };
  }

  async startUserDataStream(): Promise<string> {
    const data = await this.request('POST', '/api/v3/userDataStream', {}, false);
    this.listenKey = data.listenKey;
    return data.listenKey;
  }

  async keepAliveUserDataStream(): Promise<void> {
    if (!this.listenKey) return;
    await this.request('PUT', '/api/v3/userDataStream', {
      listenKey: this.listenKey,
    }, false);
  }

  async closeUserDataStream(): Promise<void> {
    if (!this.listenKey) return;
    await this.request('DELETE', '/api/v3/userDataStream', {
      listenKey: this.listenKey,
    }, false);
    this.listenKey = null;
  }

  subscribeOrderbook(
    symbol: string,
    callback: (orderbook: Orderbook) => void
  ): void {
    const stream = `${symbol.toLowerCase()}@depth20@100ms`;
    this.orderbookWs = new WebSocket(`${this.wsUrl}/ws/${stream}`);

    this.orderbookWs.on('message', (data: WebSocket.Data) => {
      try {
        const update = JSON.parse(data.toString());
        callback({
          symbol: update.s,
          bids: update.b.map(([p, q]: [string, string]) => ({
            price: p,
            quantity: q,
          })),
          asks: update.a.map(([p, q]: [string, string]) => ({
            price: p,
            quantity: q,
          })),
          lastUpdateId: update.u,
        });
      } catch (err) {
        logger.error({ err }, 'Error parsing orderbook update');
      }
    });

    this.orderbookWs.on('error', (err) => {
      logger.error({ err }, 'Orderbook WebSocket error');
    });
  }

  subscribeTrades(
    symbol: string,
    callback: (trade: Trade) => void
  ): void {
    const stream = `${symbol.toLowerCase()}@trade`;
    this.tradesWs = new WebSocket(`${this.wsUrl}/ws/${stream}`);

    this.tradesWs.on('message', (data: WebSocket.Data) => {
      try {
        const update = JSON.parse(data.toString());
        callback({
          id: update.t.toString(),
          symbol: update.s,
          price: update.p,
          quantity: update.q,
          time: update.T,
          isBuyerMaker: update.m,
        });
      } catch (err) {
        logger.error({ err }, 'Error parsing trade update');
      }
    });

    this.tradesWs.on('error', (err) => {
      logger.error({ err }, 'Trades WebSocket error');
    });
  }

  subscribeUserData(callback: (data: any) => void): void {
    if (!this.listenKey) {
      throw new Error('User data stream not started');
    }

    this.userStreamWs = new WebSocket(
      `${this.wsUrl}/ws/${this.listenKey}`
    );

    this.userStreamWs.on('message', (data: WebSocket.Data) => {
      try {
        const update = JSON.parse(data.toString());
        callback(update);
      } catch (err) {
        logger.error({ err }, 'Error parsing user data update');
      }
    });

    this.userStreamWs.on('error', (err) => {
      logger.error({ err }, 'User data WebSocket error');
    });
  }

  disconnect(): void {
    this.orderbookWs?.close();
    this.tradesWs?.close();
    this.userStreamWs?.close();
    this.closeUserDataStream();
  }
}

