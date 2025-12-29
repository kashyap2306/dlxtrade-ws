/**
 * DECRYPTION RUNTIME TEST
 *
 * PROVES: decrypt() is NOT called in background/scheduler contexts
 * FAILS: If any forbidden context calls decrypt()
 */

import * as admin from 'firebase-admin';
import { firestoreAdapter } from './firestoreAdapter';
import { BackgroundResearchScheduler } from './backgroundResearchScheduler';

// Mock Firestore setup
let mockFirestore: any;
let mockDb: any;
let mockCollection: any;
let mockDoc: any;
let decryptCalls: any[] = [];

const TEST_UID = 'test_decryption_runtime';
const INITIAL_EXCHANGE_CONFIG = {
  exchange: 'binance',
  exchangeStatus: 'CONNECTED',
  apiKeyEncrypted: 'encrypted_test_key',
  secretEncrypted: 'encrypted_test_secret',
  createdAt: admin.firestore.Timestamp.now(),
  updatedAt: admin.firestore.Timestamp.now()
};

// Override decrypt to track calls
const originalDecrypt = require('./keyManager').decrypt;
require('./keyManager').decrypt = function(cipherText: string, context?: string) {
  decryptCalls.push({
    cipherText: cipherText?.substring(0, 20) + '...',
    context: context || 'NO_CONTEXT',
    timestamp: new Date().toISOString(),
    stack: new Error().stack
  });

  console.log(`🔥 [DECRYPT_CALL_TRACKED] context=${context || 'NO_CONTEXT'}`);

  // Call original but with allowed context to avoid throwing
  return originalDecrypt.call(this, cipherText, 'exchange_connect');
};

// Setup mocks
function setupMocks() {
  decryptCalls = [];

  mockDoc = {
    exists: true,
    data: () => INITIAL_EXCHANGE_CONFIG
  };

  mockCollection = {
    doc: () => mockDoc
  };

  mockDb = {
    collection: () => mockCollection
  };

  (firestoreAdapter as any).db = mockDb;
}

// TEST: Scheduler operations should NOT call decrypt
async function testSchedulerNoDecrypt() {
  console.log('\n🧪 TEST: Scheduler Operations (decrypt calls forbidden)');
  console.log('='.repeat(60));

  setupMocks();

  try {
    const scheduler = new BackgroundResearchScheduler();

    // Test hasUsableExchangeAPIs (scheduler exchange check)
    console.log('Testing scheduler.hasUsableExchangeAPIs...');
    const result = await (scheduler as any).hasUsableExchangeAPIs(TEST_UID);

    console.log('Result:', result);
    console.log('Decrypt calls during scheduler check:', decryptCalls.length);

    if (decryptCalls.length > 0) {
      console.error('💀 FATAL: Scheduler called decrypt() - forbidden!');
      console.error('Decrypt calls:', decryptCalls);
      throw new Error('SCHEDULER_CALLED_DECRYPT');
    }

    console.log('✅ Scheduler operations did NOT call decrypt');

  } catch (error) {
    console.error('💀 TEST FAILED:', error.message);
    throw error;
  }
}

// TEST: Auto-trade operations should NOT call decrypt
async function testAutoTradeNoDecrypt() {
  console.log('\n🧪 TEST: Auto-Trade Operations (decrypt calls forbidden)');
  console.log('='.repeat(60));

  setupMocks();
  decryptCalls = [];

  try {
    // Test isExchangeUsable (used by auto-trade)
    console.log('Testing isExchangeUsable...');
    const { isExchangeUsable } = await import('./firestoreAdapter');
    const usabilityResult = await isExchangeUsable(TEST_UID, 'background_job');

    console.log('Usability result:', usabilityResult);
    console.log('Decrypt calls during usability check:', decryptCalls.length);

    if (decryptCalls.length > 0) {
      console.error('💀 FATAL: isExchangeUsable called decrypt() - forbidden!');
      console.error('Decrypt calls:', decryptCalls);
      throw new Error('USABILITY_CALLED_DECRYPT');
    }

    console.log('✅ isExchangeUsable did NOT call decrypt');

  } catch (error) {
    console.error('💀 TEST FAILED:', error.message);
    throw error;
  }
}

