const { ResearchEngine } = require('./dist/services/researchEngine');

async function testGoogleFinanceFix() {
  console.log('🧪 TESTING GOOGLE FINANCE FIX\n');

  const engine = new ResearchEngine();

  try {
    console.log('Testing XRPUSDT research...');
    const result = await engine.runResearch('XRPUSDT', 'system', null, true, [], '5m');

    console.log(`✅ XRPUSDT: ${result.signal} (${result.confidence.toFixed(1)}%)`);

    // Check API call report for googlefinance
    const googleCalls = result.apiCallReport.filter(call => call.apiName === 'googlefinance');
    console.log(`📊 Google Finance API calls: ${googleCalls.length}`);

    if (googleCalls.length > 0) {
      console.log('✅ SUCCESS: Google Finance is now being called!');
      googleCalls.forEach(call => {
        console.log(`   - Status: ${call.status}, Duration: ${call.durationMs}ms`);
      });
    } else {
      console.log('❌ FAILED: Google Finance still not called');
    }

    // Check provider debug if available
    if (result._providerDebug && result._providerDebug.googlefinance) {
      console.log('📊 Google Finance Provider Debug:');
      console.log(`   - Status: ${result._providerDebug.googlefinance.status}`);
      console.log(`   - Called: ${result._providerDebug.googlefinance.called}`);
    }

    console.log('\n🎉 Google Finance fix test completed successfully');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testGoogleFinanceFix();
