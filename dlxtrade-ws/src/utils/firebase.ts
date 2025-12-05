import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  const serviceAccountJSON = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJSON) {
    console.error("FIREBASE_SERVICE_ACCOUNT env variable missing - Firebase Admin will not work");
    // Return a dummy app instead of throwing - server should continue
    let createdDocs = new Set<string>();

    firebaseApp = {
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => {
            const docPath = `${name}/${id}`;
            const docRef = {
              get: () => Promise.resolve({
                exists: createdDocs.has(docPath),
                data: () => null,
                id
              }),
              set: (data: any) => {
                createdDocs.add(docPath);
                return Promise.resolve();
              },
              update: (data: any) => Promise.resolve(),
              delete: () => {
                createdDocs.delete(docPath);
                return Promise.resolve();
              },
              collection: (subName: string) => ({
                doc: (subId: string) => {
                  const subDocPath = `${docPath}/${subName}/${subId}`;
                  return {
                    get: () => Promise.resolve({
                      exists: createdDocs.has(subDocPath),
                      data: () => null,
                      id: subId
                    }),
                    set: (data: any) => {
                      createdDocs.add(subDocPath);
                      return Promise.resolve();
                    },
                    update: (data: any) => Promise.resolve(),
                    delete: () => {
                      createdDocs.delete(subDocPath);
                      return Promise.resolve();
                    }
                  };
                },
                where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
                get: () => Promise.resolve({ docs: [] })
              })
            };
            return docRef;
          },
          where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
          get: () => Promise.resolve({ docs: [] })
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
        verifyIdToken: () => Promise.reject(new Error("Firebase not configured")),
        getUser: () => Promise.reject(new Error("Firebase not configured"))
      })
    } as any;
    return firebaseApp;
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  console.log("🔥 FIREBASE SERVICE ACCOUNT project_id =", serviceAccount.project_id);
  console.log("🔥 FIREBASE SERVICE ACCOUNT type =", serviceAccount.type);
  console.log("🔥 FIREBASE SERVICE ACCOUNT full keys =", Object.keys(serviceAccount));

  // Check for conflicting environment variables
  console.log("🔥 GCLOUD_PROJECT =", process.env.GCLOUD_PROJECT);
  console.log("🔥 FIREBASE_CONFIG =", process.env.FIREBASE_CONFIG);
  console.log("🔥 GOOGLE_APPLICATION_CREDENTIALS =", process.env.GOOGLE_APPLICATION_CREDENTIALS);

  // Ensure we have a valid project_id
  const projectId = serviceAccount.project_id || 'dlx-trading';
  console.log("🔥 USING PROJECT ID =", projectId);

  // Check if there's already a default app
  try {
    const existingApp = admin.app();
    console.log("🔥 EXISTING FIREBASE APP FOUND, projectId =", existingApp.options.projectId);
    firebaseApp = existingApp;
    return firebaseApp;
  } catch (e) {
    console.log("🔥 NO EXISTING FIREBASE APP, creating new one");
  }

  // Initialize with explicit projectId
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: projectId,
  });

  // Verify the app was initialized correctly
  console.log("🔥 FIREBASE ADMIN APP PROJECT ID =", firebaseApp.options.projectId);

  return firebaseApp;
}

export const firestore = () => getFirebaseAdmin().firestore();
export const firebaseAuth = () => getFirebaseAdmin().auth();

export async function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken> {
  return getFirebaseAdmin().auth().verifyIdToken(token);
}
