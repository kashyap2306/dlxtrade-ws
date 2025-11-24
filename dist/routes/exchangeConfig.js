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
exports.exchangeConfigRoutes = exchangeConfigRoutes;
const zod_1 = require("zod");
const admin = __importStar(require("firebase-admin"));
const firebase_1 = require("../utils/firebase");
const keyManager_1 = require("../services/keyManager");
const logger_1 = require("../utils/logger");
const binanceAdapter_1 = require("../services/binanceAdapter");
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const exchangeConfigSchema = zod_1.z.object({
    exchange: zod_1.z.enum(['binance', 'bitget', 'bingx']),
    apiKey: zod_1.z.string().min(1),
    secret: zod_1.z.string().min(1),
    passphrase: zod_1.z.string().optional(),
    testnet: zod_1.z.boolean().optional(),
});
/**
 * Exchange Config Routes
 * Handles saving/loading trading exchange credentials
 * Saves to: users/{uid}/exchangeConfig/current
 */
async function exchangeConfigRoutes(fastify) {
    // GET /api/exchange-config/load - Load exchange config
    fastify.get('/load', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const db = admin.firestore((0, firebase_1.getFirebaseAdmin)());
            const configDoc = await db
                .collection('users')
                .doc(user.uid)
                .collection('exchangeConfig')
                .doc('current')
                .get();
            if (!configDoc.exists) {
                return {
                    exchange: '',
                    apiKey: null,
                    secret: null,
                    passphrase: null,
                    testnet: false,
                    enabled: false,
                };
            }
            const data = configDoc.data() || {};
            return {
                exchange: data.exchange || '',
                apiKey: data.apiKeyEncrypted ? (0, keyManager_1.maskKey)(data.apiKeyEncrypted) : null,
                secret: data.secretEncrypted ? (0, keyManager_1.maskKey)(data.secretEncrypted) : null,
                passphrase: data.passphraseEncrypted ? (0, keyManager_1.maskKey)(data.passphraseEncrypted) : null,
                testnet: data.testnet || false,
                enabled: data.enabled || false,
                updatedAt: data.updatedAt?.toDate().toISOString(),
            };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: request.user?.uid }, 'Error loading exchange config');
            return reply.code(500).send({ error: err.message || 'Error loading exchange config' });
        }
    });
    // POST /api/exchange-config/update - Save/update exchange config
    fastify.post('/update', {
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
            body = exchangeConfigSchema.parse(request.body);
        }
        catch (err) {
            logger_1.logger.error({ err, uid }, 'Invalid payload in save exchange config');
            return reply.code(400).send({
                error: 'Invalid request data',
                details: err.errors || err.message
            });
        }
        // Validate API keys if Binance
        if (body.exchange === 'binance') {
            try {
                const testAdapter = new binanceAdapter_1.BinanceAdapter(body.apiKey, body.secret, body.testnet || false);
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
            }
            catch (error) {
                logger_1.logger.error({ error: error.message, uid }, 'Binance API key validation error');
                return reply.code(400).send({
                    error: `Binance API key validation failed: ${error.message}`,
                });
            }
        }
        try {
            logger_1.logger.info({ uid, exchange: body.exchange }, 'Saving exchange config');
            // Encrypt and save with post-verification
            const result = await firestoreAdapter_1.firestoreAdapter.saveExchangeConfig(uid, {
                exchange: body.exchange,
                apiKey: body.apiKey,
                secret: body.secret,
                passphrase: body.passphrase,
                testnet: body.testnet,
            });
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
                    path: `users/${uid}/exchangeConfig/current`,
                    message: 'Failed to save exchange config',
                    error: error.message,
                    stack: error.stack,
                    metadata: { exchange: body.exchange },
                });
            }
            catch (logError) {
                logger_1.logger.error({ logError: logError.message }, 'Failed to log error to admin/errors');
            }
            logger_1.logger.error({ error: error.message, uid, errorId }, 'Post-save failed');
            // Check if it's an encryption error
            if (error.message.includes('Encryption failed')) {
                return reply.code(500).send({
                    error: 'Failed to encrypt credentials',
                    errorId
                });
            }
            // Retry once if post-save verification failed
            if (error.message.includes('Post-save verification failed')) {
                try {
                    logger_1.logger.info({ uid }, 'Retrying save after verification failure');
                    const retryResult = await firestoreAdapter_1.firestoreAdapter.saveExchangeConfig(uid, {
                        exchange: body.exchange,
                        apiKey: body.apiKey,
                        secret: body.secret,
                        passphrase: body.passphrase,
                        testnet: body.testnet,
                    });
                    logger_1.logger.info({ uid, path: retryResult.path }, 'Retry write success');
                    return {
                        ok: true,
                        doc: retryResult
                    };
                }
                catch (retryError) {
                    logger_1.logger.error({ error: retryError.message, uid, errorId }, 'Retry failed');
                    return reply.code(500).send({
                        error: 'Failed to save exchange config after retry',
                        errorId
                    });
                }
            }
            return reply.code(500).send({
                error: `Failed to save exchange config: ${error.message}`,
                errorId
            });
        }
    });
    // POST /api/exchange-config/delete - Delete exchange config
    fastify.post('/delete', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const db = admin.firestore((0, firebase_1.getFirebaseAdmin)());
            const configRef = db
                .collection('users')
                .doc(user.uid)
                .collection('exchangeConfig')
                .doc('current');
            await configRef.delete();
            logger_1.logger.info({ uid: user.uid }, 'Exchange config deleted');
            return { message: 'Exchange config deleted successfully' };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: request.user?.uid }, 'Error deleting exchange config');
            return reply.code(500).send({ error: err.message || 'Error deleting exchange config' });
        }
    });
}
