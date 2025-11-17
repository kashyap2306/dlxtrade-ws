"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const zod_1 = require("zod");
const logger_1 = require("../utils/logger");
const firebase_1 = require("../utils/firebase");
const userOnboarding_1 = require("../services/userOnboarding");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const afterSignInSchema = zod_1.z.object({
    idToken: zod_1.z.string().optional(),
    uid: zod_1.z.string().optional(),
});
/**
 * Auth routes - handles user signup/login onboarding
 * All user document creation happens on backend only
 */
async function authRoutes(fastify) {
    // POST /api/auth/afterSignIn - Called by frontend after successful Firebase Auth sign-in
    // Backend verifies idToken and runs idempotent user onboarding
    fastify.post('/afterSignIn', async (request, reply) => {
        try {
            const body = afterSignInSchema.parse(request.body);
            let uid;
            let email;
            let name;
            if (body.idToken) {
                // Verify Firebase ID token
                try {
                    const decodedToken = await (0, firebase_1.verifyFirebaseToken)(body.idToken);
                    uid = decodedToken.uid;
                    email = decodedToken.email;
                    name = decodedToken.name || decodedToken.display_name;
                    logger_1.logger.info({ uid, email }, 'Firebase token verified');
                }
                catch (error) {
                    logger_1.logger.error({ error: error.message }, 'Firebase token verification failed');
                    return reply.code(401).send({
                        error: 'Invalid or expired token',
                        details: error.message
                    });
                }
            }
            else if (body.uid) {
                // If uid provided directly (for testing/backfill)
                uid = body.uid;
                // Try to get user from Firebase Auth
                try {
                    const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
                    const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
                    const userRecord = await admin.auth(getFirebaseAdmin()).getUser(uid);
                    email = userRecord.email;
                    name = userRecord.displayName || undefined;
                }
                catch (error) {
                    logger_1.logger.warn({ uid }, 'Could not fetch user from Firebase Auth, continuing with uid only');
                }
            }
            else {
                return reply.code(400).send({
                    error: 'Either idToken or uid must be provided'
                });
            }
            // Run idempotent user onboarding
            const result = await (0, userOnboarding_1.ensureUser)(uid, {
                name,
                email,
                phone: null,
            });
            if (!result.success) {
                logger_1.logger.error({ uid, error: result.error }, 'User onboarding failed');
                return reply.code(500).send({
                    error: 'User onboarding failed',
                    details: result.error
                });
            }
            // Get full user document to return
            const userDoc = await firestoreAdapter_1.firestoreAdapter.getUser(uid);
            if (!userDoc) {
                logger_1.logger.error({ uid }, 'User document not found after onboarding');
                return reply.code(500).send({
                    error: 'User document not found after onboarding'
                });
            }
            // Convert timestamps for JSON response
            const response = { ...userDoc };
            if (response.createdAt) {
                response.createdAt = response.createdAt.toDate().toISOString();
            }
            if (response.updatedAt) {
                response.updatedAt = response.updatedAt.toDate().toISOString();
            }
            if (response.lastLogin) {
                response.lastLogin = response.lastLogin.toDate().toISOString();
            }
            logger_1.logger.info({
                uid,
                createdNew: result.createdNew,
                email
            }, '✅ User onboarding completed, returning user document');
            return {
                success: true,
                createdNew: result.createdNew,
                user: response,
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({
                    error: 'Invalid request body',
                    details: err.errors
                });
            }
            logger_1.logger.error({ err }, 'Error in afterSignIn endpoint');
            return reply.code(500).send({
                error: err.message || 'Internal server error'
            });
        }
    });
    // Health check endpoint to verify Firebase auth is working
    fastify.get('/verify', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        logger_1.logger.info({ uid: user.uid, email: user.email }, 'Firebase auth verified');
        return {
            authenticated: true,
            user: {
                uid: user.uid,
                email: user.email,
            },
        };
    });
}
