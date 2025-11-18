import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface CoinAPIData {
  // Market Data API
  price?: number;
  volume24h?: number;
  priceChange24h?: number;
  priceChangePercent24h?: number;
  volume?: number;
  trades?: number;
  quotes?: Array<{ bid: number; ask: number; time: string }>;
  exchangeMetadata?: any;
  
  // Exchange Rate API
  exchangeRate?: number;
  btcRate?: number;
  usdtRate?: number;
  inrRate?: number;
  multiPairRates?: Record<string, number>;
  normalizedPrice?: number;
  
  // Flat Files API (Historical OHLCV)
  historicalData?: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  ohlcvData?: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
  ma50?: number;
  ma200?: number;
}

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

  // Market Data API Methods
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
        volume: data.volume_24h || 0,
        priceChange24h: data.price_change_24h || 0,
        priceChangePercent24h: data.price_change_percent_24h || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol, apiType: this.apiType }, 'CoinAPI market API error (non-critical)');
      return {};
    }
  }

  async getOHLCV(symbol: string, period: string = '1HRS', limit: number = 100): Promise<CoinAPIData> {
    if (this.apiType !== 'market') {
      return {};
    }
    
    try {
      const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
      const response = await this.httpClient.get(`/ohlcv/${coinapiSymbol}/latest`, {
        params: {
          period_id: period,
          limit,
        },
      });
      
      const ohlcvData = (response.data || []).map((item: any) => ({
        time: item.time_period_start,
        open: item.price_open || 0,
        high: item.price_high || 0,
        low: item.price_low || 0,
        close: item.price_close || 0,
        volume: item.volume_traded || 0,
      }));
      
      return {
        ohlcvData,
        historicalData: ohlcvData,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CoinAPI OHLCV error');
      return {};
    }
  }

  async getTrades(symbol: string, limit: number = 50): Promise<CoinAPIData> {
    if (this.apiType !== 'market') {
      return {};
    }
    
    try {
      const coinapiSymbol = `BINANCE_SPOT_${symbol.replace('USDT', '_USDT')}`;
      const response = await this.httpClient.get(`/trades/${coinapiSymbol}/latest`, {
        params: { limit },
      });
      
      return {
        trades: response.data?.length || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CoinAPI trades error');
      return {};
    }
  }

  async getQuotes(symbol: string): Promise<CoinAPIData> {
    if (this.apiType !== 'market') {
      return {};
    }
    
    try {
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
        quotes: [{
          bid: data.bid_price || 0,
          ask: data.ask_price || 0,
          time: data.time || new Date().toISOString(),
        }],
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CoinAPI quotes error');
      return {};
    }
  }

  async getExchangeMetadata(): Promise<CoinAPIData> {
    if (this.apiType !== 'market') {
      return {};
    }
    
    try {
      const response = await this.httpClient.get(`/exchanges`);
      return {
        exchangeMetadata: response.data || {},
      };
    } catch (error: any) {
      logger.debug({ error }, 'CoinAPI exchange metadata error');
      return {};
    }
  }

  // Flat Files API Methods (Historical OHLCV for MA calculations)
  async getHistoricalData(symbol: string, days: number = 180): Promise<CoinAPIData> {
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
        open: item.price_open || 0,
        high: item.price_high || 0,
        low: item.price_low || 0,
        close: item.price_close || 0,
        volume: item.volume_traded || 0,
      }));
      
      // Calculate MA50 and MA200 from historical data
      const closes = historicalData.map(d => d.close).filter(p => p > 0);
      let ma50 = 0;
      let ma200 = 0;
      
      if (closes.length >= 50) {
        ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      }
      if (closes.length >= 200) {
        ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
      } else if (closes.length > 0) {
        ma200 = closes.reduce((a, b) => a + b, 0) / closes.length;
      }
      
      return {
        historicalData,
        ohlcvData: historicalData,
        ma50,
        ma200,
      };
    } catch (error: any) {
      logger.debug({ error, symbol, apiType: this.apiType }, 'CoinAPI historical API error (non-critical)');
      return {};
    }
  }

  // Get 6 months of OHLCV data for MA calculations
  async get6MonthsOHLCV(symbol: string): Promise<CoinAPIData> {
    return this.getHistoricalData(symbol, 180);
  }

  // Exchange Rate API Methods
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
      logger.debug({ error, baseAsset, quoteAsset, apiType: this.apiType }, 'CoinAPI exchange rate API error (non-critical)');
      return {};
    }
  }

  async getBTCRate(quoteAsset: string = 'USDT'): Promise<CoinAPIData> {
    return this.getExchangeRate('BTC', quoteAsset);
  }

  async getUSDTRate(quoteAsset: string = 'USD'): Promise<CoinAPIData> {
    return this.getExchangeRate('USDT', quoteAsset);
  }

  async getINRRate(baseAsset: string = 'BTC'): Promise<CoinAPIData> {
    return this.getExchangeRate(baseAsset, 'INR');
  }

  async getMultiPairRates(pairs: Array<{ base: string; quote: string }>): Promise<CoinAPIData> {
    if (this.apiType !== 'exchangerate') {
      return {};
    }
    
    try {
      const rates: Record<string, number> = {};
      
      await Promise.all(
        pairs.map(async (pair) => {
          try {
            const rateData = await this.getExchangeRate(pair.base, pair.quote);
            rates[`${pair.base}/${pair.quote}`] = rateData.exchangeRate || 0;
          } catch (err) {
            rates[`${pair.base}/${pair.quote}`] = 0;
          }
        })
      );
      
      return {
        multiPairRates: rates,
      };
    } catch (error: any) {
      logger.debug({ error }, 'CoinAPI multi-pair rates error');
      return {};
    }
  }

  async getNormalizedPrice(symbol: string): Promise<CoinAPIData> {
    if (this.apiType !== 'exchangerate') {
      return {};
    }
    
    try {
      // Get BTC rate and convert symbol price to normalized BTC price
      const btcRate = await this.getBTCRate('USDT');
      const symbolRate = await this.getExchangeRate(symbol.replace('USDT', ''), 'USDT');
      
      return {
        normalizedPrice: symbolRate.exchangeRate ? symbolRate.exchangeRate / (btcRate.exchangeRate || 1) : 0,
        btcRate: btcRate.exchangeRate,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CoinAPI normalized price error');
      return {};
    }
  }
}

