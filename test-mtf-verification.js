/**
 * MTF Pipeline Verification Test
 * Tests the Multi-Timeframe indicator functionality
 */

const { CryptoCompareAdapter } = require('./dist/services/cryptoCompareAdapter');

async function testMTF() {
  console.log('🔍 Testing MTF Indicator Pipeline...\n');

  // Test with a mock/dummy key to see if the code works
  const adapter = new CryptoCompareAdapter('dummy_key');

  try {
    // Test MTF indicators for different timeframes
    const timeframes = ['5m', '15m', '1h'];

    console.log('📊 Testing MTF indicator calculation...\n');

    for (const tf of timeframes) {
      try {
        console.log(`Testing ${tf} timeframe...`);
        const indicators = await adapter.getMTFIndicators('BTC', tf);

        console.log(`  ✅ ${tf} indicators retrieved:`);
        console.log(`     RSI: ${indicators.rsi}`);
        console.log(`     MACD: ${indicators.macd ? `value=${indicators.macd.value?.toFixed(4)}, signal=${indicators.macd.signal?.toFixed(4)}, hist=${indicators.macd.histogram?.toFixed(4)}` : 'null'}`);
        console.log(`     EMA12: ${indicators.ema12?.toFixed(4)}`);
        console.log(`     EMA26: ${indicators.ema26?.toFixed(4)}`);
        console.log(`     SMA20: ${indicators.sma20?.toFixed(4)}`);
        console.log('');

      } catch (error) {
        console.log(`  ❌ ${tf} failed: ${error.message}`);
        console.log('');
      }
    }

    // Test confluence calculation
    console.log('🎯 Testing MTF confluence calculation...\n');

    // Mock data for confluence test
    const mockMTFData = {
      "5m": { timeframe: "5m", rsi: 65, macd: { value: 10, signal: 8, histogram: 2 }, ema12: 45000, ema26: 44800, sma20: 44900 },
      "15m": { timeframe: "15m", rsi: 55, macd: { value: 12, signal: 10, histogram: 2 }, ema12: 45100, ema26: 44900, sma20: 45000 },
      "1h": { timeframe: "1h", rsi: 50, macd: { value: 8, signal: 9, histogram: -1 }, ema12: 44900, ema26: 45100, sma20: 45000 }
    };

    const confluence = adapter.calculateMTFConfluence(mockMTFData);

    console.log('📈 MTF Confluence Results:');
    console.log(`   Score: ${confluence.score}/${confluence.maxScore} (${confluence.label})`);
    console.log('   Details:');
    Object.entries(confluence.details).forEach(([tf, detail]) => {
      console.log(`     ${tf}: ${detail}`);
    });

    console.log('');
    console.log('🎯 Expected results with mock data:');
    console.log('   - 5m RSI > 55: ✅ PASS');
    console.log('   - 15m MACD hist > 0: ✅ PASS');
    console.log('   - 1h EMA12 > EMA26: ❌ FAIL (mock data shows EMA12 < EMA26)');
    console.log('   - Expected score: 2/3');
    console.log('');

    if (confluence.score === 2 && confluence.label === '2/3') {
      console.log('✅ MTF confluence calculation: PASS');
    } else {
      console.log('❌ MTF confluence calculation: FAIL');
    }

  } catch (error) {
    console.log(`❌ MTF test failed: ${error.message}`);
  }
}

if (require.main === module) {
  testMTF().catch(console.error);
}

module.exports = { testMTF };
