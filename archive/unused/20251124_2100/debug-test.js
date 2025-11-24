#!/usr/bin/env node

const { researchEngine } = require('../dist/services/researchEngine');

async function debugTest() {
  console.log('🔍 Debug Test - Testing buildProviderAdapters\n');

  // Mock firestoreAdapter
  const mockFirestoreAdapter = {
    getEnabledIntegrations: async (uid) => {
      console.log(`📡 Mock getEnabledIntegrations called for uid: ${uid}`);
      return {}; // No API keys
    }
  };

  // Replace firestoreAdapter
  const original = require('../dist/services/firestoreAdapter').firestoreAdapter;
  require('../dist/services/firestoreAdapter').firestoreAdapter = mockFirestoreAdapter;

  try {
    // Call buildProviderAdapters directly
    console.log('🔧 Calling buildProviderAdapters...');
    await researchEngine.runResearch('BTCUSDT', 'test-user', undefined, false, undefined, '5m', {
      name: 'binance',
      adapter: {
        getExchangeName: () => 'binance',
        getKlines: async () => [],
        getOrderbook: async () => ({ bids: [], asks: [] })
      }
    });
    console.log('❌ Expected failure but got success');
  } catch (error) {
    console.log(`✅ Got expected error: ${error.message}`);
  } finally {
    // Restore
    require('../dist/services/firestoreAdapter').firestoreAdapter = original;
  }
}

debugTest().catch(console.error);
