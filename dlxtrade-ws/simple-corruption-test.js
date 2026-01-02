// SIMPLE CORRUPTION TEST - Load modules and test instrumentation without server
// This will verify instrumentation works and find issues in module loading

const fs = require('fs');
const path = require('path');

// Capture logs
let capturedLogs = [];
const originalLog = console.log;
const originalError = console.error;

console.log = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({ type: 'log', message, timestamp: Date.now() });
  originalLog.apply(console, args);
};

console.error = function(...args) {
  const message = args.join(' ');
  capturedLogs.push({ type: 'error', message, timestamp: Date.now() });
  originalError.apply(console, args);
};

async function testModuleLoading() {
  console.log('🔍 SIMPLE CORRUPTION TEST - Module loading and instrumentation verification');
  console.log('========================================================================');

  try {
    // Set test environment
    process.env.ENCRYPTION_SECRET = "test_encryption_secret_module_test_123456789012345678901234567890";

    // Phase 0: Verify which files are being loaded
    console.log('Phase 0: Verifying file paths being loaded...');

    // Phase 1: Test keyManager instrumentation (try dist first, then src)
    console.log('\nPhase 1: Testing keyManager instrumentation...');

    let keyManagerModule;
    try {
      keyManagerModule = require('./dist/services/keyManager');
      console.log(`   Loaded keyManager from: dist/services/keyManager`);
    } catch (error) {
      try {
        keyManagerModule = require('./src/services/keyManager');
        console.log(`   Loaded keyManager from: src/services/keyManager`);
      } catch (error2) {
        console.log(`   keyManager load error: ${error.message}`);
        throw new Error('Cannot load keyManager module');
      }
    }

    const { initializeEncryptionKey, encrypt, decrypt } = keyManagerModule;
    initializeEncryptionKey();

    const testData = 'test_encryption_data';
    const encrypted = encrypt(testData);
    console.log(`   Encryption successful, length: ${encrypted.length}`);

    // Test valid context
    try {
      const decrypted = decrypt(encrypted, 'user_request');
      console.log(`   ✅ Valid context decryption successful: "${decrypted}"`);
    } catch (error) {
      console.log(`   ❌ Valid context decryption failed: ${error.message}`);
    }

    // Test invalid context (should log and throw)
    try {
      decrypt(encrypted, 'background_job');
      console.log(`   ❌ Invalid context should have failed`);
    } catch (error) {
      console.log(`   ✅ Invalid context properly blocked: ${error.message}`);
    }

    // Phase 2: Test sanitize instrumentation
    console.log('\nPhase 2: Testing sanitize instrumentation...');

    try {
      let exchangeRoute;
      try {
        exchangeRoute = require('./dist/routes/exchange');
        console.log(`   Loaded exchange route from: dist/routes/exchange`);
      } catch (error) {
        exchangeRoute = require('./src/routes/exchange');
        console.log(`   Loaded exchange route from: src/routes/exchange`);
      }

      // Test with valid exchange (should log and succeed)
      console.log('   Testing sanitize with valid exchange...');
      const validPayload = { exchange: 'binance', apiKeyEncrypted: 'test' };
      const validResult = exchangeRoute.sanitizeFirestorePayload(validPayload);
      console.log(`   ✅ Valid sanitize result: ${JSON.stringify(validResult)}`);

      // Test with invalid exchange (should log and throw)
      console.log('   Testing sanitize with invalid exchange...');
      const invalidPayload = { exchange: undefined, apiKeyEncrypted: 'test' };
      const invalidResult = exchangeRoute.sanitizeFirestorePayload(invalidPayload);
      console.log(`   ❌ Invalid sanitize should have thrown`);
    } catch (error) {
      console.log(`   ✅ Invalid sanitize properly threw: ${error.message}`);
    }

    // Phase 3: Test provider config instrumentation
    console.log('\nPhase 3: Testing provider config instrumentation...');

    try {
      const { testEncryptionConsistency } = require('./src/services/keyManager');
      const consistencyResult = testEncryptionConsistency();
      console.log(`   Encryption consistency: ${consistencyResult ? 'PASS' : 'FAIL'}`);
    } catch (error) {
      console.log(`   Encryption consistency error: ${error.message}`);
    }

  } catch (error) {
    console.log(`❌ Module loading test failed: ${error.message}`);
    console.error(error.stack);
  }

  // Analyze captured logs
  console.log('\n📊 LOG ANALYSIS');
  console.log('===============');

  const decryptTraces = capturedLogs.filter(log =>
    log.message.includes('[DECRYPT_CALL_TRACE]') ||
    log.message.includes('[CONTEXT_LEAK_DETECTED]') ||
    log.message.includes('[DECRYPT_CONTEXT_VALID]')
  );

  const sanitizeTraces = capturedLogs.filter(log =>
    log.message.includes('[SANITIZE_EXECUTION]') ||
    log.message.includes('[EXCHANGE_CORRUPTION_DETECTED]') ||
    log.message.includes('[EXCHANGE_SANITIZE_CHECK]')
  );

  const contextViolations = capturedLogs.filter(log =>
    log.message.includes('[CONTEXT_LEAK_DETECTED]') ||
    log.message.includes('[RUNTIME_CONTEXT_VIOLATION]')
  );

  console.log(`Total logs captured: ${capturedLogs.length}`);
  console.log(`Decrypt traces: ${decryptTraces.length}`);
  console.log(`Sanitize traces: ${sanitizeTraces.length}`);
  console.log(`Context violations: ${contextViolations.length}`);

  console.log('\n🔍 DECRYPT OPERATIONS:');
  decryptTraces.forEach((trace, i) => {
    console.log(`   ${i+1}. ${trace.message.substring(0, 120).trim()}...`);
  });

  console.log('\n🔧 SANITIZE OPERATIONS:');
  sanitizeTraces.forEach((trace, i) => {
    console.log(`   ${i+1}. ${trace.message.substring(0, 120).trim()}...`);
  });

  console.log('\n🚫 CONTEXT VIOLATIONS:');
  contextViolations.forEach((violation, i) => {
    console.log(`   ${i+1}. ${violation.message}`);
  });

  // Check for corruption patterns
  const exchangeUndefined = capturedLogs.filter(log =>
    log.message.includes('exchangeInputIsUndefined: true') ||
    log.message.includes('EXCHANGE_CORRUPTION_DETECTED')
  );

  console.log(`\n🚨 EXCHANGE UNDEFINED INCIDENTS: ${exchangeUndefined.length}`);
  if (exchangeUndefined.length > 0) {
    console.log('DETAILS:');
    exchangeUndefined.forEach((incident, i) => {
      console.log(`   ${i+1}. ${incident.message}`);
    });
  }

  // Determine if instrumentation is working
  const instrumentationWorking = decryptTraces.length > 0 || sanitizeTraces.length > 0;

  console.log(`\n🎯 INSTRUMENTATION STATUS: ${instrumentationWorking ? 'WORKING' : 'NOT WORKING'}`);

  if (!instrumentationWorking) {
    console.log('🚨 CRITICAL: Instrumentation is not firing - cannot detect corruption');
  }

  // Save results
  const resultsFile = path.join(__dirname, 'simple-corruption-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify({
    summary: {
      totalLogs: capturedLogs.length,
      decryptTraces: decryptTraces.length,
      sanitizeTraces: sanitizeTraces.length,
      contextViolations: contextViolations.length,
      exchangeUndefinedIncidents: exchangeUndefined.length,
      instrumentationWorking: instrumentationWorking
    },
    logs: capturedLogs.slice(-100) // Last 100 logs
  }, null, 2));

  console.log(`\n💾 Results saved to: ${resultsFile}`);

  // Restore console
  console.log = originalLog;
  console.error = originalError;

  return {
    instrumentationWorking,
    contextViolations: contextViolations.length,
    exchangeUndefinedIncidents: exchangeUndefined.length,
    totalLogs: capturedLogs.length
  };
}

// Run the test
testModuleLoading().then(results => {
  console.log(`\n🏁 SIMPLE CORRUPTION TEST COMPLETE`);

  if (results.instrumentationWorking) {
    console.log(`✅ Instrumentation is working (${results.totalLogs} logs captured)`);

    if (results.contextViolations > 0) {
      console.log(`🚨 CONTEXT VIOLATIONS DETECTED: ${results.contextViolations}`);
    }

    if (results.exchangeUndefinedIncidents > 0) {
      console.log(`🚨 EXCHANGE CORRUPTION DETECTED: ${results.exchangeUndefinedIncidents}`);
    }

    if (results.contextViolations === 0 && results.exchangeUndefinedIncidents === 0) {
      console.log(`✅ NO CORRUPTION DETECTED in module loading`);
    }
  } else {
    console.log(`❌ Instrumentation is not working - cannot detect issues`);
  }

  process.exit(results.instrumentationWorking ? 0 : 1);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
