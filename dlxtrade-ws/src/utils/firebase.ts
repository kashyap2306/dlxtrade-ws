import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env")
});

console.log("DEBUG ENV:", process.env.FIREBASE_PROJECT_ID);

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

let privateKey = process.env.FIREBASE_PRIVATE_KEY;

// remove accidental surrounding quotes
if (privateKey?.startsWith('"') && privateKey?.endsWith('"')) {
  privateKey = privateKey.slice(1, -1);
}

// fallback to JSON service account
if ((!projectId || !clientEmail || !privateKey) && process.env.FIREBASE_SERVICE_ACCOUNT) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  privateKey = json.private_key;
}

export const firebaseConfig = {
  projectId,
  clientEmail,
  privateKey
};

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
      const json = JSON.parse(raw);
      privateKey = json.private_key;
    }
  }

  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase environment variables:");
    console.error("- FIREBASE_PROJECT_ID:", !!projectId);
    console.error("- FIREBASE_CLIENT_EMAIL:", !!clientEmail);
    console.error("- FIREBASE_PRIVATE_KEY:", !!privateKey);

    // FORCE MOCK MODE: Always use mock when Firebase env vars are missing
    console.log("🔥 Running BACKEND in LOCAL MOCK FIREBASE MODE");
    console.log("🔥 Firebase environment variables missing - using mock implementation");

    firebaseApp = {
      name: '[MOCK]',
      options: {
        projectId: 'mock-project',
        apiKey: 'mock-api-key',
        authDomain: 'mock-project.firebaseapp.com',
      },
      firestore: () => ({
        listCollections: () => Promise.resolve([]),
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: () => Promise.resolve({
              exists: true,
              data: () => ({
                uid: id,
                email: 'mock@example.com',
                displayName: 'Mock User',
                createdAt: new Date()
              }),
              id
            }),
            set: (data: any) => Promise.resolve(),
            update: (data: any) => Promise.resolve(),
            delete: () => Promise.resolve(),
            collection: (subName: string) => ({
              doc: (subId: string) => ({
                get: () => Promise.resolve({
                  exists: true,
                  data: () => ({}),
                  id: subId
                }),
                set: (data: any) => Promise.resolve(),
                update: (data: any) => Promise.resolve(),
                delete: () => Promise.resolve()
              }),
              where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
              get: () => Promise.resolve({ docs: [] }),
              limit: (n: number) => ({ get: () => Promise.resolve({ docs: [] }) })
            })
          }),
          where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
          get: () => Promise.resolve({ docs: [] }),
          limit: (n: number) => ({ get: () => Promise.resolve({ docs: [] }) })
        }),
        Timestamp: {
          now: () => ({
            toDate: () => new Date(),
            toMillis: () => Date.now(),
            toISOString: () => new Date().toISOString()
          })
        }
      }),
      auth: () => ({
        verifyIdToken: (token: string) => {
          // Accept mock tokens
          if (token === 'mock-token') {
            return Promise.resolve({
              uid: 'local-dev-user',
              email: 'mock@example.com',
              name: 'Mock User',
              iat: Date.now() / 1000,
              exp: (Date.now() / 1000) + 3600
            });
          }
          return Promise.reject(new Error("Invalid token"));
        },
        getUser: (uid: string) => Promise.resolve({
          uid: uid || 'local-dev-user',
          email: 'mock@example.com',
          displayName: 'Mock User',
          customClaims: { role: 'user' }
        }),
        setCustomUserClaims: (uid: string, claims: any) => {
          console.log('🔥 MOCK: setCustomUserClaims called for', uid, 'with claims:', claims);
          return Promise.resolve();
        }
      })
    } as any;
    return firebaseApp;
  }

  console.log("🔥 FIREBASE_PROJECT_ID =", projectId);
  console.log("🔥 FIREBASE_CLIENT_EMAIL =", clientEmail);
  console.log("🔥 FIREBASE_PRIVATE_KEY length =", privateKey.length);

  // Check if there's already a default app
  try {
    const existingApp = admin.app();
    console.log("🔥 EXISTING FIREBASE APP FOUND, projectId =", existingApp.options.projectId);
    firebaseApp = existingApp;
    return firebaseApp;
  } catch (e) {
    console.log("🔥 NO EXISTING FIREBASE APP, creating new one");
  }

  // Initialize with individual environment variables
  if (!admin.apps.length) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: projectId,
        clientEmail: clientEmail,
        privateKey: privateKey,
      }),
    });
  } else {
    firebaseApp = admin.app();
  }

  // Verify the app was initialized correctly
  console.log("🔥 FIREBASE ADMIN APP PROJECT ID =", firebaseApp.options.projectId);

  return firebaseApp;
}

export const firestore = () => getFirebaseAdmin().firestore();
export const firebaseAuth = () => getFirebaseAdmin().auth();

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return getFirebaseAdmin().auth().verifyIdToken(token);
}
