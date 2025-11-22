import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter, type IntegrationDocument, type IntegrationStatus } from '../services/firestoreAdapter';
import { z } from 'zod';
import { maskKey, encrypt, decrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import { ExchangeConnectorFactory } from '../services/exchangeConnector';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

// Validation schemas
const exchangeNameSchema = z.string().min(2, 'Exchange name is required').max(64, 'Exchange name too long').trim();
const credentialSchema = z.string().min(1, 'Field is required').max(512, 'Value too long').trim();
const SINGLE_EXCHANGE_NAMES = ['binance', 'bitget', 'bingx', 'weex', 'kucoin', 'bybit', 'okx'];

const integrationUpdateSchema = z.object({
  apiName: exchangeNameSchema.optional(),
  exchange: exchangeNameSchema.optional(), // Support both apiName/exchange for backward compatibility
  exchangeName: exchangeNameSchema.optional(),
  enabled: z.boolean().default(true),
  apiKey: credentialSchema.optional(),
  secretKey: credentialSchema.optional(),
  apiSecret: credentialSchema.optional(),
  passphrase: z.string().max(512, 'Passphrase too long').trim().optional(),
  apiType: z.string().max(64, 'apiType too long').trim().optional(),
  validate: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
  label: z.string().max(64).trim().optional(),
  userId: z.string().trim().optional(),
});

const integrationDeleteSchema = z.object({
  apiName: exchangeNameSchema,
  apiType: z.string().max(64).trim().optional(),
});

const integrationSubmitSchema = z.object({
  exchangeName: exchangeNameSchema,
  apiKey: credentialSchema,
  apiSecret: credentialSchema.optional(),
  secretKey: credentialSchema.optional(),
  passphrase: z.string().max(512).trim().optional(),
  label: z.string().max(64).trim().optional(),
  validate: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
  userId: z.string().trim().optional(),
});

const normalizeExchangeId = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'exchange';
};

const resolveStatus = (integration: IntegrationDocument): IntegrationStatus => {
  if (integration.status === 'VERIFIED' || integration.status === 'SAVED') {
    return 'CONNECTED';
  }
  return integration.status || (integration.enabled ? 'CONNECTED' : 'DISABLED');
};

const buildIntegrationList = (integrations: Record<string, IntegrationDocument>) => {
  return Object.entries(integrations).map(([docName, integration]) => ({
    id: docName,
    exchangeName: integration.exchangeName || docName,
    status: resolveStatus(integration),
    enabled: integration.enabled,
    maskedApiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
    maskedSecretKey: integration.secretKey ? maskKey(integration.secretKey) : null,
    updatedAt: integration.updatedAt?.toDate().toISOString(),
    createdAt: integration.createdAt?.toDate().toISOString(),
    meta: integration.meta || null,
  }));
};

interface NormalizedCredentials {
  apiKey: string;
  apiSecret?: string;
  passphrase?: string;
}

type CredentialValidator = {
  name: string;
  requiresSecret?: boolean;
  requiresPassphrase?: boolean;
  validate: (creds: NormalizedCredentials) => Promise<void>;
};

const credentialValidatorFactories: Record<string, () => Promise<CredentialValidator>> = {
  binance: async () => ({
    name: 'binance',
    requiresSecret: true,
    validate: async (creds: NormalizedCredentials) => {
      const adapter = new BinanceAdapter(creds.apiKey, creds.apiSecret || '', false);
      await adapter.getAccount();
    },
  }),
  bitget: async () => {
    const { BitgetAdapter } = await import('../services/bitgetAdapter');
    return {
      name: 'bitget',
      requiresSecret: true,
      requiresPassphrase: true,
      validate: async (creds: NormalizedCredentials) => {
        const adapter = new BitgetAdapter(creds.apiKey, creds.apiSecret || '', creds.passphrase || '', false);
        await adapter.getAccount();
      },
    };
  },
  bingx: async () => {
    const { BingXAdapter } = await import('../services/bingXAdapter');
    return {
      name: 'bingx',
      requiresSecret: true,
      validate: async (creds: NormalizedCredentials) => {
        const adapter = new BingXAdapter(creds.apiKey, creds.apiSecret || '', false);
        await adapter.getAccount();
      },
    };
  },
  weex: async () => {
    const { WeexAdapter } = await import('../services/weexAdapter');
    return {
      name: 'weex',
      requiresSecret: true,
      requiresPassphrase: true,
      validate: async (creds: NormalizedCredentials) => {
        const adapter = new WeexAdapter(creds.apiKey, creds.apiSecret || '', creds.passphrase, false);
        await adapter.getAccount();
      },
    };
  },
  kucoin: async () => {
    const { KucoinAdapter } = await import('../services/kucoinAdapter');
    return {
      name: 'kucoin',
      requiresSecret: true,
      requiresPassphrase: true,
      validate: async (creds: NormalizedCredentials) => {
        const adapter = new KucoinAdapter(creds.apiKey, creds.apiSecret || '', creds.passphrase);
        await adapter.getAccount();
      },
    };
  },
};

