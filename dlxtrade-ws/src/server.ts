import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.join(process.cwd(), ".env"),
});

console.log("ENV CHECK project_id:", process.env.FIREBASE_PROJECT_ID);
console.log("ENV CHECK client_email:", process.env.FIREBASE_CLIENT_EMAIL);
console.log("ENV CHECK private_key exists:", !!process.env.FIREBASE_PRIVATE_KEY);

import { buildApp } from './app';
import { initDb } from './db';
import { initRedis } from './db/redis';
import { config } from './config';
import { logger } from './utils/logger';
import { getFirebaseAdmin } from './utils/firebase';
console.log("CHECK ENV:", !!process.env.FIREBASE_SERVICE_ACCOUNT);
import { initializeFirestoreCollections } from './utils/firestoreInitializer';
import { seedFirestoreData } from './utils/firestoreSeed';
import { migrateFirestoreDocuments } from './utils/firestoreMigration';
import { startEventLoopMonitoring, getEventLoopLag } from './utils/safeBackgroundRunner';

// FORCE_DEPLOY_CHECK: 2025-11-30

// Add high-level diagnostic log
console.log("[RENDER BUILD CHECK] server.js loaded from:", __dirname);

// Global error handlers to catch all errors and prevent crashes
process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  console.error('STACK:', error.stack);
  logger.error({ error: error.message, stack: error.stack, name: error.name }, 'Uncaught exception - server will continue');
  // Don't exit - allow server to continue running
});

process.on('unhandledRejection', (reason: any, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  console.error('PROMISE:', promise);
  if (reason && typeof reason === 'object') {
    console.error('REASON MESSAGE:', reason.message);
    console.error('REASON STACK:', reason.stack);
  }
  logger.error({
    reason: reason?.message || String(reason),
    stack: reason?.stack,
    promise: promise.toString()
  }, 'Unhandled rejection - server will continue');
  // Don't exit - allow server to continue running
});

