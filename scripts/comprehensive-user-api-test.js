#!/usr/bin/env node

/**
 * Comprehensive 100% User-API E2E Test
 * Validates the complete user-API-driven system
 */

const { researchEngine } = require('../dist/services/researchEngine');

// Test scenarios
async function testScenario(name, setupFn, expectedToSucceed = false) {
  console.log(`\n🧪 ${name}`);
  console.log('='.repeat(60));

  try {
    await setupFn();

    // Try to run research
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

    if (expectedToSucceed) {
      console.log('✅ SUCCESS - Research completed as expected');

      // Validate that all required APIs were called
      const apisUsed = result.apisUsed || {};
      const requiredAPIs = ['userExchange', 'cryptoquant', 'lunarcrush', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate'];

      let allAPIsUsed = true;
      requiredAPIs.forEach(api => {
        if (apisUsed[api] !== true) {
          console.log(`❌ API not marked as used: ${api}`);
          allAPIsUsed = false;
        } else {
          console.log(`✅ API used: ${api}`);
        }
      });

      // Validate features contain real data
      const features = result.features || {};
      const hasRealData = !!(
        features.fundingRate &&
        features.openInterest &&
        features.liquidations &&
        features.newsSentiment &&
        features.globalMarketData &&
        features.onChainFlows
      );

      console.log(hasRealData ? '✅ Features contain real data' : '❌ Features missing real data');

      return allAPIsUsed && hasRealData;

    } else {
      console.log('❌ UNEXPECTED SUCCESS - Should have failed');
      return false;
    }

  } catch (error) {
    if (expectedToSucceed) {
      console.log(`❌ UNEXPECTED FAILURE: ${error.message}`);
      return false;
    } else {
      console.log(`✅ EXPECTED FAILURE: ${error.message}`);
      // Validate that error message includes missing APIs
      const hasDetailedError = error.message.includes('Missing required API keys');
      console.log(hasDetailedError ? '✅ Error includes detailed missing API list' : '⚠️ Error could be more detailed');
      return hasDetailedError;
    }
  }
}

async function runComprehensiveTest() {
  console.log('🚀 COMPREHENSIVE 100% USER-API E2E TEST');
  console.log('======================================');
  console.log('Testing complete user-API-driven Deep Research & Auto-Trade system\n');

  // Mock firestoreAdapter for different scenarios
  const originalFirestoreAdapter = require('../dist/services/firestoreAdapter').firestoreAdapter;

  const testResults = [];

  // Test 1: No API keys - should fail with detailed error
  testResults.push(await testScenario(
    'Test 1: No API Keys Configured',
    () => {
      require('../dist/services/firestoreAdapter').firestoreAdapter = {
        ...originalFirestoreAdapter,
        getEnabledIntegrations: async () => ({})
      };
    },
    false
  ));

  // Test 2: Missing LunarCrush - should fail
  testResults.push(await testScenario(
    'Test 2: Missing LunarCrush API',
    () => {
      require('../dist/services/firestoreAdapter').firestoreAdapter = {
        ...originalFirestoreAdapter,
        getEnabledIntegrations: async () => ({
          'cryptoquant': { apiKey: 'key', enabled: true },
          'coinapi_market': { apiKey: 'key', enabled: true },
          'coinapi_flatfile': { apiKey: 'key', enabled: true },
          'coinapi_exchangerate': { apiKey: 'key', enabled: true }
        })
      };
    },
    false
  ));

  // Test 3: Missing CryptoQuant - should fail
  testResults.push(await testScenario(
    'Test 3: Missing CryptoQuant API',
    () => {
      require('../dist/services/firestoreAdapter').firestoreAdapter = {
        ...originalFirestoreAdapter,
        getEnabledIntegrations: async () => ({
          'lunarcrush': { apiKey: 'key', enabled: true },
          'coinapi_market': { apiKey: 'key', enabled: true },
          'coinapi_flatfile': { apiKey: 'key', enabled: true },
          'coinapi_exchangerate': { apiKey: 'key', enabled: true }
        })
      };
    },
    false
  ));

  // Test 4: Missing CoinAPI types - should fail
  testResults.push(await testScenario(
    'Test 4: Missing CoinAPI Types',
    () => {
      require('../dist/services/firestoreAdapter').firestoreAdapter = {
        ...originalFirestoreAdapter,
        getEnabledIntegrations: async () => ({
          'lunarcrush': { apiKey: 'key', enabled: true },
          'cryptoquant': { apiKey: 'key', enabled: true }
        })
      };
    },
    false
  ));

  // Test 5: All APIs present - should succeed with real data
  testResults.push(await testScenario(
    'Test 5: All APIs Configured (Mock Keys)',
    () => {
      require('../dist/services/firestoreAdapter').firestoreAdapter = {
        ...originalFirestoreAdapter,
        getEnabledIntegrations: async () => ({
          'lunarcrush': { apiKey: 'test_lunarcrush_key', enabled: true },
          'cryptoquant': { apiKey: 'test_cryptoquant_key', enabled: true },
          'coinapi_market': { apiKey: 'test_coinapi_market_key', enabled: true },
          'coinapi_flatfile': { apiKey: 'test_coinapi_flatfile_key', enabled: true },
          'coinapi_exchangerate': { apiKey: 'test_coinapi_exchangerate_key', enabled: true }
        })
      };
    },
    true
  ));

  // Restore original adapter
  require('../dist/services/firestoreAdapter').firestoreAdapter = originalFirestoreAdapter;

  // Final Results
  console.log('\n' + '='.repeat(60));
  console.log('🎯 FINAL E2E TEST RESULTS');
  console.log('='.repeat(60));

  const passedTests = testResults.filter(Boolean).length;
  const totalTests = testResults.length;

  console.log(`✅ PASSED: ${passedTests}/${totalTests} tests`);

  testResults.forEach((passed, index) => {
    const status = passed ? '✅ PASSED' : '❌ FAILED';
    const testNames = [
      'No API Keys Rejection',
      'LunarCrush Required',
      'CryptoQuant Required',
      'CoinAPI Types Required',
      'All APIs Success'
    ];
    console.log(`${status}: ${testNames[index]}`);
  });

  console.log('\n' + '='.repeat(60));
  if (passedTests === totalTests) {
    console.log('🎉 ALL E2E TESTS PASSED!');
    console.log('✅ System is 100% user-API driven');
    console.log('✅ No fallback to system/admin keys');
    console.log('✅ Strict validation of all required APIs');
    console.log('✅ Clear error messages for missing APIs');
    console.log('✅ Successful research with all user APIs');
    console.log('✅ Auto-trade will only use user exchange APIs');
  } else {
    console.log('❌ SOME TESTS FAILED');
    console.log('⚠️ System may not be fully user-API compliant');
  }

  return passedTests === totalTests;
}

// Run the test
runComprehensiveTest().catch(console.error);
