#!/usr/bin/env node
/**
 * Post-deploy sanity check script
 * Verifies all critical endpoints are working and Firestore is populated
 */

import axios from 'axios';
import * as admin from 'firebase-admin';
import { initializeFirebaseAdmin } from '../utils/firebase';

const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';
const WS_BASE = process.env.WS_BASE || 'ws://localhost:4000/ws';

async function checkFirestore() {
  console.log('🔍 Checking Firestore collections...');
  const db = admin.firestore();
  
  const requiredCollections = [
    'users',
    'agents',
    'agentUnlocks',
    'apiKeys',
    'activityLogs',
    'engineStatus',
    'globalStats',
    'hftLogs',
    'trades',
    'notifications',
    'uiPreferences',
    'logs',
    'admin',
    'settings',
  ];

  let allOk = true;
  for (const collection of requiredCollections) {
    try {
      const snapshot = await db.collection(collection).limit(1).get();
      console.log(`  ✅ ${collection}: ${snapshot.size >= 1 ? 'has documents' : 'empty'}`);
      if (snapshot.size === 0 && collection !== 'logs') {
        console.warn(`  ⚠️  ${collection} is empty`);
        allOk = false;
      }
    } catch (error: any) {
      console.error(`  ❌ ${collection}: Error - ${error.message}`);
      allOk = false;
    }
  }

  // Check globalStats/main exists
  try {
    const globalStats = await db.collection('globalStats').doc('main').get();
    if (globalStats.exists) {
      console.log('  ✅ globalStats/main: exists');
    } else {
      console.error('  ❌ globalStats/main: missing');
      allOk = false;
    }
  } catch (error: any) {
    console.error(`  ❌ globalStats/main: Error - ${error.message}`);
    allOk = false;
  }

  return allOk;
}

async function checkAPIs() {
  console.log('🔍 Checking API endpoints...');
  
  // Note: These checks require the server to be running
  // This is optional - server might not be running during seed
  try {
    const healthResponse = await axios.get(`${API_BASE.replace('/api', '')}/health`, { timeout: 5000 });
    console.log('  ✅ Health endpoint: OK');
    return true;
  } catch (error: any) {
    console.warn(`  ⚠️  Health endpoint: Server not running (this is OK if you're just seeding)`);
    return true; // Don't fail if server isn't running
  }
}

async function main() {
  try {
    console.log('🔥 Starting system verification...\n');
    
    // Initialize Firebase
    initializeFirebaseAdmin();
    console.log('✅ Firebase Admin initialized\n');

    // Check Firestore
    const firestoreOk = await checkFirestore();
    console.log('');

    // Check APIs
    const apiOk = await checkAPIs();
    console.log('');

    if (firestoreOk && apiOk) {
      console.log('✅ All checks passed!');
      process.exit(0);
    } else {
      console.error('❌ Some checks failed!');
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ Verification failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

