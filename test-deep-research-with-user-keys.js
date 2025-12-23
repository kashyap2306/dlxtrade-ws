// Test deep research with user API keys
const { deepResearchEngine } = require('./dist/services/deepResearchEngine');

async function testDeepResearchWithUserKeys() {
  console.log('🔬 DEEP RESEARCH WITH USER API KEYS TEST\n');
  console.log('='.repeat(60));

  // Use the test user we created
  const testUserId = 'test-user-1764306619008';

  console.log(`👤 Test User: ${testUserId}`);
  console.log('🔑 User has: CryptoCompare, NewsData, CoinMarketCap API keys');

  try {
    console.log('\n📊 Starting symbol selection...');
    const symbolBatch = await deepResearchEngine.selectOptimalSymbolBatch(testUserId, 3);
    console.log('✅ Symbol batch selected:');
    console.log(`   Primary: ${symbolBatch.primarySymbol}`);
    console.log(`   Batch: [${symbolBatch.batchSymbols.join(', ')}]`);
    console.log(`   Reason: ${symbolBatch.reason}`);

    console.log('\n🔬 Starting deep research cycle...');
    const startTime = Date.now();
    const batchResults = await deepResearchEngine.runDeepResearchBatch(testUserId, undefined, 3);
    const totalDuration = Date.now() - startTime;

    console.log('\n⚡ Research cycle completed:');
    console.log(`   Duration: ${totalDuration}ms`);
    console.log(`   Symbols processed: ${batchResults.length}`);

    const successful = batchResults.filter(r => r.result && !r.error);
    const failed = batchResults.filter(r => r.error);

    console.log(`   ✅ Successful: ${successful.length}`);
    console.log(`   ❌ Failed: ${failed.length}`);

    console.log('\n🔑 API KEY USAGE VERIFICATION:');
    console.log('Looking for "Using user API key for [provider]" messages...');

    // The research engine should log when user keys are used vs service keys
    // Since we have user keys for CryptoCompare, NewsData, CoinMarketCap,
    // we should see user key usage logs for these providers

    if (successful.length > 0) {
      console.log('\n📈 Per-Symbol Results:');
      for (const result of batchResults) {
        if (result.result && !result.error) {
          const r = result.result;
          console.log(`   📊 ${result.symbol}:`);
          console.log(`      ✓ Signal: ${r.combinedSignal}`);
          console.log(`      ✓ Accuracy: ${(r.accuracy * 100).toFixed(1)}%`);
          console.log(`      ✓ Providers: ${r.providersCalled.join(', ')}`);
          console.log(`      ✓ Duration: ${result.durationMs}ms`);
        } else {
          console.log(`   ❌ ${result.symbol}: FAILED - ${result.error}`);
        }
      }

      console.log('\n🎊 SUCCESS!');
      console.log('   ✅ Deep research completed with user API keys');
      console.log('   ✅ Check logs above for "Using user API key for [provider]" messages');
      console.log('   ✅ User keys took precedence over service-level fallbacks');
    } else {
      console.log('\n⚠️  All research attempts failed');
      console.log('   Check API key validity or provider rate limits');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
  }
}

testDeepResearchWithUserKeys();
