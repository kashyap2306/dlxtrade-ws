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
}) : (function(o, v) {
    o["default"] = v;
}));
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
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
exports.initializeFirestoreCollections = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("./firebase");
const logger_1 = require("./logger");
const REQUIRED_COLLECTIONS = [
    "users",
    "agents",
    "agentUnlocks",
    "uiPreferences",
    "activityLogs",
    "hftLogs",
    "engineStatus",
    "trades",
    "notifications",
    "globalStats",
    "apiKeys",
    "admin",
    "logs",
    "settings",
];
async function collectionExists(db, collectionName) {
    try {
        const snapshot = await db.collection(collectionName).limit(100).get();
        const validDocs = snapshot.docs.filter(doc => !doc.id.startsWith("__"));
        return validDocs.length > 0;
    }
    catch (error) {
        if (error.code === "not-found" || error.code === 5) {
            return false;
        }
        logger_1.logger.warn({ error: error.message, collectionName }, "Error checking collection existence, assuming it does not exist");
        return false;
    }
}
async function initializeCollection(db, collectionName) {
    try {
        console.log("Checking collection:", collectionName);
        const exists = await collectionExists(db, collectionName);
        if (exists) {
            logger_1.logger.debug({ collectionName }, "Collection already exists");
            console.log(`Collection ${collectionName} already exists`);
            return false;
        }
        logger_1.logger.info({ collectionName }, "Collection will be created when first document is added");
        console.log(`Collection ${collectionName} will be created when first document is added`);
        return false;
    }
    catch (error) {
        console.error(`INIT ERROR (Collection ${collectionName}):`, error);
        logger_1.logger.error({ error: error.message, collectionName }, "Error checking collection");
        throw error;
    }
}
async function initializeFirestoreCollections() {
    try {
        if (process.env.NODE_ENV === "production") {
            console.log("?? Skipping Firestore collection initialization in production");
            logger_1.logger.info("Skipping Firestore collection initialization in production");
            return;
        }
        console.log("?? Starting Firestore collection initialization...");
        const firebaseAdmin = (0, firebase_1.getFirebaseAdmin)();
        const db = firebaseAdmin.firestore();
        logger_1.logger.info("Starting Firestore collection initialization...");
        console.log(`Total collections to initialize: ${REQUIRED_COLLECTIONS.length}`);
        const results = await Promise.allSettled(REQUIRED_COLLECTIONS.map(async (collectionName) => {
            try {
                console.log(`Checking collection: ${collectionName}`);
                const exists = await collectionExists(db, collectionName);
                if (!exists) {
                    console.log(`Collection ${collectionName} does not exist - skipping creation in production-safe mode`);
                    return { collectionName, initialized: false };
                }
                console.log(`Collection ${collectionName} already exists`);
                return { collectionName, initialized: false };
            }
            catch (error) {
                console.error(`INIT ERROR (Processing ${collectionName}):`, error);
                throw error;
            }
        }));
        const initialized = [];
        const alreadyExists = [];
        const errors = [];
        results.forEach((result, index) => {
            const collectionName = REQUIRED_COLLECTIONS[index];
            if (result.status === "fulfilled") {
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
                    error: result.reason?.message || "Unknown error",
                });
            }
        });
        if (initialized.length > 0) {
            logger_1.logger.info({ collections: initialized }, `Initialized ${initialized.length} new collection(s)`);
        }
        if (alreadyExists.length > 0) {
            logger_1.logger.debug({ collections: alreadyExists }, `${alreadyExists.length} collection(s) already exist`);
        }
        if (errors.length > 0) {
            logger_1.logger.error({ errors }, `Failed to initialize ${errors.length} collection(s)`);
        }
        logger_1.logger.info({
            total: REQUIRED_COLLECTIONS.length,
            initialized: initialized.length,
            existing: alreadyExists.length,
            errors: errors.length,
        }, "Firestore collection initialization completed");
        console.log("?? Firestore initialization complete");
        console.log(`Summary: ${initialized.length} initialized, ${alreadyExists.length} existing, ${errors.length} errors`);
    }
    catch (error) {
        console.error("INIT ERROR (Critical):", error);
        logger_1.logger.error({ error: error.message, stack: error.stack }, "Critical error during Firestore collection initialization");
    }
}
exports.initializeFirestoreCollections = initializeFirestoreCollections;
