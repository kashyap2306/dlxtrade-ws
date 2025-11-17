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
      throw new Error('FIREBASE_SERVICE_ACCOUNT env var is required to initialize Firebase Admin');
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      logger.error({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT JSON');
      throw err;
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
      throw new Error('Firebase projectId could not be determined from FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID');
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
    logger.error({ error: error.message, stack: error.stack }, 'Error initializing Firebase Admin');
    throw error;
  }
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
	if (!firebaseAdmin) {
		initializeFirebaseAdmin();
	}
	return admin.auth().verifyIdToken(token);
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
	const db = getFirebaseAdmin().firestore();
	const docRef = db.collection('system').doc('_admin_init_check');
	await docRef.set(
		{
			ok: true,
			checkedAt: admin.firestore.FieldValue.serverTimestamp(),
		},
		{ merge: true }
	);
}
