import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger';
import { extractAdapterError, AdapterError } from '../utils/adapterErrorHandler';

export interface CryptoQuantData {
  // Exchange Reserve
  exchangeReserve?: number;
  
  // Miner Reserve
  minerReserve?: number;
  
  // Stablecoin Supply
  stablecoinSupply?: number;
  usdtSupply?: number;
  usdcSupply?: number;
  
  // Netflow
  netflow?: number;
  exchangeInflow?: number;
  exchangeOutflow?: number;
  exchangeFlow?: number; // Alias for netflow
  
  // Long/Short Ratio
  longShortRatio?: number;
  longRatio?: number;
  shortRatio?: number;
  
  // Futures OI (Open Interest)
  futuresOI?: number;
  openInterest?: number;
  
  // Funding Rate
  fundingRate?: number;
  fundingRate24h?: number;
  
  // Whale Transactions
  whaleTransactions?: number;
  whaleTransactionCount?: number;
  whaleTransactionVolume?: number;
  
  // Liquidation Data
  liquidationLong?: number;
  liquidationShort?: number;
  liquidationTotal?: number;
  
  // Active Addresses
  activeAddresses?: number;
}

export class CryptoQuantAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.cryptoquant.com/v1';
  private httpClient: AxiosInstance;
  private disabled: boolean;

  constructor(apiKey: string) {
    // Validate API key - throw clear error if missing
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim() === '' || apiKey === 'undefined' || apiKey === 'null') {
      this.disabled = true;
      this.apiKey = '';
      const errorMsg = 'CryptoQuant API key missing or invalid';
      logger.error({ apiKeyProvided: !!apiKey, apiKeyType: typeof apiKey }, errorMsg);
      throw new Error(errorMsg);
    }

    this.disabled = false;
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

  // Get Exchange Reserve
  async getExchangeReserve(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
    const url = `${this.baseUrl}/btc/network-data/exchange-reserve`;
    
    try {
      // Log request details
      logger.debug({ 
        adapter: 'CryptoQuant', 
        method: 'getExchangeReserve', 
        url, 
        symbol,
        headers: { Authorization: 'Bearer ***' } // Redact API key
      }, 'CryptoQuant request: getExchangeReserve');
      
      const response = await this.httpClient.get(`/btc/network-data/exchange-reserve`, {
        params: {
          market: coinSymbol,
        },
      });
      
      // Log successful response
      logger.debug({ 
        adapter: 'CryptoQuant', 
        method: 'getExchangeReserve', 
        status: response.status,
        symbol 
      }, 'CryptoQuant response: getExchangeReserve success');
      
      return {
        exchangeReserve: response.data?.result?.value || 0,
      };
    } catch (error: any) {
      // Extract detailed error information
      const errorDetails = extractAdapterError('CryptoQuant', 'getExchangeReserve', url, error);
      
      // Log full error details
      logger.error({
        adapter: 'CryptoQuant',
        method: 'getExchangeReserve',
        url,
        symbol,
        statusCode: errorDetails.statusCode,
        statusText: errorDetails.statusText,
        responseSnippet: errorDetails.responseSnippet?.substring(0, 500),
        errorMessage: errorDetails.errorMessage,
        isAuthError: errorDetails.isAuthError,
      }, 'CryptoQuant getExchangeReserve error');
      
      // Throw adapter-specific error
      throw new AdapterError(errorDetails);
    }
  }

  // Get Miner Reserve
  async getMinerReserve(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get(`/btc/network-data/miner-reserve`, {
        params: {
          market: coinSymbol,
        },
      });
      
      return {
        minerReserve: response.data?.result?.value || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant miner reserve error');
      return {};
    }
  }

  // Get Stablecoin Supply
  async getStablecoinSupply(symbol: string = 'USDT'): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const response = await this.httpClient.get(`/stablecoins/supply`, {
        params: {
          market: symbol,
        },
      });
      
      return {
        stablecoinSupply: response.data?.total_supply || 0,
        usdtSupply: response.data?.usdt_supply || 0,
        usdcSupply: response.data?.usdc_supply || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant stablecoin supply error');
      return {};
    }
  }

  // Get Netflow
  async getExchangeFlow(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      logger.warn('CryptoQuant adapter is disabled - cannot fetch exchange flow');
      return {};
    }

    // Verify API key is still valid before making request
    if (!this.apiKey || this.apiKey.trim() === '') {
      logger.error('CryptoQuant API key is missing during getExchangeFlow call');
      throw new Error('CryptoQuant API key missing');
    }

    const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
    const url = `${this.baseUrl}/btc/network-data/exchange-netflow`;
    
    try {
      logger.debug({ 
        adapter: 'CryptoQuant', 
        method: 'getExchangeFlow', 
        url, 
        symbol,
        hasApiKey: !!this.apiKey,
        apiKeyLength: this.apiKey.length,
      }, 'CryptoQuant request: getExchangeFlow');
      
      const response = await this.httpClient.get(`/btc/network-data/exchange-netflow`, {
        params: {
          market: coinSymbol,
          window: '1d',
        },
      });
      
      logger.debug({ 
        adapter: 'CryptoQuant', 
        method: 'getExchangeFlow', 
        status: response.status,
        symbol 
      }, 'CryptoQuant response: getExchangeFlow success');
      
      return {
        netflow: response.data?.result?.netflow || 0,
        exchangeFlow: response.data?.result?.netflow || 0,
        exchangeInflow: response.data?.result?.inflow || 0,
        exchangeOutflow: response.data?.result?.outflow || 0,
      };
    } catch (error: any) {
      const errorDetails = extractAdapterError('CryptoQuant', 'getExchangeFlow', url, error);
      
      logger.error({
        adapter: 'CryptoQuant',
        method: 'getExchangeFlow',
        url,
        symbol,
        statusCode: errorDetails.statusCode,
        statusText: errorDetails.statusText,
        responseSnippet: errorDetails.responseSnippet?.substring(0, 500),
        errorMessage: errorDetails.errorMessage,
        isAuthError: errorDetails.isAuthError,
      }, 'CryptoQuant getExchangeFlow error');
      
      throw new AdapterError(errorDetails);
    }
  }

  // Get Long/Short Ratio
  async getLongShortRatio(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const response = await this.httpClient.get(`/derivatives/ratio/long-short-ratio`, {
        params: {
          market: symbol,
        },
      });
      
      return {
        longShortRatio: response.data?.ratio || 0,
        longRatio: response.data?.long_ratio || 0,
        shortRatio: response.data?.short_ratio || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant long/short ratio error');
      return {};
    }
  }

  // Get Futures Open Interest
  async getFuturesOI(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const response = await this.httpClient.get(`/derivatives/oi/open-interest`, {
        params: {
          market: symbol,
        },
      });
      
      return {
        futuresOI: response.data?.open_interest || 0,
        openInterest: response.data?.open_interest || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant futures OI error');
      return {};
    }
  }

  // Get Funding Rate
  async getFundingRate(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const response = await this.httpClient.get(`/derivatives/funding-rate`, {
        params: {
          market: symbol,
        },
      });
      
      return {
        fundingRate: response.data?.funding_rate || 0,
        fundingRate24h: response.data?.funding_rate_24h || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant funding rate error');
      return {};
    }
  }

  // Get Whale Transactions
  async getWhaleTransactions(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
      const response = await this.httpClient.get(`/btc/network-data/whale-transactions`, {
        params: {
          market: coinSymbol,
        },
      });
      
      return {
        whaleTransactions: response.data?.count || 0,
        whaleTransactionCount: response.data?.count || 0,
        whaleTransactionVolume: response.data?.volume || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant whale transactions error');
      return {};
    }
  }

  // Get Liquidation Data
  async getLiquidationData(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    try {
      const response = await this.httpClient.get(`/derivatives/liquidation`, {
        params: {
          market: symbol,
        },
      });
      
      return {
        liquidationLong: response.data?.long_liquidation || 0,
        liquidationShort: response.data?.short_liquidation || 0,
        liquidationTotal: response.data?.total_liquidation || 0,
      };
    } catch (error: any) {
      logger.debug({ error, symbol }, 'CryptoQuant liquidation data error');
      return {};
    }
  }

  // Get Active Addresses
  async getActiveAddresses(symbol: string): Promise<CryptoQuantData> {
    // If adapter is disabled (no API key), return empty data immediately
    if (this.disabled) {
      return {};
    }

    const coinSymbol = symbol.replace('USDT', '').replace('USD', '');
    const url = `${this.baseUrl}/btc/network-data/active-addresses`;
    
    try {
      logger.debug({ 
        adapter: 'CryptoQuant', 
        method: 'getActiveAddresses', 
        url, 
        symbol 
      }, 'CryptoQuant request: getActiveAddresses');
      
      const response = await this.httpClient.get(`/btc/network-data/active-addresses`, {
        params: {
          market: coinSymbol,
        },
      });
      
      logger.debug({ 
        adapter: 'CryptoQuant', 
        method: 'getActiveAddresses', 
        status: response.status,
        symbol 
      }, 'CryptoQuant response: getActiveAddresses success');
      
      return {
        activeAddresses: response.data?.result?.value || 0,
      };
    } catch (error: any) {
      const errorDetails = extractAdapterError('CryptoQuant', 'getActiveAddresses', url, error);
      
      logger.error({
        adapter: 'CryptoQuant',
        method: 'getActiveAddresses',
        url,
        symbol,
        statusCode: errorDetails.statusCode,
        statusText: errorDetails.statusText,
        responseSnippet: errorDetails.responseSnippet?.substring(0, 500),
        errorMessage: errorDetails.errorMessage,
        isAuthError: errorDetails.isAuthError,
      }, 'CryptoQuant getActiveAddresses error');
      
      throw new AdapterError(errorDetails);
    }
  }

  // Comprehensive method to get all CryptoQuant data
  async getAllData(symbol: string): Promise<CryptoQuantData> {
    const results: CryptoQuantData = {};
    
    // Fetch all data in parallel
    const [
      exchangeReserve,
      minerReserve,
      stablecoinSupply,
      netflow,
      longShortRatio,
      futuresOI,
      fundingRate,
      whaleTransactions,
      liquidationData,
      activeAddresses,
    ] = await Promise.allSettled([
      this.getExchangeReserve(symbol),
      this.getMinerReserve(symbol),
      this.getStablecoinSupply(),
      this.getExchangeFlow(symbol),
      this.getLongShortRatio(symbol),
      this.getFuturesOI(symbol),
      this.getFundingRate(symbol),
      this.getWhaleTransactions(symbol),
      this.getLiquidationData(symbol),
      this.getActiveAddresses(symbol),
    ]);

    // Merge all results (only fulfilled promises)
    if (exchangeReserve.status === 'fulfilled') Object.assign(results, exchangeReserve.value);
    if (minerReserve.status === 'fulfilled') Object.assign(results, minerReserve.value);
    if (stablecoinSupply.status === 'fulfilled') Object.assign(results, stablecoinSupply.value);
    if (netflow.status === 'fulfilled') Object.assign(results, netflow.value);
    if (longShortRatio.status === 'fulfilled') Object.assign(results, longShortRatio.value);
    if (futuresOI.status === 'fulfilled') Object.assign(results, futuresOI.value);
    if (fundingRate.status === 'fulfilled') Object.assign(results, fundingRate.value);
    if (whaleTransactions.status === 'fulfilled') Object.assign(results, whaleTransactions.value);
    if (liquidationData.status === 'fulfilled') Object.assign(results, liquidationData.value);
    if (activeAddresses.status === 'fulfilled') Object.assign(results, activeAddresses.value);

    // Log any rejected promises (errors are already logged in individual methods)
    const rejected = [
      exchangeReserve, minerReserve, stablecoinSupply, netflow, longShortRatio,
      futuresOI, fundingRate, whaleTransactions, liquidationData, activeAddresses
    ].filter(r => r.status === 'rejected');
    
    if (rejected.length > 0) {
      logger.warn({ 
        adapter: 'CryptoQuant', 
        symbol, 
        rejectedCount: rejected.length,
        totalMethods: 10
      }, 'CryptoQuant getAllData: some methods failed');
    }

    return results;
  }

  // Legacy method for backward compatibility
  async getOnChainMetrics(symbol: string): Promise<CryptoQuantData> {
    // Verify API key is still valid before making request
    if (this.disabled || !this.apiKey || this.apiKey.trim() === '') {
      logger.error('CryptoQuant API key is missing during getOnChainMetrics call');
      throw new Error('CryptoQuant API key missing');
    }
    
    try {
      logger.debug({ symbol, hasApiKey: !!this.apiKey }, 'CryptoQuant getOnChainMetrics: calling getAllData');
      return await this.getAllData(symbol);
    } catch (error: any) {
      // If it's an AdapterError, rethrow it
      if (error instanceof AdapterError) {
        throw error;
      }
      // Otherwise, wrap it
      const url = `${this.baseUrl}/btc/network-data/*`;
      const errorDetails = extractAdapterError('CryptoQuant', 'getOnChainMetrics', url, error);
      throw new AdapterError(errorDetails);
    }
  }
}

