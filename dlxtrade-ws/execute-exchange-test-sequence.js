/**
 * EXECUTE FULL EXCHANGE TEST SEQUENCE
 * Tests credential consistency and finds mismatches
 */

const axios = require('axios');

// Test configuration - REPLACE WITH REAL VALUES
const BASE_URL = 'http://localhost:4000';
const TEST_UID = 'exchange-test-user-123';

// REAL EXCHANGE CREDENTIALS - REPLACE THESE
const REAL_CREDENTIALS = {
  exchange: 'binance',
  apiKey: 'YOUR_REAL_BINANCE_API_KEY', // Replace with real key
  secret: 'YOUR_REAL_BINANCE_SECRET',  // Replace with real secret
  testnet: true
};

let capturedLogs = {
  validation: null,
  test: null,
  final: null
};

async function makeRequest(method, url, data = null, auth = true) {
  try {
    const config = {
      method,
      url: BASE_URL + url,
      headers: {}
    };

    if (auth) {
      // Mock auth for testing - in real scenario would use proper JWT
      config.headers['Authorization'] = 'Bearer test-token';
    }

    if (data) {
      config.data = data;
      config.headers['Content-Type'] = 'application/json';
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.log(`❌ ${method} ${url} failed:`, error.response?.data || error.message);
    return null;
  }
}

async function executeTestSequence() {
  console.log('🚀 EXECUTING EXCHANGE TEST SEQUENCE\n');

  // A. Fresh Exchange Connect
  console.log('A. FRESH EXCHANGE CONNECT');
  console.log('POST /api/exchange/connect');

  const connectResult = await makeRequest('POST', '/api/exchange/connect', {
    exchange: REAL_CREDENTIALS.exchange,
    apiKey: REAL_CREDENTIALS.apiKey,
    secret: REAL_CREDENTIALS.secret,
    testnet: REAL_CREDENTIALS.testnet
  });

  if (connectResult?.success) {
    console.log('✅ Connect successful');
  } else {
    console.log('❌ Connect failed');
    return;
  }

  // B. Status Check
  console.log('\nB. STATUS CHECK');
  console.log('GET /api/exchange/status');

  const statusResult = await makeRequest('GET', '/api/exchange/status');
  console.log('Status result:', statusResult);

  if (statusResult?.connected !== true) {
    console.log('❌ Status check failed - not connected');
    return;
  }

  // C. Adapter Ping Test
  console.log('\nC. ADAPTER PING TEST');
  console.log('POST /api/exchange/test');

  const testResult = await makeRequest('POST', '/api/exchange/test', {
    exchange: REAL_CREDENTIALS.exchange,
    apiKey: REAL_CREDENTIALS.apiKey,
    secret: REAL_CREDENTIALS.secret,
    testnet: REAL_CREDENTIALS.testnet
  });

  console.log('Test result:', testResult);

  // D. Trade Path Test
  console.log('\nD. TRADE PATH TEST');
  console.log('POST /api/exchange/test-trade');

  const tradeResult = await makeRequest('POST', '/api/exchange/test-trade', {
    symbol: 'BTCUSDT',
    side: 'BUY',
    quantity: 0.001
  });

  console.log('Trade result:', tradeResult);

  console.log('\n📊 CHECK BACKEND LOGS FOR:');
  console.log('- DEBUG_EXCHANGE_CREDENTIALS_VALIDATION');
  console.log('- DEBUG_EXCHANGE_CREDENTIALS_TEST');
  console.log('- DEBUG_EXCHANGE_CREDENTIALS_FINAL');
  console.log('- DEBUG_EXCHANGE_ADAPTER_PING_SUCCESS/FAILED');

  console.log('\n🔍 COMPARE THESE OBJECTS FOR MISMATCHES:');
  console.log('1. Credential lengths');
  console.log('2. Trimming consistency');
  console.log('3. undefined vs empty string');
  console.log('4. testnet flag');
  console.log('5. exchange name casing');
}

// Run the test
executeTestSequence().catch(console.error);
