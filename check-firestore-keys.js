// Check API keys in Firestore
const { firestoreAdapter } = require('./dist/services/firestoreAdapter');

async function checkAPIKeys() {
  const testUserId = 'QZKe6lcZ4dWv2kxg4rLL8razOQK2';

  console.log(`🔑 Checking API keys for user: ${testUserId}`);

  try {
    const userKeys = await firestoreAdapter.getUserProviderApiKeys(testUserId);
    console.log('Retrieved keys:', {
      marketAux: userKeys.marketaux ? 'PRESENT' : 'MISSING',
      cryptocompare: userKeys.cryptocompare ? 'PRESENT' : 'MISSING',
      marketAuxKey: userKeys.marketaux?.apiKey ? userKeys.marketaux.apiKey.substring(0, 10) + '...' : 'null',
      cryptocompareKey: userKeys.cryptocompare?.apiKey ? userKeys.cryptocompare.apiKey.substring(0, 10) + '...' : 'null'
    });

    // Also check all integrations
    const allIntegrations = await firestoreAdapter.getAllIntegrations(testUserId);
    console.log('All integrations:', Object.keys(allIntegrations));

    for (const [provider, integration] of Object.entries(allIntegrations)) {
      if (integration && integration.apiKey) {
        console.log(`${provider}: enabled=${integration.enabled}, hasKey=${!!integration.apiKey}`);
      }
    }

  } catch (error) {
    console.error('Error checking keys:', error);
  }
}

checkAPIKeys();
