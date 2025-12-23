// Test script for FREE MODE Deep Research v1.5
const { runFreeModeDeepResearch } = require('./dist/services/deepResearchEngine');

async function testFreeModeDeepResearch() {
  console.log('🆓 FREE MODE DEEP RESEARCH v1.5 TEST\n');
  console.log('=' .repeat(60));

  try {
    // Test with a test user ID
    const testUserId = 'test-user-free-mode-' + Date.now();

    console.log(`👤 Test User ID: ${testUserId}`);
    console.log('🔑 Testing FREE MODE with backup API support\n');

    // Test FREE MODE Deep Research
    console.log('🔬 PHASE 1: FREE MODE DEEP RESEARCH');
    console.log('-'.repeat(40));

    const startTime = Date.now();

    const result = await runFreeModeDeepResearch(testUserId, 'BTCUSDT');

    const duration = Date.now() - startTime;

    console.log('✅ FREE MODE Research completed!');
    console.log(`   Duration: ${duration}ms`);
    console.log(`   Signal: ${result.signal}`);
    console.log(`   Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);

    // Analyze providers
    console.log('\n📊 PHASE 2: PROVIDER ANALYSIS');
    console.log('-'.repeat(30));

    const providers = result.raw;
    console.log(`Binance: ${providers.binance ? '✅ Available' : '❌ Failed'}`);
    console.log(`CryptoCompare: ${providers.cryptocompare ? '✅ Available' : '❌ Failed'}`);
    console.log(`CoinMarketCap: ${providers.cmc ? '✅ Available' : '❌ Failed'}`);
    console.log(`News: ${providers.news ? '✅ Available' : '❌ Failed'}`);

    // Analyze indicators
    console.log('\n📈 PHASE 3: INDICATORS ANALYSIS');
    console.log('-'.repeat(30));

    const indicators = result.indicators;
    console.log(`RSI: ${indicators.rsi?.value?.toFixed(2) || 'N/A'}`);
    console.log(`MA50 Trend: ${indicators.ma50?.smaTrend || 'N/A'}`);
    console.log(`EMA20 Trend: ${indicators.ema20?.emaTrend || 'N/A'}`);
    console.log(`Volume Trend: ${indicators.volume?.trend || 'N/A'}`);

    // Analyze metadata
    console.log('\n📋 PHASE 4: METADATA ANALYSIS');
    console.log('-'.repeat(30));

    const metadata = result.metadata;
    console.log(`Name: ${metadata.name || 'N/A'}`);
    console.log(`Symbol: ${metadata.symbol || 'N/A'}`);
    console.log(`Category: ${metadata.category || 'N/A'}`);
    console.log(`Rank: ${metadata.rank || 'N/A'}`);
    console.log(`Supply (Circulating): ${metadata.supply?.circulating ? metadata.supply.circulating.toLocaleString() : 'N/A'}`);

    // Analyze news
    console.log('\n📰 PHASE 5: NEWS ANALYSIS');
    console.log('-'.repeat(25));

    const news = result.news || [];
    console.log(`News articles: ${news.length}`);
    if (news.length > 0) {
      console.log('Recent articles:');
      news.slice(0, 3).forEach((article, i) => {
        console.log(`  ${i + 1}. ${article.title.substring(0, 60)}... (${article.sentiment})`);
      });
    }

    console.log('\n🎯 FINAL RESULT SUMMARY');
    console.log('='.repeat(30));
    console.log(`Signal: ${result.signal}`);
    console.log(`Accuracy: ${(result.accuracy * 100).toFixed(1)}%`);
    console.log(`Duration: ${duration}ms`);
    console.log(`Mode: FREE MODE v1.5 with backup APIs`);

    console.log('\n✅ FREE MODE DEEP RESEARCH TEST COMPLETED SUCCESSFULLY!');
    console.log('🔄 Deep Research must NEVER fail unless Binance itself fails');

  } catch (error) {
    console.error('\n❌ FREE MODE DEEP RESEARCH TEST FAILED:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testFreeModeDeepResearch().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
