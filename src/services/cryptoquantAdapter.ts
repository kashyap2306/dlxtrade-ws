import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { apiUsageTracker } from './apiUsageTracker';

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
  private httpClient: AxiosInstance | null = null;
  public disabled: boolean = false;

  constructor(apiKey: string) {
    // Validate API key - disable adapter if invalid (don't throw)
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '' || apiKey === 'undefined' || apiKey === 'null') {
      this.disabled = true;
      this.apiKey = '';
      logger.warn({ apiKeyProvided: !!apiKey, apiKeyType: typeof apiKey }, 'CryptoQuant API key missing or invalid - adapter disabled');
      return; // Don't throw - just disable adapter
    }
    
    this.apiKey = apiKey.trim();
    
    // Log API key status (for testing - shows if key is loaded, not the actual key)
    logger.info({ apiKeyLoaded: true, apiKeyLength: this.apiKey.length }, 'CryptoQuant API key loaded');
    
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
    
    logger.debug({ baseUrl: this.baseUrl, hasAuthHeader: true }, 'CryptoQuant HTTP client initialized');
  }

  async getExchangeFlow(symbol: string): Promise<CryptoQuantData> {
    // Skip if disabled
    if (this.disabled || !this.httpClient) {
      logger.warn('CryptoQuant adapter is disabled - cannot fetch exchange flow');
      return {};
    }
    
    // Verify API key is still valid before making request
    if (!this.apiKey || this.apiKey.trim() === '') {
      logger.warn('CryptoQuant API key is missing during getExchangeFlow call, returning empty data');
      return {}; // Return empty data instead of throwing
    }
    
    try {
      const url = '/exchange-flow';
      logger.debug({ url, symbol, hasApiKey: !!this.apiKey }, 'CryptoQuant getExchangeFlow request');
      
      const response = await this.httpClient.get(url, {
        params: {
          market: symbol,
          window: '1d',
        },
      });
      
      // Track API usage
      apiUsageTracker.increment('cryptoquant');
      logger.debug({ status: response.status, symbol }, 'CryptoQuant getExchangeFlow success');
      
      return {
        exchangeFlow: response.data?.net_flow || 0,
        exchangeInflow: response.data?.inflow || 0,
        exchangeOutflow: response.data?.outflow || 0,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const errorMessage = error.response?.data?.message || error.message;
      
      // Throw errors for proper failure handling in research engine
      if (status === 401) {
        logger.warn({
          status,
          statusText,
          errorMessage,
          symbol,
          hasApiKey: !!this.apiKey,
          apiKeyLength: this.apiKey?.length || 0,
        }, 'CryptoQuant 401 Unauthorized - Token does not exist or is invalid');
        throw new Error(`CryptoQuant API authentication failed: ${errorMessage}`);
      }

      logger.warn({ error: errorMessage, status, symbol }, 'CryptoQuant API error');
      throw new Error(`CryptoQuant API error: ${errorMessage}`);
    }
  }

  async getOnChainMetrics(symbol: string): Promise<CryptoQuantData> {
    // Skip if disabled
    if (this.disabled || !this.httpClient) {
      logger.warn('CryptoQuant adapter is disabled - cannot fetch on-chain metrics');
      return {};
    }
    
    // Verify API key is still valid before making request
    if (!this.apiKey || this.apiKey.trim() === '') {
      logger.warn('CryptoQuant API key is missing during getOnChainMetrics call, returning empty data');
      return {}; // Return empty data instead of throwing
    }
    
    try {
      const url = '/on-chain-metrics';
      logger.debug({ url, symbol, hasApiKey: !!this.apiKey }, 'CryptoQuant getOnChainMetrics request');
      
      const response = await this.httpClient.get(url, {
        params: {
          market: symbol,
        },
      });
      
      logger.debug({ status: response.status, symbol }, 'CryptoQuant getOnChainMetrics success');
      
      return {
        whaleTransactions: response.data?.whale_transactions || 0,
        activeAddresses: response.data?.active_addresses || 0,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const errorMessage = error.response?.data?.message || error.message;
      
      // Log 401 errors with details but don't throw - return empty data
      if (status === 401) {
        logger.warn({
          status,
          statusText,
          errorMessage,
          symbol,
          hasApiKey: !!this.apiKey,
          apiKeyLength: this.apiKey?.length || 0,
        }, 'CryptoQuant 401 Unauthorized - Token does not exist or is invalid');
        throw new Error(`CryptoQuant API authentication failed: ${errorMessage}`);
      }

      logger.warn({ error: errorMessage, status, symbol }, 'CryptoQuant on-chain API error');
      throw new Error(`CryptoQuant API error: ${errorMessage}`);
    }
  }

  /**
   * Get exchange reserves for a symbol
   */
  async getReserves(symbol: string): Promise<{ exchangeReserves?: number; reserveChange24h?: number }> {
    // Skip if disabled
    if (this.disabled || !this.httpClient) {
      logger.warn('CryptoQuant adapter is disabled - cannot fetch reserves');
      return {};
    }
    
    // Verify API key is still valid before making request
    if (!this.apiKey || this.apiKey.trim() === '') {
      logger.warn('CryptoQuant API key is missing during getReserves call, returning empty data');
      return {};
    }
    
    try {
      const url = '/exchange-reserves';
      logger.debug({ url, symbol, hasApiKey: !!this.apiKey }, 'CryptoQuant getReserves request');
      
      const response = await this.httpClient.get(url, {
        params: {
          market: symbol,
          window: '1d',
        },
      });
      
      apiUsageTracker.increment('cryptoquant');
      logger.debug({ status: response.status, symbol }, 'CryptoQuant getReserves success');
      
      return {
        exchangeReserves: response.data?.reserves || 0,
        reserveChange24h: response.data?.reserve_change_24h || 0,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorMessage = error.response?.data?.message || error.message;
      
      if (status === 401) {
        logger.warn({ status, errorMessage, symbol }, 'CryptoQuant 401 Unauthorized for reserves');
        throw new Error(`CryptoQuant API authentication failed: ${errorMessage}`);
      }

      logger.warn({ error: errorMessage, status, symbol }, 'CryptoQuant reserves API error');
      throw new Error(`CryptoQuant API error: ${errorMessage}`);
    }
  }
}

