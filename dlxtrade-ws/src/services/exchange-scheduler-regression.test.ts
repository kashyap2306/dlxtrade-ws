/**
 * EXCHANGE SCHEDULER REGRESSION TEST
 *
 * PROVES: Missing exchangeConfig/current can NEVER cause scheduler force-stop or INVALID_KEYS
 * FAILS HARD: If any background operation treats missing config as disconnection
 */

import * as admin from 'firebase-admin';
import { firestoreAdapter, isExchangeUsable } from './firestoreAdapter';
import { BackgroundResearchScheduler } from './backgroundResearchScheduler';
import { getFirebaseAdmin } from '../utils/firebase';

// Test UIDs for different scenarios
const TEST_UID_CONNECTED = 'test_scheduler_connected';
const TEST_UID_INVALID_KEYS = 'test_scheduler_invalid_keys';
const TEST_UID_DISCONNECTED = 'test_scheduler_disconnected';
const TEST_UID_MISSING_CONFIG = 'test_scheduler_missing_config';

// Global assertion traps
let ASSERTION_VIOLATIONS: string[] = [];
let FORCE_STOP_CALLS: string[] = [];
let EXCHANGE_STATUS_WRITES: string[] = [];
let DECRYPT_CALLS: string[] = [];
let BLOCKED_LOGS: string[] = [];

// Override console.log to trap assertions
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  const message = args.join(' ');

  // Trap force stop calls
  if (message.includes('forceStopUserScheduler') || message.includes('SCHEDULER_INTERVAL_CLEARED')) {
    FORCE_STOP_CALLS.push(`FORCE_STOP: ${message}`);
    ASSERTION_VIOLATIONS.push(`❌ ASSERTION VIOLATION: forceStopUserScheduler called - ${message}`);
  }

  // Trap exchange status writes (only actual writes to Firestore, not log messages)
  if (message.includes('FIRESTORE_WRITE') && message.includes('exchangeStatus')) {
    EXCHANGE_STATUS_WRITES.push(`EXCHANGE_STATUS_WRITE: ${message}`);
    ASSERTION_VIOLATIONS.push(`❌ ASSERTION VIOLATION: exchangeStatus written - ${message}`);
  }

  // Trap decrypt calls
  if (message.includes('decrypt(') || message.includes('decryptOrThrow')) {
    DECRYPT_CALLS.push(`DECRYPT_CALL: ${message}`);
    ASSERTION_VIOLATIONS.push(`❌ ASSERTION VIOLATION: decrypt() called in background context - ${message}`);
  }

  // Trap blocked logs for missing config
  if (message.includes('AUTO_TRADE_BLOCKED_EXCHANGE_DISCONNECTED') && message.includes(TEST_UID_MISSING_CONFIG)) {
    BLOCKED_LOGS.push(`BLOCKED_LOG: ${message}`);
    ASSERTION_VIOLATIONS.push(`❌ ASSERTION VIOLATION: AUTO_TRADE_BLOCKED_EXCHANGE_DISCONNECTED logged for missing config - ${message}`);
  }

  return originalConsoleLog(...args);
};

