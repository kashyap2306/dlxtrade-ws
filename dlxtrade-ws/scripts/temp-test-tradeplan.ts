#!/usr/bin/env ts-node

import { combineFreeModeResults } from '../src/services/researchAggregator';

async function testResearchAggregator() {
  console.log('🔥 [TEMP_TEST] Testing researchAggregator tradePlan creation');

  try {
    // Create mock data with forced high accuracy
    const mockMarketData = {
      success: true,
      data: {
        ohlc: [
          [Date.now() - 60000, 50000, 50100, 49900, 50050, 1000],
          [Date.now() - 30000, 50050, 50200, 50000, 50150, 1200],
          [Date.now(), 50150, 50250, 50100, 50200, 1100]
        ],
        volume: { value: 1000, average: 900 },
        vwap: { value: 50100 },
        price: 50200
      },
      latencyMs: 100,
      provider: 'mock'
    };

    const mockCryptoCompare = {
      success: true,
      data: { price: 50200 },
      latencyMs: 50,
      provider: 'mock'
    };

    const mockCMC = {
      success: true,
      data: { price: 50200, volume24h: 1000000 },
      latencyMs: 75,
      provider: 'mock'
    };

    const mockNews = {
      success: true,
      data: { articles: [] },
      latencyMs: 25,
      provider: 'mock'
    };

    console.log('🔥 [TEMP_TEST] Calling combineFreeModeResults with mock data...');

    // Call researchAggregator with mock parameters
    const result = await combineFreeModeResults(
      'test-user',
      'BTCUSDT',
      mockMarketData,
      mockCryptoCompare,
      mockCMC,
      mockNews,
      false, // silent = false
      true, // isFinal = true
      {}, // stagesMetadata
      {} // providersMetadata
    );

    console.log('🔥 [TEMP_TEST] Testing with accuracy < 70% (should have no tradePlan)...');

    // Test 1: Low accuracy should not generate tradePlan
    if (result.accuracy >= 0.70) {
      console.log('🔥 [TEMP_TEST] UNEXPECTED: Got high accuracy, testing tradePlan creation...');
      if (result.signal !== 'HOLD' && result.tradePlan) {
        console.log('✅ [TEMP_TEST] PASS: High accuracy + non-HOLD signal = tradePlan exists');
      } else {
        console.log('❌ [TEMP_TEST] FAIL: High accuracy but no tradePlan or HOLD signal');
      }
    } else {
      console.log('🔥 [TEMP_TEST] EXPECTED: Low accuracy, no tradePlan');
      if (!result.tradePlan) {
        console.log('✅ [TEMP_TEST] PASS: Low accuracy = no tradePlan');
      } else {
        console.log('❌ [TEMP_TEST] FAIL: Low accuracy but tradePlan exists');
      }
    }

    console.log('🔥 [TEMP_TEST] researchAggregator result:', {
      symbol: 'BTCUSDT', // From parameter, not in result
      signal: result.signal,
      accuracy: result.accuracy,
      accuracyPercent: (result.accuracy * 100).toFixed(1) + '%',
      hasTradePlan: !!result.tradePlan,
      tradePlanKeys: result.tradePlan ? Object.keys(result.tradePlan) : [],
      tradePlan: result.tradePlan ? {
        entryPrice: result.tradePlan.entryPrice,
        stopLoss: result.tradePlan.stopLoss,
        takeProfit1: result.tradePlan.takeProfit1,
        takeProfit2: result.tradePlan.takeProfit2,
        takeProfit3: result.tradePlan.takeProfit3,
        riskRewardRatio: result.tradePlan.riskRewardRatio
      } : null
    });

    // ASSERTIONS
    const symbol = 'BTCUSDT'; // From parameter

    if (result.accuracy <= 0) {
      throw new Error(`ASSERTION FAILED: result.accuracy is ${result.accuracy}, expected > 0`);
    }

    if (result.signal !== 'BUY' && result.signal !== 'SELL' && result.signal !== 'HOLD') {
      throw new Error(`ASSERTION FAILED: result.signal is ${result.signal}, expected BUY/SELL/HOLD`);
    }

    // Check tradePlan based on signal and accuracy
    if (result.signal === 'HOLD' || result.accuracy < 0.70) {
      if (result.tradePlan !== null) {
        throw new Error(`ASSERTION FAILED: tradePlan should be null for HOLD or low accuracy, but got ${JSON.stringify(result.tradePlan)}`);
      }
      console.log('✅ [TEMP_TEST] PASS: tradePlan correctly null for HOLD/low accuracy');
    } else {
      if (!result.tradePlan) {
        throw new Error('ASSERTION FAILED: tradePlan should exist for BUY/SELL with high accuracy');
      }
      if (!result.tradePlan.entryPrice || !result.tradePlan.stopLoss || !result.tradePlan.takeProfit1) {
        throw new Error('ASSERTION FAILED: tradePlan missing required fields');
      }
      console.log('✅ [TEMP_TEST] PASS: tradePlan exists with required fields');
    }

    console.log('🎉 [TEMP_TEST] ALL ASSERTIONS PASSED - researchAggregator working correctly');

  } catch (error) {
    console.error('❌ [TEMP_TEST] FAILED:', error.message);
    process.exit(1);
  }
}

testResearchAggregator();
