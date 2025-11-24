/**
 * API KEYS CHECK TEST
 * Check what API keys are stored in Firestore
 */

const { firestoreAdapter } = require('./dist/services/firestoreAdapter');

async function checkAPIKeys() {
  console.log('🔑 API KEYS CHECK TEST');
  console.log('=====================');

  try {
    // Check what API keys are stored
    console.log('Checking stored API keys for user "system"...\n');

    const providerKeys = await firestoreAdapter.getUserProviderApiKeys('system');

    console.log('📋 STORED API KEYS:');
    console.log('==================');

    const providers = ['marketaux', 'cryptocompare', 'binance', 'coingecko', 'googlefinance'];

    providers.forEach(provider => {
      const keyData = providerKeys[provider];
      if (keyData && keyData.apiKey) {
        const keyLength = keyData.apiKey.length;
        const maskedKey = keyData.apiKey.substring(0, 8) + '...' + keyData.apiKey.substring(keyLength - 4);
        console.log(`✅ ${provider}: ${maskedKey} (${keyLength} chars)`);
      } else {
        console.log(`❌ ${provider}: NOT STORED`);
      }
    });

    console.log('\n🔍 VERIFICATION:');
    const marketAuxStored = providerKeys.marketaux?.apiKey;
    const cryptoCompareStored = providerKeys.cryptocompare?.apiKey;

    console.log(`MarketAux key stored: ${!!marketAuxStored}`);
    console.log(`CryptoCompare key stored: ${!!cryptoCompareStored}`);

    if (marketAuxStored && cryptoCompareStored) {
      console.log('\n✅ BOTH REQUIRED API KEYS ARE STORED');
      console.log('The fallback behavior suggests keys may be invalid or expired.');
      console.log('Try running a direct API test with each key.');
    } else {
      console.log('\n❌ MISSING REQUIRED API KEYS');
      console.log('This explains why fallback data is being used.');
    }

    return {
      marketAuxStored: !!marketAuxStored,
      cryptoCompareStored: !!cryptoCompareStored,
      providerKeys
    };

  } catch (error) {
    console.error('❌ API keys check failed:', error.message);
    return { error: error.message };
  }
}

// Test individual API keys
async function testIndividualAPIs() {
  console.log('\n🧪 TESTING INDIVIDUAL API KEYS:');
  console.log('==============================');

  try {
    const providerKeys = await firestoreAdapter.getUserProviderApiKeys('system');

    // Test MarketAux
    if (providerKeys.marketaux?.apiKey) {
      console.log('Testing MarketAux API key...');
      try {
        const { MarketAuxAdapter } = require('./dist/services/MarketAuxAdapter');
        const adapter = new MarketAuxAdapter(providerKeys.marketaux.apiKey);
        const result = await adapter.getNewsSentiment('BTC');
        console.log(`✅ MarketAux: Working - Sentiment: ${result.sentiment}`);
      } catch (error) {
        console.log(`❌ MarketAux: Failed - ${error.message}`);
      }
    }

    // Test CryptoCompare
    if (providerKeys.cryptocompare?.apiKey) {
      console.log('Testing CryptoCompare API key...');
      try {
        const { CryptoCompareAdapter } = require('./dist/services/cryptoCompareAdapter');
        const adapter = new CryptoCompareAdapter(providerKeys.cryptocompare.apiKey);
        const result = await adapter.getAllMetrics('BTC');
        console.log(`✅ CryptoCompare: Working - RSI: ${result.indicators?.rsi}`);
      } catch (error) {
        console.log(`❌ CryptoCompare: Failed - ${error.message}`);
      }
    }

  } catch (error) {
    console.error('Individual API test failed:', error.message);
  }
}

// Run tests
if (require.main === module) {
  checkAPIKeys().then(async (result) => {
    if (!result.error) {
      await testIndividualAPIs();
    }
  }).catch(console.error);
}

module.exports = { checkAPIKeys, testIndividualAPIs };
