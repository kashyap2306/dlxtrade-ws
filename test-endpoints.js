#!/usr/bin/env node

/**
 * Quick validation script for the Settings UI integration
 * Tests key endpoints to ensure they're working
 */

const axios = require('axios');

// Test endpoints (you'll need to replace with actual auth token)
const BASE_URL = 'http://localhost:3001/api';

async function testEndpoint(name, method, url, data = null) {
  try {
    console.log(`\n🔍 Testing ${name}...`);
    const config = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json',
        // Add auth header when testing: 'Authorization': 'Bearer YOUR_TOKEN'
      }
    };

    if (data && (method === 'post' || method === 'put')) {
      config.data = data;
    }

    const response = await axios(config);
    console.log(`✅ ${name}: ${response.status} - ${response.statusText}`);
    return true;
  } catch (error) {
    console.log(`❌ ${name}: ${error.response?.status || 'ERROR'} - ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🚀 DLXTRADE Settings Integration - Endpoint Validation\n');

  const results = [];

  // Test settings endpoints
  results.push(await testEndpoint('Load Settings', 'get', `${BASE_URL}/settings/load`));
  results.push(await testEndpoint('Load Trading Settings', 'get', `${BASE_URL}/settings/trading`));
  results.push(await testEndpoint('Load Notifications', 'get', `${BASE_URL}/settings/notifications`));
  results.push(await testEndpoint('Load Selected Coins', 'get', `${BASE_URL}/settings/selectedCoins`));

  // Test provider endpoints
  results.push(await testEndpoint('Load Providers', 'get', `${BASE_URL}/settings/providers`));
  results.push(await testEndpoint('Test CoinGecko Provider', 'post', `${BASE_URL}/settings/provider/test`, {
    providerName: 'CoinGecko',
    type: 'marketData'
  }));

  // Test exchange endpoints
  results.push(await testEndpoint('Exchange Status', 'get', `${BASE_URL}/exchange/status`));

  console.log('\n📊 Results Summary:');
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`${passed}/${total} endpoints responding correctly`);

  if (passed === total) {
    console.log('🎉 All endpoints are working! Ready for production.');
  } else {
    console.log('⚠️ Some endpoints need attention before deployment.');
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testEndpoint, runTests };
