// RUNTIME CORRUPTION TEST - Find the exact source of exchange corruption
// This test starts the server and traces EVERY operation

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Capture all server output
let serverOutput = [];
let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting server for runtime corruption test...');

    // Set test environment
    const env = {
      ...process.env,
      ENCRYPTION_SECRET: "test_encryption_secret_runtime_corruption_123456789012345678901234567890",
      NODE_ENV: "development"
    };

    // Start server in development mode (loads src files directly)
    serverProcess = spawn('npm', ['run', 'dev'], {
      cwd: __dirname,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverStarted = false;
    let startupTimeout = setTimeout(() => {
      reject(new Error('Server startup timeout'));
    }, 30000);

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      serverOutput.push({ type: 'stdout', data: output, timestamp: Date.now() });

      // Check for server ready
      if (output.includes('Server listening') || output.includes('listening on port')) {
        serverStarted = true;
        clearTimeout(startupTimeout);
        console.log('✅ Server started successfully');
        setTimeout(resolve, 2000); // Wait for full startup
      }

      // Log important output
      if (output.includes('[EXECUTION_TRUTH]') ||
          output.includes('[EXCHANGE_CORRUPTION_DETECTED]') ||
          output.includes('[CONTEXT_LEAK_DETECTED]') ||
          output.includes('[SANITIZE_EXECUTION]') ||
          output.includes('[FIRESTORE_WRITE_START]')) {
        console.log('📊 SERVER LOG:', output.trim());
      }
    });

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      serverOutput.push({ type: 'stderr', data: output, timestamp: Date.now() });
      console.error('📊 SERVER ERROR:', output.trim());
    });

    serverProcess.on('close', (code) => {
      console.log(`Server process exited with code ${code}`);
      if (!serverStarted) {
        reject(new Error(`Server failed to start (exit code: ${code})`));
      }
    });

    serverProcess.on('error', (error) => {
      reject(error);
    });
  });
}

