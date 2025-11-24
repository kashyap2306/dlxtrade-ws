import axios, { AxiosInstance } from 'axios';
import { apiUsageTracker } from './apiUsageTracker';
import { logger } from '../utils/logger';
import type { Orderbook } from '../types';
import type { ExchangeConnector, ExchangeName } from './exchangeConnector';

/**
 * Lightweight adapter that uses Binance PUBLIC endpoints only.
 * Used when the user has no active exchange connections (fallback mode).
 */
export class BinancePublicAdapter implements ExchangeConnector {
  private readonly httpClient: AxiosInstance;
  private binanceSymbols: Set<string> = new Set();
  private symbolMapping: Record<string, string> = {};

  constructor(baseUrl: string = 'https://api.binance.com') {
    this.httpClient = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
    });
    this.initializeSymbolData();
  }

  private async initializeSymbolData() {
    try {
      // Initialize symbol mapping for common incorrect symbols
      this.symbolMapping = {
        'PYUSD': 'PYTHUSDT',
        'SUSDS': 'SUSDT',
        'FIGR_HELOC': 'FIGRUSDT',
        // Add more mappings as needed
      };

      // Fetch valid symbols from Binance
      const response = await this.httpClient.get('/api/v3/exchangeInfo');
      const symbols = response.data.symbols.map((s: any) => s.symbol.toUpperCase());
      this.binanceSymbols = new Set(symbols);
      logger.debug({ symbolCount: symbols.length }, 'Binance symbols loaded successfully');
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to load Binance symbols, will proceed without validation');
      // Continue without validation rather than failing
    }
  }

  private normalizeSymbol(symbol: string): string {
    const normalized = symbol.replace('-', '').toUpperCase();

    // Apply symbol mapping if needed
    if (this.symbolMapping[normalized]) {
      return this.symbolMapping[normalized];
    }

    return normalized;
  }

  private isValidSymbol(symbol: string): boolean {
    if (this.binanceSymbols.size === 0) {
      // If we couldn't load symbols, allow all requests (backward compatibility)
      return true;
    }

    const normalized = this.normalizeSymbol(symbol);
    return this.binanceSymbols.has(normalized);
  }

  getExchangeName(): ExchangeName {
    return 'binance';
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const finalSymbol = this.normalizeSymbol(symbol);

    if (!this.isValidSymbol(finalSymbol)) {
      logger.debug({ symbol, finalSymbol }, '[BinancePublicAdapter] Skipping invalid symbol for orderbook');
      throw new Error(`Invalid symbol: ${finalSymbol}`);
    }

    const params = { symbol: finalSymbol, limit: Math.min(Math.max(limit, 5), 1000) };
    try {
      const response = await this.httpClient.get('/api/v3/depth', { params });
      apiUsageTracker.increment('binance');
      const data = response.data;
      return {
        symbol: data.symbol || finalSymbol,
        bids: (data.bids || []).map(([price, quantity]: [string, string]) => ({ price, quantity })),
        asks: (data.asks || []).map(([price, quantity]: [string, string]) => ({ price, quantity })),
        lastUpdateId: data.lastUpdateId || Date.now(),
      };
    } catch (error: any) {
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getOrderbook failed');
      throw error;
    }
  }

  async getTicker(symbol?: string): Promise<any> {
    if (symbol) {
      const finalSymbol = this.normalizeSymbol(symbol);
      if (!this.isValidSymbol(finalSymbol)) {
        logger.debug({ symbol, finalSymbol }, '[BinancePublicAdapter] Skipping invalid symbol for ticker');
        throw new Error(`Invalid symbol: ${finalSymbol}`);
      }
      try {
        const params = { symbol: finalSymbol };
        const response = await this.httpClient.get('/api/v3/ticker/24hr', { params });
        apiUsageTracker.increment('binance');
        return response.data;
      } catch (error: any) {
        logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getTicker failed');
        throw error;
      }
    }

    // If no symbol provided, get all tickers
    try {
      const response = await this.httpClient.get('/api/v3/ticker/24hr');
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.warn({ error: error.message }, '[BinancePublicAdapter] getAllTickers failed');
      throw error;
    }
  }

  async getBookTicker(symbol: string): Promise<any> {
    const finalSymbol = this.normalizeSymbol(symbol);

    if (!this.isValidSymbol(finalSymbol)) {
      logger.debug({ symbol, finalSymbol }, '[BinancePublicAdapter] Skipping invalid symbol for book ticker');
      throw new Error(`Invalid symbol: ${finalSymbol}`);
    }

    try {
      const params = { symbol: finalSymbol };
      const response = await this.httpClient.get('/api/v3/ticker/bookTicker', { params });
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getBookTicker failed');
      throw error;
    }
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const finalSymbol = this.normalizeSymbol(symbol);

    if (!this.isValidSymbol(finalSymbol)) {
      logger.debug({ symbol, finalSymbol }, '[BinancePublicAdapter] Skipping invalid symbol for klines');
      throw new Error(`Invalid symbol: ${finalSymbol}`);
    }

    const params = {
      symbol: finalSymbol,
      interval,
      limit: Math.min(Math.max(limit, 1), 1000),
    };
    try {
      const response = await this.httpClient.get('/api/v3/klines', { params });
      apiUsageTracker.increment('binance');
      return response.data || [];
    } catch (error: any) {
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getKlines failed');
      throw error;
    }
  }

  async getVolatility(symbol: string): Promise<number | null> {
    const finalSymbol = this.normalizeSymbol(symbol);

    if (!this.isValidSymbol(finalSymbol)) {
      logger.debug({ symbol, finalSymbol }, '[BinancePublicAdapter] Skipping invalid symbol for volatility');
      return null;
    }

    try {
      // Fetch 5m candles for last 100 periods (about 8.3 hours)
      const candles = await this.getKlines(symbol, '5m', 100);
      if (!candles || candles.length < 10) {
        return null;
      }

      // Calculate log returns
      const returns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const prevClose = parseFloat(candles[i - 1][4]); // close price
        const currClose = parseFloat(candles[i][4]); // close price
        if (prevClose > 0 && currClose > 0) {
          const logReturn = Math.log(currClose / prevClose);
          if (Number.isFinite(logReturn)) {
            returns.push(logReturn);
          }
        }
      }

      if (returns.length < 10) {
        return null;
      }

      // Calculate standard deviation of returns
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
      const dailyVolatility = Math.sqrt(variance);

      // Annualize volatility: sqrt(1440/5) = sqrt(288) ≈ 16.97
      // This converts 5-minute volatility to daily volatility
      const annualizedVolatility = dailyVolatility * Math.sqrt(1440 / 5);

      return Number.isFinite(annualizedVolatility) ? annualizedVolatility : null;
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getVolatility failed');
      return null;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.httpClient.get('/api/v3/ping');
      return { success: true, message: 'Binance public API reachable' };
    } catch (error: any) {
      return { success: false, message: error.message || 'Binance public API unreachable' };
    }
  }
}


