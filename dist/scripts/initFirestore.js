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
const admin = __importStar(require("firebase-admin"));
/**
 * Service account for dlx-trading project
 */
const SERVICE_ACCOUNT = {
    type: 'service_account',
    project_id: 'dlx-trading',
    private_key_id: '354305546bffb937a6890ba46d6a7146de4cf09f',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCwjvAC171mrgc3\nA98IlkuQbGacDJI7U2ku1/OtAmM/r3dPhIeMJVWag42/3GNJe0WvUdDU3XyMv9kL\nLC/i0bNuPLWObAT6DU2iYF/Fl4t0CWjuxY/C0EcGlnezT66tIH1uNlXlpnvNd5yc\nKVp3qkWtyi+oCsVqu9hr7g+DNUQABPb6L8G/v3ws/9coGz26zgL0XHEmq0OpogKk\n7rr3lt7YY5RqvIdfC/1vCQzjvl+dNVt/91RuM1pvakXBZ5q9FGKMZ0Oqc/4Hn4OL\nSW54K6hnb9ftjWLkZy4lZGAsaL9hUTf2u+b3BEyvZinfdcSUkR2kzV24whYXpYlI\ngkU15EVVAgMBAAECggEAFdPiD9PotkZLHY3Ut8zO9EC2kdHLDVsTTKeFmGzMZN32\nR+YoVNbzxZnAf0kJnFbJZ3KbuQlV4dfBB0zT8bx/rKAESSKJHfnhkHLOPFEvPC4C\no0xY6NqTgVi+XTR7catr3mGIzo69zQnd2n+RT+yE10bBDAsi2350M+m3UL8X1FGT\n/rr3bO7UDRGees1iDwE2BSfow2+3s/2kcRXWN4/4dA7pfSLNb/KCbIMe8CYWhqyG\nbcgJ9KhOUNB+0MhZUVO3UkiUBI2tvdeW2/NS3HtaoNDuhHhTyo7dJbNhpiQpY/Cy\nDPSoD9jj429CBm7x4mAXBDwvyrL4WnDXLw3sgyekaQKBgQDqX8dw+XNIDjJMwSJZ\nX0/WLFQFDE7t04C9ugh6IZjxGhvqJlrATHRvgZdbUz4hMkfp6Yq3zz9Jc/c2HaqX\nm8byIAkxiKrSRK27zhOm+QVxQnHEMGAew03HT10p+iJKNAl7N5p/UjXoulH8+7yv\njTZ8hY5tIN6M8pLlNDBqTQehGQKBgQDA2XmBvnImre2Z7yn3GvkPPDriRwnLN64a\nc/p9LAW3dc13KKeui83xgIvpfzePKUrzBPz3mIn7qrQbB3VhbFutKrzNagAjkc1N\n0vVQMhpnIjnWrrf1BiaUJpr51MnFNvIozPqWopKCHxTO/NO7Ou+BihDpSEw2T3X5\nr0GKnwxhnQKBgERCVuS5UfDnaZDfIvDiiG75BBNgTVCIq9MV7kgbpt55Wy3rs7yT\nx8l99aX8bXjfmwAuK19zNZxf8NzK8RcsoFl+KQ9LHW0V4X9z+ldD6WjeECIycJwl\nB28H1ztVhU0VMLm5LP7t45N/SEekzYRXXUoQ37U6wHZOY6frdjpPauxpAoGAD4Ku\nQiAmIDRG8uWIc4Zo16/ZcI+UGxMcXqZLVDvxLcM8xkOv0NsPskfLePkxZ8NDcu5I\nxkUve91L5QyhhTdo3DGew8qtvi6g24yHDG8rLnZTPpAI3Z0kBzBfsI5LuB/mNB/g\nW7Mxo2OKkedFxD5GOx32pDybXJbhfzZ4SATowwUCgYEAob8alJu9Sd/SPbOdmK2u\nxTbiBn3ZwQukjJLVcb/moFRcGYOoOvLEN0ox6VZogjFRsxW7htzq3Pq7OSEdsPek\nzKYyhW2E43PGfFGZ+5EMvCSg9wE+r3xL+eqMNVV+IRfMiYyCD9A/DmtfQknN+t0e\nls4pZwi6zk/PxdxGg8LKumU=\n-----END PRIVATE KEY-----\n',
    client_email: 'firebase-adminsdk-fbsvc@dlx-trading.iam.gserviceaccount.com',
    client_id: '106285546497731813110',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40dlx-trading.iam.gserviceaccount.com',
    universe_domain: 'googleapis.com',
};
/**
 * List of all required Firestore collections
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
 * Initializer document ID
 * Note: Document IDs starting with __ are reserved by Firestore
 * Using a simple name without double underscores
 */
