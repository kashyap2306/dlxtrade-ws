// Direct test of HTF agent routes
const http = require('http');

async function testRoute(method, path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: path,
      method: method,
      headers: {
        'Authorization': token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('🧪 Testing HTF Agent Routes\n');
  
  // Test without auth (should get 401)
  console.log('1. Testing GET /api/agents/htf-trend-filter-agent/control (no auth)');
  const test1 = await testRoute('GET', '/api/agents/htf-trend-filter-agent/control');
  console.log(`   Status: ${test1.status}`);
  console.log(`   Body: ${test1.body}\n`);
  
  // Test with fake token (should get 401 or 403)
  console.log('2. Testing GET /api/agents/htf-trend-filter-agent/control (fake token)');
  const test2 = await testRoute('GET', '/api/agents/htf-trend-filter-agent/control', 'fake-token-123');
  console.log(`   Status: ${test2.status}`);
  console.log(`   Body: ${test2.body}\n`);
  
  // Test start route
  console.log('3. Testing POST /api/agents/htf-trend-filter-agent/start (no auth)');
  const test3 = await testRoute('POST', '/api/agents/htf-trend-filter-agent/start');
  console.log(`   Status: ${test3.status}`);
  console.log(`   Body: ${test3.body}\n`);
  
  // Test a working route for comparison
  console.log('4. Testing GET /api/agents (no auth) - for comparison');
  const test4 = await testRoute('GET', '/api/agents');
  console.log(`   Status: ${test4.status}`);
  console.log(`   Body: ${test4.body}\n`);
  
  console.log('✅ Test complete');
}

main().catch(console.error);
