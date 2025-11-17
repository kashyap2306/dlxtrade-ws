import * as admin from 'firebase-admin';
export declare function initializeFirebaseAdmin(): void;
export declare function verifyFirebaseToken(token: string): Promise<admin.auth.DecodedIdToken>;
export declare function getFirebaseAdmin(): admin.app.App;
/**
 * Performs a simple Firestore write to verify Admin SDK connectivity.
 * This is intentionally minimal and not part of business logic.
 */
export declare function performForcedTestWrite(): Promise<void>;
//# sourceMappingURL=firebase.d.ts.map