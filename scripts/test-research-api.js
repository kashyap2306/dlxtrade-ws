// Test script for Deep Research API
// Run with: node test-research-api.js

const fetch = require('node-fetch'); // npm install node-fetch@2

const API_URL = 'http://localhost:4000/api/research/run';

// Option 1: Test without auth (will fail with 401)
async function testWithoutAuth() {
  console.log('🧪 Testing without authentication...');
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'BTCUSDT' })
    });
    
    const text = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', text);
    
    if (response.status === 401) {
      console.log('✅ Expected: 401 Unauthorized (authentication required)');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

// Option 2: Test with token (if you have one)
async function testWithAuth(token) {
  console.log('\n🧪 Testing with authentication...');
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ symbol: 'BTCUSDT' })
    });
    
    const data = await response.json();
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    
    if (data.success && data.results && data.results.length > 0) {
      console.log('✅ SUCCESS: Research completed!');
      console.log('   Symbol:', data.results[0].symbol);
      console.log('   Signal:', data.results[0].signal);
      console.log('   Accuracy:', data.results[0].accuracy);
    } else {
      console.log('⚠️  Response received but no results');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

// Main
async function main() {
  console.log('🔍 Deep Research API Test\n');
  console.log('Make sure backend is running on http://localhost:4000\n');
  
  // Test without auth first
  await testWithoutAuth();
  
  // If you have a token, uncomment and add it:
  // const token = 'YOUR_FIREBASE_TOKEN_HERE';
  // await testWithAuth(token);
  
  console.log('\n💡 To get a token:');
  console.log('   1. Open frontend app (http://localhost:5173)');
  console.log('   2. Login');
  console.log('   3. Open browser console');
  console.log('   4. Run: localStorage.getItem("firebaseToken")');
  console.log('   5. Copy the token and use it in testWithAuth()');
}

main();

