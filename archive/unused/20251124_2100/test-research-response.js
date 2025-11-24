// Test script to verify Deep Research response format
// Run: node test-research-response.js

// Note: This requires a valid Firebase token
// Get it from browser: localStorage.getItem('firebaseToken')

const token = process.argv[2] || 'YOUR_TOKEN_HERE';

if (token === 'YOUR_TOKEN_HERE') {
  console.log('❌ Please provide a Firebase token:');
  console.log('   node test-research-response.js YOUR_FIREBASE_TOKEN');
  console.log('\n   To get token:');
  console.log('   1. Open frontend app');
  console.log('   2. Login');
  console.log('   3. Browser console: localStorage.getItem("firebaseToken")');
  process.exit(1);
}

const fetch = require('node-fetch');

async function test() {
  console.log('🧪 Testing Deep Research API response format...\n');
  
  try {
    const response = await fetch('http://localhost:4000/api/research/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol: 'BTCUSDT' })
    });
    
    const data = await response.json();
    
    console.log('📦 Raw Response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n');
    
    console.log('✅ Validation:');
    console.log('   Status:', response.status);
    console.log('   Has "success" key?', 'success' in data);
    console.log('   Has "results" key?', 'results' in data);
    console.log('   Has "data" wrapper?', 'data' in data);
    console.log('   Has "result" wrapper?', 'result' in data);
    console.log('   Success value:', data.success);
    console.log('   Results is array?', Array.isArray(data.results));
    console.log('   Results length:', data.results?.length || 0);
    
    if (data.success && Array.isArray(data.results) && data.results.length > 0) {
      console.log('\n✅ CORRECT FORMAT!');
      console.log('   First result keys:', Object.keys(data.results[0]));
    } else {
      console.log('\n❌ INCORRECT FORMAT!');
      console.log('   Expected: { success: true, results: [...] }');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.message.includes('401')) {
      console.error('   Authentication failed - check your token');
    }
  }
}

test();

