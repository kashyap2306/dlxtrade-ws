/**
 * Test script to check if Trading Agent Scheduler is running
 * Run with: node test-scheduler-running.js
 */

// Load environment variables
require('dotenv').config();

// Import Firebase initialization from existing code
const { getFirebaseAdmin } = require('./dist/utils/firebase');

// Initialize Firebase
const admin = getFirebaseAdmin();

async function checkSchedulerStatus() {
  try {
    console.log('🔍 Checking Trading Agent Scheduler Status...\n');

    // Check if HTF agent exists in Firestore
    const db = admin.firestore();
    const agentsSnapshot = await db.collection('tradingAgents')
      .where('status', '==', 'ACTIVE')
      .where('strategyType', '==', 'HTF_TREND_FILTER')
      .get();

    console.log(`📊 Found ${agentsSnapshot.size} ACTIVE HTF agents in Firestore`);

    if (agentsSnapshot.empty) {
      console.log('❌ No ACTIVE HTF agents found');
      process.exit(1);
    }

    for (const doc of agentsSnapshot.docs) {
      const agent = doc.data();
      console.log(`\n✅ HTF Agent Found:`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Name: ${agent.name}`);
      console.log(`   Status: ${agent.status}`);
      console.log(`   Strategy Type: ${agent.strategyType}`);
      console.log(`   Trading Pair: ${agent.tradingPair}`);

      // Check for recent diagnostics
      const diagnosticsSnapshot = await db
        .collection('users')
        .doc(agent.userId)
        .collection('agentDiagnostics')
        .doc(doc.id)
        .collection('entries')
        .orderBy('timestamp', 'desc')
        .limit(5)
        .get();

      console.log(`\n📝 Recent Diagnostics (last 5):`);
      if (diagnosticsSnapshot.empty) {
        console.log('   ❌ NO DIAGNOSTICS FOUND - Scheduler NOT executing!');
      } else {
        diagnosticsSnapshot.docs.forEach((diagDoc, index) => {
          const diag = diagDoc.data();
          const timestamp = diag.timestamp?.toDate?.() || new Date(diag.timestamp);
          const minutesAgo = Math.floor((Date.now() - timestamp.getTime()) / 60000);
          console.log(`   ${index + 1}. ${timestamp.toISOString()} (${minutesAgo} min ago)`);
          console.log(`      Decision: ${diag.decision?.action} - ${diag.decision?.reason}`);
        });

        // Check if most recent diagnostic is within last 10 minutes
        const mostRecent = diagnosticsSnapshot.docs[0].data();
        const mostRecentTime = mostRecent.timestamp?.toDate?.() || new Date(mostRecent.timestamp);
        const minutesSinceLastExecution = Math.floor((Date.now() - mostRecentTime.getTime()) / 60000);

        console.log(`\n⏱️  Last execution: ${minutesSinceLastExecution} minutes ago`);
        
        if (minutesSinceLastExecution > 10) {
          console.log('   ⚠️  WARNING: Last execution was more than 10 minutes ago!');
          console.log('   ⚠️  Scheduler may not be running or may have stopped');
        } else {
          console.log('   ✅ Scheduler appears to be running (recent execution found)');
        }
      }
    }

    console.log('\n✅ Check complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking scheduler status:', error);
    process.exit(1);
  }
}

checkSchedulerStatus();
