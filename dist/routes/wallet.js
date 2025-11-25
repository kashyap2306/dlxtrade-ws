"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.walletRoutes = walletRoutes;
const exchangeConnector_1 = require("../services/exchangeConnector");
const keyManager_1 = require("../services/keyManager");
const logger_1 = require("../utils/logger");
const firebase_1 = require("../utils/firebase");
/**
 * Wallet Routes
 * Handles wallet balance fetching from connected exchanges
 */
async function walletRoutes(fastify) {
    // GET /api/wallet/balances - Get user's spot balances from connected exchange
    fastify.get('/balances', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const user = request.user;
            const db = (0, firebase_1.getFirebaseAdmin)().firestore();
            // Check if user has exchange config
            const exchangeConfigDoc = await db
                .collection('users')
                .doc(user.uid)
                .collection('exchangeConfig')
                .doc('current')
                .get();
            if (!exchangeConfigDoc.exists) {
                return reply.code(404).send({
                    error: 'No exchange connected',
                    connected: false,
                });
            }
            const exchangeConfig = exchangeConfigDoc.data();
            if (!exchangeConfig?.apiKeyEncrypted || !exchangeConfig?.secretEncrypted) {
                return reply.code(404).send({
                    error: 'No exchange connected',
                    connected: false,
                });
            }
            const exchange = (exchangeConfig.exchange || exchangeConfig.type);
            if (!['binance', 'bitget', 'weex', 'bingx'].includes(exchange)) {
                return reply.code(400).send({
                    error: 'Unsupported exchange',
                    connected: false,
                });
            }
            // Decrypt credentials (server-side only, never expose)
            const apiKey = (0, keyManager_1.decrypt)(exchangeConfig.apiKeyEncrypted);
            const secret = (0, keyManager_1.decrypt)(exchangeConfig.secretEncrypted);
            const passphrase = exchangeConfig.passphraseEncrypted
                ? (0, keyManager_1.decrypt)(exchangeConfig.passphraseEncrypted)
                : undefined;
            const testnet = exchangeConfig.testnet ?? true;
            // Log metadata only (no keys)
            logger_1.logger.info({
                uid: user.uid,
                exchange,
                hasKey: !!apiKey,
                keyLength: apiKey?.length || 0,
                exchangeName: exchange,
            }, 'Fetching wallet balances');
            // Create exchange adapter
            const adapter = exchangeConnector_1.ExchangeConnectorFactory.create(exchange, {
                apiKey,
                secret,
                passphrase,
                testnet,
            });
            // Fetch account info
            if (!adapter.getAccount) {
                return reply.code(501).send({
                    error: 'Exchange adapter does not support balance fetching',
                });
            }
            const accountInfo = await adapter.getAccount();
            // Process balances based on exchange
            let balances = [];
            let totalUsdValue = 0;
            if (exchange === 'binance') {
                // Binance format: { balances: [{ asset, free, locked }] }
                if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
                    // Get USDT price for conversion (simplified - use 1:1 for now, or fetch from ticker)
                    const usdtPrice = 1; // Could fetch from ticker if needed
                    balances = accountInfo.balances
                        .filter((b) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
                        .map((b) => {
                        const free = parseFloat(b.free || '0');
                        const locked = parseFloat(b.locked || '0');
                        const total = free + locked;
                        // For now, only calculate USD value for USDT, others use 0
                        // In production, you'd fetch prices for all assets
                        let usdValue = 0;
                        if (b.asset === 'USDT' || b.asset === 'BUSD') {
                            usdValue = total;
                        }
                        else if (b.asset === 'BTC') {
                            // Simplified - would fetch BTC price in production
                            usdValue = total * 50000; // Placeholder
                        }
                        else if (b.asset === 'ETH') {
                            usdValue = total * 3000; // Placeholder
                        }
                        return {
                            asset: b.asset,
                            free,
                            locked,
                            usdValue,
                        };
                    });
                    totalUsdValue = balances.reduce((sum, b) => sum + b.usdValue, 0);
                }
            }
            else if (exchange === 'bitget') {
                // Bitget format may differ - adjust based on actual API response
                if (accountInfo.data?.normal && Array.isArray(accountInfo.data.normal)) {
                    balances = accountInfo.data.normal
                        .filter((b) => parseFloat(b.available || '0') > 0 || parseFloat(b.locked || '0') > 0)
                        .map((b) => {
                        const free = parseFloat(b.available || '0');
                        const locked = parseFloat(b.locked || '0');
                        const total = free + locked;
                        const usdValue = b.coin === 'USDT' ? total : 0; // Simplified
                        return {
                            asset: b.coin,
                            free,
                            locked,
                            usdValue,
                        };
                    });
                    totalUsdValue = balances.reduce((sum, b) => sum + b.usdValue, 0);
                }
            }
            else {
                // Generic handling for other exchanges
                balances = [];
                totalUsdValue = 0;
            }
            // Return sanitized balances (no keys, no secrets)
            return {
                exchange,
                connected: true,
                balances,
                totalUsdValue,
            };
        }
        catch (err) {
            logger_1.logger.error({ err, uid: request.user?.uid }, 'Error fetching wallet balances');
            // Don't expose internal errors
            if (err.message?.includes('Invalid API-key') || err.message?.includes('authentication')) {
                return reply.code(401).send({
                    error: 'Invalid exchange credentials',
                    connected: false,
                });
            }
            return reply.code(500).send({
                error: 'Could not fetch balances',
                connected: false,
            });
        }
    });
}
