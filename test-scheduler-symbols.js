// Test script to verify scheduler symbol validation
const { getValidSymbols } = require('./dist/scripts/fetchValidBinanceSymbols.js');
const { DeepResearchScheduler } = require('./dist/services/deepResearchScheduler.js');

async function testSchedulerSymbols() {
  try {
    console.log('Testing scheduler symbol validation...');

    // Test 1: Verify scheduler can load and uses valid symbols
    console.log('\n1. Testing scheduler symbol loading...');
    const scheduler = new DeepResearchScheduler();

    // Get tracked coins (this should only return valid symbols)
    const trackedCoins = await scheduler.getTrackedCoins();
    console.log(`Scheduler returned ${trackedCoins.length} tracked coins`);

    // Verify all tracked coins are valid
    const validSymbols = await getValidSymbols();
    const validSymbolsSet = new Set(validSymbols);

    const invalidInTracked = trackedCoins.filter(coin => !validSymbolsSet.has(coin));
    if (invalidInTracked.length > 0) {
      console.log(`❌ Scheduler returned invalid symbols: ${invalidInTracked.join(', ')}`);
    } else {
      console.log('✅ All scheduler tracked coins are valid');
    }

    // Test 2: Check that invalid symbols are filtered out
    console.log('\n2. Testing invalid symbol filtering...');
    const testInvalidSymbols = [
      'USDTUSDT', 'WETHUSDT', 'CBBTCUSDT', 'WEETHUSDT', 'FIGR_HELOCUSDT',
      'BSCUSDUSDT', 'SUSDSUSDT', 'PYUSDUSDT', 'MUSDT', 'USDT0USDT',
      'CCUSDT', 'SUSDEUSDT', 'INVALID_SYMBOL'
    ];

    let invalidFound = false;
    for (const symbol of testInvalidSymbols) {
      if (validSymbolsSet.has(symbol)) {
        console.log(`❌ Invalid symbol ${symbol} found in valid symbols cache!`);
        invalidFound = true;
      }
    }

    if (!invalidFound) {
      console.log('✅ Invalid symbols are properly filtered out');
    }

    // Test 3: Verify scheduler status
    console.log('\n3. Testing scheduler status...');
    const status = await scheduler.getStatus();
    console.log(`Scheduler status: ${status.isRunning ? 'running' : 'stopped'}`);
    console.log(`Mode: ${status.mode}, Intervals: ${status.intervals.join(', ')}`);

    console.log('\n✅ Scheduler symbol validation test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testSchedulerSymbols();
