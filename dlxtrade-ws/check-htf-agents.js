/**
 * Diagnostic script to check HTF agents in Firestore
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

async function checkHTFAgents() {
  console.log('\n=== HTF AGENT DIAGNOSTIC ===\n');

  try {
    // 1. Check all trading agents
    console.log('1. Checking all trading agents in tradingAgents collection...');
    const allAgentsSnapshot = await db.collection('tradingAgents').get();
    console.log(`   Total agents: ${allAgentsSnapshot.size}`);

    const htfAgents = [];
    const activeHTFAgents = [];
    const otherAgents = [];

    allAgentsSnapshot.forEach(doc => {
      const data = doc.data();
      const isHTF = data.strategyType === 'HTF_TREND_FILTER' || 
                    (data.name && data.name.includes('HTF Trend Filter'));
      
      if (isHTF) {
        htfAgents.push({ id: doc.id, ...data });
        if (data.status === 'ACTIVE') {
          activeHTFAgents.push({ id: doc.id, ...data });
        }
      } else {
        otherAgents.push({ id: doc.id, ...data });
      }
    });

    console.log(`   HTF agents: ${htfAgents.length}`);
    console.log(`   Active HTF agents: ${activeHTFAgents.length}`);
    console.log(`   Other agents: ${otherAgents.length}`);

    // 2. Display HTF agent details
    if (htfAgents.length > 0) {
      console.log('\n2. HTF Agent Details:');
      htfAgents.forEach((agent, index) => {
        console.log(`\n   Agent ${index + 1}:`);
        console.log(`   - ID: ${agent.id}`);
        console.log(`   - Name: ${agent.name}`);
        console.log(`   - Status: ${agent.status}`);
        console.log(`   - User ID: ${agent.userId}`);
        console.log(`   - Trading Pair: ${agent.tradingPair}`);
        console.log(`   - Strategy Type: ${agent.strategyType}`);
        console.log(`   - Created: ${agent.createdAt?.toDate?.() || 'N/A'}`);
        console.log(`   - Updated: ${agent.updatedAt?.toDate?.() || 'N/A'}`);
      });
    } else {
      console.log('\n2. No HTF agents found in tradingAgents collection');
    }

    // 3. Check for HTF diagnostics
    console.log('\n3. Checking HTF diagnostics...');
    const usersSnapshot = await db.collection('users').limit(10).get();
    
    let totalHTFDiagnostics = 0;
    const userDiagnostics = [];

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const htfDiagnosticsSnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('agentDiagnostics')
        .doc('htf-trend-filter-agent')
        .collection('entries')
        .orderBy('timestamp', 'desc')
        .limit(5)
        .get();

      if (htfDiagnosticsSnapshot.size > 0) {
        totalHTFDiagnostics += htfDiagnosticsSnapshot.size;
        userDiagnostics.push({
          uid,
          count: htfDiagnosticsSnapshot.size,
          latest: htfDiagnosticsSnapshot.docs[0].data()
        });
      }
    }

    console.log(`   Total HTF diagnostics found (sampled): ${totalHTFDiagnostics}`);
    
    if (userDiagnostics.length > 0) {
      console.log('\n   Users with HTF diagnostics:');
      userDiagnostics.forEach(({ uid, count, latest }) => {
        console.log(`   - User: ${uid}`);
        console.log(`     Count: ${count}`);
        console.log(`     Latest timestamp: ${latest.timestamp?.toDate?.() || 'N/A'}`);
        console.log(`     Latest decision: ${latest.decision?.action || 'N/A'}`);
        console.log(`     Latest cycleId: ${latest.runtimeState?.cycleId || 'N/A'}`);
      });
    } else {
      console.log('   No HTF diagnostics found');
    }

    // 4. Check scheduler status (if available)
    console.log('\n4. Recommendations:');
    if (htfAgents.length === 0) {
      console.log('   ❌ No HTF agents found. Create an HTF agent first.');
    } else if (activeHTFAgents.length === 0) {
      console.log('   ⚠️  HTF agents exist but none are ACTIVE. Set status to ACTIVE.');
    } else {
      console.log('   ✅ Active HTF agents found. Check server logs for execution.');
    }

    if (totalHTFDiagnostics === 0 && activeHTFAgents.length > 0) {
      console.log('   ⚠️  Active HTF agents exist but no diagnostics. Check:');
      console.log('      - Is the scheduler running?');
      console.log('      - Are there any errors in server logs?');
      console.log('      - Has 5 minutes passed since server start?');
    }

    console.log('\n=== END DIAGNOSTIC ===\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkHTFAgents();
