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


  getExchangeName(): ExchangeName {
    return 'binance';
  }

  async getOrderbook(symbol: string, limit: number = 20): Promise<Orderbook> {
    const finalSymbol = this.normalizeSymbol(symbol);

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
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getOrderbook failed, using fallback');
      return {
        symbol: finalSymbol,
        bids: [],
        asks: [],
        lastUpdateId: 0,
        fallback: true
      };
    }
  }

  async getTicker(symbol?: string): Promise<any> {
    if (symbol) {
      const finalSymbol = this.normalizeSymbol(symbol);
      try {
        const params = { symbol: finalSymbol };
        const response = await this.httpClient.get('/api/v3/ticker/24hr', { params });
        apiUsageTracker.increment('binance');
        return response.data;
      } catch (error: any) {
        logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getTicker failed, using fallback');
        return {
          lastPrice: 0,
          volume: 0,
          priceChangePercent: 0,
          fallback: true
        };
      }
    }

    // If no symbol provided, get all tickers
    try {
      const response = await this.httpClient.get('/api/v3/ticker/24hr');
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.warn({ error: error.message }, '[BinancePublicAdapter] getAllTickers failed, using fallback');
      return [];
    }
  }

  async getBookTicker(symbol: string): Promise<any> {
    const finalSymbol = this.normalizeSymbol(symbol);

    try {
      const params = { symbol: finalSymbol };
      const response = await this.httpClient.get('/api/v3/ticker/bookTicker', { params });
      apiUsageTracker.increment('binance');
      return response.data;
    } catch (error: any) {
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getBookTicker failed, using fallback');
      return {
        symbol: finalSymbol,
        bidPrice: 0,
        askPrice: 0,
        fallback: true
      };
    }
  }

  async getKlines(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    const finalSymbol = this.normalizeSymbol(symbol);

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
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getKlines failed, using fallback');
      return [{
        time: Date.now(),
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
        fallback: true
      }];
    }
  }

  async getVolatility(symbol: string): Promise<number | null> {
    const finalSymbol = this.normalizeSymbol(symbol);

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
        return 0.05; // Fallback volatility (5%)
      }

      // Calculate standard deviation of returns
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
      const dailyVolatility = Math.sqrt(variance);

      // Annualize volatility: sqrt(1440/5) = sqrt(288) ≈ 16.97
      // This converts 5-minute volatility to daily volatility
      const annualizedVolatility = dailyVolatility * Math.sqrt(1440 / 5);

      return Number.isFinite(annualizedVolatility) ? annualizedVolatility : 0.05;
    } catch (error: any) {
      logger.warn({ symbol, error: error.message }, '[BinancePublicAdapter] getVolatility failed, using fallback');
      return 0.05; // Fallback volatility (5%)
    }
  }

  async getDerivativesData(symbol: string): Promise<{
    fundingRate?: number;
    openInterest?: number;
    longShortRatio?: { long: number; short: number; ratio: number };
    liquidationData?: { longLiquidations: number; shortLiquidations: number };
  }> {
    const finalSymbol = this.normalizeSymbol(symbol);

    try {
      // Get funding rate from futures API
      const fundingResponse = await this.httpClient.get('/fapi/v1/premiumIndex', {
        params: { symbol: finalSymbol }
      });
      apiUsageTracker.increment('binance_futures');

      if (fundingResponse.status !== 200) {
        logger.warn({ symbol: finalSymbol, status: fundingResponse.status, response: fundingResponse.data }, 'Binance futures funding rate API returned non-200');
      }

      const fundingRate = fundingResponse.data ? parseFloat(fundingResponse.data.lastFundingRate) : undefined;

      // Get open interest
      const oiResponse = await this.httpClient.get('/fapi/v1/openInterest', {
        params: { symbol: finalSymbol }
      });
      apiUsageTracker.increment('binance_futures');

      if (oiResponse.status !== 200) {
        logger.warn({ symbol: finalSymbol, status: oiResponse.status, response: oiResponse.data }, 'Binance futures open interest API returned non-200');
      }

      const openInterest = oiResponse.data ? parseFloat(oiResponse.data.openInterest) : undefined;

      // Get long/short ratio (top accounts) - this endpoint might not be available for all symbols
      let longShortRatio;
      try {
        const lsrResponse = await this.httpClient.get('/futures/data/topLongShortAccountRatio', {
          params: { symbol: finalSymbol, period: '1d', limit: 1 }
        });
        apiUsageTracker.increment('binance_futures');

        if (lsrResponse.status !== 200) {
          logger.warn({ symbol: finalSymbol, status: lsrResponse.status, response: lsrResponse.data }, 'Binance futures long/short ratio API returned non-200');
        } else if (lsrResponse.data && lsrResponse.data.length > 0) {
          const ratio = lsrResponse.data[0];
          longShortRatio = {
            long: parseFloat(ratio.longShortRatio),
            short: 100 - parseFloat(ratio.longShortRatio),
            ratio: parseFloat(ratio.longShortRatio)
          };
        }
      } catch (lsrError: any) {
        logger.warn({ symbol: finalSymbol, error: lsrError.message }, 'Binance futures long/short ratio API failed (endpoint may not be available)');
      }

      return {
        fundingRate,
        openInterest,
        longShortRatio
      };

    } catch (error: any) {
      logger.warn({
        symbol,
        finalSymbol,
        error: error.message,
        status: error.response?.status,
        response: error.response?.data
      }, '[BinancePublicAdapter] getDerivativesData failed, using fallback');

      return {
        fundingRate: undefined, // Mark as unavailable rather than fake value
        openInterest: undefined,
        longShortRatio: undefined
      };
    }
  }

  async getRVOL(symbol: string, lookbackDays: number = 7): Promise<{ rvol: number; isConfirmed: boolean; avgVolume: number }> {
    const finalSymbol = this.normalizeSymbol(symbol);

    try {
      // Get daily klines for the lookback period
      const dailyCandles = await this.getKlines(symbol, '1d', lookbackDays + 1);

      if (!dailyCandles || dailyCandles.length < 2) {
        return { rvol: 1.0, isConfirmed: false, avgVolume: 0 };
      }

      // Calculate volumes (skip the current incomplete day)
      const volumes = dailyCandles.slice(0, -1).map(candle => parseFloat(candle[5])); // volume is index 5
      const currentVolume = parseFloat(dailyCandles[dailyCandles.length - 1][5]);

      if (volumes.length === 0) {
        return { rvol: 1.0, isConfirmed: false, avgVolume: 0 };
      }

      // Calculate average volume
      const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;

      // Calculate RVOL
      const rvol = avgVolume > 0 ? currentVolume / avgVolume : 1.0;

      return {
        rvol: Number.isFinite(rvol) ? rvol : 1.0,
        isConfirmed: volumes.length >= 5, // Need at least 5 days of data
        avgVolume
      };

    } catch (error: any) {
      logger.warn({ symbol, finalSymbol, error: error.message }, '[BinancePublicAdapter] getRVOL failed, using fallback');
      return { rvol: 1.0, isConfirmed: false, avgVolume: 0 };
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


