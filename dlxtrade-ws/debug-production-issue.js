// COMPREHENSIVE DEBUG SCRIPT - Find the exact root cause of production issues
// This script will test the complete flow and log all operations

const admin = require('firebase-admin');

// Initialize with emulator for testing
if (!admin.apps.length) {
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  admin.initializeApp({
    projectId: 'test-project'
  });
}

const db = admin.firestore();
const { encrypt, decrypt } = require('./dist/services/keyManager');

// Track all operations
const operations = [];
const decryptCalls = [];

// Monkey patch to track operations
const originalDecrypt = decrypt;
global.decrypt = function(cipherText, context) {
  const call = {
    cipherText: cipherText?.substring(0, 20) + '...',
    context,
    timestamp: Date.now(),
    stack: new Error().stack
  };
  decryptCalls.push(call);

  if (context !== "user_request") {
    console.log('🚫 DECRYPT_BLOCKED:', { context: context || "unknown", cipherText: cipherText?.substring(0, 20) });
  }

  return originalDecrypt(cipherText, context);
};

const originalFirestoreSet = admin.firestore.DocumentReference.prototype.set;
admin.firestore.DocumentReference.prototype.set = function(data, options) {
  operations.push({
    type: 'firestore_set',
    path: this.path,
    data: JSON.stringify(data).substring(0, 200) + '...',
    options,
    timestamp: Date.now()
  });
  return originalFirestoreSet.call(this, data, options);
};

async function resetTestUser() {
  console.log('🧹 Resetting test user...');
  const testUid = 'debug_test_user';

  // Delete all user data
  const batch = db.batch();

  // Delete exchangeConfig
  const exchangeConfigRef = db.collection('users').doc(testUid).collection('exchangeConfig').doc('current');
  batch.delete(exchangeConfigRef);

  // Delete integrations
  const integrationsRef = db.collection('users').doc(testUid).collection('integrations');
  const integrationsSnapshot = await integrationsRef.get();
  integrationsSnapshot.docs.forEach(doc => batch.delete(doc.ref));

  await batch.commit();
  console.log('✅ Test user reset complete');
  return testUid;
}

async function testEncryptDecryptRoundTrip() {
  console.log('🔐 Testing encrypt/decrypt round trip...');

  const testData = 'test_api_key_12345';
  console.log('Original data:', testData);

  const encrypted = encrypt(testData);
  console.log('Encrypted:', encrypted?.substring(0, 20) + '...');

  const decrypted = decrypt(encrypted, 'user_request');
  console.log('Decrypted:', decrypted);

  if (decrypted === testData) {
    console.log('✅ Encrypt/decrypt round trip successful');
    return true;
  } else {
    console.log('❌ Encrypt/decrypt round trip FAILED');
    console.log('Expected:', testData);
    console.log('Got:', decrypted);
    return false;
  }
}

async function simulateProviderConfigSave(uid) {
  console.log('📝 Simulating provider config save...');

  const providerConfig = {
    'binance': {
      providerName: 'binance',
      apiKey: 'test_provider_key',
      secretKey: 'test_provider_secret',
      enabled: true,
      type: 'marketdata'
    }
  };

  // Simulate the provider config save logic
  const userRef = db.collection('users').doc(uid);

  for (const [providerId, config] of Object.entries(providerConfig)) {
    console.log(`   Saving provider: ${providerId}`);

    // Encrypt keys
    const encryptedApiKey = encrypt(config.apiKey);
    const encryptedSecretKey = encrypt(config.secretKey);

    // Test decrypt
    console.log('   Testing decrypt round trip...');
    const testApiKey = decrypt(encryptedApiKey, 'user_request');
    const testSecretKey = decrypt(encryptedSecretKey, 'user_request');

    if (testApiKey !== config.apiKey || testSecretKey !== config.secretKey) {
      console.log('❌ TEST_DECRYPT_FAILED_AFTER_ENCRYPT');
      console.log('API Key - Expected:', config.apiKey, 'Got:', testApiKey);
      console.log('Secret Key - Expected:', config.secretKey, 'Got:', testSecretKey);
      return false;
    }

    // Save to integrations
    const docRef = userRef.collection('integrations').doc(providerId);
    await docRef.set({
      enabled: config.enabled,
      apiKey: encryptedApiKey,
      secretKey: encryptedSecretKey,
      type: config.type,
      updatedAt: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now()
    });

    console.log(`   ✅ Provider ${providerId} saved`);
  }

  return true;
}

