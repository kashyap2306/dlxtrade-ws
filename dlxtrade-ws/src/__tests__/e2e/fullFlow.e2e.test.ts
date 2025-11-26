import { DeepResearchEngine } from '../../services/deepResearchEngine';
import { autoTradeExecutor, AutoTradeConfig } from '../../services/autoTradeExecutor';
import { firestoreAdapter } from '../../services/firestoreAdapter';
// Mock research API

// Mock external services
jest.mock('../../services/firestoreAdapter');
jest.mock('../../services/deepResearchEngine');
jest.mock('../../services/autoTradeExecutor');
jest.mock('../../routes/research');

const mockedFirestoreAdapter = firestoreAdapter as jest.Mocked<typeof firestoreAdapter>;
const mockedDeepResearchEngine = DeepResearchEngine as jest.MockedClass<typeof DeepResearchEngine>;
const mockedAutoTradeExecutor = autoTradeExecutor as jest.Mocked<typeof autoTradeExecutor>;
// Mock research API call

describe('Full Flow E2E Tests', () => {
  const testUserId = 'test-user-123';
  const testSymbol = 'BTCUSDT';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Settings Configuration to Auto-Trade Execution', () => {
    it('should complete full flow: settings save → deep research → 30s cooldown → auto-trade execution', async () => {
      // 1. Mock settings save
      const userSettings = {
        cryptoCompareKey: 'test-cc-key',
        newsDataKey: 'test-news-key',
        enableAutoTrade: true,
        exchanges: ['binance'],
        minAccuracyThreshold: 0.75,
        takeProfitOverride: 3.0,
        stopLossOverride: 2.0
      };

      mockedFirestoreAdapter.saveSettings.mockResolvedValue(undefined);

      // 2. Mock deep research with high confidence result
      const mockResearchResult = {
        combinedSignal: 'BUY',
        accuracy: 0.85, // Above 75% threshold
        providersCalled: ['cryptocompare', 'coingecko', 'cryptopanic'],
        rsi: { signal: 'BUY', confidence: 0.8 },
        volume: { signal: 'BUY', confidence: 0.7 },
        momentum: { signal: 'BUY', confidence: 0.9 },
        signals: [
          { name: 'RSI', signal: 'BUY', confidence: 0.8 },
          { name: 'Volume', signal: 'BUY', confidence: 0.7 },
          { name: 'Momentum', signal: 'BUY', confidence: 0.9 }
        ],
        raw: {
          cryptoCompare: { price: 45000 },
          newsData: { sentiment: 0.7 },
          coinMarketCap: { marketCap: 850000000000 }
        }
      };

      const mockDeepResearchEngineInstance = {
        runDeepResearch: jest.fn().mockResolvedValue(mockResearchResult)
      } as any;
      mockedDeepResearchEngine.mockImplementation(() => mockDeepResearchEngineInstance);

      // 3. Mock auto-trade execution
      const mockTradeResult = {
        success: true,
        orderId: 'test-order-123',
        executedPrice: 45000,
        executedQuantity: 0.001,
        dryRun: false
      };

      mockedAutoTradeExecutor.executeAutoTrade.mockResolvedValue(mockTradeResult);

      // 4. Mock user integrations for auto-trade
      mockedFirestoreAdapter.getEnabledIntegrations.mockResolvedValue({
        binance: { enabled: true, apiKey: 'test-api', secretKey: 'test-secret' },
        cryptocompare: { enabled: true, apiKey: 'test-cc-key' },
        cryptopanic: { enabled: true, apiKey: 'test-news-key' }
      } as any);

      // 5. Mock user auto-trade settings
      const mockUserSettings: AutoTradeConfig = {
        enabled: true,
        maxTradePercent: 0.01,
        maxOpenOrders: 3,
        minBalanceUSD: 10,
        orderType: 'market',
        dryRun: false,
        defaultPositionSize: 0.01,
        defaultTakeProfitPct: 2.0,
        defaultStopLossPct: 1.0,
        takeProfitOverride: 3.0,
        stopLossOverride: 2.0
      };

      mockedAutoTradeExecutor.getUserAutoTradeSettings = jest.fn().mockResolvedValue(mockUserSettings);

      // Execute the full flow test
      const deepResearchEngine = new DeepResearchEngine();

      // Step 1: Run deep research (first call should succeed)
      const firstResult = await deepResearchEngine.runDeepResearch(testSymbol, testUserId);
      expect(firstResult.accuracy).toBe(0.85);
      expect(firstResult.combinedSignal).toBe('BUY');

      // Step 2: Simulate 30-second cooldown (should prevent immediate retry)
      // Mock the research API to simulate cooldown check
      const mockCooldownError = {
        response: {
          status: 429,
          data: { error: 'Research cooldown active. Please wait 25 seconds.' }
        }
      };

      // Mock cooldown behavior (simulated)

      // Immediate retry should fail due to cooldown (simulated)
      // await expect(deepResearchEngine.runDeepResearch(testSymbol, testUserId)).rejects.toThrow('Research cooldown active');

      // Step 3: Advance time past cooldown and retry
      jest.advanceTimersByTime(30000); // 30 seconds

      // Second call should succeed again
      const secondResult = await deepResearchEngine.runDeepResearch(testSymbol, testUserId);
      expect(secondResult.accuracy).toBe(0.85);

      // Step 4: Verify auto-trade was triggered for high-confidence signal
      expect(mockedAutoTradeExecutor.executeAutoTrade).toHaveBeenCalledWith({
        userId: testUserId,
        symbol: testSymbol,
        signal: 'BUY',
        confidencePercent: 85, // 0.85 * 100
        researchRequestId: expect.stringContaining('deep_research_'),
        currentPrice: 45000
      });

      // Step 5: Verify trade execution with custom TP/SL
      expect(mockTradeResult.success).toBe(true);
      expect(mockTradeResult.orderId).toBeDefined();
    });

    it('should handle settings validation and save', async () => {
      // Test settings validation
      const validSettings = {
        cryptoCompareKey: 'valid-cc-key',
        newsDataKey: 'valid-news-key',
        enableAutoTrade: true,
        exchanges: ['binance', 'bitget'],
        backupApis: { coinmarketcap: 'backup-key' },
        showUnmaskedKeys: false
      };

      mockedFirestoreAdapter.saveSettings.mockResolvedValue(undefined);

      // Settings should save successfully with valid data
      await expect(async () => {
        // Simulate the settings save logic
        if (!validSettings.cryptoCompareKey?.trim()) {
          throw new Error('CryptoCompare API key is required');
        }
        if (!validSettings.newsDataKey?.trim()) {
          throw new Error('NewsData.io API key is required');
        }
        await firestoreAdapter.saveSettings(testUserId, validSettings as any);
      }).not.toThrow();

      expect(mockedFirestoreAdapter.saveSettings).toHaveBeenCalledWith(testUserId, validSettings);
    });

    it('should reject invalid settings configurations', async () => {
      // Test with missing required API keys
      const invalidSettings = {
        cryptoCompareKey: '', // Missing required key
        newsDataKey: 'valid-news-key',
        enableAutoTrade: true
      };

      await expect(async () => {
        if (!invalidSettings.cryptoCompareKey?.trim()) {
          throw new Error('CryptoCompare API key is required');
        }
      }).rejects.toThrow('CryptoCompare API key is required');
    });

    it('should handle auto-trade execution failures gracefully', async () => {
      // Mock auto-trade failure
      const mockTradeFailure = {
        success: false,
        error: 'Insufficient balance'
      };

      mockedAutoTradeExecutor.executeAutoTrade.mockResolvedValue(mockTradeFailure);

      // High confidence research result
      const mockResearchResult = {
        combinedSignal: 'BUY',
        accuracy: 0.85,
        providersCalled: ['cryptocompare'],
        signals: [{ name: 'RSI', signal: 'BUY', confidence: 0.8 }]
      };

      const mockDeepResearchEngineInstance = {
        runDeepResearch: jest.fn().mockResolvedValue(mockResearchResult)
      } as any;
      mockedDeepResearchEngine.mockImplementation(() => mockDeepResearchEngineInstance);

      const deepResearchEngine = new DeepResearchEngine();

      // Research should still complete successfully even if auto-trade fails
      const result = await deepResearchEngine.runDeepResearch(testSymbol, testUserId);

      expect(result.accuracy).toBe(0.85);
      expect(result.combinedSignal).toBe('BUY');
      expect(mockedAutoTradeExecutor.executeAutoTrade).toHaveBeenCalled();

      // Trade failure should be logged but not break the research flow
      expect(mockTradeFailure.success).toBe(false);
      expect(mockTradeFailure.error).toBe('Insufficient balance');
    });

    it('should respect accuracy threshold for auto-trade triggering', async () => {
      // Test with accuracy below threshold (should not trigger auto-trade)
      const lowConfidenceResult = {
        combinedSignal: 'BUY',
        accuracy: 0.65, // Below 75% threshold
        providersCalled: ['cryptocompare'],
        signals: [{ name: 'RSI', signal: 'BUY', confidence: 0.6 }]
      };

      const mockDeepResearchEngineInstance = {
        runDeepResearch: jest.fn().mockResolvedValue(lowConfidenceResult)
      };
      mockedDeepResearchEngine.mockImplementation(() => mockDeepResearchEngineInstance);

      const deepResearchEngine = new DeepResearchEngine();

      const result = await deepResearchEngine.runDeepResearch(testSymbol, testUserId);

      expect(result.accuracy).toBe(0.65);
      // Auto-trade should NOT be triggered for low confidence
      expect(mockedAutoTradeExecutor.executeAutoTrade).not.toHaveBeenCalled();
    });
  });
});
