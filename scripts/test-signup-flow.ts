/**
 * Test script to verify new user signup flow
 * This script simulates the signup process and verifies Firestore document creation
 * 
 * Usage: ts-node scripts/test-signup-flow.ts
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../src/utils/firebase';
import { ensureUser } from '../src/services/userOnboarding';
import { firestoreAdapter } from '../src/services/firestoreAdapter';
import { logger } from '../src/utils/logger';

const REQUIRED_FIELDS = [
  'uid',
  'email',
  'name',
  'phone',
  'role',
  'onboardingRequired',
  'autoTradeEnabled',
  'engineRunning',
  'hftRunning',
  'engineStatus',
  'preferences',
  'interestedAgents',
  'unlockedAgents',
  'tradingMarkets',
  'portfolioSize',
  'experienceLevel',
  'totalTrades',
  'dailyPnl',
  'weeklyPnl',
  'monthlyPnl',
  'totalPnl',
  'createdAt',
  'updatedAt',
  'lastLogin',
  'profilePicture',
];

async function testSignupFlow() {
  console.log('🧪 Starting signup flow test...\n');

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

    // Step 2: Verify document exists in Firestore
    console.log('🔍 Step 2: Verifying document exists in Firestore...');
    const db = admin.firestore();
    const userRef = db.collection('users').doc(testUid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new Error('❌ User document not found in Firestore');
    }

    console.log('✅ User document found in Firestore');
    console.log(`  Path: users/${testUid}\n`);

    // Step 3: Verify all required fields
    console.log('🔍 Step 3: Verifying all required fields...');
    const userData = userDoc.data() || {};
    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    for (const field of REQUIRED_FIELDS) {
      if (field === 'preferences') {
        if (!userData.preferences) {
          missingFields.push('preferences');
        } else if (
          !userData.preferences.analysisType ||
          !userData.preferences.riskLevel ||
          !userData.preferences.tradingStyle
        ) {
          invalidFields.push('preferences (missing sub-fields)');
        }
      } else if (userData[field] === undefined) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      console.error('❌ Missing required fields:', missingFields);
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    if (invalidFields.length > 0) {
      console.error('❌ Invalid fields:', invalidFields);
      throw new Error(`Invalid fields: ${invalidFields.join(', ')}`);
    }

    console.log('✅ All required fields present\n');

    // Step 4: Verify field values
    console.log('🔍 Step 4: Verifying field values...');
    const checks = [
      { field: 'uid', expected: testUid, actual: userData.uid },
      { field: 'email', expected: testEmail, actual: userData.email },
      { field: 'name', expected: testName, actual: userData.name },
      { field: 'role', expected: 'user', actual: userData.role },
      { field: 'onboardingRequired', expected: true, actual: userData.onboardingRequired },
      { field: 'autoTradeEnabled', expected: false, actual: userData.autoTradeEnabled },
      { field: 'engineRunning', expected: false, actual: userData.engineRunning },
      { field: 'hftRunning', expected: false, actual: userData.hftRunning },
      { field: 'engineStatus', expected: 'stopped', actual: userData.engineStatus },
      { field: 'portfolioSize', expected: 'small', actual: userData.portfolioSize },
      { field: 'experienceLevel', expected: 'beginner', actual: userData.experienceLevel },
    ];

    const failedChecks = checks.filter(
      check => check.actual !== check.expected
    );

    if (failedChecks.length > 0) {
      console.error('❌ Field value mismatches:');
      failedChecks.forEach(check => {
        console.error(`  ${check.field}: expected ${check.expected}, got ${check.actual}`);
      });
      throw new Error('Field value verification failed');
    }

    console.log('✅ All field values correct\n');

    // Step 5: Verify via firestoreAdapter.getUser()
    console.log('🔍 Step 5: Verifying via firestoreAdapter.getUser()...');
    const adapterUser = await firestoreAdapter.getUser(testUid);
    if (!adapterUser) {
      throw new Error('❌ firestoreAdapter.getUser() returned null');
    }
    console.log('✅ firestoreAdapter.getUser() returned user document\n');

    // Step 6: Verify timestamps
    console.log('🔍 Step 6: Verifying timestamps...');
    if (!userData.createdAt || !userData.updatedAt || !userData.lastLogin) {
      throw new Error('❌ Missing timestamp fields');
    }

    const createdAt = userData.createdAt.toDate();
    const now = new Date();
    const timeDiff = Math.abs(now.getTime() - createdAt.getTime());

    if (timeDiff > 10000) {
      throw new Error(`❌ createdAt is too old: ${timeDiff}ms difference`);
    }

    console.log('✅ Timestamps are valid\n');

    // Step 7: Verify preferences structure
    console.log('🔍 Step 7: Verifying preferences structure...');
    const prefs = userData.preferences;
    if (
      prefs.analysisType !== 'technical' ||
      prefs.riskLevel !== 'medium' ||
      prefs.tradingStyle !== 'swing'
    ) {
      throw new Error('❌ Preferences have incorrect default values');
    }
    console.log('✅ Preferences structure correct\n');

    // Summary
    console.log('📊 Test Summary:');
    console.log(`  ✅ Document created: Yes`);
    console.log(`  ✅ Path: users/${testUid}`);
    console.log(`  ✅ All fields present: Yes`);
    console.log(`  ✅ Field values correct: Yes`);
    console.log(`  ✅ Timestamps valid: Yes`);
    console.log(`  ✅ Duration: ${duration}ms`);
    console.log(`  ✅ Created within 5 seconds: ${duration < 5000 ? 'Yes' : 'No'}\n`);

    // Cleanup: Delete test document
    console.log('🧹 Cleaning up test document...');
    await userRef.delete();
    console.log('✅ Test document deleted\n');

    console.log('🎉 All tests passed! Signup flow is working correctly.\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run test
testSignupFlow();