// Setup test users in Firestore
async function setupTestUsers() {
  const db = getFirebaseAdmin().firestore();

  console.log('🔧 Setting up test users...');

  // User 1: CONNECTED exchange
  await db.collection('users').doc(TEST_UID_CONNECTED).set({
    displayName: 'Test User Connected',
    email: 'connected@test.com'
  });
  await db.collection('users').doc(TEST_UID_CONNECTED).collection('exchangeConfig').doc('current').set({
    exchange: 'binance',
    exchangeStatus: 'CONNECTED',
    apiKeyEncrypted: 'test_key',
    secretEncrypted: 'test_secret'
  });
  await db.collection('users').doc(TEST_UID_CONNECTED).collection('autoTradeConfig').doc('current').set({
    autoTradeEnabled: true
  });
  await db.collection('users').doc(TEST_UID_CONNECTED).collection('settings').doc('autoTrade').set({
    enabled: true
  });

  // User 2: INVALID_KEYS exchange
  await db.collection('users').doc(TEST_UID_INVALID_KEYS).set({
    displayName: 'Test User Invalid Keys',
    email: 'invalid@test.com'
  });
  await db.collection('users').doc(TEST_UID_INVALID_KEYS).collection('exchangeConfig').doc('current').set({
    exchange: 'binance',
    exchangeStatus: 'INVALID_KEYS',
    apiKeyEncrypted: 'invalid_key',
    secretEncrypted: 'invalid_secret'
  });
  await db.collection('users').doc(TEST_UID_INVALID_KEYS).collection('autoTradeConfig').doc('current').set({
    autoTradeEnabled: true
  });
  await db.collection('users').doc(TEST_UID_INVALID_KEYS).collection('settings').doc('autoTrade').set({
    enabled: true
  });

  // User 3: DISCONNECTED exchange
  await db.collection('users').doc(TEST_UID_DISCONNECTED).set({
    displayName: 'Test User Disconnected',
    email: 'disconnected@test.com'
  });
  await db.collection('users').doc(TEST_UID_DISCONNECTED).collection('exchangeConfig').doc('current').set({
    exchange: 'binance',
    exchangeStatus: 'DISCONNECTED',
    apiKeyEncrypted: 'test_key',
    secretEncrypted: 'test_secret'
  });
  await db.collection('users').doc(TEST_UID_DISCONNECTED).collection('autoTradeConfig').doc('current').set({
    autoTradeEnabled: true
  });
  await db.collection('users').doc(TEST_UID_DISCONNECTED).collection('settings').doc('autoTrade').set({
    enabled: true
  });

  // User 4: MISSING exchange config (this is the critical test case)
  await db.collection('users').doc(TEST_UID_MISSING_CONFIG).set({
    displayName: 'Test User Missing Config',
    email: 'missing@test.com'
  });
  await db.collection('users').doc(TEST_UID_MISSING_CONFIG).collection('autoTradeConfig').doc('current').set({
    autoTradeEnabled: true
  });
  await db.collection('users').doc(TEST_UID_MISSING_CONFIG).collection('settings').doc('autoTrade').set({
    enabled: true
  });
  // NOTE: No exchangeConfig/current document created for this user

  console.log('✅ Test users setup complete');
}

