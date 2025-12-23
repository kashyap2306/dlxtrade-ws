#!/usr/bin/env node
/**
 * Manual Firestore seed script
 * Usage: npm run seed:firestore or node dist/scripts/seedFirestore.js
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { seedAll } from '../utils/firestoreSeed';

async function main() {
  try {
    console.log('🔥 Starting manual Firestore seed...');
    
    // Initialize Firebase Admin
    getFirebaseAdmin();
    
    // Run seed
    await seedAll();
    
    console.log('✅ Seed completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Seed failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

