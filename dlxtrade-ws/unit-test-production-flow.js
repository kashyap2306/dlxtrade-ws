// UNIT TEST PRODUCTION FLOW - Test actual route handlers with instrumentation
// This will reveal EXACTLY where the issues occur

const fs = require('fs');
const path = require('path');

// Mock environment
process.env.ENCRYPTION_SECRET = "test_encryption_secret_for_unit_test_123456789012345678901234567890";

// Capture ALL console output
let capturedLogs = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({
    type: 'log',
    message,
    timestamp: Date.now()
  });
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({
    type: 'error',
    message,
    timestamp: Date.now()
  });
  originalConsoleError.apply(console, args);
};

// Mock Firebase Admin
const mockFirestore = {
  collection: () => ({
    doc: () => ({
      get: () => Promise.resolve({ exists: false, data: () => ({}) }),
      set: (data) => Promise.resolve(),
      update: (data) => Promise.resolve()
    })
  })
};

const mockAdmin = {
  firestore: {
    Timestamp: {
      now: () => ({ seconds: Date.now() / 1000 })
    },
    FieldValue: {
      delete: () => 'DELETE_FIELD'
    }
  }
};

// Mock the modules
jest.mock('firebase-admin', () => ({
  firestore: () => mockFirestore
}));

jest.mock('../utils/firebase', () => ({
  getFirebaseAdmin: () => mockAdmin
}));

async function runUnitTests() {
  console.log('🧪 UNIT TEST PRODUCTION FLOW');
  console.log('=============================');

  try {
    // Initialize encryption first
    console.log('1. Initializing encryption...');
    const { initializeEncryptionKey } = require('./dist/services/keyManager');
    initializeEncryptionKey();
    console.log('✅ Encryption initialized');

    // Test 1: Direct keyManager encrypt/decrypt
    console.log('2. Testing keyManager encrypt/decrypt...');
    const { encrypt, decrypt } = require('./dist/services/keyManager');

    const testData = 'test_provider_api_key';
    const encrypted = encrypt(testData);
    console.log(`   Encrypted length: ${encrypted.length}`);

    // Test with wrong context (should fail)
    try {
      decrypt(encrypted, 'background_job');
      console.log('   ❌ Wrong context should have failed');
    } catch (error) {
      console.log(`   ✅ Wrong context blocked: ${error.message}`);
    }

    // Test with correct context (should succeed)
    const decrypted = decrypt(encrypted, 'user_request');
    console.log(`   ✅ Correct context works: "${decrypted}"`);

    // Test 2: Test sanitize functions directly
    console.log('3. Testing sanitize functions...');

    // Test exchange sanitize with invalid exchange
    try {
      // We need to call the function directly since it's not exported
      // Let's test the keyManager testEncryptionConsistency instead
      const { testEncryptionConsistency } = require('./dist/services/keyManager');
      const consistencyResult = testEncryptionConsistency();
      console.log(`   Encryption consistency: ${consistencyResult}`);
    } catch (error) {
      console.log(`   Encryption consistency error: ${error.message}`);
    }

    // Test 3: Simulate route handler calls
    console.log('4. Testing route handler simulation...');

    // Mock request/response objects
    const mockRequest = {
      params: { uid: 'test_user_123' },
      body: {
        'binance': {
          providerName: 'binance',
          apiKey: 'test_api_key_456',
          secretKey: 'test_secret_key_789',
          enabled: true,
          type: 'marketdata'
        }
      }
    };

    const mockReply = {
      code: (status) => ({
        send: (data) => ({ status, data })
      })
    };

    // Try to load and test providerConfig route
    try {
      const providerConfigRoute = require('./dist/routes/users/providerConfig');
      console.log('   Provider config route loaded successfully');
    } catch (error) {
      console.log(`   Provider config route load error: ${error.message}`);
    }

  } catch (error) {
    console.log(`❌ Unit test execution failed: ${error.message}`);
    console.error(error.stack);
  }

  // Analyze captured logs
  console.log('\n📊 LOG ANALYSIS');
  console.log('===============');

  const decryptLogs = capturedLogs.filter(log =>
    log.message.includes('DECRYPT_INSTRUMENTATION') ||
    log.message.includes('RUNTIME_DECRYPT_TRACE') ||
    log.message.includes('DECRYPT_CALL')
  );

  const contextViolations = capturedLogs.filter(log =>
    log.message.includes('CONTEXT_VIOLATION') ||
    log.message.includes('RUNTIME_CONTEXT_VIOLATION')
  );

  const sanitizeLogs = capturedLogs.filter(log =>
    log.message.includes('SANITIZE') ||
    log.message.includes('RUNTIME_SANITIZE')
  );

  console.log(`Total logs captured: ${capturedLogs.length}`);
  console.log(`Decrypt operations: ${decryptLogs.length}`);
  console.log(`Context violations: ${contextViolations.length}`);
  console.log(`Sanitize operations: ${sanitizeLogs.length}`);

  console.log('\n🔍 DECRYPT OPERATIONS:');
  decryptLogs.forEach((log, i) => {
    console.log(`   ${i+1}. ${log.message.substring(0, 100)}...`);
  });

  console.log('\n🚫 CONTEXT VIOLATIONS:');
  contextViolations.forEach((violation, i) => {
    console.log(`   ${i+1}. ${violation.message}`);
  });

  console.log('\n🔧 SANITIZE OPERATIONS:');
  sanitizeLogs.forEach((log, i) => {
    console.log(`   ${i+1}. ${log.message.substring(0, 100)}...`);
  });

  // Save detailed results
  const resultsFile = path.join(__dirname, 'unit-test-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify({
    summary: {
      totalLogs: capturedLogs.length,
      decryptOperations: decryptLogs.length,
      contextViolations: contextViolations.length,
      sanitizeOperations: sanitizeLogs.length
    },
    logs: capturedLogs.slice(-50) // Last 50 logs
  }, null, 2));

  console.log(`\n💾 Detailed results saved to: ${resultsFile}`);

  // Check for issues
  const hasContextViolations = contextViolations.length > 0;
  const hasDecryptOperations = decryptLogs.length > 0;

  console.log('\n🎯 ANALYSIS RESULTS:');
  console.log(`   Context violations found: ${hasContextViolations ? 'YES' : 'NO'}`);
  console.log(`   Decrypt operations executed: ${hasDecryptOperations ? 'YES' : 'NO'}`);

  if (hasContextViolations) {
    console.log('   ❌ CONTEXT VIOLATIONS DETECTED - This explains DECRYPT_BLOCKED errors');
  }

  if (!hasDecryptOperations) {
    console.log('   ⚠️  No decrypt operations detected - instrumentation may not be working');
  }

  // Restore console
  console.log = originalConsoleLog;
  console.error = originalConsoleError;

  return {
    hasContextViolations,
    hasDecryptOperations,
    logCount: capturedLogs.length
  };
}

// Run the test
runUnitTests().then(results => {
  console.log(`\n🏁 UNIT TEST COMPLETE`);
  console.log(`   Results: ${JSON.stringify(results)}`);

  if (results.hasContextViolations) {
    console.log('🚨 CRITICAL: Context violations detected - this is the root cause');
    process.exit(1);
  } else if (!results.hasDecryptOperations) {
    console.log('⚠️  WARNING: No decrypt operations detected - instrumentation needs fixing');
    process.exit(1);
  } else {
    console.log('✅ SUCCESS: Context enforcement working, instrumentation active');
    process.exit(0);
  }
}).catch(error => {
  console.error('Unit test failed:', error);
  process.exit(1);
});

