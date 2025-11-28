import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { logger } from '../utils/logger';
import { z } from 'zod';

export async function diagnosticsRoutes(fastify: FastifyInstance) {
  // POST /api/diagnostics/test - Test API connectivity and credentials
  fastify.post('/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { api: string; apiKey?: string; secretKey?: string; passphrase?: string; exchange?: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = z.object({
      api: z.enum(['coinapi', 'lunarcrush', 'cryptoquant', 'exchange']),
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
          let exchangeName = (body.exchange || 'binance') as 'binance' | 'bitget' | 'bingx' | 'weex';
          
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
            const creationResult = ExchangeConnectorFactory.create(exchangeName, {
              apiKey,
              secret,
              passphrase,
              testnet,
            });

            if (!creationResult.success) {
              const error = creationResult.error!;
              logger.error({
                exchange: exchangeName,
                error: error.message,
                code: error.code
              }, 'Failed to create exchange connector');
              return reply.code(400).send({
                success: false,
                error: error.message,
                code: error.code,
                requiredFields: error.requiredFields,
              });
            }

            const connector = creationResult.connector!;

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

  // POST /api/diagnostics/test-providers - Test provider API validity
  fastify.post('/test-providers', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const results = [];

      // Get user's enabled integrations
      const enabledIntegrations = await firestoreAdapter.getEnabledIntegrations(user.uid);

      // Test Binance Public (no auth required)
      const startTimeBinance = Date.now();
      try {
        const response = await fetch('https://api.binance.com/api/v3/ping');
        const responseTime = Date.now() - startTimeBinance;
        if (response.ok) {
          results.push({
            provider: 'binancePublic',
            status: 'success',
            message: 'Binance Public API accessible',
            responseTime,
            hasApiKey: false
          });
        } else {
          results.push({
            provider: 'binancePublic',
            status: 'failed',
            message: `HTTP ${response.status}: ${response.statusText}`,
            responseTime,
            hasApiKey: false
          });
        }
      } catch (error: any) {
        results.push({
          provider: 'binancePublic',
          status: 'error',
          message: `Connection failed: ${error.message}`,
          responseTime: Date.now() - startTimeBinance,
          hasApiKey: false
        });
      }

      // Test CryptoCompare
      if (enabledIntegrations.cryptocompare?.apiKey) {
        const startTime = Date.now();
        try {
          const { CryptoCompareAdapter } = await import('../services/cryptocompareAdapter');
          const adapter = new CryptoCompareAdapter(enabledIntegrations.cryptocompare.apiKey);
          const result = await adapter.testConnection();
          results.push({
            provider: 'cryptocompare',
            status: result.success ? 'success' : 'failed',
            message: result.message,
            responseTime: Date.now() - startTime,
            hasApiKey: true
          });
        } catch (error: any) {
          results.push({
            provider: 'cryptocompare',
            status: 'error',
            message: `Adapter error: ${error.message}`,
            responseTime: Date.now() - startTime,
            hasApiKey: true
          });
        }
      } else {
        results.push({
          provider: 'cryptocompare',
          status: 'skipped',
          message: 'No API key configured',
          hasApiKey: false
        });
      }

      // Test NewsData
      if (enabledIntegrations.newsdata?.apiKey) {
        const startTime = Date.now();
        try {
          const { NewsDataAdapter } = await import('../services/newsDataAdapter');
          const adapter = new NewsDataAdapter(enabledIntegrations.newsdata.apiKey);
          const result = await adapter.testConnection();
          results.push({
            provider: 'newsdata',
            status: result.success ? 'success' : 'failed',
            message: result.message,
            responseTime: Date.now() - startTime,
            hasApiKey: true
          });
        } catch (error: any) {
          results.push({
            provider: 'newsdata',
            status: 'error',
            message: `Adapter error: ${error.message}`,
            responseTime: Date.now() - startTime,
            hasApiKey: true
          });
        }
      } else {
        results.push({
          provider: 'newsdata',
          status: 'skipped',
          message: 'No API key configured',
          hasApiKey: false
        });
      }

      // Test CoinMarketCap
      if (enabledIntegrations.coinmarketcap?.apiKey) {
        const startTime = Date.now();
        try {
          const { CoinMarketCapAdapter } = await import('../services/coinMarketCapAdapter');
          const adapter = new CoinMarketCapAdapter(enabledIntegrations.coinmarketcap.apiKey);
          const result = await adapter.testConnection();
          results.push({
            provider: 'coinmarketcap',
            status: result.success ? 'success' : 'failed',
            message: result.message,
            responseTime: Date.now() - startTime,
            hasApiKey: true
          });
        } catch (error: any) {
          results.push({
            provider: 'coinmarketcap',
            status: 'error',
            message: `Adapter error: ${error.message}`,
            responseTime: Date.now() - startTime,
            hasApiKey: true
          });
        }
      } else {
        results.push({
          provider: 'coinmarketcap',
          status: 'skipped',
          message: 'No API key configured',
          hasApiKey: false
        });
      }

      logger.info({ uid: user.uid, resultsCount: results.length }, 'Provider API tests completed');

      return {
        success: true,
        results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'failed').length,
          errors: results.filter(r => r.status === 'error').length,
          skipped: results.filter(r => r.status === 'skipped').length
        }
      };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error testing provider APIs');
      return reply.code(500).send({ error: err.message || 'Error testing provider APIs' });
    }
  });
}
