// Test script to verify research API aggregation is working
const { spawn } = require('child_process');
const path = require('path');

async function testResearchAPIs() {
  console.log('Testing research API aggregation...');

  // Start the server
  console.log('Starting server...');
  const serverProcess = spawn('node', ['dist/index.js'], {
    cwd: process.cwd(),
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverReady = false;
  let serverOutput = '';

  // Listen for server ready
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString();
    serverOutput += output;
    if (output.includes('Server listening on port') && !serverReady) {
      serverReady = true;
      console.log('Server started successfully');
      runResearchTest();
    }
  });

  serverProcess.stderr.on('data', (data) => {
    console.log('Server stderr:', data.toString());
  });

  function runResearchTest() {
    console.log('Running research API test...');

    // Wait a bit for server to be fully ready
    setTimeout(() => {
      // Make a test research request
      const testPayload = {
        symbol: 'BTCUSDT',
        uid: 'test-user',
        timeframe: '5m'
      };

      console.log('Making research request with payload:', testPayload);

      // Use curl to test the research endpoint
      const curlProcess = spawn('curl', [
        '-X', 'POST',
        'http://localhost:3000/api/research/run',
        '-H', 'Content-Type: application/json',
        '-H', 'Authorization: Bearer test-token',
        '-d', JSON.stringify(testPayload)
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let responseData = '';
      let errorData = '';

      curlProcess.stdout.on('data', (data) => {
        responseData += data.toString();
      });

      curlProcess.stderr.on('data', (data) => {
        errorData += data.toString();
      });

      curlProcess.on('close', (code) => {
        console.log('Curl exit code:', code);
        console.log('Response:', responseData);

        if (responseData) {
          try {
            const response = JSON.parse(responseData);
            console.log('\n=== API USAGE ANALYSIS ===');

            if (response.result && response.result.apisUsed) {
              console.log('APIs Used:', response.result.apisUsed);

              const apisUsed = response.result.apisUsed;
              const successfulApis = Object.entries(apisUsed).filter(([key, value]) =>
                value === true || typeof value === 'string'
              );
              const failedApis = Object.entries(apisUsed).filter(([key, value]) =>
                value === false
              );

              console.log(`✅ Successful APIs (${successfulApis.length}):`, successfulApis.map(([k, v]) => k).join(', '));
              console.log(`❌ Failed APIs (${failedApis.length}):`, failedApis.map(([k, v]) => k).join(', '));

              if (successfulApis.length >= 3) {
                console.log('✅ SUCCESS: Multiple APIs are being used!');
              } else {
                console.log('❌ WARNING: Only', successfulApis.length, 'APIs reported as successful');
              }
            } else {
              console.log('❌ ERROR: No apisUsed field found in response');
            }

            if (response.result && response.result._apiUsageSummary) {
              console.log('\nAPI Usage Summary:', response.result._apiUsageSummary);
            }

          } catch (e) {
            console.log('Failed to parse response JSON:', e.message);
          }
        }

        if (errorData) {
          console.log('Curl stderr:', errorData);
        }

        // Clean up
        console.log('\nStopping server...');
        serverProcess.kill();
        process.exit(0);
      });

    }, 3000); // Wait 3 seconds for server to be ready
  }

  // Timeout after 30 seconds
  setTimeout(() => {
    if (!serverReady) {
      console.log('Server failed to start within 30 seconds');
      serverProcess.kill();
      process.exit(1);
    }
  }, 30000);

  // Handle server process exit
  serverProcess.on('exit', (code) => {
    console.log('Server exited with code:', code);
  });
}

testResearchAPIs();
