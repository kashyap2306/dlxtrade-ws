const { researchEngine } = require('./dist/services/researchEngine');

async function testManualResearch() {
  console.log('🧪 Testing Manual Deep Research\n');

  const testUid = 'QZKe6lcZ4dWv2kxg4rLL8razOQK2'; // Test UID from check script
  const symbol = 'TNSRUSDT';

  console.log(`Testing with UID: ${testUid}`);
  console.log(`Testing with symbol: ${symbol}\n`);

  try {
    console.log('Starting research...');
    const startTime = Date.now();

    const result = await researchEngine.runResearch(symbol, testUid, undefined, false, undefined, '5m');

    const duration = Date.now() - startTime;
    console.log(`\n✅ Research completed in ${duration}ms`);
    console.log('='.repeat(50));

    console.log('📊 RESULTS:');
    console.log(`Symbol: ${result.symbol}`);
    console.log(`Signal: ${result.signal}`);
    console.log(`Confidence: ${result.confidence.toFixed(2)}%`);
    console.log(`Status: ${result.status}`);
    console.log(`Message: ${result.message}`);

    console.log('\n🎯 FEATURES:');
    console.log(`RSI: ${result.features?.rsi || 'N/A'}`);
    console.log(`Funding Rate: ${result.features?.fundingRate || 'N/A'}`);
    console.log(`Open Interest: ${result.features?.openInterest || 'N/A'}`);
    console.log(`Liquidations: ${result.features?.liquidations || 'N/A'}`);
    console.log(`News Sentiment: ${result.features?.newsSentiment || 'N/A'}`);

    console.log('\n📈 API CALL REPORT:');
    result.apiCallReport.forEach(call => {
      const statusIcon = call.status === 'SUCCESS' ? '✅' : call.status === 'FAILED' ? '❌' : '⏭️';
      console.log(`${statusIcon} ${call.apiName}: ${call.status}${call.message ? ` - ${call.message}` : ''}`);
    });

    if (result.missingDependencies && result.missingDependencies.length > 0) {
      console.log('\n⚠️ MISSING DEPENDENCIES:');
      result.missingDependencies.forEach(dep => {
        console.log(`- ${dep.api}: ${dep.reason || 'Missing API key'}`);
      });
    }

    console.log('\n🔍 DEBUG INFO:');
    console.log(`Provider APIs Used: ${Object.keys(result._providerDebug || {}).join(', ')}`);

  } catch (error) {
    console.error('❌ Research failed:');
    console.error(error.message);
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
  }
}

testManualResearch();
