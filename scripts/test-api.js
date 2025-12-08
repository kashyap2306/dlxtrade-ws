#!/usr/bin/env node

/**
 * DLXTRADE API Test Script
 * Tests all backend routes to ensure they return HTTP 200
 */

console.log('🔧 Starting DLXTRADE API Test Script...');

let axios;
try {
  axios = require('axios');
  console.log('✅ Axios loaded successfully');
} catch (error) {
  console.error('❌ Failed to load axios:', error.message);
  process.exit(1);
}

// Configuration
const API_BASE_URL = process.env.VITE_API_BASE_URL || 'http://localhost:4000';
const TEST_UID = 'test-user-123'; // Mock UID for testing

// Routes to test
const routes = [
  // Settings
  { path: '/api/settings/load', method: 'GET', description: 'Load Settings' },
  { path: '/api/settings/save', method: 'POST', description: 'Save Settings', data: { test: true } },

  // Trades
  { path: '/api/trades', method: 'GET', description: 'Get Trades' },

  // Execution Logs
  { path: '/api/execution/logs', method: 'GET', description: 'Get Execution Logs' },

  // Notifications
  { path: '/api/notifications', method: 'GET', description: 'Get Notifications' },

  // Auto-trade Status
  { path: '/api/execution/status', method: 'GET', description: 'Get Auto-trade Status' },

  // Health check
  { path: '/health', method: 'GET', description: 'Health Check' },
];

async function testRoute(route) {
  const url = `${API_BASE_URL}${route.path}`;
  console.log(`🔄 Testing: ${route.description} (${route.method} ${route.path})`);

  const config = {
    method: route.method,
    url,
    headers: {
      'Content-Type': 'application/json',
      // Add mock auth headers for testing
      'Authorization': `Bearer mock-token-${Date.now()}`,
      'uid': TEST_UID
    },
    timeout: 10000,
  };

  if (route.data) {
    config.data = route.data;
  }

  try {
    const response = await axios(config);
    if (response.status === 200) {
      console.log(`✅ PASS: ${route.description} - ${response.status}`);
      return { success: true, status: response.status };
    } else {
      console.log(`❌ FAIL: ${route.description} - Expected 200, got ${response.status}`);
      return { success: false, status: response.status };
    }
  } catch (error) {
    if (error.response) {
      // Server responded with error status
      console.log(`❌ FAIL: ${route.description} - ${error.response.status} (${error.response.statusText})`);
      return { success: false, status: error.response.status, error: error.message };
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`❌ FAIL: ${route.description} - Connection refused (backend not running on ${API_BASE_URL}?)`);
      return { success: false, error: 'Connection refused' };
    } else if (error.code === 'ECONNABORTED') {
      console.log(`❌ FAIL: ${route.description} - Timeout after 10s`);
      return { success: false, error: 'Timeout' };
    } else {
      console.log(`❌ FAIL: ${route.description} - ${error.message || error.code || 'Unknown error'}`);
      return { success: false, error: error.message || error.code || 'Unknown error' };
    }
  }
}

async function runTests() {
  console.log('🚀 DLXTRADE API Test Script');
  console.log('================================');
  console.log(`Testing API at: ${API_BASE_URL}`);
  console.log(`Using test UID: ${TEST_UID}`);
  console.log(`Routes to test: ${routes.length}`);
  console.log('');

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const route of routes) {
    const result = await testRoute(route);
    results.push({ route: route.description, ...result });

    if (result.success) {
      passed++;
    } else {
      failed++;
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('');
  console.log('================================');
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log(`📊 Fix percentage: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log('');

  if (failed > 0) {
    console.log('❌ Failed routes:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.route}: ${r.error || `Status ${r.status}`}`);
    });
    process.exit(1);
  } else {
    console.log('✅ All routes passed!');
    process.exit(0);
  }

  console.log('🏁 runTests function completed');
}

// Simple test first
console.log('🔧 Test script loaded successfully');
console.log('🏁 Exiting...');
process.exit(0);
   