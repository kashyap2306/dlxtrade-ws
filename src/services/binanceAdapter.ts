import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

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

export class BinancePublicAdapter {
  private httpClient: AxiosInstance;

  constructor() {
    // No API key required for public endpoints
    this.httpClient = axios.create({
      baseURL: 'https://api.binance.com/api/v3',
      timeout: 10000,
    });
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

  /**
   * Get klines/candlestick data - replaces CoinAPI market data for OHLCV
   */
  async getKlines(
    symbol: string,
    interval: string = '1m',
    limit: number = 500
  ): Promise<BinanceData> {
    try {
      // Map interval to Binance format
      const intervalMap: Record<string, string> = {
        '1m': '1m',
        '3m': '3m',
        '5m': '5m',
        '15m': '15m',
        '30m': '30m',
        '1h': '1h',
        '2h': '2h',
        '4h': '4h',
        '6h': '6h',
        '8h': '8h',
        '12h': '12h',
        '1d': '1d',
        '3d': '3d',
        '1w': '1w',
      };

      const binanceInterval = intervalMap[interval.toLowerCase()] || '5m';
      const binanceSymbol = symbol.toUpperCase();

      const response = await this.httpClient.get('/klines', {
        params: {
          symbol: binanceSymbol,
          interval: binanceInterval,
          limit: Math.min(limit, 1000) // Binance max is 1000
        }
      });

      const data = response.data || [];
      const klines = data.map((kline: any[]) => ({
        time: parseInt(kline[0]),
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
      }));

      return { klines };
    } catch (error: any) {
      logger.warn({
        error: error.message,
        status: error.response?.status,
        symbol,
        interval,
        limit
      }, 'Binance klines API error');
      return {};
    }
  }

  /**
   * Get orderbook depth - replaces CoinAPI orderbook
   */
  async getOrderbook(symbol: string, depth: number = 20): Promise<BinanceData> {
    try {
      const binanceSymbol = symbol.toUpperCase();

      const response = await this.httpClient.get('/depth', {
        params: {
          symbol: binanceSymbol,
          limit: Math.min(depth, 5000) // Binance max is 5000
        }
      });

      const data = response.data;
      if (!data) {
        return {};
      }

      return {
        orderbook: {
          bids: (data.bids || []).map(([price, qty]: [string, string]) => ({
            price,
            quantity: qty
          })),
          asks: (data.asks || []).map(([price, qty]: [string, string]) => ({
            price,
            quantity: qty
          })),
        }
      };
    } catch (error: any) {
      logger.warn({
        error: error.message,
        status: error.response?.status,
        symbol,
        depth
      }, 'Binance orderbook API error');
      return {};
    }
  }
}
