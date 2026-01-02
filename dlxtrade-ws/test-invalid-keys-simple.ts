/**
 * SIMPLE INVALID_KEYS VERIFICATION
 * Manual verification of key fixes
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './src/utils/firebase';
import { firestoreAdapter } from './src/services/firestoreAdapter';

const TEST_UID = 'qTestUser0001';

async function main() {
  console.log('🔍 INVALID_KEYS FIX VERIFICATION\n');

  try {
    // Setup
    const firebaseAdmin = getFirebaseAdmin();
    const db = admin.firestore(firebaseAdmin);

    // Clean start
    console.log('1. Cleaning up any existing config...');
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').delete().catch(() => {});

    // Test 1: Fresh state
    console.log('2. Testing fresh state (should be not_connected)...');
    const freshUsability = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
    console.log(`   Result: ${freshUsability.reason} (${freshUsability.usable ? 'usable' : 'not usable'})`);

    if (freshUsability.reason !== 'not_connected') {
      throw new Error(`FAIL: Expected 'not_connected', got '${freshUsability.reason}'`);
    }

    // Test 2: Create INVALID_KEYS state
    console.log('3. Creating INVALID_KEYS state...');
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set({
      exchange: 'bitget',
      exchangeStatus: 'INVALID_KEYS',
      apiKeyEncrypted: 'test',
      secretEncrypted: 'test',
      updatedAt: admin.firestore.Timestamp.now()
    });

    // Test 3: Check if INVALID_KEYS is treated as stale
    console.log('4. Testing INVALID_KEYS handling (should be not_connected, not invalid_keys)...');
    const invalidUsability = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
    console.log(`   Result: ${invalidUsability.reason} (${invalidUsability.usable ? 'usable' : 'not usable'})`);

    if (invalidUsability.reason === 'invalid_keys') {
      throw new Error('FAIL: isExchangeUsable returned invalid_keys - FIX NOT WORKING');
    }

    if (invalidUsability.reason !== 'not_connected') {
      throw new Error(`FAIL: Expected 'not_connected' after fix, got '${invalidUsability.reason}'`);
    }

    // Test 4: Simulate disconnect cleanup
    console.log('5. Simulating disconnect cleanup...');
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').delete();

    // Test 5: Verify cleanup worked
    console.log('6. Verifying cleanup (should still be not_connected)...');
    const afterCleanup = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
    console.log(`   Result: ${afterCleanup.reason} (${afterCleanup.usable ? 'usable' : 'not usable'})`);

    if (afterCleanup.reason !== 'not_connected') {
      throw new Error(`FAIL: After cleanup, expected 'not_connected', got '${afterCleanup.reason}'`);
    }

    console.log('\n🎉 ALL VERIFICATION TESTS PASSED!');
    console.log('✅ INVALID_KEYS fixes are working correctly');
    console.log('✅ INVALID_KEYS is treated as transient event, not persistent state');

  } catch (error: any) {
    console.error(`\n❌ VERIFICATION FAILED: ${error.message}`);
    process.exit(1);
  }
}

main();
