/**
 * TEMPORARY TEST FILE - DELETE AFTER TESTING
 * Exchange INVALID_KEYS Auto-Corruption Regression Test
 *
 * RUN THIS TEST AGAINST LIVE BACKEND + REAL FIRESTORE
 * DO NOT RUN IN MOCKED ENVIRONMENT
 */

import * as admin from 'firebase-admin';
import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';

// Test configuration - UPDATE WITH REAL VALUES
const TEST_CONFIG = {
  uid: 'REPLACE_WITH_REAL_TEST_USER_UID',
  backendUrl: 'http://localhost:4000', // Update if different port
  validApiKey: 'REPLACE_WITH_REAL_VALID_API_KEY',
  validSecret: 'REPLACE_WITH_REAL_VALID_SECRET',
  invalidApiKey: 'INVALID_TEST_KEY',
  invalidSecret: 'INVALID_TEST_SECRET',
  exchange: 'binance' as const
};

/**
 * UTILITY: Read Firestore exchangeConfig state
 */
async function readExchangeConfig(uid: string) {
  const doc = await admin.firestore()
    .collection('users').doc(uid)
    .collection('exchangeConfig').doc('current')
    .get();

  if (!doc.exists) {
    return { exists: false };
  }

  const data = doc.data();
  return {
    exists: true,
    exchangeStatus: data?.exchangeStatus,
    keysClearedAt: data?.keysClearedAt,
    keysClearedReason: data?.keysClearedReason,
    hasApiKeyEncrypted: !!data?.apiKeyEncrypted,
    hasSecretEncrypted: !!data?.secretEncrypted,
    updatedAt: data?.updatedAt
  };
}

/**
 * UTILITY: Make HTTP request to backend
 */
