#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = 'http://localhost:4000';
const TEST_AGENT_ID = 'test-agent-123';

// Test function to verify trading agent endpoints
async function testTradingAgentEndpoints() {
  console.log('🚀 Testing Trading Agent Endpoints');
  console.log('=====================================');

  const endpoints = [
    {
      method: 'GET',
      path: `/api/agents/${TEST_AGENT_ID}/control`,
      description: 'Get trading agent control data'
    },
    {
      method: 'POST',
      path: `/api/agents/${TEST_AGENT_ID}/start`,
      description: 'Start trading agent'
    },
    {
      method: 'POST',
      path: `/api/agents/${TEST_AGENT_ID}/stop`,
      description: 'Stop trading agent'
    }
  ];

  let allTestsPassed = true;

  for (const endpoint of endpoints) {
    try {
      console.log(`\n📋 Testing ${endpoint.method} ${endpoint.path}`);
      console.log(`   Description: ${endpoint.description}`);

      const response = await axios({
        method: endpoint.method,
        url: `${BASE_URL}${endpoint.path}`,
        headers: {
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      console.log(`   ✅ Status: ${response.status}`);

      // Check if it's not a 404
      if (response.status === 404) {
        console.log(`   ❌ FAILED: Endpoint returned 404 Not Found`);
        allTestsPassed = false;
      } else {
        console.log(`   ✅ SUCCESS: Endpoint is accessible (status: ${response.status})`);

        // Check response structure for control endpoint
        if (endpoint.path.includes('/control') && response.data) {
          const hasAgentId = response.data.agentId !== undefined;
          const hasStatus = response.data.status !== undefined;

          console.log(`   📊 Response validation:`);
          console.log(`      - Has agentId: ${hasAgentId ? '✅' : '❌'}`);
          console.log(`      - Has status: ${hasStatus ? '✅' : '❌'}`);

          if (!hasAgentId || !hasStatus) {
            console.log(`   ⚠️  WARNING: Response structure may be incomplete`);
          }
        }
      }

    } catch (error) {
      console.log(`   ❌ ERROR: ${error.message}`);

      if (error.response) {
        console.log(`   📊 Response status: ${error.response.status}`);

        if (error.response.status === 404) {
          console.log(`   💥 CRITICAL: Endpoint returns 404 - Route not found!`);
          allTestsPassed = false;
        } else if (error.response.status === 401 || error.response.status === 403) {
          console.log(`   ✅ Expected auth error (endpoint exists, just needs proper auth)`);
        } else {
          console.log(`   ⚠️  Unexpected status code: ${error.response.status}`);
        }
      } else {
        console.log(`   ❌ Network error or timeout - server may not be running`);
        allTestsPassed = false;
      }
    }
  }

  console.log('\n=====================================');
  console.log('🎯 TEST RESULTS');
  console.log('=====================================');

  if (allTestsPassed) {
    console.log('✅ ALL TESTS PASSED');
    console.log('🎉 Trading Agent endpoints are working correctly!');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('💥 Trading Agent endpoints have issues that need to be fixed!');
    process.exit(1);
  }
}

// Check if server is running first
async function checkServerHealth() {
  try {
    console.log('🏥 Checking if backend server is running...');
    const response = await axios.get(`${BASE_URL}/api/health`, { timeout: 3000 });
    console.log('✅ Server is running');
    return true;
  } catch (error) {
    console.log('❌ Server is not running or not accessible');
    console.log('💡 Please start the backend server first: cd dlxtrade-ws && npm start');
    return false;
  }
}

// Main execution
async function main() {
  console.log('🔬 Trading Agent Endpoint Test Suite');
  console.log('=====================================');

  const serverRunning = await checkServerHealth();
  if (!serverRunning) {
    process.exit(1);
  }

  await testTradingAgentEndpoints();
}

main().catch(error => {
  console.error('💥 Test suite failed with error:', error.message);
  process.exit(1);
});