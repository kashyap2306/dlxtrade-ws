<<<<<<< HEAD
// Re-export from the proper Firebase configuration
export { app, auth, db, analytics, isFirebaseAvailable, isUsingMockFirebase } from './firebase-config';

// Default export for backward compatibility
export { default } from './firebase-config';
=======
// Force MOCK MODE for local development
console.log('🔥 FRONTEND: Using LOCAL MOCK FIREBASE MODE');

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
  getIdToken: () => Promise.resolve('mock-token')
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

// Export mock implementations
export const auth = mockAuth;
export const db = mockDb;
export const app = mockApp;
export const analytics = null; // No analytics in mock mode

export default app;
>>>>>>> 1155e8a13d2107df42fd79541eae28eca41a1947

