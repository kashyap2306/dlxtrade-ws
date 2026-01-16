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
  private contractInfoCache: Map<string, { expiresAt: number; value: { minOrderQty: number; tickSize: number; pricePrecision: number; qtyPrecision: number } }> = new Map();

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

  private async getUsdtMContractInfo(symbol: string): Promise<{ minOrderQty: number; tickSize: number; pricePrecision: number; qtyPrecision: number }> {
    const key = `USDT-FUTURES:${symbol.toUpperCase()}`;
    const cached = this.contractInfoCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const fallback = { minOrderQty: 0, tickSize: 0, pricePrecision: 2, qtyPrecision: 6 };
    try {
      const response = await this.request('GET', '/api/v2/mix/market/contracts', {
        productType: 'USDT-FUTURES'
      });

      const list = Array.isArray(response?.data) ? response.data : [];
      const contract = list.find((c: any) => String(c?.symbol || '').toUpperCase() === symbol.toUpperCase());
      if (!contract) {
        this.contractInfoCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, value: fallback });
        return fallback;
      }

      const value = {
        minOrderQty: parseFloat(contract.minOrderQty || '0') || 0,
        tickSize: parseFloat(contract.tickSize || '0') || 0,
        pricePrecision: parseInt(contract.pricePrecision || '2') || 2,
        qtyPrecision: parseInt(contract.qtyPrecision || '6') || 6,
      };

      this.contractInfoCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, value });
      return value;
    } catch {
      this.contractInfoCache.set(key, { expiresAt: Date.now() + 60 * 1000, value: fallback });
      return fallback;
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

  async getFuturesKlines(symbol: string, interval: string = '5m', limit: number = 100): Promise<any[]> {
    try {
      const response = await this.request('GET', '/api/v2/mix/market/candles', {
        symbol: symbol.toUpperCase(),
        granularity: interval,
        productType: 'USDT-FUTURES',
        limit: limit.toString(),
      });

      if (response.code !== '00000') {
        throw new ExchangeError(`Failed to get futures klines: ${response.msg}`, 400);
      }

      return response.data || [];
    } catch (error: any) {
      logger.error({ error, symbol, interval }, 'Error getting Bitget futures klines');
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

      const contractInfo = await this.getUsdtMContractInfo(symbol);
      const qtyPrecisionPow = Math.pow(10, Math.max(0, contractInfo.qtyPrecision || 0));
      const roundedQty = qtyPrecisionPow > 0 ? Math.floor(Number(quantity || 0) * qtyPrecisionPow) / qtyPrecisionPow : Number(quantity || 0);
      if (!isFinite(roundedQty) || roundedQty <= 0) {
        throw new ExchangeError('INVALID_ORDER_SIZE', 400);
      }
      if (contractInfo.minOrderQty > 0 && roundedQty < contractInfo.minOrderQty) {
        throw new ExchangeError(`ORDER_SIZE_BELOW_MIN: ${roundedQty} < ${contractInfo.minOrderQty}`, 400);
      }

      const roundPrice = (p: number) => {
        if (!isFinite(p) || p <= 0) return p;
        if (contractInfo.tickSize > 0) {
          return Math.round(p / contractInfo.tickSize) * contractInfo.tickSize;
        }
        const pp = Math.pow(10, Math.max(0, contractInfo.pricePrecision || 0));
        return pp > 0 ? Math.round(p * pp) / pp : p;
      };
      const roundedPrice = typeof price === 'number' ? roundPrice(price) : price;

      // CRITICAL: Aligned with AutoTradeEngine which sets ISOLATED margin mode
      // Must match the account mode set via setMarginType
      const orderParams: any = {
        productType: 'USDT-FUTURES',
        symbol: symbol.toUpperCase(),
        side: side.toLowerCase(), // Bitget V2 Mix uses lowercase 'buy'/'sell'
        orderType: type.toLowerCase(), // 'market' or 'limit'
        marginMode: 'isolated', // FIXED: Was 'crossed', causing mismatch with engine intent
        marginCoin: 'USDT',
        size: roundedQty.toString(),
      };

      if (type === 'LIMIT' && roundedPrice) {
        orderParams.price = roundedPrice.toString();
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
        quantity: roundedQty,
        price: roundedPrice || 0,
        status: 'NEW',
        exchangeOrderId: response.data?.orderId?.toString() || '',
      };
    } catch (error: any) {
      logger.error({ error: error.message, params }, 'Error placing Bitget Futures order');
      throw error;
    }
  }

  async placeFuturesOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<any> {
    const { symbol, side, type, quantity, price, stopLoss, takeProfit } = params;
    const holdSide = side === 'BUY' ? 'long' : 'short';

    const contractInfo = await this.getUsdtMContractInfo(symbol);
    const roundPrice = (p: number | undefined) => {
      const n = Number(p);
      if (!isFinite(n) || n <= 0) return undefined;
      if (contractInfo.tickSize > 0) {
        return Math.round(n / contractInfo.tickSize) * contractInfo.tickSize;
      }
      const pp = Math.pow(10, Math.max(0, contractInfo.pricePrecision || 0));
      return pp > 0 ? Math.round(n * pp) / pp : n;
    };
    const roundedStopLoss = roundPrice(stopLoss);
    const roundedTakeProfit = roundPrice(takeProfit);

    const entry = await this.placeOrder({
      symbol,
      side,
      type,
      quantity,
      price,
    });

    if (isFinite(Number(roundedStopLoss)) || isFinite(Number(roundedTakeProfit))) {
      try {
        const tpslParams: any = {
          marginCoin: 'USDT',
          productType: 'USDT-FUTURES',
          symbol: symbol.toUpperCase(),
          holdSide,
        };

        if (isFinite(Number(roundedTakeProfit))) {
          tpslParams.takeProfitPrice = String(roundedTakeProfit);
        }
        if (isFinite(Number(roundedStopLoss))) {
          tpslParams.stopLossPrice = String(roundedStopLoss);
        }

        const tpslResponse = await this.request('POST', '/api/v2/mix/order/place-pos-tpsl', tpslParams, true);
        if (tpslResponse.code !== '00000') {
          throw new Error(tpslResponse.msg || 'TPSL placement failed');
        }

        logger.info({ symbol, holdSide, hasSL: !!stopLoss, hasTP: !!takeProfit }, 'Bitget position TPSL attached');
      } catch (e: any) {
        logger.error({ symbol, side, error: e?.message }, 'Failed to attach Bitget position TPSL (SL/TP)');
        throw e;
      }
    }

    return entry;
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

  /**
   * Get COIN-M Futures contract information
   */
  async getCoinMContractInfo(symbol: string): Promise<{
    contractSize: number;
    minOrderQty: number;
    tickSize: number;
    pricePrecision: number;
    qtyPrecision: number;
  }> {
    try {
      const response = await this.request('GET', '/api/v2/mix/market/contracts', {
        productType: 'COIN-FUTURES'
      });

      if (response.code !== '00000') {
        throw new ExchangeError(`Failed to get contract info: ${response.msg}`, 400);
      }

      const contract = response.data.find((c: any) => c.symbol === symbol.toUpperCase());
      if (!contract) {
        throw new ExchangeError(`Contract not found: ${symbol}`, 404);
      }

      return {
        contractSize: parseFloat(contract.contractSize || '1'),
        minOrderQty: parseFloat(contract.minOrderQty || '0.001'),
        tickSize: parseFloat(contract.tickSize || '0.01'),
        pricePrecision: parseInt(contract.pricePrecision || '2'),
        qtyPrecision: parseInt(contract.qtyPrecision || '3')
      };
    } catch (error: any) {
      logger.error({ error, symbol }, 'Error getting COIN-M contract info');
      throw error;
    }
  }

  /**
   * Get COIN-M Futures klines
   */
  async getCoinMKlines(symbol: string, interval: string = '5m', limit: number = 100): Promise<any[]> {
    try {
      const response = await this.request('GET', '/api/v2/mix/market/candles', {
        symbol: symbol.toUpperCase(),
        granularity: interval,
        productType: 'COIN-FUTURES',
        limit: limit.toString(),
      });

      if (response.code !== '00000') {
        throw new ExchangeError(`Failed to get klines: ${response.msg}`, 400);
      }

      return response.data || [];
    } catch (error: any) {
      logger.error({ error, symbol, interval }, 'Error getting COIN-M klines');
      return [];
    }
  }

  /**
   * Place COIN-M Futures bracket order (entry + SL + TP atomic)
   */
  async placeCoinMBracketOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    leverage: number;
  }): Promise<{
    orderId: string;
    status: string;
    details: any;
  }> {
    try {
      // Set leverage for the symbol
      await this.setCoinMLeverage(params.symbol, params.leverage);

      // Get contract info for validation
      const contractInfo = await this.getCoinMContractInfo(params.symbol);

      // Validate quantity
      if (params.quantity < contractInfo.minOrderQty) {
        throw new ExchangeError(`Quantity ${params.quantity} below minimum ${contractInfo.minOrderQty}`, 400);
      }

      // Round prices to tick size
      const roundToTick = (price: number) => {
        return Math.round(price / contractInfo.tickSize) * contractInfo.tickSize;
      };

      const entryPrice = roundToTick(params.entryPrice);
      const stopLoss = roundToTick(params.stopLoss);
      const takeProfit = roundToTick(params.takeProfit);

      // Validate SL/TP distances
      if (params.side === 'BUY') {
        if (entryPrice <= stopLoss) {
          throw new ExchangeError('BUY order SL must be below entry price', 400);
        }
        if (takeProfit <= entryPrice) {
          throw new ExchangeError('BUY order TP must be above entry price', 400);
        }
      } else {
        if (entryPrice >= stopLoss) {
          throw new ExchangeError('SELL order SL must be above entry price', 400);
        }
        if (takeProfit >= entryPrice) {
          throw new ExchangeError('SELL order TP must be below entry price', 400);
        }
      }

      // Place bracket order using Bitget's plan order with preset SL/TP
      const orderParams = {
        symbol: params.symbol.toUpperCase(),
        productType: 'COIN-FUTURES',
        marginCoin: 'BTC',
        size: params.quantity.toString(),
        side: params.side.toLowerCase(),
        orderType: 'limit',
        price: entryPrice.toString(),
        presetStopLossPrice: stopLoss.toString(),
        presetTakeProfitPrice: takeProfit.toString(),
      };

      const response = await this.request('POST', '/api/v2/mix/order/place-plan-order', orderParams, true);

      if (response.code !== '00000') {
        throw new ExchangeError(`Order placement failed: ${response.msg}`, 400);
      }

      logger.info({
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity,
        entryPrice,
        stopLoss,
        takeProfit,
        orderId: response.data?.orderId
      }, 'COIN-M bracket order placed successfully');

      return {
        orderId: response.data?.orderId,
        status: 'PLACED',
        details: response.data
      };
    } catch (error: any) {
      logger.error({
        error,
        symbol: params.symbol,
        side: params.side,
        quantity: params.quantity
      }, 'Error placing COIN-M bracket order');
      throw error;
    }
  }

  /**
   * Set leverage for COIN-M Futures
   */
  async setCoinMLeverage(symbol: string, leverage: number): Promise<void> {
    try {
      const response = await this.request('POST', '/api/v2/mix/account/set-leverage', {
        symbol: symbol.toUpperCase(),
        productType: 'COIN-FUTURES',
        marginCoin: 'BTC',
        leverage: Math.min(leverage, 20).toString(), // Cap at 20x for safety
      }, true);

      if (response.code !== '00000') {
        throw new ExchangeError(`Failed to set leverage: ${response.msg}`, 400);
      }

      logger.info({ symbol, leverage }, 'COIN-M leverage set successfully');
    } catch (error: any) {
      logger.error({ error, symbol, leverage }, 'Error setting COIN-M leverage');
      throw error;
    }
  }

  /**
   * Get COIN-M position information
   */
  async getCoinMPositions(symbol?: string): Promise<any[]> {
    try {
      const params: any = { productType: 'COIN-FUTURES' };
      if (symbol) {
        params.symbol = symbol.toUpperCase();
      }

      const response = await this.request('GET', '/api/v2/mix/position/all-position', params, true);

      if (response.code !== '00000') {
        throw new ExchangeError(`Failed to get positions: ${response.msg}`, 400);
      }

      return response.data || [];
    } catch (error: any) {
      logger.error({ error, symbol }, 'Error getting COIN-M positions');
      return [];
    }
  }

  /**
   * Check if position exists for symbol
   */
  async hasCoinMPosition(symbol: string): Promise<boolean> {
    const positions = await this.getCoinMPositions(symbol);
    return positions.some((pos: any) => pos.symbol === symbol.toUpperCase() && parseFloat(pos.total) > 0);
  }

  /**
   * Get COIN-M account balance
   */
  async getCoinMBalance(): Promise<{
    availableBalance: number;
    totalBalance: number;
    currency: string;
  }> {
    try {
      const response = await this.request('GET', '/api/v2/mix/account/accounts', {
        productType: 'COIN-FUTURES'
      }, true);

      if (response.code !== '00000') {
        throw new ExchangeError(`Failed to get balance: ${response.msg}`, 400);
      }

      // COIN-M uses BTC as margin coin
      const btcAccount = response.data.find((acc: any) => acc.marginCoin === 'BTC');
      if (!btcAccount) {
        throw new ExchangeError('BTC account not found in COIN-M', 404);
      }

      return {
        availableBalance: parseFloat(btcAccount.available || '0'),
        totalBalance: parseFloat(btcAccount.equity || '0'),
        currency: 'BTC'
      };
    } catch (error: any) {
      logger.error({ error }, 'Error getting COIN-M balance');
      throw error;
    }
  }
}
