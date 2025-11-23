import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import type { ExchangeName } from '../services/exchangeConnector';
import { logger } from '../utils/logger';
import { z } from 'zod';

export async function diagnosticsRoutes(fastify: FastifyInstance) {
  // POST /api/diagnostics/test - Test API connectivity and credentials
  fastify.post('/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { api: string; apiKey?: string; secretKey?: string; passphrase?: string; exchange?: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = z.object({
      api: z.enum(['binance', 'coingecko', 'googlefinance', 'marketaux', 'cryptoquant', 'exchange']),
      apiKey: z.string().optional(),
      secretKey: z.string().optional(),
      passphrase: z.string().optional(),
      exchange: z.enum(['binance', 'bitget', 'bingx', 'weex']).optional(),
    }).parse(request.body);

    // Support legacy apiName field for backward compatibility
    const apiName = (request.body as any).apiName || body.api;

    const startTime = Date.now();

    try {
      const integrations = await firestoreAdapter.getEnabledIntegrations(user.uid);
      const { decrypt } = await import('../services/keyManager');

      switch (apiName) {
        case 'binance': {
          // Test Binance public API - no API key required
          try {
            const { BinanceAdapter } = await import('../services/binanceAdapter');
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
          } catch (err: any) {
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
            const { CoinGeckoAdapter } = await import('../services/coingeckoAdapter');
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
          } catch (err: any) {
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
            const { GoogleFinanceAdapter } = await import('../services/googleFinanceAdapter');
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
          } catch (err: any) {
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
            const { MarketAuxAdapter } = await import('../services/MarketAuxAdapter');
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
          } catch (err: any) {
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

          try {
            const { CryptoCompareAdapter } = await import('../services/cryptoCompareAdapter');
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
                whaleScore: testData.whaleScore,
                reserveChange: testData.reserveChange,
                minerOutflow: testData.minerOutflow,
                fundingRate: testData.fundingRate,
                liquidations: testData.liquidations,
              },
            };
          } catch (err: any) {
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
          let exchangeName = (body.exchange || 'binance') as ExchangeName;
          
          // Validate exchange name
          const validExchanges: ExchangeName[] = ['binance', 'bitget', 'bingx', 'weex'];
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
            const { resolveExchangeConnector } = await import('../services/exchangeResolver');
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
            const { ExchangeConnectorFactory } = await import('../services/exchangeConnector');
            
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
            } catch (createErr: any) {
              logger.error({ err: createErr, exchange: exchangeName }, 'Failed to create exchange connector');
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
            } catch (testErr: any) {
              logger.error({ err: testErr, exchange: exchangeName, uid: user.uid }, 'Connection test error');
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
            } else {
              return {
                success: false,
                exchange: exchangeName,
                ping: latency,
                error: testResult?.message || 'Connection test failed',
              };
            }
          } catch (err: any) {
            logger.error({ err, exchange: exchangeName, uid: user.uid }, 'Exchange API test error');
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
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid, apiName: body.api }, 'Error in API diagnostic test');
      return reply.code(500).send({
        apiName: body.api,
        success: false,
        error: error.message || 'Diagnostic test failed',
        latency: Date.now() - startTime,
      });
    }
  });
}
