import * as admin from "firebase-admin";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

let privateKey = process.env.FIREBASE_PRIVATE_KEY;

console.log("[FIREBASE_DEBUG] ENV projectId:", projectId);
console.log("[FIREBASE_DEBUG] ENV clientEmail exists:", !!clientEmail);
console.log("[FIREBASE_DEBUG] ENV privateKey length:", privateKey?.length || 0);
console.log("[FIREBASE_DEBUG] GOOGLE_APPLICATION_CREDENTIALS:", serviceAccountPath || "not set");

// remove accidental surrounding quotes
if (privateKey?.startsWith('"') && privateKey?.endsWith('"')) {
  privateKey = privateKey.slice(1, -1);
}

// fallback to JSON service account
if ((!projectId || !clientEmail || !privateKey) && process.env.FIREBASE_SERVICE_ACCOUNT) {
  const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  console.log("[FIREBASE_DEBUG] Loaded FIREBASE_SERVICE_ACCOUNT JSON");
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
      console.log("[FIREBASE_DEBUG] Using FIREBASE_SERVICE_ACCOUNT from env");
      privateKey = json.private_key;
    }
  }

  if (!projectId || !clientEmail || !privateKey) {
    console.error("FIREBASE ENV VARS MISSING – BACKEND CANNOT RUN");
    console.error("- FIREBASE_PROJECT_ID:", !!projectId);
    console.error("- FIREBASE_CLIENT_EMAIL:", !!clientEmail);
    console.error("- FIREBASE_PRIVATE_KEY:", !!privateKey);
    throw new Error("FIREBASE ENV VARS MISSING – BACKEND CANNOT RUN");
  }

  console.log("🔥 FIREBASE_PROJECT_ID =", projectId);
  console.log("🔥 FIREBASE_CLIENT_EMAIL =", clientEmail);
  console.log("🔥 FIREBASE_PRIVATE_KEY length =", privateKey.length);
  console.log(`🔥 Using REAL FIREBASE project: ${projectId}`);
  console.log("[FIREBASE_DEBUG] privateKey has literal \\n:", privateKey.includes("\\n"));

  // Check if there's already a default app
  try {
    const existingApp = admin.app();
    console.log("🔥 EXISTING FIREBASE APP FOUND, projectId =", existingApp.options.projectId);
    firebaseApp = existingApp;
    return firebaseApp;
  } catch (e) {
    console.log("🔥 NO EXISTING FIREBASE APP, creating new one");
  }

  const serviceAccount = {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  };

  if (!serviceAccount.project_id) {
    console.error("[FIREBASE_DEBUG] serviceAccount.project_id missing");
    throw new Error("FIREBASE serviceAccount.project_id missing");
  }
  console.log("[FIREBASE_DEBUG] serviceAccount.project_id:", serviceAccount.project_id);
  console.log("[FIREBASE_DEBUG] serviceAccount.client_email exists:", !!serviceAccount.client_email);
  console.log("[FIREBASE_DEBUG] serviceAccount.private_key length:", serviceAccount.private_key?.length || 0);

  // Initialize with individual environment variables
  if (!admin.apps.length) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as unknown as admin.ServiceAccount),
      projectId: serviceAccount.project_id,
    });
  } else {
    firebaseApp = admin.app();
  }

  // Verify the app was initialized correctly
  console.log("🔥 FIREBASE ADMIN APP PROJECT ID =", firebaseApp.options.projectId);
  console.log("[FIREBASE_DEBUG] firebaseApp.options:", firebaseApp.options);

  return firebaseApp;
}

export const firestore = () => getFirebaseAdmin().firestore();
export const firebaseAuth = () => getFirebaseAdmin().auth();

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return getFirebaseAdmin().auth().verifyIdToken(token);
}
