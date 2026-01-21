/**
 * Check if HTF agent has exchange config in Firestore
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

async function checkHTFAgentExchange() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 HTF AGENT EXCHANGE CONFIG CHECK');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { getFirebaseAdmin } = require('./dist/utils/firebase');
  const admin = getFirebaseAdmin();
  const db = admin.firestore();

  // Find HTF agents
  console.log('STEP 1: Finding HTF Trend Filter agents...');
  console.log('─────────────────────────────────────────────────────────────\n');

  // Get all users and check their trading agents
  const usersSnapshot = await db.collection('users').limit(50).get();
  const htfAgents = [];

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    if (uid.startsWith('system-') || uid.length < 10) continue;

    const agentsSnapshot = await db
      .collection('users')
      .doc(uid)
      .collection('tradingAgents')
      .where('strategyType', '==', 'HTF_TREND_FILTER')
      .get();

    for (const agentDoc of agentsSnapshot.docs) {
      htfAgents.push({ doc: agentDoc, userId: uid });
    }
  }

  if (htfAgents.length === 0) {
    console.log('⚠️  No HTF Trend Filter agents found');
    console.log('   Create an HTF agent in the UI first');
    process.exit(0);
  }

  console.log(`✅ Found ${htfAgents.length} HTF agent(s)\n`);

  for (const { doc: agentDoc, userId } of htfAgents) {
    const agentData = agentDoc.data();
    const agentId = agentDoc.id;

    console.log(`\nAgent: ${agentData.name || agentId}`);
    console.log(`  ID: ${agentId}`);
    console.log(`  User ID: ${userId}`);
    console.log(`  Status: ${agentData.status}`);
    console.log(`  Trading Pair: ${agentData.tradingPair}`);
    console.log(`  Exchange: ${agentData.exchange}`);

    // Check if user has exchange config
    console.log(`\n  Checking exchange config for user ${userId}...`);

    const exchangeConfigDoc = await db
      .collection('users')
      .doc(userId)
      .collection('exchangeConfig')
      .doc('current')
      .get();

    if (!exchangeConfigDoc.exists) {
      console.log(`  ❌ NO EXCHANGE CONFIG FOUND`);
      console.log(`     Path: users/${userId}/exchangeConfig/current`);
      console.log(`     This is the root cause - agent cannot execute without exchange credentials`);
      console.log(`\n  SOLUTION:`);
      console.log(`     User must connect their exchange in Settings → Exchange`);
      continue;
    }

    const exchangeConfig = exchangeConfigDoc.data();
    console.log(`  ✅ Exchange config exists`);
    console.log(`     Exchange: ${exchangeConfig.exchange}`);
    console.log(`     Has apiKeyEncrypted: ${!!exchangeConfig.apiKeyEncrypted}`);
    console.log(`     Has secretEncrypted: ${!!exchangeConfig.secretEncrypted}`);
    console.log(`     Has secretKeyEncrypted: ${!!exchangeConfig.secretKeyEncrypted}`);
    console.log(`     Has passphraseEncrypted: ${!!exchangeConfig.passphraseEncrypted}`);
    console.log(`     Testnet: ${exchangeConfig.testnet}`);
    console.log(`     Disconnected: ${exchangeConfig.disconnected}`);

    // Try to decrypt
    console.log(`\n  Testing decryption...`);
    const { initializeEncryptionKey, decrypt } = require('./dist/services/keyManager');
    
    try {
      initializeEncryptionKey();
    } catch (e) {
      // Already initialized
    }

    const encryptedApiKey = exchangeConfig.apiKeyEncrypted;
    const encryptedSecret = exchangeConfig.secretEncrypted || exchangeConfig.secretKeyEncrypted;

    if (!encryptedApiKey || !encryptedSecret) {
      console.log(`  ❌ Missing encrypted credentials`);
      console.log(`     Has apiKeyEncrypted: ${!!encryptedApiKey}`);
      console.log(`     Has secretEncrypted: ${!!encryptedSecret}`);
      continue;
    }

    try {
      const apiKey = decrypt(encryptedApiKey, 'background_job');
      const secret = decrypt(encryptedSecret, 'background_job');

      if (!apiKey || !secret) {
        console.log(`  ❌ Decryption returned null`);
        console.log(`     API key decrypted: ${!!apiKey}`);
        console.log(`     Secret decrypted: ${!!secret}`);
        console.log(`\n     ROOT CAUSE: Encryption key mismatch`);
        console.log(`     The credentials were encrypted with a different ENCRYPTION_SECRET`);
        console.log(`\n     SOLUTION:`);
        console.log(`     User must reconnect their exchange in Settings → Exchange`);
      } else {
        console.log(`  ✅ Decryption successful`);
        console.log(`     API key length: ${apiKey.length}`);
        console.log(`     Secret length: ${secret.length}`);
        console.log(`\n  ✅ HTF agent should be able to execute successfully`);
      }
    } catch (error) {
      console.log(`  ❌ Decryption failed with error`);
      console.log(`     Error: ${error.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

checkHTFAgentExchange().catch(error => {
  console.error('\n❌ CHECK FAILED');
  console.error(`   Error: ${error.message}`);
  console.error(`   Stack: ${error.stack}`);
  process.exit(1);
});
