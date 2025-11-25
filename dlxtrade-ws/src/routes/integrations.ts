import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { maskKey, encrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

// Validation schemas
const integrationUpdateSchema = z.object({
  apiName: z.enum(['binance', 'bitget', 'bingx', 'weex', 'cryptoquant', 'lunarcrush', 'coinapi']),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  secretKey: z.string().optional(),
  // Allow legacy and namespaced CoinAPI types
  apiType: z.enum(['market', 'flatfile', 'exchangerate', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate']).optional(),
});

const integrationDeleteSchema = z.object({
  apiName: z.enum(['binance', 'bitget', 'bingx', 'weex', 'cryptoquant', 'lunarcrush', 'coinapi']),
  apiType: z.enum(['market', 'flatfile', 'exchangerate', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate']).optional(),
});

export async function integrationsRoutes(fastify: FastifyInstance) {
  // Load all integrations for the user
  fastify.get('/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const integrations = await firestoreAdapter.getAllIntegrations(user.uid);

    // Return integrations with masked keys
    const result: Record<string, any> = {};
    
    // Group CoinAPI sub-types
    const coinApiTypes: Record<string, any> = {};
    
    for (const [docName, integration] of Object.entries(integrations)) {
      if (docName.startsWith('coinapi_')) {
        const type = docName.replace('coinapi_', '');
        coinApiTypes[type] = {
          enabled: integration.enabled,
          apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
          apiType: type,
          updatedAt: integration.updatedAt?.toDate().toISOString(),
        };
      } else {
        result[docName] = {
          enabled: integration.enabled,
          apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
          secretKey: integration.secretKey ? maskKey(integration.secretKey) : null,
          apiType: integration.apiType || null,
          updatedAt: integration.updatedAt?.toDate().toISOString(),
        };
      }
    }
    
    // Add CoinAPI grouped data
    if (Object.keys(coinApiTypes).length > 0) {
      result.coinapi = coinApiTypes;
    }

    return result;
  });

  // Update or create an integration
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    
    // Log request details for debugging
    logger.info({ 
      uid: user.uid, 
      body: JSON.stringify(request.body),
      hasApiKey: !!(request.body as any).apiKey,
      hasSecretKey: !!(request.body as any).secretKey,
      apiName: (request.body as any).apiName,
      enabled: (request.body as any).enabled 
    }, 'Integration update request received');

    const body = integrationUpdateSchema.parse(request.body);

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      // Accept both 'market' and 'coinapi_market' - normalize to 'coinapi_market'
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

    // Check if this is a trading exchange (Binance, Bitget, BingX, Weex)
    const tradingExchanges = ['binance', 'bitget', 'bingx', 'weex'];
    const isTradingExchange = tradingExchanges.includes(body.apiName);

    // Validate required fields based on API type
    if (isTradingExchange) {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({ 
          error: `${body.apiName} API requires both API key and secret key` 
        });
      }
    } else {
      // Research APIs: LunarCrush, CryptoQuant, CoinAPI
      if (body.enabled && !body.apiKey) {
        return reply.code(400).send({ 
          error: `${body.apiName} API requires an API key` 
        });
      }
    }

    // If disabling, just update enabled status
    if (!body.enabled) {
      logger.info({ uid: user.uid, apiName: body.apiName, docName }, 'Disabling integration');
      await firestoreAdapter.saveIntegration(user.uid, docName, {
        enabled: false,
      });
      return { message: 'Integration disabled', apiName: body.apiName };
    }

    // If enabling, require keys - save to appropriate location
    if (isTradingExchange) {
      // Trading exchanges: Save to exchangeConfig/current
      try {
        // Validate API keys via connectivity test (only Binance has validation for now)
        if (body.apiName === 'binance' && body.apiKey && body.secretKey) {
          const testAdapter = new BinanceAdapter(body.apiKey, body.secretKey, true);
          const validation = await testAdapter.validateApiKey();
          
          if (!validation.valid) {
            logger.warn({ uid: user.uid, exchange: body.apiName }, `Binance validation failed: ${validation.error}`);
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

        // Save to exchangeConfig/current with all required fields
        const db = admin.firestore(getFirebaseAdmin());
        const exchangeConfig: any = {
          exchange: body.apiName,
          apiKeyEncrypted: encrypt(body.apiKey!),
          secretEncrypted: encrypt(body.secretKey!),
          testnet: true,
          updatedAt: admin.firestore.Timestamp.now(),
        };

        // Add createdAt only if document doesn't exist
        const existingDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
        if (!existingDoc.exists) {
          exchangeConfig.createdAt = admin.firestore.Timestamp.now();
        }

        await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').set(exchangeConfig, { merge: true });

        logger.info({ 
          uid: user.uid, 
          exchange: body.apiName,
          hasApiKey: !!body.apiKey,
          hasSecretKey: !!body.secretKey 
        }, `Trading exchange ${body.apiName} saved to exchangeConfig/current`);
      } catch (error: any) {
        logger.error({ error: error.message, stack: error.stack, uid: user.uid, exchange: body.apiName }, 'Trading exchange API key save error');
        return reply.code(400).send({
          error: `${body.apiName} API key save failed: ${error.message}`,
        });
      }

      // Also save to integrations as backup
      await firestoreAdapter.saveIntegration(user.uid, docName, {
        enabled: true,
        apiKey: body.apiKey!,
        secretKey: body.secretKey!,
      });

      await firestoreAdapter.logActivity(user.uid, 'API_CONNECTED', {
        message: `${body.apiName} API connected successfully`,
        exchange: body.apiName,
      });
    } else {
      // Research APIs: Save to integrations/{integrationName}
      const integrationData: { enabled: boolean; apiKey?: string; apiType?: string } = {
        enabled: true,
      };

      if (body.apiKey) {
        integrationData.apiKey = body.apiKey;
      }
      if (body.apiType) {
        integrationData.apiType = body.apiType;
      }

      logger.info({ 
        uid: user.uid, 
        apiName: body.apiName, 
        docName,
        hasApiKey: !!body.apiKey 
      }, 'Saving research API integration');

      await firestoreAdapter.saveIntegration(user.uid, docName, integrationData);

      // Verify it was saved by reading it back
      const saved = await firestoreAdapter.getIntegration(user.uid, docName);
      if (saved) {
        logger.info({ uid: user.uid, apiName: docName, saved: !!saved.apiKey }, 'Research API integration saved and verified');
      } else {
        logger.error({ uid: user.uid, apiName: docName }, 'Research API integration save verification failed');
      }
    }

    return { 
      message: 'Integration updated', 
      apiName: body.apiName,
      enabled: true,
    };
  });

  // Delete an integration
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = integrationDeleteSchema.parse(request.body);
    
    // Handle CoinAPI sub-types - check if apiType is provided in body
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && (request.body as any).apiType) {
      const t = ((request.body as any).apiType as string);
      docName = t.startsWith('coinapi_') ? t : `coinapi_${t}`;
    }

    await firestoreAdapter.deleteIntegration(user.uid, docName);

    return { message: 'Integration deleted', apiName: body.apiName };
  });

  // Connect API (alias for update, for backward compatibility)
  fastify.post('/connect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Reuse update endpoint logic by calling it directly
    const user = (request as any).user;
    
    logger.info({ 
      uid: user.uid, 
      body: JSON.stringify(request.body),
      hasApiKey: !!(request.body as any).apiKey,
      hasSecretKey: !!(request.body as any).secretKey,
      apiName: (request.body as any).apiName,
      enabled: (request.body as any).enabled 
    }, 'Integration connect request received (delegating to update)');

    // Parse body using same schema
    const body = integrationUpdateSchema.parse(request.body);

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

    // Check if this is a trading exchange (Binance, Bitget, BingX, Weex)
    const tradingExchanges = ['binance', 'bitget', 'bingx', 'weex'];
    const isTradingExchange = tradingExchanges.includes(body.apiName);

    // Validate required fields based on API type
    if (isTradingExchange) {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({ 
          error: `${body.apiName} API requires both API key and secret key` 
        });
      }
    } else {
      if (body.enabled && !body.apiKey) {
        return reply.code(400).send({ 
          error: `${body.apiName} API requires an API key` 
        });
      }
    }

    // If disabling, just update enabled status
    if (!body.enabled) {
      logger.info({ uid: user.uid, apiName: body.apiName, docName }, 'Disabling integration');
      await firestoreAdapter.saveIntegration(user.uid, docName, {
        enabled: false,
      });
      return { message: 'Integration disabled', apiName: body.apiName };
    }

    // If enabling, require keys - save to appropriate location
    if (isTradingExchange) {
      // Trading exchanges: Save to exchangeConfig/current
      try {
        if (body.apiName === 'binance' && body.apiKey && body.secretKey) {
          const testAdapter = new BinanceAdapter(body.apiKey, body.secretKey, true);
          const validation = await testAdapter.validateApiKey();
          
          if (!validation.valid) {
            logger.warn({ uid: user.uid, exchange: body.apiName }, `Binance validation failed: ${validation.error}`);
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

        const db = admin.firestore(getFirebaseAdmin());
        const exchangeConfig: any = {
          exchange: body.apiName,
          apiKeyEncrypted: encrypt(body.apiKey!),
          secretEncrypted: encrypt(body.secretKey!),
          testnet: true,
          updatedAt: admin.firestore.Timestamp.now(),
        };

        const existingDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();
        if (!existingDoc.exists) {
          exchangeConfig.createdAt = admin.firestore.Timestamp.now();
        }

        await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').set(exchangeConfig, { merge: true });

        logger.info({ 
          uid: user.uid, 
          exchange: body.apiName,
          hasApiKey: !!body.apiKey,
          hasSecretKey: !!body.secretKey 
        }, `Trading exchange ${body.apiName} saved to exchangeConfig/current`);

        await firestoreAdapter.saveIntegration(user.uid, docName, {
          enabled: true,
          apiKey: body.apiKey!,
          secretKey: body.secretKey!,
        });

        await firestoreAdapter.logActivity(user.uid, 'API_CONNECTED', {
          message: `${body.apiName} API connected successfully`,
          exchange: body.apiName,
        });
      } catch (error: any) {
        logger.error({ error: error.message, stack: error.stack, uid: user.uid, exchange: body.apiName }, 'Trading exchange API key save error');
        return reply.code(400).send({
          error: `${body.apiName} API key save failed: ${error.message}`,
        });
      }
    } else {
      // Research APIs: Save to integrations/{integrationName}
      const integrationData: { enabled: boolean; apiKey?: string; apiType?: string } = {
        enabled: true,
      };

      if (body.apiKey) {
        integrationData.apiKey = body.apiKey;
      }
      if (body.apiType) {
        integrationData.apiType = body.apiType;
      }

      logger.info({ 
        uid: user.uid, 
        apiName: body.apiName, 
        docName,
        hasApiKey: !!body.apiKey 
      }, 'Saving research API integration');

      await firestoreAdapter.saveIntegration(user.uid, docName, integrationData);

      const saved = await firestoreAdapter.getIntegration(user.uid, docName);
      if (saved) {
        logger.info({ uid: user.uid, apiName: docName, saved: !!saved.apiKey }, 'Research API integration saved and verified');
      } else {
        logger.error({ uid: user.uid, apiName: docName }, 'Research API integration save verification failed');
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
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = integrationUpdateSchema.parse(request.body);

    try {
      // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

      // Validate based on API type
      if (body.apiName === 'binance') {
        if (!body.apiKey || !body.secretKey) {
          return reply.code(400).send({
            error: 'Binance API requires both API key and secret key',
            valid: false,
          });
        }

        try {
          const testAdapter = new BinanceAdapter(body.apiKey, body.secretKey, true);
          const validation = await testAdapter.validateApiKey();
          
          return {
            valid: validation.valid,
            canTrade: validation.canTrade,
            canWithdraw: validation.canWithdraw,
            error: validation.error,
            apiName: 'binance',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'Binance API validation failed',
            apiName: 'binance',
          });
        }
      } else if (body.apiName === 'cryptoquant') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'CryptoQuant API requires an API key',
            apiName: 'cryptoquant',
          });
        }

        // DISABLED: CryptoQuant testing - CryptoQuant removed
        // try {
        //   const { CryptoQuantAdapter } = await import('../services/cryptoquantAdapter');
        //   const adapter = new CryptoQuantAdapter(body.apiKey);
        //   // Test with a simple call
        //   await adapter.getExchangeFlow('BTCUSDT');

        //   return {
        //     valid: true,
        //     apiName: 'cryptoquant',
        //   };
        // } catch (error: any) {
        //   return reply.code(400).send({
        //     valid: false,
        //     error: error.message || 'CryptoQuant API validation failed',
        //     apiName: 'cryptoquant',
        //   });
        // }

        // Return disabled status for CryptoQuant
        return reply.code(400).send({
          valid: false,
          error: 'CryptoQuant integration is disabled',
          apiName: 'cryptoquant',
        });
      } else if (body.apiName === 'lunarcrush') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'LunarCrush API requires an API key',
            apiName: 'lunarcrush',
          });
        }

        try {
          const { LunarCrushAdapter } = await import('../services/lunarcrushAdapter');
          const adapter = new LunarCrushAdapter(body.apiKey);
          // Test with a simple call
          await adapter.getCoinData('BTCUSDT');
          
          return {
            valid: true,
            apiName: 'lunarcrush',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'LunarCrush API validation failed',
            apiName: 'lunarcrush',
          });
        }
      } else if (body.apiName === 'coinapi') {
        if (!body.apiKey || !body.apiType) {
          return reply.code(400).send({
            valid: false,
            error: 'CoinAPI requires both API key and apiType',
            apiName: 'coinapi',
          });
        }

        try {
          const { CoinAPIAdapter } = await import('../services/coinapiAdapter');
          const apiTypePlain = (body.apiType.startsWith('coinapi_') ? body.apiType.replace('coinapi_', '') : body.apiType) as 'market' | 'flatfile' | 'exchangerate';
          const adapter = new CoinAPIAdapter(body.apiKey, apiTypePlain);
          
          // Test based on type
          if (body.apiType === 'market' || body.apiType === 'coinapi_market') {
            await adapter.getMarketData('BTCUSDT');
          } else if (body.apiType === 'flatfile' || body.apiType === 'coinapi_flatfile') {
            await adapter.getHistoricalData('BTCUSDT', 1);
          } else if (body.apiType === 'exchangerate' || body.apiType === 'coinapi_exchangerate') {
            await adapter.getExchangeRate('BTC', 'USD');
          }
          
          return {
            valid: true,
            apiName: 'coinapi',
            apiType: body.apiType,
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CoinAPI validation failed',
            apiName: 'coinapi',
            apiType: body.apiType,
          });
        }
      }

      return reply.code(400).send({
        valid: false,
        error: 'Unknown API name',
      });
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'API validation error');
      return reply.code(500).send({
        valid: false,
        error: error.message || 'Internal server error',
      });
    }
  });
}

