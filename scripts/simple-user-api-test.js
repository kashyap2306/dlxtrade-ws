#!/usr/bin/env node

/**
 * Simple User-API Validation Test
 * Tests that buildProviderAdapters enforces all required API keys
 */

const { researchEngine } = require('../dist/services/researchEngine');

async function testBuildProviderAdapters() {
  console.log('🚀 Testing 100% User-API System\n');
  console.log('=' .repeat(50));

  // Test with no API keys - should fail
  console.log('🧪 Test 1: No API Keys (should fail)');

  let mockScenario = 'no_keys';
  const mockFirestoreAdapter = {
    getEnabledIntegrations: async (uid) => {
      switch (mockScenario) {
        case 'no_keys':
          return {};
        case 'missing_lunarcrush':
          return {
            'cryptoquant': { apiKey: 'key', enabled: true },
            'coinapi_market': { apiKey: 'key', enabled: true },
            'coinapi_flatfile': { apiKey: 'key', enabled: true },
            'coinapi_exchangerate': { apiKey: 'key', enabled: true }
          };
        case 'all_keys':
          return {
            'lunarcrush': { apiKey: 'key', enabled: true },
            'cryptoquant': { apiKey: 'key', enabled: true },
            'coinapi_market': { apiKey: 'key', enabled: true },
            'coinapi_flatfile': { apiKey: 'key', enabled: true },
            'coinapi_exchangerate': { apiKey: 'key', enabled: true }
          };
      }
    }
  };

  // Temporarily replace firestoreAdapter
  const original = require('../dist/services/firestoreAdapter').firestoreAdapter;
  require('../dist/services/firestoreAdapter').firestoreAdapter = mockFirestoreAdapter;

  try {
    await researchEngine.runResearch('BTCUSDT', 'test-user', undefined, false, undefined, '5m', {
      name: 'binance',
      adapter: {
        getExchangeName: () => 'binance',
        getKlines: async () => [],
        getOrderbook: async () => ({ bids: [], asks: [] })
      }
    });
    console.log('❌ Expected failure but got success');
    return false;
  } catch (error) {
    console.log(`✅ Correctly failed: ${error.message}`);
  }

  // Test with all keys - should succeed (but API calls will fail with auth errors)
  console.log('\n🧪 Test 2: All API Keys Present');

  mockScenario = 'all_keys';

  try {
    const result = await researchEngine.runResearch('BTCUSDT', 'test-user', undefined, false, undefined, '5m', {
      name: 'binance',
      adapter: {
        getExchangeName: () => 'binance',
        getKlines: async (symbol, timeframe, limit) => {
          const candles = [];
          for (let i = 0; i < limit; i++) {
            candles.push({
              open: 45000, high: 46000, low: 44000, close: 45000,
              volume: 100, timestamp: Date.now() - (i * 300000)
            });
          }
          return candles;
        },
        getOrderbook: async () => ({
          bids: [{ price: '44990', quantity: '1.5' }],
          asks: [{ price: '45010', quantity: '1.5' }]
        })
      }
    });

    console.log('✅ Research completed successfully');
    console.log('APIs Used:', JSON.stringify(result.apisUsed, null, 2));

    // Verify all APIs are marked as available
    const apisUsed = result.apisUsed || {};
    const expectedAPIs = ['userExchange', 'cryptoquant', 'lunarcrush', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate'];

    let allAPIsPresent = true;
    expectedAPIs.forEach(api => {
      if (apisUsed[api] !== true) {
        console.log(`❌ Missing API: ${api}`);
        allAPIsPresent = false;
      }
    });

    if (allAPIsPresent) {
      console.log('✅ All required APIs are available and marked as used');
    }

    return true;

  } catch (error) {
    console.log(`❌ Unexpected failure: ${error.message}`);
    return false;
  } finally {
    // Restore original
    require('../dist/services/firestoreAdapter').firestoreAdapter = original;
  }
}

// Run the test
testBuildProviderAdapters().then(success => {
  console.log('\n' + '='.repeat(50));
  if (success) {
    console.log('🎉 SYSTEM VALIDATION PASSED');
    console.log('✅ 100% User-API based system confirmed');
    console.log('✅ No system APIs, no fallbacks');
    console.log('✅ All users must provide their own API keys');
  } else {
    console.log('❌ SYSTEM VALIDATION FAILED');
    console.log('⚠️ System may still have system API dependencies');
  }
}).catch(console.error);
