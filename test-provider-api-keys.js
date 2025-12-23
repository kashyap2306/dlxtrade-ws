// Test script to verify provider API keys work correctly
const { firestoreAdapter } = require('./dist/services/firestoreAdapter');
const { CryptoCompareAdapter } = require('./dist/services/cryptocompareAdapter');
const { fetchCoinMarketCapListings } = require('./dist/services/coinMarketCapAdapter');
const { fetchNewsData } = require('./dist/services/newsDataAdapter');
const config = require('./dist/config');

async function testProviderAPIKeys() {
  console.log('🧪 PROVIDER API KEYS TEST\n');
  console.log('=' .repeat(60));

  try {
    // Use a test user ID
    const testUserId = 'test-user-api-keys-' + Date.now();
    console.log(`👤 Test User ID: ${testUserId}\n`);

    // Get integrations (should return service-level keys since no user keys exist)
    console.log('🔑 PHASE 1: GETTING INTEGRATIONS');
    console.log('-'.repeat(30));

    const integrations = await firestoreAdapter.getEnabledIntegrations(testUserId);
    console.log('Available integrations:', Object.keys(integrations));

    // Test 1: CryptoCompare - Get BTC price
    console.log('\n📊 PHASE 2: CRYPTOCOMPARE TEST (BTC Price)');
    console.log('-'.repeat(30));

    try {
      const ccApiKey = integrations.cryptocompare?.apiKey || config.research.cryptocompare.apiKey;
      if (!ccApiKey) {
        console.log("TEST-RESULT", { provider: 'CryptoCompare', success: false, error: 'No API key available' });
      } else {
        const ccAdapter = new CryptoCompareAdapter(ccApiKey);
        const btcData = await ccAdapter.getMarketData('BTC');
        const success = btcData && btcData.price && btcData.price > 0;

        console.log("TEST-RESULT", {
          provider: 'CryptoCompare',
          success,
          error: success ? null : 'Invalid response or zero price',
          price: btcData?.price
        });
      }
    } catch (error) {
      console.log("TEST-RESULT", { provider: 'CryptoCompare', success: false, error: error.message });
    }

    // Test 2: CoinMarketCap - Get top 100 symbols
    console.log('\n💎 PHASE 3: COINMARKETCAP TEST (Top 100)');
    console.log('-'.repeat(30));

    try {
      const cmcApiKey = integrations.coinmarketcap?.apiKey || config.research.coinmarketcap.apiKey;
      if (!cmcApiKey) {
        console.log("TEST-RESULT", { provider: 'CoinMarketCap', success: false, error: 'No API key available' });
      } else {
        const listings = await fetchCoinMarketCapListings(cmcApiKey, 100);
        const success = listings && listings.length > 0;

        console.log("TEST-RESULT", {
          provider: 'CoinMarketCap',
          success,
          error: success ? null : 'No listings returned',
          count: listings?.length || 0
        });
      }
    } catch (error) {
      console.log("TEST-RESULT", { provider: 'CoinMarketCap', success: false, error: error.message });
    }

    // Test 3: NewsData - Get crypto news
    console.log('\n📰 PHASE 4: NEWSDATA TEST (Crypto Category)');
    console.log('-'.repeat(30));

    try {
      const newsApiKey = integrations.newsdata?.apiKey || config.research.newsdata.apiKey;
      if (!newsApiKey) {
        console.log("TEST-RESULT", { provider: 'NewsData', success: false, error: 'No API key available' });
      } else {
        const newsData = await fetchNewsData(newsApiKey, 'BTC');
        const success = newsData && newsData.articles && newsData.articles.length >= 0; // Allow empty array

        console.log("TEST-RESULT", {
          provider: 'NewsData',
          success,
          error: success ? null : 'Invalid response',
          articleCount: newsData?.articles?.length || 0,
          sentiment: newsData?.sentiment
        });
      }
    } catch (error) {
      console.log("TEST-RESULT", { provider: 'NewsData', success: false, error: error.message });
    }

    console.log('\n✅ TEST COMPLETED');
    console.log('=' .repeat(60));

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testProviderAPIKeys().catch(console.error);
