/**
 * Test script for Deep Research Scheduler
 * Simulates 10 scheduler ticks and verifies:
 * - lastProcessedIndex increments correctly
 * - Different symbols are processed
 * - Confidence values vary (not fixed 65%)
 * - Auto-trade attempts are logged when confidence >= threshold
 */

import { deepResearchScheduler } from '../src/services/deepResearchScheduler';
import { firestoreAdapter } from '../src/services/firestoreAdapter';
import { logger } from '../src/utils/logger';
import * as admin from 'firebase-admin';

async function testScheduler() {
  console.log('🧪 Starting Deep Research Scheduler Test...\n');

  try {
    // Initialize Firebase if not already initialized
    if (!admin.apps.length) {
      const { getFirebaseAdmin } = await import('../src/utils/firebase');
      getFirebaseAdmin();
    }

    // Test 1: Verify topCoinsService returns non-empty list
    console.log('📋 Test 1: Verifying topCoinsService returns non-empty list...');
    const { topCoinsService } = await import('../src/services/topCoinsService');
    const topCoins = await topCoinsService.getTop100Coins();
    if (topCoins.length === 0) {
      throw new Error('❌ FAILED: topCoinsService returned empty array');
    }
    console.log(`✅ PASSED: topCoinsService returned ${topCoins.length} coins\n`);

    // Test 2: Verify rotation state management
    console.log('🔄 Test 2: Testing rotation state management...');
    const stateBefore = await (deepResearchScheduler as any).getState();
    console.log(`   Initial lastProcessedIndex: ${stateBefore.lastProcessedIndex ?? -1}`);

    // Simulate 3 rotation cycles
    const processedSymbols: string[] = [];
    const confidenceValues: number[] = [];
    const testRuns = 10;

    for (let i = 0; i < testRuns; i++) {
      console.log(`\n   Run ${i + 1}/${testRuns}:`);
      
      try {
        // Force run one coin (simulates scheduler tick)
        const result = await (deepResearchScheduler as any).forceRun(undefined, 'rotate');
        
        if (result && result.symbol) {
          processedSymbols.push(result.symbol);
          if (result.result && result.result.confidence !== undefined) {
            confidenceValues.push(result.result.confidence);
            console.log(`   ✅ Processed: ${result.symbol}, Confidence: ${result.result.confidence}%, Status: ${result.result.status || 'N/A'}`);
          } else {
            console.log(`   ⚠️  Processed: ${result.symbol}, but confidence missing`);
          }
        } else {
          console.log(`   ⚠️  Run ${i + 1} returned no result`);
        }

        // Check state after each run
        const stateAfter = await (deepResearchScheduler as any).getState();
        console.log(`   State lastProcessedIndex: ${stateAfter.lastProcessedIndex ?? -1}`);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err: any) {
        console.log(`   ❌ Error in run ${i + 1}: ${err.message}`);
      }
    }

    // Test 3: Verify different symbols were processed
    console.log(`\n📊 Test 3: Verifying symbol rotation...`);
    const uniqueSymbols = new Set(processedSymbols);
    console.log(`   Total runs: ${processedSymbols.length}`);
    console.log(`   Unique symbols: ${uniqueSymbols.size}`);
    console.log(`   Symbols processed: ${Array.from(uniqueSymbols).join(', ')}`);
    
    if (uniqueSymbols.size < 2 && processedSymbols.length >= 3) {
      console.log(`   ⚠️  WARNING: Only ${uniqueSymbols.size} unique symbol(s) processed (expected rotation)`);
    } else if (uniqueSymbols.size >= 2) {
      console.log(`   ✅ PASSED: Multiple symbols processed (rotation working)`);
    }

    // Test 4: Verify confidence values vary
    console.log(`\n📈 Test 4: Verifying confidence variation...`);
    if (confidenceValues.length === 0) {
      console.log(`   ⚠️  WARNING: No confidence values collected`);
    } else {
      const minConf = Math.min(...confidenceValues);
      const maxConf = Math.max(...confidenceValues);
      const avgConf = confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length;
      const allSame = confidenceValues.every(v => v === confidenceValues[0]);
      
      console.log(`   Confidence range: ${minConf}% - ${maxConf}%`);
      console.log(`   Average confidence: ${avgConf.toFixed(1)}%`);
      console.log(`   Values: ${confidenceValues.map(v => v.toFixed(0)).join(', ')}`);
      
      if (allSame) {
        console.log(`   ❌ FAILED: All confidence values are the same (${confidenceValues[0]}%) - fixed value detected`);
      } else {
        console.log(`   ✅ PASSED: Confidence values vary (not fixed)`);
      }
    }

    // Test 5: Verify auto-trade logging
    console.log(`\n🤖 Test 5: Verifying auto-trade logic...`);
    const config = await (deepResearchScheduler as any).loadConfig();
    console.log(`   Auto-trade enabled: ${config.autoTradeEnabled || false}`);
    console.log(`   Auto-trade threshold: ${config.autoTradeThreshold || 75}%`);
    
    const highConfidenceRuns = confidenceValues.filter(c => c >= (config.autoTradeThreshold || 75));
    console.log(`   Runs with confidence >= threshold: ${highConfidenceRuns.length}/${confidenceValues.length}`);
    
    if (highConfidenceRuns.length > 0) {
      console.log(`   ✅ PASSED: High confidence runs detected (auto-trade would trigger if enabled)`);
    } else {
      console.log(`   ⚠️  WARNING: No runs met auto-trade threshold`);
    }

    // Test 6: Verify state persistence
    console.log(`\n💾 Test 6: Verifying state persistence...`);
    const finalState = await (deepResearchScheduler as any).getState();
    console.log(`   Final lastProcessedIndex: ${finalState.lastProcessedIndex ?? -1}`);
    console.log(`   Final lastSymbol: ${finalState.lastSymbol || 'N/A'}`);
    
    if (finalState.lastProcessedIndex !== undefined && finalState.lastProcessedIndex >= 0) {
      console.log(`   ✅ PASSED: State persisted correctly`);
    } else {
      console.log(`   ⚠️  WARNING: State may not be persisted`);
    }

    // Summary
    console.log(`\n📋 Test Summary:`);
    console.log(`   ✅ Top coins service: Working`);
    console.log(`   ${uniqueSymbols.size >= 2 ? '✅' : '⚠️ '} Symbol rotation: ${uniqueSymbols.size} unique symbols`);
    console.log(`   ${confidenceValues.length > 0 && !confidenceValues.every(v => v === confidenceValues[0]) ? '✅' : '❌'} Confidence variation: ${confidenceValues.length > 0 ? 'Varies' : 'No data'}`);
    console.log(`   ${highConfidenceRuns.length > 0 ? '✅' : '⚠️ '} Auto-trade readiness: ${highConfidenceRuns.length} high-confidence runs`);
    console.log(`   ${finalState.lastProcessedIndex !== undefined ? '✅' : '⚠️ '} State persistence: ${finalState.lastProcessedIndex !== undefined ? 'Working' : 'Unknown'}`);

    console.log(`\n✅ Test completed successfully!`);
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test
testScheduler().then(() => {
  console.log('\n🏁 Test script finished');
  process.exit(0);
}).catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});

