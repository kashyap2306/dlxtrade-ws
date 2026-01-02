import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { keyManager } from '../services/keyManager';
import { logger } from '../utils/logger';

interface MigrationStats {
  totalUsersScanned: number;
  totalProvidersMigrated: number;
  totalProvidersSkipped: number; // Already exist in integrations
  totalProvidersFailed: number;
  errors: Array<{ uid: string; provider: string; error: string }>;
  migratedEntries: Array<{ uid: string; provider: string; hasApiKey: boolean; hasSecretKey: boolean }>;
}

class SettingsToIntegrationsMigrator {
  private db = admin.firestore(getFirebaseAdmin());
  private stats: MigrationStats = {
    totalUsersScanned: 0,
    totalProvidersMigrated: 0,
    totalProvidersSkipped: 0,
    totalProvidersFailed: 0,
    errors: [],
    migratedEntries: []
  };

  async runMigration(): Promise<MigrationStats> {
    console.log('🚀 STARTING SETTINGS TO INTEGRATIONS MIGRATION\n');

    try {
      // 1. Safety checks
      console.log('1️⃣ SAFETY CHECKS');
      await this.performSafetyChecks();

      // 2. Migration pass
      console.log('\n2️⃣ MIGRATION PASS');
      await this.performMigration();

      // 3. Verification
      console.log('\n3️⃣ VERIFICATION');
      await this.performVerification();

      // 4. Report
      console.log('\n4️⃣ FINAL REPORT');
      this.printFinalReport();

      return this.stats;

    } catch (error: any) {
      console.error('❌ CRITICAL ERROR:', error);
      throw error;
    }
  }

  private async performSafetyChecks() {
    // Verify encryption works
    try {
      const testKey = 'test_migration_key';
      const encrypted = keyManager.encrypt(testKey);
      const decrypted = keyManager.decrypt(encrypted, "user_request");

      if (decrypted !== testKey) {
        throw new Error('Encryption round-trip test failed');
      }

      console.log('   ✅ Encryption system verified');
    } catch (error: any) {
      console.error('   ❌ Encryption test failed:', error.message);
      throw error;
    }

    // Count users with provider configs
    const allUsers = await firestoreAdapter.getAllUsers();
    let usersWithProviderConfigs = 0;

    for (const user of allUsers) {
      const userDoc = await this.db.collection('users').doc(user.uid).get();
      if (userDoc.exists) {
        const data = userDoc.data() || {};
        const providerConfig = data.settings?.providerConfig;
        if (providerConfig && Object.keys(providerConfig).length > 0) {
          usersWithProviderConfigs++;
        }
      }
    }

    console.log(`   👥 Users with provider configs: ${usersWithProviderConfigs}/${allUsers.length}`);
    console.log('   ✅ Safety checks passed');
  }

  private async performMigration() {
    const allUsers = await firestoreAdapter.getAllUsers();
    console.log(`   🔄 Starting migration for ${allUsers.length} users...`);

    for (const user of allUsers) {
      this.stats.totalUsersScanned++;
      console.log(`   👤 Processing user ${user.uid.substring(0, 8)}...`);

      try {
        await this.migrateUserSettings(user.uid);
      } catch (error: any) {
        console.error(`   ❌ Failed to migrate user ${user.uid}:`, error.message);
        this.stats.errors.push({
          uid: user.uid,
          provider: 'USER_LEVEL',
          error: error.message
        });
      }
    }

    console.log(`   ✅ Migration complete:`);
    console.log(`      - Migrated: ${this.stats.totalProvidersMigrated} providers`);
    console.log(`      - Skipped: ${this.stats.totalProvidersSkipped} providers`);
    console.log(`      - Failed: ${this.stats.totalProvidersFailed} providers`);
  }

  private async migrateUserSettings(uid: string) {
    const userRef = this.db.collection('users').doc(uid);

    // Get current settings/providerConfig
    const settingsDoc = await userRef.collection('settings').doc('providerConfig').get();

    if (!settingsDoc.exists) {
      console.log(`      No settings/providerConfig for ${uid.substring(0, 8)}`);
      return;
    }

    const data = settingsDoc.data() || {};
    const providerConfig = data.providerConfig || {};

    if (Object.keys(providerConfig).length === 0) {
      console.log(`      Empty providerConfig for ${uid.substring(0, 8)}`);
      return;
    }

    console.log(`      Found ${Object.keys(providerConfig).length} providers in settings`);

    for (const [providerName, providerData] of Object.entries(providerConfig) as [string, any][]) {
      try {
        await this.migrateProvider(uid, providerName, providerData);
      } catch (error: any) {
        console.error(`      ❌ Failed to migrate ${providerName} for ${uid.substring(0, 8)}:`, error.message);
        this.stats.errors.push({
          uid,
          provider: providerName,
          error: error.message
        });
        this.stats.totalProvidersFailed++;
      }
    }
  }

