/**
 * Direct Research Engine Test
 * Tests research engine directly without API authentication
 */

const { ResearchEngine } = require('./dist/services/researchEngine');

async function testDirectResearch() {
  console.log('🔍 Testing Research Engine Directly...\n');

  try {
    const engine = new ResearchEngine();

    // Test with BTCUSDT
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

    // Check indicators
    if (result.indicators) {
      console.log('\n📈 Indicators:');
      if (result.indicators.rsi !== null) {
        console.log(`   RSI: ${result.indicators.rsi?.toFixed(2)}`);
      }
      if (result.indicators.macd) {
        console.log(`   MACD: ${result.indicators.macd.histogram?.toFixed(4)}`);
      }
      if (result.indicators.volume !== null) {
        console.log(`   Volume: ${result.indicators.volume}`);
      }
    }

    // Check MTF data
    if (result.mtf) {
      console.log('\n⏰ MTF Data:');
      console.log(`   Available: ${Object.keys(result.mtf.breakdown).length} timeframes`);
      Object.entries(result.mtf.breakdown).forEach(([tf, data]) => {
        if (data.available) {
          console.log(`   ${tf}: RSI=${data.metadata.rsi?.toFixed(2) || 'N/A'}, Score=${data.score.toFixed(2)}`);
        } else {
          console.log(`   ${tf}: Not available`);
        }
      });
      console.log(`   Confluence: ${result.mtf.confluenceMatrix ? Object.keys(result.mtf.confluenceMatrix).length : 0} signals`);
    }

    // Check provider debug
    if (result._providerDebug) {
      console.log('\n🔧 Provider Status:');
      Object.entries(result._providerDebug).forEach(([provider, data]) => {
        if (data && typeof data === 'object') {
          const status = data.status === 'SUCCESS' ? '✅' : '❌';
          console.log(`   ${provider}: ${status} (${data.durationMs || 0}ms)`);
        }
      });
    }

    // Check fallback behavior
    const missingDeps = result.missingDependencies || [];
    if (missingDeps.length > 0) {
      console.log('\n⚠️  Missing Dependencies:');
      missingDeps.forEach(dep => {
        console.log(`   ${dep.api}: ${dep.reason || 'Unknown reason'}`);
      });
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
  testDirectResearch().then(() => {
    console.log('\n✅ Direct research test completed!');
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ Direct research test failed:', err.message);
    process.exit(1);
  });
}

module.exports = { testDirectResearch };
