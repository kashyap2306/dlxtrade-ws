#!/usr/bin/env node
"use strict";
/**
 * Manual Firestore seed script
 * Usage: npm run seed:firestore or node dist/scripts/seedFirestore.js
 */
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_1 = require("../utils/firebase");
const firestoreSeed_1 = require("../utils/firestoreSeed");
async function main() {
    try {
        console.log('🔥 Starting manual Firestore seed...');
        // Initialize Firebase Admin
        (0, firebase_1.initializeFirebaseAdmin)();
        // Run seed
        await (0, firestoreSeed_1.seedAll)();
        console.log('✅ Seed completed successfully!');
        process.exit(0);
    }
    catch (error) {
        console.error('❌ Seed failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
main();
