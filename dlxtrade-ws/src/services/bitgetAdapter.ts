import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
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

  constructor(apiKey: string, apiSecret: string, passphrase: string, testnet: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.passphrase = passphrase;
    // CRITICAL: Always use production URL as requested
    this.baseUrl = 'https://api.bitget.com';

    // Defensive Assertion: Never allowed to use demo URL in production
    if (this.baseUrl.includes('demo')) {
      throw new Error('[BITGET_LIVE_GUARD] Demo/Testnet URL detected! Bitget must ALWAYS use api.bitget.com');
    }

    console.log('[BITGET_LIVE_CONFIRMED] BitgetAdapter initialized with production endpoint:', this.baseUrl);

    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000, // Hard 10s timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!passphrase) {
      logger.warn('BitgetAdapter initialized with missing passphrase, adapter will be disabled.');
    }

    if (testnet) {
      logger.warn('[BITGET_SAFE_GUARD] Testnet was requested but forced to FALSE for production safety');
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

  async getFuturesBalance(): Promise<{
    exchange: ExchangeName;
    availableBalance: number;
    totalBalance: number;
    currency: string;
    marketType: string;
  }> {
    // CRITICAL: Validate credentials before making API call
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new ExchangeError('EXCHANGE_KEY_DECRYPTION_FAILED: API key is empty - decryption failed or key not set', 400);
    }
    if (!this.apiSecret || this.apiSecret.trim() === '') {
      throw new ExchangeError('EXCHANGE_KEY_DECRYPTION_FAILED: API secret is empty - decryption failed or secret not set', 400);
    }
    if (!this.passphrase || this.passphrase.trim() === '') {
      throw new ExchangeError('EXCHANGE_KEY_DECRYPTION_FAILED: Passphrase is empty - decryption failed or passphrase not set', 400);
    }

    try {
      // Bitget V2 Futures Account API: /api/v2/mix/account/accounts?productType=USDT-FUTURES
      const futuresResponse = await this.request('GET', '/api/v2/mix/account/accounts', {
        productType: 'USDT-FUTURES'
      }, true);

      let total = 0;
      let available = 0;

      if (futuresResponse.data && Array.isArray(futuresResponse.data)) {
        const usdtAccount = futuresResponse.data.find((acc: any) => acc.marginCoin === 'USDT');
        if (usdtAccount) {
          total = parseFloat(usdtAccount.equity || usdtAccount.available || '0');
          available = parseFloat(usdtAccount.available || '0');
        }
      }

      return {
        exchange: 'bitget',
        availableBalance: available,
        totalBalance: total,
        currency: 'USDT',
        marketType: 'USDT-M Futures'
      };
    } catch (error: any) {
      logger.error({ error, exchange: 'bitget' }, 'Failed to fetch Bitget futures balance');
      throw new ExchangeError('Failed to fetch futures balance: ' + (error.message || 'Unknown error'), 500);
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      if (!this.passphrase) {
        return { success: false, message: 'Passphrase is required for Bitget' };
      }

      // 1. Test with Spot account info (validates key & permissions)
      const spotResponse = await this.request('GET', '/api/v2/spot/account/info', {}, true);

      if (spotResponse.code !== '00000' && !spotResponse.data) {
        return { success: false, message: spotResponse.msg || 'Connection test failed' };
      }

      // 2. Fetch Futures Balance (USDT-M)
      let futuresDetails = {
        total: 0,
        available: 0,
        asset: 'USDT'
      };

      try {
        // Bitget V2 Futures Account API: /api/v2/mix/account/accounts?productType=USDT-FUTURES
        const futuresResponse = await this.request('GET', '/api/v2/mix/account/accounts', {
          productType: 'USDT-FUTURES'
        }, true);

        if (futuresResponse.data && Array.isArray(futuresResponse.data)) {
          // Find USDT margin account
          // Data structure typically handled per margin coin for USDT-M
          const usdtAccount = futuresResponse.data.find((acc: any) => acc.marginCoin === 'USDT');
          if (usdtAccount) {
            futuresDetails.total = parseFloat(usdtAccount.equity || usdtAccount.available || '0');
            futuresDetails.available = parseFloat(usdtAccount.available || '0');
          }
        }
      } catch (futuresErr: any) {
        logger.warn({ error: futuresErr.message }, 'Failed to fetch Bitget futures balance');
      }

      const accountId = spotResponse.data?.userId || spotResponse.data?.user_id || 'Bitget User';

      return {
        success: true,
        message: 'Connection successful',
        details: {
          exchange: 'bitget',
          accountName: `Bitget User (${accountId})`,
          accountType: 'futures',
          accountId: accountId,
          balance: futuresDetails,
          permissions: {
            canTrade: true // Inferred from successful account info and balance fetch
          },
          isTradeReady: futuresDetails.available >= 10 // Basic check example
        }
      };
    } catch (error: any) {
      const message = error.message || 'Connection test failed';
      if (message.includes('401') || message.includes('Unauthorized') || message.includes('CHECK_API_ERROR')) {
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

      // CRITICAL: Aligned with AutoTradeEngine which sets ISOLATED margin mode
      // Must match the account mode set via setMarginType
      const orderParams: any = {
        productType: 'USDT-FUTURES',
        symbol: symbol.toUpperCase(),
        side: side.toLowerCase(), // Bitget V2 Mix uses lowercase 'buy'/'sell'
        orderType: type.toLowerCase(), // 'market' or 'limit'
        marginMode: 'isolated', // FIXED: Was 'crossed', causing mismatch with engine intent
        marginCoin: 'USDT',
        size: quantity.toString(),
      };

      if (type === 'LIMIT' && price) {
        orderParams.price = price.toString();
        orderParams.priceProtect = 'off';
        // force: 'gtc' ? Bitget might default to GTC
        orderParams.force = 'gtc';
      }

      // API: /api/v2/mix/order/place-order
      const response = await this.request('POST', '/api/v2/mix/order/place-order', orderParams, true);

      if (response.code !== '00000') {
        throw new Error(response.msg || 'Bitget order failed');
      }

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
      logger.error({ error: error.message, params }, 'Error placing Bitget Futures order');
      throw error;
    }
  }

  /**
   * Set leverage for a symbol (Bitget V2)
   * Endpoint: /api/v2/mix/account/set-leverage
   */
  async setLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      const params = {
        symbol: symbol.toUpperCase(),
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        leverage: leverage.toString(),
        holdSide: 'long', // Bitget requires specifying side or typically sets for both if not strict. V2 might need separate calls?
        // Actually V2 set-leverage often sets for both Long/Short if we call it twice or if it handles 'long' and 'short'
        // Let's set for both to be safe as AutoTrade can go both ways.
      };

      // Set for LONG
      await this.request('POST', '/api/v2/mix/account/set-leverage', { ...params, holdSide: 'long' }, true);
      // Set for SHORT
      await this.request('POST', '/api/v2/mix/account/set-leverage', { ...params, holdSide: 'short' }, true);

      logger.info({ symbol, leverage }, 'Bitget leverage updated successfully (Long & Short)');
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ symbol, leverage, error: msg }, 'Failed to set Bitget leverage');
      // Non-blocking? Engine logs warning but proceeds.
      throw new Error(`LEVERAGE_SET_FAILED: ${msg}`);
    }
  }

  /**
   * Set margin type (Bitget V2)
   * Endpoint: /api/v2/mix/account/set-margin-mode
   */
  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void> {
    try {
      const mode = marginType.toLowerCase(); // 'isolated' or 'crossed'
      const params = {
        symbol: symbol.toUpperCase(),
        productType: 'USDT-FUTURES',
        marginCoin: 'USDT',
        marginMode: mode,
      };

      await this.request('POST', '/api/v2/mix/account/set-margin-mode', params, true);
      logger.info({ symbol, marginType }, 'Bitget margin type updated successfully');
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      // Ignore if already in that mode (common error)
      if (msg.includes('No modification needed') || msg.includes('already')) return;

      logger.error({ symbol, marginType, error: msg }, 'Failed to set Bitget margin type');
      // Don't throw to avoid blocking trade if already correct
    }
  }
}
