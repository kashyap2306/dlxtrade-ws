#!/usr/bin/env ts-node

import { autoTradeEngine } from '../src/services/autoTradeEngine';

async function testAutoTradeCycle() {
  console.log('🔥 [TEMP_TEST] Testing auto-trade cycle manually');

  try {
    // This will trigger one auto-trade research cycle
    console.log('🔥 [TEMP_TEST] Calling runAutoTradeResearchCycleSafe...');

    const result = await autoTradeEngine.runAutoTradeResearchCycleSafe('test-user', false);

    if (!result) {
      console.log('🔥 [TEMP_TEST] Auto-trade cycle returned null (expected for test environment)');
      return;
    }

    console.log('🔥 [TEMP_TEST] Auto-trade cycle result:', {
      symbol: result.symbol,
      signal: result.signal,
      accuracy: result.accuracy,
      hasResult: !!result.result,
      resultSignal: result.result?.signal,
      resultAccuracy: result.result?.accuracy,
      resultHasTradePlan: !!result.result?.tradePlan,
      resultTradePlanKeys: result.result?.tradePlan ? Object.keys(result.result.tradePlan) : [],
      resultTradePlan: result.result?.tradePlan ? {
        entryPrice: result.result.tradePlan.entryPrice,
        stopLoss: result.result.tradePlan.stopLoss,
        takeProfit1: result.result.tradePlan.takeProfit1,
        takeProfit2: result.result.tradePlan.takeProfit2,
        takeProfit3: result.result.tradePlan.takeProfit3
      } : null
    });

    // ASSERTIONS
    if (!result.symbol) {
      throw new Error('ASSERTION FAILED: result.symbol is missing');
    }

    if (result.accuracy <= 0) {
      throw new Error(`ASSERTION FAILED: result.accuracy is ${result.accuracy}, expected > 0`);
    }

    if (result.signal !== 'BUY' && result.signal !== 'SELL' && result.signal !== 'HOLD') {
      throw new Error(`ASSERTION FAILED: result.signal is ${result.signal}, expected BUY/SELL/HOLD`);
    }

    if (!result.result) {
      throw new Error('ASSERTION FAILED: result.result is missing');
    }

    console.log('🎉 [TEMP_TEST] Auto-trade cycle test completed');

  } catch (error) {
    console.error('❌ [TEMP_TEST] FAILED:', error.message);
    process.exit(1);
  }
}

testAutoTradeCycle();
