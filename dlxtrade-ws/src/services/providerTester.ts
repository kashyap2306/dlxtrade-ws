import { logger } from '../utils/logger';
import { API_PROVIDERS_CONFIG } from '../config/apiProviders';

export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  message: string;
  details?: any;
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
      'Cointelegraph RSS': 'cointelegraph',
      'AltcoinBuzz RSS': 'altcoinbuzz',
      'Marketaux': 'marketaux',
      'CoinStatsNews': 'coinstatsnews',
      'CryptoCompare News': 'cryptocomparenews',
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
    try {
      switch (type) {
        case 'marketData':
          return await this.testMarketDataProvider(providerConfig, apiKey);

        case 'news':
          return await this.testNewsProvider(providerConfig, apiKey);

        case 'metadata':
          return await this.testMetadataProvider(providerConfig, apiKey);

        default:
          return { success: false, message: 'Unknown provider type' };
      }
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Test market data provider by using the provider module
   */
  private static async testMarketDataProvider(
    providerConfig: any,
    apiKey?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Import the provider module dynamically
      const providerModule = await import(`../providers/marketData/${providerConfig.id}`);

      // Use the testConnection function if available
      if (providerModule.testConnection) {
        const result = await providerModule.testConnection(apiKey);
        return { success: result.ok, message: result.message || 'Test completed' };
      }

      // Fallback to fetchTicker if testConnection not available
      if (providerModule.fetchTicker) {
        const result = await providerModule.fetchTicker('BTC', { apiKey });
        return {
          success: result.ok,
          message: result.ok ? 'Market data connection successful' : (result.data?.error || 'Test failed')
        };
      }

      return { success: false, message: 'Provider module missing testConnection or fetchTicker function' };
    } catch (error: any) {
      return { success: false, message: `Provider module error: ${error.message}` };
    }
  }

  /**
   * Test news provider by using the provider module
   */
  private static async testNewsProvider(
    providerConfig: any,
    apiKey?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Import the provider module dynamically
      const providerModule = await import(`../providers/newsProviders/${providerConfig.id}`);

      // Use the testConnection function if available
      if (providerModule.testConnection) {
        const result = await providerModule.testConnection(apiKey);
        return { success: result.ok, message: result.message || 'Test completed' };
      }

      // For now, return a basic success for news providers that don't have testConnection
      // TODO: Implement fetchTicker equivalent for news providers
      return { success: true, message: 'News provider module loaded (test implementation pending)' };
    } catch (error: any) {
      return { success: false, message: `Provider module error: ${error.message}` };
    }
  }

  /**
   * Test metadata provider by using the provider module
   */
  private static async testMetadataProvider(
    providerConfig: any,
    apiKey?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Import the provider module dynamically
      const providerModule = await import(`../providers/metadataProviders/${providerConfig.id}`);

      // Use the testConnection function if available
      if (providerModule.testConnection) {
        const result = await providerModule.testConnection(apiKey);
        return { success: result.ok, message: result.message || 'Test completed' };
      }

      // For now, return a basic success for metadata providers that don't have testConnection
      // TODO: Implement fetchTicker equivalent for metadata providers
      return { success: true, message: 'Metadata provider module loaded (test implementation pending)' };
    } catch (error: any) {
      return { success: false, message: `Provider module error: ${error.message}` };
    }
  }
}
