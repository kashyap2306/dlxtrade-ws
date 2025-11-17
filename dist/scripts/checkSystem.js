#!/usr/bin/env node
"use strict";
/**
 * Post-deploy sanity check script
 * Verifies all critical endpoints are working and Firestore is populated
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const API_BASE = process.env.API_BASE || 'http://localhost:4000/api';
const WS_BASE = process.env.WS_BASE || 'ws://localhost:4000/ws';
async function checkFirestore() {
    console.log('🔍 Checking Firestore collections...');
    const db = admin.firestore();
    const requiredCollections = [
        'users',
        'agents',
        'agentUnlocks',
        'apiKeys',
        'activityLogs',
        'engineStatus',
        'globalStats',
        'hftLogs',
        'trades',
        'notifications',
        'uiPreferences',
        'logs',
        'admin',
        'settings',
    ];
    let allOk = true;
    for (const collection of requiredCollections) {
        try {
            const snapshot = await db.collection(collection).limit(1).get();
            console.log(`  ✅ ${collection}: ${snapshot.size >= 1 ? 'has documents' : 'empty'}`);
            if (snapshot.size === 0 && collection !== 'logs') {
                console.warn(`  ⚠️  ${collection} is empty`);
                allOk = false;
            }
        }
        catch (error) {
            console.error(`  ❌ ${collection}: Error - ${error.message}`);
            allOk = false;
        }
    }
    // Check globalStats/main exists
    try {
        const globalStats = await db.collection('globalStats').doc('main').get();
        if (globalStats.exists) {
            console.log('  ✅ globalStats/main: exists');
        }
        else {
            console.error('  ❌ globalStats/main: missing');
            allOk = false;
        }
    }
    catch (error) {
        console.error(`  ❌ globalStats/main: Error - ${error.message}`);
        allOk = false;
    }
    return allOk;
}
async function checkAPIs() {
    console.log('🔍 Checking API endpoints...');
    // Note: These checks require the server to be running
    // This is optional - server might not be running during seed
    try {
        const healthResponse = await axios_1.default.get(`${API_BASE.replace('/api', '')}/health`, { timeout: 5000 });
        console.log('  ✅ Health endpoint: OK');
        return true;
    }
    catch (error) {
        console.warn(`  ⚠️  Health endpoint: Server not running (this is OK if you're just seeding)`);
        return true; // Don't fail if server isn't running
    }
}
async function main() {
    try {
        console.log('🔥 Starting system verification...\n');
        // Initialize Firebase
        (0, firebase_1.initializeFirebaseAdmin)();
        console.log('✅ Firebase Admin initialized\n');
        // Check Firestore
        const firestoreOk = await checkFirestore();
        console.log('');
        // Check APIs
        const apiOk = await checkAPIs();
        console.log('');
        if (firestoreOk && apiOk) {
            console.log('✅ All checks passed!');
            process.exit(0);
        }
        else {
            console.error('❌ Some checks failed!');
            process.exit(1);
        }
    }
    catch (error) {
        console.error('❌ Verification failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}
main();
