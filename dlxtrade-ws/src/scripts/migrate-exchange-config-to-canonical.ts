#!/usr/bin/env tsx

/**
 * ONE-TIME MIGRATION: Fix exchangeConfig data inconsistency
 *
 * PROBLEM: Exchange keys exist in legacy paths but missing from canonical path
 * SOLUTION: Copy exchange data to canonical location for affected users
 *
 * SAFETY: Idempotent, read-only for existing canonical data, preserves all fields
 */

import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';

interface ExchangeConfigData {
  exchange?: string;
  apiKeyEncrypted?: string;
  secretEncrypted?: string;
  secretKeyEncrypted?: string;
  passphraseEncrypted?: string;
  exchangeStatus?: string;
  testnet?: boolean;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
}

async function migrateExchangeConfigToCanonical(): Promise<void> {
  logger.info('🔄 [EXCHANGE_CONFIG_MIGRATION] Starting exchangeConfig canonical path migration');

  const db = getFirebaseAdmin().firestore();
  const usersSnapshot = await db.collection('users').get();

  let totalUsers = 0;
  let usersNeedingMigration = 0;
  let usersMigrated = 0;
  let usersSkipped = 0;

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    totalUsers++;

    try {
      // Skip system UIDs
      if (uid.startsWith('system-') || uid.length < 10) {
        continue;
      }

      // Check if canonical path already exists
      const canonicalDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

      if (canonicalDoc.exists) {
        // Canonical exists - check if it's complete
        const canonicalData = canonicalDoc.data() as ExchangeConfigData;
        const hasKeys = !!(canonicalData?.apiKeyEncrypted && (canonicalData?.secretEncrypted || canonicalData?.secretKeyEncrypted));

        if (hasKeys) {
          logger.debug({ uid }, 'EXCHANGE_CONFIG_CANONICAL_EXISTS_AND_COMPLETE - skipping migration');
          continue;
        } else {
          logger.info({ uid }, 'EXCHANGE_CONFIG_CANONICAL_EXISTS_BUT_INCOMPLETE - will attempt to supplement');
        }
      }

      // Look for legacy exchange data in integrations collection
      const integrationsSnapshot = await db.collection('users').doc(uid).collection('integrations').get();
      let legacyExchangeData: ExchangeConfigData | null = null;

      // Search through integrations for exchange-related data
      for (const integrationDoc of integrationsSnapshot.docs) {
        const integrationData = integrationDoc.data();

        // Look for exchange fields in integration data
        if (integrationData.apiKeyEncrypted || integrationData.secretEncrypted || integrationData.secretKeyEncrypted) {
          legacyExchangeData = {
            exchange: integrationData.exchange || integrationData.type,
            apiKeyEncrypted: integrationData.apiKeyEncrypted,
            secretEncrypted: integrationData.secretEncrypted,
            secretKeyEncrypted: integrationData.secretKeyEncrypted,
            passphraseEncrypted: integrationData.passphraseEncrypted,
            testnet: integrationData.testnet || false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            migratedFrom: `integrations/${integrationDoc.id}`,
            migrationTimestamp: admin.firestore.FieldValue.serverTimestamp()
          };
          break; // Found exchange data, stop searching
        }
      }

      // Also check if there's any direct exchange data in user doc (legacy)
      if (!legacyExchangeData) {
        const userData = userDoc.data();
        if (userData?.apiKeyEncrypted || userData?.secretEncrypted || userData?.secretKeyEncrypted) {
          legacyExchangeData = {
            exchange: userData.exchange || userData.exchangeName,
            apiKeyEncrypted: userData.apiKeyEncrypted,
            secretEncrypted: userData.secretEncrypted,
            secretKeyEncrypted: userData.secretKeyEncrypted,
            passphraseEncrypted: userData.passphraseEncrypted,
            testnet: userData.testnet || false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            migratedFrom: 'userDoc',
            migrationTimestamp: admin.firestore.FieldValue.serverTimestamp()
          };
        }
      }

      if (legacyExchangeData) {
        usersNeedingMigration++;

        // Validate legacy data has required fields
        const hasApiKey = !!legacyExchangeData.apiKeyEncrypted;
        const hasSecret = !!(legacyExchangeData.secretEncrypted || legacyExchangeData.secretKeyEncrypted);
        const hasExchange = !!legacyExchangeData.exchange;

        if (!hasApiKey || !hasSecret || !hasExchange) {
          logger.warn({
            uid,
            hasApiKey,
            hasSecret,
            hasExchange,
            migratedFrom: legacyExchangeData.migratedFrom
          }, 'EXCHANGE_CONFIG_LEGACY_DATA_INCOMPLETE - skipping migration');
          usersSkipped++;
          continue;
        }

        // Perform the migration
        const canonicalRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');

        // Use merge: false to ensure clean slate, but check for conflicts
        const existingCanonicalData = canonicalDoc.exists ? canonicalDoc.data() : null;

        if (existingCanonicalData?.apiKeyEncrypted && existingCanonicalData.apiKeyEncrypted !== legacyExchangeData.apiKeyEncrypted) {
          logger.warn({
            uid,
            canonicalApiKey: !!existingCanonicalData.apiKeyEncrypted,
            legacyApiKey: !!legacyExchangeData.apiKeyEncrypted,
            migratedFrom: legacyExchangeData.migratedFrom
          }, 'EXCHANGE_CONFIG_MIGRATION_CONFLICT_DETECTED - canonical and legacy data differ, skipping');
          usersSkipped++;
          continue;
        }

        // Safe to migrate
        await canonicalRef.set(legacyExchangeData, { merge: false });

        logger.info({
          uid,
          exchange: legacyExchangeData.exchange,
          migratedFrom: legacyExchangeData.migratedFrom,
          hasApiKey: !!legacyExchangeData.apiKeyEncrypted,
          hasSecret: !!legacyExchangeData.secretEncrypted || !!legacyExchangeData.secretKeyEncrypted,
          hasPassphrase: !!legacyExchangeData.passphraseEncrypted
        }, 'EXCHANGE_CONFIG_MIGRATED_TO_CANONICAL');

        usersMigrated++;

        // Log legacy data presence for cleanup consideration
        logger.info({
          uid,
          migratedFrom: legacyExchangeData.migratedFrom
        }, 'LEGACY_EXCHANGE_CONFIG_PRESENT - data preserved for reference');

      } else {
        logger.debug({ uid }, 'EXCHANGE_CONFIG_NO_LEGACY_DATA_FOUND - user has no exchange data to migrate');
      }

    } catch (userErr: any) {
      logger.error({
        uid,
        error: userErr.message,
        stack: userErr.stack
      }, 'EXCHANGE_CONFIG_MIGRATION_FAILED_FOR_USER');
      usersSkipped++;
    }
  }

  logger.info({
    totalUsers,
    usersNeedingMigration,
    usersMigrated,
    usersSkipped,
    successRate: usersMigrated / Math.max(usersNeedingMigration, 1) * 100
  }, 'EXCHANGE_CONFIG_MIGRATION_COMPLETED');
}

