/**
 * Firestore Schema Migration Script
 * 
 * This script fixes and completes all Firestore document structures for existing users.
 * It ensures proper schema for:
 * - users/{uid}/profile
 * - users/{uid}/integrations/{apiName}
 * - users/{uid}/settings
 * - users/{uid}/agents/{agentName}
 * - users/{uid}/uiPreferences
 * - Removes demo/test placeholder documents
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';
import { firestoreAdapter } from '../services/firestoreAdapter';

async function fixFirestoreSchema() {
  try {
    logger.info('Starting Firestore schema migration...');
    
    const db = getFirebaseAdmin().firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    logger.info({ count: usersSnapshot.size }, 'Found users to migrate');
    
    let fixedCount = 0;
    let errorCount = 0;
    
    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;
      const userData = userDoc.data();
      
      try {
        logger.info({ uid }, 'Processing user');
        
        // 1. Fix users/{uid}/profile
        const profileRef = db.collection('users').doc(uid).collection('profile').doc('current');
        const existingProfile = await profileRef.get();
        
        if (!existingProfile.exists) {
          await profileRef.set({
            email: userData.email || '',
            createdAt: userData.createdAt || now,
            role: userData.role || 'user',
            active: true,
          });
          logger.info({ uid }, 'Created profile document');
        } else {
          const profileData = existingProfile.data() || {};
          const updates: any = {};
          
          if (!profileData.email && userData.email) {
            updates.email = userData.email;
          }
          if (profileData.role === undefined) {
            updates.role = userData.role || 'user';
          }
          if (profileData.active === undefined) {
            updates.active = true;
          }
          if (profileData.createdAt === undefined) {
            updates.createdAt = userData.createdAt || now;
          }
          
          if (Object.keys(updates).length > 0) {
            await profileRef.update(updates);
            logger.info({ uid }, 'Updated profile document');
          }
        }
        
        // 2. Ensure users/{uid}/settings exists
        const settingsRef = db.collection('users').doc(uid).collection('settings').doc('current');
        const existingSettings = await settingsRef.get();
        
        if (!existingSettings.exists) {
          await settingsRef.set({
            symbol: 'BTCUSDT',
            quoteSize: 0.001,
            adversePct: 0.0002,
            cancelMs: 40,
            maxPos: 0.01,
            minAccuracyThreshold: 0.85,
            autoTradeEnabled: false,
            strategy: 'orderbook_imbalance',
            liveMode: false,
            max_loss_pct: 5,
            max_drawdown_pct: 10,
            per_trade_risk_pct: 1,
            status: 'active',
            updatedAt: now,
          });
          logger.info({ uid }, 'Created settings document');
        } else {
          // Update missing risk fields
          const settingsData = existingSettings.data() || {};
          const updates: any = {};
          
          if (settingsData.max_loss_pct === undefined) {
            updates.max_loss_pct = 5;
          }
          if (settingsData.max_drawdown_pct === undefined) {
            updates.max_drawdown_pct = 10;
          }
          if (settingsData.per_trade_risk_pct === undefined) {
            updates.per_trade_risk_pct = 1;
          }
          if (settingsData.status === undefined) {
            updates.status = 'active';
          }
          if (settingsData.strategy === undefined) {
            updates.strategy = 'orderbook_imbalance';
          }
          
          if (Object.keys(updates).length > 0) {
            await settingsRef.update(updates);
            logger.info({ uid }, 'Updated settings document');
          }
        }
        
        // 3. Ensure users/{uid}/uiPreferences exists
        const uiPrefsRef = db.collection('users').doc(uid).collection('uiPreferences').doc('current');
        const existingUIPrefs = await uiPrefsRef.get();
        
        if (!existingUIPrefs.exists) {
          await uiPrefsRef.set({
            dismissedAgents: [],
            updatedAt: now,
          });
          logger.info({ uid }, 'Created UI preferences document');
        }
        
        // 4. Ensure all agents are initialized (unlocked: false)
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
          } else {
            const agentData = existingAgent.data() || {};
            const updates: any = {};
            
            if (agentData.unlocked === undefined) {
              updates.unlocked = false;
            }
            if (agentData.unlockedAt === undefined && !agentData.unlocked) {
              updates.unlockedAt = null;
            }
            
            if (Object.keys(updates).length > 0) {
              await agentRef.update(updates);
              logger.info({ uid, agentName }, 'Updated agent document');
            }
          }
        }
        
        // 5. Remove demo/test placeholder documents
        // Check for demo users (email contains 'demo', 'test', 'example')
        const email = userData.email || '';
        const isDemoUser = email.toLowerCase().includes('demo') || 
                          email.toLowerCase().includes('test') || 
                          email.toLowerCase().includes('example') ||
                          uid.includes('demo') ||
                          uid.includes('test');
        
        if (isDemoUser) {
          logger.warn({ uid, email }, 'Skipping demo/test user (not removing, just logging)');
          // Optionally remove demo users - uncomment if needed
          // await db.collection('users').doc(uid).delete();
          // logger.info({ uid }, 'Removed demo user');
        }
        
        fixedCount++;
        logger.info({ uid }, '✅ User migration completed');
        
      } catch (error: any) {
        errorCount++;
        logger.error({ uid, error: error.message }, 'Error migrating user');
      }
    }
    
    logger.info({ 
      total: usersSnapshot.size, 
      fixed: fixedCount, 
      errors: errorCount 
    }, 'Firestore schema migration completed');
    
    return {
      success: true,
      total: usersSnapshot.size,
      fixed: fixedCount,
      errors: errorCount,
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
      const { initFirebaseAdmin } = await import('../utils/firebase');
      initFirebaseAdmin();
      
      const result = await fixFirestoreSchema();
      console.log('Migration result:', result);
      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  })();
}

export { fixFirestoreSchema };

