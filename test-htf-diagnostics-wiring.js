/**
 * HTF Agent Diagnostics Data Wiring Test
 * 
 * This script diagnoses why HTF agent diagnostics aren't showing in the UI.
 * It checks:
 * 1. Does the HTF agent document exist in Firestore?
 * 2. What is the agent's status?
 * 3. Are diagnostics being written to the correct collection?
 * 4. Does the agentId match between write and read operations?
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, 'dlxtrade-ws', 'serviceAccountKey.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function diagnoseHTFDiagnostics() {
  console.log('\n=== HTF AGENT DIAGNOSTICS WIRING DIAGNOSIS ===\n');

  try {
    // Step 1: Find all HTF agents in the system
    console.log('Step 1: Searching for HTF Trend Filter agents...');
    const agentsSnapshot = await db.collection('tradingAgents')
      .where('name', '>=', 'HTF')
      .where('name', '<=', 'HTF\uf8ff')
      .get();

    if (agentsSnapshot.empty) {
      console.log('❌ NO HTF agents found in tradingAgents collection');
      console.log('   This means the agent document was never created.');
      console.log('   The scheduler cannot execute an agent that doesn\'t exist.\n');
      
      // Check if there are ANY trading agents
      const allAgentsSnapshot = await db.collection('tradingAgents').limit(5).get();
      console.log(`   Found ${allAgentsSnapshot.size} total trading agents in the system.`);
      
      if (!allAgentsSnapshot.empty) {
        console.log('   Sample agent names:');
        allAgentsSnapshot.forEach(doc => {
          const data = doc.data();
          console.log(`   - ${data.name} (ID: ${doc.id}, Status: ${data.status})`);
        });
      }
      
      return;
    }

    console.log(`✓ Found ${agentsSnapshot.size} HTF agent(s)\n`);

    // Step 2: Check each HTF agent
    for (const agentDoc of agentsSnapshot.docs) {
      const agentId = agentDoc.id;
      const agentData = agentDoc.data();
      
      console.log(`\n--- HTF Agent: ${agentData.name} ---`);
      console.log(`Agent ID: ${agentId}`);
      console.log(`User ID: ${agentData.userId}`);
      console.log(`Status: ${agentData.status}`);
      console.log(`Trading Pair: ${agentData.tradingPair}`);
      console.log(`Created At: ${agentData.createdAt?.toDate()}`);
      
      // Check if agent is ACTIVE (required for scheduler execution)
      if (agentData.status !== 'ACTIVE') {
        console.log(`⚠️  Agent status is "${agentData.status}" - scheduler only executes ACTIVE agents`);
      } else {
        console.log(`✓ Agent is ACTIVE - scheduler should execute it`);
      }

      // Step 3: Check if diagnostics exist for this agent
      console.log(`\nStep 3: Checking diagnostics for agent ${agentId}...`);
      const diagnosticsRef = db
        .collection('users')
        .doc(agentData.userId)
        .collection('agentDiagnostics')
        .doc(agentId)
        .collection('entries');
      const diagnosticsSnapshot = await diagnosticsRef
        .orderBy('timestamp', 'desc')
        .limit(5)
        .get();

      if (diagnosticsSnapshot.empty) {
        console.log(`❌ NO diagnostics found for agent ${agentId}`);
        console.log(`   Path checked: users/${agentData.userId}/agentDiagnostics/${agentId}/entries`);
        console.log(`   This means either:`);
        console.log(`   1. The scheduler is not executing this agent`);
        console.log(`   2. The agent is executing but diagnostics are being written to a different agentId`);
        console.log(`   3. The storeDiagnostics() calls are failing silently`);
      } else {
        console.log(`✓ Found ${diagnosticsSnapshot.size} diagnostic entries`);
        console.log(`\nMost recent diagnostics:`);
        
        diagnosticsSnapshot.forEach((doc, index) => {
          const data = doc.data();
          const timestamp = data.timestamp?.toDate();
          const timeSince = timestamp ? Math.floor((Date.now() - timestamp.getTime()) / 1000 / 60) : '?';
          
          console.log(`\n  ${index + 1}. ${timestamp?.toISOString() || 'Unknown time'} (${timeSince} minutes ago)`);
          console.log(`     Decision: ${data.decision?.action} - ${data.decision?.reason}`);
          console.log(`     Agent Type: ${data.agentType}`);
          console.log(`     Trading Pair: ${data.tradingPair || 'N/A'}`);
        });
      }

      // Step 4: Check what the frontend would query
      console.log(`\n\nStep 4: Frontend Query Simulation`);
      console.log(`When frontend calls /api/agents/htf-trend-filter-agent/diagnostics:`);
      console.log(`1. Backend finds HTF agent for user ${agentData.userId}`);
      console.log(`2. Backend queries: users/${agentData.userId}/agentDiagnostics/${agentId}/entries`);
      console.log(`3. Returns diagnostics to frontend`);
      
      // Verify the route would find this agent
      const userAgentsSnapshot = await db.collection('tradingAgents')
        .where('userId', '==', agentData.userId)
        .get();
      
      const htfAgentForUser = userAgentsSnapshot.docs.find(doc => {
        const name = doc.data().name || '';
        return name.toLowerCase().includes('htf trend filter');
      });
      
      if (htfAgentForUser && htfAgentForUser.id === agentId) {
        console.log(`✓ Route would correctly find this agent (ID: ${agentId})`);
      } else if (htfAgentForUser) {
        console.log(`⚠️  Route would find a DIFFERENT agent (ID: ${htfAgentForUser.id})`);
        console.log(`   This is a MISMATCH - diagnostics are written to ${agentId} but queried from ${htfAgentForUser.id}`);
      } else {
        console.log(`❌ Route would NOT find any HTF agent for this user`);
      }
    }

    // Step 5: Check scheduler activity
    console.log(`\n\n=== SCHEDULER ACTIVITY CHECK ===`);
    console.log(`Checking if scheduler has executed recently...`);
    
    // Check recent diagnostics for all HTF agents found
    let totalHTFDiagnostics = 0;
    const recentExecutions = [];
    
    for (const agentDoc of agentsSnapshot.docs) {
      const agentData = agentDoc.data();
      const agentId = agentDoc.id;
      
      try {
        const userDiagnosticsSnapshot = await db
          .collection('users')
          .doc(agentData.userId)
          .collection('agentDiagnostics')
          .doc(agentId)
          .collection('entries')
          .where('agentType', '==', 'HTF_TREND_FILTER_AGENT')
          .orderBy('timestamp', 'desc')
          .limit(5)
          .get();
        
        totalHTFDiagnostics += userDiagnosticsSnapshot.size;
        
        userDiagnosticsSnapshot.forEach(doc => {
          const data = doc.data();
          recentExecutions.push({
            agentId: data.agentId,
            timestamp: data.timestamp?.toDate(),
            decision: data.decision
          });
        });
      } catch (error) {
        console.log(`   Warning: Could not check diagnostics for agent ${agentId}: ${error.message}`);
      }
    }
    
    if (totalHTFDiagnostics === 0) {
      console.log(`❌ NO HTF diagnostics found anywhere in the system`);
      console.log(`   This strongly suggests the scheduler is NOT executing HTF agents`);
    } else {
      console.log(`✓ Found ${totalHTFDiagnostics} HTF diagnostic entries across all agents`);
      console.log(`\nMost recent HTF executions:`);
      
      // Sort by timestamp and show most recent
      recentExecutions
        .sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0))
        .slice(0, 10)
        .forEach((execution, index) => {
          const timestamp = execution.timestamp;
          const timeSince = timestamp ? Math.floor((Date.now() - timestamp.getTime()) / 1000 / 60) : '?';
          
          console.log(`\n  ${index + 1}. Agent: ${execution.agentId}`);
          console.log(`     Time: ${timestamp?.toISOString() || 'Unknown'} (${timeSince} minutes ago)`);
          console.log(`     Decision: ${execution.decision?.action} - ${execution.decision?.reason}`);
        });
    }

    console.log('\n\n=== DIAGNOSIS COMPLETE ===\n');

  } catch (error) {
    console.error('Error during diagnosis:', error);
  } finally {
    process.exit(0);
  }
}

diagnoseHTFDiagnostics();
