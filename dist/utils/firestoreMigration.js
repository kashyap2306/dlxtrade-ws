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
exports.migrateFirestoreDocuments = migrateFirestoreDocuments;
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("./firebase");
const logger_1 = require("./logger");
/**
 * Auto-migration routine to patch missing fields with default values
 * Runs on server start to ensure all documents match PART A schema
 */
async function migrateFirestoreDocuments() {
    try {
        console.log('🔄 Starting Firestore auto-migration...');
        const db = (0, firebase_1.getFirebaseAdmin)().firestore();
        let migrationCount = 0;
        // Migrate users collection
        const usersSnapshot = await db.collection('users').get();
        for (const doc of usersSnapshot.docs) {
            const data = doc.data();
            const updates = {};
            if (data.totalPnl === undefined)
                updates.totalPnl = 0;
            if (data.dailyPnl === undefined)
                updates.dailyPnl = 0;
            if (data.weeklyPnl === undefined)
                updates.weeklyPnl = 0;
            if (data.monthlyPnl === undefined)
                updates.monthlyPnl = 0;
            if (data.totalTrades === undefined)
                updates.totalTrades = 0;
            if (data.engineRunning === undefined)
                updates.engineRunning = false;
            if (data.hftRunning === undefined)
                updates.hftRunning = false;
            if (data.apiConnected === undefined)
                updates.apiConnected = false;
            if (data.unlockedAgents === undefined)
                updates.unlockedAgents = [];
            if (data.role === undefined)
                updates.role = 'user';
            if (data.lastLogin === undefined)
                updates.lastLogin = admin.firestore.Timestamp.now();
            if (Object.keys(updates).length > 0) {
                await doc.ref.update(updates);
                migrationCount++;
            }
        }
        // Migrate engineStatus collection
        const engineStatusSnapshot = await db.collection('engineStatus').get();
        for (const doc of engineStatusSnapshot.docs) {
            const data = doc.data();
            const updates = {};
            if (data.engineRunning === undefined)
                updates.engineRunning = false;
            if (data.ordersExecuted === undefined)
                updates.ordersExecuted = 0;
            if (data.totalPnl === undefined)
                updates.totalPnl = 0;
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
        }
        else {
            const data = globalStatsDoc.data();
            const updates = {};
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
            logger_1.logger.info({ count: migrationCount }, 'Firestore migration completed');
        }
        else {
            console.log('✅ Migration completed: No updates needed');
        }
    }
    catch (error) {
        console.error('❌ Migration error:', error.message);
        logger_1.logger.error({ error: error.message }, 'Firestore migration failed');
        // Don't throw - allow server to continue
    }
}
