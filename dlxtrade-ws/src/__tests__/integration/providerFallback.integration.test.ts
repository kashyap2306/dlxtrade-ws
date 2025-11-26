import { DeepResearchEngine } from '../../services/deepResearchEngine';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { apiUsageTracker } from '../../services/apiUsageTracker';
import { PROVIDER_PRIORITY_CONFIG } from '../../config/providerPriority';

// Mock external dependencies
jest.mock('../../services/firestoreAdapter');
jest.mock('../../services/apiUsageTracker');
jest.mock('../../services/cryptocompareAdapter');
jest.mock('../../services/cryptoPanicAdapter');
jest.mock('../../services/newsDataAdapter');
jest.mock('../../services/coinMarketCapAdapter');
jest.mock('../../services/googleFinanceAdapter');
jest.mock('../../services/binancepublicAdapter');
jest.mock('../../services/coingeckoAdapter');

const mockedFirestoreAdapter = firestoreAdapter as jest.Mocked<typeof firestoreAdapter>;
const mockedApiUsageTracker = apiUsageTracker as jest.Mocked<typeof apiUsageTracker>;

describe('Provider Fallback Integration Tests', () => {
  let deepResearchEngine: DeepResearchEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    deepResearchEngine = new DeepResearchEngine();

    // Mock user integrations - all enabled
    mockedFirestoreAdapter.getEnabledIntegrations.mockResolvedValue({
      cryptocompare: { enabled: true, apiKey: 'test-key' },
      cryptopanic: { enabled: true, apiKey: 'test-key' },
      coinmarketcap: { enabled: true, apiKey: 'test-key' },
      googlefinance: { enabled: true },
      binancepublic: { enabled: true },
      coingecko: { enabled: true }
    } as any);

    // Mock API usage tracker
    mockedApiUsageTracker.recordUsage.mockResolvedValue(undefined);
    mockedApiUsageTracker.getHourlyUsage.mockReturnValue(0);
    mockedApiUsageTracker.isProviderExhaustedForUser.mockReturnValue(false);
  });

  describe('429 Rate Limiting Fallback', () => {
    it('should fallback gracefully when primary provider returns 429', async () => {
      // Mock CryptoCompare (primary for historical) to return 429
      const { CryptoCompareAdapter } = require('../../services/cryptocompareAdapter');
      CryptoCompareAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockRejectedValue({
          response: { status: 429, data: { message: 'Rate limit exceeded' } }
        })
      }));

      // Mock backup providers to succeed
      const { CoinGeckoAdapter } = require('../../services/coingeckoAdapter');
      CoinGeckoAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockResolvedValue({
          price: 45000,
          priceChangePercent24h: 2.5,
          volume24h: 1000000,
          high24h: 46000,
          low24h: 44000,
          marketCap: 850000000000
        })
      }));

      // Mock other services
      const { fetchCryptoPanicNews } = require('../../services/cryptoPanicAdapter');
      fetchCryptoPanicNews.mockResolvedValue({
        success: true,
        articles: [],
        sentiment: 0.5
      });

      const { fetchCoinMarketCapMetadata } = require('../../services/coinMarketCapAdapter');
      fetchCoinMarketCapMetadata.mockResolvedValue({
        marketData: {
          marketCap: 850000000000,
          volume24h: 1000000
        }
      });

      const result = await deepResearchEngine.runDeepResearch('BTCUSDT', 'test-user-id');

      // Should complete successfully despite primary provider 429
      expect(result.success).toBe(true);
      expect(result.providersCalled).toContain('coingecko'); // Backup provider used
      expect(mockedApiUsageTracker.recordUsage).toHaveBeenCalled();
    });

    it('should handle cascading 429 failures across multiple providers', async () => {
      // Mock all providers to fail with 429
      const mock429Error = {
        response: { status: 429, data: { message: 'Rate limit exceeded' } }
      };

      const { CryptoCompareAdapter } = require('../../services/cryptocompareAdapter');
      CryptoCompareAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockRejectedValue(mock429Error)
      }));

      const { CoinGeckoAdapter } = require('../../services/coingeckoAdapter');
      CoinGeckoAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockRejectedValue(mock429Error)
      }));

      const { fetchCryptoPanicNews } = require('../../services/cryptoPanicAdapter');
      fetchCryptoPanicNews.mockRejectedValue(mock429Error);

      const { fetchCoinMarketCapMetadata } = require('../../services/coinMarketCapAdapter');
      fetchCoinMarketCapMetadata.mockRejectedValue(mock429Error);

      const result = await deepResearchEngine.runDeepResearch('BTCUSDT', 'test-user-id');

      // Should complete with fallback/default data
      expect(result.success).toBe(true);
      expect(result.accuracy).toBeGreaterThanOrEqual(0.4); // Should have reasonable fallback accuracy
      expect(result.combinedSignal).toBeDefined();
    });

    it('should record API usage for successful fallback calls', async () => {
      // Primary fails, backup succeeds
      const { CryptoCompareAdapter } = require('../../services/cryptocompareAdapter');
      CryptoCompareAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockRejectedValue({
          response: { status: 429 }
        })
      }));

      const { CoinGeckoAdapter } = require('../../services/coingeckoAdapter');
      CoinGeckoAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockResolvedValue({
          price: 45000,
          priceChangePercent24h: 2.5,
          volume24h: 1000000
        })
      }));

      // Mock other services to succeed
      const { fetchCryptoPanicNews } = require('../../services/cryptoPanicAdapter');
      fetchCryptoPanicNews.mockResolvedValue({
        success: true,
        articles: [],
        sentiment: 0.5
      });

      await deepResearchEngine.runDeepResearch('BTCUSDT', 'test-user-id');

      // Should record usage for the successful backup provider
      expect(mockedApiUsageTracker.recordUsage).toHaveBeenCalledWith('test-user-id', 'coingecko');
    });

    it('should maintain accuracy calculation even with provider failures', async () => {
      // Mock mixed success/failure scenario
      const { CryptoCompareAdapter } = require('../../services/cryptocompareAdapter');
      CryptoCompareAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockResolvedValue({
          price: 45000,
          priceChangePercent24h: -1.2, // Slight negative
          volume24h: 800000,
          high24h: 46000,
          low24h: 44000
        })
      }));

      // News provider fails
      const { fetchCryptoPanicNews } = require('../../services/cryptoPanicAdapter');
      fetchCryptoPanicNews.mockRejectedValue({
        response: { status: 429 }
      });

      // Fundamentals succeed
      const { fetchCoinMarketCapMetadata } = require('../../services/coinMarketCapAdapter');
      fetchCoinMarketCapMetadata.mockResolvedValue({
        marketData: {
          marketCap: 850000000000,
          volume24h: 1000000
        }
      });

      const result = await deepResearchEngine.runDeepResearch('BTCUSDT', 'test-user-id');

      // Should calculate accuracy using available data (technical + fundamentals)
      expect(result.accuracy).toBeGreaterThan(0);
      expect(result.accuracy).toBeLessThanOrEqual(1);
      expect(typeof result.combinedSignal).toBe('string');
    });
  });

  describe('Provider Rotation Logic', () => {
    it('should rotate to backup providers when primary is exhausted', async () => {
      // Mock primary provider as exhausted
      mockedApiUsageTracker.isProviderExhaustedForUser.mockImplementation((userId, provider) => {
        return provider === 'cryptocompare'; // Primary exhausted
      });

      // Mock backup provider to succeed
      const { CoinGeckoAdapter } = require('../../services/coingeckoAdapter');
      CoinGeckoAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockResolvedValue({
          price: 45000,
          priceChangePercent24h: 2.5
        })
      }));

      // Mock other services
      const { fetchCryptoPanicNews } = require('../../services/cryptoPanicAdapter');
      fetchCryptoPanicNews.mockResolvedValue({
        success: true,
        articles: [],
        sentiment: 0.5
      });

      const result = await deepResearchEngine.runDeepResearch('BTCUSDT', 'test-user-id');

      expect(result.providersCalled).toContain('coingecko');
      expect(result.providersCalled).not.toContain('cryptocompare'); // Exhausted primary not used
    });

    it('should mark providers as rotated when switching to backups', async () => {
      mockedApiUsageTracker.isProviderExhaustedForUser.mockReturnValue(true); // All exhausted
      mockedApiUsageTracker.getNextAvailableProvider.mockResolvedValue('coingecko');

      const { CoinGeckoAdapter } = require('../../services/coingeckoAdapter');
      CoinGeckoAdapter.mockImplementation(() => ({
        getMarketData: jest.fn().mockResolvedValue({
          price: 45000,
          priceChangePercent24h: 2.5
        })
      }));

      await deepResearchEngine.runDeepResearch('BTCUSDT', 'test-user-id');

      expect(mockedApiUsageTracker.markProviderRotated).toHaveBeenCalled();
    });
  });
});
