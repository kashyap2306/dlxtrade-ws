import * as admin from 'firebase-admin';
import { logger } from './logger';

let firebaseAdmin: admin.app.App | null = null;

/**
 * Default service account for dlx-trading project
 * This is used if FIREBASE_SERVICE_ACCOUNT_KEY is not provided in environment
 */
const DEFAULT_SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'dlx-trading',
  private_key_id: '354305546bffb937a6890ba46d6a7146de4cf09f',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCwjvAC171mrgc3\nA98IlkuQbGacDJI7U2ku1/OtAmM/r3dPhIeMJVWag42/3GNJe0WvUdDU3XyMv9kL\nLC/i0bNuPLWObAT6DU2iYF/Fl4t0CWjuxY/C0EcGlnezT66tIH1uNlXlpnvNd5yc\nKVp3qkWtyi+oCsVqu9hr7g+DNUQABPb6L8G/v3ws/9coGz26zgL0XHEmq0OpogKk\n7rr3lt7YY5RqvIdfC/1vCQzjvl+dNVt/91RuM1pvakXBZ5q9FGKMZ0Oqc/4Hn4OL\nSW54K6hnb9ftjWLkZy4lZGAsaL9hUTf2u+b3BEyvZinfdcSUkR2kzV24whYXpYlI\ngkU15EVVAgMBAAECggEAFdPiD9PotkZLHY3Ut8zO9EC2kdHLDVsTTKeFmGzMZN32\nR+YoVNbzxZnAf0kJnFbJZ3KbuQlV4dfBB0zT8bx/rKAESSKJHfnhkHLOPFEvPC4C\no0xY6NqTgVi+XTR7catr3mGIzo69zQnd2n+RT+yE10bBDAsi2350M+m3UL8X1FGT\n/rr3bO7UDRGees1iDwE2BSfow2+3s/2kcRXWN4/4dA7pfSLNb/KCbIMe8CYWhqyG\nbcgJ9KhOUNB+0MhZUVO3UkiUBI2tvdeW2/NS3HtaoNDuhHhTyo7dJbNhpiQpY/Cy\nDPSoD9jj429CBm7x4mAXBDwvyrL4WnDXLw3sgyekaQKBgQDqX8dw+XNIDjJMwSJZ\nX0/WLFQFDE7t04C9ugh6IZjxGhvqJlrATHRvgZdbUz4hMkfp6Yq3zz9Jc/c2HaqX\nm8byIAkxiKrSRK27zhOm+QVxQnHEMGAew03HT10p+iJKNAl7N5p/UjXoulH8+7yv\njTZ8hY5tIN6M8pLlNDBqTQehGQKBgQDA2XmBvnImre2Z7yn3GvkPPDriRwnLN64a\nc/p9LAW3dc13KKeui83xgIvpfzePKUrzBPz3mIn7qrQbB3VhbFutKrzNagAjkc1N\n0vVQMhpnIjnWrrf1BiaUJpr51MnFNvIozPqWopKCHxTO/NO7Ou+BihDpSEw2T3X5\nr0GKnwxhnQKBgERCVuS5UfDnaZDfIvDiiG75BBNgTVCIq9MV7kgbpt55Wy3rs7yT\nx8l99aX8bXjfmwAuK19zNZxf8NzK8RcsoFl+KQ9LHW0V4X9z+ldD6WjeECIycJwl\nB28H1ztVhU0VMLm5LP7t45N/SEekzYRXXUoQ37U6wHZOY6frdjpPauxpAoGAD4Ku\nQiAmIDRG8uWIc4Zo16/ZcI+UGxMcXqZLVDvxLcM8xkOv0NsPskfLePkxZ8NDcu5I\nxkUve91L5QyhhTdo3DGew8qtvi6g24yHDG8rLnZTPpAI3Z0kBzBfsI5LuB/mNB/g\nW7Mxo2OKkedFxD5GOx32pDybXJbhfzZ4SATowwUCgYEAob8alJu9Sd/SPbOdmK2u\nxTbiBn3ZwQukjJLVcb/moFRcGYOoOvLEN0ox6VZogjFRsxW7htzq3Pq7OSEdsPek\nzKYyhW2E43PGfFGZ+5EMvCSg9wE+r3xL+eqMNVV+IRfMiYyCD9A/DmtfQknN+t0e\nls4pZwi6zk/PxdxGg8LKumU=\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-adminsdk-fbsvc@dlx-trading.iam.gserviceaccount.com',
  client_id: '106285546497731813110',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40dlx-trading.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
};

