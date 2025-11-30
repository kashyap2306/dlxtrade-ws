import { buildApp } from './app';
import { initDb } from './db';
import { initRedis } from './db/redis';
import { config } from './config';
import { logger } from './utils/logger';
import { initializeFirebaseAdmin, performForcedTestWrite } from './utils/firebase';
import { initializeFirestoreCollections } from './utils/firestoreInitializer';
import { seedFirestoreData } from './utils/firestoreSeed';
import { migrateFirestoreDocuments } from './utils/firestoreMigration';

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

    // NOW initialize Firebase Admin IMMEDIATELY
    // Run synchronously to ensure connection is verified before proceeding
    (async () => {
      try {
        console.log('🔥 Initializing Firebase Admin...');
        initializeFirebaseAdmin();
        console.log('🔥 Firebase Admin initialized successfully');

        // Perform forced test write to verify connection IMMEDIATELY
        console.log('🔥 Performing REAL FIRESTORE TEST WRITE...');
        try {
          await performForcedTestWrite();
          console.log('🔥 REAL FIRESTORE TEST WRITE SUCCESS');
        } catch (testWriteError: any) {
          console.error('❌ INIT ERROR (Forced Test Write):', testWriteError.message);
          console.error('❌ STACK:', testWriteError.stack);
          logger.error({ error: testWriteError.message, stack: testWriteError.stack }, 'Forced test write failed - Firebase Admin may not be connected to real Firestore');
          // DO NOT throw - allow server to continue even if test write fails
          // This prevents blocking server startup on Render
        }

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

        // Start scheduled research service (runs every 5 minutes)
        // Wrap in try/catch and error boundary to prevent crashes
        try {
          const { scheduledResearchService } = await import('./services/scheduledResearch');
          
          // Wrap start() in error handler
          const originalStart = scheduledResearchService.start.bind(scheduledResearchService);
          scheduledResearchService.start = function() {
            try {
              originalStart();
              console.log('✅ Scheduled research service started (every 5 minutes)');
              logger.info('Scheduled research service started');
            } catch (startErr: any) {
              console.error('⚠️ Scheduled research service start error:', startErr.message);
              console.error('STACK:', startErr.stack);
              logger.error({ error: startErr.message, stack: startErr.stack }, 'Scheduled research service start error');
              // Don't throw - allow server to continue
            }
          };
          
          scheduledResearchService.start();
        } catch (scheduledErr: any) {
          console.error('⚠️ Scheduled research service failed to import/start:', scheduledErr.message);
          console.error('STACK:', scheduledErr.stack);
          logger.error({ error: scheduledErr.message, stack: scheduledErr.stack }, 'Scheduled research service failed to start');
          // Don't throw - allow server to continue
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

