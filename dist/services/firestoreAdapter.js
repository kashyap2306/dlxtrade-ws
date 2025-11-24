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
exports.firestoreAdapter = exports.FirestoreAdapter = void 0;
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const logger_1 = require("../utils/logger");
const keyManager_1 = require("./keyManager");
const exchangeConnector_1 = require("./exchangeConnector");
const db = () => admin.firestore((0, firebase_1.getFirebaseAdmin)());
class FirestoreAdapter {
    // API Keys
    async saveApiKey(uid, keyData) {
        const docRef = db().collection('users').doc(uid).collection('apikeys').doc();
        const doc = {
            exchange: keyData.exchange,
            name: keyData.name,
            apiKeyEncrypted: (0, keyManager_1.encrypt)(keyData.apiKey),
            apiSecretEncrypted: (0, keyManager_1.encrypt)(keyData.apiSecret),
            testnet: keyData.testnet,
            createdAt: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
        };
        await docRef.set(doc);
        logger_1.logger.info({ uid, keyId: docRef.id }, 'API key saved to Firestore');
        return docRef.id;
    }
    async getApiKeys(uid) {
        const snapshot = await db()
            .collection('users')
            .doc(uid)
            .collection('apikeys')
            .orderBy('createdAt', 'desc')
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
    }
    async getApiKey(uid, keyId) {
        const doc = await db()
            .collection('users')
            .doc(uid)
            .collection('apikeys')
            .doc(keyId)
            .get();
        if (!doc.exists)
            return null;
        return {
            id: doc.id,
            ...doc.data(),
        };
    }
    async updateApiKey(uid, keyId, updates) {
        const updateData = {
            updatedAt: admin.firestore.Timestamp.now(),
        };
        if (updates.name)
            updateData.name = updates.name;
        if (updates.apiKey)
            updateData.apiKeyEncrypted = (0, keyManager_1.encrypt)(updates.apiKey);
        if (updates.apiSecret)
            updateData.apiSecretEncrypted = (0, keyManager_1.encrypt)(updates.apiSecret);
        if (updates.testnet !== undefined)
            updateData.testnet = updates.testnet;
        await db()
            .collection('users')
            .doc(uid)
            .collection('apikeys')
            .doc(keyId)
            .update(updateData);
        logger_1.logger.info({ uid, keyId }, 'API key updated in Firestore');
    }
    async deleteApiKey(uid, keyId) {
        await db()
            .collection('users')
            .doc(uid)
            .collection('apikeys')
            .doc(keyId)
            .delete();
        logger_1.logger.info({ uid, keyId }, 'API key deleted from Firestore');
    }
    async getLatestApiKey(uid, exchange) {
        try {
            const snapshot = await db()
                .collection('users')
                .doc(uid)
                .collection('apikeys')
                .where('exchange', '==', exchange)
                .orderBy('updatedAt', 'desc')
                .limit(1)
                .get();
            if (snapshot.empty)
                return null;
            const doc = snapshot.docs[0];
            return {
                id: doc.id,
                ...doc.data(),
            };
        }
        catch (error) {
            // Handle composite index errors gracefully
            if (error.message?.includes('index')) {
                logger_1.logger.warn({ uid, exchange, error: error.message }, 'Composite index error in getLatestApiKey, falling back to unordered query');
                // Fallback: get all keys for this exchange and sort in memory
                const fallbackSnapshot = await db()
                    .collection('users')
                    .doc(uid)
                    .collection('apikeys')
                    .where('exchange', '==', exchange)
                    .get();
                if (fallbackSnapshot.empty)
                    return null;
                const docs = fallbackSnapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                })).sort((a, b) => (b.updatedAt?.toMillis() || 0) - (a.updatedAt?.toMillis() || 0));
                return docs[0] || null;
            }
            throw error;
        }
    }
    // Settings
    async saveSettings(uid, settings) {
        const docRef = db().collection('users').doc(uid).collection('settings').doc('current');
        await docRef.set({
            ...settings,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.info({ uid }, 'Settings saved to Firestore');
    }
    async getSettings(uid) {
        const doc = await db()
            .collection('users')
            .doc(uid)
            .collection('settings')
            .doc('current')
            .get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    // Research Logs
    async saveResearchLog(uid, research) {
        const docRef = db().collection('users').doc(uid).collection('researchLogs').doc();
        const doc = {
            ...research,
            createdAt: admin.firestore.Timestamp.now(),
        };
        await docRef.set(doc);
        logger_1.logger.debug({ uid, symbol: research.symbol, accuracy: research.accuracy }, 'Research log saved');
        return docRef.id;
    }
    async getResearchLogs(uid, limit = 100) {
        const snapshot = await db()
            .collection('users')
            .doc(uid)
            .collection('researchLogs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
    }
    // Execution Logs
    async saveExecutionLog(uid, execution) {
        const docRef = db().collection('users').doc(uid).collection('executionLogs').doc();
        const doc = {
            ...execution,
            createdAt: admin.firestore.Timestamp.now(),
        };
        await docRef.set(doc);
        logger_1.logger.info({ uid, action: execution.action, symbol: execution.symbol }, 'Execution log saved');
        return docRef.id;
    }
    async getExecutionLogs(uid, limit = 100) {
        const snapshot = await db()
            .collection('users')
            .doc(uid)
            .collection('executionLogs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
    }
    // Integrations
    async getIntegration(uid, apiName) {
        const doc = await db()
            .collection('users')
            .doc(uid)
            .collection('integrations')
            .doc(apiName)
            .get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async getAllIntegrations(uid) {
        const snapshot = await db()
            .collection('users')
            .doc(uid)
            .collection('integrations')
            .get();
        const integrations = {};
        snapshot.docs.forEach((doc) => {
            integrations[doc.id] = doc.data();
        });
        return integrations;
    }
    /**
     * Get default data providers that are always available (not stored in Firestore)
     */
    getDefaultProviders() {
        return {
            'binance': { enabled: true, displayName: 'Binance Public API', free: true },
            'coingecko': { enabled: true, displayName: 'CoinGecko API', free: true },
            'googlefinance': { enabled: true, displayName: 'Google Finance', free: true },
        };
    }
    /**
     * Get real exchanges that can be connected (stored in Firestore)
     */
    getRealExchanges() {
        return ['bybit', 'mexc', 'kucoin', 'bingx', 'okx', 'weex', 'bitget'];
    }
    async ensureDefaultIntegrations(uid) {
        const integrationsRef = db()
            .collection('users')
            .doc(uid)
            .collection('integrations');
        const snapshot = await integrationsRef.get();
        const existingIntegrations = new Set(snapshot.docs.map(doc => doc.id));
        // Only create optional research providers - default providers are not stored in Firestore
        const defaultIntegrations = [
            // Required APIs (disabled by default, require API keys)
            { name: 'marketaux', enabled: false, displayName: 'MarketAux API', free: false },
            { name: 'cryptocompare', enabled: false, displayName: 'CryptoCompare API', free: false },
        ];
        const now = admin.firestore.Timestamp.now();
        const createdIntegrations = [];
        for (const integration of defaultIntegrations) {
            const docRef = integrationsRef.doc(integration.name);
            if (!existingIntegrations.has(integration.name)) {
                // Create new integration document
                await docRef.set({
                    enabled: integration.enabled,
                    exchangeName: integration.displayName,
                    free: integration.free || false,
                    createdAt: now,
                    updatedAt: now,
                    // Free APIs don't need API keys
                    apiKey: integration.free ? null : undefined,
                    secretKey: integration.free ? null : undefined,
                    passphrase: integration.free ? null : undefined,
                    status: integration.free ? 'VERIFIED' : 'SAVED',
                });
                createdIntegrations.push(integration.name);
                logger_1.logger.info({ uid, apiName: integration.name }, `Created default integration: ${integration.displayName}`);
            }
            else {
                // Update existing integration if it's a free API to ensure it's always enabled
                if (integration.free) {
                    const existingDoc = await docRef.get();
                    const existingData = existingDoc.data();
                    if (!existingData?.enabled) {
                        await docRef.update({
                            enabled: true,
                            free: true,
                            updatedAt: now,
                            status: 'VERIFIED',
                        });
                        logger_1.logger.info({ uid, apiName: integration.name }, `Re-enabled free API: ${integration.displayName}`);
                    }
                }
            }
        }
        if (createdIntegrations.length > 0) {
            logger_1.logger.info({ uid, createdIntegrations }, 'Default integrations created for new user');
        }
        else {
            logger_1.logger.debug({ uid }, 'Default integrations already exist');
        }
    }
    async saveIntegration(uid, apiName, data) {
        const docRef = db()
            .collection('users')
            .doc(uid)
            .collection('integrations')
            .doc(apiName);
        // Check if document exists for idempotency
        const existingDoc = await docRef.get();
        const existingData = existingDoc.exists ? existingDoc.data() : null;
        const now = admin.firestore.Timestamp.now();
        const docData = {
            enabled: data.enabled,
            updatedAt: now,
            userId: data.userId || uid,
            exchangeName: data.exchangeName || existingData?.exchangeName || apiName,
            status: data.status || existingData?.status || (data.enabled ? 'SAVED' : 'DISABLED'),
        };
        // Set createdAt only if document doesn't exist (required field)
        if (!existingDoc.exists) {
            docData.createdAt = now;
        }
        else if (data.enabled === false && existingDoc.exists && !existingDoc.data().createdAt) {
            // Patch: ensure createdAt exists on disables for legacy docs
            docData.createdAt = now;
        }
        if (data.meta) {
            docData.meta = data.meta;
        }
        if (data.validationDetails) {
            docData.validationDetails = data.validationDetails;
        }
        if (data.lastValidatedAt) {
            docData.lastValidatedAt = data.lastValidatedAt;
        }
        // Encrypt API keys safely
        try {
            if (data.apiKey) {
                docData.apiKey = (0, keyManager_1.encrypt)(data.apiKey);
            }
            if (data.secretKey) {
                docData.secretKey = (0, keyManager_1.encrypt)(data.secretKey);
            }
            if (data.passphrase) {
                docData.passphrase = (0, keyManager_1.encrypt)(data.passphrase);
            }
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid, apiName }, 'Encryption failed during saveIntegration');
            throw new Error(`Encryption failed: ${error.message}`);
        }
        // Set apiType for CoinAPI integrations (required field)
        if (data.apiType) {
            docData.apiType = data.apiType;
        }
        else if (apiName.startsWith('coinapi_')) {
            // Extract apiType from docName if not provided (e.g., 'coinapi_market' -> 'market')
            docData.apiType = apiName.replace('coinapi_', '');
        }
        await docRef.set(docData, { merge: true });
        logger_1.logger.info({ uid, apiName, enabled: data.enabled }, 'Saving integration');
        // Post-save verification: read back the document and verify all required fields
        const verification = await docRef.get();
        if (!verification.exists) {
            logger_1.logger.error({ uid, apiName }, 'Post-save read failed - document missing');
            throw new Error('Post-save verification failed: document not found');
        }
        const savedData = verification.data() || {};
        // Verify all required fields are present
        const requiredFields = ['enabled', 'createdAt', 'updatedAt'];
        const missingFields = requiredFields.filter(field => savedData[field] === undefined);
        // For CoinAPI, apiType is also required
        if (apiName.startsWith('coinapi_') && !savedData.apiType) {
            missingFields.push('apiType');
        }
        if (missingFields.length > 0) {
            logger_1.logger.error({ uid, apiName, missingFields }, '❌ Integration missing required fields after save');
            throw new Error(`Post-save verification failed: missing required fields: ${missingFields.join(', ')}`);
        }
        logger_1.logger.info({
            uid,
            path: `users/${uid}/integrations/${apiName}`,
            hasEnabled: savedData.enabled !== undefined,
            hasApiKey: savedData.apiKey !== undefined,
            hasSecretKey: savedData.secretKey !== undefined,
            hasApiType: savedData.apiType !== undefined,
            hasCreatedAt: !!savedData.createdAt,
            hasUpdatedAt: !!savedData.updatedAt,
        }, '✅ Integration verified with all required fields');
        return {
            path: `users/${uid}/integrations/${apiName}`,
            data: {
                enabled: savedData.enabled || false,
                hasKey: !!savedData.apiKey,
                hasSecret: !!savedData.secretKey,
                apiType: savedData.apiType || null,
                status: savedData.status || (savedData.enabled ? 'SAVED' : 'DISABLED'),
                updatedAt: savedData.updatedAt,
                createdAt: savedData.createdAt,
                exchangeName: savedData.exchangeName || apiName,
            },
        };
    }
    async deleteIntegration(uid, apiName) {
        await db()
            .collection('users')
            .doc(uid)
            .collection('integrations')
            .doc(apiName)
            .delete();
        logger_1.logger.info({ uid, apiName }, 'Integration deleted from Firestore');
    }
    async getEnabledIntegrations(uid) {
        const allIntegrations = await this.getAllIntegrations(uid);
        const enabled = {};
        for (const [apiName, integration] of Object.entries(allIntegrations)) {
            if (integration.enabled && integration.apiKey) {
                const decryptedApiKey = (0, keyManager_1.decrypt)(integration.apiKey);
                // Skip if decryption failed
                if (!decryptedApiKey) {
                    logger_1.logger.warn({ uid, apiName }, 'Failed to decrypt API key - skipping integration');
                    continue;
                }
                enabled[apiName] = {
                    apiKey: decryptedApiKey,
                    ...(integration.secretKey ? { secretKey: (0, keyManager_1.decrypt)(integration.secretKey) || '' } : {}),
                };
            }
        }
        return enabled;
    }
    /**
     * Get user's provider API keys from integrations collection
     * Reads from users/{uid}/integrations documents for cryptocompare, marketaux, coinapi_*
     */
    async getUserProviderApiKeys(uid) {
        try {
            const integrations = await this.getAllIntegrations(uid);
            const providerKeys = {};
            // Map integration document names to provider keys
            const providerMappings = {
                'cryptocompare': 'cryptocompare',
                'marketaux': 'marketaux',
                'coinapi_market': 'coinapi_market',
                'coinapi_exchangerate': 'coinapi_exchangerate',
                'coinapi_flatfile': 'coinapi_flatfile'
            };
            for (const [integrationName, providerField] of Object.entries(providerMappings)) {
                const integration = integrations[integrationName];
                if (integration && integration.enabled && integration.apiKey) {
                    const encryptedKey = integration.apiKey;
                    const decryptedKey = (0, keyManager_1.decrypt)(encryptedKey);
                    if (decryptedKey) {
                        providerKeys[providerField] = { apiKey: decryptedKey };
                        logger_1.logger.info({ uid, provider: integrationName }, `Successfully retrieved ${integrationName} API key`);
                    }
                    else {
                        logger_1.logger.warn({ uid, provider: integrationName }, `Failed to decrypt ${integrationName} API key`);
                    }
                }
            }
            logger_1.logger.info({ uid, providersFound: Object.keys(providerKeys) }, 'Retrieved provider API keys from integrations collection');
            return providerKeys;
        }
        catch (error) {
            logger_1.logger.error({ uid, error: error.message }, 'Error retrieving provider API keys from integrations collection');
            throw error;
        }
    }
    /**
     * Returns { exchange, credentials } for the highest-priority enabled exchange for a user.
     * If none, returns { exchange: 'fallback' }
     */
    async getActiveExchangeForUser(uid) {
        const integrations = await this.getAllIntegrations(uid);
        // Only real exchanges that can be connected for auto-trade (no default binance)
        const priorities = ['bitget', 'bingx', 'bybit', 'mexc', 'kucoin', 'okx', 'weex'];
        for (const exchangeName of priorities) {
            const config = integrations[exchangeName];
            if (!config || !config.enabled)
                continue;
            try {
                const apiKey = config.apiKey ? (0, keyManager_1.decrypt)(config.apiKey) : '';
                const secretKey = config.secretKey ? (0, keyManager_1.decrypt)(config.secretKey) : '';
                const passphrase = config.passphrase ? (0, keyManager_1.decrypt)(config.passphrase) : undefined;
                if (!apiKey || !secretKey) {
                    logger_1.logger.warn({ uid, exchangeName }, 'Active exchange missing decrypted credentials');
                    continue;
                }
                const adapter = exchangeConnector_1.ExchangeConnectorFactory.create(exchangeName, {
                    apiKey,
                    secret: secretKey,
                    passphrase,
                    testnet: config.testnet ?? false,
                });
                return {
                    name: exchangeName,
                    apiKey,
                    secret: secretKey,
                    passphrase,
                    testnet: config.testnet ?? false,
                    adapter
                };
            }
            catch (err) {
                logger_1.logger.error({ uid, exchangeName, error: err.message }, 'Failed to instantiate exchange adapter');
                continue;
            }
        }
        // Return safe fallback instead of throwing error for Deep Research compatibility
        logger_1.logger.debug({ uid }, 'No exchange integration configured, returning safe fallback');
        return {
            exchangeConfigured: false,
            error: "No exchange integration connected"
        };
    }
    // HFT Settings
    async saveHFTSettings(uid, settings) {
        const docRef = db().collection('users').doc(uid).collection('hftSettings').doc('current');
        await docRef.set({
            ...settings,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.info({ uid }, 'HFT settings saved to Firestore');
    }
    async getHFTSettings(uid) {
        const doc = await db()
            .collection('users')
            .doc(uid)
            .collection('hftSettings')
            .doc('current')
            .get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    // HFT Execution Logs
    async saveHFTExecutionLog(uid, execution) {
        const docRef = db().collection('users').doc(uid).collection('hftExecutionLogs').doc();
        const doc = {
            ...execution,
            createdAt: admin.firestore.Timestamp.now(),
        };
        await docRef.set(doc);
        logger_1.logger.info({ uid, action: execution.action, symbol: execution.symbol }, 'HFT execution log saved');
        return docRef.id;
    }
    async getHFTExecutionLogs(uid, limit = 100) {
        const snapshot = await db()
            .collection('users')
            .doc(uid)
            .collection('hftExecutionLogs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
    }
    // Agent Management
    async unlockAgent(uid, agentName, agentId, metadata) {
        const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
        await docRef.set({
            unlocked: true,
            agentId: agentId || agentName,
            agentName,
            unlockedAt: admin.firestore.Timestamp.now(),
            status: 'active',
            settings: {},
            ...metadata,
        }, { merge: true });
        // Also update user's unlockedAgents array
        const userData = await this.getUser(uid);
        const currentUnlocked = userData?.unlockedAgents || [];
        if (!currentUnlocked.includes(agentName)) {
            await this.createOrUpdateUser(uid, {
                unlockedAgents: [...currentUnlocked, agentName],
            });
        }
        logger_1.logger.info({ uid, agentName, agentId }, 'Agent unlocked');
    }
    async lockAgent(uid, agentName) {
        const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
        await docRef.set({
            unlocked: false,
            status: 'inactive',
            lockedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        // Remove from user's unlockedAgents array
        const userData = await this.getUser(uid);
        const currentUnlocked = userData?.unlockedAgents || [];
        const updatedUnlocked = currentUnlocked.filter((name) => name !== agentName);
        await this.createOrUpdateUser(uid, {
            unlockedAgents: updatedUnlocked,
        });
        logger_1.logger.info({ uid, agentName }, 'Agent locked');
    }
    async getUserUnlockedAgents(uid) {
        try {
            const snapshot = await db()
                .collection('users')
                .doc(uid)
                .collection('agents')
                .where('unlocked', '==', true)
                .get();
            return snapshot.docs.map((doc) => ({
                agentId: doc.data().agentId || doc.id,
                agentName: doc.data().agentName || doc.id,
                unlockedAt: doc.data().unlockedAt,
                status: doc.data().status || 'active',
                settings: doc.data().settings || {},
            }));
        }
        catch (err) {
            logger_1.logger.warn({ err: err.message }, 'getUserUnlockedAgents error');
            return [];
        }
    }
    async updateAgentSettings(uid, agentName, settings) {
        const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);
        await docRef.set({
            settings,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.info({ uid, agentName }, 'Agent settings updated');
    }
    async getAgentStatus(uid, agentName) {
        const doc = await db()
            .collection('users')
            .doc(uid)
            .collection('agents')
            .doc(agentName)
            .get();
        if (!doc.exists)
            return null;
        const data = doc.data();
        return {
            unlocked: data?.unlocked || false,
            unlockedAt: data?.unlockedAt,
        };
    }
    async getAllUserAgents(uid) {
        const snapshot = await db()
            .collection('users')
            .doc(uid)
            .collection('agents')
            .get();
        const agents = {};
        snapshot.docs.forEach((doc) => {
            const data = doc.data();
            agents[doc.id] = {
                unlocked: data?.unlocked || false,
                unlockedAt: data?.unlockedAt,
            };
        });
        return agents;
    }
    // User Profile Management
    async getUserProfile(uid) {
        const doc = await db().collection('users').doc(uid).get();
        if (!doc.exists)
            return null;
        const data = doc.data();
        return data?.profile || {};
    }
    async getAllUsers() {
        const snapshot = await db().collection('users').get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            const profile = data?.profile || {};
            return {
                uid: doc.id,
                email: profile.email || data?.email,
                role: profile.role,
                createdAt: data?.createdAt || profile.createdAt,
            };
        });
    }
    /**
     * Get all users who have the required API keys for Deep Research (marketaux + cryptocompare)
     */
    async getAllUsersWithAPIs() {
        const allUsers = await this.getAllUsers();
        const usersWithAPIs = [];
        for (const user of allUsers) {
            try {
                const providerKeys = await this.getUserProviderApiKeys(user.uid);
                const hasMarketaux = !!providerKeys['marketaux']?.apiKey;
                const hasCryptocompare = !!providerKeys['cryptocompare']?.apiKey;
                if (hasMarketaux && hasCryptocompare) {
                    usersWithAPIs.push(user);
                }
            }
            catch (error) {
                // Skip users with errors (likely no integrations collection)
                continue;
            }
        }
        return usersWithAPIs;
    }
    // ========== USERS COLLECTION METHODS ==========
    async createOrUpdateUser(uid, userData) {
        const userRef = db().collection('users').doc(uid);
        const existing = await userRef.get();
        const updateData = {
            ...userData,
            updatedAt: admin.firestore.Timestamp.now(),
        };
        if (!existing.exists) {
            updateData.uid = uid;
            updateData.createdAt = admin.firestore.Timestamp.now();
        }
        await userRef.set(updateData, { merge: true });
        logger_1.logger.info({ uid }, 'User created/updated in users collection');
    }
    async getUser(uid) {
        const doc = await db().collection('users').doc(uid).get();
        if (!doc.exists)
            return null;
        return { uid: doc.id, ...doc.data() };
    }
    // ========== AGENTS COLLECTION METHODS ==========
    async getAllAgents() {
        const snapshot = await db().collection('agents').get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
    async getAgent(agentId) {
        const doc = await db().collection('agents').doc(agentId).get();
        if (!doc.exists)
            return null;
        return { id: doc.id, ...doc.data() };
    }
    // ========== AGENT UNLOCKS COLLECTION METHODS ==========
    async createAgentUnlock(uid, agentName, metadata) {
        const unlockRef = db().collection('agentUnlocks').doc();
        await unlockRef.set({
            uid,
            agentName,
            unlockedAt: admin.firestore.Timestamp.now(),
            ...metadata,
        });
        logger_1.logger.info({ uid, agentName }, 'Agent unlock recorded');
    }
    async getUserAgentUnlocks(uid) {
        try {
            const snapshot = await db()
                .collection('agentUnlocks')
                .where('uid', '==', uid)
                .orderBy('unlockedAt', 'desc')
                .get();
            return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        }
        catch (err) {
            logger_1.logger.warn({ err: err.message }, 'getUserAgentUnlocks fell back due to index; returning unordered');
            const snapshot = await db()
                .collection('agentUnlocks')
                .where('uid', '==', uid)
                .get();
            return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        }
    }
    // ========== API KEYS COLLECTION METHODS (top-level) ==========
    async saveApiKeyToCollection(uid, keyData) {
        const docRef = db().collection('apiKeys').doc();
        const { encrypt } = await Promise.resolve().then(() => __importStar(require('./keyManager')));
        await docRef.set({
            uid,
            publicKey: keyData.publicKey,
            secretKeyEncrypted: encrypt(keyData.secretKey),
            exchange: keyData.exchange || 'binance',
            createdAt: admin.firestore.Timestamp.now(),
        });
        logger_1.logger.info({ uid, keyId: docRef.id }, 'API key saved to apiKeys collection');
        return docRef.id;
    }
    async getUserApiKeys(uid) {
        try {
            const snapshot = await db()
                .collection('apiKeys')
                .where('uid', '==', uid)
                .orderBy('createdAt', 'desc')
                .get();
            return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        }
        catch (error) {
            // Handle composite index errors gracefully
            if (error.message?.includes('index')) {
                logger_1.logger.warn({ uid, error: error.message }, 'Composite index error in getUserApiKeys, falling back to unordered query');
                // Fallback: get all keys for this user and sort in memory
                const fallbackSnapshot = await db()
                    .collection('apiKeys')
                    .where('uid', '==', uid)
                    .get();
                return fallbackSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
                    .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
            }
            throw error;
        }
    }
    // ========== EXCHANGE CONFIG METHODS ==========
    async saveExchangeConfig(uid, data) {
        const docRef = db()
            .collection('users')
            .doc(uid)
            .collection('exchangeConfig')
            .doc('current');
        // Check if document exists for idempotency
        const existingDoc = await docRef.get();
        const now = admin.firestore.Timestamp.now();
        // Encrypt credentials safely
        let apiKeyEncrypted;
        let secretEncrypted;
        let passphraseEncrypted = '';
        try {
            apiKeyEncrypted = (0, keyManager_1.encrypt)(data.apiKey);
            secretEncrypted = (0, keyManager_1.encrypt)(data.secret);
            if (data.passphrase) {
                passphraseEncrypted = (0, keyManager_1.encrypt)(data.passphrase);
            }
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid }, 'Encryption failed during saveExchangeConfig');
            throw new Error(`Encryption failed: ${error.message}`);
        }
        const configData = {
            exchange: data.exchange,
            apiKeyEncrypted,
            secretEncrypted,
            passphraseEncrypted,
            testnet: data.testnet || false,
            enabled: true,
            updatedAt: now,
        };
        // Set createdAt only if document doesn't exist
        if (!existingDoc.exists) {
            configData.createdAt = now;
        }
        await docRef.set(configData, { merge: true });
        logger_1.logger.info({ uid, exchange: data.exchange }, 'Saving exchange config');
        // Post-save verification: read back the document and verify all required fields
        const verification = await docRef.get();
        if (!verification.exists) {
            logger_1.logger.error({ uid }, 'Post-save read failed - document missing');
            throw new Error('Post-save verification failed: document not found');
        }
        const savedData = verification.data() || {};
        // Verify all required fields are present
        const requiredFields = ['exchange', 'apiKeyEncrypted', 'secretEncrypted', 'passphraseEncrypted', 'testnet', 'enabled', 'createdAt', 'updatedAt'];
        const missingFields = requiredFields.filter(field => savedData[field] === undefined);
        if (missingFields.length > 0) {
            logger_1.logger.error({ uid, missingFields }, '❌ Exchange config missing required fields after save');
            throw new Error(`Post-save verification failed: missing required fields: ${missingFields.join(', ')}`);
        }
        logger_1.logger.info({
            uid,
            path: `users/${uid}/exchangeConfig/current`,
            hasExchange: savedData.exchange !== undefined,
            hasApiKeyEncrypted: savedData.apiKeyEncrypted !== undefined,
            hasSecretEncrypted: savedData.secretEncrypted !== undefined,
            hasPassphraseEncrypted: savedData.passphraseEncrypted !== undefined,
            hasTestnet: savedData.testnet !== undefined,
            hasEnabled: savedData.enabled !== undefined,
            hasCreatedAt: !!savedData.createdAt,
            hasUpdatedAt: !!savedData.updatedAt,
        }, '✅ Exchange config verified with all required fields');
        // Update user document's apiConnected status
        try {
            await db().collection('users').doc(uid).set({
                apiConnected: true,
                apiStatus: 'connected',
                connectedExchanges: admin.firestore.FieldValue.arrayUnion(data.exchange),
                updatedAt: now,
            }, { merge: true });
            logger_1.logger.info({ uid, exchange: data.exchange }, 'Updated user apiConnected status');
        }
        catch (userUpdateErr) {
            logger_1.logger.warn({ err: userUpdateErr, uid }, 'Failed to update user apiConnected status (non-critical)');
        }
        return {
            path: `users/${uid}/exchangeConfig/current`,
            data: {
                exchange: savedData.exchange || '',
                hasKey: !!savedData.apiKeyEncrypted,
                hasSecret: !!savedData.secretEncrypted,
                hasPassphrase: !!savedData.passphraseEncrypted,
                testnet: savedData.testnet || false,
                enabled: savedData.enabled || false,
                updatedAt: savedData.updatedAt,
                createdAt: savedData.createdAt,
            },
        };
    }
    // ========== ERROR LOGGING METHODS ==========
    async logError(errorId, error) {
        const errorRef = db().collection('admin').doc('errors').collection('errors').doc(errorId);
        await errorRef.set({
            ...error,
            timestamp: admin.firestore.Timestamp.now(),
            errorId,
        });
        logger_1.logger.error({ errorId, ...error }, 'Error logged to admin/errors');
    }
    // ========== ACTIVITY LOGS COLLECTION METHODS ==========
    async logActivity(uid, type, metadata) {
        const logRef = db().collection('activityLogs').doc();
        await logRef.set({
            uid,
            type,
            message: metadata?.message || `Activity: ${type}`,
            metadata: metadata || {},
            timestamp: admin.firestore.Timestamp.now(),
        });
        logger_1.logger.debug({ uid, type }, 'Activity logged');
    }
    async getActivityLogs(uid, limit = 100) {
        let query = db().collection('activityLogs');
        if (uid) {
            query = query.where('uid', '==', uid);
        }
        const snapshot = await query
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate().toISOString(),
        }));
    }
    // ========== ENGINE STATUS COLLECTION METHODS ==========
    async saveEngineStatus(uid, status) {
        const statusRef = db().collection('engineStatus').doc(uid);
        await statusRef.set({
            uid,
            ...status,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.debug({ uid, active: status.active }, 'Engine status saved');
    }
    async getEngineStatus(uid) {
        const doc = await db().collection('engineStatus').doc(uid).get();
        if (!doc.exists)
            return null;
        return { uid: doc.id, ...doc.data() };
    }
    async getAllEngineStatuses() {
        const snapshot = await db().collection('engineStatus').get();
        return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    }
    // ========== HFT LOGS COLLECTION METHODS ==========
    async saveHFTLog(uid, logData) {
        const logRef = db().collection('hftLogs').doc();
        await logRef.set({
            uid,
            ...logData,
            timestamp: admin.firestore.Timestamp.now(),
        });
        logger_1.logger.debug({ uid, action: logData.action }, 'HFT log saved');
    }
    async getHFTLogs(uid, limit = 100) {
        try {
            let query = db().collection('hftLogs');
            if (uid) {
                query = query.where('uid', '==', uid);
            }
            const snapshot = await query
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate().toISOString(),
            }));
        }
        catch (error) {
            // Handle composite index errors gracefully
            if (error.message?.includes('index') && uid) {
                logger_1.logger.warn({ uid, error: error.message }, 'Composite index error in getHFTLogs, falling back to unordered query');
                // Fallback: get all logs for this user and sort in memory
                const fallbackSnapshot = await db()
                    .collection('hftLogs')
                    .where('uid', '==', uid)
                    .limit(limit * 2) // Get more to account for sorting
                    .get();
                return fallbackSnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate().toISOString(),
                })).sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0)).slice(0, limit);
            }
            throw error;
        }
    }
    // ========== TRADES COLLECTION METHODS ==========
    async saveTrade(uid, tradeData) {
        const tradeRef = db().collection('trades').doc();
        const side = tradeData.side.toLowerCase();
        await tradeRef.set({
            uid,
            symbol: tradeData.symbol,
            side,
            qty: tradeData.qty,
            entryPrice: tradeData.entryPrice,
            exitPrice: tradeData.exitPrice,
            pnl: tradeData.pnl,
            timestamp: tradeData.timestamp || admin.firestore.Timestamp.now(),
            engineType: tradeData.engineType,
            ...(tradeData.orderId && { orderId: tradeData.orderId }),
            ...(tradeData.metadata && { metadata: tradeData.metadata }),
        });
        logger_1.logger.info({ uid, symbol: tradeData.symbol, side }, 'Trade saved');
        return tradeRef.id;
    }
    async getTrades(uid, limit = 100) {
        try {
            let query = db().collection('trades');
            if (uid) {
                query = query.where('uid', '==', uid);
            }
            const snapshot = await query
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate().toISOString(),
            }));
        }
        catch (err) {
            logger_1.logger.warn({ err: err.message }, 'getTrades fell back due to index; returning unordered limited set');
            let query = db().collection('trades');
            if (uid) {
                query = query.where('uid', '==', uid);
            }
            const snapshot = await query.limit(limit).get();
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate().toISOString(),
            }));
        }
    }
    // ========== NOTIFICATIONS COLLECTION METHODS ==========
    async createNotification(uid, notification) {
        const notifRef = db().collection('notifications').doc();
        await notifRef.set({
            uid,
            ...notification,
            read: false,
            timestamp: admin.firestore.Timestamp.now(),
        });
        logger_1.logger.debug({ uid, title: notification.title }, 'Notification created');
        return notifRef.id;
    }
    async getUserNotifications(uid, limit = 50) {
        try {
            const snapshot = await db()
                .collection('notifications')
                .where('uid', '==', uid)
                .orderBy('timestamp', 'desc')
                .limit(limit)
                .get();
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate().toISOString(),
            }));
        }
        catch (error) {
            // Handle composite index errors gracefully
            if (error.message?.includes('index')) {
                logger_1.logger.warn({ uid, error: error.message }, 'Composite index error in getUserNotifications, falling back to unordered query');
                // Fallback: get all notifications for this user and sort in memory
                const fallbackSnapshot = await db()
                    .collection('notifications')
                    .where('uid', '==', uid)
                    .limit(limit * 2) // Get more to account for sorting
                    .get();
                return fallbackSnapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                    timestamp: doc.data().timestamp?.toDate().toISOString(),
                })).sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0)).slice(0, limit);
            }
            throw error;
        }
    }
    async markNotificationRead(notificationId) {
        await db().collection('notifications').doc(notificationId).update({
            read: true,
            readAt: admin.firestore.Timestamp.now(),
        });
    }
    async getUnreadNotificationCount(uid) {
        const snapshot = await db()
            .collection('notifications')
            .where('uid', '==', uid)
            .where('read', '==', false)
            .get();
        return snapshot.size;
    }
    // ========== ADMIN COLLECTION METHODS ==========
    async createAdmin(uid, adminData) {
        const adminRef = db().collection('admin').doc(uid);
        await adminRef.set({
            uid,
            ...adminData,
            createdAt: admin.firestore.Timestamp.now(),
        });
        logger_1.logger.info({ uid, email: adminData.email }, 'Admin created');
    }
    async getAdmin(uid) {
        const doc = await db().collection('admin').doc(uid).get();
        if (!doc.exists)
            return null;
        return { uid: doc.id, ...doc.data() };
    }
    async isAdmin(uid) {
        const userDoc = await db().collection('users').doc(uid).get();
        if (!userDoc.exists)
            return false;
        const data = userDoc.data() || {};
        return data.role === 'admin' || data.isAdmin === true;
    }
    async getAllAdmins() {
        const snapshot = await db().collection('admin').get();
        return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
    }
    // ========== SETTINGS COLLECTION METHODS (global) ==========
    async getGlobalSettings() {
        const doc = await db().collection('settings').doc('global').get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async updateGlobalSettings(settings) {
        const settingsRef = db().collection('settings').doc('global');
        await settingsRef.set({
            ...settings,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.info('Global settings updated');
    }
    // ========== LOGS COLLECTION METHODS (system logs) ==========
    async saveSystemLog(logData) {
        const logRef = db().collection('logs').doc();
        await logRef.set({
            ...logData,
            timestamp: admin.firestore.Timestamp.now(),
        });
        logger_1.logger.debug({ type: logData.type }, 'System log saved');
    }
    async getSystemLogs(limit = 100) {
        const snapshot = await db()
            .collection('logs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate().toISOString(),
        }));
    }
    // ========== UI PREFERENCES COLLECTION METHODS ==========
    async getUserUIPreferences(uid) {
        const doc = await db().collection('uiPreferences').doc(uid).get();
        if (!doc.exists)
            return null;
        return { uid: doc.id, ...doc.data() };
    }
    async updateUIPreferences(uid, preferences) {
        const prefsRef = db().collection('uiPreferences').doc(uid);
        await prefsRef.set({
            uid,
            ...preferences,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.debug({ uid }, 'UI preferences updated');
    }
    // ========== GLOBAL STATS COLLECTION METHODS ==========
    async getGlobalStats() {
        // PART A: Use 'main' as doc ID
        const doc = await db().collection('globalStats').doc('main').get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async updateGlobalStats(stats) {
        // PART A: Use 'main' as doc ID
        const statsRef = db().collection('globalStats').doc('main');
        await statsRef.set({
            ...stats,
            updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        logger_1.logger.debug('Global stats updated');
    }
}
exports.FirestoreAdapter = FirestoreAdapter;
exports.firestoreAdapter = new FirestoreAdapter();
