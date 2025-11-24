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
const exchangeConnector_1 = require("../services/exchangeConnector");
const logger_1 = require("../utils/logger");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
// Validation schemas
const exchangeNameSchema = zod_1.z.string().min(2, 'Exchange name is required').max(64, 'Exchange name too long').trim();
const credentialSchema = zod_1.z.string().min(1, 'Field is required').max(512, 'Value too long').trim();
const SINGLE_EXCHANGE_NAMES = ['bybit', 'mexc', 'kucoin', 'bingx', 'okx', 'weex', 'bitget'];
const integrationUpdateSchema = zod_1.z.object({
    apiName: exchangeNameSchema.optional(),
    exchange: exchangeNameSchema.optional(), // Support both apiName/exchange for backward compatibility
    exchangeName: exchangeNameSchema.optional(),
    enabled: zod_1.z.boolean().default(true),
    apiKey: credentialSchema.optional(),
    secretKey: credentialSchema.optional(),
    apiSecret: credentialSchema.optional(),
    passphrase: zod_1.z.string().max(512, 'Passphrase too long').trim().optional(),
    apiType: zod_1.z.string().max(64, 'apiType too long').trim().optional(),
    validate: zod_1.z.boolean().optional(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
    label: zod_1.z.string().max(64).trim().optional(),
    userId: zod_1.z.string().trim().optional(),
});
const integrationDeleteSchema = zod_1.z.object({
    apiName: exchangeNameSchema,
    apiType: zod_1.z.string().max(64).trim().optional(),
});
const integrationSubmitSchema = zod_1.z.object({
    exchangeName: exchangeNameSchema,
    apiKey: credentialSchema,
    apiSecret: credentialSchema.optional(),
    secretKey: credentialSchema.optional(),
    passphrase: zod_1.z.string().max(512).trim().optional(),
    label: zod_1.z.string().max(64).trim().optional(),
    validate: zod_1.z.boolean().optional(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
    userId: zod_1.z.string().trim().optional(),
});
const normalizeExchangeId = (value) => {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
    return normalized || 'exchange';
};
const resolveStatus = (integration) => {
    if (integration.status === 'VERIFIED' || integration.status === 'SAVED') {
        return 'CONNECTED';
    }
    return integration.status || (integration.enabled ? 'CONNECTED' : 'DISABLED');
};
const buildIntegrationList = (integrations) => {
    return Object.entries(integrations).map(([docName, integration]) => ({
        id: docName,
        exchangeName: integration.exchangeName || docName,
        status: resolveStatus(integration),
        enabled: integration.enabled,
        maskedApiKey: integration.apiKey ? (0, keyManager_1.maskKey)(integration.apiKey) : null,
        maskedSecretKey: integration.secretKey ? (0, keyManager_1.maskKey)(integration.secretKey) : null,
        updatedAt: integration.updatedAt?.toDate().toISOString(),
        createdAt: integration.createdAt?.toDate().toISOString(),
        meta: integration.meta || null,
    }));
};
const credentialValidatorFactories = {
    binance: async () => ({
        name: 'binance',
        requiresSecret: true,
        validate: async (creds) => {
            const adapter = new binanceAdapter_1.BinanceAdapter(creds.apiKey, creds.apiSecret || '', false);
            await adapter.getAccount();
        },
    }),
    bitget: async () => {
        const { BitgetAdapter } = await Promise.resolve().then(() => __importStar(require('../services/bitgetAdapter')));
        return {
            name: 'bitget',
            requiresSecret: true,
            requiresPassphrase: true,
            validate: async (creds) => {
                const adapter = new BitgetAdapter(creds.apiKey, creds.apiSecret || '', creds.passphrase || '', false);
                await adapter.getAccount();
            },
        };
    },
    bingx: async () => {
        const { BingXAdapter } = await Promise.resolve().then(() => __importStar(require('../services/bingXAdapter')));
        return {
            name: 'bingx',
            requiresSecret: true,
            validate: async (creds) => {
                const adapter = new BingXAdapter(creds.apiKey, creds.apiSecret || '', false);
                await adapter.getAccount();
            },
        };
    },
    weex: async () => {
        const { WeexAdapter } = await Promise.resolve().then(() => __importStar(require('../services/weexAdapter')));
        return {
            name: 'weex',
            requiresSecret: true,
            requiresPassphrase: true,
            validate: async (creds) => {
                const adapter = new WeexAdapter(creds.apiKey, creds.apiSecret || '', creds.passphrase, false);
                await adapter.getAccount();
            },
        };
    },
    kucoin: async () => {
        const { KucoinAdapter } = await Promise.resolve().then(() => __importStar(require('../services/kucoinAdapter')));
        return {
            name: 'kucoin',
            requiresSecret: true,
            requiresPassphrase: true,
            validate: async (creds) => {
                const adapter = new KucoinAdapter(creds.apiKey, creds.apiSecret || '', creds.passphrase);
                await adapter.getAccount();
            },
        };
    },
};
/**
 * Ensure free APIs are enabled for a user
 * This auto-enables Binance, CoinGecko, and Google Finance for all users
 */
async function ensureFreeAPIsEnabled(uid) {
    // Import db function directly
    const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
    const admin = await Promise.resolve().then(() => __importStar(require('firebase-admin')));
    const integrationsRef = admin.firestore(getFirebaseAdmin())
        .collection('users')
        .doc(uid)
        .collection('integrations');
    const freeAPIs = [
        { name: 'binance', displayName: 'Binance Public API' },
        { name: 'coingecko', displayName: 'CoinGecko API' },
        { name: 'googlefinance', displayName: 'Google Finance' }
    ];
    for (const api of freeAPIs) {
        const docRef = integrationsRef.doc(api.name);
        const doc = await docRef.get();
        if (!doc.exists) {
            // Create new free API integration
            await docRef.set({
                enabled: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            logger_1.logger.info({ uid, apiName: api.name }, `Auto-enabled free API: ${api.displayName}`);
        }
        else {
            // Ensure it's enabled
            const data = doc.data();
            if (!data?.enabled) {
                await docRef.update({
                    enabled: true,
                    updatedAt: new Date()
                });
                logger_1.logger.info({ uid, apiName: api.name }, `Auto-re-enabled free API: ${api.displayName}`);
            }
        }
    }
}
const runCredentialValidation = async (exchangeName, creds, shouldValidate) => {
    if (!shouldValidate) {
        return { status: 'SAVED', message: 'Validation skipped' };
    }
    const key = exchangeName.trim().toLowerCase();
    const factory = credentialValidatorFactories[key];
    if (!factory) {
        return {
            status: 'UNVERIFIED',
            message: 'Validation skipped: no adapter available',
            meta: { reason: 'NO_ADAPTER' },
        };
    }
    try {
        const validator = await factory();
        if (validator.requiresSecret && !creds.apiSecret) {
            return {
                status: 'UNVERIFIED',
                message: 'Validation skipped: missing API secret',
                meta: { reason: 'MISSING_SECRET', adapter: validator.name },
            };
        }
        if (validator.requiresPassphrase && !creds.passphrase) {
            return {
                status: 'UNVERIFIED',
                message: 'Validation skipped: missing passphrase',
                meta: { reason: 'MISSING_PASSPHRASE', adapter: validator.name },
            };
        }
        await validator.validate(creds);
        return {
            status: 'VERIFIED',
            message: `${validator.name} credentials verified`,
            meta: { adapter: validator.name },
        };
    }
    catch (error) {
        logger_1.logger.warn({ exchangeName, error: error.message }, 'Credential validation failed');
        return {
            status: 'UNVERIFIED',
            message: error.message || 'Validation failed',
            meta: { reason: 'VALIDATION_FAILED', adapter: key },
        };
    }
};
async function integrationsRoutes(fastify) {
    const formatIntegrations = (integrations) => {
        const result = {};
        const coinApiTypes = {};
        for (const [docName, integration] of Object.entries(integrations)) {
            const basePayload = {
                enabled: integration.enabled,
                status: resolveStatus(integration),
                exchangeName: integration.exchangeName || docName,
                apiKey: integration.apiKey ? (0, keyManager_1.maskKey)(integration.apiKey) : null,
                secretKey: integration.secretKey ? (0, keyManager_1.maskKey)(integration.secretKey) : null,
                apiType: integration.apiType || null,
                updatedAt: integration.updatedAt?.toDate().toISOString(),
                createdAt: integration.createdAt?.toDate().toISOString(),
                meta: integration.meta || null,
            };
            if (docName.startsWith('coinapi_')) {
                const type = docName.replace('coinapi_', '');
                coinApiTypes[type] = {
                    ...basePayload,
                    apiType: type,
                };
            }
            else {
                result[docName] = basePayload;
            }
        }
        if (Object.keys(coinApiTypes).length > 0) {
            result.coinapi = coinApiTypes;
        }
        return result;
    };
    // Load all integrations for the user
    fastify.get('/load', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        // Ensure all default integrations exist for the user
        await firestoreAdapter_1.firestoreAdapter.ensureDefaultIntegrations(user.uid);
        const integrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(user.uid);
        return formatIntegrations(integrations);
    });
    fastify.get('/fetch', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            let integrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(user.uid);
            // If no integrations exist, ensure default integrations are created
            if (Object.keys(integrations).length === 0) {
                await firestoreAdapter_1.firestoreAdapter.ensureDefaultIntegrations(user.uid);
                integrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(user.uid);
            }
            const formatted = formatIntegrations(integrations);
            const list = buildIntegrationList(integrations);
            const active = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(user.uid);
            // Handle fallback object when no exchange is configured
            const activeExchangeName = (active && typeof active === 'object' && 'exchangeConfigured' in active && active.exchangeConfigured === false)
                ? null
                : (active && 'name' in active ? active.name : null);
            // Add default providers that are always available
            const defaultProviders = firestoreAdapter_1.firestoreAdapter.getDefaultProviders();
            const allProviders = { ...defaultProviders, ...formatted };
            // Separate real exchanges from data providers
            const realExchanges = firestoreAdapter_1.firestoreAdapter.getRealExchanges();
            const dataProviders = ['binance', 'coingecko', 'googlefinance', 'marketaux', 'cryptocompare'];
            // Data providers section: always show all 5 (defaults + stored configs)
            const providerIntegrations = Object.fromEntries(Object.entries(allProviders).filter(([key]) => dataProviders.includes(key)));
            // Real exchanges section: only show actual trading exchanges from Firestore (not defaults)
            const exchangeIntegrations = Object.fromEntries(Object.entries(formatted).filter(([key]) => realExchanges.includes(key)));
            return {
                ok: true,
                activeExchange: activeExchangeName,
                dataProviders: providerIntegrations,
                realExchanges: exchangeIntegrations,
                integrations: allProviders, // Keep for backward compatibility
                list,
                count: list.length,
            };
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid: request.user?.uid }, 'Failed to fetch integrations');
            return reply.code(500).send({
                ok: false,
                code: 'FETCH_FAILED',
                message: error.message || 'Failed to fetch integrations',
            });
        }
    });
    fastify.post('/submit', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const uid = user?.uid;
        if (!uid || typeof uid !== 'string') {
            return reply.code(401).send({
                ok: false,
                code: 'UNAUTHENTICATED',
                message: 'Authentication required',
            });
        }
        let body;
        try {
            body = integrationSubmitSchema.parse(request.body);
        }
        catch (err) {
            return reply.code(400).send({
                ok: false,
                code: 'INVALID_PAYLOAD',
                message: 'Invalid request data',
                details: err.errors || err.message,
            });
        }
        if (body.userId && body.userId !== uid) {
            return reply.code(403).send({
                ok: false,
                code: 'USER_MISMATCH',
                message: 'You can only submit credentials for your own account',
            });
        }
        const existingIntegrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(uid);
        const displayName = body.exchangeName.trim();
        const docName = normalizeExchangeId(displayName);
        const normalizedExchangeName = displayName.toLowerCase();
        const secret = body.apiSecret || body.secretKey;
        const shouldValidate = body.validate === true;
        const existingActiveExchange = Object.entries(existingIntegrations).find(([storedName, integration]) => {
            if (!integration.enabled)
                return false;
            const normalized = (integration.exchangeName || storedName).toLowerCase();
            return SINGLE_EXCHANGE_NAMES.includes(normalized);
        });
        if (existingActiveExchange) {
            const activeName = (existingActiveExchange[1].exchangeName || existingActiveExchange[0]).toLowerCase();
            if (activeName !== normalizedExchangeName) {
                return reply.code(409).send({
                    ok: false,
                    code: 'ONLY_ONE_EXCHANGE_ALLOWED',
                    message: 'Only one exchange can be connected at a time. Disable the existing exchange before adding another.',
                });
            }
        }
        const validationResult = await runCredentialValidation(docName, {
            apiKey: body.apiKey,
            apiSecret: secret,
            passphrase: body.passphrase,
        }, shouldValidate);
        const status = validationResult.status;
        const label = body.label?.trim() || displayName;
        const meta = {
            label,
            displayName,
            validateRequested: shouldValidate,
            submittedAt: new Date().toISOString(),
            validation: {
                status,
                message: validationResult.message,
                ...(validationResult.meta || {}),
            },
        };
        if (body.metadata) {
            meta.extra = body.metadata;
        }
        try {
            await firestoreAdapter_1.firestoreAdapter.saveIntegration(uid, docName, {
                enabled: true,
                apiKey: body.apiKey,
                secretKey: secret,
                passphrase: body.passphrase,
                status,
                exchangeName: normalizedExchangeName,
                meta,
                userId: uid,
            });
            logger_1.logger.info({
                uid,
                exchangeName: displayName,
                normalizedExchange: docName,
                status,
                maskedKey: (0, keyManager_1.maskKey)(body.apiKey),
                result: status === 'VERIFIED' ? 'SUCCESS' : status,
            }, 'Integration submission processed');
            return reply.send({
                ok: true,
                id: docName,
                status,
                message: validationResult.message || 'API saved',
                integration: {
                    id: docName,
                    exchangeName: displayName,
                    status,
                    enabled: true,
                },
            });
        }
        catch (error) {
            const errorId = `integration_submit_${Date.now()}`;
            logger_1.logger.error({
                uid,
                exchangeName: displayName,
                normalizedExchange: docName,
                error: error.message,
                maskedKey: (0, keyManager_1.maskKey)(body.apiKey),
                errorId,
            }, 'Failed to save integration via submit');
            return reply.code(500).send({
                ok: false,
                code: 'INTEGRATION_SAVE_FAILED',
                message: 'Failed to save API credentials',
                errorId,
            });
        }
    });
    // Update or create an integration  
    // POST /api/integrations/save - Save research API integration
    fastify.post('/save', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const uid = user.uid;
        // Validate UID from auth (server-side only)
        if (!uid || typeof uid !== 'string') {
            logger_1.logger.error({ uid }, 'Invalid UID in request');
            return reply.code(400).send({ error: 'Invalid user authentication' });
        }
        let body;
        try {
            body = integrationUpdateSchema.parse(request.body);
        }
        catch (err) {
            logger_1.logger.error({ err, uid }, 'Invalid payload in save integration');
            return reply.code(400).send({
                error: 'Invalid request data',
                details: err.errors || err.message
            });
        }
        const secretKey = body.secretKey || body.apiSecret;
        // Handle CoinAPI sub-types
        let docName = body.apiName;
        if (body.apiName === 'coinapi' && body.apiType) {
            // Accept both 'market' and 'coinapi_market' - normalize to 'coinapi_market'
            const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
            docName = t;
        }
        // Validate required fields based on API type
        // Free APIs don't require API keys
        const freeAPIs = ['binance', 'coingecko', 'googlefinance'];
        const isFreeAPI = freeAPIs.includes(body.apiName);
        if (!isFreeAPI && body.apiName === 'binance') {
            if (body.enabled && (!body.apiKey || !secretKey)) {
                return reply.code(400).send({
                    error: 'Binance API requires both API key and secret key'
                });
            }
        }
        else if (!isFreeAPI) {
            if (body.enabled && !body.apiKey) {
                return reply.code(400).send({
                    error: `${body.apiName} API requires an API key`
                });
            }
        }
        // If disabling, just update enabled status
        if (!body.enabled) {
            try {
                const result = await firestoreAdapter_1.firestoreAdapter.saveIntegration(uid, docName, {
                    enabled: false,
                });
                return {
                    ok: true,
                    doc: result
                };
            }
            catch (error) {
                logger_1.logger.error({ error: error.message, uid, docName }, 'Failed to disable integration');
                return reply.code(500).send({
                    error: `Failed to disable integration: ${error.message}`
                });
            }
        }
        // If enabling, require keys
        const updateData = {
            enabled: true,
        };
        if (body.apiKey) {
            updateData.apiKey = body.apiKey;
        }
        if (secretKey) {
            updateData.secretKey = secretKey;
        }
        if (body.apiType) {
            updateData.apiType = body.apiType;
        }
        try {
            logger_1.logger.info({ uid, integration: docName }, 'Saving integration');
            // Encrypt and save with post-verification
            const result = await firestoreAdapter_1.firestoreAdapter.saveIntegration(uid, docName, updateData);
            logger_1.logger.info({ uid, path: result.path }, 'Write success');
            return {
                ok: true,
                doc: result
            };
        }
        catch (error) {
            // Generate error ID for correlation
            const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            // Log error to admin/errors collection
            try {
                await firestoreAdapter_1.firestoreAdapter.logError(errorId, {
                    uid,
                    path: `users/${uid}/integrations/${docName}`,
                    message: 'Failed to save integration',
                    error: error.message,
                    stack: error.stack,
                    metadata: { docName, apiName: body.apiName },
                });
            }
            catch (logError) {
                logger_1.logger.error({ logError: logError.message }, 'Failed to log error to admin/errors');
            }
            logger_1.logger.error({ error: error.message, uid, docName, errorId }, 'Post-save failed');
            // Check if it's an encryption error
            if (error.message.includes('Encryption failed')) {
                return reply.code(500).send({
                    error: 'Failed to encrypt API key',
                    errorId
                });
            }
            // Retry once if post-save verification failed
            if (error.message.includes('Post-save verification failed')) {
                try {
                    logger_1.logger.info({ uid, docName }, 'Retrying save after verification failure');
                    const retryResult = await firestoreAdapter_1.firestoreAdapter.saveIntegration(uid, docName, updateData);
                    logger_1.logger.info({ uid, path: retryResult.path }, 'Retry write success');
                    return {
                        ok: true,
                        doc: retryResult
                    };
                }
                catch (retryError) {
                    logger_1.logger.error({ error: retryError.message, uid, docName, errorId }, 'Retry failed');
                    return reply.code(500).send({
                        error: 'Failed to save integration after retry',
                        errorId
                    });
                }
            }
            return reply.code(500).send({
                error: `Failed to save integration: ${error.message}`,
                errorId
            });
        }
    });
    // Update or create an integration (alias for /save, for frontend compatibility)
    fastify.post('/update', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const uid = user.uid;
        if (!uid || typeof uid !== 'string') {
            return reply.code(400).send({ success: false, message: 'Invalid user authentication' });
        }
        let body;
        try {
            body = integrationUpdateSchema.parse(request.body);
        }
        catch (err) {
            return reply.code(400).send({ success: false, message: 'Invalid request data', details: err.errors || err.message });
        }
        const secretKey = body.secretKey || body.apiSecret;
        if (body.exchange && !body.apiName) {
            body.apiName = body.exchange;
        }
        if (!body.apiName) {
            return reply.code(400).send({ success: false, message: 'Missing required field: apiName or exchange' });
        }
        let docName = body.apiName;
        if (body.apiName === 'coinapi' && body.apiType) {
            const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
            docName = t;
        }
        const exchangeName = (body.apiName || '').toLowerCase();
        const exchangeApis = new Set(Object.keys(credentialValidatorFactories));
        const isExchangeApi = exchangeApis.has(exchangeName);
        if (!body.enabled) {
            const result = await firestoreAdapter_1.firestoreAdapter.saveIntegration(uid, docName, {
                enabled: false,
                ...(isExchangeApi ? { apiType: 'exchange' } : {}),
            });
            const verification = await firestoreAdapter_1.firestoreAdapter.getIntegration(uid, docName);
            if (!verification) {
                return reply.code(500).send({ success: false, message: 'Integration verification failed after disable' });
            }
            return reply.send({ success: true, message: 'Integration disabled successfully', doc: result });
        }
        // --- Unified live validation logic ---
        try {
            if (isExchangeApi) {
                if (!body.apiKey || !secretKey) {
                    return reply.code(400).send({ success: false, message: `${body.apiName} API requires both API key and secret key` });
                }
                if ((body.apiName === 'bitget' || body.apiName === 'weex') && !body.passphrase) {
                    return reply.code(400).send({ success: false, message: `${body.apiName} API requires passphrase in addition to API key and secret key` });
                }
                // Instantiate correct adapter and call its validation endpoint
                if (body.apiName === 'binance') {
                    const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, secretKey, false); // use production, not testnet
                    await testAdapter.getAccount();
                }
                else if (body.apiName === 'bitget') {
                    const { BitgetAdapter } = await Promise.resolve().then(() => __importStar(require('../services/bitgetAdapter')));
                    const adapter = new BitgetAdapter(body.apiKey, secretKey, body.passphrase, false);
                    await adapter.getAccount(); // implement getAccount to use /api/spot/v1/account/assets
                }
                else if (body.apiName === 'bingx') {
                    const { BingXAdapter } = await Promise.resolve().then(() => __importStar(require('../services/bingXAdapter')));
                    const adapter = new BingXAdapter(body.apiKey, secretKey, false);
                    await adapter.getAccount(); // implement getAccount to use /api/v1/user/getBalance
                }
                else if (body.apiName === 'weex') {
                    const { WeexAdapter } = await Promise.resolve().then(() => __importStar(require('../services/weexAdapter')));
                    const adapter = new WeexAdapter(body.apiKey, secretKey, body.passphrase, false);
                    await adapter.getAccount(); // implement getAccount to use /api/v1/private/account
                }
                else if (body.apiName === 'kucoin') {
                    const { KucoinAdapter } = await Promise.resolve().then(() => __importStar(require('../services/kucoinAdapter')));
                    const adapter = new KucoinAdapter(body.apiKey, secretKey, body.passphrase);
                    await adapter.getAccount(); // implement getAccount to use /api/v1/accounts
                }
            }
            else if (!body.apiKey) {
                return reply.code(400).send({ success: false, message: `${body.apiName} API requires an API key` });
            }
            // If validation succeeds, save integration
            const updateData = { enabled: true };
            if (body.apiKey)
                updateData.apiKey = body.apiKey;
            if (secretKey)
                updateData.secretKey = secretKey;
            if (body.passphrase)
                updateData.passphrase = body.passphrase;
            if (isExchangeApi) {
                updateData.apiType = 'exchange';
            }
            else if (body.apiType) {
                updateData.apiType = body.apiType;
            }
            if (body.passphrase)
                updateData.passphrase = body.passphrase;
            const result = await firestoreAdapter_1.firestoreAdapter.saveIntegration(uid, docName, updateData);
            const verification = await firestoreAdapter_1.firestoreAdapter.getIntegration(uid, docName);
            if (!verification) {
                return reply.code(500).send({ success: false, message: 'Integration verification failed after save' });
            }
            return reply.send({ success: true, message: 'Integration updated successfully', doc: result });
        }
        catch (validationErr) {
            return reply.code(400).send({ success: false, message: 'Invalid API key or secret' });
        }
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
        const secretKey = body.secretKey || body.apiSecret;
        // Handle CoinAPI sub-types
        let docName = body.apiName;
        if (body.apiName === 'coinapi' && body.apiType) {
            const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
            docName = t;
        }
        // Validate required fields based on API type
        if (body.apiName === 'binance') {
            if (body.enabled && (!body.apiKey || !secretKey)) {
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
        if (secretKey) {
            updateData.secretKey = secretKey;
        }
        if (body.apiType) {
            updateData.apiType = body.apiType;
        }
        await firestoreAdapter_1.firestoreAdapter.saveIntegration(user.uid, docName, updateData);
        // PART 2: Also save to apiKeys collection if Binance with validation
        if (body.apiName === 'binance' && body.apiKey && secretKey) {
            // PART 2: Validate Binance API keys via connectivity test
            try {
                const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, secretKey, true); // Test with testnet first
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
                    apiSecretEncrypted: (0, keyManager_1.encrypt)(secretKey),
                    createdAt: admin.firestore.Timestamp.now(),
                    updatedAt: admin.firestore.Timestamp.now(),
                    status: 'connected',
                });
                // Also save to integrations subcollection
                await firestoreAdapter_1.firestoreAdapter.saveApiKeyToCollection(user.uid, {
                    publicKey: body.apiKey,
                    secretKey: secretKey,
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
        const secretKey = body.secretKey || body.apiSecret;
        try {
            // Handle CoinAPI sub-types
            let docName = body.apiName;
            if (body.apiName === 'coinapi' && body.apiType) {
                const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
                docName = t;
            }
            // Validate based on API type
            if (body.apiName === 'binance') {
                if (!body.apiKey || !secretKey) {
                    return reply.code(400).send({
                        error: 'Binance API requires both API key and secret key',
                        valid: false,
                    });
                }
                try {
                    const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, secretKey, true);
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
            else if (body.apiName === 'cryptocompare') {
                if (!body.apiKey) {
                    return reply.code(400).send({
                        valid: false,
                        error: 'CryptoCompare API requires an API key',
                        apiName: 'cryptocompare',
                    });
                }
                try {
                    const { CryptoCompareAdapter } = await Promise.resolve().then(() => __importStar(require('../services/cryptoCompareAdapter')));
                    const adapter = new CryptoCompareAdapter(body.apiKey);
                    // Test with a simple call
                    await adapter.getAllMetrics('BTCUSDT');
                    return {
                        valid: true,
                        apiName: 'cryptocompare',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'CryptoCompare API validation failed',
                        apiName: 'cryptocompare',
                    });
                }
            }
            else if (body.apiName === 'marketaux') {
                if (!body.apiKey) {
                    return reply.code(400).send({
                        valid: false,
                        error: 'MarketAux API requires an API key',
                        apiName: 'marketaux',
                    });
                }
                try {
                    const { MarketAuxAdapter } = await Promise.resolve().then(() => __importStar(require('../services/MarketAuxAdapter')));
                    const adapter = new MarketAuxAdapter(body.apiKey);
                    // Test with a simple call
                    await adapter.getNewsSentiment('BTC');
                    return {
                        valid: true,
                        apiName: 'marketaux',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'MarketAux API validation failed',
                        apiName: 'marketaux',
                    });
                }
                // NOTE: CoinAPI is no longer supported - replaced with free APIs
            }
            else if (body.apiName === 'binance') {
                // Free API - no key required, just test connectivity
                try {
                    const { BinanceAdapter } = await Promise.resolve().then(() => __importStar(require('../services/binanceAdapter')));
                    const adapter = new BinanceAdapter();
                    await adapter.getMarketData('BTCUSDT');
                    return {
                        valid: true,
                        apiName: 'binance',
                        message: 'Binance public API accessible',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'Binance API test failed',
                        apiName: 'binance',
                    });
                }
            }
            else if (body.apiName === 'coingecko') {
                // Free API - no key required, just test connectivity
                try {
                    const { CoinGeckoAdapter } = await Promise.resolve().then(() => __importStar(require('../services/coingeckoAdapter')));
                    await CoinGeckoAdapter.getHistoricalData('BTCUSDT', 1);
                    return {
                        valid: true,
                        apiName: 'coingecko',
                        message: 'CoinGecko API accessible',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'CoinGecko API test failed',
                        apiName: 'coingecko',
                    });
                }
            }
            else if (body.apiName === 'googlefinance') {
                // Free API - no key required, just test connectivity
                try {
                    const { GoogleFinanceAdapter } = await Promise.resolve().then(() => __importStar(require('../services/googleFinanceAdapter')));
                    await GoogleFinanceAdapter.getExchangeRate('USD', 'INR');
                    return {
                        valid: true,
                        apiName: 'googlefinance',
                        message: 'Google Finance accessible',
                    };
                }
                catch (error) {
                    return reply.code(400).send({
                        valid: false,
                        error: error.message || 'Google Finance test failed',
                        apiName: 'googlefinance',
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
    // GET /api/integrations/status - Get detailed status for all user integrations
    fastify.get('/status', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const uid = user?.uid;
            if (!uid) {
                return reply.code(401).send({
                    ok: false,
                    message: 'Authentication required',
                });
            }
            const integrations = await firestoreAdapter_1.firestoreAdapter.getAllIntegrations(uid);
            const statusResults = {};
            // Define which integrations are exchanges vs providers
            const exchangeIntegrations = ['binance', 'bitget', 'bingx', 'weex', 'kucoin'];
            const providerIntegrations = ['marketaux', 'cryptocompare'];
            // Process exchange integrations
            for (const exchangeName of exchangeIntegrations) {
                const integration = integrations[exchangeName];
                if (!integration || !integration.enabled || !integration.apiKey) {
                    statusResults[exchangeName] = {
                        isConnected: false,
                        exchangeName: integration?.exchangeName || exchangeName,
                        apiKeyStatus: 'missing',
                        connectionStatus: 'disconnected',
                        message: 'API key not configured',
                        type: 'exchange'
                    };
                    continue;
                }
                try {
                    // Decrypt credentials
                    const apiKey = (0, keyManager_1.decrypt)(integration.apiKey);
                    const secretKey = integration.secretKey ? (0, keyManager_1.decrypt)(integration.secretKey) : undefined;
                    const passphrase = integration.passphrase ? (0, keyManager_1.decrypt)(integration.passphrase) : undefined;
                    if (!apiKey) {
                        statusResults[exchangeName] = {
                            isConnected: false,
                            exchangeName: integration.exchangeName || exchangeName,
                            apiKeyStatus: 'invalid',
                            connectionStatus: 'disconnected',
                            message: 'API key decryption failed',
                            type: 'exchange'
                        };
                        continue;
                    }
                    // Test connection by creating adapter and testing
                    const adapter = exchangeConnector_1.ExchangeConnectorFactory.create(exchangeName, {
                        apiKey,
                        secret: secretKey || '',
                        passphrase,
                        testnet: integration.testnet ?? false,
                    });
                    // Test connection (use getBalance as it's a good connectivity test)
                    try {
                        await adapter.getBalance();
                        statusResults[exchangeName] = {
                            isConnected: true,
                            exchangeName: integration.exchangeName || exchangeName,
                            apiKeyStatus: 'valid',
                            connectionStatus: 'connected',
                            message: 'API connection successful',
                            testnet: integration.testnet ?? false,
                            type: 'exchange'
                        };
                    }
                    catch (connectionError) {
                        statusResults[exchangeName] = {
                            isConnected: false,
                            exchangeName: integration.exchangeName || exchangeName,
                            apiKeyStatus: 'valid',
                            connectionStatus: 'connection_failed',
                            message: connectionError.message || 'Connection test failed',
                            testnet: integration.testnet ?? false,
                            type: 'exchange'
                        };
                    }
                }
                catch (error) {
                    statusResults[exchangeName] = {
                        isConnected: false,
                        exchangeName: integration.exchangeName || exchangeName,
                        apiKeyStatus: 'error',
                        connectionStatus: 'error',
                        message: error.message || 'Status check failed',
                        type: 'exchange'
                    };
                }
            }
            // Process provider integrations
            for (const providerName of providerIntegrations) {
                const integration = integrations[providerName];
                if (!integration || !integration.enabled || !integration.apiKey) {
                    statusResults[providerName] = {
                        isConnected: false,
                        exchangeName: integration?.exchangeName || providerName,
                        apiKeyStatus: 'missing',
                        connectionStatus: 'disconnected',
                        message: 'API key not configured',
                        type: 'provider'
                    };
                    continue;
                }
                try {
                    // Decrypt API key
                    const apiKey = (0, keyManager_1.decrypt)(integration.apiKey);
                    if (!apiKey) {
                        statusResults[providerName] = {
                            isConnected: false,
                            exchangeName: integration.exchangeName || providerName,
                            apiKeyStatus: 'invalid',
                            connectionStatus: 'disconnected',
                            message: 'API key decryption failed',
                            type: 'provider'
                        };
                        continue;
                    }
                    // Test provider connection by making actual API call
                    try {
                        if (providerName === 'marketaux') {
                            // Test MarketAux by calling getNewsSentiment
                            const { MarketAuxAdapter } = await Promise.resolve().then(() => __importStar(require('../services/MarketAuxAdapter')));
                            const adapter = new MarketAuxAdapter(apiKey);
                            await adapter.getNewsSentiment('BTC'); // Test with BTC
                            statusResults[providerName] = {
                                isConnected: true,
                                exchangeName: integration.exchangeName || providerName,
                                apiKeyStatus: 'valid',
                                connectionStatus: 'connected',
                                message: 'API connection successful',
                                type: 'provider'
                            };
                        }
                        else if (providerName === 'cryptocompare') {
                            // Test CryptoCompare by calling getAllMetrics
                            const { CryptoCompareAdapter } = await Promise.resolve().then(() => __importStar(require('../services/cryptoCompareAdapter')));
                            const adapter = new CryptoCompareAdapter(apiKey);
                            await adapter.getAllMetrics('BTC');
                            statusResults[providerName] = {
                                isConnected: true,
                                exchangeName: integration.exchangeName || providerName,
                                apiKeyStatus: 'valid',
                                connectionStatus: 'connected',
                                message: 'API connection successful',
                                type: 'provider'
                            };
                        }
                    }
                    catch (connectionError) {
                        statusResults[providerName] = {
                            isConnected: false,
                            exchangeName: integration.exchangeName || providerName,
                            apiKeyStatus: 'valid',
                            connectionStatus: 'connection_failed',
                            message: connectionError.message || 'Connection test failed',
                            type: 'provider'
                        };
                    }
                }
                catch (error) {
                    statusResults[providerName] = {
                        isConnected: false,
                        exchangeName: integration.exchangeName || providerName,
                        apiKeyStatus: 'error',
                        connectionStatus: 'error',
                        message: error.message || 'Status check failed',
                        type: 'provider'
                    };
                }
            }
            // Process Free APIs (no API keys required)
            for (const [integrationName, integration] of Object.entries(integrations)) {
                if (!['binance', 'coingecko', 'googlefinance'].includes(integrationName))
                    continue;
                const displayNames = {
                    binance: 'Binance Public API',
                    coingecko: 'CoinGecko API',
                    googlefinance: 'Google Finance'
                };
                // Free APIs are always "enabled" since they don't require keys
                const isEnabled = integration ? integration.enabled !== false : true;
                if (!isEnabled) {
                    statusResults[integrationName] = {
                        isConnected: false,
                        exchangeName: displayNames[integrationName],
                        apiKeyStatus: 'not_required',
                        connectionStatus: 'disabled',
                        message: 'API disabled',
                        type: 'free'
                    };
                    continue;
                }
                // For free APIs, we assume they are accessible since they don't require API keys
                statusResults[integrationName] = {
                    isConnected: true,
                    exchangeName: displayNames[integrationName],
                    apiKeyStatus: 'not_required',
                    connectionStatus: 'connected',
                    message: 'Free API accessible',
                    type: 'free'
                };
            }
            return {
                ok: true,
                status: statusResults,
                timestamp: new Date().toISOString(),
            };
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid: request.user?.uid }, 'Failed to get integration status');
            return reply.code(500).send({
                ok: false,
                message: error.message || 'Failed to get integration status',
            });
        }
    });
}
