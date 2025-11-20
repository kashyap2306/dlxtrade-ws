import * as admin from 'firebase-admin';
import { logger } from './logger';

let firebaseAdmin: admin.app.App | null = null;

export function initializeFirebaseAdmin(): void {
  if (firebaseAdmin) {
    return;
  }

  try {
    // Service account JSON - can be from env var or hardcoded for this project
    const serviceAccountJson = {
      type: "service_account",
      project_id: "dlx-trading",
      private_key_id: "f2b69190b2a228cdcecaa12be6041ade2e81a006",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQClPtsx0QDjbFat\npzJZ0nqiLD5NYO21xJnKSxJezwcQcp7IiUiiPlUmZCVeY1YAHm64IVVCtVGRG+5N\nsvEyiVIE3sxlyG92g2jqAw9Ir6tW6TTsHrNtCOPsDf2WrXPlbr6Q0u1l+k8luPCR\n8E5D2ZN0Xe7MGfaW2rCkq1dpI0LG0+ZpUKWvPWnSllHgAnJ4A1NxYbkrYE1uHs0H\nWBTC91I/Gj8qPj5x4zMsQkJCW98Rq+u1JBbwfOc4hjs6OJfJuDA7dJr1v1hihH+o\n19ROSLxm7ZONe+STWXXzqgvbsnzp/iYcf5MeIWN5GBCGWxHGBKPjcy3N4fB+iUxP\n9tYzYacnAgMBAAECggEACi8H/v3a8kKy5GvTIg78wmU71IGRoZI2sIb7Rr8dt9YT\nuNchFBw6tWCwBUbVvePvCq3FnXrwLNaBIEyG9qIMEHaTBGWbkCNQ6JvjEFjNlE/p\nLfFGBh7pcQEU7Kxoe2GQumGNaN7J8h1/xSnl1BYJTNjqU3pfV8FHG2oSobOfG2kW\n986t2UOqDoRqIkFIPvBnFl9Xuw0OVyhYn/stAHW8v8TQ3iTSLn2qGvlTUijgcg++\nxcu6NStkoAd9cK4I8740w4JJeQe4SuaJHUslatEObH5M8jg8YvjJ9ATX+++cT+3P\nc3GZVTLmGk1I9/3SbnqIsuVU0Xq9Ic9/KxkyO/i8zQKBgQDStGUSS1kKZnm6YwLa\n56q4WGrcTST13Zl4fBI9641AZJmndnMgME9l49KfdW44hcRjNjTPBDWPiKQ+1tZ8\nGGQ6P31J71VrXkJjXKxX8VaF3jSwouc6rKoAhD4BYwTGhL7HSY0I4AIu3uVV6i62\nuN003S9Pgp12vreAWuMgawJYTQKBgQDIxLs/oEOeMTesHX9Q90JMqxFje4m94+Cf\nbHZFjsL29AD2CEcz4CQjpaIj64/PkoDUoS5L9FDP9/sLGflTpI1vyzvKfGcd07lA\ncX+8DaLMEmPMOUXISwXubxyVQeV+SsvPir53LVEgVQwkk4QB479qkrPFa+6IdR7A\nh5JHWfw3QwKBgBvt24PcRvYw9Su2mhdIJAIBflCrTR3l/MTStVxNz9BcRV3EPqhi\nnvOjijSmzTBi0tBPzBowtaTL+PF3asDSPt7VsZbOSaVMvkILc7DIha6C8LsFLN9D\nKdmdrdZjOKvTxrIF1tL5VnC+DOohe4Wu5Wtvcij46ERoLUyvP3H5nTr1AoGBAL4s\n1G41ojdzyZeIrXQFc1DqbmM8v0IXXEvHUtUaoQWKJmrndoLmG3WEzOyXkzb9QHmp\nYBBkkjQdYzil1u3rHmq6KZ3pb0fqqT0pBeUdSYtjFBN8YOSUZD7yEzIzJG8X7K1g\ncIC1dXZZ+VGgRlf/4u7RneYxEddCkemvwdlCnM2/AoGBAKX6OUs3nCC8n+Qn5tIL\np48qBxAPKUeCAdIx1vok5Fb3eFObgm8Cecx9+DmmsPIkiS5vsbJxr2y/gti5qDm4\nUWjO8dr2X8Jjftacs2Uam5gHygT27OzabzFPsahCWohETeLCoOFlYs3nxYk+s3cY\nAcAu3WrFt4+iFVxnkN4bkyox\n-----END PRIVATE KEY-----\n",
      client_email: "firebase-adminsdk-fbsvc@dlx-trading.iam.gserviceaccount.com",
      client_id: "106285546497731813110",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40dlx-trading.iam.gserviceaccount.com",
      universe_domain: "googleapis.com"
    };

    // Allow override from environment variable if provided
    let parsed: any = serviceAccountJson;
    const envRaw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (envRaw) {
      try {
        parsed = JSON.parse(envRaw);
        // Fix private_key: replace literal \n with actual newlines (Render env vars escape them)
        if (parsed.private_key && typeof parsed.private_key === 'string') {
          parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
      } catch (err: any) {
        logger.warn({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT from env, using default');
        // Use default service account
      }
    }

    // Extract projectId from service account
    const projectId = parsed.project_id || 'dlx-trading';

    if (!projectId) {
      logger.warn('Firebase projectId could not be determined - Firebase Admin will not be initialized');
      return;
    }

    // Initialize Firebase Admin with service account
    const app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key,
      }),
      projectId,
    });

    // Configure Firestore with minimal settings
    const firestore = app.firestore();
    firestore.settings({ 
      ignoreUndefinedProperties: true,
      experimentalForceLongPolling: false,
    });

    firebaseAdmin = app;
    console.log('✅ Firebase Admin initialized successfully');
    logger.info({ projectId }, 'Firebase Admin initialized successfully');
  } catch (error: any) {
    console.error('❌ Error initializing Firebase Admin:', error.message);
    logger.error({ error: error.message, stack: error.stack }, 'Error initializing Firebase Admin');
    // Don't throw - allow server to continue
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
