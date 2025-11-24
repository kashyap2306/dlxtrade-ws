// Test script to verify valid symbols implementation
const { getValidSymbols } = require('./dist/scripts/fetchValidBinanceSymbols.js');
const { TopCoinsService } = require('./dist/services/topCoinsService.js');

async function testValidSymbols() {
  try {
    console.log('Testing valid symbols implementation...');

    // Test 1: Load valid symbols from cache
    console.log('\n1. Loading valid symbols from cache...');
    const validSymbols = await getValidSymbols();
    console.log(`Loaded ${validSymbols.length} valid symbols`);

    // Check for invalid symbols mentioned in the task
    const invalidSymbols = [
      'USDTUSDT', 'WETHUSDT', 'CBBTCUSDT', 'WEETHUSDT', 'FIGR_HELOCUSDT',
      'BSCUSDUSDT', 'SUSDSUSDT', 'PYUSDUSDT', 'MUSDT', 'USDT0USDT',
      'CCUSDT', 'SUSDEUSDT'
    ];

    console.log('\n2. Checking for invalid symbols...');
    let foundInvalid = false;
    for (const invalid of invalidSymbols) {
      if (validSymbols.includes(invalid)) {
        console.log(`❌ FOUND INVALID SYMBOL: ${invalid}`);
        foundInvalid = true;
      }
    }

    if (!foundInvalid) {
      console.log('✅ No invalid symbols found in cache');
    }

    // Test 2: Test top coins service
    console.log('\n3. Testing TopCoinsService...');
    const topCoinsService = new TopCoinsService();
    const top100Coins = await topCoinsService.getTop100Coins();
    console.log(`TopCoinsService returned ${top100Coins.length} coins`);

    // Verify all returned coins are valid
    const invalidInTop100 = top100Coins.filter(coin => !validSymbols.includes(coin));
    if (invalidInTop100.length > 0) {
      console.log(`❌ TopCoinsService returned invalid symbols: ${invalidInTop100.join(', ')}`);
    } else {
      console.log('✅ All TopCoinsService symbols are valid');
    }

    // Test 3: Show some examples
    console.log('\n4. Sample valid symbols:');
    console.log(validSymbols.slice(0, 10).join(', '));

    console.log('\n✅ Valid symbols test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testValidSymbols();
