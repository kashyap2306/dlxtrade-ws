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

      return {
        price: response.data.RAW?.[symbol.replace('USDT', '')]?.USD?.PRICE,
        volume24h: response.data.RAW?.[symbol.replace('USDT', '')]?.USD?.VOLUME24HOUR,
        change24h: response.data.RAW?.[symbol.replace('USDT', '')]?.USD?.CHANGEPCT24HOUR,
        marketCap: response.data.RAW?.[symbol.replace('USDT', '')]?.USD?.MKTCAP
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
}
