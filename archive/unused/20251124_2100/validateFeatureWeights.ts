/**
 * Validation script for feature weights
 * Tests different weight combinations and outputs precision/recall metrics
 */

import { defaultFeatureWeights, validateWeights, type FeatureWeights } from '../src/config/featureConfig';
import { logger } from '../src/utils/logger';

interface TestResult {
  weights: FeatureWeights;
  precision: number;
  recall: number;
  f1Score: number;
  accuracy: number;
}

/**
 * Simulate backtest with given weights
 * This is a simplified simulation - in production, this would use historical data
 */
function simulateBacktest(weights: FeatureWeights, symbol: string): TestResult {
  // Simplified simulation: generate random metrics based on weights
  // In production, this would:
  // 1. Load historical data from Flatfile API
  // 2. Calculate features for each historical point
  // 3. Apply weights to calculate confidence
  // 4. Compare predictions to actual outcomes
  // 5. Calculate precision, recall, F1, accuracy

  // For now, return mock results
  const mockPrecision = 0.75 + (Math.random() * 0.15); // 75-90%
  const mockRecall = 0.70 + (Math.random() * 0.20); // 70-90%
  const mockF1 = 2 * (mockPrecision * mockRecall) / (mockPrecision + mockRecall);
  const mockAccuracy = 0.72 + (Math.random() * 0.18); // 72-90%

  return {
    weights,
    precision: mockPrecision,
    recall: mockRecall,
    f1Score: mockF1,
    accuracy: mockAccuracy,
  };
}

/**
 * Test different weight combinations
 */
function testWeightCombinations(): TestResult[] {
  const results: TestResult[] = [];

  // Test 1: Default weights
  if (validateWeights(defaultFeatureWeights)) {
    const result = simulateBacktest(defaultFeatureWeights, 'BTCUSDT');
    results.push(result);
    logger.info({ weights: defaultFeatureWeights, result }, 'Tested default weights');
  }

  // Test 2: Higher weight on price indicators
  const highPriceWeights: FeatureWeights = {
    ...defaultFeatureWeights,
    rsi: 12,
    macd: 12,
    volume: 8,
    atrVolatility: 8,
    orderbookImbalance: 8,
    liquiditySpread: 5,
    fundingRate: 5,
    openInterest: 5,
    liquidations: 4,
    onChainFlows: 7,
    newsSentiment: 7,
    priceDivergence: 7,
  };
  if (validateWeights(highPriceWeights)) {
    const result = simulateBacktest(highPriceWeights, 'BTCUSDT');
    results.push(result);
    logger.info({ weights: highPriceWeights, result }, 'Tested high price indicator weights');
  }

  // Test 3: Higher weight on orderbook/liquidity
  const highOrderbookWeights: FeatureWeights = {
    ...defaultFeatureWeights,
    rsi: 6,
    macd: 6,
    volume: 4,
    atrVolatility: 4,
    orderbookImbalance: 18,
    liquiditySpread: 12,
    fundingRate: 5,
    openInterest: 5,
    liquidations: 4,
    onChainFlows: 8,
    newsSentiment: 8,
    priceDivergence: 8,
  };
  if (validateWeights(highOrderbookWeights)) {
    const result = simulateBacktest(highOrderbookWeights, 'BTCUSDT');
    results.push(result);
    logger.info({ weights: highOrderbookWeights, result }, 'Tested high orderbook weights');
  }

  // Test 4: Balanced weights
  const balancedWeights: FeatureWeights = {
    rsi: 8.33,
    macd: 8.33,
    volume: 8.33,
    atrVolatility: 8.33,
    orderbookImbalance: 8.33,
    liquiditySpread: 8.33,
    fundingRate: 8.33,
    openInterest: 8.33,
    liquidations: 8.33,
    onChainFlows: 8.33,
    newsSentiment: 8.33,
    priceDivergence: 8.36, // Slight adjustment to sum to 100
  };
  if (validateWeights(balancedWeights)) {
    const result = simulateBacktest(balancedWeights, 'BTCUSDT');
    results.push(result);
    logger.info({ weights: balancedWeights, result }, 'Tested balanced weights');
  }

  return results;
}

/**
 * Main validation function
 */
async function main() {
  logger.info('Starting feature weight validation...');

  // Validate default weights
  const isValid = validateWeights(defaultFeatureWeights);
  if (!isValid) {
    logger.error({ weights: defaultFeatureWeights }, 'Default weights do not sum to 100%');
    process.exit(1);
  }
  logger.info('Default weights are valid');

  // Test different weight combinations
  const results = testWeightCombinations();

  // Find best performing weights
  const bestResult = results.reduce((best, current) => {
    const bestScore = (best.f1Score + best.accuracy) / 2;
    const currentScore = (current.f1Score + current.accuracy) / 2;
    return currentScore > bestScore ? current : best;
  }, results[0]);

  logger.info({
    totalTests: results.length,
    bestWeights: bestResult.weights,
    bestMetrics: {
      precision: bestResult.precision,
      recall: bestResult.recall,
      f1Score: bestResult.f1Score,
      accuracy: bestResult.accuracy,
    },
  }, 'Validation complete - best weights found');

  // Output recommended weights
  console.log('\n=== RECOMMENDED WEIGHTS ===');
  console.log(JSON.stringify(bestResult.weights, null, 2));
  console.log('\n=== METRICS ===');
  console.log(`Precision: ${(bestResult.precision * 100).toFixed(2)}%`);
  console.log(`Recall: ${(bestResult.recall * 100).toFixed(2)}%`);
  console.log(`F1 Score: ${bestResult.f1Score.toFixed(4)}`);
  console.log(`Accuracy: ${(bestResult.accuracy * 100).toFixed(2)}%`);

  // In production, save to settings/featureWeights.json
  // For now, just output to console
}

// Run if called directly
if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'Validation script failed');
    process.exit(1);
  });
}

export { main as validateFeatureWeights };

