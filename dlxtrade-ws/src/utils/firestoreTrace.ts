
import * as admin from 'firebase-admin';

/**
 * DEPRECATED: Monkey patching removed due to runtime persistence issues
 *
 * Firestore prototype patching is irreversible per Node.js process and incompatible
 * with development hot reload. Replaced with explicit service-level validation.
 *
 * Security is now enforced in exchange.ts at the service layer before any writes.
 */
export function enableFirestoreTracing() {
    console.log('🔧 [FIRESTORE_TRACE] DISABLED - Monkey patching removed for runtime safety');
    console.log('🔧 [FIRESTORE_TRACE] Security now enforced at service layer in exchange.ts');

    // No-op: Prototype patching removed
}
