"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../utils/firebase");
const userOnboarding_1 = require("../services/userOnboarding");
const logger_1 = require("../utils/logger");
async function backfillAuthUsers() {
    try {
        console.log('🔥 Starting auth users backfill...');
        // Initialize Firebase Admin
        (0, firebase_1.initializeFirebaseAdmin)();
        const firebaseAdmin = (0, firebase_1.getFirebaseAdmin)();
        const db = firebaseAdmin.firestore();
        const auth = firebaseAdmin.auth();
        // Get all users from Firebase Auth (paginated)
        let nextPageToken;
        let totalAuthUsers = 0;
        let newDocsCreated = 0;
        let existingDocsSkipped = 0;
        let errors = 0;
        do {
            const listUsersResult = await auth.listUsers(1000, nextPageToken);
            nextPageToken = listUsersResult.pageToken;
            console.log(`📊 Processing batch of ${listUsersResult.users.length} auth users...`);
            for (const userRecord of listUsersResult.users) {
                totalAuthUsers++;
                const uid = userRecord.uid;
                const email = userRecord.email || undefined;
                const name = userRecord.displayName || undefined;
                const phone = userRecord.phoneNumber || null;
                try {
                    // Check if user doc already exists
                    const userDoc = await db.collection('users').doc(uid).get();
                    if (userDoc.exists) {
                        existingDocsSkipped++;
                        console.log(`⏭️  Skipping existing user: ${uid} (${email || 'no email'})`);
                        continue;
                    }
                    // Run idempotent onboarding
                    const result = await (0, userOnboarding_1.ensureUser)(uid, {
                        name,
                        email,
                        phone,
                    });
                    if (result.success) {
                        if (result.createdNew) {
                            newDocsCreated++;
                            console.log(`✅ Created user doc: ${uid} (${email || 'no email'})`);
                        }
                        else {
                            existingDocsSkipped++;
                            console.log(`⏭️  User doc already exists: ${uid}`);
                        }
                    }
                    else {
                        errors++;
                        console.error(`❌ Error creating user doc for ${uid}:`, result.error);
                        logger_1.logger.error({ uid, email, error: result.error }, 'Error in backfill for auth user');
                    }
                }
                catch (error) {
                    errors++;
                    console.error(`❌ Error processing auth user ${uid}:`, error.message);
                    logger_1.logger.error({ uid, email, error: error.message, stack: error.stack }, 'Error processing auth user in backfill');
                }
            }
            console.log(`   Processed ${totalAuthUsers} auth users so far...`);
        } while (nextPageToken);
        const summary = {
            totalAuthUsers,
            newDocsCreated,
            existingDocsSkipped,
            errors,
        };
        console.log('\n📋 Backfill Summary:');
        console.log(`   Total auth users: ${summary.totalAuthUsers}`);
        console.log(`   New docs created: ${summary.newDocsCreated}`);
        console.log(`   Existing docs skipped: ${summary.existingDocsSkipped}`);
        console.log(`   Errors: ${summary.errors}`);
        if (summary.errors > 0) {
            console.log('\n⚠️  Some errors occurred during backfill. Check logs for details.');
        }
        else {
            console.log('\n✅ Backfill completed successfully');
        }
        process.exit(summary.errors > 0 ? 1 : 0);
    }
    catch (error) {
        console.error('❌ Fatal error in backfillAuthUsers:', error);
        logger_1.logger.error({ error: error.message, stack: error.stack }, 'Fatal error in backfillAuthUsers');
        process.exit(1);
    }
}
// Run script
backfillAuthUsers();