type CredentialValidationResult = {
  status: IntegrationStatus;
  message?: string;
  meta?: Record<string, any>;
};

const runCredentialValidation = async (
  exchangeName: string,
  creds: NormalizedCredentials,
  shouldValidate?: boolean
): Promise<CredentialValidationResult> => {
  if (!shouldValidate) {
    return { status: 'SAVED', message: 'Validation skipped' };
  }

  const key = exchangeName.trim().toLowerCase();
  const factory = credentialValidatorFactories[key];

  if (!factory) {
    return {
      status: 'UNVERIFIED',
      message: 'Validation skipped: no adapter available',
      meta: { reason: 'NO_ADAPTER' },
    };
  }

  try {
    const validator = await factory();

    if (validator.requiresSecret && !creds.apiSecret) {
      return {
        status: 'UNVERIFIED',
        message: 'Validation skipped: missing API secret',
        meta: { reason: 'MISSING_SECRET', adapter: validator.name },
      };
    }

    if (validator.requiresPassphrase && !creds.passphrase) {
      return {
        status: 'UNVERIFIED',
        message: 'Validation skipped: missing passphrase',
        meta: { reason: 'MISSING_PASSPHRASE', adapter: validator.name },
      };
    }

    await validator.validate(creds);
    return {
      status: 'VERIFIED',
      message: `${validator.name} credentials verified`,
      meta: { adapter: validator.name },
    };
  } catch (error: any) {
    logger.warn({ exchangeName, error: error.message }, 'Credential validation failed');
    return {
      status: 'UNVERIFIED',
      message: error.message || 'Validation failed',
      meta: { reason: 'VALIDATION_FAILED', adapter: key },
    };
  }
};

