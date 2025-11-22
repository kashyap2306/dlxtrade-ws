import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface CoinAPIData {
  price?: number;
  volume24h?: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
  historicalData?: Array<{ time: string; price: number }>;
  exchangeRate?: number;
}

const PERIOD_ID_MAP: Record<string, string> = {
  '1m': '1MIN',
  '3m': '3MIN',
  '5m': '5MIN',
  '15m': '15MIN',
  '30m': '30MIN',
  '1h': '1HRS',
  '2h': '2HRS',
  '4h': '4HRS',
  '6h': '6HRS',
  '8h': '8HRS',
  '12h': '12HRS',
  '1d': '1DAY',
  '3d': '3DAY',
  '1w': '7DAY',
};

export class CoinAPIAdapter {
  private apiKey: string;
  private apiType: 'market' | 'flatfile' | 'exchangerate';
  private baseUrl: string;
  private httpClient: AxiosInstance;

  constructor(apiKey: string, apiType: 'market' | 'flatfile' | 'exchangerate') {
    this.apiKey = apiKey;
    this.apiType = apiType;
    
    // Base URLs for different CoinAPI types
    if (apiType === 'market') {
      this.baseUrl = 'https://rest.coinapi.io/v1';
    } else if (apiType === 'flatfile') {
      this.baseUrl = 'https://rest.coinapi.io/v1';
    } else {
      this.baseUrl = 'https://rest.coinapi.io/v1';
    }
    
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'X-CoinAPI-Key': this.apiKey,
      },
    });
  }

  async getMarketData(symbol: string): Promise<CoinAPIData> {
    if (this.apiType !== 'market') {
      return {};
    }
    
    try {
      // Map symbol to CoinAPI format (e.g., BTCUSDT -> BINANCE_SPOT_BTC_USDT)
      const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
      
      const response = await this.httpClient.get(`/quotes/current`, {
        params: {
          symbol_id: coinapiSymbol,
        },
      });
      
      const data = response.data?.[0];
      if (!data) {
        return {};
      }
      
      return {
        price: data.ask_price || data.bid_price || 0,
        volume24h: data.volume_24h || 0,
        priceChange24h: data.price_change_24h || 0,
        priceChangePercent24h: data.price_change_percent_24h || 0,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message;

      if (status === 401 || status === 403) {
        logger.warn({ status, errorMessage, symbol, apiType: this.apiType }, 'CoinAPI market API authentication failed');
        throw new Error(`CoinAPI market API authentication failed: ${errorMessage}`);
      }

      logger.warn({ error: errorMessage, status, symbol, apiType: this.apiType }, 'CoinAPI market API error');
      throw new Error(`CoinAPI market API error: ${errorMessage}`);
    }
  }

  async getHistoricalData(symbol: string, days: number = 7): Promise<CoinAPIData> {
    if (this.apiType !== 'flatfile') {
      return {};
    }
    
    try {
      const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
      const endTime = new Date().toISOString();
      const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      
      const response = await this.httpClient.get(`/ohlcv/${coinapiSymbol}/history`, {
        params: {
          period_id: '1DAY',
          time_start: startTime,
          time_end: endTime,
        },
      });
      
      const historicalData = (response.data || []).map((item: any) => ({
        time: item.time_period_start,
        price: item.price_close || 0,
      }));
      
      return {
        historicalData,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message;

      if (status === 401 || status === 403) {
        logger.warn({ status, errorMessage, symbol, apiType: this.apiType }, 'CoinAPI historical API authentication failed');
        throw new Error(`CoinAPI historical API authentication failed: ${errorMessage}`);
      }

      logger.warn({ error: errorMessage, status, symbol, apiType: this.apiType }, 'CoinAPI historical API error');
      throw new Error(`CoinAPI historical API error: ${errorMessage}`);
    }
  }

  async getExchangeRate(baseAsset: string, quoteAsset: string = 'USD'): Promise<CoinAPIData> {
    if (this.apiType !== 'exchangerate') {
      return {};
    }
    
    try {
      const response = await this.httpClient.get(`/exchangerate/${baseAsset}/${quoteAsset}`);
      
      return {
        exchangeRate: response.data?.rate || 0,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message;

      if (status === 401 || status === 403) {
        logger.warn({ status, errorMessage, baseAsset, quoteAsset, apiType: this.apiType }, 'CoinAPI exchange rate API authentication failed');
        throw new Error(`CoinAPI exchange rate API authentication failed: ${errorMessage}`);
      }

      logger.warn({ error: errorMessage, status, baseAsset, quoteAsset, apiType: this.apiType }, 'CoinAPI exchange rate API error');
      throw new Error(`CoinAPI exchange rate API error: ${errorMessage}`);
    }
  }

  /**
   * Get historical OHLCV data (for flatfile or market API)
   */
  async getHistoricalOHLCV(
    symbol: string,
    periodId: string = '1DAY',
    limit: number = 100
  ): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
    if (this.apiType !== 'market' && this.apiType !== 'flatfile') {
      return [];
    }
    
    try {
      const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
      const response = await this.httpClient.get(`/ohlcv/${coinapiSymbol}/history`, {
        params: {
          period_id: periodId,
          limit,
          time_end: new Date().toISOString(),
        },
      });
      
      return (response.data || []).map((item: any) => ({
        time: new Date(item.time_period_end || item.time_period_start || Date.now()).getTime(),
        open: parseFloat(item.price_open || '0'),
        high: parseFloat(item.price_high || '0'),
        low: parseFloat(item.price_low || '0'),
        close: parseFloat(item.price_close || '0'),
        volume: parseFloat(item.volume_traded || '0'),
      }));
    } catch (error: any) {
      logger.debug({ error, symbol, periodId, apiType: this.apiType }, 'CoinAPI historical OHLCV error (non-critical)');
      return [];
    }
  }

  async getKlines(
    symbol: string,
    timeframe: string = '5m',
    limit: number = 500
  ): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
    const periodId = PERIOD_ID_MAP[timeframe.toLowerCase()] || PERIOD_ID_MAP['5m'];
    return this.getHistoricalOHLCV(symbol, periodId, limit);
  }

  /**
   * Get orderbook L2 data (for market API)
   */
  async getOrderbook(symbol: string, depth: number = 20): Promise<{ bids: Array<{ price: string; quantity: string }>; asks: Array<{ price: string; quantity: string }> } | null> {
    if (this.apiType !== 'market') {
      return null;
    }
    
    try {
      const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
      
      const response = await this.httpClient.get(`/orderbooks/${coinapiSymbol}/current`, {
        params: {
          limit_levels: depth,
        },
      });
      
      const data = response.data?.[0];
      if (!data) {
        return null;
      }
      
      return {
        bids: (data.bids || []).map(([price, qty]: [string, string]) => ({ price, quantity: qty })),
        asks: (data.asks || []).map(([price, qty]: [string, string]) => ({ price, quantity: qty })),
      };
    } catch (error: any) {
      logger.debug({ error, symbol, apiType: this.apiType }, 'CoinAPI orderbook error (non-critical)');
      return null;
    }
  }
}

