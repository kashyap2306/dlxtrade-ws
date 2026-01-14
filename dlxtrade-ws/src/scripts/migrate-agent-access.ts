/**
 * Agent Access Migration Script
 *
 * Migrates legacy Firestore agent access data from users/{uid}/agents
 * to PostgreSQL user_agents table for backward compatibility.
 */

import { getFirebaseAdmin } from '../utils/firebase';
import { query } from '../db';
import { logger } from '../utils/logger';

interface FirestoreAgentDoc {
  unlocked: boolean;
  unlockedAt: any;
  [key: string]: any;
}

async function migrateAgentAccess() {
  try {
    logger.info('Starting agent access migration from Firestore to PostgreSQL...');

    const db = getFirebaseAdmin().firestore();

    // Get all users
    const usersSnapshot = await db.collection('users').get();
    logger.info({ userCount: usersSnapshot.size }, 'Found users to check for agent access');

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Agent ID mapping from Firestore names to PostgreSQL agent_ids
    const agentMapping: Record<string, string> = {
      'trading-agent': 'TRADING_AGENT',
      'crowd_consensus_copy_trade': 'COPY_TRADING_AGENT',
      'vwap-strategy': 'VWAP_STRATEGY',
      'ai_launchpad_hunter': 'LAUNCHPAD_AGENT',
      // Add more mappings as needed
    };

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;

      try {
        logger.info({ uid }, 'Checking user agent access');

        // Get user's agents from Firestore
        const agentsSnapshot = await db.collection('users').doc(uid).collection('agents').get();

        if (agentsSnapshot.empty) {
          logger.info({ uid }, 'No agent access data found in Firestore');
          continue;
        }

        for (const agentDoc of agentsSnapshot.docs) {
          const firestoreAgentId = agentDoc.id;
          const agentData = agentDoc.data() as FirestoreAgentDoc;

          // Skip system documents
          if (firestoreAgentId.startsWith('_')) {
            continue;
          }

          // Check if agent is unlocked in Firestore
          if (!agentData.unlocked) {
            logger.info({ uid, firestoreAgentId }, 'Agent not unlocked in Firestore, skipping');
            continue;
          }

          // Map Firestore agent ID to PostgreSQL agent_id
          const postgresAgentId = agentMapping[firestoreAgentId];
          if (!postgresAgentId) {
            logger.warn({ uid, firestoreAgentId }, 'Unknown agent ID mapping, skipping');
            continue;
          }

          // Check if user already has this agent in PostgreSQL
          const existingAccess = await query(`
            SELECT id FROM user_agents
            WHERE user_id = $1 AND agent_id = $2 AND is_active = true
          `, [uid, postgresAgentId]);

          if (existingAccess.length > 0) {
            logger.info({ uid, postgresAgentId }, 'User already has agent access in PostgreSQL, skipping');
            skippedCount++;
            continue;
          }

          // Grant access in PostgreSQL
          const unlockedAt = agentData.unlockedAt?.toDate?.() || new Date();
          await query(`
            INSERT INTO user_agents (user_id, agent_id, granted_at, granted_by, is_active)
            VALUES ($1, $2, $3, 'migration_script', true)
            ON CONFLICT (user_id, agent_id) DO UPDATE SET
              is_active = true,
              granted_at = $3,
              granted_by = 'migration_script',
              updated_at = NOW()
          `, [uid, postgresAgentId, unlockedAt]);

          logger.info({ uid, postgresAgentId }, '✅ Migrated agent access to PostgreSQL');
          migratedCount++;
        }

      } catch (error: any) {
        errorCount++;
        logger.error({ uid, error: error.message }, 'Error migrating user agent access');
      }
    }

    const summary = {
      totalUsers: usersSnapshot.size,
      migratedAccess: migratedCount,
      skippedExisting: skippedCount,
      errors: errorCount,
    };

    logger.info(summary, 'Agent access migration completed');

    return {
      success: true,
      ...summary,
    };

  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Fatal error in agent access migration');
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  (async () => {
    try {
      // Initialize Firebase Admin
      getFirebaseAdmin();

      const result = await migrateAgentAccess();
      console.log('Migration result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    } catch (error: any) {
      console.error('Migration failed:', error);
      process.exit(1);
    }
  })();
}

export { migrateAgentAccess };