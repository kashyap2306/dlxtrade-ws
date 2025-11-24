/**
 * Test Fixed Research Engine
 * Tests the research engine directly with optional providers
 */

const { ResearchEngine } = require('./dist/services/researchEngine');

async function testFixedResearch() {
  console.log('🧪 Testing Fixed Research Engine...\n');

  try {
    const engine = new ResearchEngine();

    // Test with BTCUSDT and no API keys (should work with free providers only)
    const result = await engine.runResearch(
      'BTCUSDT',
      'system', // system user
      null, // no adapter override
      true, // force engine
      [], // no legacy adapters
      '5m' // timeframe
    );

    console.log('✅ Research completed successfully!');
    console.log('📊 Results Summary:');
    console.log(`   Symbol: ${result.symbol}`);
    console.log(`   Current Price: ${result.currentPrice}`);
    console.log(`   Signal: ${result.signal}`);
    console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`   Mode: ${result.mode}`);
    console.log(`   API Calls: ${result.apiCallReport?.length || 0}`);

    // Check MTF data
    if (result.mtf) {
      console.log('\n⏰ MTF Data:');
      if (result.mtf.breakdown) {
        console.log(`   Available: ${Object.keys(result.mtf.breakdown).length} timeframes`);
        Object.entries(result.mtf.breakdown).forEach(([tf, data]) => {
          if (data && data.available) {
            console.log(`   ${tf}: RSI=${data.metadata?.rsi?.toFixed(2) || 'N/A'}, Score=${data.score?.toFixed(2) || 'N/A'}`);
          } else {
            console.log(`   ${tf}: Not available`);
          }
        });
      } else {
        console.log('   Breakdown: Not available');
      }
      console.log(`   Confluence: ${result.mtf.confluenceMatrix ? Object.keys(result.mtf.confluenceMatrix).length : 0} signals`);
    } else {
      console.log('\n⏰ MTF Data: Not available (CryptoCompare key missing)');
    }

    // Check provider debug
    if (result._providerDebug) {
      console.log('\n🔧 Provider Status:');
      Object.entries(result._providerDebug).forEach(([provider, data]) => {
        if (data && typeof data === 'object') {
          const status = data.status === 'SUCCESS' ? '✅' : data.status === 'ERROR' ? '❌' : '⏭️';
          console.log(`   ${provider}: ${status} (${data.durationMs || 0}ms)`);
          if (data.error) {
            console.log(`     Error: ${data.error}`);
          }
        }
      });
    }

    // Check features
    if (result.features) {
      console.log('\n📈 Features Status:');
      console.log(`   RSI: ${result.features.rsi ? 'Available' : 'Not Available'}`);
      console.log(`   MACD: ${result.features.macd ? 'Available' : 'Not Available'}`);
      console.log(`   Volume: ${result.features.volume ? 'Available' : 'Not Available'}`);
      console.log(`   News Sentiment: ${result.features.newsSentiment || 'Not Available'}`);
    }

    return result;

  } catch (error) {
    console.error('❌ Research failed:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  }
}

// Run test
if (require.main === module) {
  testFixedResearch().then(() => {
    console.log('\n✅ Fixed research test completed successfully!');
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ Fixed research test failed:', err.message);
    process.exit(1);
  });
}

module.exports = { testFixedResearch };
