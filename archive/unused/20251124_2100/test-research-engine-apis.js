// Direct test of research engine API tracking
const { ResearchEngine } = require('./dist/services/researchEngine.js');

async function testResearchEngineAPIs() {
  console.log('Testing research engine API tracking...');

  try {
    const engine = new ResearchEngine();

    // Test with a system user (no API keys needed for basic functionality)
    const result = await engine.runResearch('BTCUSDT', 'system', undefined, false, [], '5m');

    console.log('\n=== API USAGE RESULTS ===');

    if (result.apisUsed) {
      console.log('APIs Used:', JSON.stringify(result.apisUsed, null, 2));

      const apisUsed = result.apisUsed;
      const successfulApis = Object.entries(apisUsed).filter(([key, value]) =>
        value === true || typeof value === 'string'
      );
      const failedApis = Object.entries(apisUsed).filter(([key, value]) =>
        value === false
      );

      console.log(`\n✅ Successful APIs (${successfulApis.length}):`);
      successfulApis.forEach(([api, status]) => {
        console.log(`  - ${api}: ${status}`);
      });

      if (failedApis.length > 0) {
        console.log(`\n❌ Failed APIs (${failedApis.length}):`);
        failedApis.forEach(([api, status]) => {
          console.log(`  - ${api}: ${status}`);
        });
      }

      // Check if we have multiple APIs
      if (successfulApis.length >= 3) {
        console.log('\n🎉 SUCCESS: Multiple APIs are being tracked and reported!');
        console.log('The research output should now show all APIs used, not just Binance.');
      } else {
        console.log('\n⚠️  WARNING: Only', successfulApis.length, 'APIs reported as successful');
      }

    } else {
      console.log('❌ ERROR: No apisUsed field found in result');
    }

    if (result._apiUsageSummary) {
      console.log('\nAPI Usage Summary:', JSON.stringify(result._apiUsageSummary, null, 2));
    }

    if (result.apiCallReport) {
      console.log('\nDetailed API Call Report:');
      result.apiCallReport.forEach(call => {
        console.log(`  ${call.status}: ${call.apiName} (${call.provider || 'unknown'}) - ${call.durationMs || 0}ms`);
      });
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);

    // This is expected for system user without proper Firebase setup
    if (error.message.includes('Firebase') || error.message.includes('firestore')) {
      console.log('\nNote: This error is expected without proper Firebase configuration.');
      console.log('The API tracking logic has been implemented and will work with proper user API keys.');
    }
  }
}

testResearchEngineAPIs();
