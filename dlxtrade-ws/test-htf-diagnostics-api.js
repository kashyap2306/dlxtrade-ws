/**
 * Test script to verify HTF diagnostics API returns data correctly
 */

const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Initialize Firebase Admin
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function testHTFDiagnosticsAPI() {
  console.log('\n=== HTF DIAGNOSTICS API TEST ===\n');

  try {
    // 1. Find users with HTF agents
    console.log('1. Finding users with HTF agents...');
    const agentsSnapshot = await db.collection('tradingAgents')
      .where('strategyType', '==', 'HTF_TREND_FILTER')
      .where('status', '==', 'ACTIVE')
      .get();

    if (agentsSnapshot.empty) {
      console.log('   ❌ No active HTF agents found');
      return;
    }

    console.log(`   ✅ Found ${agentsSnapshot.size} active HTF agents`);

    // 2. For each user, check diagnostics with FIXED agentId
    for (const agentDoc of agentsSnapshot.docs) {
      const agentData = agentDoc.data();
      const userId = agentData.userId;
      const agentId = agentDoc.id;

      console.log(`\n2. Testing user: ${userId}`);
      console.log(`   Agent ID: ${agentId}`);
      console.log(`   Agent Name: ${agentData.name}`);

      // Query diagnostics with FIXED agentId (as backend now does)
      const fixedAgentId = 'htf-trend-filter-agent';
      console.log(`\n   Querying diagnostics with FIXED agentId: ${fixedAgentId}`);
      
      const diagnosticsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('agentDiagnostics')
        .doc(fixedAgentId)
        .collection('entries')
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      console.log(`   ✅ Found ${diagnosticsSnapshot.size} diagnostics`);

      if (diagnosticsSnapshot.size > 0) {
        console.log('\n   Latest 3 diagnostics:');
        diagnosticsSnapshot.docs.slice(0, 3).forEach((doc, index) => {
          const data = doc.data();
          console.log(`\n   Diagnostic ${index + 1}:`);
          console.log(`   - ID: ${doc.id}`);
          console.log(`   - Timestamp: ${data.timestamp?.toDate?.() || 'N/A'}`);
          console.log(`   - Trading Pair: ${data.tradingPair || 'N/A'}`);
          console.log(`   - Decision: ${data.decision?.action || 'N/A'}`);
          console.log(`   - Cycle ID: ${data.runtimeState?.cycleId || 'N/A'}`);
          console.log(`   - Skip Reason: ${data.runtimeState?.skipReasonShort || 'N/A'}`);
        });
      }

      // Compare with OLD query (using individual agent ID)
      console.log(`\n   Comparing with OLD query (individual agentId: ${agentId})...`);
      const oldDiagnosticsSnapshot = await db
        .collection('users')
        .doc(userId)
        .collection('agentDiagnostics')
        .doc(agentId)
        .collection('entries')
        .orderBy('timestamp', 'desc')
        .limit(10)
        .get();

      console.log(`   OLD query found: ${oldDiagnosticsSnapshot.size} diagnostics`);

      if (diagnosticsSnapshot.size > 0 && oldDiagnosticsSnapshot.size === 0) {
        console.log('\n   ✅ FIX VERIFIED: New query returns data, old query returns empty');
      } else if (diagnosticsSnapshot.size === 0 && oldDiagnosticsSnapshot.size === 0) {
        console.log('\n   ⚠️  Both queries return empty - no diagnostics written yet');
      } else if (diagnosticsSnapshot.size === 0 && oldDiagnosticsSnapshot.size > 0) {
        console.log('\n   ❌ OLD query has data but new query is empty - FIX FAILED');
      }
    }

    console.log('\n=== TEST COMPLETE ===\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

testHTFDiagnosticsAPI();
