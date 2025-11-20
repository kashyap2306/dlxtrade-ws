/**
 * CoinGlass Data Connector
 * Fetches funding rates, open interest, and liquidation data
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { apiUsageTracker } from '../apiUsageTracker';

export interface CoinGlassData {
  fundingRate?: number;
  openInterest?: number;
  openInterestChange24h?: number;
  liquidation24h?: number;
  longLiquidation24h?: number;
  shortLiquidation24h?: number;
  timestamp?: number;
}

export class CoinGlassConnector {
  private baseUrl = 'https://open-api.coinglass.com/public/v2';
  private httpClient: AxiosInstance;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: this.apiKey ? {
        'coinglassSecret': this.apiKey,
      } : {},
    });
  }

  /**
   * Get funding rate for a symbol
   */
  async getFundingRate(symbol: string): Promise<CoinGlassData> {
    try {
      // Map symbol format (BTCUSDT -> BTC)
      const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
      
      const response = await this.httpClient.get('/funding-rate', {
        params: {
          symbol: baseSymbol,
          type: 'futures',
        },
      });

      apiUsageTracker.increment('coinglass');

      const data = response.data?.data?.[0];
      if (!data) {
        return {};
      }

      return {
        fundingRate: data.fundingRate ? parseFloat(data.fundingRate) : undefined,
        openInterest: data.openInterest ? parseFloat(data.openInterest) : undefined,
        openInterestChange24h: data.openInterestChange24h ? parseFloat(data.openInterestChange24h) : undefined,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.warn({ error: error.message, symbol }, 'CoinGlass funding rate fetch failed');
      return {};
    }
  }

  /**
   * Get liquidation data
   */
  async getLiquidations(symbol: string): Promise<CoinGlassData> {
    try {
      const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
      
      const response = await this.httpClient.get('/liquidation', {
        params: {
          symbol: baseSymbol,
          timeType: '24h',
        },
      });

      apiUsageTracker.increment('coinglass');

      const data = response.data?.data;
      if (!data) {
        return {};
      }

      return {
        liquidation24h: data.totalLiquidation ? parseFloat(data.totalLiquidation) : undefined,
        longLiquidation24h: data.longLiquidation ? parseFloat(data.longLiquidation) : undefined,
        shortLiquidation24h: data.shortLiquidation ? parseFloat(data.shortLiquidation) : undefined,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.warn({ error: error.message, symbol }, 'CoinGlass liquidation fetch failed');
      return {};
    }
  }

  /**
   * Get open interest data
   */
  async getOpenInterest(symbol: string): Promise<CoinGlassData> {
    try {
      const baseSymbol = symbol.replace('USDT', '').replace('USD', '');
      
      const response = await this.httpClient.get('/open-interest', {
        params: {
          symbol: baseSymbol,
        },
      });

      apiUsageTracker.increment('coinglass');

      const data = response.data?.data?.[0];
      if (!data) {
        return {};
      }

      return {
        openInterest: data.openInterest ? parseFloat(data.openInterest) : undefined,
        openInterestChange24h: data.change24h ? parseFloat(data.change24h) : undefined,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.warn({ error: error.message, symbol }, 'CoinGlass open interest fetch failed');
      return {};
    }
  }

  /**
   * Get all derivatives data
   */
  async getAllDerivativesData(symbol: string): Promise<CoinGlassData> {
    try {
      const [funding, liquidations, oi] = await Promise.allSettled([
        this.getFundingRate(symbol),
        this.getLiquidations(symbol),
        this.getOpenInterest(symbol),
      ]);

      return {
        ...(funding.status === 'fulfilled' ? funding.value : {}),
        ...(liquidations.status === 'fulfilled' ? liquidations.value : {}),
        ...(oi.status === 'fulfilled' ? oi.value : {}),
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, symbol }, 'CoinGlass all data fetch failed');
      return {};
    }
  }
}

