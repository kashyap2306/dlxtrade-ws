/**
 * Route Guards - Fail-fast protection for API endpoints
 * 
 * Ensures ALL API endpoints respond within 2s even if:
 * - Firestore hangs
 * - Singletons block
 * - External calls timeout
 */

import { FastifyReply } from 'fastify';
import { logger } from './logger';

// Hard timeout for route handlers (2 seconds)
const ROUTE_TIMEOUT_MS = 2000;

// Firestore operation timeout (2 seconds)
const FIRESTORE_TIMEOUT_MS = 2000;

/**
 * Wrap a route handler with a hard timeout
 * Returns fail-fast JSON response if timeout exceeded
 */
export async function withRouteTimeout<T>(
  routeName: string,
  handler: () => Promise<T>,
  reply: FastifyReply,
  timeoutMs: number = ROUTE_TIMEOUT_MS
): Promise<T | null> {
  console.log(`[ROUTE_ENTER] ${routeName}`);
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      handler(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Route timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    console.log(`[ROUTE_EXIT] ${routeName} (${Date.now() - startTime}ms)`);
    return result;
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.log(`[ROUTE_TIMEOUT] ${routeName} (${duration}ms): ${err.message}`);
    logger.warn({ routeName, duration, error: err.message }, 'Route timeout guard triggered');

    // Send fail-fast response
    if (!reply.sent) {
      reply.code(503).send({
        ok: false,
        reason: 'timeout_guard',
        route: routeName,
        duration: duration,
        message: `Request exceeded ${timeoutMs}ms timeout`,
      });
    }
    return null;
  }
}

/**
 * Wrap a Firestore read with timeout
 * Returns default value if timeout exceeded
 */
export async function firestoreReadWithTimeout<T>(
  operation: () => Promise<T>,
  defaultValue: T,
  operationName: string,
  timeoutMs: number = FIRESTORE_TIMEOUT_MS
): Promise<T> {
  console.log(`[FIRESTORE_ENTER] ${operationName}`);
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      operation(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Firestore timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    console.log(`[FIRESTORE_EXIT] ${operationName} (${Date.now() - startTime}ms)`);
    return result;
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.log(`[FIRESTORE_TIMEOUT] ${operationName} (${duration}ms): ${err.message}`);
    logger.warn({ operationName, duration, error: err.message }, 'Firestore timeout - returning default');
    return defaultValue;
  }
}

/**
 * Safe Firestore document get with timeout
 */
export async function safeFirestoreGet(
  docRef: FirebaseFirestore.DocumentReference,
  operationName: string
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  return firestoreReadWithTimeout(
    () => docRef.get(),
    null as any,
    operationName
  );
}

/**
 * Safe Firestore collection query with timeout
 */
export async function safeFirestoreQuery<T extends FirebaseFirestore.Query>(
  query: T,
  operationName: string
): Promise<FirebaseFirestore.QuerySnapshot | null> {
  return firestoreReadWithTimeout(
    () => query.get(),
    null as any,
    operationName
  );
}

/**
 * Helper to check if route should fail-fast
 * Call at the start of route handlers
 */
export function routeEntryLog(routeName: string): number {
  console.log(`[ROUTE_ENTER] ${routeName} at ${new Date().toISOString()}`);
  return Date.now();
}

/**
 * Helper to log route exit
 */
export function routeExitLog(routeName: string, startTime: number): void {
  const duration = Date.now() - startTime;
  console.log(`[ROUTE_EXIT] ${routeName} (${duration}ms)`);
}

// Export timeout values for customization
export const TIMEOUTS = {
  ROUTE: ROUTE_TIMEOUT_MS,
  FIRESTORE: FIRESTORE_TIMEOUT_MS,
};