async function verifyMigrationConsistency(): Promise<void> {
  logger.info('🔍 [MIGRATION_VERIFICATION] Verifying exchange usability consistency post-migration');

  const db = getFirebaseAdmin().firestore();
  const usersSnapshot = await db.collection('users').get();

  let totalUsers = 0;
  let usersWithExchangeConfig = 0;
  let usabilityConsistent = 0;
  let usabilityInconsistent = 0;
  let legacyDataDetected = 0;

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    totalUsers++;

    try {
      // Skip system UIDs
      if (uid.startsWith('system-') || uid.length < 10) {
        continue;
      }

      // Check if canonical config exists
      const canonicalDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

      // Check for legacy data (should not exist post-migration)
      let hasLegacyData = false;
      const integrationsSnapshot = await db.collection('users').doc(uid).collection('integrations').get();

      for (const integrationDoc of integrationsSnapshot.docs) {
        const integrationData = integrationDoc.data();
        if (integrationData.apiKeyEncrypted || integrationData.secretEncrypted || integrationData.secretKeyEncrypted) {
          hasLegacyData = true;
          legacyDataDetected++;
          logger.warn({
            uid,
            legacyPath: `integrations/${integrationDoc.id}`,
            hasApiKey: !!integrationData.apiKeyEncrypted,
            hasSecret: !!integrationData.secretEncrypted || !!integrationData.secretKeyEncrypted
          }, 'POST_MIGRATION_INCONSISTENCY_DETECTED - Legacy exchange data still present');
          break;
        }
      }

      // Also check user doc for legacy fields
      const userData = userDoc.data();
      if (!hasLegacyData && (userData?.apiKeyEncrypted || userData?.secretEncrypted || userData?.secretKeyEncrypted)) {
        hasLegacyData = true;
        legacyDataDetected++;
        logger.warn({
          uid,
          legacyPath: 'userDoc',
          hasApiKey: !!userData.apiKeyEncrypted,
          hasSecret: !!userData.secretEncrypted || !!userData.secretKeyEncrypted
        }, 'POST_MIGRATION_INCONSISTENCY_DETECTED - Legacy exchange data in user document');
      }

      if (!canonicalDoc.exists) {
        if (hasLegacyData) {
          logger.error({
            uid,
            hasLegacyData: true
          }, 'POST_MIGRATION_INCONSISTENCY_DETECTED - Legacy data exists but canonical missing');
        }
        continue; // No exchange config, skip
      }

      usersWithExchangeConfig++;

      // Test isExchangeUsable (this will verify the canonical path and decryption)
      const { isExchangeUsable } = await import('../services/firestoreAdapter');
      const usability = await isExchangeUsable(uid, 'background_job');

      // Log detailed usability result
      logger.info({
        uid,
        usable: usability.usable,
        reason: usability.reason,
        exchange: usability.exchange,
        hasLegacyData
      }, 'EXCHANGE_CONFIG_POST_MIGRATION_VERIFICATION');

      // The usability result should be consistent
      if (usability.usable) {
        usabilityConsistent++;
      } else {
        usabilityInconsistent++;
        logger.warn({
          uid,
          reason: usability.reason,
          exchange: usability.exchange
        }, 'EXCHANGE_USABILITY_INCONSISTENT_POST_MIGRATION');
      }

    } catch (userErr: any) {
      logger.error({ uid, error: userErr.message }, 'EXCHANGE_CONFIG_VERIFICATION_FAILED_FOR_USER');
      usabilityInconsistent++;
    }
  }

  logger.info({
    totalUsers,
    usersWithExchangeConfig,
    usabilityConsistent,
    usabilityInconsistent,
    legacyDataDetected,
    consistencyRate: usabilityConsistent / Math.max(usersWithExchangeConfig, 1) * 100
  }, 'EXCHANGE_CONFIG_VERIFICATION_COMPLETED');

  if (legacyDataDetected > 0) {
    logger.warn({
      legacyDataDetected,
      totalUsersWithExchange: usersWithExchangeConfig
    }, 'LEGACY_EXCHANGE_DATA_DETECTED_AFTER_MIGRATION - Migration may be incomplete');
  }
}

// Main execution
async function main(): Promise<void> {
  try {
    console.log('🚀 Starting exchangeConfig canonical migration...');

    // Step 1: Migrate legacy data to canonical path
    await migrateExchangeConfigToCanonical();

    console.log('✅ Migration completed, starting verification...');

    // Step 2: Verify consistency
    await verifyMigrationConsistency();

    console.log('🎉 ExchangeConfig migration and verification completed successfully!');
    console.log('📊 Check logs above for detailed migration and consistency results.');

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    logger.error({ error: error.message, stack: error.stack }, 'EXCHANGE_CONFIG_MIGRATION_SCRIPT_FAILED');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { migrateExchangeConfigToCanonical, verifyMigrationConsistency };
