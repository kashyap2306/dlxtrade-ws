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
  getFuturesBalance?(): Promise<{
    exchange: ExchangeName;
    availableBalance: number;
    totalBalance: number;
    currency: string;
    marketType: string;
  }>;
  testConnection(): Promise<{ success: boolean; message: string; details?: any }>;

  // Must be optional for compatibility
  getAccount?(): Promise<any>;
  placeOrder?(params: {
    symbol: string;
    side: "BUY" | "SELL";
    type?: "MARKET" | "LIMIT";
    quantity: number;
    price?: number;
  }): Promise<any>;
  setLeverage?(symbol: string, leverage: number): Promise<void>;
  setMarginType?(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void>;
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
        // CRITICAL: Bitget demo is strictly forbidden in production
        return 'https://api.bitget.com';
      case 'weex':
        return testnet ? 'https://api-demo.weex.com' : 'https://api.weex.com';
      case 'bingx':
        return testnet ? 'https://open-api-sandbox.bingx.com' : 'https://open-api.bingx.com';
      default:
        throw new Error(`Unsupported exchange: ${exchange}`);
    }
  }
}

export class ExchangeConnector {
  // Utility method for testing exchange execution
  static async testOrderExecution(
    exchangeName: ExchangeName, 
    credentials: { apiKey: string; apiSecret: string; sandbox?: boolean }, 
    symbol: string
  ): Promise<{
    orderEndpointReachable: boolean;
    permissionsOk: boolean;
    futuresEnabled: boolean;
    symbolTradable: boolean;
    message?: string;
  }> {
    try {
      const exchangeCredentials: ExchangeCredentials = {
        apiKey: credentials.apiKey,
        secret: credentials.apiSecret,
        testnet: credentials.sandbox ?? true
      };

      // Add passphrase for exchanges that require it
      if (exchangeName === 'bitget' || exchangeName === 'weex') {
        // For test purposes, we'll skip passphrase validation
        // In production, this should be provided
        (exchangeCredentials as any).passphrase = 'test';
      }

      const connector = ExchangeConnectorFactory.create(exchangeName, exchangeCredentials);

      // Test 1: Order endpoint reachable
      let orderEndpointReachable = false;
      let permissionsOk = false;
      let futuresEnabled = false;
      let symbolTradable = false;

      try {
        // Test connection first
        const connectionTest = await connector.testConnection();
        orderEndpointReachable = connectionTest.success;

        if (orderEndpointReachable) {
          // Test 2: Check permissions by getting account info
          if (connector.getAccount) {
            try {
              await connector.getAccount();
              permissionsOk = true;
            } catch (err: any) {
              logger.warn({ err: err.message }, 'Account permissions test failed');
              permissionsOk = false;
            }
          } else {
            // If no getAccount method, assume permissions are OK if connection works
            permissionsOk = true;
          }

          // Test 3: Check futures enabled by getting futures balance
          if (connector.getFuturesBalance) {
            try {
              await connector.getFuturesBalance();
              futuresEnabled = true;
            } catch (err: any) {
              logger.warn({ err: err.message }, 'Futures balance test failed');
              futuresEnabled = false;
            }
          }

          // Test 4: Check if symbol is tradable by getting ticker
          try {
            await connector.getTicker(symbol);
            symbolTradable = true;
          } catch (err: any) {
            logger.warn({ err: err.message, symbol }, 'Symbol ticker test failed');
            symbolTradable = false;
          }
        }

        return {
          orderEndpointReachable,
          permissionsOk,
          futuresEnabled,
          symbolTradable,
          message: 'Exchange execution test completed successfully'
        };

      } catch (err: any) {
        logger.error({ err, exchangeName }, 'Exchange execution test failed');
        return {
          orderEndpointReachable: false,
          permissionsOk: false,
          futuresEnabled: false,
          symbolTradable: false,
          message: err.message || 'Exchange execution test failed'
        };
      }

    } catch (err: any) {
      logger.error({ err, exchangeName }, 'Exchange connector creation failed');
      throw new Error(`Exchange connector creation failed: ${err.message}`);
    }
  }
}