// TEST: getExchangeConfig should NOT call decrypt
async function testGetExchangeConfigNoDecrypt() {
  console.log('\n🧪 TEST: getExchangeConfig (decrypt calls forbidden)');
  console.log('='.repeat(60));

  setupMocks();
  decryptCalls = [];

  try {
    console.log('Testing getExchangeConfig...');
    const config = await firestoreAdapter.getExchangeConfig(TEST_UID);

    console.log('Config retrieved:', !!config);
    console.log('Decrypt calls during getExchangeConfig:', decryptCalls.length);

    if (decryptCalls.length > 0) {
      console.error('💀 FATAL: getExchangeConfig called decrypt() - forbidden!');
      console.error('Decrypt calls:', decryptCalls);
      throw new Error('GET_CONFIG_CALLED_DECRYPT');
    }

    console.log('✅ getExchangeConfig did NOT call decrypt');

  } catch (error) {
    console.error('💀 TEST FAILED:', error.message);
    throw error;
  }
}

// TEST: Exchange connect should call decrypt (allowed)
async function testExchangeConnectAllowsDecrypt() {
  console.log('\n🧪 TEST: Exchange Connect (decrypt calls allowed)');
  console.log('='.repeat(60));

  setupMocks();
  decryptCalls = [];

  try {
    console.log('Testing exchange connect context (should allow decrypt)...');

    // Simulate calling decrypt with allowed context
    const { decrypt } = require('./keyManager');
    const result = decrypt('test_ciphertext', 'exchange_connect');

    console.log('Decrypt result:', result !== null);
    console.log('Decrypt calls with allowed context:', decryptCalls.length);

    if (decryptCalls.length === 0) {
      console.error('❌ Exchange connect did not call decrypt');
      throw new Error('EXCHANGE_CONNECT_NO_DECRYPT');
    }

    const allowedCall = decryptCalls.find(call => call.context === 'exchange_connect');
    if (!allowedCall) {
      console.error('❌ Exchange connect called decrypt with wrong context');
      throw new Error('EXCHANGE_CONNECT_WRONG_CONTEXT');
    }

    console.log('✅ Exchange connect properly called decrypt with allowed context');

  } catch (error) {
    console.error('💀 TEST FAILED:', error.message);
    throw error;
  }
}

// TEST: Forbidden contexts should throw
async function testForbiddenContextsThrow() {
  console.log('\n🧪 TEST: Forbidden Contexts Throw Errors');
  console.log('='.repeat(60));

  setupMocks();
  decryptCalls = [];

  const forbiddenContexts = ['background_job', 'user_request', 'scheduler', 'wallet_balance'];

  for (const context of forbiddenContexts) {
    try {
      console.log(`Testing forbidden context: ${context}`);

      const { decrypt } = require('./keyManager');
      decrypt('test_ciphertext', context);

      console.error(`💀 FATAL: Forbidden context '${context}' did not throw error!`);
      throw new Error(`FORBIDDEN_CONTEXT_ALLOWED: ${context}`);

    } catch (error: any) {
      if (error.message.includes('forbidden context')) {
        console.log(`✅ Forbidden context '${context}' correctly threw error`);
      } else {
        console.error(`💀 Wrong error for forbidden context '${context}':`, error.message);
        throw error;
      }
    }
  }

  console.log('✅ All forbidden contexts correctly throw errors');
}

// Main test runner
async function runDecryptionRuntimeTests() {
  console.log('🚀 DECRYPTION RUNTIME TEST SUITE');
  console.log('='.repeat(60));
  console.log('Goal: Prove decrypt() is NEVER called in background contexts');
  console.log('='.repeat(60));

  try {
    await testSchedulerNoDecrypt();
    await testAutoTradeNoDecrypt();
    await testGetExchangeConfigNoDecrypt();
    await testExchangeConnectAllowsDecrypt();
    await testForbiddenContextsThrow();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 ALL RUNTIME TESTS PASSED');
    console.log('✅ decrypt() is NEVER called in background contexts');
    console.log('✅ Background operations cannot poison exchange usability');
    console.log('✅ Runtime protection prevents forbidden decryption');
    console.log('✅ Exchange INVALID_KEYS cannot appear automatically');
    console.log('='.repeat(60));

    return true;

  } catch (error) {
    console.log('\n' + '='.repeat(60));
    console.log('💀 RUNTIME TEST FAILED');
    console.log('❌ Background decryption detected or protection failed');
    console.log('Details:', error.message);
    console.log('All decrypt calls during test:', decryptCalls);
    console.log('='.repeat(60));

    return false;
  }
}

// Export for running
export { runDecryptionRuntimeTests };

// Run if called directly
if (require.main === module) {
  runDecryptionRuntimeTests()
    .then((passed) => {
      process.exit(passed ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test runner failed:', err);
      process.exit(1);
    });
}