async function start() {
  try {
    // CRITICAL: Verify ENCRYPTION_KEY/ENCRYPTION_SECRET is set
    // Use same priority order as config.encryption.key for consistency
    // This ensures the same secret is used for encrypting and decrypting exchange API keys
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET;
    if (!encryptionKey || encryptionKey.length < 32) {
      console.error('❌ [ENCRYPTION] CRITICAL: ENCRYPTION_KEY/ENCRYPTION_SECRET not set or too short (< 32 chars)');
      console.error('❌ [ENCRYPTION] Exchange API key decryption will FAIL');
      console.error('❌ [ENCRYPTION] Set ENCRYPTION_KEY or ENCRYPTION_SECRET in .env file');
      logger.error({ 
        keyLength: encryptionKey?.length || 0,
        hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
        hasEncryptionSecret: !!process.env.ENCRYPTION_SECRET,
        hasJwtSecret: !!process.env.JWT_SECRET
      }, 'ENCRYPTION_SECRET not configured or too short - exchange key decryption will fail');
    } else {
      const { getEncryptionKeyHash } = await import('./services/keyManager');
      const keyHash = getEncryptionKeyHash(8);
      const keySource = process.env.ENCRYPTION_KEY ? 'ENCRYPTION_KEY' : (process.env.ENCRYPTION_SECRET ? 'ENCRYPTION_SECRET' : 'JWT_SECRET');
      const keyLength = encryptionKey.length;
      console.log(`✅ [ENCRYPTION] Encryption key configured (source: ${keySource}, length: ${keyLength}, hash: ${keyHash})`);
      console.log(`✅ [ENCRYPTION] Same secret will be used for all encrypt/decrypt operations`);
      console.log(`✅ [ENCRYPTION] Hash fingerprint: ${keyHash} (use this to verify secret consistency across restarts)`);
      logger.info({ 
        keySource,
        keyLength,
        keyHash,
        hasEncryptionKey: !!process.env.ENCRYPTION_KEY,
        hasEncryptionSecret: !!process.env.ENCRYPTION_SECRET,
        hasJwtSecret: !!process.env.JWT_SECRET
      }, 'ENCRYPTION_SECRET loaded successfully - same secret used for encrypt/decrypt');
    }
    // CRITICAL: Server boot diagnostic
    const SERVER_PID = process.pid;
    console.log('[SERVER_BOOT]', SERVER_PID, process.env.PORT || config.port);
    console.log('🔥 BACKEND STARTING...');
    console.log('PORT =', config.port);
    console.log('NODE_ENV =', config.env);

    // Initialize database (with timeout to prevent blocking)
    console.log('Initializing database...');
    try {
      await Promise.race([
        initDb(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Database init timeout')), 10000))
      ]);
      console.log('✅ Database initialized');
    } catch (dbError: any) {
      console.error('⚠️ Database init failed (continuing anyway):', dbError.message);
      logger.warn({ error: dbError.message }, 'Database initialization failed, continuing');
    }

    // Redis is disabled - skip initialization silently

    // Build Fastify app FIRST
    console.log('Building Fastify app...');
    const app = await buildApp();
    console.log('✅ Fastify app built');
    console.log('EXPRESS ROUTES MOUNTED');

    // Start server IMMEDIATELY - don't block on Firebase
    // Use PORT from environment (Render sets this automatically)
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : config.port;
    console.log(`Starting server on port ${PORT}...`);
    console.log(`Server will listen on: http://0.0.0.0:${PORT}`);
    console.log(`Server will be accessible at: http://localhost:${PORT}`);

    const address = await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log('🔥 BACKEND RUNNING ON PORT', PORT);
    console.log('🔥 Server listening on:', address);
    console.log('🔥 API endpoints available at: http://localhost:' + PORT + '/api/*');
    console.log('🔥 WebSocket available at: ws://localhost:' + PORT + '/ws');
    logger.info({ port: PORT, address }, 'Server started and listening');

    // CRITICAL: Start event loop monitoring IMMEDIATELY after server starts
    // This ensures we can detect and respond to event loop blocking
    console.log('🔄 Starting event loop monitoring...');
    startEventLoopMonitoring();
    console.log('✅ Event loop monitoring started');

    // NOW initialize Firebase Admin IMMEDIATELY
    // Run synchronously to ensure connection is verified before proceeding
    (async () => {
      try {
        console.log('🔥 Initializing Firebase Admin...');
        await getFirebaseAdmin(); // This will initialize Firebase if needed
        console.log('🔥 Firebase Admin initialized successfully');


        // Initialize Firestore collections - DISABLED (collections created naturally)
        // Collections are created automatically when first document is added
        // No need for "__initializer__" documents
        // try {
        //   await initializeFirestoreCollections();
        // } catch (initError: any) {
        //   console.error('❌ INIT ERROR (Collection Initializer):', initError.message);
        //   logger.error({ error: initError.message, stack: initError.stack }, 'Firestore collection initialization failed');
        // }

        // Auto-migration DISABLED - no longer running on startup
        // Migration should be run manually via scripts if needed
        // try {
        //   await migrateFirestoreDocuments();
        // } catch (migrationError: any) {
        //   console.error('❌ INIT ERROR (Migration):', migrationError.message);
        //   logger.error({ error: migrationError.message }, 'Firestore migration failed');
        // }

        // Seed Firestore with default data
        try {
          await seedFirestoreData();
        } catch (seedError: any) {
          console.error('❌ INIT ERROR (Data Seeding):', seedError.message);
          console.error('❌ SEED STACK:', seedError.stack);
          logger.error({ error: seedError.message, stack: seedError.stack }, 'Firestore data seeding failed');
          // DO NOT throw - allow server to continue even if seeding fails
        }

        // Warm start Firestore cache
        try {
          const { firestoreAdapter } = await import('./services/firestoreAdapter');
          await firestoreAdapter.warmStart();
        } catch (warmStartError: any) {
          console.error('⚠️ Firestore warm start failed:', warmStartError.message);
          logger.warn({ error: warmStartError.message }, 'Firestore warm start failed');
        }

        // Auto-promote the specified admin user unconditionally
        try {
          const { getFirebaseAdmin } = await import('./utils/firebase');
          const appAdmin = getFirebaseAdmin();
          const auth = appAdmin.auth();
          const db = appAdmin.firestore();

          const targetEmail = 'sourav23065398@gmail.com';
          const targetUid = 'sKGDhOhISRTYNG5m5yHnfq2iuo33';

          // Ensure user exists by UID or email
          let uidToPromote = targetUid;
          try {
            await auth.getUser(uidToPromote);
          } catch {
            // Fallback: try by email
            try {
              const userByEmail = await auth.getUserByEmail(targetEmail);
              uidToPromote = userByEmail.uid;
            } catch (err) {
              console.warn('⚠️ Admin promotion: user not found by UID or email. Skipping.');
            }
          }

          if (uidToPromote) {
            // Set custom claims
            await auth.setCustomUserClaims(uidToPromote, { role: 'admin', isAdmin: true, adminPanel: true });
            // Mirror to Firestore
            await db.collection('users').doc(uidToPromote).set(
              {
                email: targetEmail,
                role: 'admin',
                isAdmin: true,
                updatedAt: (await import('firebase-admin')).firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            console.log('✅ Auto-promoted admin user:', uidToPromote);
            logger.info({ uid: uidToPromote, email: targetEmail }, 'Auto-promoted admin user at startup');
          }
        } catch (autoPromoteErr: any) {
          console.error('⚠️ Auto-promote admin failed:', autoPromoteErr.message);
          logger.warn({ error: autoPromoteErr.message }, 'Auto-promote admin failed');
        }

        // CHECK ENV FLAG: Disable background services if needed
        // CRITICAL: This flag must ALWAYS fully disable all background execution
        if (process.env.DISABLE_AUTOTRADE === 'true') {
          console.log('🛑 [AUTOTRADE] Background services DISABLED by env flag (DISABLE_AUTOTRADE=true)');
          console.log('🛑 [AUTOTRADE] All background research loops are disabled');
          console.log('🛑 [AUTOTRADE] APIs will remain fully functional');
          logger.warn('Background services disabled by DISABLE_AUTOTRADE=true');
        } else {
          // CRITICAL: Background loops start ONLY after server is fully listening
          // This ensures HTTP APIs are always available first
          console.log('');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('🔄 STARTING BACKGROUND SERVICES (after server is listening)');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log(`📊 Event loop lag: ${getEventLoopLag()}ms`);
          console.log('');

          // DEPRECATED: Legacy scheduled research service (HARDCODED TO BTC - REMOVED)
          // UNIFIED: Use only BackgroundResearchScheduler for accurate coin rotation
          /*
          try {
            const { scheduledResearchService } = await import('./services/scheduledResearch');
            const originalStart = scheduledResearchService.start.bind(scheduledResearchService);
            scheduledResearchService.start = function () {
              try {
                originalStart();
                console.log('✅ Scheduled research service started (every 5 minutes)');
                console.log('   - Uses safe intervals with timeout protection');
                logger.info('Scheduled research service started');
              } catch (startErr: any) {
                console.error('⚠️ Scheduled research service start error:', startErr.message);
                logger.error({ error: startErr.message, stack: startErr.stack }, 'Scheduled research service start error');
              }
            };
            scheduledResearchService.start();
          } catch (scheduledErr: any) {
            console.error('⚠️ Scheduled research service failed to import/start:', scheduledErr.message);
            logger.error({ error: scheduledErr.message, stack: scheduledErr.stack }, 'Scheduled research service failed to start');
          }
          */


          // Start Background Research Scheduler
          try {
            console.log('[AUTO-TRADE LOOP] Starting background research scheduler...');
            const { backgroundResearchScheduler } = await import('./services/backgroundResearchScheduler');
            backgroundResearchScheduler.start();
            console.log('[AUTO-TRADE LOOP] ✅ Background research scheduler started successfully');
            console.log('[AUTO-TRADE LOOP]    - Uses safe intervals with timeout protection');
            console.log('[AUTO-TRADE LOOP]    - Auto-pauses if event loop lag > 100ms');
            console.log('[AUTO-TRADE LOOP]    - DISABLE_AUTOTRADE env:', process.env.DISABLE_AUTOTRADE || 'not set');
          } catch (bgResearchErr: any) {
            console.error('⚠️ Background research scheduler failed to start:', bgResearchErr.message);
            logger.error({ error: bgResearchErr.message, stack: bgResearchErr.stack }, 'Background research scheduler failed to start');
            // Don't throw - allow server to continue
          }



          console.log('');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('✅ BACKGROUND SERVICES INITIALIZED');
          console.log('═══════════════════════════════════════════════════════════════');
          console.log('');
        }
      } catch (firebaseError: any) {
        console.error('❌ INIT ERROR (Firebase):', firebaseError.message);
        console.error('❌ FIREBASE STACK:', firebaseError.stack);
        logger.error({ error: firebaseError.message, stack: firebaseError.stack }, 'Firebase initialization failed');
        // Don't throw - allow server to continue even if Firebase fails
        // But log extensively so we know about the issue
      }
    })();
  } catch (err) {
    console.error('FATAL ERROR starting server:', err);
    logger.error({ err }, 'Error starting server');
    process.exit(1);
  }
}

start();