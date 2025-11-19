import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from './firebase';
import { logger } from './logger';

/**
 * Auto-migration routine to patch missing fields with default values
 * Runs on server start to ensure all documents match PART A schema
 */
export async function migrateFirestoreDocuments(): Promise<void> {
  try {
    console.log('🔄 Starting Firestore auto-migration...');
    const db = getFirebaseAdmin().firestore();
    
    let migrationCount = 0;

    // Migrate users collection
    const usersSnapshot = await db.collection('users').get();
    for (const doc of usersSnapshot.docs) {
      const data = doc.data();
      const updates: any = {};
      
      if (data.totalPnl === undefined) updates.totalPnl = 0;
      if (data.dailyPnl === undefined) updates.dailyPnl = 0;
      if (data.weeklyPnl === undefined) updates.weeklyPnl = 0;
      if (data.monthlyPnl === undefined) updates.monthlyPnl = 0;
      if (data.totalTrades === undefined) updates.totalTrades = 0;
      if (data.engineRunning === undefined) updates.engineRunning = false;
      if (data.hftRunning === undefined) updates.hftRunning = false;
      if (data.apiConnected === undefined) updates.apiConnected = false;
      if (data.unlockedAgents === undefined) updates.unlockedAgents = [];
      if (data.role === undefined) updates.role = 'user';
      if (data.lastLogin === undefined) updates.lastLogin = admin.firestore.Timestamp.now();
      
      if (Object.keys(updates).length > 0) {
        await doc.ref.update(updates);
        migrationCount++;
      }
    }

    // Migrate engineStatus collection
    const engineStatusSnapshot = await db.collection('engineStatus').get();
    for (const doc of engineStatusSnapshot.docs) {
      const data = doc.data();
      const updates: any = {};
      
      if (data.engineRunning === undefined) updates.engineRunning = false;
      if (data.ordersExecuted === undefined) updates.ordersExecuted = 0;
      if (data.totalPnl === undefined) updates.totalPnl = 0;
      
      if (Object.keys(updates).length > 0) {
        await doc.ref.update(updates);
        migrationCount++;
      }
    }

    // Migrate globalStats collection (ensure 'main' doc exists)
    const globalStatsRef = db.collection('globalStats').doc('main');
    const globalStatsDoc = await globalStatsRef.get();
    
    if (!globalStatsDoc.exists) {
      // Count actual values
      const usersCount = (await db.collection('users').get()).size;
      const tradesCount = (await db.collection('trades').get()).size;
      const unlocksCount = (await db.collection('agentUnlocks').get()).size;
      const runningEngines = (await db.collection('engineStatus').where('engineRunning', '==', true).get()).size;
      const runningHFT = (await db.collection('users').where('hftRunning', '==', true).get()).size;
      
      let totalPnl = 0;
      const usersSnapshot = await db.collection('users').get();
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        totalPnl += data.totalPnl || 0;
      });
      
      await globalStatsRef.set({
        totalUsers: usersCount,
        totalTrades: tradesCount,
        totalAgentsUnlocked: unlocksCount,
        runningEngines,
        runningHFT,
        totalPnl,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      migrationCount++;
    } else {
      const data = globalStatsDoc.data();
      const updates: any = {};
      
      if (data.totalAgentsUnlocked === undefined) {
        const unlocksCount = (await db.collection('agentUnlocks').get()).size;
        updates.totalAgentsUnlocked = unlocksCount;
      }
      if (data.runningEngines === undefined) {
        const runningEngines = (await db.collection('engineStatus').where('engineRunning', '==', true).get()).size;
        updates.runningEngines = runningEngines;
      }
      if (data.runningHFT === undefined) {
        const runningHFT = (await db.collection('users').where('hftRunning', '==', true).get()).size;
        updates.runningHFT = runningHFT;
      }
      if (data.totalPnl === undefined) {
        let totalPnl = 0;
        const usersSnapshot = await db.collection('users').get();
        usersSnapshot.forEach(doc => {
          const data = doc.data();
          totalPnl += data.totalPnl || 0;
        });
        updates.totalPnl = totalPnl;
      }
      
      if (Object.keys(updates).length > 0) {
        await globalStatsRef.update(updates);
        migrationCount++;
      }
    }

    if (migrationCount > 0) {
      console.log(`✅ Migration completed: ${migrationCount} documents updated`);
      logger.info({ count: migrationCount }, 'Firestore migration completed');
    } else {
      console.log('✅ Migration completed: No updates needed');
    }
  } catch (error: any) {
    console.error('❌ Migration error:', error.message);
    logger.error({ error: error.message }, 'Firestore migration failed');
    // Don't throw - allow server to continue
  }
}

