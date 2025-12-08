import { AutoTradeEngine, TradingSettings, PositionSizingResult } from './autoTradeEngine';

describe('AutoTradeEngine', () => {
  describe('calculatePositionSize', () => {
    const mockSettings: TradingSettings = {
      symbol: 'BTCUSDT',
      maxPositionPerTrade: 10,
      tradeType: 'Scalping',
      accuracyTrigger: 85,
      maxDailyLoss: 5,
      maxTradesPerDay: 50,
      positionSizingMap: [
        { min: 0, max: 84, percent: 0 },
        { min: 85, max: 89, percent: 3 },
        { min: 90, max: 94, percent: 6 },
        { min: 95, max: 99, percent: 8.5 },
        { min: 100, max: 100, percent: 10 }
      ]
    };

    it('should return 0% for accuracy below trigger threshold', () => {
      const result = AutoTradeEngine.calculatePositionSize(80, mockSettings);
      expect(result.positionPercent).toBe(0);
      expect(result.reason).toContain('below trigger threshold');
    });

    it('should return 0% for accuracy in 0-84 range', () => {
      const result = AutoTradeEngine.calculatePositionSize(80, mockSettings);
      expect(result.positionPercent).toBe(0);
    });

    it('should return 3% for accuracy in 85-89 range', () => {
      const result = AutoTradeEngine.calculatePositionSize(85, mockSettings);
      expect(result.positionPercent).toBe(3);

      const result2 = AutoTradeEngine.calculatePositionSize(87, mockSettings);
      expect(result2.positionPercent).toBe(3);

      const result3 = AutoTradeEngine.calculatePositionSize(89, mockSettings);
      expect(result3.positionPercent).toBe(3);
    });

    it('should return 6% for accuracy in 90-94 range', () => {
      const result = AutoTradeEngine.calculatePositionSize(90, mockSettings);
      expect(result.positionPercent).toBe(6);

      const result2 = AutoTradeEngine.calculatePositionSize(92, mockSettings);
      expect(result2.positionPercent).toBe(6);

      const result3 = AutoTradeEngine.calculatePositionSize(94, mockSettings);
      expect(result3.positionPercent).toBe(6);
    });

    it('should return 8.5% for accuracy in 95-99 range', () => {
      const result = AutoTradeEngine.calculatePositionSize(95, mockSettings);
      expect(result.positionPercent).toBe(8.5);

      const result2 = AutoTradeEngine.calculatePositionSize(97, mockSettings);
      expect(result2.positionPercent).toBe(8.5);

      const result3 = AutoTradeEngine.calculatePositionSize(99, mockSettings);
      expect(result3.positionPercent).toBe(8.5);
    });

    it('should return maxPositionPerTrade (10%) for accuracy 100%', () => {
      const result = AutoTradeEngine.calculatePositionSize(100, mockSettings);
      expect(result.positionPercent).toBe(10);
    });

    it('should cap position percent at maxPositionPerTrade', () => {
      const highPercentSettings: TradingSettings = {
        ...mockSettings,
        maxPositionPerTrade: 5, // Lower max
        positionSizingMap: [
          { min: 0, max: 84, percent: 0 },
          { min: 85, max: 89, percent: 3 },
          { min: 90, max: 94, percent: 6 },
          { min: 95, max: 99, percent: 8.5 },
          { min: 100, max: 100, percent: 10 } // This would be 10% but capped at 5%
        ]
      };

      const result = AutoTradeEngine.calculatePositionSize(100, highPercentSettings);
      expect(result.positionPercent).toBe(5); // Capped at maxPositionPerTrade
      expect(result.reason).toContain('capped at 5% max per trade');
    });

    it('should return 0% for accuracy not in any range', () => {
      const result = AutoTradeEngine.calculatePositionSize(101, mockSettings);
      expect(result.positionPercent).toBe(0);
      expect(result.reason).toContain('No position sizing range found');
    });
  });

  describe('getTradingSettings', () => {
    it('should return default settings when none exist', async () => {
      // Mock firestoreAdapter to return null
      const mockFirestoreAdapter = {
        getTradingSettings: jest.fn().mockResolvedValue(null)
      };

      // Temporarily replace the import
      jest.mock('./firestoreAdapter', () => ({
        firestoreAdapter: mockFirestoreAdapter
      }));

      const settings = await AutoTradeEngine.getTradingSettings('test-uid');

      expect(settings.symbol).toBe('BTCUSDT');
      expect(settings.maxPositionPerTrade).toBe(10);
      expect(settings.accuracyTrigger).toBe(85);
      expect(settings.positionSizingMap).toHaveLength(5);
    });
  });
});
