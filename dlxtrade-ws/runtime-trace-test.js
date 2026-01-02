// RUNTIME TRACE TEST - Execute actual code paths with full instrumentation
// This test will reveal EXACTLY where exchange becomes undefined and context violations occur

const fs = require('fs');
const path = require('path');

// Mock environment
process.env.ENCRYPTION_SECRET = "test_encryption_secret_for_runtime_trace_123456789012345678901234567890";

// Capture ALL console output
let capturedLogs = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({
    type: 'log',
    message,
    timestamp: Date.now(),
    stack: new Error().stack
  });
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({
    type: 'error',
    message,
    timestamp: Date.now(),
    stack: new Error().stack
  });
  originalConsoleError.apply(console, args);
};

async function runRuntimeTrace() {
  console.log('🚀 RUNTIME TRACE TEST - PHASE 1 EXECUTION');
  console.log('===========================================');

  try {
    // Initialize encryption
    console.log('1. Initializing encryption...');
    const { initializeEncryptionKey } = require('./dist/services/keyManager');
    initializeEncryptionKey();
    console.log('✅ Encryption initialized');

    // Test 1: Direct decrypt call with wrong context
    console.log('2. Testing decrypt with wrong context...');
    const { encrypt, decrypt } = require('./dist/services/keyManager');

    try {
      const testData = 'test_data_for_trace';
      const encrypted = encrypt(testData);
      console.log(`   Encrypted length: ${encrypted.length}`);

      // This should fail and log the full trace
      decrypt(encrypted, 'background_job');
    } catch (error) {
      console.log(`   Expected error: ${error.message}`);
    }

    // Test 2: Decrypt with correct context
    console.log('3. Testing decrypt with correct context...');
    try {
      const testData = 'test_data_correct_context';
      const encrypted = encrypt(testData);
      const decrypted = decrypt(encrypted, 'user_request');
      console.log(`   Round-trip success: "${decrypted}"`);
    } catch (error) {
      console.log(`   Unexpected error: ${error.message}`);
    }

    // Test 3: Sanitize function with invalid exchange
    console.log('4. Testing sanitize with invalid exchange...');

    // Load exchange route sanitize function
    const exchangeRoute = require('./dist/routes/exchange');

    try {
      // This should fail and log the full sanitization trace
      exchangeRoute.sanitizeFirestorePayload({ exchange: undefined, apiKey: 'test' });
    } catch (error) {
      console.log(`   Expected sanitize error: ${error.message}`);
    }

    // Test 4: Sanitize function with valid exchange
    console.log('5. Testing sanitize with valid exchange...');
    try {
      const result = exchangeRoute.sanitizeFirestorePayload({
        exchange: 'binance',
        apiKeyEncrypted: 'encrypted_key',
        undefinedField: undefined
      });
      console.log(`   Sanitize result:`, result);
    } catch (error) {
      console.log(`   Unexpected sanitize error: ${error.message}`);
    }

  } catch (error) {
    console.log(`❌ Test execution failed: ${error.message}`);
  }

  // Analyze captured logs
  console.log('\n📊 LOG ANALYSIS');
  console.log('===============');

  const decryptTraces = capturedLogs.filter(log => log.message.includes('DECRYPT_INSTRUMENTATION') || log.message.includes('RUNTIME_DECRYPT_TRACE'));
  const sanitizeTraces = capturedLogs.filter(log => log.message.includes('RUNTIME_SANITIZE'));
  const contextViolations = capturedLogs.filter(log => log.message.includes('CONTEXT_VIOLATION') || log.message.includes('RUNTIME_CONTEXT_VIOLATION'));
  const firestoreWrites = capturedLogs.filter(log => log.message.includes('RUNTIME_FIRESTORE_WRITE'));

  console.log(`Total logs captured: ${capturedLogs.length}`);
  console.log(`Decrypt traces: ${decryptTraces.length}`);
  console.log(`Sanitize traces: ${sanitizeTraces.length}`);
  console.log(`Context violations: ${contextViolations.length}`);
  console.log(`Firestore writes: ${firestoreWrites.length}`);

  console.log('\n🔍 DECRYPT TRACES:');
  decryptTraces.forEach((trace, i) => {
    console.log(`   ${i+1}. ${trace.message}`);
  });

  console.log('\n🔍 SANITIZE TRACES:');
  sanitizeTraces.forEach((trace, i) => {
    console.log(`   ${i+1}. ${trace.message}`);
  });

  console.log('\n🚫 CONTEXT VIOLATIONS:');
  contextViolations.forEach((violation, i) => {
    console.log(`   ${i+1}. ${violation.message}`);
  });

  console.log('\n💾 FIRESTORE WRITES:');
  firestoreWrites.forEach((write, i) => {
    console.log(`   ${i+1}. ${write.message}`);
  });

  // Save logs to file for analysis
  const logFile = path.join(__dirname, 'runtime-trace-results.json');
  fs.writeFileSync(logFile, JSON.stringify({
    summary: {
      totalLogs: capturedLogs.length,
      decryptTraces: decryptTraces.length,
      sanitizeTraces: sanitizeTraces.length,
      contextViolations: contextViolations.length,
      firestoreWrites: firestoreWrites.length
    },
    logs: capturedLogs
  }, null, 2));

  console.log(`\n💾 Full trace saved to: ${logFile}`);

  // Restore original console
  console.log = originalConsoleLog;
  console.error = originalConsoleError;

  return capturedLogs;
}

// Export for external use
module.exports = { runRuntimeTrace };

// Run if called directly
if (require.main === module) {
  runRuntimeTrace().then(logs => {
    console.log(`\n🎯 RUNTIME TRACE COMPLETE - ${logs.length} logs captured`);
    process.exit(0);
  }).catch(error => {
    console.error('Runtime trace failed:', error);
    process.exit(1);
  });
}
