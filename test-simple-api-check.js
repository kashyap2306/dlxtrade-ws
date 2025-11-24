/**
 * Simple API Check
 * Check what API keys exist in the system
 */

const { firestoreAdapter } = require('./dist/services/firestoreAdapter');

async function simpleCheck() {
  console.log('🔍 SIMPLE API CHECK');

  try {
    // Try different user IDs
    const userIds = ['system', 'default', 'admin', 'test'];

    for (const uid of userIds) {
      try {
        console.log(`\nChecking user: ${uid}`);
        const keys = await firestoreAdapter.getUserProviderApiKeys(uid);

        const marketAux = keys.marketaux?.apiKey;
        const cryptoCompare = keys.cryptocompare?.apiKey;

        console.log(`  MarketAux: ${marketAux ? '✅ EXISTS' : '❌ MISSING'}`);
        console.log(`  CryptoCompare: ${cryptoCompare ? '✅ EXISTS' : '❌ MISSING'}`);

        if (marketAux && cryptoCompare) {
          console.log(`  🎯 FOUND KEYS FOR USER: ${uid}`);
          return { uid, marketAux: !!marketAux, cryptoCompare: !!cryptoCompare };
        }
      } catch (error) {
        console.log(`  Error checking ${uid}: ${error.message}`);
      }
    }

    console.log('\n❌ No user found with both required API keys');
    return { error: 'No keys found' };

  } catch (error) {
    console.error('❌ Check failed:', error.message);
    return { error: error.message };
  }
}

// Run
if (require.main === module) {
  simpleCheck().then(result => {
    console.log('\n📋 RESULT:', result);
  }).catch(console.error);
}

module.exports = { simpleCheck };
