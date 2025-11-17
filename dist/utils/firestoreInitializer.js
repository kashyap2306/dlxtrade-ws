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
exports.initializeFirestoreCollections = initializeFirestoreCollections;
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("./firebase");
const logger_1 = require("./logger");
/**
 * List of required Firestore collections that must exist
 */
const REQUIRED_COLLECTIONS = [
    'users',
    'agents',
    'agentUnlocks',
    'uiPreferences',
    'activityLogs',
    'hftLogs',
    'engineStatus',
    'trades',
    'notifications',
    'globalStats',
    'apiKeys',
    'admin',
    'logs',
    'settings',
];
/**
 * Initializer document ID - using a special prefix to avoid conflicts
 */
const INITIALIZER_DOC_ID = '__initializer__';
/**
 * Checks if a collection exists by attempting to read a document.
 * In Firestore, a collection doesn't exist until it has at least one document.
 *
 * @param db Firestore instance
 * @param collectionName Name of the collection to check
 * @returns true if collection exists (has at least one document), false otherwise
 */
async function collectionExists(db, collectionName) {
    try {
        // Try to get the initializer document first (fastest check)
        const initDoc = await db.collection(collectionName).doc(INITIALIZER_DOC_ID).get();
        if (initDoc.exists) {
            return true;
        }
        // If initializer doc doesn't exist, check if collection has any documents
        // Use limit(1) to minimize reads
        const snapshot = await db.collection(collectionName).limit(1).get();
        return !snapshot.empty;
    }
    catch (error) {
        // If collection doesn't exist, Firestore may throw an error
        // Log and return false to be safe
        if (error.code === 'not-found' || error.code === 5) {
            return false;
        }
        // For other errors, log and assume collection doesn't exist
        logger_1.logger.warn({ error: error.message, collectionName }, 'Error checking collection existence, assuming it does not exist');
        return false;
    }
}
/**
 * Creates an initializer document in a collection if it doesn't exist.
 * This ensures the collection is created in Firestore.
 *
 * @param db Firestore instance
 * @param collectionName Name of the collection to initialize
 * @returns true if document was created, false if it already existed
 */
async function initializeCollection(db, collectionName) {
    try {
        console.log('Running initializer for:', collectionName);
        const docRef = db.collection(collectionName).doc(INITIALIZER_DOC_ID);
        const doc = await docRef.get();
        if (doc.exists) {
            logger_1.logger.debug({ collectionName }, 'Collection already initialized');
            console.log(`Collection ${collectionName} already has initializer document`);
            return false;
        }
        // Create initializer document
        const initializerDoc = {
            initialized: true,
            createdAt: admin.firestore.Timestamp.now(),
            purpose: 'Collection initializer - safe to delete if collection has other documents',
        };
        await docRef.set(initializerDoc);
        logger_1.logger.info({ collectionName }, 'Collection initialized with placeholder document');
        console.log(`✅ Successfully initialized collection: ${collectionName}`);
        return true;
    }
    catch (error) {
        console.error(`INIT ERROR (Collection ${collectionName}):`, error);
        logger_1.logger.error({ error: error.message, collectionName }, 'Error initializing collection');
        throw error;
    }
}
/**
 * Initializes all required Firestore collections.
 * This function is idempotent and safe to call multiple times.
 *
 * @returns Promise that resolves when all collections are initialized
 */
async function initializeFirestoreCollections() {
    try {
        console.log('🔥 Starting Firestore collection initialization...');
        const firebaseAdmin = (0, firebase_1.getFirebaseAdmin)();
        const db = firebaseAdmin.firestore();
        logger_1.logger.info('Starting Firestore collection initialization...');
        console.log(`Total collections to initialize: ${REQUIRED_COLLECTIONS.length}`);
        const results = await Promise.allSettled(REQUIRED_COLLECTIONS.map(async (collectionName) => {
            try {
                console.log(`Checking collection: ${collectionName}`);
                const exists = await collectionExists(db, collectionName);
                if (!exists) {
                    console.log(`Collection ${collectionName} does not exist, creating...`);
                    await initializeCollection(db, collectionName);
                    return { collectionName, initialized: true };
                }
                console.log(`Collection ${collectionName} already exists`);
                return { collectionName, initialized: false };
            }
            catch (error) {
                console.error(`INIT ERROR (Processing ${collectionName}):`, error);
                throw error;
            }
        }));
        // Log results
        const initialized = [];
        const alreadyExists = [];
        const errors = [];
        results.forEach((result, index) => {
            const collectionName = REQUIRED_COLLECTIONS[index];
            if (result.status === 'fulfilled') {
                if (result.value.initialized) {
                    initialized.push(collectionName);
                }
                else {
                    alreadyExists.push(collectionName);
                }
            }
            else {
                errors.push({
                    collection: collectionName,
                    error: result.reason?.message || 'Unknown error',
                });
            }
        });
        // Log summary
        if (initialized.length > 0) {
            logger_1.logger.info({ collections: initialized }, `Initialized ${initialized.length} new collection(s)`);
        }
        if (alreadyExists.length > 0) {
            logger_1.logger.debug({ collections: alreadyExists }, `${alreadyExists.length} collection(s) already exist`);
        }
        if (errors.length > 0) {
            logger_1.logger.error({ errors }, `Failed to initialize ${errors.length} collection(s)`);
            // Don't throw - allow server to start even if some collections fail
            // This ensures production stability
        }
        logger_1.logger.info({
            total: REQUIRED_COLLECTIONS.length,
            initialized: initialized.length,
            existing: alreadyExists.length,
            errors: errors.length,
        }, 'Firestore collection initialization completed');
        // Log completion message as requested
        console.log('🔥 Firestore initialization complete');
        console.log(`Summary: ${initialized.length} initialized, ${alreadyExists.length} existing, ${errors.length} errors`);
    }
    catch (error) {
        // Log error but don't throw - allow server to start
        // This ensures production stability
        console.error('INIT ERROR (Critical):', error);
        logger_1.logger.error({ error: error.message, stack: error.stack }, 'Critical error during Firestore collection initialization');
    }
}