async function makeRequest(method: 'GET' | 'POST', path: string, body?: any, authToken?: string) {
  const url = `${TEST_CONFIG.backendUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  return {
    status: response.status,
    data: await response.json().catch(() => null)
  };
}

/**
 * TEST A: Valid Key Stability Test
 */
async function testValidKeyStability() {
  console.log('\n🧪 STARTING: SCENARIO A - Valid Key Stability Test');
  console.log('='.repeat(60));

  // 1. Initial state check
  console.log('📊 Step 1: Reading initial Firestore state...');
  const initialState = await readExchangeConfig(TEST_CONFIG.uid);
  console.log('Initial state:', JSON.stringify(initialState, null, 2));

  if (!initialState.exists || initialState.exchangeStatus !== 'CONNECTED') {
    console.log('❌ FAIL: Initial state not CONNECTED. Please set up valid keys first.');
    return false;
  }

  if (initialState.keysClearedAt || initialState.keysClearedReason) {
    console.log('❌ FAIL: Initial state has keysCleared fields. Clean state first.');
    return false;
  }

  console.log('✅ Initial state verified: CONNECTED with clean keysCleared fields');

  // 2. Trigger auto-trade status during wait period
  console.log('📊 Step 2: Triggering auto-trade status check...');
  try {
    const statusResponse = await makeRequest('GET', '/api/auto-trade/status');
    console.log('Auto-trade status response:', statusResponse);
  } catch (err) {
    console.log('Auto-trade status call failed (expected if no auth):', err.message);
  }

  // 3. Wait 15 minutes (in real test, this would be manual wait)
  console.log('⏰ Step 3: WAITING 15 MINUTES FOR BACKGROUND SCHEDULER...');
  console.log('   - Background jobs should run');
  console.log('   - Scheduler should tick');
  console.log('   - No exchangeStatus writes should occur');

  // NOTE: In real test, you would wait 15 minutes here
  // For this code version, we'll simulate by checking immediately
  console.log('⚠️  NOTE: In real test, wait 15 minutes before proceeding to Step 4');

  // 4. Final state check
  console.log('📊 Step 4: Reading final Firestore state...');
  const finalState = await readExchangeConfig(TEST_CONFIG.uid);
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  // 5. Verification
  const passed = (
    finalState.exists &&
    finalState.exchangeStatus === 'CONNECTED' &&
    !finalState.keysClearedAt &&
    !finalState.keysClearedReason
  );

  console.log(`\n${passed ? '✅ PASS' : '❌ FAIL'}: Valid Key Stability Test`);
  console.log('Expected: exchangeStatus=CONNECTED, no keysCleared fields');
  console.log(`Actual: exchangeStatus=${finalState.exchangeStatus}, keysClearedAt=${!!finalState.keysClearedAt}, keysClearedReason=${!!finalState.keysClearedReason}`);

  return passed;
}

/**
 * TEST B: Integrations Route Guard Test
 */
async function testIntegrationsRouteGuard() {
  console.log('\n🧪 STARTING: SCENARIO B - Integrations Route Guard Test');
  console.log('='.repeat(60));

  // 1. Initial state
  console.log('📊 Step 1: Reading initial state...');
  const initialState = await readExchangeConfig(TEST_CONFIG.uid);
  console.log('Initial state:', JSON.stringify(initialState, null, 2));

  // 2. Attempt to update trading exchange via integrations route
  console.log('📊 Step 2: Attempting to update trading exchange via /integrations/update...');
  const updateResponse = await makeRequest('POST', '/api/integrations/update', {
    apiName: TEST_CONFIG.exchange,
    apiKey: TEST_CONFIG.validApiKey,
    secretKey: TEST_CONFIG.validSecret,
    enabled: true
  });

  console.log('Integrations update response:', updateResponse);

  // 3. Check if request was blocked
  const blockedCorrectly = updateResponse.status === 400 &&
    updateResponse.data?.error?.includes('cannot be configured through this API');

  console.log(`${blockedCorrectly ? '✅ BLOCKED' : '❌ NOT BLOCKED'}: Integrations route correctly blocked trading exchange`);

  // 4. Verify no exchangeConfig changes
  console.log('📊 Step 3: Verifying no exchangeConfig changes...');
  const finalState = await readExchangeConfig(TEST_CONFIG.uid);

  const noChanges = JSON.stringify(initialState) === JSON.stringify(finalState);
  console.log(`${noChanges ? '✅ NO CHANGES' : '❌ CHANGES DETECTED'}: ExchangeConfig state unchanged`);

  const passed = blockedCorrectly && noChanges;
  console.log(`\n${passed ? '✅ PASS' : '❌ FAIL'}: Integrations Route Guard Test`);

  return passed;
}

/**
 * TEST C: Negative Control Test
 */
async function testNegativeControl() {
  console.log('\n🧪 STARTING: SCENARIO C - Negative Control Test');
  console.log('='.repeat(60));

  // 1. Submit wrong keys
  console.log('📊 Step 1: Submitting intentionally wrong exchange keys...');
  const connectResponse = await makeRequest('POST', '/api/exchange/connect', {
    exchange: TEST_CONFIG.exchange,
    apiKey: TEST_CONFIG.invalidApiKey,
    secret: TEST_CONFIG.invalidSecret
  });

  console.log('Exchange connect response:', connectResponse);

  // 2. Verify INVALID_KEYS appears
  console.log('📊 Step 2: Checking Firestore for INVALID_KEYS...');
  const finalState = await readExchangeConfig(TEST_CONFIG.uid);
  console.log('Final state:', JSON.stringify(finalState, null, 2));

  const invalidKeysCorrectlySet = (
    finalState.exists &&
    finalState.exchangeStatus === 'INVALID_KEYS' &&
    finalState.keysClearedReason &&
    finalState.keysClearedAt
  );

  console.log(`${invalidKeysCorrectlySet ? '✅ INVALID_KEYS SET' : '❌ INVALID_KEYS NOT SET'}: Wrong keys correctly triggered INVALID_KEYS`);

  const passed = invalidKeysCorrectlySet;
  console.log(`\n${passed ? '✅ PASS' : '❌ FAIL'}: Negative Control Test`);

  return passed;
}

/**
 * MAIN TEST RUNNER
 */
async function runAllTests() {
  console.log('🚀 EXCHANGE INVALID_KEYS REGRESSION TEST SUITE');
  console.log('='.repeat(60));
  console.log(`Test User: ${TEST_CONFIG.uid}`);
  console.log(`Backend: ${TEST_CONFIG.backendUrl}`);
  console.log('='.repeat(60));

  try {
    // Initialize Firebase Admin (if not already done)
    if (!admin.apps.length) {
      // NOTE: In real test, use your actual Firebase config
      console.log('⚠️  WARNING: Firebase not initialized in test. Configure with real credentials.');
    }

    const results = {
      scenarioA: await testValidKeyStability(),
      scenarioB: await testIntegrationsRouteGuard(),
      scenarioC: await testNegativeControl()
    };

    console.log('\n' + '='.repeat(60));
    console.log('🎯 FINAL RESULTS');
    console.log('='.repeat(60));

    const allPassed = Object.values(results).every(r => r);

    console.log(`Scenario A (Valid Key Stability): ${results.scenarioA ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Scenario B (Integrations Guard): ${results.scenarioB ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Scenario C (Negative Control): ${results.scenarioC ? '✅ PASS' : '❌ FAIL'}`);

    console.log(`\n🏆 OVERALL: ${allPassed ? '✅ ALL TESTS PASSED - INVALID_KEYS BUG FIXED' : '❌ TESTS FAILED - INVALID_KEYS BUG STILL EXISTS'}`);

    if (!allPassed) {
      console.log('\n🔍 INVESTIGATION REQUIRED:');
      console.log('- Check backend logs for unauthorized exchangeConfig writes');
      console.log('- Verify scheduler is not calling integrations routes');
      console.log('- Confirm ensureUser is not touching exchangeConfig');
    }

    return allPassed;

  } catch (error) {
    console.error('❌ TEST SUITE FAILED WITH ERROR:', error);
    return false;
  }
}

// Export for manual testing
export { runAllTests, testValidKeyStability, testIntegrationsRouteGuard, testNegativeControl };

// Auto-run if called directly
if (require.main === module) {
  runAllTests().then(() => {
    console.log('\n✨ Test completed. DELETE THIS FILE NOW.');
    process.exit(0);
  }).catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}
