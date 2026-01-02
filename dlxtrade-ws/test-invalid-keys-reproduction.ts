#!/usr/bin/env ts-node

/**
 * REPRODUCTION TEST: Exchange API keys becoming INVALID_KEYS after submit
 * This test attempts to reproduce the exact scenario described in the issue
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './src/utils/firebase';

const TEST_UID = 'test_invalid_keys_reproduction_' + Date.now();

async function main() {
  console.log('🔍 REPRODUCING INVALID_KEYS ISSUE\n');
  
  try {
    const firebaseAdmin = getFirebaseAdmin();
    const db = admin.firestore(firebaseAdmin);

    // Step 1: Clean start - ensure no existing config
    console.log('1. Cleaning up any existing config...');
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').delete().catch(() => {});

    // Step 2: Simulate submitting valid API keys via UI (what the user does)
    console.log('2. Simulating API key submission via UI...');
    
    // This simulates what happens when a user submits valid keys through the frontend
    // The keys get encrypted and stored without any exchangeStatus
    const validConfig = {
      exchange: 'binance',
      apiKeyEncrypted: 'encrypted_valid_api_key_12345',
      secretEncrypted: 'encrypted_valid_secret_67890',
      testnet: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    console.log('   Writing valid config to Firestore...');
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set(validConfig);
    console.log('   ✅ Valid config written successfully');

    // Step 3: Check immediate state (should be good)
    console.log('3. Checking immediate state after write...');
    const immediateCheck = await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').get();
    const immediateData = immediateCheck.data();
    console.log('   Config exists:', immediateCheck.exists);
    console.log('   Exchange:', immediateData?.exchange);
    console.log('   Has exchangeStatus:', 'exchangeStatus' in immediateData);
    console.log('   ExchangeStatus value:', immediateData?.exchangeStatus);

    // Step 4: Simulate various read operations that might trigger writes
    console.log('4. Simulating read operations that might trigger background writes...');
    
    // Import and test isExchangeUsable (this is used by background jobs)
    const { firestoreAdapter } = await import('./src/services/firestoreAdapter');
    
    // Test 4a: User request context (should be safe)
    console.log('   4a. Testing user_request context...');
    const userRequestResult = await firestoreAdapter.isExchangeUsable(TEST_UID, 'user_request');
    console.log(`       Result: ${userRequestResult.usable ? 'usable' : 'not usable'}, reason: ${userRequestResult.reason}`);

    // Test 4b: Background job context (this is where the bug might occur)
    console.log('   4b. Testing background_job context...');
    const backgroundJobResult = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');
    console.log(`       Result: ${backgroundJobResult.usable ? 'usable' : 'not usable'}, reason: ${backgroundJobResult.reason}`);

    // Step 5: Check if INVALID_KEYS appeared after operations
    console.log('5. Checking if INVALID_KEYS appeared after operations...');
    const finalCheck = await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').get();
    const finalData = finalCheck.data();
    
    console.log('   Config exists:', finalCheck.exists);
    console.log('   Exchange:', finalData?.exchange);
    console.log('   Has exchangeStatus:', 'exchangeStatus' in finalData);
    console.log('   ExchangeStatus value:', finalData?.exchangeStatus);

    if (finalData?.exchangeStatus === 'INVALID_KEYS') {
      console.log('   🚨 BUG REPRODUCED! INVALID_KEYS appeared after operations');
      console.log('   This should not happen - INVALID_KEYS should never be written');
      
      // Try to identify what caused it by checking recent logs
      console.log('\n   🔍 ANALYSIS: INVALID_KEYS detected in production-like scenario');
      console.log('   The issue likely occurs during background job read operations');
      console.log('   Check the console logs above for [INVALID_KEYS_WRITE_DETECTED] messages');
      
    } else {
      console.log('   ✅ No INVALID_KEYS detected - config remained clean');
    }

    // Step 6: Test with decryption failure scenario
    console.log('\n6. Testing decryption failure scenario...');
    
    // Write config with bad encrypted data that will fail decryption
    const badConfig = {
      exchange: 'binance',
      apiKeyEncrypted: 'corrupted_encrypted_data_that_will_fail_decrypt',
      secretEncrypted: 'also_corrupted_encrypted_data',
      testnet: true,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    };

    console.log('   Writing config with corrupted encrypted data...');
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').set(badConfig);
    console.log('   ✅ Bad config written');

    // Test if decryption failures trigger INVALID_KEYS writes
    console.log('   Testing decryption with bad data...');
    
    try {
      const decryptTestResult = await firestoreAdapter.isExchangeUsable(TEST_UID, 'user_request');
      console.log(`       Decrypt test result: ${decryptTestResult.usable ? 'usable' : 'not usable'}, reason: ${decryptTestResult.reason}`);
    } catch (error: any) {
      console.log(`       Decrypt test error: ${error.message}`);
    }

    // Check if INVALID_KEYS was written after decryption failure
    const afterDecryptFailureCheck = await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').get();
    const afterDecryptFailureData = afterDecryptFailureCheck.data();
    
    if (afterDecryptFailureData?.exchangeStatus === 'INVALID_KEYS') {
      console.log('   🚨 BUG REPRODUCED! Decryption failure triggered INVALID_KEYS write');
      console.log('   This is the root cause - decryption failures should NOT write INVALID_KEYS');
    } else {
      console.log('   ✅ Decryption failure handled correctly - no INVALID_KEYS written');
    }

    // Cleanup
    await db.collection('users').doc(TEST_UID).collection('exchangeConfig').doc('current').delete();
    console.log('\n🧹 Test cleanup completed');

  } catch (error: any) {
    console.error('\n❌ Reproduction test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

main();
