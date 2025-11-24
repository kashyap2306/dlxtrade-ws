import { BinanceAdapter } from './binanceAdapter';
import { BitgetAdapter } from './bitgetAdapter';
import { WeexAdapter } from './weexAdapter';
import { BingXAdapter } from './bingXAdapter';
import type { Orderbook, Trade } from '../types';
import { logger } from '../utils/logger';

export type ExchangeName = 'binance' | 'bitget' | 'weex' | 'bingx';

export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  passphrase?: string; // Required for Bitget
  testnet?: boolean;
}

export interface ExchangeConnector {
  getExchangeName(): ExchangeName;
  getOrderbook(symbol: string, limit?: number): Promise<Orderbook>;
  getTicker(symbol?: string): Promise<any>;
  getKlines(symbol: string, interval: string, limit?: number): Promise<any[]>;
  testConnection(): Promise<{ success: boolean; message: string }>;
}

export class ExchangeConnectorFactory {
  static create(exchange: ExchangeName, credentials: ExchangeCredentials): ExchangeConnector {
    switch (exchange) {
      case 'binance':
        return new BinanceAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
      case 'bitget':
        if (!credentials.passphrase) {
          throw new Error('Passphrase is required for Bitget');
        }
        return new BitgetAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true);
      case 'weex':
        return new WeexAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true);
      case 'bingx':
        return new BingXAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true);
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }

  static getRequiredFields(exchange: ExchangeName): string[] {
    switch (exchange) {
      case 'binance':
        return ['apiKey', 'secret'];
      case 'bitget':
        return ['apiKey', 'secret', 'passphrase'];
      case 'weex':
        return ['apiKey', 'secret'];
      case 'bingx':
        return ['apiKey', 'secret'];
      default:
        return [];
    }
  }

  static getBaseUrl(exchange: ExchangeName, testnet: boolean = true): string {
    switch (exchange) {
      case 'binance':
        return testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
      case 'bitget':
        return testnet ? 'https://api-demo.bitget.com' : 'https://api.bitget.com';
      case 'weex':
        return testnet ? 'https://api-demo.weex.com' : 'https://api.weex.com';
      case 'bingx':
        return testnet ? 'https://open-api-sandbox.bingx.com' : 'https://open-api.bingx.com';
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
}

