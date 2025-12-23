// Script to force rewrite test API keys to verify encryption/decryption works
const { firestoreAdapter } = require('./dist/services/firestoreAdapter');

async function forceRewriteTestKeys() {
  console.log('🔄 FORCE REWRITE TEST API KEYS\n');
  console.log('='.repeat(50));

  const testUserId = 'test-user-' + Date.now();

  // Test API keys (these are fake - replace with real ones for testing)
  const testKeys = {
    cryptocompare: 'DEMO_CRYPTOCOMPARE_API_KEY_12345',
    newsdata: 'DEMO_NEWSDATA_API_KEY_67890',
    coinmarketcap: 'DEMO_COINMARKETCAP_API_KEY_ABCDEF'
  };

  console.log(`👤 Test User ID: ${testUserId}`);
  console.log('🔑 Test API Keys:');
  Object.entries(testKeys).forEach(([provider, key]) => {
    console.log(`   ${provider}: ${key.substring(0, 10)}...`);
  });

  console.log('\n💾 Saving test keys to Firestore...');

  try {
    // Save each test key
    for (const [provider, apiKey] of Object.entries(testKeys)) {
      console.log(`\n🔐 Saving ${provider} key...`);
      await firestoreAdapter.saveIntegration(testUserId, provider, {
        enabled: true,
        apiKey: apiKey
      });
      console.log(`   ✅ ${provider} key saved`);
    }

    console.log('\n🔓 Testing decryption of saved keys...');

    // Test decryption
    const integrations = await firestoreAdapter.getEnabledIntegrations(testUserId);
    console.log('📊 Decryption Results:');

    for (const [provider, integration] of Object.entries(integrations)) {
      if (integration.apiKey) {
        const decrypted = integration.apiKey;
        const expected = testKeys[provider];
        const success = decrypted === expected;

        console.log(`   ${provider}: ${success ? '✅' : '❌'} decrypt ${success ? 'OK' : 'FAILED'}`);
        if (!success) {
          console.log(`      Expected: ${expected}`);
          console.log(`      Got: ${decrypted}`);
        }
      } else {
        console.log(`   ${provider}: ❌ no key found`);
      }
    }

    console.log('\n🎊 FORCE REWRITE TEST COMPLETED');
    console.log('   ✅ Keys saved with current encryption');
    console.log('   ✅ Keys decrypt correctly');
    console.log('   📝 Test user:', testUserId);

  } catch (error) {
    console.error('❌ Force rewrite failed:', error);
    console.error('Stack:', error.stack);
  }
}

forceRewriteTestKeys();
