#!/usr/bin/env node

/**
 * ONE-TIME CLEANUP SCRIPT: Delete top-level agentDiagnostics collection
 * 
 * This script permanently removes all data from the top-level agentDiagnostics collection
 * as part of the security fix to prevent unauthorized access.
 * 
 * After this cleanup, ALL diagnostics will be stored under user-scoped paths:
 * users/{uid}/agentDiagnostics/{agentId}/entries/{entryId}
 * 
 * Usage: node cleanup-top-level-diagnostics.js
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin using environment variables
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  } catch (error) {
    console.log('⚠️  [INIT] Using default Firebase initialization...');
    admin.initializeApp();
  }
}

const db = admin.firestore();

async function cleanupTopLevelDiagnostics() {
  console.log('🚨 [FIRESTORE CLEANUP] Starting cleanup of top-level agentDiagnostics collection...');
  
  try {
    // Get all documents in the top-level agentDiagnostics collection
    const snapshot = await db.collection('agentDiagnostics').get();
    
    if (snapshot.empty) {
      console.log('✅ [CLEANUP] No documents found in top-level agentDiagnostics collection. Already clean.');
      return;
    }

    console.log(`📊 [CLEANUP] Found ${snapshot.size} documents in top-level agentDiagnostics collection`);
    
    // Delete in batches of 500 (Firestore limit)
    const batchSize = 500;
    let deletedCount = 0;
    
    while (true) {
      const batch = db.batch();
      const docs = await db.collection('agentDiagnostics').limit(batchSize).get();
      
      if (docs.empty) {
        break;
      }
      
      docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      deletedCount += docs.size;
      
      console.log(`🗑️  [CLEANUP] Deleted ${docs.size} documents (total: ${deletedCount})`);
      
      // Small delay to avoid overwhelming Firestore
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ [CLEANUP COMPLETE] Successfully deleted ${deletedCount} documents from top-level agentDiagnostics collection`);
    console.log('🔒 [SECURITY] Top-level agentDiagnostics collection is now empty and secured');
    console.log('📍 [INFO] All future diagnostics will be stored under user-scoped paths: users/{uid}/agentDiagnostics/{agentId}/entries/{entryId}');
    
  } catch (error) {
    console.error('❌ [CLEANUP ERROR]', error);
    process.exit(1);
  }
}

// Run cleanup
cleanupTopLevelDiagnostics()
  .then(() => {
    console.log('🎉 [SUCCESS] Cleanup completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 [FATAL ERROR]', error);
    process.exit(1);
  });