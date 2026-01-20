const axios = require('axios');

async function testRoute() {
  try {
    // Replace with your actual auth token
    const token = process.env.TEST_TOKEN || 'YOUR_TOKEN_HERE';
    
    const response = await axios.get('http://localhost:3000/api/agents/crowd-consensus/exchange-breakdown', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('✅ Route works!');
    console.log('Status:', response.status);
    console.log('Data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Route failed');
    console.log('Status:', error.response?.status);
    console.log('Error:', error.response?.data || error.message);
  }
}

testRoute();
