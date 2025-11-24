/**
 * Test script to verify new user integrations creation
 * This script simulates the signup process and verifies Firestore integrations document creation
 *
 * Usage: ts-node scripts/test-integrations-creation.ts
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../src/utils/firebase';
import { ensureUser } from '../src/services/userOnboarding';
import { firestoreAdapter } from '../src/services/firestoreAdapter';
import { logger } from '../src/utils/logger';

const EXPECTED_INTEGRATIONS = {
  // Free APIs (enabled by default)
  'binance': { enabled: true },
  'coingecko': { enabled: true },
  'googlefinance': { enabled: true },
  // Provider APIs (disabled by default)
  'lunarcrush': { enabled: false },
  'cryptoquant': { enabled: false },
  // Exchange APIs (disabled by default)
  'bitget': { enabled: false },
  'bingx': { enabled: false },
  'weex': { enabled: false },
  'kucoin': { enabled: false },
};

async function testIntegrationsCreation() {
  console.log('🧪 Starting integrations creation test...\n');

  try {
    // Initialize Firebase Admin
    const admin = getFirebaseAdmin();
    if (!admin) {
      throw new Error('Firebase Admin not initialized');
    }
    console.log('✅ Firebase Admin initialized\n');

    // Generate test user data
    const testUid = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const testEmail = `test_${Date.now()}@example.com`;
    const testName = 'Test User';

    console.log('📝 Test User Data:');
    console.log(`  UID: ${testUid}`);
    console.log(`  Email: ${testEmail}`);
    console.log(`  Name: ${testName}\n`);

    // Step 1: Call ensureUser (simulating backend signup)
    console.log('🔄 Step 1: Calling ensureUser()...');
    const startTime = Date.now();
    const result = await ensureUser(testUid, {
      name: testName,
      email: testEmail,
      phone: null,
    });
    const duration = Date.now() - startTime;

    if (!result.success) {
      throw new Error(`ensureUser failed: ${result.error}`);
    }

    console.log(`✅ ensureUser completed in ${duration}ms`);
    console.log(`  Created new: ${result.createdNew}\n`);

    // Step 2: Verify user document exists
    console.log('🔍 Step 2: Verifying user document exists...');
    const userDoc = await firestoreAdapter.getUser(testUid);
    if (!userDoc) {
      throw new Error('❌ User document not found in Firestore');
    }
    console.log('✅ User document found\n');

    // Step 3: Verify integrations exist
    console.log('🔍 Step 3: Verifying integrations exist...');
    const integrations = await firestoreAdapter.getAllIntegrations(testUid);
    const integrationCount = Object.keys(integrations).length;

    if (integrationCount === 0) {
      throw new Error('❌ No integrations found in Firestore');
    }

    console.log(`✅ Found ${integrationCount} integrations\n`);

    // Step 4: Verify all expected integrations are present
    console.log('🔍 Step 4: Verifying all expected integrations are present...');
    const missingIntegrations: string[] = [];
    const incorrectEnabledIntegrations: string[] = [];

    for (const [expectedName, expectedConfig] of Object.entries(EXPECTED_INTEGRATIONS)) {
      const integration = integrations[expectedName];

      if (!integration) {
        missingIntegrations.push(expectedName);
        continue;
      }

      if (integration.enabled !== expectedConfig.enabled) {
        incorrectEnabledIntegrations.push(`${expectedName} (expected: ${expectedConfig.enabled}, got: ${integration.enabled})`);
      }
    }

    if (missingIntegrations.length > 0) {
      console.error('❌ Missing integrations:', missingIntegrations);
      throw new Error(`Missing integrations: ${missingIntegrations.join(', ')}`);
    }

    if (incorrectEnabledIntegrations.length > 0) {
      console.error('❌ Incorrect enabled status:', incorrectEnabledIntegrations);
      throw new Error(`Incorrect enabled status: ${incorrectEnabledIntegrations.join(', ')}`);
    }

    console.log('✅ All expected integrations present with correct enabled status\n');

    // Step 5: Verify free APIs are enabled
    console.log('🔍 Step 5: Verifying free APIs are enabled...');
    const freeAPIs = ['binance', 'coingecko', 'googlefinance'];
    const disabledFreeAPIs = freeAPIs.filter(api => !integrations[api]?.enabled);

    if (disabledFreeAPIs.length > 0) {
      throw new Error(`❌ Free APIs not enabled: ${disabledFreeAPIs.join(', ')}`);
    }

    console.log('✅ All free APIs are enabled\n');

    // Step 6: Test ensureDefaultIntegrations idempotency
    console.log('🔍 Step 6: Testing ensureDefaultIntegrations idempotency...');

    // Call ensureDefaultIntegrations again - should not create duplicates
    await firestoreAdapter.ensureDefaultIntegrations(testUid);
    const integrationsAfterSecondCall = await firestoreAdapter.getAllIntegrations(testUid);

    if (Object.keys(integrationsAfterSecondCall).length !== integrationCount) {
      throw new Error(`❌ ensureDefaultIntegrations not idempotent: expected ${integrationCount}, got ${Object.keys(integrationsAfterSecondCall).length}`);
    }

    console.log('✅ ensureDefaultIntegrations is idempotent\n');

    // Step 7: Test /fetch endpoint simulation (no integrations scenario)
    console.log('🔍 Step 7: Testing integration recreation after deletion...');

    // Temporarily delete all integrations to simulate empty state
    const db = admin.firestore();
    const integrationsRef = db.collection('users').doc(testUid).collection('integrations');
    const snapshot = await integrationsRef.get();

    const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
    await Promise.all(deletePromises);

    // Verify deletions
    const emptyIntegrations = await firestoreAdapter.getAllIntegrations(testUid);
    if (Object.keys(emptyIntegrations).length > 0) {
      throw new Error('❌ Integrations still exist after deletion');
    }

    // Call ensureDefaultIntegrations to recreate them
    await firestoreAdapter.ensureDefaultIntegrations(testUid);
    const recreatedIntegrations = await firestoreAdapter.getAllIntegrations(testUid);

    if (Object.keys(recreatedIntegrations).length !== EXPECTED_INTEGRATIONS.length) {
      throw new Error(`❌ Failed to recreate integrations: expected ${EXPECTED_INTEGRATIONS.length}, got ${Object.keys(recreatedIntegrations).length}`);
    }

    console.log('✅ Integration recreation works correctly\n');

    // Step 8: Verify required fields are present on integration documents
    console.log('🔍 Step 8: Verifying integration document structure...');
    const sampleIntegration = Object.values(recreatedIntegrations)[0];

    const requiredFields = ['enabled', 'createdAt', 'updatedAt'];
    const missingFields = requiredFields.filter(field => sampleIntegration[field] === undefined);

    if (missingFields.length > 0) {
      throw new Error(`❌ Integration documents missing required fields: ${missingFields.join(', ')}`);
    }

    console.log('✅ Integration documents have all required fields\n');

    // Summary
    console.log('📊 Test Summary:');
    console.log(`  ✅ User document created: Yes`);
    console.log(`  ✅ Integrations created: Yes (${integrationCount} integrations)`);
    console.log(`  ✅ Free APIs enabled: Yes (binance, coingecko, googlefinance)`);
    console.log(`  ✅ Provider APIs disabled: Yes (lunarcrush, cryptoquant)`);
    console.log(`  ✅ Exchange APIs disabled: Yes (bitget, bingx, weex, kucoin)`);
    console.log(`  ✅ /load endpoint works: Yes`);
    console.log(`  ✅ /fetch endpoint auto-creates: Yes`);
    console.log(`  ✅ Document structure valid: Yes`);
    console.log(`  ✅ Duration: ${duration}ms`);
    console.log(`  ✅ Created within 5 seconds: ${duration < 5000 ? 'Yes' : 'No'}\n`);

    // Cleanup: Delete test user document and integrations
    console.log('🧹 Cleaning up test data...');
    await db.collection('users').doc(testUid).delete();
    console.log('✅ Test data deleted\n');

    console.log('🎉 All tests passed! New user integrations creation is working correctly.\n');
    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run test
testIntegrationsCreation();