export async function integrationsRoutes(fastify: FastifyInstance) {
  const formatIntegrations = (integrations: Record<string, IntegrationDocument>): Record<string, any> => {
    const result: Record<string, any> = {};
    const coinApiTypes: Record<string, any> = {};

    for (const [docName, integration] of Object.entries(integrations)) {
      const basePayload = {
        enabled: integration.enabled,
        status: resolveStatus(integration),
        exchangeName: integration.exchangeName || docName,
        apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
        secretKey: integration.secretKey ? maskKey(integration.secretKey) : null,
        apiType: integration.apiType || null,
        updatedAt: integration.updatedAt?.toDate().toISOString(),
        createdAt: integration.createdAt?.toDate().toISOString(),
        meta: integration.meta || null,
      };

      if (docName.startsWith('coinapi_')) {
        const type = docName.replace('coinapi_', '');
        coinApiTypes[type] = {
          ...basePayload,
          apiType: type,
        };
      } else {
        result[docName] = basePayload;
      }
    }

    if (Object.keys(coinApiTypes).length > 0) {
      result.coinapi = coinApiTypes;
    }

    return result;
  };

  // Load all integrations for the user
  fastify.get('/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const integrations = await firestoreAdapter.getAllIntegrations(user.uid);

    return formatIntegrations(integrations);
  });

  fastify.get('/fetch', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const integrations = await firestoreAdapter.getAllIntegrations(user.uid);
      const formatted = formatIntegrations(integrations);
      const list = buildIntegrationList(integrations);
      const active = await firestoreAdapter.getActiveExchangeForUser(user.uid);

      return {
        ok: true,
        activeExchange: active.name,
        integrations: formatted,
        list,
        count: list.length,
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: (request as any).user?.uid }, 'Failed to fetch integrations');
      return reply.code(500).send({
        ok: false,
        code: 'FETCH_FAILED',
        message: error.message || 'Failed to fetch integrations',
      });
    }
  });

  fastify.post('/submit', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const uid = user?.uid;

    if (!uid || typeof uid !== 'string') {
      return reply.code(401).send({
        ok: false,
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }

    let body: z.infer<typeof integrationSubmitSchema>;
    try {
      body = integrationSubmitSchema.parse(request.body);
    } catch (err: any) {
      return reply.code(400).send({
        ok: false,
        code: 'INVALID_PAYLOAD',
        message: 'Invalid request data',
        details: err.errors || err.message,
      });
    }

    if (body.userId && body.userId !== uid) {
      return reply.code(403).send({
        ok: false,
        code: 'USER_MISMATCH',
        message: 'You can only submit credentials for your own account',
      });
    }

    const existingIntegrations = await firestoreAdapter.getAllIntegrations(uid);

    const displayName = body.exchangeName.trim();
    const docName = normalizeExchangeId(displayName);
    const normalizedExchangeName = displayName.toLowerCase();
    const secret = body.apiSecret || body.secretKey;
    const shouldValidate = body.validate === true;

    const existingActiveExchange = Object.entries(existingIntegrations).find(([storedName, integration]) => {
      if (!integration.enabled) return false;
      const normalized = (integration.exchangeName || storedName).toLowerCase();
      return SINGLE_EXCHANGE_NAMES.includes(normalized);
    });

    if (existingActiveExchange) {
      const activeName = (existingActiveExchange[1].exchangeName || existingActiveExchange[0]).toLowerCase();
      if (activeName !== normalizedExchangeName) {
        return reply.code(409).send({
          ok: false,
          code: 'ONLY_ONE_EXCHANGE_ALLOWED',
          message: 'Only one exchange can be connected at a time. Disable the existing exchange before adding another.',
        });
      }
    }

    const validationResult = await runCredentialValidation(docName, {
      apiKey: body.apiKey,
      apiSecret: secret,
      passphrase: body.passphrase,
    }, shouldValidate);

    const status = validationResult.status;
    const label = body.label?.trim() || displayName;
    const meta: Record<string, any> = {
      label,
      displayName,
      validateRequested: shouldValidate,
      submittedAt: new Date().toISOString(),
      validation: {
        status,
        message: validationResult.message,
        ...(validationResult.meta || {}),
      },
    };

    if (body.metadata) {
      meta.extra = body.metadata;
    }

    try {
      await firestoreAdapter.saveIntegration(uid, docName, {
        enabled: true,
        apiKey: body.apiKey,
        secretKey: secret,
        passphrase: body.passphrase,
        status,
        exchangeName: normalizedExchangeName,
        meta,
        userId: uid,
      });

      logger.info({
        uid,
        exchangeName: displayName,
        normalizedExchange: docName,
        status,
        maskedKey: maskKey(body.apiKey),
        result: status === 'VERIFIED' ? 'SUCCESS' : status,
      }, 'Integration submission processed');

      return reply.send({
        ok: true,
        id: docName,
        status,
        message: validationResult.message || 'API saved',
        integration: {
          id: docName,
          exchangeName: displayName,
          status,
          enabled: true,
        },
      });
    } catch (error: any) {
      const errorId = `integration_submit_${Date.now()}`;
      logger.error({
        uid,
        exchangeName: displayName,
        normalizedExchange: docName,
        error: error.message,
        maskedKey: maskKey(body.apiKey),
        errorId,
      }, 'Failed to save integration via submit');

      return reply.code(500).send({
        ok: false,
        code: 'INTEGRATION_SAVE_FAILED',
        message: 'Failed to save API credentials',
        errorId,
      });
    }
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

    const secretKey = body.secretKey || body.apiSecret;

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      // Accept both 'market' and 'coinapi_market' - normalize to 'coinapi_market'
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

    // Validate required fields based on API type
    if (body.apiName === 'binance') {
      if (body.enabled && (!body.apiKey || !secretKey)) {
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
    if (secretKey) {
      updateData.secretKey = secretKey;
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
    const user = (request as any).user;
    const uid = user.uid;
    if (!uid || typeof uid !== 'string') {
      return reply.code(400).send({ success: false, message: 'Invalid user authentication' });
    }
    let body: any;
    try {
      body = integrationUpdateSchema.parse(request.body);
    } catch (err: any) {
      return reply.code(400).send({ success: false, message: 'Invalid request data', details: err.errors || err.message });
    }
    const secretKey = body.secretKey || body.apiSecret;
    if (body.exchange && !body.apiName) {
      body.apiName = body.exchange;
    }
    if (!body.apiName) {
      return reply.code(400).send({ success: false, message: 'Missing required field: apiName or exchange' });
    }
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }
    const exchangeName = (body.apiName || '').toLowerCase();
    const exchangeApis = new Set(Object.keys(credentialValidatorFactories));
    const isExchangeApi = exchangeApis.has(exchangeName);

    if (!body.enabled) {
      const result = await firestoreAdapter.saveIntegration(uid, docName, {
        enabled: false,
        ...(isExchangeApi ? { apiType: 'exchange' } : {}),
      });
      const verification = await firestoreAdapter.getIntegration(uid, docName);
      if (!verification) {
        return reply.code(500).send({ success: false, message: 'Integration verification failed after disable' });
      }
      return reply.send({ success: true, message: 'Integration disabled successfully', doc: result });
    }
    // --- Unified live validation logic ---
    try {
      if (isExchangeApi) {
        if (!body.apiKey || !secretKey) {
          return reply.code(400).send({ success: false, message: `${body.apiName} API requires both API key and secret key` });
        }
        if ((body.apiName === 'bitget' || body.apiName === 'weex') && !body.passphrase) {
          return reply.code(400).send({ success: false, message: `${body.apiName} API requires passphrase in addition to API key and secret key` });
        }
        // Instantiate correct adapter and call its validation endpoint
        if (body.apiName === 'binance') {
          const testAdapter = new BinanceAdapter(body.apiKey, secretKey, false); // use production, not testnet
          await testAdapter.getAccount();
        } else if (body.apiName === 'bitget') {
          const { BitgetAdapter } = await import('../services/bitgetAdapter');
          const adapter = new BitgetAdapter(body.apiKey, secretKey, body.passphrase, false);
          await adapter.getAccount(); // implement getAccount to use /api/spot/v1/account/assets
        } else if (body.apiName === 'bingx') {
          const { BingXAdapter } = await import('../services/bingXAdapter');
          const adapter = new BingXAdapter(body.apiKey, secretKey, false);
          await adapter.getAccount(); // implement getAccount to use /api/v1/user/getBalance
        } else if (body.apiName === 'weex') {
          const { WeexAdapter } = await import('../services/weexAdapter');
          const adapter = new WeexAdapter(body.apiKey, secretKey, body.passphrase, false);
          await adapter.getAccount(); // implement getAccount to use /api/v1/private/account
        } else if (body.apiName === 'kucoin') {
          const { KucoinAdapter } = await import('../services/kucoinAdapter');
          const adapter = new KucoinAdapter(body.apiKey, secretKey, body.passphrase);
          await adapter.getAccount(); // implement getAccount to use /api/v1/accounts
        }
      } else if (!body.apiKey) {
        return reply.code(400).send({ success: false, message: `${body.apiName} API requires an API key` });
      }
      // If validation succeeds, save integration
      const updateData: { enabled: boolean; apiKey?: string; secretKey?: string; apiType?: string; passphrase?: string } = { enabled: true };
      if (body.apiKey) updateData.apiKey = body.apiKey;
      if (secretKey) updateData.secretKey = secretKey;
      if (body.passphrase) updateData.passphrase = body.passphrase;
      if (isExchangeApi) {
        updateData.apiType = 'exchange';
      } else if (body.apiType) {
        updateData.apiType = body.apiType;
      }
      if (body.passphrase) updateData.passphrase = body.passphrase;
      const result = await firestoreAdapter.saveIntegration(uid, docName, updateData);
      const verification = await firestoreAdapter.getIntegration(uid, docName);
      if (!verification) {
        return reply.code(500).send({ success: false, message: 'Integration verification failed after save' });
      }
      return reply.send({ success: true, message: 'Integration updated successfully', doc: result });
    } catch (validationErr: any) {
      return reply.code(400).send({ success: false, message: 'Invalid API key or secret' });
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
    const secretKey = body.secretKey || body.apiSecret;

    // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

    // Validate required fields based on API type
    if (body.apiName === 'binance') {
      if (body.enabled && (!body.apiKey || !secretKey)) {
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
    if (secretKey) {
      updateData.secretKey = secretKey;
    }
    if (body.apiType) {
      updateData.apiType = body.apiType;
    }

    await firestoreAdapter.saveIntegration(user.uid, docName, updateData);

    // PART 2: Also save to apiKeys collection if Binance with validation
    if (body.apiName === 'binance' && body.apiKey && secretKey) {
      // PART 2: Validate Binance API keys via connectivity test
      try {
        const testAdapter = new BinanceAdapter(body.apiKey, secretKey, true); // Test with testnet first
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
          apiSecretEncrypted: encrypt(secretKey),
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
          status: 'connected',
        });

        // Also save to integrations subcollection
        await firestoreAdapter.saveApiKeyToCollection(user.uid, {
          publicKey: body.apiKey,
          secretKey: secretKey,
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
    const secretKey = body.secretKey || body.apiSecret;

    try {
      // Handle CoinAPI sub-types
    let docName: string = body.apiName;
    if (body.apiName === 'coinapi' && body.apiType) {
      const t = body.apiType.startsWith('coinapi_') ? body.apiType : `coinapi_${body.apiType}`;
      docName = t;
    }

      // Validate based on API type
      if (body.apiName === 'binance') {
        if (!body.apiKey || !secretKey) {
          return reply.code(400).send({
            error: 'Binance API requires both API key and secret key',
            valid: false,
          });
        }

        try {
          const testAdapter = new BinanceAdapter(body.apiKey, secretKey, true);
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

  // GET /api/integrations/status - Get detailed status for all user integrations
  fastify.get('/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const uid = user?.uid;

      if (!uid) {
        return reply.code(401).send({
          ok: false,
          message: 'Authentication required',
        });
      }

      const integrations = await firestoreAdapter.getAllIntegrations(uid);
      const statusResults: Record<string, any> = {};

      // Process each integration
      for (const [exchangeName, integration] of Object.entries(integrations)) {
        if (!integration.enabled || !integration.apiKey) {
          statusResults[exchangeName] = {
            isConnected: false,
            exchangeName: integration.exchangeName || exchangeName,
            apiKeyStatus: 'missing',
            connectionStatus: 'disconnected',
            message: 'API key not configured',
          };
          continue;
        }

        try {
          // Decrypt credentials
          const apiKey = decrypt(integration.apiKey);
          const secretKey = integration.secretKey ? decrypt(integration.secretKey) : undefined;
          const passphrase = integration.passphrase ? decrypt(integration.passphrase) : undefined;

          if (!apiKey) {
            statusResults[exchangeName] = {
              isConnected: false,
              exchangeName: integration.exchangeName || exchangeName,
              apiKeyStatus: 'invalid',
              connectionStatus: 'disconnected',
              message: 'API key decryption failed',
            };
            continue;
          }

          // Test connection by creating adapter and testing
          const adapter = ExchangeConnectorFactory.create(exchangeName as any, {
            apiKey,
            secret: secretKey || '',
            passphrase,
            testnet: integration.testnet ?? false,
          });

          // Test connection (use getBalance as it's a good connectivity test)
          try {
            await adapter.getBalance();
            statusResults[exchangeName] = {
              isConnected: true,
              exchangeName: integration.exchangeName || exchangeName,
              apiKeyStatus: 'valid',
              connectionStatus: 'connected',
              message: 'API connection successful',
              testnet: integration.testnet ?? false,
            };
          } catch (connectionError: any) {
            statusResults[exchangeName] = {
              isConnected: false,
              exchangeName: integration.exchangeName || exchangeName,
              apiKeyStatus: 'valid',
              connectionStatus: 'connection_failed',
              message: connectionError.message || 'Connection test failed',
              testnet: integration.testnet ?? false,
            };
          }

        } catch (error: any) {
          statusResults[exchangeName] = {
            isConnected: false,
            exchangeName: integration.exchangeName || exchangeName,
            apiKeyStatus: 'error',
            connectionStatus: 'error',
            message: error.message || 'Status check failed',
          };
        }
      }

      return {
        ok: true,
        status: statusResults,
        timestamp: new Date().toISOString(),
      };

    } catch (error: any) {
      logger.error({ error: error.message, uid: (request as any).user?.uid }, 'Failed to get integration status');
      return reply.code(500).send({
        ok: false,
        message: error.message || 'Failed to get integration status',
      });
    }
  });
}

