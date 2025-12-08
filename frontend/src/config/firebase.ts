// Re-export from the proper Firebase configuration
export { app, auth, db, analytics, isFirebaseAvailable, isUsingMockFirebase } from './firebase-config';

// Default export for backward compatibility
export { default } from './firebase-config';

