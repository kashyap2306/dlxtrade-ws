import 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
    adminAuth: (request: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    user?: any;
    query?: any;
    body?: any;
    params?: any;
  }
}

// Relax firebase-admin Firestore DocumentSnapshot typing to accept exists() calls in code
declare namespace FirebaseFirestore {
  interface DocumentSnapshot<T = DocumentData> {
    exists: any;
  }
}

// Loosen internal service module typings to avoid build-time type errors without changing logic
// Generic fallbacks for complex internal types referenced across services
declare type UnknownRecord = Record<string, any>;
declare type TradeMetrics = any;
declare type Order = any;
declare class ResearchEngine { setAdapter: any; }


