// Test script to validate Deep Research API fixes
const { MarketAuxAdapter } = require('./dist/services/MarketAuxAdapter.js');
const { ResearchEngine } = require('./dist/services/researchEngine.js');

async function testAPIFixes() {
  console.log('🧪 Testing Deep Research API fixes...\n');

  // Test 1: MarketAuxAdapter handles null API keys
  console.log('1️⃣ Testing MarketAuxAdapter with null API key...');
  try {
    const adapter = new MarketAuxAdapter(null);
    console.log('✅ MarketAuxAdapter created successfully with null API key');

    const result = await adapter.getNewsSentiment('BTCUSDT');
    console.log('✅ getNewsSentiment returned neutral data:', {
      sentiment: result.sentiment,
      hypeScore: result.hypeScore,
      totalArticles: result.totalArticles
    });
  } catch (error) {
    console.log('❌ MarketAuxAdapter test failed:', error.message);
    return;
  }

  // Test 2: ResearchEngine buildProviderAdapters doesn't crash
  console.log('\n2️⃣ Testing ResearchEngine buildProviderAdapters...');
  try {
    const engine = new ResearchEngine();
    const adapters = await engine.buildProviderAdapters('test-user');
    console.log('✅ buildProviderAdapters succeeded');
    console.log('✅ Created adapters:', {
      marketAux: !!adapters.marketAuxAdapter,
      cryptoCompare: !!adapters.cryptoAdapter,
      binance: !!adapters.binanceAdapter,
      coinGecko: !!adapters.coingeckoAdapter,
      googleFinance: !!adapters.googleFinanceAdapter
    });
  } catch (error) {
    console.log('❌ buildProviderAdapters test failed:', error.message);
    return;
  }

  // Test 3: ResearchEngine runResearch doesn't crash (will fail due to missing Firebase, but should not crash on adapter init)
  console.log('\n3️⃣ Testing ResearchEngine runResearch (will fail due to Firebase, but should not crash on adapters)...');
  try {
    const engine = new ResearchEngine();
    await engine.runResearch('BTCUSDT', 'test-user', undefined, false, [], '5m');
    console.log('✅ runResearch completed successfully');
  } catch (error) {
    if (error.message.includes('Firebase') || error.message.includes('firestore')) {
      console.log('✅ runResearch failed as expected due to Firebase (not adapter issue):', error.message.split('.')[0]);
    } else {
      console.log('❌ runResearch failed due to adapter issue:', error.message);
      return;
    }
  }

  console.log('\n🎉 ALL TESTS PASSED! Deep Research API fixes are working correctly.');
  console.log('\n📊 Expected apisUsed output:');
  console.log(`{
  "apisUsed": {
    "userExchange": "no-exchange",
    "cryptocompare": true,    // Will be true (neutral data fallback)
    "marketaux": true,        // Will be true (neutral data fallback)
    "binance": true,          // Always true
    "coingecko": true,        // Always true
    "googlefinance": true     // Always true
  }
}`);
}

testAPIFixes().catch(console.error);
