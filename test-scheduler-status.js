/**
 * Test script to verify trading agent scheduler status
 */

const admin = require('firebase-admin');
const serviceAccount = require('./dlxtrade-ws/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function testSchedulerStatus() {
  console.log('=== TRADING AGENT SCHEDULER DIAGNOSTIC ===\n');

  // 1. Check Firestore for active agents
  console.log('1. Checking Firestore for ACTIVE trading agents...');
  const agentsSnapshot = await db
    .collection('tradingAgents')
    .where('status', '==', 'ACTIVE')
    .get();

  console.log(`   Found ${agentsSnapshot.size} ACTIVE agents\n`);

  agentsSnapshot.forEach(doc => {
    const data = doc.data();
    console.log(`   Agent ID: ${doc.id}`);
    console.log(`   Name: ${data.name}`);
    console.log(`   Strategy Type: ${data.strategyType}`);
    console.log(`   Status: ${data.status}`);
    console.log(`   Trading Pair: ${data.tradingPair}`);
    console.log(`   User ID: ${data.userId}`);
    console.log('');
  });

  // 2. Check for HTF agents specifically
  console.log('2. Checking for HTF Trend Filter agents...');
  const htfAgents = [];
  agentsSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.strategyType === 'HTF_TREND_FILTER' || 
        (data.name && data.name.includes('HTF Trend Filter'))) {
      htfAgents.push({ id: doc.id, ...data });
    }
  });

  console.log(`   Found ${htfAgents.length} HTF agents\n`);

  // 3. Check for recent diagnostics
  if (htfAgents.length > 0) {
    console.log('3. Checking for recent diagnostics...');
    for (const agent of htfAgents) {
      // Use user-scoped path: users/{uid}/agentDiagnostics/{agentId}/entries
      const diagnosticsSnapshot = await db
        .collection('users')
        .doc(agent.userId)
        .collection('agentDiagnostics')
        .doc(agent.id)
        .collection('entries')
        .orderBy('timestamp', 'desc')
        .limit(5)
        .get();

      console.log(`   Agent ${agent.id} (${agent.name}):`);
      console.log(`   User ID: ${agent.userId}`);
      console.log(`   Total diagnostics: ${diagnosticsSnapshot.size}`);
      
      if (diagnosticsSnapshot.size > 0) {
        const latest = diagnosticsSnapshot.docs[0].data();
        console.log(`   Latest diagnostic: ${latest.timestamp?.toDate()}`);
        console.log(`   Decision: ${latest.decision?.action} - ${latest.decision?.reason}`);
      } else {
        console.log(`   ⚠️  NO DIAGNOSTICS FOUND - Agent never executed!`);
      }
      console.log('');
    }
  }

  // 4. Check scheduler endpoint
  console.log('4. Recommendation:');
  console.log('   If no diagnostics found, the scheduler may not be calling executeAllAgents()');
  console.log('   Check server logs for:');
  console.log('   - "Trading agent scheduler started"');
  console.log('   - "Executing all active trading agents"');
  console.log('   - "🎯 Executing HTF Trend Filter Agent"');
  console.log('');

  process.exit(0);
}

testSchedulerStatus().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
