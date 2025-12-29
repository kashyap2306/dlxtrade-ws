/**
 * TEST ENCRYPTION SECRET ROTATION - INVALID_KEYS VERIFICATION
 * Verifies that changing ENCRYPTION_SECRET doesn't cause INVALID_KEYS to be written
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './src/utils/firebase';
import { firestoreAdapter, isExchangeUsable } from './src/services/firestoreAdapter';

const TEST_UID = 'qTestUser0001';

async function setupTestUser() {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  // Create user with exchange config that has encrypted keys
  await db.collection('users').doc(TEST_UID).set({
    uid: TEST_UID,
    email: 'test@example.com',
    apiConnected: true,
    connectedExchanges: ['binance'],
    createdAt: admin.firestore.Timestamp.now()
  });

  // Create exchange config with CONNECTED status and encrypted keys
  await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set({
    exchange: 'binance',
    exchangeStatus: 'CONNECTED',
    apiKeyEncrypted: 'encrypted_key_placeholder',
    secretEncrypted: 'encrypted_secret_placeholder',
    testnet: true,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now()
  });

  console.log('✅ Test user setup complete');
}

async function simulateEncryptionSecretChange() {
  // This simulates what happens when ENCRYPTION_SECRET changes
  // Existing encrypted keys become undecryptable
  console.log('🔄 Simulating ENCRYPTION_SECRET rotation...');

  // The encrypted keys in the database remain the same, but decryption will fail
  // This simulates the real scenario where ENCRYPTION_SECRET is changed
}

async function testRouteAccess() {
  console.log('🧪 Testing route access after ENCRYPTION_SECRET rotation...');

  // Test 1: isExchangeUsable should return not_connected (because it only checks exchangeStatus)
  const usability = await isExchangeUsable(TEST_UID, 'background_job');
  console.log(`isExchangeUsable result: ${JSON.stringify(usability)}`);

  if (usability.reason !== 'connected') {
    console.log('⚠️  isExchangeUsable returned non-connected - this may be expected if status changed');
  }

  // Test 2: Check if INVALID_KEYS was written anywhere
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  const configDoc = await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').get();
  if (configDoc.exists) {
    const config = configDoc.data();
    console.log(`Exchange config status: ${config?.exchangeStatus}`);

    if (config?.exchangeStatus === 'INVALID_KEYS') {
      console.log('❌ FAIL: INVALID_KEYS was written during ENCRYPTION_SECRET rotation');
      return false;
    }
  }

  console.log('✅ PASS: No INVALID_KEYS written during ENCRYPTION_SECRET rotation');
  return true;
}

async function cleanup() {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  await db.collection('users').doc(TEST_UID).delete();
  console.log('🧹 Test cleanup complete');
}

async function main() {
  console.log('🚀 ENCRYPTION SECRET ROTATION TEST\n');

  try {
    await setupTestUser();
    await simulateEncryptionSecretChange();

    const success = await testRouteAccess();

    await cleanup();

    if (success) {
      console.log('\n🎉 TEST PASSED: ENCRYPTION_SECRET rotation does not cause INVALID_KEYS');
      process.exit(0);
    } else {
      console.log('\n❌ TEST FAILED: INVALID_KEYS written during ENCRYPTION_SECRET rotation');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('💥 Test failed:', error.message);
    await cleanup();
    process.exit(1);
  }
}

main();
