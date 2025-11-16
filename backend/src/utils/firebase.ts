import * as admin from 'firebase-admin';
import { logger } from './logger';

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin(): void {
	if (firebaseAdmin) {
		return;
	}

	try {
		// Prefer default credentials in Firebase Functions environment
		// Fallback to FIREBASE_SERVICE_ACCOUNT_KEY for local/dev
		let app: admin.app.App;

		if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
			try {
				const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY as string);
				app = admin.initializeApp({
					credential: admin.credential.cert(serviceAccount),
					projectId: (serviceAccount as any).project_id || process.env.FIREBASE_PROJECT_ID,
				});
				logger.info('Firebase Admin initialized with explicit service account key');
			} catch (err) {
				logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY, falling back to application default credentials');
				app = admin.initializeApp();
			}
		} else if (admin.apps && admin.apps.length > 0) {
			app = admin.app();
		} else {
			app = admin.initializeApp();
			logger.info('Firebase Admin initialized with application default credentials');
		}

		// Configure Firestore
		app.firestore().settings({ ignoreUndefinedProperties: true });

		firebaseAdmin = app;
	} catch (error: any) {
		logger.error({ error: error.message }, 'Error initializing Firebase Admin');
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
