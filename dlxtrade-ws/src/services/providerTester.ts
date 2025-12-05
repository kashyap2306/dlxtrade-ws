import axios from 'axios';
import { logger } from '../utils/logger';
import { API_PROVIDERS_CONFIG } from '../config/apiProviders';

export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
}

export class ProviderTester {
  /**
   * Test a provider connection with a lightweight ping request
   */
  static async testProvider(
    providerName: string,
    type: 'marketData' | 'news' | 'metadata',
    apiKey?: string
  ): Promise<ProviderTestResult> {
    const startTime = Date.now();

    try {
      logger.info({ providerName, type }, 'Testing provider connection');

      // Find provider config
      const providerConfig = API_PROVIDERS_CONFIG[type].primary.id === this.getProviderId(providerName)
        ? API_PROVIDERS_CONFIG[type].primary
        : API_PROVIDERS_CONFIG[type].backups.find(p => p.id === this.getProviderId(providerName));

      if (!providerConfig) {
        return {
          success: false,
          latencyMs: Date.now() - startTime,
          message: `Provider ${providerName} not found in configuration`
        };
      }

      // Execute test based on provider type
      const result = await this.executeProviderTest(providerConfig, type, apiKey);

      const latency = Date.now() - startTime;
      logger.info({ providerName, type, success: result.success, latency }, 'Provider test completed');

      return {
        success: result.success,
        latencyMs: latency,
        message: result.message
      };

    } catch (error: any) {
      const latency = Date.now() - startTime;
      logger.error({ providerName, type, error: error.message }, 'Provider test failed');

      return {
        success: false,
        latencyMs: latency,
        message: `Connection failed: ${error.message}`
      };
    }
  }

  /**
   * Map provider name to provider ID
   */
  private static getProviderId(providerName: string): string {
    const nameMap: Record<string, string> = {
      // Market Data Providers
      'CoinGecko': 'coingecko',
      'BraveNewCoin': 'bravenewcoin',
      'CoinAPI': 'coinapi',
      'CoinCheckup': 'coincheckup',
      'CoinLore': 'coinlore',
      'CoinMarketCap': 'coinmarketcap',
      'CoinPaprika': 'coinpaprika',
      'CoinStats': 'coinstats',
      'Kaiko': 'kaiko',
      'LiveCoinWatch': 'livecoinwatch',
      'Messari': 'messari',
      // News Providers
      'NewsData.io': 'newsdataio',
      'BingNews': 'bingnews',
      'ContextualWeb': 'contextualweb',
      'CryptoPanic': 'cryptopanic',
      'GNews': 'gnews',
      'MediaStack': 'mediastack',
      'NewsCatcher': 'newscatcher',
      'Reddit': 'reddit',
      'Webz.io': 'webzio',
      'YahooNews': 'yahoonews',
      // Metadata Providers
      'CryptoCompare': 'cryptocompare',
      'CoinCap': 'coincap',
      'CoinRanking': 'coinranking',
      'Nomics': 'nomics'
    };

    return nameMap[providerName] || providerName.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Execute specific test based on provider type
   */
  private static async executeProviderTest(
    providerConfig: any,
    type: 'marketData' | 'news' | 'metadata',
    apiKey?: string
  ): Promise<{ success: boolean; message: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Add API key if required
    if (providerConfig.apiKeyRequired && apiKey) {
      // Different providers use different header names
      if (providerConfig.id === 'coinmarketcap') {
        headers['X-CMC_PRO_API_KEY'] = apiKey;
      } else if (providerConfig.id === 'cryptocompare') {
        headers['authorization'] = `Apikey ${apiKey}`;
      } else if (providerConfig.id === 'newsdataio') {
        headers['X-ACCESS-KEY'] = apiKey;
      } else {
        headers['X-API-Key'] = apiKey;
      }
    }

    try {
      switch (type) {
        case 'marketData':
          return await this.testMarketDataProvider(providerConfig, headers);

        case 'news':
          return await this.testNewsProvider(providerConfig, headers);

        case 'metadata':
          return await this.testMetadataProvider(providerConfig, headers);

        default:
          return { success: false, message: 'Unknown provider type' };
      }
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Test market data provider by fetching BTC ticker
   */
  private static async testMarketDataProvider(
    providerConfig: any,
    headers: Record<string, string>
  ): Promise<{ success: boolean; message: string }> {
    const testUrl = `${providerConfig.url}/tickers`;

    // Customize URL for different providers
    let finalUrl = testUrl;
    if (providerConfig.id === 'coingecko') {
      finalUrl = `${providerConfig.url}/simple/price?ids=bitcoin&vs_currencies=usd`;
    } else if (providerConfig.id === 'coinmarketcap') {
      finalUrl = `${providerConfig.url}/v1/cryptocurrency/quotes/latest?id=1`;
    } else if (providerConfig.id === 'coinpaprika') {
      finalUrl = `${providerConfig.url}/tickers/BTC-bitcoin`;
    }

    const response = await axios.get(finalUrl, { headers, timeout: 10000 });

    if (response.status === 200 && response.data) {
      return { success: true, message: 'Market data connection successful' };
    }

    return { success: false, message: 'Invalid response from market data provider' };
  }

  /**
   * Test news provider by making a lightweight search request
   */
  private static async testNewsProvider(
    providerConfig: any,
    headers: Record<string, string>
  ): Promise<{ success: boolean; message: string }> {
    let testUrl = `${providerConfig.url}/news`;

    // Customize URL for different providers
    if (providerConfig.id === 'newsdataio') {
      testUrl = `${providerConfig.url}/news?apikey=${headers['X-ACCESS-KEY']}&q=crypto&language=en&size=1`;
      delete headers['X-ACCESS-KEY']; // Already in URL
    } else if (providerConfig.id === 'gnews') {
      testUrl = `${providerConfig.url}/top-headlines?q=crypto&token=demo&max=1`;
    } else if (providerConfig.id === 'reddit') {
      testUrl = 'https://www.reddit.com/r/cryptocurrency/hot.json?limit=1';
    }

    const response = await axios.get(testUrl, { headers, timeout: 10000 });

    if (response.status === 200 && response.data) {
      return { success: true, message: 'News provider connection successful' };
    }

    return { success: false, message: 'Invalid response from news provider' };
  }

  /**
   * Test metadata provider by fetching basic coin info
   */
  private static async testMetadataProvider(
    providerConfig: any,
    headers: Record<string, string>
  ): Promise<{ success: boolean; message: string }> {
    let testUrl = `${providerConfig.url}/coins`;

    // Customize URL for different providers
    if (providerConfig.id === 'cryptocompare') {
      testUrl = `${providerConfig.url}/data/coin/general?fsym=BTC&tsym=USD`;
    } else if (providerConfig.id === 'coingecko') {
      testUrl = `${providerConfig.url}/coins/bitcoin`;
    } else if (providerConfig.id === 'coinmarketcap') {
      testUrl = `${providerConfig.url}/v1/cryptocurrency/info?id=1`;
    }

    const response = await axios.get(testUrl, { headers, timeout: 10000 });

    if (response.status === 200 && response.data) {
      return { success: true, message: 'Metadata provider connection successful' };
    }

    return { success: false, message: 'Invalid response from metadata provider' };
  }
}
