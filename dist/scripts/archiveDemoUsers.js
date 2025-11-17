"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const logger_1 = require("../utils/logger");
async function archiveDemoUsers() {
    try {
        console.log('🔥 Starting demo users archive...');
        // Initialize Firebase Admin
        (0, firebase_1.initializeFirebaseAdmin)();
        const db = admin.firestore((0, firebase_1.getFirebaseAdmin)());
        // Get all users
        const usersSnapshot = await db.collection('users').get();
        console.log(`📊 Found ${usersSnapshot.size} total users`);
        const demoPatterns = [
            /^demo\d+$/i, // demo1, demo2, etc.
            /^test-user-/i, // test-user-*
            /^test\d+$/i, // test1, test2, etc.
            /^seed_test_/i, // seed_test_*
        ];
        const archivedUsers = [];
        // Check each user
        for (const doc of usersSnapshot.docs) {
            const userData = doc.data();
            const uid = doc.id;
            const name = userData.name || userData.displayName || '';
            const isDemo = userData.demo === true;
            // Check if matches demo pattern
            let isDemoMatch = false;
            if (isDemo) {
                isDemoMatch = true;
            }
            else {
                for (const pattern of demoPatterns) {
                    if (pattern.test(uid) || pattern.test(name)) {
                        isDemoMatch = true;
                        break;
                    }
                }
            }
            if (isDemoMatch) {
                try {
                    // Move to archivedUsers collection
                    const archivedRef = db.collection('archivedUsers').doc(uid);
                    await archivedRef.set({
                        ...userData,
                        originalDocId: uid,
                        archivedAt: admin.firestore.Timestamp.now(),
                        archivedReason: isDemo ? 'demo flag set' : 'matches demo pattern',
                    });
                    // Delete from users collection
                    await doc.ref.delete();
                    archivedUsers.push({
                        uid,
                        name: userData.name || userData.displayName || '',
                        email: userData.email || '',
                        demo: isDemo,
                    });
                    console.log(`✅ Archived user: ${uid} (${name})`);
                }
                catch (error) {
                    console.error(`❌ Error archiving user ${uid}:`, error.message);
                    logger_1.logger.error({ uid, error: error.message }, 'Error archiving demo user');
                }
            }
        }
        console.log('\n📋 Archive Summary:');
        console.log(`   Total users checked: ${usersSnapshot.size}`);
        console.log(`   Users archived: ${archivedUsers.length}`);
        console.log('\n📝 Archived UIDs:');
        archivedUsers.forEach((user) => {
            console.log(`   - ${user.uid} (${user.name || 'no name'}) ${user.email || ''}`);
        });
        if (archivedUsers.length > 0) {
            console.log('\n✅ Demo users archive completed successfully');
        }
        else {
            console.log('\n✅ No demo users found to archive');
        }
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Fatal error in archiveDemoUsers:', error);
        logger_1.logger.error({ error: error.message, stack: error.stack }, 'Fatal error in archiveDemoUsers');
        process.exit(1);
    }
}
// Run script
archiveDemoUsers();
