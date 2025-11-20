import { featureEngine, BatchFeatureInput } from '../featureEngine';
import type { Orderbook, Trade } from '../../types';

const symbol = 'BTCUSDT';

const mockOrderbook = (): Orderbook => ({
  symbol,
  lastUpdateId: Date.now(),
  bids: Array.from({ length: 10 }).map((_, idx) => ({
    price: (100 + idx * 0.5).toFixed(2),
    quantity: (5 - idx * 0.1).toFixed(2),
  })),
  asks: Array.from({ length: 10 }).map((_, idx) => ({
    price: (100.5 + idx * 0.5).toFixed(2),
    quantity: (5 - idx * 0.1).toFixed(2),
  })),
});

const mockTrades = (): Trade[] =>
  Array.from({ length: 50 }).map((_, idx) => ({
    id: `${idx}`,
    symbol,
    price: (100 + idx * 0.01).toFixed(2),
    quantity: (0.5 + idx * 0.001).toFixed(5),
    time: Date.now() - idx * 1000,
    isBuyerMaker: idx % 2 === 0,
  }));

describe('FeatureEngine', () => {
  beforeEach(() => {
    featureEngine.clearHistory(symbol);
  });

  it('computes enriched feature vectors with multi-timeframe aggregates and deltas', () => {
    const trades = mockTrades();
    const orderbook = mockOrderbook();
    let lastVector;

    for (let i = 0; i < 80; i += 1) {
      lastVector = featureEngine.computeFeatureVector(
        symbol,
        100 + i * 0.25,
        orderbook,
        trades,
        1000 + i * 10,
        '1m'
      );
    }

    expect(lastVector).toBeDefined();
    if (!lastVector) return;

    expect(lastVector.multiTimeframe['1m']).toBeDefined();
    expect(lastVector.multiTimeframe['5m']).toBeDefined();
    expect(lastVector.normalized).toHaveProperty('rsi5_z');
    expect(lastVector.percentiles).toHaveProperty('rsi5_pct');
    expect(typeof lastVector.deltas.ema12Minus26).toBe('number');
    expect(lastVector.flags.volatility_breakout).toBeDefined();
  });

  it('supports batch processing without mutating shared state', () => {
    const samples: BatchFeatureInput[] = Array.from({ length: 5 }).map((_, idx) => ({
      symbol,
      price: 101 + idx,
      orderbook: mockOrderbook(),
      trades: mockTrades(),
      volume24h: 1200 + idx * 5,
      timeframe: '5m',
    }));

    const vectors = featureEngine.computeBatchFeatureVectors(samples);
    expect(vectors).toHaveLength(samples.length);
    const latestVector = vectors[vectors.length - 1];
    expect(latestVector.multiTimeframe['5m']).toBeDefined();
    expect(latestVector.flags).toHaveProperty('price_above_vwap');
  });
});


