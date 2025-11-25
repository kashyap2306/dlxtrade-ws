import { AdapterError, extractAdapterError } from '../utils/adapterErrorHandler';
import axios from 'axios';

export class CryptoCompareAdapter {
  private apiKey: string;
  private baseUrl = 'https://min-api.cryptocompare.com/data';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async getMarketData(symbol: string): Promise<any> {
    const url = `${this.baseUrl}/pricemultifull`;

    try {
      const response = await axios.get(url, {
        params: {
          fsyms: symbol.replace('USDT', ''),
          tsyms: 'USD',
          api_key: this.apiKey
        },
        timeout: 10000
      });

      if (response.status !== 200) {
        const errorDetails = extractAdapterError('CryptoCompare', 'GET', url, { response });
        throw new AdapterError(errorDetails);
      }

      const baseSymbol = symbol.replace('USDT', '');
      const data = response.data.RAW?.[baseSymbol]?.USD;

      return {
        price: data?.PRICE,
        volume24h: data?.VOLUME24HOUR,
        change24h: data?.CHANGEPCT24HOUR,
        marketCap: data?.MKTCAP,
        open: data?.OPEN24HOUR,
        high: data?.HIGH24HOUR,
        low: data?.LOW24HOUR,
        priceChangePercent24h: data?.CHANGEPCT24HOUR
      };
    } catch (error: any) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new AdapterError({
          adapter: 'CryptoCompare',
          method: 'GET',
          url: url,
          statusCode: error.response.status,
          errorMessage: 'Authentication failed - invalid API key',
          isAuthError: true
        });
      }

      const errorDetails = extractAdapterError('CryptoCompare', 'GET', url, error);
      throw new AdapterError(errorDetails);
    }
  }

  async getHistoricalOHLC(symbol: string, limit: number = 100): Promise<any[]> {
    const url = `${this.baseUrl}/histohour`;

    try {
      const response = await axios.get(url, {
        params: {
          fsym: symbol.replace('USDT', ''),
          tsym: 'USD',
          limit,
          api_key: this.apiKey
        },
        timeout: 15000
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.data.Data || [];
    } catch (error: any) {
      console.warn(`CryptoCompare historical data fetch failed for ${symbol}:`, error.message);
      return [];
    }
  }

  async getOHLCData(symbol: string): Promise<any> {
    const historicalData = await this.getHistoricalOHLC(symbol, 200); // Get 200 hours of data

    if (historicalData.length === 0) {
      return {
        ohlc: [],
        latest: null
      };
    }

    // Convert to OHLC format expected by indicators
    const ohlc = historicalData.map((item: any) => ({
      timestamp: item.time * 1000,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      volume: item.volumefrom
    }));

    const latest = historicalData[historicalData.length - 1];

    return {
      ohlc,
      latest: {
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volumefrom
      }
    };
  }
}
