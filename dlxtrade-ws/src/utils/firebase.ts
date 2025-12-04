import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

let firebaseAdmin: admin.app.App | null = null;

export function initFirebaseAdmin(): void {
  if (firebaseAdmin) {
    return;
  }

  try {
    let parsed: any;
    let source: string;

    // First, try to load from environment variable (production/Render)
    const envServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (envServiceAccount) {
      try {
        parsed = JSON.parse(envServiceAccount);
        source = 'environment variable';
        logger.info('Loading Firebase service account from environment variable');
      } catch (err: any) {
        logger.error({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON from environment');
        // Don't throw - try local file instead
      }
    }

    // If environment variable failed or doesn't exist, try local file (localhost development)
    if (!parsed) {
      try {
        const serviceAccountPath = path.resolve(__dirname, '../../firebase_service_account.json');
        const fileContent = fs.readFileSync(serviceAccountPath, 'utf8');
        parsed = JSON.parse(fileContent);
        source = 'local file';
        logger.info({ path: serviceAccountPath }, 'Loading Firebase service account from local file');
      } catch (err: any) {
        const error = new Error('Firebase service account not found in environment variable or local file');
        logger.warn({ error: error.message }, 'Firebase Admin initialization skipped - missing service account');
        // Don't throw - allow server to continue without Firebase (for development/testing)
        return;
      }
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
    logger.info({ projectId, source }, `Firebase Admin initialized with service account from ${source}`);
  } catch (error: any) {
    // Log error but don't throw - allow server to start even if Firebase fails
    logger.error({ error: error.message, stack: error.stack }, 'Error initializing Firebase Admin - server will continue without Firebase');
  }
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
	if (!firebaseAdmin) {
		initFirebaseAdmin();
	}
	return admin.auth().verifyIdToken(token);
}

export function getFirebaseAdmin(): admin.app.App {
	if (!firebaseAdmin) {
		logger.info('Firebase Admin not initialized, attempting to initialize...');
		initFirebaseAdmin();

		if (!firebaseAdmin) {
			logger.error('Firebase Admin initialization failed - returning null app');
			throw new Error('Firebase Admin not initialized - check service account configuration');
		}
	}
	return firebaseAdmin;
}

/**
 * Performs a simple Firestore write to verify Admin SDK connectivity.
 * This is intentionally minimal and not part of business logic.
 */
export async function performForcedTestWrite(): Promise<void> {
	if (!firebaseAdmin) {
		initFirebaseAdmin();
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
