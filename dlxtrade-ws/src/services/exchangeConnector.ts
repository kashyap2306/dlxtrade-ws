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

  // Must be optional for compatibility
  getAccount?(): Promise<any>;
  placeOrder?(params: {
    symbol: string;
    side: "BUY" | "SELL";
    type?: "MARKET" | "LIMIT";
    quantity: number;
    price?: number;
  }): Promise<any>;
}

export interface ExchangeCreationResult {
  success: boolean;
  connector?: ExchangeConnector;
  error?: {
    code: string;
    message: string;
    requiredFields?: string[];
  };
}

export class ExchangeConnectorFactory {
  static create(exchange: ExchangeName, credentials: ExchangeCredentials): ExchangeCreationResult {
    try {
      switch (exchange) {
        case 'binance':
          return {
            success: true,
            connector: new BinanceAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true)
          };
        case 'bitget':
          if (!credentials.passphrase) {
            return {
              success: false,
              error: {
                code: 'MISSING_PASSPHRASE',
                message: 'Passphrase is required for Bitget',
                requiredFields: ['passphrase']
              }
            };
          }
          return {
            success: true,
            connector: new BitgetAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true)
          };
        case 'weex':
          return {
            success: true,
            connector: new WeexAdapter(credentials.apiKey, credentials.secret, credentials.passphrase, credentials.testnet ?? true)
          };
        case 'bingx':
          return {
            success: true,
            connector: new BingXAdapter(credentials.apiKey, credentials.secret, credentials.testnet ?? true)
          };
        default:
          return {
            success: false,
            error: {
              code: 'UNSUPPORTED_EXCHANGE',
              message: `Unsupported exchange: ${exchange}`
            }
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: 'CREATION_FAILED',
          message: error.message
        }
      };
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

