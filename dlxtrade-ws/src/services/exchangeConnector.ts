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
    credentials: { apiKey: string; apiSecret: string; passphrase?: string; sandbox?: boolean }, 
    symbol: string
  ): Promise<{
    orderEndpointReachable: boolean;
    permissionsOk: boolean;
    futuresEnabled: boolean;
    symbolTradable: boolean;
    message?: string;
  }> {
    try {
      // Validate passphrase for exchanges that require it
      if ((exchangeName === 'bitget' || exchangeName === 'weex') && !credentials.passphrase) {
        throw new Error(`Passphrase is required for ${exchangeName}`);
      }

      const exchangeCredentials: ExchangeCredentials = {
        apiKey: credentials.apiKey,
        secret: credentials.apiSecret,
        passphrase: credentials.passphrase,
        testnet: credentials.sandbox ?? true
      };

      const connector = ExchangeConnectorFactory.create(exchangeName, exchangeCredentials);

      // Test 1: Order endpoint reachable (MUST NOT fail on 400 for futures-only keys)
      let orderEndpointReachable = false;
      let permissionsOk = false;
      let futuresEnabled = false;
      let symbolTradable = false;

      try {
        // Test connection first - this now supports both spot and futures keys
        const connectionTest = await connector.testConnection();
        orderEndpointReachable = connectionTest.success;

        if (orderEndpointReachable) {
          // Test 2: Check permissions by examining connection details
          // For Bitget, if connection succeeded, permissions are OK
          if (connectionTest.details) {
            permissionsOk = connectionTest.details.permissions?.canTrade || false;
            // CRITICAL FIX: Check if futures is available from connection test
            futuresEnabled = connectionTest.details.futuresAvailable || false;
          } else {
            permissionsOk = true; // Connection worked, so permissions OK
            futuresEnabled = true; // Assume futures enabled if available in details
          }

          // Test 3: Check if symbol is tradable by getting ticker
          try {
            // CRITICAL FIX: For Bitget, use raw symbol format (BTCUSDT) and ensure futures-only validation
            let testSymbol = symbol;
            if (exchangeName === 'bitget') {
              // Convert BTC/USDT to BTCUSDT for Bitget futures
              testSymbol = symbol.replace(/[\/\-]/g, '').toUpperCase();
              logger.info({ originalSymbol: symbol, testSymbol }, 'Bitget: Converting symbol for futures ticker test');
            }
            
            await connector.getTicker(testSymbol);
            symbolTradable = true;
          } catch (err: any) {
            logger.warn({ err: err.message, symbol, exchangeName }, 'Symbol ticker test failed');
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

