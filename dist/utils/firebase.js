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
exports.initializeFirebaseAdmin = initializeFirebaseAdmin;
exports.verifyFirebaseToken = verifyFirebaseToken;
exports.getFirebaseAdmin = getFirebaseAdmin;
exports.performForcedTestWrite = performForcedTestWrite;
const admin = __importStar(require("firebase-admin"));
const logger_1 = require("./logger");
let firebaseAdmin = null;
function initializeFirebaseAdmin() {
    if (firebaseAdmin) {
        return;
    }
    try {
        const raw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
        if (!raw) {
            const error = new Error('FIREBASE_SERVICE_ACCOUNT env var is required to initialize Firebase Admin');
            logger_1.logger.warn({ error: error.message }, 'Firebase Admin initialization skipped - missing service account');
            // Don't throw - allow server to continue without Firebase (for development/testing)
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Failed to parse FIREBASE_SERVICE_ACCOUNT JSON');
            // Don't throw - allow server to continue
            return;
        }
        // Fix private_key: replace literal \n with actual newlines (Render env vars escape them)
        if (parsed.private_key && typeof parsed.private_key === 'string') {
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        // Extract projectId from service account or env
        const projectId = parsed.project_id ||
            process.env.FIREBASE_PROJECT_ID ||
            parsed.projectId;
        if (!projectId) {
            logger_1.logger.warn('Firebase projectId could not be determined - Firebase Admin will not be initialized');
            // Don't throw - allow server to continue
            return;
        }
        // Initialize Firebase Admin with explicit credential and projectId
        const app = admin.initializeApp({
            credential: admin.credential.cert({
                projectId: parsed.project_id || projectId,
                clientEmail: parsed.client_email || process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: parsed.private_key || process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
            projectId,
        });
        // Configure Firestore with minimal settings (ignore undefined, disable telemetry)
        const firestore = app.firestore();
        firestore.settings({
            ignoreUndefinedProperties: true,
            // Disable telemetry
            experimentalForceLongPolling: false,
        });
        firebaseAdmin = app;
        logger_1.logger.info({ projectId }, 'Firebase Admin initialized with service account from environment');
    }
    catch (error) {
        // Log error but don't throw - allow server to start even if Firebase fails
        logger_1.logger.error({ error: error.message, stack: error.stack }, 'Error initializing Firebase Admin - server will continue without Firebase');
    }
}
async function verifyFirebaseToken(token) {
    if (!firebaseAdmin) {
        initializeFirebaseAdmin();
    }
    return admin.auth().verifyIdToken(token);
}
function getFirebaseAdmin() {
    if (!firebaseAdmin) {
        initializeFirebaseAdmin();
    }
    return firebaseAdmin;
}
/**
 * Performs a simple Firestore write to verify Admin SDK connectivity.
 * This is intentionally minimal and not part of business logic.
 */
async function performForcedTestWrite() {
    if (!firebaseAdmin) {
        initializeFirebaseAdmin();
    }
    // If Firebase Admin still not initialized, skip test write
    if (!firebaseAdmin) {
        logger_1.logger.warn('Skipping Firebase test write - Firebase Admin not initialized');
        return;
    }
    try {
        const db = getFirebaseAdmin().firestore();
        const docRef = db.collection('system').doc('_admin_init_check');
        await docRef.set({
            ok: true,
            checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    catch (error) {
        // Handle "Unable to detect a Project Id" and other auth errors gracefully
        if (error.message?.includes('Unable to detect') || error.message?.includes('project id') || error.code === 'auth/') {
            logger_1.logger.warn({ error: error.message }, 'Firebase test write failed - project ID or auth issue (non-fatal)');
        }
        else {
            logger_1.logger.error({ error: error.message, stack: error.stack }, 'Firebase test write failed');
        }
        // Don't throw - allow server to continue
    }
}
