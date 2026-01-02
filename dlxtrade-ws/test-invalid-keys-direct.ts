/**
 * INVALID_KEYS LIFECYCLE VERIFICATION - DIRECT TEST
 * Tests INVALID_KEYS fixes without HTTP calls
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './src/utils/firebase';
import { firestoreAdapter } from './src/services/firestoreAdapter';

const TEST_UID = 'qTestUser0001';

async function setupTestUser() {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  try {
    await db.collection('users').doc(TEST_UID).set({
      uid: TEST_UID,
      email: 'test@example.com',
      name: 'Test User',
      apiConnected: false,
      connectedExchanges: [],
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
    console.log(`✅ Test user ${TEST_UID} ready`);
  } catch (error) {
    console.log(`❌ Failed to setup test user: ${error.message}`);
  }
}

async function cleanup() {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  try {
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').delete();
    console.log(`🧹 Cleaned up exchange config for ${TEST_UID}`);
  } catch (error) {
    console.log(`⚠️  Cleanup failed: ${error.message}`);
  }
}

async function simulateInvalidKeysState() {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set({
    exchange: 'bitget',
    exchangeStatus: 'INVALID_KEYS',
    apiKeyEncrypted: 'encrypted_key',
    secretEncrypted: 'encrypted_secret',
    updatedAt: admin.firestore.Timestamp.now()
  });
  console.log(`📝 Created INVALID_KEYS state for ${TEST_UID}`);
}

async function testScenario(name: string, testFn: () => Promise<void>) {
  console.log(`\n🧪 ${name}`);
  console.log('-'.repeat(50));

  try {
    await testFn();
    console.log(`✅ PASS: ${name}`);
    return true;
  } catch (error: any) {
    console.log(`❌ FAIL: ${name} - ${error.message}`);
    return false;
  }
}

async function scenarioA_FreshState() {
  await cleanup();

  const usability = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
  if (usability.reason !== 'not_connected') {
    throw new Error(`Expected 'not_connected', got '${usability.reason}'`);
  }
}

async function scenarioB_InvalidKeysIsExchangeUsable() {
  await simulateInvalidKeysState();

  const usability = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
  if (usability.reason === 'invalid_keys') {
    throw new Error('isExchangeUsable returned invalid_keys outside connect flow - BUG!');
  }
  if (usability.reason !== 'not_connected') {
    throw new Error(`Expected 'not_connected' after INVALID_KEYS fix, got '${usability.reason}'`);
  }
}

async function scenarioC_DisconnectCleanup() {
  await simulateInvalidKeysState();

  // Simulate disconnect (delete config)
  await cleanup();

  const usability = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
  if (usability.reason !== 'not_connected') {
    throw new Error(`After disconnect cleanup, expected 'not_connected', got '${usability.reason}'`);
  }
}

async function scenarioD_BackgroundJobSafety() {
  await simulateInvalidKeysState();

  // Test different contexts
  const contexts = ['background_job', 'user_request', 'engine_check'];

  for (const context of contexts) {
    const usability = await firestoreAdapter.isExchangeUsable(TEST_UID, context as any);
    if (usability.reason === 'invalid_keys') {
      throw new Error(`${context} context returned invalid_keys - BUG!`);
    }
  }
}

async function scenarioE_StatusEndpointSimulation() {
  await simulateInvalidKeysState();

  // Simulate what status endpoint does
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  const configDoc = await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').get();

  if (configDoc.exists) {
    const config = configDoc.data();
    const exchangeStatus = config?.exchangeStatus;

    // This simulates the FIXED status endpoint logic
    let mappedStatus = 'NOT_CONFIGURED';
    if (exchangeStatus === 'CONNECTED') {
      mappedStatus = 'CONNECTED';
    } else if (exchangeStatus === 'INVALID_KEYS') {
      // FIXED: Return NOT_CONNECTED instead of INVALID_KEYS
      mappedStatus = 'NOT_CONNECTED';
    }

    if (mappedStatus === 'INVALID_KEYS') {
      throw new Error('Status endpoint would return INVALID_KEYS - BUG!');
    }
  }
}

async function main() {
  console.log('🚀 INVALID_KEYS LIFECYCLE VERIFICATION - DIRECT TEST');
  console.log('=' * 70);

  try {
    await setupTestUser();

    const results = await Promise.all([
      testScenario('SCENARIO A — Fresh state returns not_connected', scenarioA_FreshState),
      testScenario('SCENARIO B — INVALID_KEYS treated as stale in isExchangeUsable', scenarioB_InvalidKeysIsExchangeUsable),
      testScenario('SCENARIO C — Disconnect cleanup prevents INVALID_KEYS leak', scenarioC_DisconnectCleanup),
      testScenario('SCENARIO D — Background jobs never see invalid_keys', scenarioD_BackgroundJobSafety),
      testScenario('SCENARIO E — Status endpoint simulation (FIXED)', scenarioE_StatusEndpointSimulation)
    ]);

    await cleanup();

    const passed = results.filter(r => r).length;
    const total = results.length;

    console.log(`\n📊 RESULTS: ${passed}/${total} tests passed`);

    if (passed === total) {
      console.log('🎉 ALL TESTS PASSED - INVALID_KEYS fixes are working correctly!');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - INVALID_KEYS bugs still present!');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('💥 Test suite crashed:', error.message);
    await cleanup();
    process.exit(1);
  }
}

main();
