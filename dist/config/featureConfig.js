"use strict";
/**
 * Feature Configuration for Deep Research
 * Defines weights and settings for weighted confidence scoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultFeatureConfig = exports.defaultFeatureWeights = void 0;
exports.loadFeatureConfig = loadFeatureConfig;
exports.validateWeights = validateWeights;
/**
 * Default feature weights (sums to 100%)
 */
exports.defaultFeatureWeights = {
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
exports.defaultFeatureConfig = {
    weights: exports.defaultFeatureWeights,
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
function loadFeatureConfig() {
    // In the future, this could load from Firestore or environment variables
    // For now, return defaults
    return exports.defaultFeatureConfig;
}
/**
 * Validate that weights sum to 100%
 */
function validateWeights(weights) {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    return Math.abs(sum - 100) < 0.01; // Allow small floating point errors
}
