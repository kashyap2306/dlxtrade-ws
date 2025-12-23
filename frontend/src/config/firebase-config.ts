import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey) {
  console.error("[FIREBASE] ❌ Critical: Firebase configuration missing or invalid");
  throw new Error("Firebase configuration missing or invalid. Check your .env file.");
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = null; // Not using analytics for now

// Compatibility helper functions
export const isFirebaseAvailable = () => {
  try {
    return !!app && !!auth;
  } catch {
    return false;
  }
};

export const isFirebaseReady = () => {
  return Boolean(app?.name === "[DEFAULT]");
};

export const isUsingMockFirebase = () => false;
