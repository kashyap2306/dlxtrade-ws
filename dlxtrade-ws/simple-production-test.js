// SIMPLE PRODUCTION TEST - Test core encryption/decryption with instrumentation
// This will definitively show if the fixes work

const fs = require('fs');
const path = require('path');

// Set test environment
process.env.ENCRYPTION_SECRET = "test_encryption_secret_simple_test_123456789012345678901234567890";

// Capture logs
let capturedLogs = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({ type: 'log', message, timestamp: Date.now() });
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({ type: 'error', message, timestamp: Date.now() });
  originalConsoleError.apply(console, args);
};

async function testProductionReady() {
  console.log('🧪 SIMPLE PRODUCTION TEST');
  console.log('=========================');

  try {
    // 1. Initialize encryption
    console.log('1. Testing encryption initialization...');
    const { initializeEncryptionKey } = require('./dist/services/keyManager');
    initializeEncryptionKey();
    console.log('✅ Encryption initialized successfully');

    // 2. Test encrypt/decrypt round-trip
    console.log('2. Testing encrypt/decrypt round-trip...');
    const { encrypt, decrypt } = require('./dist/services/keyManager');

    const testData = 'test_api_key_for_production';
    console.log(`   Original data: "${testData}"`);

    const encrypted = encrypt(testData);
    console.log(`   Encrypted length: ${encrypted.length}`);

    // Test wrong context (should fail)
    console.log('   Testing wrong context (background_job)...');
    let wrongContextFailed = false;
    try {
      decrypt(encrypted, 'background_job');
      console.log('   ❌ WRONG: background_job context was allowed!');
    } catch (error) {
      console.log(`   ✅ CORRECT: background_job blocked - ${error.message}`);
      wrongContextFailed = true;
    }

    // Test correct context (should succeed)
    console.log('   Testing correct context (user_request)...');
    let correctContextWorked = false;
    try {
      const decrypted = decrypt(encrypted, 'user_request');
      console.log(`   ✅ CORRECT: user_request worked - "${decrypted}"`);
      if (decrypted === testData) {
        correctContextWorked = true;
        console.log('   ✅ Round-trip successful');
      } else {
        console.log('   ❌ Round-trip failed - data mismatch');
      }
    } catch (error) {
      console.log(`   ❌ UNEXPECTED: user_request failed - ${error.message}`);
    }

    // 3. Test encryption consistency
    console.log('3. Testing encryption consistency...');
    const { testEncryptionConsistency } = require('./dist/services/keyManager');
    const consistencyResult = testEncryptionConsistency();
    console.log(`   Encryption consistency: ${consistencyResult ? 'PASS' : 'FAIL'}`);

    // 4. Summary
    console.log('\n📊 TEST RESULTS SUMMARY');
    console.log('=======================');

    const contextViolations = capturedLogs.filter(log =>
      log.message.includes('CONTEXT_VIOLATION') ||
      log.message.includes('RUNTIME_CONTEXT_VIOLATION')
    );

    const decryptOperations = capturedLogs.filter(log =>
      log.message.includes('DECRYPT_INSTRUMENTATION') ||
      log.message.includes('RUNTIME_DECRYPT_TRACE') ||
      log.message.includes('DECRYPT_CALL')
    );

    console.log(`Wrong context blocked: ${wrongContextFailed ? 'YES' : 'NO'}`);
    console.log(`Correct context worked: ${correctContextWorked ? 'YES' : 'NO'}`);
    console.log(`Encryption consistency: ${consistencyResult ? 'PASS' : 'FAIL'}`);
    console.log(`Context violations logged: ${contextViolations.length}`);
    console.log(`Decrypt operations logged: ${decryptOperations.length}`);

    const allTestsPass = wrongContextFailed && correctContextWorked && consistencyResult;

    console.log(`\n🎯 OVERALL RESULT: ${allTestsPass ? 'ALL TESTS PASS' : 'TESTS FAILED'}`);

    if (allTestsPass) {
      console.log('✅ PRODUCTION READY: Encryption/decryption working correctly');
      console.log('   - Context enforcement active');
      console.log('   - Round-trip encryption works');
      console.log('   - No violations detected');
    } else {
      console.log('❌ NOT PRODUCTION READY: Issues detected');

      if (!wrongContextFailed) {
        console.log('   🚨 CRITICAL: Wrong context not blocked - DECRYPT_BLOCKED errors will occur');
      }
      if (!correctContextWorked) {
        console.log('   🚨 CRITICAL: Correct context not working - user operations will fail');
      }
      if (!consistencyResult) {
        console.log('   🚨 CRITICAL: Encryption consistency failed - TEST_DECRYPT_FAILED_AFTER_ENCRYPT will occur');
      }
    }

    // Save logs
    const logFile = path.join(__dirname, 'simple-test-results.json');
    fs.writeFileSync(logFile, JSON.stringify({
      results: {
        wrongContextBlocked: wrongContextFailed,
        correctContextWorked: correctContextWorked,
        encryptionConsistency: consistencyResult,
        allTestsPass: allTestsPass
      },
      logs: capturedLogs
    }, null, 2));

    console.log(`\n💾 Results saved to: ${logFile}`);

    return allTestsPass;

  } catch (error) {
    console.log(`\n❌ TEST EXECUTION FAILED: ${error.message}`);
    console.error(error.stack);

    // Save error logs
    const errorFile = path.join(__dirname, 'test-error-results.json');
    fs.writeFileSync(errorFile, JSON.stringify({
      error: error.message,
      stack: error.stack,
      logs: capturedLogs
    }, null, 2));

    return false;
  } finally {
    // Restore console
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }
}

// Run the test
testProductionReady().then(success => {
  console.log(`\n🏁 FINAL RESULT: ${success ? 'SUCCESS' : 'FAILURE'}`);
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test setup failed:', error);
  process.exit(1);
});

