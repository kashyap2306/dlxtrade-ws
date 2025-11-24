import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';

export interface CryptoQuantData {
  exchangeFlow?: number; // Exchange net flow
  exchangeInflow?: number;
  exchangeOutflow?: number;
  whaleTransactions?: number;
  activeAddresses?: number;
}

export class CryptoQuantAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.cryptoquant.com/v1';
  private httpClient: AxiosInstance;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
  }

  async getExchangeFlow(symbol: string): Promise<CryptoQuantData> {
    try {
      // Example endpoint - adjust based on actual CryptoQuant API
      const response = await this.httpClient.get('/exchange-flow', {
        params: {
          market: symbol,
          window: '1d',
        },
      });
      
      return {
        exchangeFlow: response.data?.net_flow || 0,
        exchangeInflow: response.data?.inflow || 0,
        exchangeOutflow: response.data?.outflow || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant API error (non-critical)');
      // Return empty data on error - don't block research
      return {};
    }
  }

  async getOnChainMetrics(symbol: string): Promise<CryptoQuantData> {
    try {
      // Example endpoint - adjust based on actual CryptoQuant API
      const response = await this.httpClient.get('/on-chain-metrics', {
        params: {
          market: symbol,
        },
      });
      
      return {
        whaleTransactions: response.data?.whale_transactions || 0,
        activeAddresses: response.data?.active_addresses || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant on-chain API error (non-critical)');
      return {};
    }
  }
}

