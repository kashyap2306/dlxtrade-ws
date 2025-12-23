/**
 * IMPORTANT:
 * These exports are required app-wide: isFirebaseAvailable, isFirebaseReady, getAuthToken.
 * They are used dynamically by axios, WS, and multiple components.
 * DO NOT remove or rename. If you must change them, update barrel export and run `npm run check:firebase-exports`.
 */

export {
  app,
  auth,
  db,
  analytics,
  isFirebaseAvailable,
  isFirebaseReady,
  isUsingMockFirebase
} from "./firebase-config";

export { getAuthToken } from "./firebase-utils";

