"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveExchangeConnector = resolveExchangeConnector;
const firestoreAdapter_1 = require("./firestoreAdapter");
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
        const active = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(uid);
        // Handle fallback object when no exchange is configured
        if (active && typeof active === 'object' && 'exchangeConfigured' in active && active.exchangeConfigured === false) {
            logger_1.logger.debug({ uid }, 'Exchange integration not configured');
            return null;
        }
        // Type assertion since we've handled the fallback case
        const activeContext = active;
        // ActiveExchangeContext should be valid at this point
        if (!activeContext.adapter) {
            logger_1.logger.warn({ uid }, 'resolveExchangeConnector requested but user has no exchange adapter');
            return null;
        }
        if (!activeContext.apiKey || !activeContext.secret) {
            logger_1.logger.warn({ uid, exchange: activeContext.name }, 'Active exchange missing credentials');
            return null;
        }
        return {
            exchange: activeContext.name,
            connector: activeContext.adapter,
            credentials: {
                apiKey: activeContext.apiKey,
                secret: activeContext.secret,
                passphrase: activeContext.passphrase,
                testnet: activeContext.testnet ?? false,
            },
        };
    }
    catch (err) {
        logger_1.logger.error({ uid, error: err.message }, 'Error resolving exchange connector');
        return null;
    }
}
