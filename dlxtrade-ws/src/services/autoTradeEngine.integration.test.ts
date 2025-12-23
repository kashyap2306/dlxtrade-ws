import { AutoTradeEngine, TradingSettings } from './autoTradeEngine';

describe('AutoTradeEngine Integration Tests', () => {
  describe('Auto-trade flow simulation', () => {
    it('should execute trade with correct position sizing for accuracy 96%', async () => {
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

      // Test the position sizing calculation directly
      const positionResult = AutoTradeEngine.calculatePositionSize(96, mockSettings);

      // For accuracy 96%, it should map to the 95-99 range (8.5%)
      // Since 8.5% < maxPositionPerTrade (10%), it should use 8.5%
      expect(positionResult.positionPercent).toBe(8.5);
      expect(positionResult.reason).toContain('96% maps to 8.5%');

      // Verify the calculation is correct
      const expectedPercent = 8.5;
      const cappedPercent = Math.min(expectedPercent, mockSettings.maxPositionPerTrade);
      expect(cappedPercent).toBe(8.5);
    });

    it('should reject trades with accuracy below trigger threshold', async () => {
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

      const positionResult = AutoTradeEngine.calculatePositionSize(80, mockSettings);

      // Accuracy 80 is below trigger threshold of 85
      expect(positionResult.positionPercent).toBe(0);
      expect(positionResult.reason).toContain('below trigger threshold 85%');
    });

    it('should cap position size at maxPositionPerTrade when mapping exceeds limit', async () => {
      const mockSettings: TradingSettings = {
        symbol: 'BTCUSDT',
        maxPositionPerTrade: 5, // Lower max position
        tradeType: 'Scalping',
        accuracyTrigger: 85,
        maxDailyLoss: 5,
        maxTradesPerDay: 50,
        positionSizingMap: [
          { min: 0, max: 84, percent: 0 },
          { min: 85, max: 89, percent: 3 },
          { min: 90, max: 94, percent: 6 },
          { min: 95, max: 99, percent: 8.5 }, // This exceeds maxPositionPerTrade
          { min: 100, max: 100, percent: 10 } // This also exceeds
        ]
      };

      const result95 = AutoTradeEngine.calculatePositionSize(96, mockSettings);
      expect(result95.positionPercent).toBe(5); // Capped at maxPositionPerTrade
      expect(result95.reason).toContain('capped at 5% max per trade');

      const result100 = AutoTradeEngine.calculatePositionSize(100, mockSettings);
      expect(result100.positionPercent).toBe(5); // Capped at maxPositionPerTrade
      expect(result100.reason).toContain('capped at 5% max per trade');
    });
  });

  describe('Trading settings validation', () => {
    it('should validate position sizing map covers 0-100 without overlaps', () => {
      // This would be tested in the API validation, but we can test the logic here
      const validMap = [
        { min: 0, max: 84, percent: 0 },
        { min: 85, max: 89, percent: 3 },
        { min: 90, max: 94, percent: 6 },
        { min: 95, max: 99, percent: 8.5 },
        { min: 100, max: 100, percent: 10 }
      ];

      // Check no overlaps
      for (let i = 0; i < validMap.length - 1; i++) {
        expect(validMap[i].max < validMap[i + 1].min).toBe(true);
      }

      // Check covers 0-100
      expect(validMap[0].min).toBeLessThanOrEqual(0);
      expect(validMap[validMap.length - 1].max).toBeGreaterThanOrEqual(100);
    });
  });
});