async function makeRequest(method, url, data = null) {
  const axios = require('axios');

  const config = {
    method,
    url: `http://localhost:3000${url}`,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    config.data = data;
  }

  try {
    console.log(`\n🌐 ${method} ${url}`);
    if (data) {
      console.log(`📤 Request:`, JSON.stringify(data, null, 2));
    }

    const response = await axios(config);
    console.log(`✅ ${response.status}`);
    console.log(`📥 Response:`, JSON.stringify(response.data, null, 2));
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    console.log(`❌ ${error.response?.status || 'ERROR'}`);
    if (error.response?.data) {
      console.log(`📥 Error:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(`📥 Error:`, error.message);
    }
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
  }
}

async function runCorruptionTest() {
  console.log('🔍 RUNTIME CORRUPTION TEST - Finding the exact corruption source');
  console.log('============================================================');

  try {
    // Phase 1: Start server and verify execution paths
    console.log('Phase 1: Starting server and verifying execution paths...');
    await startServer();

    // Check which files are actually being executed
    const executionTruthLogs = serverOutput.filter(log =>
      log.data.includes('[EXECUTION_TRUTH]')
    );

    console.log('\n📋 EXECUTION TRUTH VERIFICATION:');
    executionTruthLogs.forEach(log => {
      console.log('   ', log.data.trim());
    });

    // Check if any dist files are being used
    const distUsage = serverOutput.filter(log =>
      log.data.includes('/dist/') || log.data.includes('LOADING FROM DIST')
    );

    if (distUsage.length > 0) {
      console.log('\n🚨 DIST FILES DETECTED - This explains failures:');
      distUsage.forEach(log => {
        console.log('   ', log.data.trim());
      });
    } else {
      console.log('\n✅ No dist file usage detected - running from source');
    }

    // Phase 2: Test provider config (should trigger decrypt context logging)
    console.log('\nPhase 2: Testing provider config (decrypt context tracing)...');
    const providerResult = await makeRequest('POST', '/api/users/test_user_corruption/provider-config', {
      'binance': {
        providerName: 'binance',
        apiKey: 'test_api_key_corruption_test',
        secretKey: 'test_secret_key_corruption_test',
        enabled: true,
        type: 'marketdata'
      }
    });

    // Phase 3: Test exchange connect (should trigger exchange sanitization logging)
    console.log('\nPhase 3: Testing exchange connect (exchange corruption tracing)...');
    const exchangeResult = await makeRequest('POST', '/api/exchange/connect', {
      exchange: 'binance',
      apiKey: 'test_exchange_api_corruption',
      secret: 'test_exchange_secret_corruption'
    });

    // Phase 4: Read exchange config (should show final state)
    console.log('\nPhase 4: Reading exchange config (final state verification)...');
    const readResult = await makeRequest('GET', '/api/users/test_user_corruption/exchangeConfig/current');

    // Analysis Phase
    console.log('\n📊 ANALYSIS RESULTS');
    console.log('==================');

    // Check for context leaks
    const contextLeaks = serverOutput.filter(log =>
      log.data.includes('[CONTEXT_LEAK_DETECTED]') ||
      log.data.includes('[RUNTIME_CONTEXT_VIOLATION]')
    );

    console.log(`\n🚫 Context Leaks Detected: ${contextLeaks.length}`);
    if (contextLeaks.length > 0) {
      console.log('DETAILS:');
      contextLeaks.forEach((leak, i) => {
        console.log(`   ${i+1}. ${leak.data.trim()}`);
      });
    }

    // Check for exchange corruption
    const exchangeCorruption = serverOutput.filter(log =>
      log.data.includes('[EXCHANGE_CORRUPTION_DETECTED]') ||
      log.data.includes('Unsupported exchange')
    );

    console.log(`\n🚫 Exchange Corruption Detected: ${exchangeCorruption.length}`);
    if (exchangeCorruption.length > 0) {
      console.log('DETAILS:');
      exchangeCorruption.forEach((corruption, i) => {
        console.log(`   ${i+1}. ${corruption.data.trim()}`);
      });
    }

    // Check for sanitization operations
    const sanitizeOps = serverOutput.filter(log =>
      log.data.includes('[SANITIZE_EXECUTION]')
    );

    console.log(`\n🔧 Sanitize Operations: ${sanitizeOps.length}`);
    if (sanitizeOps.length > 0) {
      sanitizeOps.forEach((op, i) => {
        console.log(`   ${i+1}. ${op.data.substring(0, 100).trim()}...`);
      });
    }

    // Check for firestore writes
    const firestoreWrites = serverOutput.filter(log =>
      log.data.includes('[FIRESTORE_WRITE_START]')
    );

    console.log(`\n💾 Firestore Writes: ${firestoreWrites.length}`);
    if (firestoreWrites.length > 0) {
      firestoreWrites.forEach((write, i) => {
        console.log(`   ${i+1}. ${write.data.substring(0, 150).trim()}...`);
      });
    }

    // Final state analysis
    console.log(`\n🎯 FINAL STATE ANALYSIS:`);
    console.log(`   Provider Config Success: ${providerResult.success}`);
    console.log(`   Exchange Connect Success: ${exchangeResult.success}`);
    console.log(`   Exchange Config Read Success: ${readResult.success}`);

    if (readResult.success && readResult.data) {
      console.log(`   Final Exchange Value: "${readResult.data.exchange}"`);
      console.log(`   Exchange Type: ${typeof readResult.data.exchange}`);
      console.log(`   Connected Status: ${readResult.data.connected}`);
    }

    // Determine root cause
    let rootCause = 'UNKNOWN';

    if (contextLeaks.length > 0) {
      rootCause = 'CONTEXT_LEAK: decrypt() called without proper context parameter';
    } else if (exchangeCorruption.length > 0) {
      rootCause = 'EXCHANGE_CORRUPTION: Exchange field became undefined/empty during sanitization';
    } else if (distUsage.length > 0) {
      rootCause = 'DIST_FILE_MISMATCH: Server running old dist files instead of updated source';
    } else if (!readResult.success || !readResult.data?.exchange) {
      rootCause = 'EXCHANGE_MISSING: Exchange field never properly set';
    } else {
      rootCause = 'UNKNOWN - All operations succeeded';
    }

    console.log(`\n🎯 ROOT CAUSE IDENTIFIED: ${rootCause}`);

    // Save full logs for analysis
    const logFile = path.join(__dirname, 'runtime-corruption-results.json');
    fs.writeFileSync(logFile, JSON.stringify({
      summary: {
        contextLeaks: contextLeaks.length,
        exchangeCorruption: exchangeCorruption.length,
        sanitizeOperations: sanitizeOps.length,
        firestoreWrites: firestoreWrites.length,
        rootCause: rootCause
      },
      operations: {
        providerConfig: providerResult,
        exchangeConnect: exchangeResult,
        exchangeRead: readResult
      },
      logs: serverOutput
    }, null, 2));

    console.log(`\n💾 Full analysis saved to: ${logFile}`);

    return {
      rootCause,
      contextLeaks: contextLeaks.length,
      exchangeCorruption: exchangeCorruption.length,
      success: contextLeaks.length === 0 && exchangeCorruption.length === 0
    };

  } catch (error) {
    console.error('❌ Test execution failed:', error);
    return { error: error.message };
  } finally {
    // Cleanup
    if (serverProcess) {
      console.log('\n🛑 Stopping server...');
      serverProcess.kill('SIGTERM');

      setTimeout(() => {
        if (!serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
      }, 5000);
    }
  }
}

// Run the test
runCorruptionTest().then(results => {
  console.log(`\n🏁 RUNTIME CORRUPTION TEST COMPLETE`);

  if (results.error) {
    console.log(`❌ Test failed: ${results.error}`);
    process.exit(1);
  }

  if (results.success) {
    console.log(`✅ NO CORRUPTION DETECTED - System is working correctly`);
    process.exit(0);
  } else {
    console.log(`❌ CORRUPTION DETECTED`);
    console.log(`   Root Cause: ${results.rootCause}`);
    console.log(`   Context Leaks: ${results.contextLeaks}`);
    console.log(`   Exchange Corruption: ${results.exchangeCorruption}`);
    process.exit(1);
  }
}).catch(error => {
  console.error('Test setup failed:', error);
  process.exit(1);
});

