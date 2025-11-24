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
exports.diagnosticsRoutes = diagnosticsRoutes;
const firestoreAdapter_1 = require("../services/firestoreAdapter");
const logger_1 = require("../utils/logger");
const zod_1 = require("zod");
async function diagnosticsRoutes(fastify) {
    // POST /api/diagnostics/test - Test API connectivity and credentials
    fastify.post('/test', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        const user = request.user;
        const body = zod_1.z.object({
            api: zod_1.z.enum(['binance', 'coingecko', 'googlefinance', 'marketaux', 'cryptocompare', 'exchange']),
            apiKey: zod_1.z.string().optional(),
            secretKey: zod_1.z.string().optional(),
            passphrase: zod_1.z.string().optional(),
            exchange: zod_1.z.enum(['binance', 'bitget', 'bingx', 'weex']).optional(),
        }).parse(request.body);
        // Support legacy apiName field for backward compatibility
        const apiName = request.body.apiName || body.api;
        const startTime = Date.now();
        try {
            const integrations = await firestoreAdapter_1.firestoreAdapter.getEnabledIntegrations(user.uid);
            const { decrypt } = await Promise.resolve().then(() => __importStar(require('../services/keyManager')));
            switch (apiName) {
                case 'binance': {
                    // Test Binance public API - no API key required
                    try {
                        const { BinanceAdapter } = await Promise.resolve().then(() => __importStar(require('../services/binanceAdapter')));
                        const adapter = new BinanceAdapter();
                        const testData = await adapter.getMarketData('BTCUSDT');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'binance',
                            success: true,
                            reachable: true,
                            credentialsValid: true, // No credentials needed
                            rateLimitRemaining: undefined,
                            latency,
                            details: {
                                price: testData.price,
                                volume24h: testData.volume24h,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'binance',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: true, // No credentials needed
                            error: err.message || 'Binance API test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'coingecko': {
                    // Test CoinGecko API - no API key required
                    try {
                        const { CoinGeckoAdapter } = await Promise.resolve().then(() => __importStar(require('../services/coingeckoAdapter')));
                        const adapter = CoinGeckoAdapter;
                        const testData = await adapter.getHistoricalData('BTCUSDT', 1);
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'coingecko',
                            success: true,
                            reachable: true,
                            credentialsValid: true, // No credentials needed
                            rateLimitRemaining: undefined,
                            latency,
                            details: {
                                historicalDataPoints: testData.historicalData?.length || 0,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'coingecko',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: true, // No credentials needed
                            error: err.message || 'CoinGecko API test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'googlefinance': {
                    // Test Google Finance - no API key required
                    try {
                        const { GoogleFinanceAdapter } = await Promise.resolve().then(() => __importStar(require('../services/googleFinanceAdapter')));
                        const adapter = GoogleFinanceAdapter;
                        const testData = await adapter.getExchangeRate('USD', 'INR');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'googlefinance',
                            success: true,
                            reachable: true,
                            credentialsValid: true, // No credentials needed
                            rateLimitRemaining: undefined,
                            latency,
                            details: {
                                exchangeRate: testData.exchangeRate,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'googlefinance',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: true, // No credentials needed
                            error: err.message || 'Google Finance test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'marketaux': {
                    const apiKey = body.apiKey || integrations['marketaux']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'marketaux',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'MarketAux API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    try {
                        const { MarketAuxAdapter } = await Promise.resolve().then(() => __importStar(require('../services/MarketAuxAdapter')));
                        const adapter = new MarketAuxAdapter(apiKey);
                        const testData = await adapter.getNewsSentiment('BTC');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'marketaux',
                            success: true,
                            reachable: true,
                            credentialsValid: true,
                            latency,
                            details: {
                                sentiment: testData.sentiment,
                                hypeScore: testData.hypeScore,
                                trendScore: testData.trendScore,
                                totalArticles: testData.totalArticles,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'marketaux',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                            error: err.message || 'MarketAux test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'cryptocompare': {
                    const apiKey = body.apiKey || integrations['cryptocompare']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'cryptocompare',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'CryptoCompare API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    try {
                        const { CryptoCompareAdapter } = await Promise.resolve().then(() => __importStar(require('../services/cryptoCompareAdapter')));
                        const adapter = new CryptoCompareAdapter(apiKey);
                        const testData = await adapter.getAllMetrics('BTCUSDT');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'cryptocompare',
                            success: true,
                            reachable: true,
                            credentialsValid: true,
                            latency,
                            details: {
                                ohlcCount: testData.ohlc?.length || 0,
                                indicators: testData.indicators ? Object.keys(testData.indicators) : [],
                                marketData: testData.market ? Object.keys(testData.market) : [],
                                volumeData: testData.volume ? Object.keys(testData.volume) : [],
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'cryptocompare',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                            error: err.message || 'CryptoQuant test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'exchange': {
                    // Test exchange API (Binance/Bitget/BingX/Weex) - use provided credentials or fallback to stored
                    let exchangeName = (body.exchange || 'binance');
                    // Validate exchange name
                    const validExchanges = ['binance', 'bitget', 'bingx', 'weex'];
                    if (!validExchanges.includes(exchangeName)) {
                        return reply.code(400).send({
                            error: `Invalid exchange: ${exchangeName}. Must be one of: ${validExchanges.join(', ')}`,
                        });
                    }
                    let apiKey = body.apiKey;
                    let secret = body.secretKey;
                    let passphrase = body.passphrase;
                    let testnet = true;
                    // If credentials not provided, try to get from stored config using unified resolver
                    if (!apiKey || !secret) {
                        const { resolveExchangeConnector } = await Promise.resolve().then(() => __importStar(require('../services/exchangeResolver')));
                        const resolved = await resolveExchangeConnector(user.uid);
                        if (resolved) {
                            apiKey = apiKey || resolved.credentials.apiKey;
                            secret = secret || resolved.credentials.secret;
                            passphrase = passphrase || resolved.credentials.passphrase;
                            testnet = resolved.credentials.testnet;
                            // Use resolved exchange if not provided
                            if (!body.exchange) {
                                exchangeName = resolved.exchange;
                            }
                        }
                    }
                    try {
                        const { ExchangeConnectorFactory } = await Promise.resolve().then(() => __importStar(require('../services/exchangeConnector')));
                        // Validate all required fields before creating adapter
                        if (!apiKey || !secret) {
                            return reply.code(400).send({
                                success: false,
                                error: 'Missing API credentials. API Key and Secret Key are required.',
                            });
                        }
                        if ((exchangeName === 'bitget' || exchangeName === 'weex') && !passphrase) {
                            return reply.code(400).send({
                                success: false,
                                error: `Missing passphrase. ${exchangeName.charAt(0).toUpperCase() + exchangeName.slice(1)} requires a passphrase.`,
                            });
                        }
                        // Create connector
                        let connector;
                        try {
                            connector = ExchangeConnectorFactory.create(exchangeName, {
                                apiKey,
                                secret,
                                passphrase,
                                testnet,
                            });
                        }
                        catch (createErr) {
                            logger_1.logger.error({ err: createErr, exchange: exchangeName }, 'Failed to create exchange connector');
                            return reply.code(500).send({
                                success: false,
                                error: `Failed to initialize ${exchangeName} adapter: ${createErr.message || 'Unknown error'}`,
                            });
                        }
                        // Validate adapter is initialized
                        if (!connector) {
                            return reply.code(500).send({
                                success: false,
                                error: 'Failed to initialize exchange adapter',
                            });
                        }
                        // Validate testConnection method exists
                        if (typeof connector.testConnection !== 'function') {
                            return reply.code(500).send({
                                success: false,
                                error: 'Exchange adapter does not support connection testing',
                            });
                        }
                        // Test connection using testConnection method
                        let testResult;
                        try {
                            testResult = await connector.testConnection();
                        }
                        catch (testErr) {
                            logger_1.logger.error({ err: testErr, exchange: exchangeName, uid: user.uid }, 'Connection test error');
                            const latency = Date.now() - startTime;
                            return {
                                success: false,
                                exchange: exchangeName,
                                ping: latency,
                                error: testErr.message || 'Connection test failed',
                                reachable: testErr.response?.status !== 404 && testErr.response?.status !== 403,
                                credentialsValid: testErr.response?.status !== 401 && testErr.response?.status !== 403,
                            };
                        }
                        const latency = Date.now() - startTime;
                        if (testResult && testResult.success) {
                            return {
                                success: true,
                                exchange: exchangeName,
                                ping: latency,
                                message: testResult.message || 'Connection successful',
                                testnet,
                            };
                        }
                        else {
                            return {
                                success: false,
                                exchange: exchangeName,
                                ping: latency,
                                error: testResult?.message || 'Connection test failed',
                            };
                        }
                    }
                    catch (err) {
                        logger_1.logger.error({ err, exchange: exchangeName, uid: user.uid }, 'Exchange API test error');
                        const latency = Date.now() - startTime;
                        return reply.code(500).send({
                            success: false,
                            exchange: exchangeName,
                            ping: latency,
                            error: err.message || 'Exchange API test failed',
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                        });
                    }
                }
                default:
                    return reply.code(400).send({
                        error: 'Unknown API name',
                    });
            }
        }
        catch (error) {
            logger_1.logger.error({ error: error.message, uid: user.uid, apiName: body.api }, 'Error in API diagnostic test');
            return reply.code(500).send({
                apiName: body.api,
                success: false,
                error: error.message || 'Diagnostic test failed',
                latency: Date.now() - startTime,
            });
        }
    });
}
