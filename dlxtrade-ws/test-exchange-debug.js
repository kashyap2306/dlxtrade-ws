/**
 * EXCHANGE DEBUG TEST
 *
 * Tests credential consistency across exchange operations
 */

const admin = require('firebase-admin');
const { getFirebaseAdmin } = require('./dist/utils/firebase');

const db = admin.firestore(getFirebaseAdmin());

// Test user credentials (REPLACE WITH REAL ONES FOR TESTING)
const TEST_UID = 'test-exchange-debug-user';
const TEST_CREDENTIALS = {
  exchange: 'binance',
  apiKey: 'YOUR_TEST_API_KEY',
  secret: 'YOUR_TEST_SECRET',
  testnet: true
};

async function setupTestUser() {
  console.log('🔧 Setting up test user for exchange debugging...');

  await db.collection('users').doc(TEST_UID).set({
    displayName: 'Exchange Debug Test User',
    email: 'debug@test.com'
  });

  // Store encrypted credentials
  const { encrypt } = require('./dist/services/keyManager');
  await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set({
    exchange: TEST_CREDENTIALS.exchange,
    apiKeyEncrypted: encrypt(TEST_CREDENTIALS.apiKey),
    secretEncrypted: encrypt(TEST_CREDENTIALS.secret),
    testnet: TEST_CREDENTIALS.testnet,
    exchangeStatus: 'CONNECTED'
  });

  console.log('✅ Test user setup complete');
  console.log('📋 Test Instructions:');
  console.log('1. Replace TEST_CREDENTIALS with real exchange API keys');
  console.log('2. Start backend: npm run dev');
  console.log('3. Run these API calls and check logs:');
  console.log('   - POST /api/exchange/test with plaintext keys');
  console.log('   - POST /api/exchange/connect with plaintext keys');
  console.log('   - POST /api/exchange/test-trade with stored encrypted keys');
  console.log('4. Verify all logs show same credential structure and masking');
}

async function cleanupTestUser() {
  try {
    await db.collection('users').doc(TEST_UID).delete();
    console.log('🧹 Test user cleaned up');
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Run setup if called directly
if (require.main === module) {
  setupTestUser()
    .then(() => {
      console.log('\n🎯 READY FOR MANUAL TESTING');
      console.log('Check backend logs for credential consistency');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}
