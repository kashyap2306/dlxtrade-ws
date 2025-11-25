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
exports.exchangeRoutes = exchangeRoutes;
const zod_1 = require("zod");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const exchangeConnector_1 = require("../services/exchangeConnector");
const keyManager_1 = require("../services/keyManager");
const logger_1 = require("../utils/logger");
const admin = __importStar(require("firebase-admin"));
const exchangeConfigSchema = zod_1.z.object({
    exchange: zod_1.z.enum(['binance', 'bitget', 'weex', 'bingx', 'cryptoquant', 'lunarcrush', 'coinapi']).optional(),
    type: zod_1.z.enum(['binance', 'bitget', 'weex', 'bingx', 'cryptoquant', 'lunarcrush', 'coinapi']).optional(),
    apiKey: zod_1.z.string().min(1),
    secret: zod_1.z.string().min(1).optional(),
    passphrase: zod_1.z.string().optional(),
    testnet: zod_1.z.boolean().optional().default(true),
});
async function exchangeRoutes(fastify) {
    // POST /api/users/:id/exchange-config - Save exchange configuration
    fastify.post('/users/:id/exchange-config', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const user = request.user;
            // Log request details
            logger_1.logger.info({
                uid: user.uid,
                targetId: id,
                body: JSON.stringify(request.body),
                hasApiKey: !!request.body.apiKey,
                hasSecret: !!request.body.secret,
                hasPassphrase: !!request.body.passphrase,
                exchange: request.body.exchange,
                type: request.body.type
            }, 'Exchange config save request received');
            // Users can only update their own config unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const body = exchangeConfigSchema.parse(request.body);
            // Determine type: use 'type' field if provided, otherwise use 'exchange' field, default to 'binance'
            const configType = body.type || body.exchange || 'binance';
            // Validate required fields for trading exchanges only
            if (['binance', 'bitget', 'weex', 'bingx'].includes(configType)) {
                if (!body.secret) {
                    return reply.code(400).send({ error: 'Secret key is required for trading exchanges' });
                }
                const requiredFields = exchangeConnector_1.ExchangeConnectorFactory.getRequiredFields(configType);
                if (requiredFields.includes('passphrase') && !body.passphrase) {
                    return reply.code(400).send({ error: 'Passphrase is required for this exchange' });
                }
            }
            // Get existing document to check if createdAt should be set
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const existingDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
            const now = admin.firestore.Timestamp.now();
            // Encrypt credentials
            const encryptedConfig = {
                exchange: configType, // Keep for backward compatibility
                apiKeyEncrypted: (0, keyManager_1.encrypt)(body.apiKey),
                updatedAt: now,
            };
            // Add createdAt only if document doesn't exist
            if (!existingDoc.exists) {
                encryptedConfig.createdAt = now;
            }
            // Only add secret/passphrase for trading exchanges
            if (['binance', 'bitget', 'weex', 'bingx'].includes(configType)) {
                if (body.secret) {
                    encryptedConfig.secretEncrypted = (0, keyManager_1.encrypt)(body.secret);
                }
                if (body.passphrase) {
                    encryptedConfig.passphraseEncrypted = (0, keyManager_1.encrypt)(body.passphrase);
                }
                encryptedConfig.testnet = body.testnet ?? true;
            }
            // Save to Firestore in user's exchangeConfig collection
            await db.collection('users').doc(id).collection('exchangeConfig').doc('current').set(encryptedConfig, { merge: true });
            // Verify it was saved
            const savedDoc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
            logger_1.logger.info({
                uid: id,
                type: configType,
                saved: savedDoc.exists,
                hasApiKey: !!savedDoc.data()?.apiKeyEncrypted,
                hasSecret: !!savedDoc.data()?.secretEncrypted,
                hasPassphrase: !!savedDoc.data()?.passphraseEncrypted,
                hasCreatedAt: !!savedDoc.data()?.createdAt,
                hasUpdatedAt: !!savedDoc.data()?.updatedAt
            }, 'Exchange config saved and verified');
            return {
                success: true,
                message: 'Configuration saved successfully',
                type: configType,
                exchange: configType, // Keep for backward compatibility
            };
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                logger_1.logger.warn({ err: err.errors, uid: request.user?.uid }, 'Exchange config validation error');
                return reply.code(400).send({ error: 'Invalid input', details: err.errors });
            }
            logger_1.logger.error({ err: err.message, stack: err.stack, uid: request.user?.uid }, 'Error saving exchange config');
            return reply.code(500).send({ error: err.message || 'Error saving exchange configuration' });
        }
    });
    // GET /api/users/:id/exchange-config - Get exchange configuration (masked)
    fastify.get('/users/:id/exchange-config', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const user = request.user;
            // Users can only view their own config unless they're admin
            const isAdmin = await firestoreAdapter_1.firestoreAdapter.isAdmin(user.uid);
            if (id !== user.uid && !isAdmin) {
                return reply.code(403).send({ error: 'Access denied' });
            }
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const doc = await db.collection('users').doc(id).collection('exchangeConfig').doc('current').get();
            if (!doc.exists) {
                return reply.code(404).send({ error: 'Exchange configuration not found' });
            }
            const data = doc.data();
            // Return masked configuration
            return {
                exchange: data.exchange,
                testnet: data.testnet ?? true,
                hasApiKey: !!data.apiKeyEncrypted,
                hasSecret: !!data.secretEncrypted,
                hasPassphrase: !!data.passphraseEncrypted,
                updatedAt: data.updatedAt?.toISOString?.() || new Date(data.updatedAt).toISOString(),
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error getting exchange config');
            return reply.code(500).send({ error: err.message || 'Error fetching exchange configuration' });
        }
    });
    // POST /api/exchange/test - Test exchange connection
    fastify.post('/test', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const body = zod_1.z.object({
                exchange: zod_1.z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
                apiKey: zod_1.z.string().optional(),
                secret: zod_1.z.string().optional(),
                passphrase: zod_1.z.string().optional(),
                testnet: zod_1.z.boolean().optional().default(true),
            }).parse(request.body);
            let credentials;
            let exchange;
            // If credentials provided, use them; otherwise load from user's config
            if (body.apiKey && body.secret) {
                exchange = body.exchange || 'binance';
                credentials = {
                    apiKey: body.apiKey,
                    secret: body.secret,
                    passphrase: body.passphrase,
                    testnet: body.testnet ?? true,
                };
            }
            else {
                // Load from user's saved config
                const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
                const db = getFirebaseAdmin().firestore();
                const doc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
                if (!doc.exists) {
                    return reply.code(400).send({ error: 'No exchange configuration found. Please save your credentials first.' });
                }
                const config = doc.data();
                exchange = config.exchange;
                // Decrypt credentials
                credentials = {
                    apiKey: (0, keyManager_1.decrypt)(config.apiKeyEncrypted),
                    secret: (0, keyManager_1.decrypt)(config.secretEncrypted),
                    passphrase: config.passphraseEncrypted ? (0, keyManager_1.decrypt)(config.passphraseEncrypted) : undefined,
                    testnet: config.testnet ?? true,
                };
            }
            // Validate required fields
            const requiredFields = exchangeConnector_1.ExchangeConnectorFactory.getRequiredFields(exchange);
            if (requiredFields.includes('passphrase') && !credentials.passphrase) {
                return reply.code(400).send({ error: 'Passphrase is required for this exchange' });
            }
            // Create connector and test
            const connector = exchangeConnector_1.ExchangeConnectorFactory.create(exchange, credentials);
            const result = await connector.testConnection();
            logger_1.logger.info({ uid: user.uid, exchange, success: result.success }, 'Exchange connection test');
            return {
                success: result.success,
                message: result.message,
                exchange,
            };
        }
        catch (err) {
            logger_1.logger.error({ err }, 'Error testing exchange connection');
            return reply.code(500).send({
                error: err.message || 'Error testing exchange connection',
                success: false,
            });
        }
    });
    // POST /api/exchange/test-trade - Place a test trade order
    fastify.post('/exchange/test-trade', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        try {
            const body = zod_1.z.object({
                exchange: zod_1.z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
                symbol: zod_1.z.string().optional().default('BTCUSDT'),
                side: zod_1.z.enum(['BUY', 'SELL']).optional().default('BUY'),
                quantity: zod_1.z.number().positive().optional().default(0.001),
            }).parse(request.body || {});
            // Get exchange connector
            const { getFirebaseAdmin } = await Promise.resolve().then(() => __importStar(require('../utils/firebase')));
            const db = getFirebaseAdmin().firestore();
            const configDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
            if (!configDoc.exists) {
                return reply.code(404).send({
                    success: false,
                    error: 'Exchange configuration not found. Please configure your exchange API credentials first.',
                });
            }
            const config = configDoc.data();
            const exchange = (body.exchange || config.exchange);
            // Validate exchange matches if specified
            if (body.exchange && body.exchange !== config.exchange) {
                return reply.code(400).send({
                    success: false,
                    error: `Exchange mismatch. Configured: ${config.exchange}, requested: ${body.exchange}`,
                });
            }
            // Create connector
            const connector = exchangeConnector_1.ExchangeConnectorFactory.create(exchange, {
                apiKey: (0, keyManager_1.decrypt)(config.apiKeyEncrypted),
                secret: (0, keyManager_1.decrypt)(config.secretEncrypted),
                passphrase: config.passphraseEncrypted ? (0, keyManager_1.decrypt)(config.passphraseEncrypted) : undefined,
                testnet: config.testnet ?? true,
            });
            // Get symbol info to determine minimum order size
            try {
                // Determine minimum quantity (use provided quantity or minimum)
                const minQuantity = 0.001; // Default minimum
                const orderQuantity = Math.max(body.quantity || minQuantity, minQuantity);
                // Place market order
                const order = await connector.placeOrder({
                    symbol: body.symbol,
                    side: body.side,
                    type: 'MARKET',
                    quantity: orderQuantity,
                });
                // Update last tested timestamp
                await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').update({
                    lastTested: new Date().toISOString(),
                });
                logger_1.logger.info({
                    uid: user.uid,
                    exchange,
                    symbol: body.symbol,
                    side: body.side,
                    orderId: order.id || order.orderId
                }, 'Test trade placed successfully');
                return {
                    success: true,
                    message: 'Test trade placed successfully',
                    orderId: order.id || order.orderId || 'N/A',
                    status: order.status || 'FILLED',
                    filledPrice: order.filledPrice || order.price || 'N/A',
                    filledQuantity: order.filledQuantity || orderQuantity,
                    exchange,
                    symbol: body.symbol,
                    side: body.side,
                    exchangeConfirmation: order.exchangeConfirmation || order.raw || {},
                };
            }
            catch (tradeErr) {
                logger_1.logger.error({ err: tradeErr, uid: user.uid, exchange }, 'Error placing test trade');
                return reply.code(400).send({
                    success: false,
                    error: tradeErr.message || 'Error placing test trade',
                    details: tradeErr.response?.data || tradeErr.data,
                });
            }
        }
        catch (err) {
            if (err instanceof zod_1.z.ZodError) {
                return reply.code(400).send({
                    success: false,
                    error: 'Invalid input',
                    details: err.errors,
                });
            }
            logger_1.logger.error({ err, uid: user.uid }, 'Error in test trade endpoint');
            return reply.code(500).send({
                success: false,
                error: err.message || 'Error placing test trade',
            });
        }
    });
}
