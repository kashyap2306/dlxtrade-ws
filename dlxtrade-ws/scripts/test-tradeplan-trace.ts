#!/usr/bin/env ts-node

import { runFreeModeDeepResearch } from '../src/services/deepResearchEngine';

async function testManualResearch() {
  console.log('🔥 [TEST] Starting manual research tradePlan trace test');

  try {
    // Use a test user and symbol
    const uid = 'test-user';
    const symbol = 'BTCUSDT';

    console.log(`🔥 [TEST] Running manual research for ${symbol}`);

    const result = await runFreeModeDeepResearch(uid, symbol, undefined, undefined);

    console.log('🔥 [TEST] Manual research completed:', {
      symbol: result.symbol,
      signal: result.signal,
      accuracy: result.accuracy,
      hasTradePlan: !!result.tradePlan,
      tradePlanKeys: result.tradePlan ? Object.keys(result.tradePlan) : [],
      tradePlan: result.tradePlan
    });

  } catch (error) {
    console.error('🔥 [TEST] Error:', error);
  }
}

testManualResearch();
