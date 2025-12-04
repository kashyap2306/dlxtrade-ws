import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  const serviceAccountJSON = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJSON) {
    console.error("FIREBASE_SERVICE_ACCOUNT env variable missing - Firebase Admin will not work");
    // Return a dummy app instead of throwing - server should continue
    firebaseApp = {
      firestore: () => ({ collection: () => ({}) }),
      auth: () => ({ verifyIdToken: () => Promise.reject(new Error("Firebase not configured")) })
    } as any;
    return firebaseApp;
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  console.log("CHECK SERVICE ACCOUNT:", serviceAccount);
  console.log("DEBUG project_id =", serviceAccount.project_id);

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return firebaseApp;
}

export const firestore = () => getFirebaseAdmin().firestore();
export const firebaseAuth = () => getFirebaseAdmin().auth();

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return getFirebaseAdmin().auth().verifyIdToken(token);
}
