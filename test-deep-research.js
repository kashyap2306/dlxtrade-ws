/**
 * Test script for Deep Research API
 * Tests: POST /api/research/run with { "symbol": "BTCUSDT", "forceEngine": true }
 */

const axios = require('axios');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:4000';
const TEST_TOKEN = process.env.TEST_TOKEN || ''; // You'll need to provide a valid token

async function testDeepResearch() {
  console.log('🔍 Testing Deep Research API...\n');
  console.log('API URL:', API_URL);
  console.log('Endpoint: POST /api/research/run\n');

  try {
    const response = await axios.post(
      `${API_URL}/api/research/run`,
      {
        symbol: 'BTCUSDT',
        forceEngine: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TEST_TOKEN}`,
        },
        timeout: 60000, // 60 seconds timeout
      }
    );

    console.log('✅ Response Status:', response.status);
    console.log('✅ Response Headers:', JSON.stringify(response.headers, null, 2));
    console.log('\n📊 Response Data:\n');
    console.log(JSON.stringify(response.data, null, 2));

    // Verify required fields
    if (response.data && response.data.success) {
      const results = response.data.results || [];
      if (results.length > 0) {
        const firstResult = results[0];
        console.log('\n✅ Verification:\n');
        
        const requiredFields = [
          'symbol',
          'currentPrice',
          'accuracy',
          'mode',
          'entry',
          'stopLoss',
          'takeProfit',
          'exits',
          'signals',
          'recommendedTrade',
          'apiCalls',
          'liveAnalysis',
        ];

        const missingFields = requiredFields.filter(field => !(field in firstResult));
        
        if (missingFields.length === 0) {
          console.log('✅ All required fields present!');
          console.log(`✅ Symbol: ${firstResult.symbol}`);
          console.log(`✅ Current Price: ${firstResult.currentPrice}`);
          console.log(`✅ Accuracy: ${(firstResult.accuracy * 100).toFixed(1)}%`);
          console.log(`✅ Mode: ${firstResult.mode}`);
          console.log(`✅ Recommended Trade: ${firstResult.recommendedTrade || 'null'}`);
          console.log(`✅ API Calls Count: ${firstResult.apiCalls?.length || 0}`);
          console.log(`✅ Signals Count: ${firstResult.signals?.length || 0}`);
          console.log(`✅ Entry: ${firstResult.entry || 'null'}`);
          console.log(`✅ Stop Loss: ${firstResult.stopLoss || 'null'}`);
          console.log(`✅ Take Profit: ${firstResult.takeProfit || 'null'}`);
          console.log(`✅ Exits: ${firstResult.exits?.length || 0} levels`);
          
          if (firstResult.apiCalls && firstResult.apiCalls.length > 0) {
            console.log('\n📡 APIs Called:');
            firstResult.apiCalls.forEach((call, idx) => {
              console.log(`  ${idx + 1}. ${call}`);
            });
          }
        } else {
          console.log('❌ Missing required fields:', missingFields);
        }
      } else {
        console.log('❌ No results in response');
      }
    } else {
      console.log('❌ Response not successful:', response.data);
    }
  } catch (error) {
    console.error('❌ Error testing Deep Research API:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received:', error.message);
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

// Run test
testDeepResearch().then(() => {
  console.log('\n✅ Test completed successfully!');
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});

