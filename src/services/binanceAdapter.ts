import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { ExchangeConnector } from './exchangeConnector';
import type { Orderbook } from '../types';

export interface BinanceData {
  price?: number;
  volume24h?: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
  klines?: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  orderbook?: {
    bids: Array<{ price: string; quantity: string }>;
    asks: Array<{ price: string; quantity: string }>;
  };
}

export class BinanceAdapter implements ExchangeConnector {
  private httpClient: AxiosInstance;
  private apiKey?: string;
  private secret?: string;
  private testnet: boolean;

  constructor(apiKey?: string, secret?: string, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.secret = secret;
    this.testnet = testnet;

    // Use testnet URL if testnet is enabled
    const baseURL = testnet
      ? 'https://testnet.binance.vision/api/v3'
      : 'https://api.binance.com/api/v3';

    this.httpClient = axios.create({
      baseURL,
      timeout: 10000,
    });
  }

  getExchangeName(): 'binance' {
    return 'binance';
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const finalSymbol = symbol.replace('-', '').toUpperCase();
    const params = { symbol: finalSymbol, limit: Math.min(Math.max(limit, 5), 1000) };
    try {
      const response = await this.httpClient.get('/depth', { params });
      const data = response.data;
      return {
        symbol: data.symbol || finalSymbol,
        bids: (data.bids || []).map(([price, quantity]: [string, string]) => ({ price, quantity })),
        asks: (data.asks || []).map(([price, quantity]: [string, string]) => ({ price, quantity })),
        lastUpdateId: data.lastUpdateId || Date.now(),
      };
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinanceAdapter] getOrderbook failed');
      throw error;
    }
  }

  async getTicker(symbol?: string): Promise<any> {
    try {
      const params = symbol ? { symbol: symbol.replace('-', '').toUpperCase() } : undefined;
      const response = await this.httpClient.get('/ticker/24hr', { params });
      return response.data;
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinanceAdapter] getTicker failed');
      throw error;
    }
  }

  async getKlines(symbol: string, interval: string, limit: number = 500): Promise<any[]> {
    try {
      const finalSymbol = symbol.replace('-', '').toUpperCase();
      const response = await this.httpClient.get('/klines', {
        params: {
          symbol: finalSymbol,
          interval,
          limit: Math.min(limit, 1000)
        }
      });
      return response.data;
    } catch (error: any) {
      logger.warn({ symbol, interval, error: error.message }, '[BinanceAdapter] getKlines failed');
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.getTicker('BTCUSDT');
      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  // For public API, account access is not available
  async getAccount(): Promise<any> {
    throw new Error('Binance public API does not support account access. Use authenticated exchange connection instead.');
  }

  // Validate API key (not applicable for public API)
  async validateApiKey(): Promise<any> {
    throw new Error('Binance public API does not require API key validation.');
  }

  // Trading methods - not supported for public API
  async placeOrder(params: any): Promise<any> {
    throw new Error('Binance public API does not support trading operations.');
  }

  async cancelOrder(symbol: string, orderId: string, clientOrderId?: string): Promise<any> {
    throw new Error('Binance public API does not support trading operations.');
  }

  async getBalance(): Promise<any> {
    throw new Error('Binance public API does not support account operations.');
  }

  async getPositions(symbol?: string): Promise<any> {
    throw new Error('Binance public API does not support account operations.');
  }

  // WebSocket methods - not supported for public API
  subscribeOrderbook(symbol: string, callback: Function): void {
    throw new Error('Binance public API does not support WebSocket subscriptions.');
  }

  subscribeTrades(symbol: string, callback: Function): void {
    throw new Error('Binance public API does not support WebSocket subscriptions.');
  }

  startUserDataStream(): Promise<any> {
    throw new Error('Binance public API does not support user data streams.');
  }

  subscribeUserData(callback: Function): void {
    throw new Error('Binance public API does not support user data streams.');
  }

  keepAliveUserDataStream(): Promise<any> {
    throw new Error('Binance public API does not support user data streams.');
  }

  closeUserDataStream(): Promise<any> {
    throw new Error('Binance public API does not support user data streams.');
  }

  disconnect(): void {
    // No-op for public API
  }

  /**
   * Get market data (price, volume, etc.) - replaces CoinAPI market data
   */
  async getMarketData(symbol: string): Promise<BinanceData> {
    try {
      // Binance uses different symbol format (BTCUSDT instead of BTC_USDT)
      const binanceSymbol = symbol.toUpperCase();

      const response = await this.httpClient.get('/ticker/24hr', {
        params: { symbol: binanceSymbol }
      });

      const data = response.data;
      if (!data) {
        return {};
      }

      return {
        price: parseFloat(data.lastPrice || '0'),
        volume24h: parseFloat(data.volume || '0'),
        priceChange24h: parseFloat(data.priceChange || '0'),
        priceChangePercent24h: parseFloat(data.priceChangePercent || '0'),
      };
    } catch (error: any) {
      logger.warn({
        error: error.message,
        status: error.response?.status,
        symbol
      }, 'Binance market data API error');
      return {};
    }
  }

}
