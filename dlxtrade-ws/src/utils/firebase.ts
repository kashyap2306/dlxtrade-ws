import admin from "firebase-admin";

let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;

  // Use individual environment variables instead of JSON
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase environment variables:");
    console.error("- FIREBASE_PROJECT_ID:", !!projectId);
    console.error("- FIREBASE_CLIENT_EMAIL:", !!clientEmail);
    console.error("- FIREBASE_PRIVATE_KEY:", !!privateKey);

    // Return a dummy app instead of throwing - server should continue
    let createdDocs = new Set<string>();

    firebaseApp = {
      firestore: () => ({
        listCollections: () => Promise.resolve([]),
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
