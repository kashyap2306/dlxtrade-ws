
// @ts-nocheck
import * as dotenv from 'dotenv';
dotenv.config();
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

/**
 * MIGRATION_REMOVE_INVALID_KEYS
 * 
 * Objective: Permanently eliminate legacy INVALID_KEYS state.
 * 
 * Logic:
 * 1. Iterate all users.
 * 2. Check users/{uid}/exchangeConfig/current.
 * 3. If exchangeStatus === 'INVALID_KEYS':
 *    - Remove exchangeStatus
 *    - Remove keysClearedAt
 *    - Remove keysClearedReason
 *    - Log the action.
 * 4. Do NOT touch encrypted keys.
 */

async function migrateRemoveInvalidKeys() {
    console.log('🚀 [MIGRATION] Starting removal of INVALID_KEYS state...');

    try {
        const db = getFirebaseAdmin().firestore();
        const usersSnap = await db.collection('users').get();

        if (usersSnap.empty) {
            console.log('ℹ️ No users found.');
            return;
        }

        console.log(`ℹ️ Checking ${usersSnap.size} users for INVALID_KEYS exchange state...`);

        let processedCount = 0;
        let affectedCount = 0;
        let errorCount = 0;

        for (const userDoc of usersSnap.docs) {
            const uid = userDoc.id;
            const exchangeConfigRef = db.collection('users').doc(uid).collection('exchangeConfig').doc('current');

            try {
                const configSnap = await exchangeConfigRef.get();
                if (!configSnap.exists) {
                    continue;
                }

                const data = configSnap.data();
                if (!data) continue;

                // CHECK CONDITION: exchangeStatus === 'INVALID_KEYS'
                if (data.exchangeStatus === 'INVALID_KEYS') {
                    console.log(`⚠️ [FOUND] User ${uid} has exchangeStatus='INVALID_KEYS'. Cleaning up...`);

                    // Prepare update payload - DELETE specific fields
                    const updatePayload: any = {
                        exchangeStatus: admin.firestore.FieldValue.delete(),
                        keysClearedAt: admin.firestore.FieldValue.delete(),
                        keysClearedReason: admin.firestore.FieldValue.delete()
                    };

                    // DRY RUN CHECK (Optional, but here we just do it)
                    // console.log(`   Deleting fields: exchangeStatus, keysClearedAt, keysClearedReason`);

                    await exchangeConfigRef.update(updatePayload);
                    console.log(`✅ [CLEANED] User ${uid} exchange config cleaned.`);
                    affectedCount++;
                }

            } catch (err: any) {
                console.error(`❌ [ERROR] Processing user ${uid}:`, err.message);
                errorCount++;
            }

            processedCount++;
            if (processedCount % 10 === 0) {
                process.stdout.write('.');
            }
        }

        console.log('\n');
        console.log('🏁 [MIGRATION COMPLETE]');
        console.log(`   Checked: ${usersSnap.size}`);
        console.log(`   Processed: ${processedCount}`);
        console.log(`   Affected/Cleaned: ${affectedCount}`);
        console.log(`   Errors: ${errorCount}`);

    } catch (error: any) {
        console.error('❌ [FATAL ERROR] Migration failed:', error);
        process.exit(1);
    }
}

// Execute
if (require.main === module) {
    migrateRemoveInvalidKeys()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