  private async migrateProvider(uid: string, providerName: string, providerData: any) {
    const integrationsRef = this.db.collection('users').doc(uid).collection('integrations').doc(providerName);

    // Check if already exists in integrations
    const existingIntegration = await integrationsRef.get();
    if (existingIntegration.exists) {
      const existingData = existingIntegration.data() || {};
      if (existingData.apiKey || existingData.secretKey) {
        console.log(`         ⏭️  Skipped ${providerName} - already exists in integrations`);
        this.stats.totalProvidersSkipped++;
        return;
      }
    }

    const { apiKey, secretKey, enabled = true, type = 'api' } = providerData;

    // Only migrate if there are API keys to encrypt
    if (!apiKey && !secretKey) {
      console.log(`         ⏭️  Skipped ${providerName} - no API keys to migrate`);
      this.stats.totalProvidersSkipped++;
      return;
    }

    console.log(`         Migrating ${providerName}...`);

    // Encrypt the keys
    let encryptedApiKey = '';
    let encryptedSecretKey = '';
    let encryptionSuccess = true;

    if (apiKey && apiKey.trim() !== '') {
      try {
        encryptedApiKey = keyManager.encrypt(apiKey);
        console.log(`            ✅ Encrypted apiKey`);
      } catch (error: any) {
        console.error(`            ❌ Failed to encrypt apiKey:`, error.message);
        encryptionSuccess = false;
      }
    }

    if (secretKey && secretKey.trim() !== '') {
      try {
        encryptedSecretKey = keyManager.encrypt(secretKey);
        console.log(`            ✅ Encrypted secretKey`);
      } catch (error: any) {
        console.error(`            ❌ Failed to encrypt secretKey:`, error.message);
        encryptionSuccess = false;
      }
    }

    if (!encryptionSuccess) {
      throw new Error('Encryption failed for one or more keys');
    }

    // Save to integrations
    const integrationsPayload: any = {
      enabled: !!encryptedApiKey || !!encryptedSecretKey ? true : enabled,
      type,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      migratedFromSettings: true,
      migratedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (encryptedApiKey) integrationsPayload.apiKey = encryptedApiKey;
    if (encryptedSecretKey) integrationsPayload.secretKey = encryptedSecretKey;

    await integrationsRef.set(integrationsPayload, { merge: true });

    this.stats.migratedEntries.push({
      uid,
      provider: providerName,
      hasApiKey: !!encryptedApiKey,
      hasSecretKey: !!encryptedSecretKey
    });

    this.stats.totalProvidersMigrated++;
    console.log(`         ✅ Migrated ${providerName} to integrations`);
  }

  private async performVerification() {
    console.log('   🔍 Verifying migration...');

    // Spot check a few migrated entries
    const sampleSize = Math.min(5, this.stats.migratedEntries.length);
    const sampleEntries = this.stats.migratedEntries.slice(0, sampleSize);

    let verifiedCount = 0;

    for (const entry of sampleEntries) {
      try {
        const integration = await firestoreAdapter.getIntegration(entry.uid, entry.provider);
        if (integration && integration.apiKey && integration.enabled) {
          // Try to decrypt to verify
          if (entry.hasApiKey) {
            const decrypted = keyManager.decrypt(integration.apiKey, "user_request");
            if (decrypted && decrypted.length > 0) {
              verifiedCount++;
              console.log(`      ✅ Verified ${entry.provider} for ${entry.uid.substring(0, 8)}`);
            } else {
              console.log(`      ❌ Verification failed for ${entry.provider} - could not decrypt`);
            }
          } else {
            verifiedCount++;
            console.log(`      ✅ Verified ${entry.provider} for ${entry.uid.substring(0, 8)} (no apiKey)`);
          }
        } else {
          console.log(`      ❌ Verification failed for ${entry.provider} - integration not found or disabled`);
        }
      } catch (error: any) {
        console.log(`      ❌ Verification error for ${entry.provider}:`, error.message);
      }
    }

    console.log(`   ✅ Verification complete: ${verifiedCount}/${sampleSize} samples passed`);
  }

  private printFinalReport() {
    console.log('\n📊 MIGRATION REPORT');
    console.log('==================');
    console.log(`Total Users Scanned: ${this.stats.totalUsersScanned}`);
    console.log(`Providers Migrated: ${this.stats.totalProvidersMigrated}`);
    console.log(`Providers Skipped: ${this.stats.totalProvidersSkipped}`);
    console.log(`Providers Failed: ${this.stats.totalProvidersFailed}`);

    if (this.stats.migratedEntries.length > 0) {
      console.log('\n✅ Successfully Migrated:');
      this.stats.migratedEntries.forEach(entry => {
        console.log(`   - ${entry.uid.substring(0, 8)}: ${entry.provider} (apiKey: ${entry.hasApiKey}, secretKey: ${entry.hasSecretKey})`);
      });
    }

    if (this.stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      this.stats.errors.forEach(error => {
        console.log(`   - ${error.uid.substring(0, 8)}/${error.provider}: ${error.error}`);
      });
    }

    console.log('\n🚨 IMPORTANT: This migration is IDEMPOTENT and can be run multiple times safely.');
    console.log('   Providers that already exist in integrations were skipped.');
  }
}

// Main execution
if (require.main === module) {
  const migrator = new SettingsToIntegrationsMigrator();

  migrator.runMigration()
    .then((stats) => {
      console.log('\n🎉 MIGRATION COMPLETE!');
      if (stats.totalProvidersFailed > 0) {
        console.log(`\n⚠️  ${stats.totalProvidersFailed} providers failed to migrate. Check logs above.`);
        process.exit(1);
      } else {
        console.log('\n✅ All providers migrated successfully!');
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error('\n💥 CRITICAL FAILURE:', error);
      process.exit(1);
    });
}

export { SettingsToIntegrationsMigrator };