const INIT_DOC_ID = '_init';
/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
    // Remove any emulator environment variables - FORCE REMOVE ALL EMULATOR FLAGS
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_EMULATOR;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.FIREBASE_PROJECT_ID;
    let app;
    try {
        // Try to get existing app
        app = admin.app('firestore-init');
    }
    catch (error) {
        // App doesn't exist, initialize it
        app = admin.initializeApp({
            credential: admin.credential.cert(SERVICE_ACCOUNT),
            projectId: SERVICE_ACCOUNT.project_id,
        }, 'firestore-init');
    }
    const db = app.firestore();
    console.log('✅ Firebase Admin initialized');
    console.log('✅ Connected to project:', SERVICE_ACCOUNT.project_id);
    return db;
}
/**
 * Force create all Firestore collections with placeholder documents
 */
async function forceCreateAllCollections() {
    console.log('🔥 Starting Firestore collection creation...');
    console.log(`📋 Total collections to create: ${REQUIRED_COLLECTIONS.length}`);
    console.log('');
    const db = initializeFirebase();
    const results = {
        created: [],
        skipped: [],
        errors: [],
    };
    // Process all collections in parallel
    await Promise.all(REQUIRED_COLLECTIONS.map(async (collectionName) => {
        try {
            const docRef = db.collection(collectionName).doc(INIT_DOC_ID);
            // Check if document already exists
            const doc = await docRef.get();
            if (doc.exists) {
                console.log(`⏭️  Collection "${collectionName}" - SKIPPED (already exists)`);
                results.skipped.push(collectionName);
                return;
            }
            // Create placeholder document
            await docRef.set({
                createdAt: admin.firestore.Timestamp.now(),
                initialized: true,
            });
            console.log(`✅ Collection "${collectionName}" - CREATED`);
            results.created.push(collectionName);
        }
        catch (error) {
            const errorMessage = error.message || 'Unknown error';
            console.error(`❌ Collection "${collectionName}" - ERROR: ${errorMessage}`);
            results.errors.push({
                collection: collectionName,
                error: errorMessage,
            });
        }
    }));
    // Print summary
    console.log('');
    console.log('📊 Summary:');
    console.log(`   ✅ Created: ${results.created.length}`);
    console.log(`   ⏭️  Skipped: ${results.skipped.length}`);
    console.log(`   ❌ Errors: ${results.errors.length}`);
    if (results.created.length > 0) {
        console.log('');
        console.log('✅ Created collections:');
        results.created.forEach((name) => console.log(`   - ${name}`));
    }
    if (results.skipped.length > 0) {
        console.log('');
        console.log('⏭️  Skipped collections (already exist):');
        results.skipped.forEach((name) => console.log(`   - ${name}`));
    }
    if (results.errors.length > 0) {
        console.log('');
        console.error('❌ Errors:');
        results.errors.forEach(({ collection, error }) => {
            console.error(`   - ${collection}: ${error}`);
        });
        process.exit(1);
    }
    console.log('');
    console.log('🎉 All Firestore collections initialized successfully!');
    console.log('🔥 Check Firebase Console to verify all collections exist.');
}
// Run the script
(async () => {
    try {
        await forceCreateAllCollections();
        process.exit(0);
    }
    catch (error) {
        console.error('💥 Fatal error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
