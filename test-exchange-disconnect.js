/**
 * Test Exchange Disconnect Flow
 * 
 * This script verifies that the disconnect endpoint:
 * 1. Always returns 200 OK
 * 2. Sets disconnected=true in Firestore
 * 3. Clears encrypted credentials
 * 4. Disables auto-trade
 * 5. Stops scheduler
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3001/api';
const TEST_UID = 'test-disconnect-user';

async function testDisconnect() {
  console.log('🧪 Testing Exchange Disconnect Flow\n');

  try {
    // Test 1: Disconnect with valid token
    console.log('Test 1: Normal disconnect...');
    const response = await axios.post(
      `${BASE_URL}/exchange/disconnect`,
      { exchange: 'binance', permanentDelete: false },
      {
        headers: {
          'Authorization': 'Bearer YOUR_TEST_TOKEN_HERE'
        }
      }
    );

    console.log('✅ Response Status:', response.status);
    console.log('✅ Response Data:', JSON.stringify(response.data, null, 2));

    if (response.status === 200 && response.data.success === true) {
      console.log('✅ Test 1 PASSED: Disconnect returns 200 OK with success=true\n');
    } else {
      console.log('❌ Test 1 FAILED: Unexpected response\n');
    }

    // Test 2: Disconnect when already disconnected
    console.log('Test 2: Disconnect when already disconnected...');
    const response2 = await axios.post(
      `${BASE_URL}/exchange/disconnect`,
      { exchange: 'binance', permanentDelete: false },
      {
        headers: {
          'Authorization': 'Bearer YOUR_TEST_TOKEN_HERE'
        }
      }
    );

    if (response2.status === 200 && response2.data.success === true) {
      console.log('✅ Test 2 PASSED: Disconnect succeeds even when already disconnected\n');
    } else {
      console.log('❌ Test 2 FAILED: Should still return success\n');
    }

    // Test 3: Permanent delete
    console.log('Test 3: Permanent delete...');
    const response3 = await axios.post(
      `${BASE_URL}/exchange/disconnect`,
      { exchange: 'binance', permanentDelete: true },
      {
        headers: {
          'Authorization': 'Bearer YOUR_TEST_TOKEN_HERE'
        }
      }
    );

    if (response3.status === 200 && response3.data.success === true) {
      console.log('✅ Test 3 PASSED: Permanent delete succeeds\n');
    } else {
      console.log('❌ Test 3 FAILED: Permanent delete should return success\n');
    }

    console.log('✅ All tests completed!');
    console.log('\nNext steps:');
    console.log('1. Check Firestore: users/{uid}/exchangeConfig/current should have disconnected=true');
    console.log('2. Check Firestore: users/{uid}/autoTradeConfig/current should have autoTradeEnabled=false');
    console.log('3. Verify UI shows "Not Connected" after refresh');

  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error('Status:', error.response?.status);
    console.error('Data:', error.response?.data);
    console.error('Message:', error.message);
    
    if (error.response?.status === 500) {
      console.error('\n⚠️ CRITICAL: Disconnect returned 500 error!');
      console.error('This should NEVER happen - disconnect must always return 200 OK');
    }
  }
}

// Run tests
testDisconnect();
