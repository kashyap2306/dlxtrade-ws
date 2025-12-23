import { accuracyEngine, AccuracyEngine } from './accuracyEngine';
import { firestoreAdapter } from './firestoreAdapter';

// Mock firestoreAdapter
jest.mock('./firestoreAdapter', () => ({
  firestoreAdapter: {
    savePredictionMetrics: jest.fn(),
    getPredictionSnapshot: jest.fn(),
    updatePredictionOutcome: jest.fn(),
    updateAccuracyCalibration: jest.fn(),
  }
}));

describe('AccuracyEngine', () => {
  let engine: AccuracyEngine;

  beforeEach(() => {
    engine = new AccuracyEngine();
    jest.clearAllMocks();
  });

  describe('calculateSnapshotAccuracy', () => {
    it('should return accuracy 0 for missing required fields', async () => {
      const mockReport = {
        signal: 'BUY' as const,
        accuracy: 0,
        symbol: 'TEST',
        // Missing indicators field entirely
        metadata: {},
        news: [],
        raw: {},
        providers: {}
      } as any; // Type assertion to bypass TypeScript checks for this test
      const result = await engine.calculateSnapshotAccuracy(mockReport, 'default');

      expect(result.accuracy).toBe(0);
      expect(result.breakdown.indicatorScore).toBe(0);
      expect(result.metadata.symbol).toBe('TEST');
    });

    it('should calculate high accuracy for strong bullish signals', async () => {
      const report = {
        signal: 'BUY' as const,
        accuracy: 0,
        symbol: 'BTCUSDT',
        indicators: {
          macd: { signal: 'bullish' },
          rsi: { value: 35 },
          ema20: { value: 50000 },
          sma50: { value: 51000 },
          sma200: { value: 52000 },
          vwap: { signal: 'bullish', value: 49500, deviation: -1 },
          atr: { classification: 'low' },
          momentum: { score: 0.8 },
          pattern: { confidence: 0.8 },
          volume: { trend: 'increasing', score: 0.8 }
        },
        metadata: { success: true },
        news: [],
        raw: {
          marketData: { price: 50500 },
          cryptocompare: { trend1h: 'bullish', trend1d: 'bullish' }
        },
        providers: {
          news: { success: true },
          metadata: { success: true }
        }
      };

      const result = await engine.calculateSnapshotAccuracy(report, 'default');

      expect(result.accuracy).toBeGreaterThan(70);
      expect(result.breakdown.indicatorScore).toBeGreaterThan(50);
      expect(result.breakdown.marketStructureScore).toBeGreaterThan(50);
    });

    it('should penalize resistance proximity for BUY signals', async () => {
      const report = {
        signal: 'BUY' as const,
        accuracy: 0,
        symbol: 'BTCUSDT',
        indicators: {
          macd: { signal: 'bullish' },
          rsi: { value: 60 },
          ema20: { value: 50000 },
          vwap: { signal: 'bullish', value: 49500, deviation: 2 }, // Near resistance
          volume: { score: 0.6 }
        },
        metadata: { success: true },
        news: [],
        raw: {},
        providers: {
          news: { success: true },
          metadata: { success: true }
        }
      };

      const result = await engine.calculateSnapshotAccuracy(report, 'default');

      // Should have penalty for being near resistance
      expect(result.breakdown.marketStructureScore).toBeLessThan(60);
    });

    it('should cap accuracy at 60 for low volume + neutral momentum', async () => {
      const report = {
        signal: 'BUY' as const,
        accuracy: 0,
        symbol: 'BTCUSDT',
        indicators: {
          momentum: { score: 0.45 }, // Neutral momentum
          volume: { score: 0.25 }, // Low volume
          macd: { signal: 'bullish' },
          rsi: { value: 55 }
        },
        metadata: { success: true },
        news: [],
        raw: {},
        providers: {
          news: { success: true },
          metadata: { success: true }
        }
      };

      const result = await engine.calculateSnapshotAccuracy(report, 'default');

      expect(result.accuracy).toBeLessThanOrEqual(60);
    });

    it('should reduce accuracy when metadata provider fails', async () => {
      const report = {
        signal: 'BUY' as const,
        accuracy: 0,
        symbol: 'BTCUSDT',
        indicators: {
          macd: { signal: 'bullish' },
          rsi: { value: 55 },
          volume: { score: 0.7 }
        },
        metadata: { success: false }, // Failed metadata
        news: [],
        raw: {},
        providers: {
          news: { success: true },
          metadata: { success: false }
        }
      };

      const result = await engine.calculateSnapshotAccuracy(report, 'default');

      // Should be reduced by 30% due to metadata failure
      expect(result.accuracy).toBeLessThan(50);
    });

    it('should apply strategy-specific weight adjustments', async () => {
      const report = {
        signal: 'BUY' as const,
        accuracy: 0,
        symbol: 'BTCUSDT',
        indicators: {
          macd: { signal: 'bullish' },
          rsi: { value: 55 },
          volume: { score: 0.7 },
          momentum: { score: 0.6 }
        },
        metadata: { success: true },
        news: [],
        raw: {},
        providers: {
          news: { success: true },
          metadata: { success: true }
        }
      };

      const scalpingResult = await engine.calculateSnapshotAccuracy(report, 'scalping');
      const swingResult = await engine.calculateSnapshotAccuracy(report, 'swing');

      // Scalping should weight momentum higher (25% vs 15% default)
      expect(scalpingResult.finalAppliedWeights.momentum).toBe(0.25);
      expect(swingResult.finalAppliedWeights.marketStructure).toBe(0.30);
    });
  });

  describe('savePredictionSnapshot', () => {
    it('should save prediction snapshot to firestore', async () => {
      const mockSnapshot = {
        requestId: 'test-123',
        userId: 'user-123',
        accuracy: 85
      };

      await engine.savePredictionSnapshot('user-123', mockSnapshot);

      expect(firestoreAdapter.savePredictionMetrics).toHaveBeenCalledWith('user-123', expect.objectContaining({
        ...mockSnapshot,
        timestamp: expect.any(Date),
        version: 'v1.0'
      }));
    });
  });

  describe('recordPredictionOutcome', () => {
    it('should record prediction outcome and update calibration', async () => {
      const mockSnapshot = { userId: 'user-123', symbol: 'BTCUSDT', snapshotAccuracy: 85 };
      (firestoreAdapter.getPredictionSnapshot as jest.Mock).mockResolvedValue(mockSnapshot);

      const outcome = { win: true, pnl: 50, durationSeconds: 3600 };

      await engine.recordPredictionOutcome('req-123', outcome);

      expect(firestoreAdapter.updatePredictionOutcome).toHaveBeenCalledWith('req-123', expect.objectContaining({
        ...outcome,
        recordedAt: expect.any(Date)
      }));

      expect(firestoreAdapter.updateAccuracyCalibration).toHaveBeenCalledWith('user-123', 80, true);
    });
  });
});
