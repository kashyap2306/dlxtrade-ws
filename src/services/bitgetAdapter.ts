import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { ExchangeError } from '../utils/errors';
import { apiUsageTracker } from './apiUsageTracker';
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
        'ACCESS-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  getExchangeName(): ExchangeName {
    return 'bitget';
  }

  private sign(timestamp: string, method: string, requestPath: string, body: string = ''): string {
    const message = timestamp + method + requestPath + body;
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
    const timestamp = Date.now().toString();
    let body = '';
    
    if (method === 'GET') {
      const queryString = Object.keys(params)
        .map((key) => `${key}=${encodeURIComponent(params[key])}`)
        .join('&');
      endpoint = queryString ? `${endpoint}?${queryString}` : endpoint;
    } else {
      body = JSON.stringify(params);
    }

    const headers: any = {
      'ACCESS-KEY': this.apiKey,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.passphrase,
      'Content-Type': 'application/json',
    };

    if (signed) {
      const signature = this.sign(timestamp, method, endpoint, body);
      headers['ACCESS-SIGN'] = signature;
    }

    try {
      const response = await this.httpClient.request({
        method,
        url: endpoint,
        data: method !== 'GET' ? body : undefined,
        headers,
      });
      // Track API usage
      apiUsageTracker.increment('bitget');
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
    const data = await this.request('GET', '/api/mix/v1/market/depth', {
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
      lastUpdateId: data.data?.ts || Date.now(),
    };
  }

  async getTicker(symbol?: string): Promise<any> {
    if (symbol) {
      const data = await this.request('GET', '/api/mix/v1/market/ticker', {
        symbol: symbol.toUpperCase(),
      });
      return data.data;
    } else {
      // Get all tickers - Bitget uses allTicker endpoint
      const data = await this.request('GET', '/api/mix/v1/market/allTicker', {});
      return data.data || [];
    }
  }

  /**
   * Convert timeframe string to Bitget granularity (seconds)
   * 1m → 60, 5m → 300, 15m → 900, 1h → 3600, etc.
   */
  private timeframeToGranularity(timeframe: string): number {
    const tf = timeframe.toLowerCase().trim();
    const mapping: Record<string, number> = {
      '1m': 60,
      '3m': 180,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '1h': 3600,
      '2h': 7200,
      '4h': 14400,
      '6h': 21600,
      '8h': 28800,
      '12h': 43200,
      '1d': 86400,
      '3d': 259200,
      '1w': 604800,
      '1M': 2592000,
    };
    
    if (mapping[tf]) {
      return mapping[tf];
    }
    
    // Try to parse if it's in format like "5m", "1h"
    const match = tf.match(/^(\d+)([mhdwM])$/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      const multipliers: Record<string, number> = {
        'm': 60,
        'h': 3600,
        'd': 86400,
        'w': 604800,
        'M': 2592000,
      };
      if (multipliers[unit]) {
        return value * multipliers[unit];
      }
    }
    
    // Default to 1 minute if unknown
    logger.warn({ timeframe }, 'Unknown Bitget timeframe, defaulting to 60 seconds');
    return 60;
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const logs: string[] = [];
    logs.push('1) BITGET KLINES CALLED');
    logs.push(`2) original timeframe: ${interval}`);
    let granularity: number = 60;
    const granularityMap: Record<string, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400
    };
    if (granularityMap[interval]) {
      granularity = granularityMap[interval];
    }
    logs.push(`3) final granularity sent: ${granularity}`);
    
    // Map symbol for spot: BTCUSDT -> BTCUSDT_SPBL
    const finalSymbol = `${symbol.toUpperCase().replace('-', '')}_SPBL`;
    const endpoint = '/api/spot/v1/market/candles';
    const finalUrl = `${this.baseUrl}${endpoint}?symbol=${finalSymbol}&granularity=${granularity}&limit=${limit}`;
    logs.push(`4) final URL sent: ${finalUrl}`);
    let candles: any[] = [];
    try {
      const data = await this.request('GET', endpoint, {
        symbol: finalSymbol,
        granularity: granularity.toString(),
        limit: limit.toString(),
      });
      const rawResponse = JSON.stringify(data);
      logs.push(`5) raw response body: ${rawResponse}`);
      if (Array.isArray(data.data)) {
        candles = data.data.map((x: any[]) => ({
          timestamp: parseInt(x[0]),
          open: parseFloat(x[1]),
          high: parseFloat(x[2]),
          low: parseFloat(x[3]),
          close: parseFloat(x[4]),
          volume: parseFloat(x[5])
        }));
      }
      logs.push(`7) candles.length after parsing: ${candles.length}`);
      return candles;
    } catch (error: any) {
      logs.push(`6) error (if any): ${error && error.message ? error.message : String(error)}`);
      throw error;
    } finally {
      // Only these 7 logs!
      console.log(logs.join('\n'));
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test with account info endpoint
      const response = await this.request('GET', '/api/mix/v1/account/accounts', {}, true);
      if (response.code === '00000' || response.data) {
        return { success: true, message: 'Connection successful' };
      }
      return { success: false, message: response.msg || 'Connection test failed' };
    } catch (error: any) {
      const message = error.message || 'Connection test failed';
      if (message.includes('401') || message.includes('Unauthorized')) {
        return { success: false, message: 'Invalid API key or secret' };
      }
      if (message.includes('passphrase')) {
        return { success: false, message: 'Invalid passphrase' };
      }
      return { success: false, message };
    }
  }

  async getAccount(): Promise<any> {
    try {
      return await this.request('GET', '/api/mix/v1/account/accounts', {}, true);
    } catch (error: any) {
      logger.error({ error }, 'Error getting Bitget account');
      return { error: error.message || 'Failed to get account' };
    }
  }

  /**
   * Get funding rate for futures symbol
   */
  async getFundingRate(symbol: string): Promise<{ fundingRate: number; nextFundingTime?: number } | null> {
    try {
      const futuresSymbol = symbol.replace('USDT', 'USDT');
      const data = await this.request('GET', '/api/mix/v1/market/current-fundRate', {
        symbol: futuresSymbol,
      });
      
      return {
        fundingRate: parseFloat(data.data?.fundingRate || '0'),
        nextFundingTime: data.data?.nextSettleTime ? parseInt(data.data.nextSettleTime) : undefined,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'Bitget funding rate fetch failed (non-critical)');
      return null;
    }
  }

  /**
   * Get open interest for futures symbol
   */
  async getOpenInterest(symbol: string): Promise<{ openInterest: number; openInterestValue: number } | null> {
    try {
      const futuresSymbol = symbol.replace('USDT', 'USDT');
      const data = await this.request('GET', '/api/mix/v1/market/open-interest', {
        symbol: futuresSymbol,
      });
      
      return {
        openInterest: parseFloat(data.data?.amount || '0'),
        openInterestValue: parseFloat(data.data?.amount || '0') * parseFloat(data.data?.price || '0'),
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'Bitget open interest fetch failed (non-critical)');
      return null;
    }
  }

  /**
   * Get liquidations for futures symbol (24h)
   */
  async getLiquidations(symbol: string, since?: number): Promise<{ longLiquidation24h: number; shortLiquidation24h: number; totalLiquidation24h: number } | null> {
    try {
      // Bitget liquidation endpoint
      const futuresSymbol = symbol.replace('USDT', 'USDT');
      const endTime = since ? since + (24 * 60 * 60 * 1000) : Date.now();
      const startTime = since || (Date.now() - 24 * 60 * 60 * 1000);
      
      const data = await this.request('GET', '/api/mix/v1/market/liquidation', {
        symbol: futuresSymbol,
        startTime: startTime.toString(),
        endTime: endTime.toString(),
      });
      
      let longLiq = 0;
      let shortLiq = 0;
      
      if (data.data && Array.isArray(data.data)) {
        data.data.forEach((liq: any) => {
          const qty = parseFloat(liq.size || '0');
          const price = parseFloat(liq.price || '0');
          const value = qty * price;
          
          if (liq.side === 'sell') {
            longLiq += value;
          } else if (liq.side === 'buy') {
            shortLiq += value;
          }
        });
      }
      
      return {
        longLiquidation24h: longLiq,
        shortLiquidation24h: shortLiq,
        totalLiquidation24h: longLiq + shortLiq,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'Bitget liquidations fetch failed (non-critical)');
      return null;
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

      const response = await this.request('POST', '/api/mix/v1/order/placeOrder', orderParams, true);
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

