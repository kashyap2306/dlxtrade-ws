/**
 * End-to-End Test for Provider-Config and AutoTrade Diagnostics
 * Tests the complete flow after demo/test users removal
 */

import { getUserIntegrationsByUid } from '../routes/users/providerConfig';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';

async function testEndToEndFlow(uid: string) {
  console.log(`\n🧪 STARTING END-TO-END TEST for UID: ${uid}`);
  console.log('=' .repeat(60));

  try {
    // 1. Verify user exists and has integrations seeded
    console.log('\n📋 STEP 1: Verify user integrations are seeded');
    const integrations = await firestoreAdapter.getAllIntegrations(uid);
    const integrationCount = Object.keys(integrations).length;
    console.log(`✅ Found ${integrationCount} integrations for user`);

    if (integrationCount === 0) {
      throw new Error('No integrations found - seeding may have failed');
    }

    // 2. Verify provider config can be loaded
    console.log('\n📋 STEP 2: Test provider config loading');
    const providerConfig = await getUserIntegrationsByUid(uid);
    console.log('[AUTO_TRADE_DIAGNOSTIC_INPUT]', providerConfig);

    // 3. Check marketdata providers
    const marketDataReady = providerConfig.marketdata &&
      Object.values(providerConfig.marketdata).some((provider: any) => provider.enabled === true);
    console.log(`📊 Market Data Ready: ${marketDataReady}`);

    // 4. Check news providers
    const newsReady = providerConfig.news &&
      Object.values(providerConfig.news).some((provider: any) => provider.enabled === true);
    console.log(`📰 News Ready: ${newsReady}`);

    // 5. Calculate diagnostics result
    const providersReady = marketDataReady && newsReady;
    console.log(`🎯 AutoTrade Providers Ready: ${providersReady}`);

    // 6. Verify at least cryptocompare and newsdata exist (even if disabled)
    const hasCryptoCompare = providerConfig.marketdata?.cryptocompare;
    const hasNewsData = providerConfig.news?.newsdata;
    console.log(`🔍 Has CryptoCompare: ${!!hasCryptoCompare}`);
    console.log(`🔍 Has NewsData: ${!!hasNewsData}`);

    if (!hasCryptoCompare || !hasNewsData) {
      console.warn('⚠️  WARNING: Missing expected providers (cryptocompare/newsdata)');
    }

    // 7. Summary
    console.log('\n📊 TEST RESULTS:');
    console.log(`   UID: ${uid}`);
    console.log(`   Integrations: ${integrationCount}`);
    console.log(`   MarketData Ready: ${marketDataReady}`);
    console.log(`   News Ready: ${newsReady}`);
    console.log(`   AutoTrade Ready: ${providersReady}`);

    if (providersReady) {
      console.log('\n🎉 SUCCESS: AutoTrade diagnostics will PASS for this user');
    } else {
      console.log('\n⚠️  PARTIAL: AutoTrade diagnostics will FAIL - enable providers to fix');
    }

    return {
      success: true,
      uid,
      integrationCount,
      marketDataReady,
      newsReady,
      providersReady,
      hasCryptoCompare: !!hasCryptoCompare,
      hasNewsData: !!hasNewsData
    };

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack:', error.stack);

    return {
      success: false,
      uid,
      error: error.message
    };
  }
}

// CLI runner
async function main() {
  const uid = process.argv[2];

  if (!uid) {
    console.error('❌ Usage: npm run test:e2e <firebase-uid>');
    console.error('Example: npm run test:e2e AbCdEfGhIjKlMnOpQrStUvWxYz');
    process.exit(1);
  }

  if (uid.startsWith('demo_') || uid.startsWith('test_') || uid.includes('mock')) {
    console.error('❌ ERROR: Cannot test with demo/test/mock UIDs');
    console.error('Use a real Firebase authenticated user UID');
    process.exit(1);
  }

  // Verify Firebase is available
  try {
    getFirebaseAdmin();
  } catch (err) {
    console.error('❌ Firebase not initialized');
    process.exit(1);
  }

  const result = await testEndToEndFlow(uid);

  if (result.success) {
    console.log('\n✅ END-TO-END TEST COMPLETED SUCCESSFULLY');
    process.exit(0);
  } else {
    console.log('\n❌ END-TO-END TEST FAILED');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { testEndToEndFlow };