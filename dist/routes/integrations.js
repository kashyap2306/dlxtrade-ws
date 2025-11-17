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
exports.integrationsRoutes = integrationsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const zod_1 = require("zod");
const keyManager_1 = require("../services/keyManager");
const binanceAdapter_1 = require("../services/binanceAdapter");
const logger_1 = require("../utils/logger");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
// Validation schemas
const integrationUpdateSchema = zod_1.z.object({
    apiName: zod_1.z.enum(['binance', 'cryptoquant', 'lunarcrush', 'coinapi']),
    enabled: zod_1.z.boolean(),
    apiKey: zod_1.z.string().optional(),
    secretKey: zod_1.z.string().optional(),
    // Allow legacy and namespaced CoinAPI types
    apiType: zod_1.z.enum(['market', 'flatfile', 'exchangerate', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate']).optional(),
});
const integrationDeleteSchema = zod_1.z.object({
    apiName: zod_1.z.enum(['binance', 'cryptoquant', 'lunarcrush', 'coinapi']),
    apiType: zod_1.z.enum(['market', 'flatfile', 'exchangerate', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate']).optional(),
});
async function integrationsRoutes(fastify) {
    // Load all integrations for the user
    fastify.get('/load', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const integrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(user.uid);
        // Return integrations with masked keys
        const result = {};
        // Group CoinAPI sub-types
        const coinApiTypes = {};
        for (const [docName, integration] of Object.entries(integrations)) {
            if (docName.startsWith('coinapi_')) {
                const type = docName.replace('coinapi_', '');
                coinApiTypes[type] = {
                    enabled: integration.enabled,
                    apiKey: integration.apiKey ? (0, keyManager_1.maskKey)(integration.apiKey) : null,
                    apiType: type,
                    updatedAt: integration.updatedAt?.toDate().toISOString(),
                };
            }
            else {
                result[docName] = {
                    enabled: integration.enabled,
                    apiKey: integration.apiKey ? (0, keyManager_1.maskKey)(integration.apiKey) : null,
                    secretKey: integration.secretKey ? (0, keyManager_1.maskKey)(integration.secretKey) : null,
                    apiType: integration.apiType || null,
                    updatedAt: integration.updatedAt?.toDate().toISOString(),
                };
            }
        }
        // Add CoinAPI grouped data
        if (Object.keys(coinApiTypes).length > 0) {
            result.coinapi = coinApiTypes;
        }
        return result;
    });
    // Update or create an integration
    fastify.post('/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = integrationUpdateSchema.parse(request.body);
        // Handle CoinAPI sub-types
        let docName = body.apiName;
        if (body.apiName === 'coinapi' && body.apiType) {
            // Accept both 'market' and 'coinapi_market' - normalize to 'coinapi_market'
            const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
            docName = t;
        }
        // Validate required fields based on API type
        if (body.apiName === 'binance') {
            if (body.enabled && (!body.apiKey || !body.secretKey)) {
                return reply.code(400).send({
                    error: 'Binance API requires both API key and secret key'
                });
            }
        }
        else {
            if (body.enabled && !body.apiKey) {
                return reply.code(400).send({
                    error: `${body.apiName} API requires an API key`
                });
            }
        }
        // If disabling, just update enabled status
        if (!body.enabled) {
            await firestoreAdapter_1.firestoreAdapter.saveIntegration(user.uid, docName, {
                enabled: false,
            });
            return { message: 'Integration disabled', apiName: body.apiName };
        }
        // If enabling, require keys
        const updateData = {
            enabled: true,
        };
        if (body.apiKey) {
            updateData.apiKey = body.apiKey;
        }
        if (body.secretKey) {
            updateData.secretKey = body.secretKey;
        }
        if (body.apiType) {
            updateData.apiType = body.apiType;
        }
        await firestoreAdapter_1.firestoreAdapter.saveIntegration(user.uid, docName, updateData);
        // PART 2: Also save to apiKeys collection if Binance with validation
        if (body.apiName === 'binance' && body.apiKey && body.secretKey) {
            // PART 2: Validate Binance API keys via connectivity test
            try {
                const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, body.secretKey, true); // Test with testnet first
                const validation = await testAdapter.validateApiKey();
                if (!validation.valid) {
                    return reply.code(400).send({
                        error: `Binance API key validation failed: ${validation.error || 'Invalid API key'}`,
                    });
                }
                if (!validation.canTrade) {
                    return reply.code(400).send({
                        error: 'API key does not have trading permissions. Please enable Spot & Margin Trading in Binance API settings.',
                    });
                }
                // Keys are valid - encrypt and save
                const db = admin.firestore((0, firebase_1.getFirebaseAdmin)());
                const apiKeysRef = db.collection('apiKeys').doc(user.uid);
                await apiKeysRef.set({
                    uid: user.uid,
                    exchange: 'binance',
                    apiKeyEncrypted: (0, keyManager_1.encrypt)(body.apiKey),
                    apiSecretEncrypted: (0, keyManager_1.encrypt)(body.secretKey),
                    createdAt: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                    status: 'connected',
                });
                // Also save to integrations subcollection
                await firestoreAdapter_1.firestoreAdapter.saveApiKeyToCollection(user.uid, {
                    publicKey: body.apiKey,
                    secretKey: body.secretKey,
                    exchange: 'binance',
                });
                // PART 2: Update user's apiConnected status and connectedExchanges
                const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
                const connectedExchanges = userData?.connectedExchanges || [];
                if (!connectedExchanges.includes('binance')) {
                    connectedExchanges.push('binance');
                }
                await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                    isApiConnected: true,
                    apiConnected: true, // Keep for backward compatibility
                    connectedExchanges,
                });
                // PART 2: Log activity
                await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'API_CONNECTED', {
                    message: 'Binance API connected successfully',
                    exchange: 'binance',
                });
                logger_1.logger.info({ uid: user.uid, exchange: 'binance' }, 'Binance API keys validated and saved');
            }
            catch (error) {
                logger_1.logger.error({ error: error.message, uid: user.uid }, 'Binance API key validation error');
                return reply.code(400).send({
                    error: `Binance API key validation failed: ${error.message}`,
                });
            }
        }
        return {
            message: 'Integration updated',
            apiName: body.apiName,
            enabled: true,
        };
    });
    // Delete an integration
    fastify.post('/delete', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = integrationDeleteSchema.parse(request.body);
        // Handle CoinAPI sub-types - check if apiType is provided in body
        let docName = body.apiName;
        if (body.apiName === 'coinapi' && request.body.apiType) {
            const t = request.body.apiType;
            docName = t.startsWith('coinapi_') ? t : `coinapi_${t}`;
        }
        await firestoreAdapter_1.firestoreAdapter.deleteIntegration(user.uid, docName);
        return { message: 'Integration deleted', apiName: body.apiName };
    });
    // Connect API (alias for update, for backward compatibility)
    fastify.post('/connect', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = integrationUpdateSchema.parse(request.body);
        // Handle CoinAPI sub-types
        let docName = body.apiName;
        if (body.apiName === 'coinapi' && body.apiType) {
            const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
            docName = t;
        }
        // Validate required fields based on API type
        if (body.apiName === 'binance') {
            if (body.enabled && (!body.apiKey || !body.secretKey)) {
                return reply.code(400).send({
                    error: 'Binance API requires both API key and secret key'
                });
            }
        }
        else {
            if (body.enabled && !body.apiKey) {
                return reply.code(400).send({
                    error: `${body.apiName} API requires an API key`
                });
            }
        }
        // If disabling, just update enabled status
        if (!body.enabled) {
            await firestoreAdapter_1.firestoreAdapter.saveIntegration(user.uid, docName, {
                enabled: false,
            });
            return { message: 'Integration disabled', apiName: body.apiName };
        }
        // If enabling, require keys
        const updateData = {
            enabled: true,
        };
        if (body.apiKey) {
            updateData.apiKey = body.apiKey;
        }
        if (body.secretKey) {
            updateData.secretKey = body.secretKey;
        }
        if (body.apiType) {
            updateData.apiType = body.apiType;
        }
        await firestoreAdapter_1.firestoreAdapter.saveIntegration(user.uid, docName, updateData);
        // PART 2: Also save to apiKeys collection if Binance with validation
        if (body.apiName === 'binance' && body.apiKey && body.secretKey) {
            // PART 2: Validate Binance API keys via connectivity test
            try {
                const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, body.secretKey, true); // Test with testnet first
                const validation = await testAdapter.validateApiKey();
                if (!validation.valid) {
                    return reply.code(400).send({
                        error: `Binance API key validation failed: ${validation.error || 'Invalid API key'}`,
                    });
                }
                if (!validation.canTrade) {
                    return reply.code(400).send({
                        error: 'API key does not have trading permissions. Please enable Spot & Margin Trading in Binance API settings.',
                    });
                }
                // Keys are valid - encrypt and save
                const db = admin.firestore((0, firebase_1.getFirebaseAdmin)());
                const apiKeysRef = db.collection('apiKeys').doc(user.uid);
                await apiKeysRef.set({
                    uid: user.uid,
                    exchange: 'binance',
                    apiKeyEncrypted: (0, keyManager_1.encrypt)(body.apiKey),
                    apiSecretEncrypted: (0, keyManager_1.encrypt)(body.secretKey),
                    createdAt: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                    status: 'connected',
                });
                // Also save to integrations subcollection
                await firestoreAdapter_1.firestoreAdapter.saveApiKeyToCollection(user.uid, {
                    publicKey: body.apiKey,
                    secretKey: body.secretKey,
                    exchange: 'binance',
                });
                // PART 2: Update user's apiConnected status and connectedExchanges
                const userData = await firestoreAdapter_1.firestoreAdapter.getUser(user.uid);
                const connectedExchanges = userData?.connectedExchanges || [];
                if (!connectedExchanges.includes('binance')) {
                    connectedExchanges.push('binance');
                }
                await firestoreAdapter_1.firestoreAdapter.createOrUpdateUser(user.uid, {
                    isApiConnected: true,
                    apiConnected: true, // Keep for backward compatibility
                    connectedExchanges,
                });
                // PART 2: Log activity
                await firestoreAdapter_1.firestoreAdapter.logActivity(user.uid, 'API_CONNECTED', {
                    message: 'Binance API connected successfully',
                    exchange: 'binance',
                });
                logger_1.logger.info({ uid: user.uid, exchange: 'binance' }, 'Binance API keys validated and saved');
            }
            catch (error) {
                logger_1.logger.error({ error: error.message, uid: user.uid }, 'Binance API key validation error');
                return reply.code(400).send({
                    error: `Binance API key validation failed: ${error.message}`,
                });
            }
        }
        return {
            message: 'API connected successfully',
            apiName: body.apiName,
            enabled: true,
        };
    });
    // Validate API integration
    fastify.post('/validate', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = integrationUpdateSchema.parse(request.body);
        try {
            // Handle CoinAPI sub-types
            let docName = body.apiName;
            if (body.apiName === 'coinapi' && body.apiType) {
                const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
                docName = t;
            }
            // Validate based on API type
            if (body.apiName === 'binance') {
                if (!body.apiKey || !body.secretKey) {
                    return reply.code(400).send({
                        error: 'Binance API requires both API key and secret key',
                        valid: false,
                    });
                }
                try {
                    const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, body.secretKey, true);
                    const validation = await testAdapter.validateApiKey();
                    return {
                        valid: validation.valid,
                        canTrade: validation.canTrade,
                        canWithdraw: validation.canWithdraw,
                        error: validation.error,
                        apiName: 'binance',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'Binance API validation failed',
                        apiName: 'binance',
                    });
                }
            }
            else if (body.apiName === 'cryptoquant') {
                if (!body.apiKey) {
                    return reply.code(400).send({
                        valid: false,
                        error: 'CryptoQuant API requires an API key',
                        apiName: 'cryptoquant',
                    });
                }
                try {
                    const { CryptoQuantAdapter } = await Promise.resolve().then(() => __importStar(require('../services/cryptoquantAdapter')));
                    const adapter = new CryptoQuantAdapter(body.apiKey);
                    // Test with a simple call
                    await adapter.getExchangeFlow('BTCUSDT');
                    return {
                        valid: true,
                        apiName: 'cryptoquant',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'CryptoQuant API validation failed',
                        apiName: 'cryptoquant',
                    });
                }
            }
            else if (body.apiName === 'lunarcrush') {
                if (!body.apiKey) {
                    return reply.code(400).send({
                        valid: false,
                        error: 'LunarCrush API requires an API key',
                        apiName: 'lunarcrush',
                    });
                }
                try {
                    const { LunarCrushAdapter } = await Promise.resolve().then(() => __importStar(require('../services/lunarcrushAdapter')));
                    const adapter = new LunarCrushAdapter(body.apiKey);
                    // Test with a simple call
                    await adapter.getCoinData('BTCUSDT');
                    return {
                        valid: true,
                        apiName: 'lunarcrush',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'LunarCrush API validation failed',
                        apiName: 'lunarcrush',
                    });
                }
            }
            else if (body.apiName === 'coinapi') {
                if (!body.apiKey || !body.apiType) {
                    return reply.code(400).send({
                        valid: false,
                        error: 'CoinAPI requires both API key and apiType',
                        apiName: 'coinapi',
                    });
                }
                try {
                    const { CoinAPIAdapter } = await Promise.resolve().then(() => __importStar(require('../services/coinapiAdapter')));
                    const apiTypePlain = (body.apiType.startsWith('coinapi_') ? body.apiType.replace('coinapi_', '') : body.apiType);
                    const adapter = new CoinAPIAdapter(body.apiKey, apiTypePlain);
                    // Test based on type
                    if (body.apiType === 'market' || body.apiType === 'coinapi_market') {
                        await adapter.getMarketData('BTCUSDT');
                    }
                    else if (body.apiType === 'flatfile' || body.apiType === 'coinapi_flatfile') {
                        await adapter.getHistoricalData('BTCUSDT', 1);
                    }
                    else if (body.apiType === 'exchangerate' || body.apiType === 'coinapi_exchangerate') {
                        await adapter.getExchangeRate('BTC', 'USD');
                    }
                    return {
                        valid: true,
                        apiName: 'coinapi',
                        apiType: body.apiType,
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'CoinAPI validation failed',
                        apiName: 'coinapi',
                        apiType: body.apiType,
                    });
                }
            }
            return reply.code(400).send({
                valid: false,
                error: 'Unknown API name',
            });
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid: user.uid }, 'API validation error');
            return reply.code(500).send({
                valid: false,
                error: error.message || 'Internal server error',
            });
        }
    });
}
