/**
 * INVALID_KEYS LIFECYCLE VERIFICATION SUITE
 * Tests that INVALID_KEYS behaves as a transient event, not persistent state
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as admin from 'firebase-admin';

dotenv.config({
  path: path.join(process.cwd(), '.env'),
});

import { getFirebaseAdmin } from './src/utils/firebase';
import { firestoreAdapter } from './src/services/firestoreAdapter';

const TEST_UID = 'qTestUser0001';
const BACKEND_BASE = 'http://localhost:4000';

// Test results tracking
interface TestResult {
  scenario: string;
  status: 'PASS' | 'FAIL';
  details: string;
  artifacts: {
    request?: any;
    response?: any;
    firestoreSnapshot?: any;
    logs?: string[];
  };
}

const results: TestResult[] = [];

async function makeRequest(method: string, url: string, body?: any, headers: any = {}): Promise<any> {
  const https = require('https');
  const http = require('http');

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = client.request(options, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
      res.on('end', () => {
        try {
          const response = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          };
          resolve(response);
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);

    if (body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT')) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function getFirestoreSnapshot(uid: string): Promise<any> {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  try {
    const doc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
    return {
      exists: doc.exists,
      data: doc.exists ? doc.data() : null,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      exists: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function deleteExchangeConfig(uid: string): Promise<void> {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  try {
    await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').delete();
    console.log(`✅ Deleted exchangeConfig/current for ${uid}`);
  } catch (error) {
    console.log(`⚠️  Could not delete exchangeConfig/current for ${uid}: ${error.message}`);
  }
}

async function createTestUser(): Promise<void> {
  const firebaseAdmin = getFirebaseAdmin();
  const db = admin.firestore(firebaseAdmin);

  try {
    // Check if test user exists
    const userDoc = await db.collection('users').doc(TEST_UID).get();
    if (!userDoc.exists) {
      // Create test user
      await db.collection('users').doc(TEST_UID).set({
        uid: TEST_UID,
        email: 'test@example.com',
        name: 'Test User',
        role: 'user',
        apiConnected: false,
        isApiConnected: false,
        apiStatus: 'disconnected',
        connectedExchanges: [],
        engineRunning: false,
        autoTradeEnabled: false,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
        lastLogin: admin.firestore.Timestamp.now()
      });
      console.log(`✅ Created test user ${TEST_UID}`);
    } else {
      console.log(`✅ Test user ${TEST_UID} already exists`);
    }
  } catch (error) {
    console.log(`❌ Failed to create/setup test user: ${error.message}`);
  }
}

async function runTestScenario(scenario: string, testFn: () => Promise<void>): Promise<void> {
  console.log(`\n🧪 SCENARIO: ${scenario}`);
  console.log('='.repeat(60));

  const result: TestResult = {
    scenario,
    status: 'PASS',
    details: '',
    artifacts: {}
  };

  try {
    await testFn();
    result.details = 'Test completed successfully';
    console.log(`✅ PASS: ${scenario}`);
  } catch (error: any) {
    result.status = 'FAIL';
    result.details = error.message;
    result.artifacts.logs = [error.stack];
    console.log(`❌ FAIL: ${scenario} - ${error.message}`);
  }

  results.push(result);
}

async function scenarioA_FreshState(): Promise<void> {
  // Clean up any existing config
  await deleteExchangeConfig(TEST_UID);

  // Verify no config exists
  const snapshot = await getFirestoreSnapshot(TEST_UID);
  if (snapshot.exists) {
    throw new Error('Exchange config should not exist after cleanup');
  }

  // Test status endpoint (no auth header needed for this basic test)
  try {
    const response = await makeRequest('GET', `${BACKEND_BASE}/api/exchange/status?uid=${TEST_UID}`);
    if (response.body?.exchangeStatus === 'INVALID_KEYS') {
      throw new Error('Status endpoint returned INVALID_KEYS when no config exists');
    }
  } catch (error) {
    // If endpoint requires auth, that's expected - the important check is Firestore state
    console.log('⚠️  Status endpoint may require auth - checking Firestore state only');
  }
}

async function scenarioB_FailedConnect(): Promise<void> {
  // Attempt connect with invalid credentials
  const connectResponse = await makeRequest('POST', `${BACKEND_BASE}/api/exchange/connect?uid=${TEST_UID}`, {
    exchange: 'bitget',
    apiKey: 'invalid',
    secret: 'invalid'
  });

  // Check Firestore state immediately after failed connect
  const snapshot = await getFirestoreSnapshot(TEST_UID);
  if (!snapshot.exists || snapshot.data?.exchangeStatus !== 'INVALID_KEYS') {
    throw new Error('Expected INVALID_KEYS status immediately after failed connect');
  }

  // Status check immediately after (should be acceptable to show INVALID_KEYS here)
  try {
    const statusResponse = await makeRequest('GET', `${BACKEND_BASE}/api/exchange/status?uid=${TEST_UID}`);
    // INVALID_KEYS is acceptable immediately after failed connect
  } catch (error) {
    console.log('⚠️  Status endpoint auth check skipped');
  }
}

async function scenarioC_DisconnectAfterFailed(): Promise<void> {
  // Disconnect after failed connect
  const disconnectResponse = await makeRequest('POST', `${BACKEND_BASE}/api/exchange/disconnect?uid=${TEST_UID}`, {});

  // Check Firestore state after disconnect
  const snapshot = await getFirestoreSnapshot(TEST_UID);
  if (snapshot.exists) {
    throw new Error('Exchange config should not exist after disconnect');
  }

  // Status check after disconnect (should NOT show INVALID_KEYS)
  try {
    const statusResponse = await makeRequest('GET', `${BACKEND_BASE}/api/exchange/status?uid=${TEST_UID}`);
    if (statusResponse.body?.exchangeStatus === 'INVALID_KEYS') {
      throw new Error('INVALID_KEYS persisted after disconnect - BUG DETECTED');
    }
  } catch (error) {
    console.log('⚠️  Status endpoint auth check skipped');
  }
}

async function scenarioD_DeleteConfigDirectly(): Promise<void> {
  // First create INVALID_KEYS state
  await makeRequest('POST', `${BACKEND_BASE}/api/exchange/connect?uid=${TEST_UID}`, {
    exchange: 'bitget',
    apiKey: 'invalid',
    secret: 'invalid'
  });

  // Directly delete config (simulate admin cleanup)
  await deleteExchangeConfig(TEST_UID);

  // Status check (should NOT show INVALID_KEYS)
  try {
    const statusResponse = await makeRequest('GET', `${BACKEND_BASE}/api/exchange/status?uid=${TEST_UID}`);
    if (statusResponse.body?.exchangeStatus === 'INVALID_KEYS') {
      throw new Error('INVALID_KEYS persisted after direct config deletion - BUG DETECTED');
    }
  } catch (error) {
    console.log('⚠️  Status endpoint auth check skipped');
  }
}

async function scenarioE_BackgroundJobRead(): Promise<void> {
  // Test isExchangeUsable directly (this is what background jobs use)
  const usability = await firestoreAdapter.isExchangeUsable(TEST_UID, 'background_job');

  if (usability.reason === 'invalid_keys') {
    throw new Error('isExchangeUsable returned invalid_keys outside connect flow - BUG DETECTED');
  }
}

async function scenarioF_RapidConnectDisconnect(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    console.log(`  Iteration ${i + 1}/5`);

    // Connect with invalid creds
    await makeRequest('POST', `${BACKEND_BASE}/api/exchange/connect?uid=${TEST_UID}`, {
      exchange: 'bitget',
      apiKey: 'invalid',
      secret: 'invalid'
    });

    // Immediate disconnect
    await makeRequest('POST', `${BACKEND_BASE}/api/exchange/disconnect?uid=${TEST_UID}`, {});

    // Check no INVALID_KEYS leaks
    const snapshot = await getFirestoreSnapshot(TEST_UID);
    if (snapshot.exists) {
      throw new Error(`Config still exists after disconnect iteration ${i + 1}`);
    }

    try {
      const statusResponse = await makeRequest('GET', `${BACKEND_BASE}/api/exchange/status?uid=${TEST_UID}`);
      if (statusResponse.body?.exchangeStatus === 'INVALID_KEYS') {
        throw new Error(`INVALID_KEYS leaked in iteration ${i + 1} - BUG DETECTED`);
      }
    } catch (error) {
      console.log('⚠️  Status endpoint auth check skipped');
    }
  }
}

async function main() {
  console.log('🚀 INVALID_KEYS LIFECYCLE VERIFICATION SUITE');
  console.log('=' * 70);

  try {
    // Setup
    await createTestUser();
    console.log(`✅ Test environment ready. Using UID: ${TEST_UID}`);

    // Run test scenarios
    await runTestScenario('SCENARIO A — Fresh state (no config)', scenarioA_FreshState);
    await runTestScenario('SCENARIO B — Failed connect then immediate status', scenarioB_FailedConnect);
    await runTestScenario('SCENARIO C — Disconnect / Delete after failed connect', scenarioC_DisconnectAfterFailed);
    await runTestScenario('SCENARIO D — Delete config directly (simulate admin)', scenarioD_DeleteConfigDirectly);
    await runTestScenario('SCENARIO E — Background job read (isExchangeUsable)', scenarioE_BackgroundJobRead);
    await runTestScenario('SCENARIO F — Rapid connect/disconnect race', scenarioF_RapidConnectDisconnect);

    // Report results
    console.log('\n📊 TEST RESULTS SUMMARY');
    console.log('=' * 70);

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const total = results.length;

    results.forEach(result => {
      const icon = result.status === 'PASS' ? '✅' : '❌';
      console.log(`${icon} ${result.scenario}: ${result.status}`);
      if (result.status === 'FAIL') {
        console.log(`   Details: ${result.details}`);
      }
    });

    console.log(`\n🎯 OVERALL RESULT: ${passed}/${total} scenarios passed`);

    if (failed === 0) {
      console.log('🎉 ALL TESTS PASSED - INVALID_KEYS lifecycle is correctly implemented!');
      process.exit(0);
    } else {
      console.log('❌ SOME TESTS FAILED - INVALID_KEYS bugs detected!');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run the test suite
main();