async function simulateExchangeConnect(uid) {
  console.log('🔗 Simulating exchange connect...');

  const exchangeData = {
    exchange: 'binance',
    apiKey: 'test_exchange_key',
    secret: 'test_exchange_secret'
  };

  // Simulate exchange connect logic
  const exchangeConfigRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');

  // Check existing data
  const existingDoc = await exchangeConfigRef.get();
  const existingData = existingDoc.exists ? existingDoc.data() : {};

  // Resolve exchange
  const resolvedExchange = exchangeData.exchange; // Simplified
  console.log('Resolved exchange:', resolvedExchange);

  // Validate
  if (!resolvedExchange || resolvedExchange.trim() === '') {
    console.log('❌ Exchange validation failed - empty exchange');
    return false;
  }

  // Encrypt
  const encryptedApiKey = encrypt(exchangeData.apiKey);
  const encryptedSecret = encrypt(exchangeData.secret);

  // Create config
  const exchangeConfig = {
    exchange: resolvedExchange,
    apiKeyEncrypted: encryptedApiKey,
    secretEncrypted: encryptedSecret,
    testnet: false,
    updatedAt: admin.firestore.Timestamp.now()
  };

  // Final validation
  if (!exchangeConfig.exchange || typeof exchangeConfig.exchange !== 'string' || exchangeConfig.exchange.trim() === '') {
    console.log('❌ Final exchange validation failed');
    return false;
  }

  // Save
  await exchangeConfigRef.set(exchangeConfig, { merge: true });
  console.log('✅ Exchange config saved');
  console.log('Saved exchange field:', exchangeConfig.exchange);

  return true;
}

async function simulateExchangeConfigRead(uid) {
  console.log('📖 Simulating exchange config read...');

  const exchangeConfigRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');
  const doc = await exchangeConfigRef.get();

  if (!doc.exists) {
    console.log('❌ Exchange config document does not exist');
    return false;
  }

  const data = doc.data();
  console.log('Raw Firestore data:', JSON.stringify(data, null, 2));

  // Check exchange field
  if (!data.exchange) {
    console.log('❌ EXCHANGE FIELD IS UNDEFINED');
    return false;
  }

  if (data.exchange === '') {
    console.log('❌ EXCHANGE FIELD IS EMPTY STRING');
    return false;
  }

  console.log('✅ Exchange field OK:', data.exchange);

  // Simulate isExchangeUsable check
  console.log('🔍 Simulating isExchangeUsable check...');

  const exchange = (data.exchange || "").toLowerCase().trim();
  console.log('Normalized exchange:', exchange);

  if (!["binance", "bitget", "bingx", "weex"].includes(exchange)) {
    console.log('❌ UNSUPPORTED EXCHANGE:', exchange);
    return false;
  }

  console.log('✅ Exchange is supported');

  // Check for encrypted keys
  const hasApiKey = data.apiKeyEncrypted && typeof data.apiKeyEncrypted === 'string' && data.apiKeyEncrypted.trim().length > 0;
  const hasSecretKey = (data.secretEncrypted && typeof data.secretEncrypted === 'string' && data.secretEncrypted.trim().length > 0);

  if (!hasApiKey || !hasSecretKey) {
    console.log('❌ MISSING ENCRYPTED KEYS');
    return false;
  }

  console.log('✅ Encrypted keys present');

  // Try to decrypt (with user_request context)
  const apiKey = decrypt(data.apiKeyEncrypted, 'user_request');
  const secret = decrypt(data.secretEncrypted, 'user_request');

  if (apiKey === null || secret === null) {
    console.log('❌ DECRYPTION FAILED');
    return false;
  }

  console.log('✅ Decryption successful');
  console.log('Usability result: { usable: true, reason: "connected", exchange: "' + exchange + '" }');

  return true;
}

async function runComprehensiveDebug() {
  console.log('🚨 PRODUCTION ISSUE DEBUG STARTED');
  console.log('=====================================\n');

  // Reset operations tracking
  operations.length = 0;
  decryptCalls.length = 0;

  try {
    // Reset test user
    const testUid = await resetTestUser();

    // Test encrypt/decrypt round trip
    const encryptTest = await testEncryptDecryptRoundTrip();
    if (!encryptTest) {
      console.log('❌ CRITICAL: Encrypt/decrypt round trip broken');
      return;
    }

    // Simulate provider config save
    const providerTest = await simulateProviderConfigSave(testUid);
    if (!providerTest) {
      console.log('❌ CRITICAL: Provider config save failed');
      return;
    }

    // Simulate exchange connect
    const exchangeTest = await simulateExchangeConnect(testUid);
    if (!exchangeTest) {
      console.log('❌ CRITICAL: Exchange connect failed');
      return;
    }

    // Simulate exchange config read
    const readTest = await simulateExchangeConfigRead(testUid);
    if (!readTest) {
      console.log('❌ CRITICAL: Exchange config read failed');
      return;
    }

    console.log('\n📊 DEBUG RESULTS');
    console.log('================');

    console.log(`\n🔐 Decrypt Calls (${decryptCalls.length}):`);
    decryptCalls.forEach((call, i) => {
      console.log(`${i + 1}. Context: ${call.context}, CipherText: ${call.cipherText}`);
    });

    console.log(`\n💾 Firestore Operations (${operations.length}):`);
    operations.forEach((op, i) => {
      console.log(`${i + 1}. ${op.type}: ${op.path}`);
      console.log(`   Data: ${op.data}`);
    });

    console.log('\n🎉 ALL TESTS PASSED - Issue appears resolved in this test environment');

  } catch (error) {
    console.error('\n💥 DEBUG EXECUTION FAILED:', error);
  }

  console.log('\n=====================================');
  console.log('DEBUG COMPLETE');
}

runComprehensiveDebug().catch(console.error);

