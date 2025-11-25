"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExchangeConnector = resolveExchangeConnector;
const firebase_1 = require("../utils/firebase");
const exchangeConnector_1 = require("./exchangeConnector");
const keyManager_1 = require("./keyManager");
const logger_1 = require("../utils/logger");
/**
 * Unified exchange connector resolver
 * Primary source: users/{uid}/exchangeConfig/current
 * Secondary fallback: integrations system
 *
 * Returns null if no credentials found, with detailed logging
 */
async function resolveExchangeConnector(uid) {
    try {
        const db = (0, firebase_1.getFirebaseAdmin)().firestore();
        // PRIMARY: Check exchangeConfig subcollection (where frontend saves credentials)
        const configDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
        if (configDoc.exists) {
            const config = configDoc.data();
            // Validate required fields EARLY - return null immediately if invalid
            if (!config.exchange) {
                logger_1.logger.warn({ uid }, 'Exchange config exists but missing exchange field');
                return null;
            }
            if (!config.apiKeyEncrypted || !config.secretEncrypted) {
                logger_1.logger.warn({ uid, exchange: config.exchange }, 'Exchange config exists but missing encrypted credentials');
                return null;
            }
            try {
                // Normalize exchange name
                const exchange = config.exchange.toLowerCase().trim();
                const validExchanges = ['binance', 'bitget', 'bingx', 'weex'];
                // Validate exchange name EARLY - return null immediately if invalid
                if (!validExchanges.includes(exchange)) {
                    logger_1.logger.warn({ uid, exchange: config.exchange }, 'Unsupported exchange name in config');
                    return null;
                }
                // Proceed with decryption and connector creation
                // Decrypt credentials
                let apiKey;
                let secret;
                let passphrase;
                try {
                    apiKey = (0, keyManager_1.decrypt)(config.apiKeyEncrypted);
                    secret = (0, keyManager_1.decrypt)(config.secretEncrypted);
                    passphrase = config.passphraseEncrypted ? (0, keyManager_1.decrypt)(config.passphraseEncrypted) : undefined;
                }
                catch (decryptErr) {
                    logger_1.logger.error({ uid, exchange, error: decryptErr.message }, 'Failed to decrypt exchange credentials');
                    return null;
                }
                // Validate decrypted values - return null immediately if empty
                if (!apiKey || apiKey.trim() === '') {
                    logger_1.logger.warn({ uid, exchange }, 'Decrypted API key is empty');
                    return null;
                }
                if (!secret || secret.trim() === '') {
                    logger_1.logger.warn({ uid, exchange }, 'Decrypted secret is empty');
                    return null;
                }
                const testnet = config.testnet ?? true;
                // Create connector using factory
                try {
                    const connector = exchangeConnector_1.ExchangeConnectorFactory.create(exchange, {
                        apiKey,
                        secret,
                        passphrase,
                        testnet,
                    });
                    logger_1.logger.info({ uid, exchange, testnet }, 'Exchange connector resolved from exchangeConfig');
                    return {
                        exchange,
                        connector,
                        credentials: {
                            apiKey,
                            secret,
                            passphrase,
                            testnet,
                        },
                    };
                }
                catch (createErr) {
                    logger_1.logger.error({ uid, exchange, error: createErr.message }, 'Failed to create exchange connector');
                    return null;
                }
            }
            catch (parseErr) {
                logger_1.logger.error({ uid, error: parseErr.message }, 'Error parsing exchange config');
                return null;
            }
        }
        // No credentials found in exchangeConfig/current
        logger_1.logger.warn({ uid }, 'No exchange credentials found in users/{uid}/exchangeConfig/current. Please configure your exchange API credentials in Settings → Trading API Integration.');
        return null;
    }
    catch (err) {
        logger_1.logger.error({ uid, error: err.message, stack: err.stack }, 'Error resolving exchange connector');
        return null;
    }
}
