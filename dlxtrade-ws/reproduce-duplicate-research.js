// Reproduction script for duplicate background research execution
// Run this script to set up a test environment and observe the issue

const axios = require('axios');
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json'); // You'll need to provide this
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://your-project.firebaseio.com" // Replace with your project
});

const BASE_URL = 'http://localhost:3000'; // Adjust port as needed

async function setupTestUser() {
  const uid = 'test-user-duplicate-research';

  console.log('Setting up test user:', uid);

  try {
    // 1. Create/update auto-trade config
    await admin.firestore().collection('users').doc(uid).collection('autoTradeConfig').doc('current').set({
      autoTradeEnabled: true,
      researchFrequencyMinutes: 3, // 3 minutes as requested
      accuracyTrigger: { min: 75, max: 100 },
      coinSelectionMode: 'top10',
      selectedCoins: [],
      maxPositionPct: 10,
      maxDailyLossPct: 5,
      maxTradesPerDay: 10,
      tradeConfirmationRequired: false,
      tradeType: 'Scalping'
    });

    // 2. Create/update background research settings
    await admin.firestore().collection('users').doc(uid).collection('settings').doc('backgroundResearch').set({
      backgroundResearchEnabled: true,
      telegramBackgroundResearchEnabled: true,
      telegramBotToken: 'test-token', // Use test token
      telegramChatId: 'test-chat-id',
      researchFrequencyMinutes: 3,
      accuracyTrigger: { min: 75, max: 100 }
    });

    console.log('Test user configured with 3-minute frequency');

    // 3. Start background research engine via API
    const response = await axios.post(`${BASE_URL}/api/background-research/start`, {}, {
      headers: {
        'Authorization': `Bearer test-token`, // You'll need to implement proper auth
        'Content-Type': 'application/json'
      }
    });

    console.log('Background research started:', response.data);

  } catch (error) {
    console.error('Setup failed:', error.message);
  }
}

async function monitorLogs() {
  console.log('Monitoring logs for duplicate research cycles...');
  console.log('Expected: 1 research cycle every 3 minutes');
  console.log('Issue: 2 research cycles per minute observed');
  console.log('');
  console.log('Look for these log patterns:');
  console.log('- [SCHEDULER_IMMORTAL] User background research scheduled');
  console.log('- [RESEARCH_START] Starting background research');
  console.log('- [AUTO_TRADE_CYCLE] Cycle STARTED');
  console.log('- scheduler_${timestamp} cycle IDs');
}

// Run the reproduction
async function runReproduction() {
  await setupTestUser();
  await monitorLogs();

  console.log('');
  console.log('=== REPRODUCTION SETUP COMPLETE ===');
  console.log('1. Test user created with 3-minute frequency');
  console.log('2. Background research enabled');
  console.log('3. Monitor server logs for duplicate executions');
  console.log('4. Expected: ~20 research cycles per hour (1 every 3 minutes)');
  console.log('5. Issue: ~120 research cycles per hour (2 per minute)');
}

if (require.main === module) {
  runReproduction().catch(console.error);
}

module.exports = { setupTestUser, monitorLogs, runReproduction };
