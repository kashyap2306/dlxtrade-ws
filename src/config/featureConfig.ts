/**
 * Feature Configuration for Deep Research
 * Defines weights and settings for weighted confidence scoring
 */

export interface FeatureWeights {
  // Price indicators (combined 30%)
  rsi: number; // 8%
  macd: number; // 8%
  volume: number; // 6%
  atrVolatility: number; // 8%

  // Orderbook Imbalance & Liquidity (combined 20%)
  orderbookImbalance: number; // 12%
  liquiditySpread: number; // 8%

  // Derivatives (combined 20%)
  fundingRate: number; // 7%
  openInterest: number; // 7%
  liquidations: number; // 6%

  // On-chain / Exchange Flows (10%)
  onChainFlows: number; // 10%

  // News / Sentiment (10%)
  newsSentiment: number; // 10%

  // Cross-exchange price divergence (10%)
  priceDivergence: number; // 10%
}

export interface FeatureConfig {
  weights: FeatureWeights;
  smoothing: {
    enabled: boolean;
    alpha: number; // EMA smoothing factor (0-1)
    window: number; // Number of runs to consider
  };
  confidence: {
    minForAutoTrade: number; // Minimum confidence for auto-trade (default 75)
    insufficientDataPenalty: number; // Penalty when critical APIs missing (default 20)
    flashEventThreshold: number; // Price move % to trigger flash event check (default 5%)
    flashEventWindowSeconds: number; // Time window for flash event check (default 30)
    flashEventPenalty: number; // Penalty for flash events (default 30)
  };
  confluence: {
    enabled: boolean;
    minMajorSignals: number; // Minimum major signals required (default 2)
    minMinorSignals: number; // Minimum minor signals if only 1 major (default 2)
    majorSignals: string[]; // Features considered major (RSI, MACD, Volume)
    minorSignals: string[]; // Features considered minor (Sentiment, OI, etc.)
  };
  volume: {
    rvolThreshold: number; // Minimum RVOL for breakout confirmation (default 1.5)
    requireVolumeConfirmation: boolean; // Require volume confirmation for signals
  };
  derivatives: {
    fundingRatePercentileThreshold: number; // Top X percentile for extreme funding (default 95)
    contradictPenalty: number; // Penalty when derivatives contradict price (default 15)
  };
  liquidity: {
    maxSpreadPercent: number; // Maximum spread % for valid data (default 0.5)
    minLiquidityScore: number; // Minimum liquidity score (default 0.3)
  };
}

/**
 * Default feature weights (sums to 100%)
 */
export const defaultFeatureWeights: FeatureWeights = {
  rsi: 8,
  macd: 8,
  volume: 6,
  atrVolatility: 8,
  orderbookImbalance: 12,
  liquiditySpread: 8,
  fundingRate: 7,
  openInterest: 7,
  liquidations: 6,
  onChainFlows: 10,
  newsSentiment: 10,
  priceDivergence: 10,
};

/**
 * Default feature configuration
 */
export const defaultFeatureConfig: FeatureConfig = {
  weights: defaultFeatureWeights,
  smoothing: {
    enabled: true,
    alpha: 0.15, // EMA smoothing factor (reduced for more stability)
    window: 3, // Consider last 3 runs
  },
  confidence: {
    minForAutoTrade: 75,
    insufficientDataPenalty: 20,
    flashEventThreshold: 5, // 5% price move
    flashEventWindowSeconds: 30,
    flashEventPenalty: 30,
  },
  confluence: {
    enabled: true,
    minMajorSignals: 2, // Require at least 2 major signals
    minMinorSignals: 2, // Or 1 major + 2 minor
    majorSignals: ['rsi', 'macd', 'volume', 'orderbookImbalance'],
    minorSignals: ['newsSentiment', 'openInterest', 'fundingRate', 'onChainFlows'],
  },
  volume: {
    rvolThreshold: 1.5, // Minimum RVOL for breakout confirmation
    requireVolumeConfirmation: true, // Require volume confirmation
  },
  derivatives: {
    fundingRatePercentileThreshold: 95, // Top 5% considered extreme
    contradictPenalty: 15, // Penalty when derivatives contradict price
  },
  liquidity: {
    maxSpreadPercent: 0.5, // Maximum 0.5% spread
    minLiquidityScore: 0.3, // Minimum liquidity score
  },
};

/**
 * Load feature configuration from environment or use defaults
 */
export function loadFeatureConfig(): FeatureConfig {
  // In the future, this could load from Firestore or environment variables
  // For now, return defaults
  return defaultFeatureConfig;
}

/**
 * Validate that weights sum to 100%
 */
export function validateWeights(weights: FeatureWeights): boolean {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) < 0.01; // Allow small floating point errors
}

