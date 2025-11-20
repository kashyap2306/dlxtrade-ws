/**
 * IntoTheBlock Data Connector
 * Fetches on-chain metrics including whale movements and large transactions
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../utils/logger';
import { apiUsageTracker } from '../apiUsageTracker';

export interface IntoTheBlockData {
  largeTransactions?: number;
  whaleMovements?: number;
  exchangeInflow?: number;
  exchangeOutflow?: number;
  netFlow?: number;
  activeAddresses?: number;
  timestamp?: number;
}

export class IntoTheBlockConnector {
  private baseUrl = 'https://api.intotheblock.com';
  private httpClient: AxiosInstance;
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: this.apiKey ? {
        'X-API-Key': this.apiKey,
      } : {},
    });
  }

  /**
   * Get large transactions (whale movements)
   */
  async getLargeTransactions(symbol: string): Promise<IntoTheBlockData> {
    try {
      // Map symbol to coin identifier (BTCUSDT -> BTC)
      const coinId = symbol.replace('USDT', '').replace('USD', '').toLowerCase();
      
      // Note: IntoTheBlock API structure may vary - this is a template
      const response = await this.httpClient.get(`/coins/${coinId}/transactions/large`, {
        params: {
          timeFrame: '24h',
        },
      });

      apiUsageTracker.increment('intotheblock');

      const data = response.data?.data;
      if (!data) {
        return {};
      }

      return {
        largeTransactions: data.count || 0,
        whaleMovements: data.whaleCount || 0,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.warn({ error: error.message, symbol }, 'IntoTheBlock large transactions fetch failed');
      return {};
    }
  }

  /**
   * Get exchange flows
   */
  async getExchangeFlows(symbol: string): Promise<IntoTheBlockData> {
    try {
      const coinId = symbol.replace('USDT', '').replace('USD', '').toLowerCase();
      
      const response = await this.httpClient.get(`/coins/${coinId}/flows/exchange`, {
        params: {
          timeFrame: '24h',
        },
      });

      apiUsageTracker.increment('intotheblock');

      const data = response.data?.data;
      if (!data) {
        return {};
      }

      return {
        exchangeInflow: data.inflow ? parseFloat(data.inflow) : undefined,
        exchangeOutflow: data.outflow ? parseFloat(data.outflow) : undefined,
        netFlow: data.netFlow ? parseFloat(data.netFlow) : undefined,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.warn({ error: error.message, symbol }, 'IntoTheBlock exchange flows fetch failed');
      return {};
    }
  }

  /**
   * Get all on-chain data
   */
  async getAllOnChainData(symbol: string): Promise<IntoTheBlockData> {
    try {
      const [transactions, flows] = await Promise.allSettled([
        this.getLargeTransactions(symbol),
        this.getExchangeFlows(symbol),
      ]);

      return {
        ...(transactions.status === 'fulfilled' ? transactions.value : {}),
        ...(flows.status === 'fulfilled' ? flows.value : {}),
        timestamp: Date.now(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, symbol }, 'IntoTheBlock all data fetch failed');
      return {};
    }
  }
}

