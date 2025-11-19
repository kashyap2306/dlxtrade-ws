import * as admin from 'firebase-admin';
import { logger } from './logger';

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin(): void {
  if (firebaseAdmin) {
    return;
  }

  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!raw) {
      const error = new Error('FIREBASE_SERVICE_ACCOUNT env var is required to initialize Firebase Admin');
      logger.warn({ error: error.message }, 'Firebase Admin initialization skipped - missing service account');
      // Don't throw - allow server to continue without Firebase (for development/testing)
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      logger.error({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT JSON');
      // Don't throw - allow server to continue
      return;
    }

    // Fix private_key: replace literal \n with actual newlines (Render env vars escape them)
    if (parsed.private_key && typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }

    // Extract projectId from service account or env
    const projectId =
      parsed.project_id ||
      process.env.FIREBASE_PROJECT_ID ||
      (parsed.projectId as string | undefined);

    if (!projectId) {
      logger.warn('Firebase projectId could not be determined - Firebase Admin will not be initialized');
      // Don't throw - allow server to continue
      return;
    }

    // Initialize Firebase Admin with explicit credential and projectId
    const app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: parsed.project_id || projectId,
        clientEmail: parsed.client_email || process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: parsed.private_key || process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
      projectId,
    });

    // Configure Firestore with minimal settings (ignore undefined, disable telemetry)
    const firestore = app.firestore();
    firestore.settings({ 
      ignoreUndefinedProperties: true,
      // Disable telemetry
      experimentalForceLongPolling: false,
    });

    firebaseAdmin = app;
    logger.info({ projectId }, 'Firebase Admin initialized with service account from environment');
  } catch (error: any) {
    // Log error but don't throw - allow server to start even if Firebase fails
    logger.error({ error: error.message, stack: error.stack }, 'Error initializing Firebase Admin - server will continue without Firebase');
  }
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
	if (!firebaseAdmin) {
		initializeFirebaseAdmin();
	}
	
	if (!firebaseAdmin) {
		throw new Error('Firebase Admin not initialized - cannot verify token');
	}
	
	return admin.auth(firebaseAdmin).verifyIdToken(token);
}

export function getFirebaseAdmin(): admin.app.App {
	if (!firebaseAdmin) {
		initializeFirebaseAdmin();
	}
	return firebaseAdmin!;
}

/**
 * Performs a simple Firestore write to verify Admin SDK connectivity.
 * This is intentionally minimal and not part of business logic.
 */
export async function performForcedTestWrite(): Promise<void> {
	if (!firebaseAdmin) {
		initializeFirebaseAdmin();
	}
	
	// If Firebase Admin still not initialized, skip test write
	if (!firebaseAdmin) {
		logger.warn('Skipping Firebase test write - Firebase Admin not initialized');
		return;
	}
	
	try {
		const db = getFirebaseAdmin().firestore();
		const docRef = db.collection('system').doc('_admin_init_check');
		await docRef.set(
			{
				ok: true,
				checkedAt: admin.firestore.FieldValue.serverTimestamp(),
			},
			{ merge: true }
		);
	} catch (error: any) {
		// Handle "Unable to detect a Project Id" and other auth errors gracefully
		if (error.message?.includes('Unable to detect') || error.message?.includes('project id') || error.code === 'auth/') {
			logger.warn({ error: error.message }, 'Firebase test write failed - project ID or auth issue (non-fatal)');
		} else {
			logger.error({ error: error.message, stack: error.stack }, 'Firebase test write failed');
		}
		// Don't throw - allow server to continue
	}
}
