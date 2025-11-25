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
            api: zod_1.z.enum(['coinapi', 'lunarcrush', 'cryptoquant', 'exchange']),
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
                case 'coinapi': {
                    // Test CoinAPI market API - use provided API key or fallback to stored
                    const apiKey = body.apiKey || integrations['coinapi_market']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'coinapi',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'CoinAPI market API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    try {
                        const { CoinAPIAdapter } = await Promise.resolve().then(() => __importStar(require('../services/coinapiAdapter')));
                        const adapter = new CoinAPIAdapter(apiKey, 'market');
                        const testData = await adapter.getMarketData('BTCUSDT');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'coinapi',
                            success: true,
                            reachable: true,
                            credentialsValid: true,
                            rateLimitRemaining: undefined, // CoinAPI doesn't expose rate limits in response
                            latency,
                            details: {
                                price: testData.price,
                                volume24h: testData.volume24h,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'coinapi',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                            error: err.message || 'CoinAPI test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'lunarcrush': {
                    const apiKey = body.apiKey || integrations['lunarcrush']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'lunarcrush',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'LunarCrush API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    try {
                        const { LunarCrushAdapter } = await Promise.resolve().then(() => __importStar(require('../services/lunarcrushAdapter')));
                        const adapter = new LunarCrushAdapter(apiKey);
                        const testData = await adapter.getCoinData('BTCUSDT');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'lunarcrush',
                            success: true,
                            reachable: true,
                            credentialsValid: true,
                            latency,
                            details: {
                                socialScore: testData.socialScore,
                                sentiment: testData.sentiment,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'lunarcrush',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                            error: err.message || 'LunarCrush test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'cryptoquant': {
                    const apiKey = body.apiKey || integrations['cryptoquant']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'cryptoquant',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'CryptoQuant API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    // DISABLED: CryptoQuant testing - CryptoQuant removed
                    // try {
                    //   const { CryptoQuantAdapter } = await import('../services/cryptoquantAdapter');
                    //   const adapter = new CryptoQuantAdapter(apiKey);
                    //   const testData = await adapter.getExchangeFlow('BTCUSDT');
                    //   const latency = Date.now() - startTime;
                    //   return {
                    //     apiName: 'cryptoquant',
                    //     success: true,
                    //     reachable: true,
                    //     credentialsValid: true,
                    //     latency,
                    //     details: {
                    //       exchangeFlow: testData.exchangeFlow,
                    //     },
                    //   };
                    // } catch (err: any) {
                    //   return {
                    //     apiName: 'cryptoquant',
                    //     success: false,
                    //     reachable: err.response?.status !== 404 && err.response?.status !== 403,
                    //     credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                    //     error: err.message || 'CryptoQuant test failed',
                    //     latency: Date.now() - startTime,
                    //   };
                    // }
                    // Return disabled status for CryptoQuant
                    return {
                        apiName: 'cryptoquant',
                        success: false,
                        reachable: false,
                        credentialsValid: false,
                        error: 'CryptoQuant integration is disabled',
                        latency: Date.now() - startTime,
                    };
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
                case 'flatfile': {
                    const apiKey = body.apiKey || integrations['coinapi_flatfile']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'flatfile',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'CoinAPI Flat File API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    try {
                        const { CoinAPIAdapter } = await Promise.resolve().then(() => __importStar(require('../services/coinapiAdapter')));
                        const adapter = new CoinAPIAdapter(apiKey, 'flatfile');
                        const testData = await adapter.getHistoricalData('BTCUSDT', 7);
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'flatfile',
                            success: true,
                            reachable: true,
                            credentialsValid: true,
                            latency,
                            details: {
                                historicalDataPoints: testData.historicalData?.length || 0,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'flatfile',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                            error: err.message || 'CoinAPI Flat File test failed',
                            latency: Date.now() - startTime,
                        };
                    }
                }
                case 'exchangerate': {
                    const apiKey = body.apiKey || integrations['coinapi_exchangerate']?.apiKey;
                    if (!apiKey) {
                        return {
                            apiName: 'exchangerate',
                            success: false,
                            reachable: false,
                            credentialsValid: false,
                            error: 'CoinAPI Exchange Rate API key not configured',
                            latency: Date.now() - startTime,
                        };
                    }
                    try {
                        const { CoinAPIAdapter } = await Promise.resolve().then(() => __importStar(require('../services/coinapiAdapter')));
                        const adapter = new CoinAPIAdapter(apiKey, 'exchangerate');
                        const testData = await adapter.getExchangeRate('BTC', 'USD');
                        const latency = Date.now() - startTime;
                        return {
                            apiName: 'exchangerate',
                            success: true,
                            reachable: true,
                            credentialsValid: true,
                            latency,
                            details: {
                                exchangeRate: testData.exchangeRate,
                            },
                        };
                    }
                    catch (err) {
                        return {
                            apiName: 'exchangerate',
                            success: false,
                            reachable: err.response?.status !== 404 && err.response?.status !== 403,
                            credentialsValid: err.response?.status !== 401 && err.response?.status !== 403,
                            error: err.message || 'CoinAPI Exchange Rate test failed',
                            latency: Date.now() - startTime,
                        };
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
