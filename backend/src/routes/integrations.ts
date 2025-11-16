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
  apiName: z.enum(['binance', 'cryptoquant', 'lunarcrush', 'coinapi']),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  secretKey: z.string().optional(),
  apiType: z.enum(['market', 'flatfile', 'exchangerate']).optional(), // For CoinAPI
});

const integrationDeleteSchema = z.object({
  apiName: z.enum(['binance', 'cryptoquant', 'lunarcrush', 'coinapi']),
  apiType: z.enum(['market', 'flatfile', 'exchangerate']).optional(), // For CoinAPI
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
    const body = integrationUpdateSchema.parse(request.body);

    // Handle CoinAPI sub-types
    let docName = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      docName = `coinapi_${body.apiType}`;
    }

    // Validate required fields based on API type
    if (body.apiName === 'binance') {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({ 
          error: 'Binance API requires both API key and secret key' 
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
      await firestoreAdapter.saveIntegration(user.uid, docName, {
        enabled: false,
      });
      return { message: 'Integration disabled', apiName: body.apiName };
    }

    // If enabling, require keys
    const updateData: { enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string } = {
      enabled: true,
    };

    if (body.apiKey) {
      updateData.apiKey = body.apiKey;
    }
    if (body.secretKey) {
      updateData.secretKey = body.secretKey;
    }
    if (body.apiType) {
      updateData.apiType = body.apiType;
    }

    await firestoreAdapter.saveIntegration(user.uid, docName, updateData);

    // PART 2: Also save to apiKeys collection if Binance with validation
    if (body.apiName === 'binance' && body.apiKey && body.secretKey) {
      // PART 2: Validate Binance API keys via connectivity test
      try {
        const testAdapter = new BinanceAdapter(body.apiKey, body.secretKey, true); // Test with testnet first
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

        // Keys are valid - encrypt and save
        const db = admin.firestore(getFirebaseAdmin());
        const apiKeysRef = db.collection('apiKeys').doc(user.uid);
        
        await apiKeysRef.set({
          uid: user.uid,
          exchange: 'binance',
          apiKeyEncrypted: encrypt(body.apiKey),
          apiSecretEncrypted: encrypt(body.secretKey),
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
          status: 'connected',
        });

        // Also save to integrations subcollection
        await firestoreAdapter.saveApiKeyToCollection(user.uid, {
          publicKey: body.apiKey,
          secretKey: body.secretKey,
          exchange: 'binance',
        });
        
        // PART 2: Update user's apiConnected status and connectedExchanges
        const userData = await firestoreAdapter.getUser(user.uid);
        const connectedExchanges = userData?.connectedExchanges || [];
        if (!connectedExchanges.includes('binance')) {
          connectedExchanges.push('binance');
        }

        await firestoreAdapter.createOrUpdateUser(user.uid, {
          isApiConnected: true,
          apiConnected: true, // Keep for backward compatibility
          apiStatus: 'connected',
          connectedExchanges,
        });

        // PART 2: Log activity
        await firestoreAdapter.logActivity(user.uid, 'API_CONNECTED', {
          message: 'Binance API connected successfully',
          exchange: 'binance',
        });

        logger.info({ uid: user.uid, exchange: 'binance' }, 'Binance API keys validated and saved');
      } catch (error: any) {
        logger.error({ error: error.message, uid: user.uid }, 'Binance API key validation error');
        return reply.code(400).send({
          error: `Binance API key validation failed: ${error.message}`,
        });
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
    let docName = body.apiName;
    if (body.apiName === 'coinapi' && (request.body as any).apiType) {
      docName = `coinapi_${(request.body as any).apiType}`;
    }

    await firestoreAdapter.deleteIntegration(user.uid, docName);

    return { message: 'Integration deleted', apiName: body.apiName };
  });

  // Connect API (alias for update, for backward compatibility)
  fastify.post('/connect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = integrationUpdateSchema.parse(request.body);

    // Handle CoinAPI sub-types
    let docName = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      docName = `coinapi_${body.apiType}`;
    }

    // Validate required fields based on API type
    if (body.apiName === 'binance') {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({ 
          error: 'Binance API requires both API key and secret key' 
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
      await firestoreAdapter.saveIntegration(user.uid, docName, {
        enabled: false,
      });
      return { message: 'Integration disabled', apiName: body.apiName };
    }

    // If enabling, require keys
    const updateData: { enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string } = {
      enabled: true,
    };

    if (body.apiKey) {
      updateData.apiKey = body.apiKey;
    }
    if (body.secretKey) {
      updateData.secretKey = body.secretKey;
    }
    if (body.apiType) {
      updateData.apiType = body.apiType;
    }

    await firestoreAdapter.saveIntegration(user.uid, docName, updateData);

    // PART 2: Also save to apiKeys collection if Binance with validation
    if (body.apiName === 'binance' && body.apiKey && body.secretKey) {
      // PART 2: Validate Binance API keys via connectivity test
      try {
        const testAdapter = new BinanceAdapter(body.apiKey, body.secretKey, true); // Test with testnet first
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

        // Keys are valid - encrypt and save
        const db = admin.firestore(getFirebaseAdmin());
        const apiKeysRef = db.collection('apiKeys').doc(user.uid);
        
        await apiKeysRef.set({
          uid: user.uid,
          exchange: 'binance',
          apiKeyEncrypted: encrypt(body.apiKey),
          apiSecretEncrypted: encrypt(body.secretKey),
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
          status: 'connected',
        });

        // Also save to integrations subcollection
        await firestoreAdapter.saveApiKeyToCollection(user.uid, {
          publicKey: body.apiKey,
          secretKey: body.secretKey,
          exchange: 'binance',
        });
        
        // PART 2: Update user's apiConnected status and connectedExchanges
        const userData = await firestoreAdapter.getUser(user.uid);
        const connectedExchanges = userData?.connectedExchanges || [];
        if (!connectedExchanges.includes('binance')) {
          connectedExchanges.push('binance');
        }

        await firestoreAdapter.createOrUpdateUser(user.uid, {
          isApiConnected: true,
          apiConnected: true, // Keep for backward compatibility
          apiStatus: 'connected',
          connectedExchanges,
        });

        // PART 2: Log activity
        await firestoreAdapter.logActivity(user.uid, 'API_CONNECTED', {
          message: 'Binance API connected successfully',
          exchange: 'binance',
        });

        logger.info({ uid: user.uid, exchange: 'binance' }, 'Binance API keys validated and saved');
      } catch (error: any) {
        logger.error({ error: error.message, uid: user.uid }, 'Binance API key validation error');
        return reply.code(400).send({
          error: `Binance API key validation failed: ${error.message}`,
        });
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
      let docName = body.apiName;
      if (body.apiName === 'coinapi' && body.apiType) {
        docName = `coinapi_${body.apiType}`;
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

        try {
          const { CryptoQuantAdapter } = await import('../services/cryptoquantAdapter');
          const adapter = new CryptoQuantAdapter(body.apiKey);
          // Test with a simple call
          await adapter.getExchangeFlow('BTCUSDT');
          
          return {
            valid: true,
            apiName: 'cryptoquant',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CryptoQuant API validation failed',
            apiName: 'cryptoquant',
          });
        }
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
          const adapter = new CoinAPIAdapter(body.apiKey, body.apiType);
          
          // Test based on type
          if (body.apiType === 'market') {
            await adapter.getMarketData('BTCUSDT');
          } else if (body.apiType === 'flatfile') {
            await adapter.getHistoricalData('BTCUSDT', 1);
          } else if (body.apiType === 'exchangerate') {
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