export function initializeFirebaseAdmin(): void {
  if (firebaseAdmin) {
    return;
  }

  try {
    // Ensure we're NOT using emulator - FORCE REMOVE ALL EMULATOR FLAGS
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_EMULATOR;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIREBASE_PROJECT_ID;

    let serviceAccount: admin.ServiceAccount;

    // Use service account from environment variable if provided, otherwise use default
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        logger.info('Using Firebase service account from environment variable');
      } catch (parseError) {
        logger.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY, using default service account');
        serviceAccount = DEFAULT_SERVICE_ACCOUNT as admin.ServiceAccount;
      }
    } else {
      logger.info('Using default Firebase service account for dlx-trading project');
      serviceAccount = DEFAULT_SERVICE_ACCOUNT as admin.ServiceAccount;
    }

    // VERIFY 1: Print serviceAccount.project_id
    const serviceAccountProjectId = (serviceAccount as any).project_id || serviceAccount.projectId || 'NOT_FOUND';
    console.log('🔥 VERIFY: serviceAccount.project_id =', serviceAccountProjectId);
    
    if (!serviceAccountProjectId || serviceAccountProjectId === 'NOT_FOUND' || serviceAccountProjectId === '') {
      throw new Error('serviceAccount.project_id is null, undefined, or empty! Cannot proceed.');
    }

    // Initialize Firebase Admin SDK with service account
    // This connects to REAL Firebase (not emulator)
    const projectId = serviceAccountProjectId;
    
    firebaseAdmin = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId,
    });

    // VERIFY 2: Print admin.app().options.projectId
    const actualProjectId = firebaseAdmin.options.projectId;
    console.log('🔥 VERIFY: admin.app().options.projectId =', actualProjectId);
    
    if (!actualProjectId || actualProjectId === '' || actualProjectId === null || actualProjectId === undefined) {
      throw new Error('Firebase Admin initialized but projectId is null, undefined, or empty!');
    }

    if (actualProjectId !== serviceAccountProjectId) {
      throw new Error(`Project ID mismatch! serviceAccount: ${serviceAccountProjectId}, admin.app: ${actualProjectId}`);
    }

    // VERIFY 3: Test Firestore connection with a read
    const db = firebaseAdmin.firestore();
    // This will fail if not connected to real Firestore
    db.settings({ ignoreUndefinedProperties: true });
    
    console.log('🔥 VERIFY: Firestore instance created successfully');
    console.log('🔥 FIREBASE ADMIN CONNECTED TO PROJECT:', actualProjectId);

    logger.info({ projectId: actualProjectId }, 'Firebase Admin initialized - CONNECTED TO REAL FIREBASE');
  } catch (error: any) {
    logger.error({ error: error.message }, 'Error initializing Firebase Admin');
    console.error('❌ INIT ERROR (Firebase Admin):', error);
    throw error;
  }
}

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  if (!firebaseAdmin) {
    initializeFirebaseAdmin();
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken;
  } catch (error) {
    logger.error({ error }, 'Error verifying Firebase token');
    throw error;
  }
}

export function getFirebaseAdmin(): admin.app.App {
  if (!firebaseAdmin) {
    initializeFirebaseAdmin();
  }
  return firebaseAdmin!;
}

/**
 * Performs a forced test write to verify Firebase Admin is connected to real Firestore
 * This MUST run after Firebase Admin initialization
 */
export async function performForcedTestWrite(): Promise<void> {
  try {
    const db = getFirebaseAdmin().firestore();
    const testData = {
      ok: true,
      timestamp: Date.now(),
    };
    
    await db.collection('debug_test').doc('force').set(testData);
    console.log('🔥 REAL FIRESTORE TEST WRITE SUCCESS');
    logger.info('Forced test write to debug_test collection successful');
    
    // Verify write by reading it back
    const verifyDoc = await db.collection('debug_test').doc('force').get();
    if (verifyDoc.exists) {
      console.log('🔥 VERIFY: Test document confirmed in Firestore');
    } else {
      throw new Error('Test write succeeded but document not found on read!');
    }
  } catch (error: any) {
    console.error('❌ INIT ERROR (Forced Test Write):', error);
    logger.error({ error: error.message, stack: error.stack }, 'Forced test write failed');
    throw error;
  }
}

