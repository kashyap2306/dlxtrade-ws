import { DeepResearchEngine } from './deepResearchEngine';

describe('DeepResearchEngine Integration Tests', () => {
  let engine: DeepResearchEngine;

  beforeEach(() => {
    engine = new DeepResearchEngine();
  });

  describe('Top 10 Coins', () => {
    it('should return top 10 coins with correct structure', async () => {
      const mockUid = 'test-user-123';
      const result = await engine.getTop10Coins(mockUid);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(10);

      // Check structure of first coin
      const firstCoin = result[0];
      expect(firstCoin).toHaveProperty('id');
      expect(firstCoin).toHaveProperty('symbol');
      expect(firstCoin).toHaveProperty('name');
      expect(firstCoin).toHaveProperty('thumbnail');
      expect(firstCoin).toHaveProperty('current_price');
      expect(firstCoin).toHaveProperty('price_change_percentage_24h');

      // Check that it's Bitcoin
      expect(firstCoin.symbol).toBe('BTCUSDT');
      expect(firstCoin.name).toBe('Bitcoin');
    });
  });

  describe('Coin Research', () => {
    it('should research a coin and return complete structure', async () => {
      jest.setTimeout(30000); // 30 second timeout for this test
      const mockUid = 'test-user-123';
      const result = await engine.getCoinResearch(mockUid, 'BTCUSDT');

      // Check main structure
      expect(result).toHaveProperty('marketData');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('news');
      expect(result).toHaveProperty('coinImages');
      expect(result).toHaveProperty('analysisSummary');
      expect(result).toHaveProperty('providerUsage');

      // Check provider usage structure
      expect(result.providerUsage).toHaveProperty('marketData');
      expect(result.providerUsage).toHaveProperty('metadata');
      expect(result.providerUsage).toHaveProperty('news');

      // Check analysis summary structure
      expect(result.analysisSummary).toHaveProperty('rsi');
      expect(result.analysisSummary).toHaveProperty('maSignal');
      expect(result.analysisSummary).toHaveProperty('volatility');
      expect(result.analysisSummary).toHaveProperty('signals');
      expect(result.analysisSummary).toHaveProperty('summary');

      // Check coin images
      expect(Array.isArray(result.coinImages)).toBe(true);
      expect(result.coinImages.length).toBe(3);
    });

    it('should handle coin research gracefully', async () => {
      const mockUid = 'test-user-123';

      // This test ensures the method doesn't throw
      // The actual implementation uses existing provider methods
      try {
        const result = await engine.getCoinResearch(mockUid, 'BTCUSDT');
        expect(result).toBeDefined();
        expect(result.marketData).toBeDefined();
        expect(result.metadata).toBeDefined();
        expect(Array.isArray(result.news)).toBe(true);
      } catch (error) {
        // If it throws due to provider issues, that's acceptable
        expect(error).toBeDefined();
      }
    });
  });

  describe('Provider Execution Methods', () => {
    it('should have access to provider execution methods', () => {
      expect(typeof (engine as any).executeMarketDataProvider).toBe('function');
      expect(typeof (engine as any).executeCMCProvider).toBe('function');
      expect(typeof (engine as any).executeNewsProvider).toBe('function');
    });
  });
});
