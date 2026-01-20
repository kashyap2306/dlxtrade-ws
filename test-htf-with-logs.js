// Test HTF routes with detailed logging
const http = require('http');

function makeRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    console.log(`\n📤 ${method} ${path}`);
    if (token) console.log(`   Auth: Bearer ${token.substring(0, 20)}...`);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`📥 Status: ${res.statusCode}`);
        console.log(`   Body: ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`);
        resolve({
          status: res.statusCode,
          body: data,
          headers: res.headers
        });
      });
    });

    req.on('error', (err) => {
      console.log(`❌ Error: ${err.message}`);
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('🧪 HTF Agent Route Test with Detailed Logging\n');
  console.log('=' .repeat(60));

  // Test 1: Control endpoint (no auth)
  await makeRequest('GET', '/api/agents/htf-trend-filter-agent/control');

  // Test 2: Start endpoint (no auth)
  await makeRequest('POST', '/api/agents/htf-trend-filter-agent/start', null, {});

  // Test 3: Stop endpoint (no auth)
  await makeRequest('POST', '/api/agents/htf-trend-filter-agent/stop', null, {});

  // Test 4: Status endpoint (no auth)
  await makeRequest('GET', '/api/agents/htf-trend-filter-agent/status');

  // Test 5: Compare with working agent (vwap-strategy)
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON: Testing VWAP Strategy (known working agent)');
  console.log('='.repeat(60));
  await makeRequest('GET', '/api/agents/vwap-strategy/control');

  // Test 6: Compare with trading-agent
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON: Testing Trading Agent (RSI+BB)');
  console.log('='.repeat(60));
  await makeRequest('GET', '/api/agents/trading-agent/control');

  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests complete');
  console.log('='.repeat(60));
  console.log('\nEXPECTED RESULTS:');
  console.log('- All routes should return 401 (auth required)');
  console.log('- If HTF returns 404 but others return 401, route is not registered');
  console.log('- If all return 401, routes are working correctly');
}

main().catch(console.error);
