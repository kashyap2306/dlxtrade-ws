/**
 * Firestore User Migration Script
 * 
 * Scans users collection, creates missing documents with exact schema,
 * and removes demo/test placeholder documents.
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';

async function migrateFirestoreUsers() {
  try {
    logger.info('Starting Firestore user migration...');
    
    const db = getFirebaseAdmin().firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    logger.info({ count: usersSnapshot.size }, 'Found users to migrate');
    
    let fixedCount = 0;
    let errorCount = 0;
    let demoRemovedCount = 0;
    
    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      
      try {
        logger.info({ uid }, 'Processing user');
        
        // 1. Fix users/{uid}/profile (exact schema)
        const profileRef = db.collection('users').doc(uid).collection('profile').doc('current');
        const existingProfile = await profileRef.get();
        
        if (!existingProfile.exists) {
          await profileRef.set({
            uid,
            email: userData.email || '',
            displayName: userData.name || userData.displayName || '',
            createdAt: userData.createdAt || now,
            lastLogin: now,
            role: userData.role || 'user',
            active: true,
          });
          logger.info({ uid }, 'Created profile document');
        } else {
          const profileData = existingProfile.data() || {};
          const updates: any = {
            lastLogin: now,
          };
          
          if (!profileData.uid) updates.uid = uid;
          if (!profileData.email && userData.email) updates.email = userData.email;
          if (!profileData.displayName && (userData.name || userData.displayName)) {
            updates.displayName = userData.name || userData.displayName;
          }
          if (profileData.role === undefined) updates.role = userData.role || 'user';
          if (profileData.active === undefined) updates.active = true;
          if (profileData.createdAt === undefined) updates.createdAt = userData.createdAt || now;
          
          if (Object.keys(updates).length > 1) { // More than just lastLogin
            await profileRef.update(updates);
            logger.info({ uid }, 'Updated profile document');
          }
        }
        
        // 2. Ensure users/{uid}/settings (exact schema)
        const settingsRef = db.collection('users').doc(uid).collection('settings').doc('current');
        const existingSettings = await settingsRef.get();
        
        if (!existingSettings.exists) {
          await settingsRef.set({
            strategy: 'orderbook_imbalance',
            accuracyThreshold: 0.85,
            autoTrade: false,
            hftEnabled: false,
            liveMode: false,
            runIntervalSec: 5,
            risk: {
              max_loss_pct: 5,
              max_drawdown_pct: 10,
              per_trade_risk_pct: 0.5,
              max_pos: 0.02,
            },
            updatedAt: now,
            status: 'idle',
          });
          logger.info({ uid }, 'Created settings document');
        } else {
          const settingsData = existingSettings.data() || {};
          const updates: any = {};
          
          if (settingsData.strategy === undefined) updates.strategy = 'orderbook_imbalance';
          if (settingsData.accuracyThreshold === undefined) {
            updates.accuracyThreshold = settingsData.minAccuracyThreshold || 0.85;
          }
          if (settingsData.autoTrade === undefined) {
            updates.autoTrade = settingsData.autoTradeEnabled || false;
          }
          if (settingsData.hftEnabled === undefined) updates.hftEnabled = false;
          if (settingsData.liveMode === undefined) updates.liveMode = false;
          if (settingsData.runIntervalSec === undefined) updates.runIntervalSec = 5;
          if (!settingsData.risk) {
            updates.risk = {
              max_loss_pct: settingsData.max_loss_pct || 5,
              max_drawdown_pct: settingsData.max_drawdown_pct || 10,
              per_trade_risk_pct: settingsData.per_trade_risk_pct || 0.5,
              max_pos: settingsData.maxPos || 0.02,
            };
          }
          if (settingsData.status === undefined) {
            updates.status = settingsData.status || 'idle';
          }
          
          if (Object.keys(updates).length > 0) {
            updates.updatedAt = now;
            await settingsRef.update(updates);
            logger.info({ uid }, 'Updated settings document');
          }
        }
        
        // 3. Ensure users/{uid}/uiPreferences
        const uiPrefsRef = db.collection('users').doc(uid).collection('uiPreferences').doc('current');
        const existingUIPrefs = await uiPrefsRef.get();
        
        if (!existingUIPrefs.exists) {
          await uiPrefsRef.set({
            dismissedAgents: [],
            updatedAt: now,
          });
          logger.info({ uid }, 'Created UI preferences document');
        }
        
        // 4. Ensure all agents are initialized
        const agentsSnapshot = await db.collection('users').doc(uid).collection('agents').get();
        const agentNames = ['level_bot', 'hft_bot', 'accuracy_engine', 'research_agent'];
        
        for (const agentName of agentNames) {
          const agentRef = db.collection('users').doc(uid).collection('agents').doc(agentName);
          const existingAgent = await agentRef.get();
          
          if (!existingAgent.exists) {
            await agentRef.set({
              unlocked: false,
              unlockedAt: null,
            });
            logger.info({ uid, agentName }, 'Created agent document');
          }
        }
        
        // 5. Remove demo/test placeholder documents
        const email = userData.email || '';
        const isDemoUser = email.toLowerCase().includes('demo') || 
                          email.toLowerCase().includes('test') || 
                          email.toLowerCase().includes('example') ||
                          uid.includes('demo') ||
                          uid.includes('test') ||
                          email.toLowerCase().includes('placeholder');
        
        if (isDemoUser) {
          logger.warn({ uid, email }, 'Demo/test user detected - removing');
          try {
            // Delete user document and all subcollections
            const subcollections = ['profile', 'settings', 'integrations', 'agents', 'uiPreferences', 
                                   'researchLogs', 'executionLogs', 'hftExecutionLogs'];
            
            for (const subcol of subcollections) {
              const subcolRef = db.collection('users').doc(uid).collection(subcol);
              const subcolSnapshot = await subcolRef.get();
              const batch = db.batch();
              subcolSnapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
              });
              await batch.commit();
            }
            
            await db.collection('users').doc(uid).delete();
            demoRemovedCount++;
            logger.info({ uid }, 'Demo user removed');
          } catch (err: any) {
            logger.error({ uid, error: err.message }, 'Error removing demo user');
          }
          continue; // Skip to next user
        }
        
        fixedCount++;
        logger.info({ uid }, '✅ User migration completed');
        
      } catch (error: any) {
        errorCount++;
        logger.error({ uid, error: error.message }, 'Error migrating user');
      }
    }
    
    const summary = {
      total: usersSnapshot.size,
      fixed: fixedCount,
      errors: errorCount,
      demoRemoved: demoRemovedCount,
    };
    
    logger.info(summary, 'Firestore user migration completed');
    
    return {
      success: true,
      ...summary,
    };
    
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Fatal error in migration script');
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  (async () => {
    try {
      // Initialize Firebase Admin
      const { getFirebaseAdmin } = await import('../utils/firebase');
      getFirebaseAdmin();
      
      const result = await migrateFirestoreUsers();
      console.log('Migration result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  })();
}

export { migrateFirestoreUsers };

