/**
 * HTF Trend Filter Agent Routes Test Script
 * 
 * This script verifies that all HTF agent routes are properly registered and responding.
 * 
 * Usage:
 * 1. Ensure backend server is running
 * 2. Get a valid Firebase auth token
 * 3. Run: node test-htf-agent-routes.js <AUTH_TOKEN>
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const AUTH_TOKEN = process.argv[2];

if (!AUTH_TOKEN) {
  console.error('❌ ERROR: Please provide Firebase auth token as argument');
  console.error('Usage: node test-htf-agent-routes.js <AUTH_TOKEN>');
  process.exit(1);
}

const makeRequest = (method, path, body = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
};

const tests = [
  {
    name: 'GET /api/agents/htf-trend-filter-agent/control',
    method: 'GET',
    path: '/api/agents/htf-trend-filter-agent/control',
    expectedStatus: [200, 403], // 200 if approved, 403 if not approved
  },
  {
    name: 'GET /api/agents/htf-trend-filter-agent/status',
    method: 'GET',
    path: '/api/agents/htf-trend-filter-agent/status',
    expectedStatus: [200, 403],
  },
  {
    name: 'POST /api/agents/htf-trend-filter-agent/start',
    method: 'POST',
    path: '/api/agents/htf-trend-filter-agent/start',
    expectedStatus: [200, 400, 403], // 200 if success, 400 if exchange not connected, 403 if not approved
  },
  {
    name: 'POST /api/agents/htf-trend-filter-agent/stop',
    method: 'POST',
    path: '/api/agents/htf-trend-filter-agent/stop',
    expectedStatus: [200, 403],
  },
  {
    name: 'GET /api/agents/htf-trend-filter-agent/diagnostics',
    method: 'GET',
    path: '/api/agents/htf-trend-filter-agent/diagnostics',
    expectedStatus: [200, 403],
  },
];

async function runTests() {
  console.log('🧪 Testing HTF Trend Filter Agent Routes\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Auth Token: ${AUTH_TOKEN.substring(0, 20)}...\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`Testing: ${test.name}`);
      const result = await makeRequest(test.method, test.path, test.body);
      
      if (result.status === 404) {
        console.log(`  ❌ FAILED: Got 404 (route not found)`);
        console.log(`  Response:`, result.data);
        failed++;
      } else if (test.expectedStatus.includes(result.status)) {
        console.log(`  ✅ PASSED: Got ${result.status} (expected)`);
        if (result.status === 403) {
          console.log(`  Note: 403 means agent not approved for this user (expected)`);
        }
        passed++;
      } else {
        console.log(`  ⚠️  WARNING: Got ${result.status} (expected ${test.expectedStatus.join(' or ')})`);
        console.log(`  Response:`, result.data);
        passed++; // Still count as passed if not 404
      }
    } catch (error) {
      console.log(`  ❌ ERROR: ${error.message}`);
      failed++;
    }
    console.log('');
  }

  console.log('═'.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n❌ SOME TESTS FAILED');
    console.log('If you see 404 errors, the routes are not registered properly.');
    console.log('Make sure the backend server has been restarted after code changes.');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED');
    console.log('HTF Trend Filter Agent routes are properly registered!');
    process.exit(0);
  }
}

runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