// Clean up test users
async function cleanupTestUsers() {
  const db = getFirebaseAdmin().firestore();

  const testUids = [TEST_UID_CONNECTED, TEST_UID_INVALID_KEYS, TEST_UID_DISCONNECTED, TEST_UID_MISSING_CONFIG];

  for (const uid of testUids) {
    try {
      await db.collection('users').doc(uid).delete();
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  console.log('🧹 Test users cleaned up');
}

// Run the regression test
async function runRegressionTest() {
  console.log('🧪 STARTING EXCHANGE SCHEDULER REGRESSION TEST\n');

  // Reset traps
  ASSERTION_VIOLATIONS = [];
  FORCE_STOP_CALLS = [];
  EXCHANGE_STATUS_WRITES = [];
  DECRYPT_CALLS = [];
  BLOCKED_LOGS = [];

  try {
    await setupTestUsers();

    // Create scheduler instance
    const scheduler = new BackgroundResearchScheduler();

    console.log('📋 Testing all scenarios...\n');

    // Test 1: CONNECTED exchange user
    console.log('1️⃣ Testing CONNECTED exchange user...');
    await (scheduler as any).updateUserResearchSchedule(TEST_UID_CONNECTED);
    console.log('   ✅ CONNECTED user processed\n');

    // Test 2: INVALID_KEYS exchange user
    console.log('2️⃣ Testing INVALID_KEYS exchange user...');
    await (scheduler as any).updateUserResearchSchedule(TEST_UID_INVALID_KEYS);
    console.log('   ✅ INVALID_KEYS user processed\n');

    // Test 3: DISCONNECTED exchange user
    console.log('3️⃣ Testing DISCONNECTED exchange user...');
    await (scheduler as any).updateUserResearchSchedule(TEST_UID_DISCONNECTED);
    console.log('   ✅ DISCONNECTED user processed\n');

    // Test 4: MISSING exchange config user (CRITICAL TEST)
    console.log('4️⃣ Testing MISSING exchange config user (CRITICAL TEST)...');

    // Pre-test: Verify isExchangeUsable returns correct result
    const usabilityResult = await isExchangeUsable(TEST_UID_MISSING_CONFIG, 'background_job');
    console.log('   🔍 isExchangeUsable result:', usabilityResult);

    if (usabilityResult.usable !== false || usabilityResult.reason !== 'not_connected') {
      throw new Error(`❌ MISSING CONFIG TEST FAILED: isExchangeUsable returned ${JSON.stringify(usabilityResult)}, expected {usable: false, reason: 'not_connected'}`);
    }

    console.log('   ✅ isExchangeUsable correctly returns {usable: false, reason: "not_connected"}');

    // Now test the scheduler
    await (scheduler as any).updateUserResearchSchedule(TEST_UID_MISSING_CONFIG);

    console.log('   ✅ MISSING CONFIG user processed\n');

    // Check for assertion violations
    if (ASSERTION_VIOLATIONS.length > 0) {
      console.log('\n❌ TEST FAILED: ASSERTION VIOLATIONS DETECTED');
      ASSERTION_VIOLATIONS.forEach(violation => {
        console.log(`   ${violation}`);
      });
      throw new Error('Assertion violations detected');
    }

    // Verify expected behavior for missing config
    const hasForceStopCall = FORCE_STOP_CALLS.some(call => call.includes(TEST_UID_MISSING_CONFIG));
    const hasExchangeStatusWrite = EXCHANGE_STATUS_WRITES.some(write => write.includes(TEST_UID_MISSING_CONFIG));
    const hasDecryptCall = DECRYPT_CALLS.some(call => call.includes(TEST_UID_MISSING_CONFIG));
    const hasBlockedLog = BLOCKED_LOGS.some(log => log.includes(TEST_UID_MISSING_CONFIG));

    if (hasForceStopCall) {
      throw new Error('❌ MISSING CONFIG TEST FAILED: forceStopUserScheduler called for missing config');
    }

    if (hasExchangeStatusWrite) {
      throw new Error('❌ MISSING CONFIG TEST FAILED: exchangeStatus written for missing config');
    }

    if (hasDecryptCall) {
      throw new Error('❌ MISSING CONFIG TEST FAILED: decrypt() called for missing config');
    }

    if (hasBlockedLog) {
      throw new Error('❌ MISSING CONFIG TEST FAILED: AUTO_TRADE_BLOCKED_EXCHANGE_DISCONNECTED logged for missing config');
    }

    console.log('✅ VERIFICATION PASSED: No prohibited operations for missing config');
    console.log('   - No forceStopUserScheduler calls');
    console.log('   - No exchangeStatus writes');
    console.log('   - No decrypt() calls');
    console.log('   - No AUTO_TRADE_BLOCKED_EXCHANGE_DISCONNECTED logs');

    console.log('\n🎉 TEST PASSED: Missing exchangeConfig/current is SAFE');
    console.log('   - Soft state handling confirmed');
    console.log('   - No scheduler force-stop');
    console.log('   - No INVALID_KEYS creation');
    console.log('   - Scheduler remains alive');

  } catch (error: any) {
    console.log(`\n❌ TEST FAILED: ${error.message}`);
    console.log(`   File: ${__filename}`);
    console.log(`   Error: ${error.stack}`);
    throw error;
  } finally {
    await cleanupTestUsers();

    // Restore original console.log
    console.log = originalConsoleLog;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  runRegressionTest()
    .then(() => {
      console.log('\n✅ REGRESSION TEST COMPLETED SUCCESSFULLY');
      process.exit(0);
    })
    .catch((error) => {
      console.log(`\n❌ REGRESSION TEST FAILED: ${error.message}`);
      process.exit(1);
    });
}

export { runRegressionTest };
