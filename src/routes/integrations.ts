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
  apiName: z.enum(['binance', 'cryptoquant', 'lunarcrush', 'coinapi', 'bitget', 'bingx', 'kucoin', 'weex', 'bybit', 'okx']).optional(),
  exchange: z.enum(['binance', 'bitget', 'bingx', 'kucoin', 'weex', 'bybit', 'okx']).optional(), // Support 'exchange' field for exchange APIs
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  secretKey: z.string().optional(),
  passphrase: z.string().optional(), // For exchanges that need passphrase (e.g., Bitget)
  // Allow legacy and namespaced CoinAPI types
  apiType: z.enum(['market', 'flatfile', 'exchangerate', 'coinapi_market', 'coinapi_flatfile', 'coinapi_exchangerate']).optional(),
});

const integrationDeleteSchema = z.object({
  apiName: z.enum(['binance', 'cryptoquant', 'lunarcrush', 'coinapi']),
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
  // POST /api/integrations/save - Save research API integration
  fastify.post('/save', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const uid = user.uid;

    // Validate UID from auth (server-side only)
    if (!uid || typeof uid !== 'string') {
      logger.error({ uid }, 'Invalid UID in request');
      return reply.code(400).send({ error: 'Invalid user authentication' });
    }

    let body: any;
    try {
      body = integrationUpdateSchema.parse(request.body);
    } catch (err: any) {
      logger.error({ err, uid }, 'Invalid payload in save integration');
      return reply.code(400).send({ 
        error: 'Invalid request data', 
        details: err.errors || err.message 
      });
    }

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      // Accept both 'market' and 'coinapi_market' - normalize to 'coinapi_market'
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
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
      try {
        const result = await firestoreAdapter.saveIntegration(uid, docName, {
          enabled: false,
        });
        return { 
          ok: true, 
          doc: result 
        };
      } catch (error: any) {
        logger.error({ error: error.message, uid, docName }, 'Failed to disable integration');
        return reply.code(500).send({ 
          error: `Failed to disable integration: ${error.message}` 
        });
      }
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

    try {
      logger.info({ uid, integration: docName }, 'Saving integration');
      
      // Encrypt and save with post-verification
      const result = await firestoreAdapter.saveIntegration(uid, docName, updateData);
      
      logger.info({ uid, path: result.path }, 'Write success');
      
      return { 
        ok: true, 
        doc: result 
      };
    } catch (error: any) {
      // Generate error ID for correlation
      const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Log error to admin/errors collection
      try {
        await firestoreAdapter.logError(errorId, {
          uid,
          path: `users/${uid}/integrations/${docName}`,
          message: 'Failed to save integration',
          error: error.message,
          stack: error.stack,
          metadata: { docName, apiName: body.apiName },
        });
      } catch (logError: any) {
        logger.error({ logError: logError.message }, 'Failed to log error to admin/errors');
      }

      logger.error({ error: error.message, uid, docName, errorId }, 'Post-save failed');

      // Check if it's an encryption error
      if (error.message.includes('Encryption failed')) {
        return reply.code(500).send({ 
          error: 'Failed to encrypt API key', 
          errorId 
        });
      }

      // Retry once if post-save verification failed
      if (error.message.includes('Post-save verification failed')) {
        try {
          logger.info({ uid, docName }, 'Retrying save after verification failure');
          const retryResult = await firestoreAdapter.saveIntegration(uid, docName, updateData);
          logger.info({ uid, path: retryResult.path }, 'Retry write success');
          return { 
            ok: true, 
            doc: retryResult 
          };
        } catch (retryError: any) {
          logger.error({ error: retryError.message, uid, docName, errorId }, 'Retry failed');
          return reply.code(500).send({ 
            error: 'Failed to save integration after retry', 
            errorId 
          });
        }
      }

      return reply.code(500).send({ 
        error: `Failed to save integration: ${error.message}`, 
        errorId 
      });
    }
  });

  // Update or create an integration (alias for /save, for frontend compatibility)
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Reuse the same logic as /save endpoint
    const user = (request as any).user;
    const uid = user.uid;

    // Validate UID from auth (server-side only)
    if (!uid || typeof uid !== 'string') {
      logger.error({ uid }, 'Invalid UID in request');
      return reply.code(400).send({ error: 'Invalid user authentication' });
    }

    let body: any;
    try {
      body = integrationUpdateSchema.parse(request.body);
    } catch (err: any) {
      logger.error({ err, uid, body: request.body }, 'Invalid payload in update integration');
      return reply.code(400).send({ 
        error: 'Invalid request data', 
        details: err.errors || err.message 
      });
    }

    // Support both 'apiName' and 'exchange' fields - normalize to apiName
    if (body.exchange && !body.apiName) {
      body.apiName = body.exchange;
    }

    // Validate that we have either apiName or exchange
    if (!body.apiName) {
      logger.error({ body: request.body }, 'Missing apiName or exchange in update integration');
      return reply.code(400).send({ 
        error: 'Missing required field: apiName or exchange' 
      });
    }

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      // Accept both 'market' and 'coinapi_market' - normalize to 'coinapi_market'
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

    // Validate required fields based on API type
    if (body.apiName === 'binance' || body.apiName === 'bitget') {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({ 
          error: `${body.apiName} API requires both API key and secret key` 
        });
      }
      // Bitget also needs passphrase
      if (body.apiName === 'bitget' && body.enabled && !body.passphrase) {
        return reply.code(400).send({ 
          error: 'Bitget API requires passphrase in addition to API key and secret key' 
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
      try {
        const result = await firestoreAdapter.saveIntegration(uid, docName, {
          enabled: false,
        });
        return { 
          ok: true, 
          doc: result 
        };
      } catch (error: any) {
        logger.error({ error: error.message, uid, docName }, 'Failed to disable integration');
        return reply.code(500).send({ 
          error: `Failed to disable integration: ${error.message}` 
        });
      }
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

    try {
      logger.info({ uid, integration: docName }, 'Updating integration');
      
      // Encrypt and save with post-verification
      const result = await firestoreAdapter.saveIntegration(uid, docName, updateData);
      
      logger.info({ uid, path: result.path }, 'Write success');
      
      return { 
        ok: true, 
        doc: result 
      };
    } catch (error: any) {
      // Generate error ID for correlation
      const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Log error to admin/errors collection
      try {
        await firestoreAdapter.logError(errorId, {
          uid,
          path: `users/${uid}/integrations/${docName}`,
          message: 'Failed to update integration',
          error: error.message,
          stack: error.stack,
          metadata: { docName, apiName: body.apiName },
        });
      } catch (logError: any) {
        logger.error({ logError: logError.message }, 'Failed to log error to admin/errors');
      }

      logger.error({ error: error.message, uid, docName, errorId }, 'Post-save failed');

      // Check if it's an encryption error
      if (error.message.includes('Encryption failed')) {
        return reply.code(500).send({ 
          error: 'Failed to encrypt API key', 
          errorId 
        });
      }

      // Retry once if post-save verification failed
      if (error.message.includes('Post-save verification failed')) {
        try {
          logger.info({ uid, docName }, 'Retrying save after verification failure');
          const retryResult = await firestoreAdapter.saveIntegration(uid, docName, updateData);
          logger.info({ uid, path: retryResult.path }, 'Retry write success');
          return { 
            ok: true, 
            doc: retryResult 
          };
        } catch (retryError: any) {
          logger.error({ error: retryError.message, uid, docName, errorId }, 'Retry failed');
          return reply.code(500).send({ 
            error: 'Failed to save integration after retry', 
            errorId 
          });
        }
      }

      return reply.code(500).send({ 
        error: `Failed to update integration: ${error.message}`, 
        errorId 
      });
    }
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
    const user = (request as any).user;
    const body = integrationUpdateSchema.parse(request.body);

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
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

