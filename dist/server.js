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
const app_1 = require("./app");
const db_1 = require("./db");
const config_1 = require("./config");
const logger_1 = require("./utils/logger");
const firebase_1 = require("./utils/firebase");
const firestoreInitializer_1 = require("./utils/firestoreInitializer");
const firestoreSeed_1 = require("./utils/firestoreSeed");
const firestoreMigration_1 = require("./utils/firestoreMigration");
// Global error handlers to catch all errors (DO NOT EXIT PROCESS)
process.on('uncaughtException', (error) => {
    // Log error but don't crash the process
    logger_1.logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception - continuing');
    // DO NOT call process.exit() - keep server running
});
process.on('unhandledRejection', (reason, promise) => {
    // Log error but don't crash the process
    logger_1.logger.error({ reason: reason?.message || reason, promise }, 'Unhandled rejection - continuing');
    // DO NOT call process.exit() - keep server running
});
async function start() {
    try {
        console.log('🔥 BACKEND STARTING...');
        console.log('PORT =', config_1.config.port);
        console.log('NODE_ENV =', config_1.config.env);
        // Initialize database (with timeout to prevent blocking)
        console.log('Initializing database...');
        try {
            await Promise.race([
                (0, db_1.initDb)(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Database init timeout')), 10000))
            ]);
            console.log('✅ Database initialized');
        }
        catch (dbError) {
            console.error('⚠️ Database init failed (continuing anyway):', dbError.message);
            logger_1.logger.warn({ error: dbError.message }, 'Database initialization failed, continuing');
        }
        // Redis is disabled - skip initialization silently
        // Build Fastify app FIRST
        console.log('Building Fastify app...');
        const app = await (0, app_1.buildApp)();
        console.log('✅ Fastify app built');
        console.log('EXPRESS ROUTES MOUNTED');
        // Start server IMMEDIATELY - don't block on Firebase
        const PORT = config_1.config.port || 4000;
        console.log(`Starting server on port ${PORT}...`);
        console.log(`Server will listen on: http://0.0.0.0:${PORT}`);
        console.log(`Server will be accessible at: http://localhost:${PORT}`);
        const address = await app.listen({ port: PORT, host: '0.0.0.0' });
        console.log('🔥 BACKEND RUNNING ON PORT', PORT);
        console.log('🔥 Server listening on:', address);
        console.log('🔥 API endpoints available at: http://localhost:' + PORT + '/api/*');
        console.log('🔥 WebSocket available at: ws://localhost:' + PORT + '/ws');
        logger_1.logger.info({ port: PORT, address }, 'Server started and listening');
        // NOW initialize Firebase Admin IMMEDIATELY
        // Run synchronously to ensure connection is verified before proceeding
        (async () => {
            try {
                console.log('🔥 Initializing Firebase Admin...');
                (0, firebase_1.initializeFirebaseAdmin)();
                console.log('🔥 Firebase Admin initialized successfully');
                // Perform forced test write to verify connection IMMEDIATELY
                console.log('🔥 Performing REAL FIRESTORE TEST WRITE...');
                try {
                    await (0, firebase_1.performForcedTestWrite)();
                    console.log('🔥 REAL FIRESTORE TEST WRITE SUCCESS');
                }
                catch (testWriteError) {
                    console.error('❌ INIT ERROR (Forced Test Write):', testWriteError.message);
                    console.error('❌ STACK:', testWriteError.stack);
                    logger_1.logger.error({ error: testWriteError.message, stack: testWriteError.stack }, 'Forced test write failed - Firebase Admin may not be connected to real Firestore');
                    // DO NOT throw - allow server to continue even if test write fails
                    // This prevents blocking server startup on Render
                }
                // Initialize Firestore collections - FORCED RUN (no conditions)
                try {
                    await (0, firestoreInitializer_1.initializeFirestoreCollections)();
                }
                catch (initError) {
                    console.error('❌ INIT ERROR (Collection Initializer):', initError.message);
                    logger_1.logger.error({ error: initError.message, stack: initError.stack }, 'Firestore collection initialization failed');
                }
                // Run auto-migration to patch missing fields
                try {
                    await (0, firestoreMigration_1.migrateFirestoreDocuments)();
                }
                catch (migrationError) {
                    console.error('❌ INIT ERROR (Migration):', migrationError.message);
                    logger_1.logger.error({ error: migrationError.message }, 'Firestore migration failed');
                }
                // Seed Firestore with default data
                try {
                    await (0, firestoreSeed_1.seedFirestoreData)();
                }
                catch (seedError) {
                    console.error('❌ INIT ERROR (Data Seeding):', seedError.message);
                    console.error('❌ SEED STACK:', seedError.stack);
                    logger_1.logger.error({ error: seedError.message, stack: seedError.stack }, 'Firestore data seeding failed');
                    // DO NOT throw - allow server to continue even if seeding fails
                }
                // Auto-promote the specified admin user unconditionally
                try {
                    const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('./utils/firebase')));
                    const appAdmin = getFirebaseAdmin();
                    const auth = appAdmin.auth();
                    const db = appAdmin.firestore();
                    const targetEmail = 'sourav23065398@gmail.com';
                    const targetUid = 'sKGDhOhISRTYNG5m5yHnfq2iuo33';
                    // Ensure user exists by UID or email
                    let uidToPromote = targetUid;
                    try {
                        await auth.getUser(uidToPromote);
                    }
                    catch {
                        // Fallback: try by email
                        try {
                            const userByEmail = await auth.getUserByEmail(targetEmail);
                            uidToPromote = userByEmail.uid;
                        }
                        catch (err) {
                            console.warn('⚠️ Admin promotion: user not found by UID or email. Skipping.');
                        }
                    }
                    if (uidToPromote) {
                        // Set custom claims
                        await auth.setCustomUserClaims(uidToPromote, { role: 'admin', isAdmin: true, adminPanel: true });
                        // Mirror to Firestore
                        await db.collection('users').doc(uidToPromote).set({
                            email: targetEmail,
                            role: 'admin',
                            isAdmin: true,
                            updatedAt: (await Promise.resolve().then(() => __importStar(require('firebase-admin')))).firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });
                        console.log('✅ Auto-promoted admin user:', uidToPromote);
                        logger_1.logger.info({ uid: uidToPromote, email: targetEmail }, 'Auto-promoted admin user at startup');
                    }
                }
                catch (autoPromoteErr) {
                    console.error('⚠️ Auto-promote admin failed:', autoPromoteErr.message);
                    logger_1.logger.warn({ error: autoPromoteErr.message }, 'Auto-promote admin failed');
                }
            }
            catch (firebaseError) {
                console.error('❌ INIT ERROR (Firebase):', firebaseError.message);
                console.error('❌ FIREBASE STACK:', firebaseError.stack);
                logger_1.logger.error({ error: firebaseError.message, stack: firebaseError.stack }, 'Firebase initialization failed');
                // Don't throw - allow server to continue even if Firebase fails
                // But log extensively so we know about the issue
            }
        })();
    }
    catch (err) {
        console.error('FATAL ERROR starting server:', err);
        logger_1.logger.error({ err }, 'Error starting server');
        process.exit(1);
    }
}
start();
