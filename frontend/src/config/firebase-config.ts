// Firebase Configuration using Modular SDK v9
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, Analytics } from 'firebase/analytics';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Check if Firebase environment variables are present and non-empty
const hasFirebaseEnvVars = () => {
  const requiredKeys = ['apiKey', 'authDomain', 'projectId'];
  return requiredKeys.every(key => {
    const value = firebaseConfig[key as keyof typeof firebaseConfig];
    return value && typeof value === 'string' && value.trim() !== '';
  });
};

// Check if we're in development mode
const isDevelopment = import.meta.env.MODE === 'development';

console.log('[FIREBASE] Initializing Firebase...');
console.log('  - Mode:', import.meta.env.MODE);
console.log('  - Has Firebase env vars:', hasFirebaseEnvVars());
console.log('  - Development:', isDevelopment);

// Initialize Firebase only if environment variables are present
let app: any = null;
let auth: any = null;
let db: any = null;
let analytics: Analytics | null = null;
let firebaseInitialized = false;

if (hasFirebaseEnvVars()) {
  try {
    console.log('[FIREBASE] Attempting to initialize with real Firebase config...');
    console.log('  - API Key present:', !!firebaseConfig.apiKey);
    console.log('  - Auth Domain present:', !!firebaseConfig.authDomain);
    console.log('  - Project ID present:', !!firebaseConfig.projectId);

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    firebaseInitialized = true;

    // Initialize Analytics in production only
    if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
      analytics = getAnalytics(app);
    }

    console.log('[FIREBASE] Successfully initialized with real Firebase');

    // Set up auth state listener to log user changes
    auth.onAuthStateChanged((user: any) => {
      if (user) {
        console.log('[FIREBASE] Real Firebase user active:', {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName
        });
      } else {
        console.log('[FIREBASE] Real Firebase: No active user');
      }
    });
  } catch (error) {
    console.error('[FIREBASE] Failed to initialize real Firebase:', error);
    console.log('[FIREBASE] This is unexpected - env vars present but initialization failed');
    // Reset to null so we use mock mode
    app = null;
    auth = null;
    db = null;
    analytics = null;
    firebaseInitialized = false;
  }
} else {
  console.log('[FIREBASE] No Firebase environment variables found, using mock mode');
}

// Use mock implementations if Firebase is not properly initialized
if (!firebaseInitialized) {
  console.log('[FIREBASE] Using mock Firebase mode');

  // Mock Firebase implementations
  const mockAuth = {
    currentUser: null, // Start with null to match real Firebase behavior
    onAuthStateChanged: (callback: (user: any) => void) => {
      // Don't call callback immediately - let components handle initial null state
      return () => {}; // unsubscribe function
    },
    signInWithEmailAndPassword: () => Promise.reject(new Error('Mock Firebase: Not implemented')),
    createUserWithEmailAndPassword: () => Promise.reject(new Error('Mock Firebase: Not implemented')),
    signOut: () => Promise.reject(new Error('Mock Firebase: Not implemented')),
    getIdToken: () => Promise.reject(new Error('Mock Firebase: Not implemented')),
    _isMockFirebase: true
  };

  const mockDb = {
    collection: () => ({
      doc: () => ({
        get: () => Promise.reject(new Error('Mock Firebase: Firestore not available')),
        set: () => Promise.reject(new Error('Mock Firebase: Firestore not available')),
        update: () => Promise.reject(new Error('Mock Firebase: Firestore not available')),
        delete: () => Promise.reject(new Error('Mock Firebase: Firestore not available'))
      }),
      get: () => Promise.reject(new Error('Mock Firebase: Firestore not available')),
      where: () => ({ get: () => Promise.reject(new Error('Mock Firebase: Firestore not available')) }),
      limit: () => ({ get: () => Promise.reject(new Error('Mock Firebase: Firestore not available')) })
    })
  };

  const mockApp = {
    name: '[MOCK]',
    options: { projectId: 'mock-project' }
  };

  app = mockApp;
  auth = mockAuth;
  db = mockDb;
  analytics = null;
}

// Export the initialized Firebase services
export { app, auth, db, analytics };

// Export helper functions for checking Firebase availability
export const isFirebaseAvailable = () => {
  return firebaseInitialized && auth && !auth._isMockFirebase;
};

export const isUsingMockFirebase = () => {
  return auth && auth._isMockFirebase === true;
};

export const isFirebaseReady = () => {
  return firebaseInitialized;
};

// Default export for backward compatibility
export default app;
