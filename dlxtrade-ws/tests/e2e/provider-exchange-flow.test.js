// E2E TEST: Provider Config + Exchange Config Flow
// Tests the complete user flow to ensure all fixes work

const axios = require('axios');

// Test configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_UID = `test_user_${Date.now()}`;

// Mock credentials
const MOCK_API_KEY = 'test_api_key_12345';
const MOCK_SECRET_KEY = 'test_secret_key_67890';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function makeRequest(method, url, data = null) {
  const config = {
    method,
    url: BASE_URL + url,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    config.data = data;
  }

  try {
    console.log(`📡 ${method} ${url}`);
    const response = await axios(config);
    console.log(`✅ ${response.status}:`, response.data);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    console.log(`❌ ${method} ${url} failed:`, error.response?.status, error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    };
  }
}

async function testProviderConfigSave() {
  console.log('\n🧪 === TESTING PROVIDER CONFIG SAVE ===');

  const payload = {
    'binance': {
      providerName: 'binance',
      apiKey: MOCK_API_KEY,
      secretKey: MOCK_SECRET_KEY,
      enabled: true,
      type: 'marketdata'
    }
  };

  const result = await makeRequest('POST', `/api/users/${TEST_UID}/provider-config`, payload);

  if (!result.success) {
    throw new Error(`Provider config save failed: ${result.error}`);
  }

  if (result.status !== 200) {
    throw new Error(`Provider config save returned ${result.status}, expected 200`);
  }

  console.log('✅ Provider config saved successfully');
  return true;
}

async function testExchangeConnect() {
  console.log('\n🧪 === TESTING EXCHANGE CONNECT ===');

  const payload = {
    exchange: 'binance',
    apiKey: MOCK_API_KEY,
    secret: MOCK_SECRET_KEY
  };

  const result = await makeRequest('POST', '/api/exchange/connect', payload);

  if (!result.success) {
    throw new Error(`Exchange connect failed: ${result.error}`);
  }

  if (result.status !== 200) {
    throw new Error(`Exchange connect returned ${result.status}, expected 200`);
  }

  console.log('✅ Exchange connected successfully');
  return true;
}

async function testExchangeConfigRead() {
  console.log('\n🧪 === TESTING EXCHANGE CONFIG READ ===');

  const result = await makeRequest('GET', `/api/users/${TEST_UID}/exchangeConfig/current`);

  if (!result.success) {
    throw new Error(`Exchange config read failed: ${result.error}`);
  }

  const data = result.data;

  // Assert exchange field exists and is valid
  if (!data.exchange) {
    throw new Error(`Exchange field is missing: ${data.exchange}`);
  }

  if (data.exchange === "" || data.exchange === null || data.exchange === undefined) {
    throw new Error(`Exchange field is invalid: "${data.exchange}"`);
  }

  if (typeof data.exchange !== 'string') {
    throw new Error(`Exchange field is not a string: ${typeof data.exchange}`);
  }

  if (data.exchange.trim() === '') {
    throw new Error(`Exchange field is empty string`);
  }

  // Assert connected status
  if (data.connected !== true) {
    throw new Error(`Connected status is not true: ${data.connected}`);
  }

  // Assert isExchangeUsable would return connected
  const usability = await import('../../dist/services/firestoreAdapter').then(m => m.isExchangeUsable(TEST_UID, 'user_request'));

  if (!usability.usable) {
    throw new Error(`isExchangeUsable returned not usable: ${usability.reason}`);
  }

  if (usability.reason !== 'connected') {
    throw new Error(`isExchangeUsable returned wrong reason: ${usability.reason}, expected 'connected'`);
  }

  console.log('✅ Exchange config read successful');
  console.log(`   Exchange: "${data.exchange}"`);
  console.log(`   Connected: ${data.connected}`);
  console.log(`   Usability: ${usability.usable} (${usability.reason})`);

  return true;
}

async function runE2ETest() {
  console.log('🚀 E2E TEST: Provider + Exchange Config Flow');
  console.log('==============================================');
  console.log(`Test User: ${TEST_UID}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('');

  try {
    // Step 1: Save provider config
    await testProviderConfigSave();

    // Step 2: Connect exchange
    await testExchangeConnect();

    // Step 3: Read exchange config and verify
    await testExchangeConfigRead();

    console.log('\n🎉 ALL TESTS PASSED!');
    console.log('✅ Provider config saves successfully');
    console.log('✅ Exchange connects successfully');
    console.log('✅ Exchange field persists correctly');
    console.log('✅ Connected status accurate');
    console.log('✅ No DECRYPT_BLOCKED errors');
    console.log('✅ No TEST_DECRYPT_FAILED_AFTER_ENCRYPT errors');

    return true;

  } catch (error) {
    console.log('\n❌ TEST FAILED!');
    console.log(`Error: ${error.message}`);

    // Check for specific error patterns
    if (error.message.includes('DECRYPT_BLOCKED')) {
      console.log('❌ DECRYPT_BLOCKED error detected - context issue');
    }

    if (error.message.includes('TEST_DECRYPT_FAILED_AFTER_ENCRYPT')) {
      console.log('❌ TEST_DECRYPT_FAILED_AFTER_ENCRYPT error detected - encryption issue');
    }

    return false;
  }
}

// Export for external usage
module.exports = { runE2ETest };

// Run if called directly
if (require.main === module) {
  runE2ETest().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

