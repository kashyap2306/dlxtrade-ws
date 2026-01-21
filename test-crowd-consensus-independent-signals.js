/**
 * Test script to verify Crowd Consensus generates INDEPENDENT signals per exchange
 * This test ensures the bug is fixed where all exchanges showed the same direction
 */

const { CrowdConsensusService } = require('./dlxtrade-ws/src/services/crowdConsensusService');

async function testIndependentSignals() {
  console.log('🧪 Testing Crowd Consensus Independent Signal Generation\n');
  console.log('=' .repeat(80));
  
  try {
    // Run consensus analysis multiple times to verify randomness
    const runs = 5;
    const results = [];
    
    for (let i = 0; i < runs; i++) {
      console.log(`\n📊 Run ${i + 1}/${runs}:`);
      console.log('-'.repeat(80));
      
      const positions = await CrowdConsensusService.monitorMasterTraders();
      
      // Group positions by exchange
      const exchangeSignals = {};
      for (const pos of positions) {
        if (!exchangeSignals[pos.exchange]) {
          exchangeSignals[pos.exchange] = { LONG: 0, SHORT: 0, positions: [] };
        }
        exchangeSignals[pos.exchange][pos.direction]++;
        exchangeSignals[pos.exchange].positions.push(pos);
      }
      
      // Determine each exchange's signal
      const exchangeDirections = {};
      for (const [exchange, data] of Object.entries(exchangeSignals)) {
        if (data.LONG > data.SHORT) {
          exchangeDirections[exchange] = 'LONG';
        } else if (data.SHORT > data.LONG) {
          exchangeDirections[exchange] = 'SHORT';
        } else {
          exchangeDirections[exchange] = 'NEUTRAL';
        }
      }
      
      // Display results
      console.log(`\nExchange Signals:`);
      for (const [exchange, direction] of Object.entries(exchangeDirections)) {
        const data = exchangeSignals[exchange];
        console.log(`  ${exchange.padEnd(10)} → ${direction.padEnd(8)} (${data.LONG} LONG, ${data.SHORT} SHORT)`);
      }
      
      // Check for uniformity (bug indicator)
      const directions = Object.values(exchangeDirections);
      const uniqueDirections = [...new Set(directions)];
      
      if (uniqueDirections.length === 1 && directions.length > 5) {
        console.log(`\n⚠️  WARNING: All ${directions.length} exchanges have SAME direction (${uniqueDirections[0]})`);
        console.log(`   This indicates the bug is NOT fixed!`);
      } else {
        console.log(`\n✅ GOOD: ${uniqueDirections.length} different directions across ${directions.length} exchanges`);
        console.log(`   Directions: ${uniqueDirections.join(', ')}`);
      }
      
      results.push({
        run: i + 1,
        exchangeCount: directions.length,
        uniqueDirections: uniqueDirections.length,
        allSame: uniqueDirections.length === 1
      });
      
      // Small delay between runs
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('📈 SUMMARY:');
    console.log('='.repeat(80));
    
    const allSameCount = results.filter(r => r.allSame).length;
    const diverseCount = results.filter(r => !r.allSame).length;
    
    console.log(`\nRuns with ALL exchanges same direction: ${allSameCount}/${runs}`);
    console.log(`Runs with DIVERSE exchange directions: ${diverseCount}/${runs}`);
    
    if (allSameCount === runs) {
      console.log('\n❌ BUG STILL EXISTS: All runs showed uniform direction across exchanges');
      console.log('   Expected: Random variation between exchanges');
      console.log('   Actual: All exchanges always agree');
    } else if (diverseCount === runs) {
      console.log('\n✅ BUG FIXED: All runs showed independent exchange signals');
      console.log('   Each exchange generates its own direction independently');
    } else {
      console.log('\n⚠️  MIXED RESULTS: Some runs uniform, some diverse');
      console.log('   This is expected due to random chance');
      console.log(`   ${diverseCount}/${runs} runs showed proper independence`);
    }
    
    // Detailed breakdown
    console.log('\nDetailed Results:');
    for (const result of results) {
      const status = result.allSame ? '❌ UNIFORM' : '✅ DIVERSE';
      console.log(`  Run ${result.run}: ${status} (${result.uniqueDirections} unique directions across ${result.exchangeCount} exchanges)`);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testIndependentSignals().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
