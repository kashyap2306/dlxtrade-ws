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

// Check if Firebase is properly configured
const isFirebaseConfigured = () => {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId
  );
};

// Check if we're in development mode
const isDevelopment = import.meta.env.MODE === 'development';

console.log('[FIREBASE] Initializing Firebase...');
console.log('  - Mode:', import.meta.env.MODE);
console.log('  - Configured:', isFirebaseConfigured());
console.log('  - Development:', isDevelopment);

// Initialize Firebase only if configured and not in mock mode
let app: any = null;
let auth: any = null;
let db: any = null;
let analytics: Analytics | null = null;

if (isFirebaseConfigured() && !isDevelopment) {
  try {
    console.log('[FIREBASE] Initializing with real Firebase config...');
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // Initialize Analytics in production only
    if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
      analytics = getAnalytics(app);
    }

    console.log('[FIREBASE] Successfully initialized with real Firebase');
  } catch (error) {
    console.error('[FIREBASE] Failed to initialize Firebase:', error);
    // Fallback to mock mode
    console.log('[FIREBASE] Falling back to mock mode due to initialization error');
  }
}

// If Firebase is not configured or we're in development, use mock implementations
if (!app || isDevelopment) {
  console.log('[FIREBASE] Using mock Firebase mode for development/local testing');

  // Mock Firebase implementations
  const mockAuth = {
    currentUser: {
      uid: 'local-dev-user',
      email: 'mock@example.com',
      displayName: 'Mock User',
      getIdToken: () => Promise.resolve('mock-token')
    },
    onAuthStateChanged: (callback: (user: any) => void) => {
      // Immediately call with mock user
      setTimeout(() => callback(mockAuth.currentUser), 100);
      return () => {}; // unsubscribe function
    },
    signInWithEmailAndPassword: () => Promise.resolve({ user: mockAuth.currentUser }),
    createUserWithEmailAndPassword: () => Promise.resolve({ user: mockAuth.currentUser }),
    signOut: () => Promise.resolve(),
    getIdToken: () => Promise.resolve('mock-token'),
    _isMockFirebase: true
  };

  const mockDb = {
    collection: () => ({
      doc: () => ({
        get: () => Promise.resolve({ exists: true, data: () => ({}) }),
        set: () => Promise.resolve(),
        update: () => Promise.resolve(),
        delete: () => Promise.resolve()
      }),
      get: () => Promise.resolve({ docs: [], empty: true }),
      where: () => ({ get: () => Promise.resolve({ docs: [] }) }),
      limit: () => ({ get: () => Promise.resolve({ docs: [] }) })
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
  return app && auth && db && !auth._isMockFirebase;
};

export const isUsingMockFirebase = () => {
  return auth && auth._isMockFirebase === true;
};

// Default export for backward compatibility
export default app;
