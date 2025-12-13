import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { maskKey, encrypt, decrypt, getEncryptionKeyHash } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import { fetchNewsData } from '../services/newsDataAdapter';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

// REQUIRED HARD MAPPING - STRICT PROVIDER TYPE NORMALIZATION
const MARKET_DATA_PROVIDERS = new Set([
  "cryptocompare", "bybit", "okx", "kucoin", "bitget", "coinstats",
  "livecoinwatch", "marketaux", "kaiko", "messari", "coinapi",
  "coincap_metadata", "coingecko_metadata", "coinlore_metadata",
  "coinmarketcap_metadata", "coinpaprika_metadata"
]);

const NEWS_PROVIDERS = new Set([
  "newsdata", "cryptopanic", "reddit", "webzio",
  "gnews", "newscatcher", "coinstatsnews",
  "altcoinbuzz_rss", "cointelegraph_rss"
]);

const METADATA_PROVIDERS = new Set([
  "coingecko", "coinpaprika", "coincap", "coinlore",
  "coinmarketcap", "livecoinwatch_metadata"
]);

function normalizeProviderType(name: string): "marketData" | "news" | "metadata" {
  const normalizedName = name.toLowerCase().trim();
  if (MARKET_DATA_PROVIDERS.has(normalizedName)) return "marketData";
  if (NEWS_PROVIDERS.has(normalizedName)) return "news";
  if (METADATA_PROVIDERS.has(normalizedName)) return "metadata";
  console.error("UNKNOWN PROVIDER:", normalizedName, "- DEFAULTING TO marketData");
  return "marketData";
}

/**
 * Get user integrations with decrypted keys in the exact format required by deep research
 */
async function getUserIntegrationsLegacy(uid: string) {
  console.log("[UID-DEBUG] provider-config route called with uid =", uid);
  console.log("[UID-DEBUG] Firestore path = users/" + uid + "/integrations");
  const allIntegrations = await firestoreAdapter.getAllIntegrations(uid);

  const result: any = {
    // Trading exchanges
    binance: { apiKey: '', secret: '' },
    bitget: { apiKey: '', secret: '', passphrase: '' },
    bingx: { apiKey: '', secret: '' },
    weex: { apiKey: '', secret: '' },
    // Market data providers
    cryptocompare: { apiKey: '' },
    binancepublic: { apiKey: '' },
    kucoinpublic: { apiKey: '' },
    bybitpublic: { apiKey: '' },
    okxpublic: { apiKey: '' },
    bitgetpublic: { apiKey: '' },
    'cryptocompare-freemode-1': { apiKey: '' },
    'cryptocompare-freemode-2': { apiKey: '' },
    // Metadata providers
    coingecko: { apiKey: '' },
    coinmarketcap: { apiKey: '' },
    coinpaprika: { apiKey: '' },
    nomics: { apiKey: '' },
    messari: { apiKey: '' },
    cryptorank: { apiKey: '' },
    // News providers
    newsdata: { apiKey: '' },
    cryptopanic: { apiKey: '' },
    gnews: { apiKey: '' },
    reddit: { apiKey: '' },
    twitter: { apiKey: '' },
    alternativeme: { apiKey: '' }
  };

  const safeDecrypt = (value?: string) => {
    if (!value) return '';
    try {
      return decrypt(value) || '';
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to decrypt integration key');
      throw new Error(`Decryption failed: ${error.message}`);
    }
  };

  for (const [apiName, integration] of Object.entries(allIntegrations)) {
    const enabled = !!integration.enabled;
    const updatedAt = integration.updatedAt?.toDate?.()?.toISOString?.() || null;

    // CRITICAL: Use STRICT HARD MAPPED TYPES - IGNORE FIRESTORE integration.type COMPLETELY
    const type = normalizeProviderType(apiName);
    const decryptedApiKey = integration.apiKeyEncrypted ? safeDecrypt(integration.apiKeyEncrypted) : '';
    const decryptedSecret = integration.secretKeyEncrypted ? safeDecrypt(integration.secretKeyEncrypted) : '';

    // Base object stored for every provider so auto-trade always knows enabled/type/updatedAt
    const baseMeta = { enabled, type, updatedAt };

    // CRITICAL: Only decrypt from apiKeyEncrypted fields, never fallback to plain text
    // This ensures consistency and prevents double-decryption issues

    // Trading exchanges
    if (apiName === 'binance') {
      result.binance = {
        ...baseMeta,
        apiKey: enabled ? decryptedApiKey : '',
        secret: enabled ? decryptedSecret : '',
      };
      continue;
    }
    if (apiName === 'bitget') {
      result.bitget = {
        ...baseMeta,
        apiKey: enabled ? decryptedApiKey : '',
        secret: enabled ? decryptedSecret : '',
        passphrase: '', // Stored in exchangeConfig/current, not integrations
      };
      continue;
    }
    if (apiName === 'bingx') {
      result.bingx = {
        ...baseMeta,
        apiKey: enabled ? decryptedApiKey : '',
        secret: enabled ? decryptedSecret : '',
      };
      continue;
    }
    if (apiName === 'weex') {
      result.weex = {
        ...baseMeta,
        apiKey: enabled ? decryptedApiKey : '',
        secret: enabled ? decryptedSecret : '',
      };
      continue;
    }

    // Market data providers
    if (apiName === 'cryptocompare') {
      result.cryptocompare = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'binancepublic') {
      result.binancepublic = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'kucoinpublic') {
      result.kucoinpublic = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'bybitpublic') {
      result.bybitpublic = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'okxpublic') {
      result.okxpublic = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'bitgetpublic') {
      result.bitgetpublic = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'cryptocompare-freemode-1') {
      result['cryptocompare-freemode-1'] = { ...baseMeta, apiKey: 'FREE_MODE' };
      continue;
    }
    if (apiName === 'cryptocompare-freemode-2') {
      result['cryptocompare-freemode-2'] = { ...baseMeta, apiKey: 'FREE_MODE' };
      continue;
    }

    // Metadata providers
    if (apiName === 'coingecko') {
      result.coingecko = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'coinmarketcap') {
      result.coinmarketcap = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'coinpaprika') {
      result.coinpaprika = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'nomics') {
      result.nomics = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'messari') {
      result.messari = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'cryptorank') {
      result.cryptorank = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }

    // News providers
    if (apiName === 'newsdata') {
      result.newsdata = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'cryptopanic') {
      result.cryptopanic = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'gnews') {
      result.gnews = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'reddit') {
      result.reddit = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'twitter') {
      result.twitter = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }
    if (apiName === 'alternativeme') {
      result.alternativeme = { ...baseMeta, apiKey: enabled ? decryptedApiKey : '' };
      continue;
    }

    // Log unknown providers but don't fail
    logger.warn({ uid, apiName, type }, 'Unknown provider in integrations, skipping');
  }

  // Optional debug logging to trace provider loader output for diagnostics
  if (process.env.DEBUG_PROVIDER_LOG === '1') {
    try {
      ['cryptocompare', 'newsdata'].forEach((name) => {
        const entry = result[name];
        if (!entry) {
          console.log(`[PROVIDER-DEBUG] ${uid} -> ${name}: missing entry`);
          return;
        }
        const apiKeyLen = entry.apiKey ? entry.apiKey.length : 0;
        console.log(
          `[PROVIDER-DEBUG] ${uid} -> ${name}: enabled=${entry.enabled} type=${entry.type} apiKeyLen=${apiKeyLen} updatedAt=${entry.updatedAt || 'null'}`
        );
      });
    } catch (err: any) {
      logger.warn({ uid, err: err.message }, 'Provider debug logging failed');
    }
  }

  return result;
}

export async function getUserIntegrations(uid: string) {
  console.log("[PROVIDER-CONFIG][UID]", uid);
  console.log("[PROVIDER-CONFIG][PATH]", `users/${uid}/integrations`);

  const db = getFirebaseAdmin().firestore();
  const snap = await db.collection(`users/${uid}/integrations`).get();
  console.log("[PROVIDER-CONFIG][COUNT]", snap.size);

  const providerConfig: any = {
    marketData: {},
    news: {},
    metadata: {}
  };

  for (const doc of snap.docs) {
    const providerId = doc.id.toLowerCase();
    const data = doc.data() || {};

    let type: "marketData" | "news" | "metadata" = "marketData";
    const providerName = (data.providerName || providerId || '').toString().toLowerCase();
    if (providerName.includes('metadata')) {
      type = "metadata";
    } else if (NEWS_PROVIDERS.has(providerName)) {
      type = "news";
    } else {
      type = "marketData";
    }

    const normalized = {
      providerName: providerName || providerId,
      enabled: typeof data.enabled === 'boolean' ? data.enabled : false,
      apiKeyEncrypted: data.apiKeyEncrypted ?? null,
      decryptable: !!data.apiKeyEncrypted,
      needsReencrypt: false,
      usageStats: (data.usageStats && typeof data.usageStats === 'object') ? data.usageStats : { calls: 0 },
      updatedAt: data.updatedAt || null
    };

    providerConfig[type][providerId] = normalized;
  }

  return { success: true, providerConfig };
}

// Validation schemas - ALL providers including new ones
const integrationUpdateSchema = z.object({
  apiName: z.enum([
    // Trading exchanges
    'binance', 'bitget', 'bingx', 'weex',
    // Market data providers
    'cryptocompare', 'binancepublic', 'kucoinpublic', 'bybitpublic', 'okxpublic', 'bitgetpublic',
    'cryptocompare-freemode-1', 'cryptocompare-freemode-2',
    // Metadata providers
    'coingecko', 'coinmarketcap', 'coinpaprika', 'nomics', 'messari', 'cryptorank',
    // News providers
    'newsdata', 'cryptopanic', 'gnews', 'reddit', 'twitter', 'alternativeme'
  ]),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  secretKey: z.string().optional(),
});

const integrationDeleteSchema = z.object({
  apiName: z.enum([
    // Trading exchanges
    'binance', 'bitget', 'bingx', 'weex',
    // Market data providers
    'cryptocompare', 'binancepublic', 'kucoinpublic', 'bybitpublic', 'okxpublic', 'bitgetpublic',
    'cryptocompare-freemode-1', 'cryptocompare-freemode-2',
    // Metadata providers
    'coingecko', 'coinmarketcap', 'coinpaprika', 'nomics', 'messari', 'cryptorank',
    // News providers
    'newsdata', 'cryptopanic', 'gnews', 'reddit', 'twitter', 'alternativeme'
  ]),
});

export async function integrationsRoutes(fastify: FastifyInstance) {
  console.log("[ROUTE READY] GET /api/integrations/load");
  console.log("[ROUTE READY] POST /api/integrations/update");
  console.log("[ROUTE READY] POST /api/integrations/delete");
  console.log("[ROUTE READY] POST /api/integrations/connect");
  console.log("[ROUTE READY] POST /api/integrations/validate");
  console.log("[ROUTE READY] POST /api/integrations/upsert");
  console.log("[ROUTE READY] POST /api/integrations/setup-exchange");
  console.log("[ROUTE READY] GET /api/integrations");
  console.log("[ROUTE READY] POST /api/integrations/backup/add");

  // Load all integrations for the user
  fastify.get('/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).userId;
    console.log("[INTEGRATIONS UID USED]", userId);

    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    const integrations = await firestoreAdapter.getAllIntegrations(userId);

    // Return integrations with masked keys - ONLY 5 research providers
    const result: Record<string, any> = {};

    for (const [docName, integration] of Object.entries(integrations)) {
        result[docName] = {
          enabled: integration.enabled,
          apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
          secretKey: integration.secretKey ? maskKey(integration.secretKey) : null,
          updatedAt: integration.updatedAt?.toDate().toISOString(),
        };
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

    // Add required logging for API key saves
    if (body.apiKey) {
      console.log("SAVE-APIKEY", {
        uid: user.uid,
        provider: body.apiName,
        apiKeyLength: body.apiKey.length
      });
    }

    // Integration name is used directly (no CoinAPI sub-types)
    const docName: string = body.apiName;

    // CRITICAL: Use STRICT HARD MAPPED TYPES - IGNORE MANUAL MAPPING
    const providerType = normalizeProviderType(body.apiName);

    // Check if this is a trading exchange (Binance, Bitget, BingX, Weex)
    const tradingExchanges = ['binance', 'bitget', 'bingx', 'weex'];
    const isTradingExchange = tradingExchanges.includes(body.apiName);

    // Check if this is an auto-enabled research API (Binance Public, Free mode providers)
    const autoEnabledAPIs = ['binancepublic', 'cryptocompare-freemode-1', 'cryptocompare-freemode-2'];
    const isAutoEnabled = autoEnabledAPIs.includes(body.apiName);

    // Check if this is a free provider that doesn't require API keys
    const freeProviders = ['cryptocompare-freemode-1', 'cryptocompare-freemode-2'];
    const isFreeProvider = freeProviders.includes(body.apiName);

    // Validate required fields based on API type
    if (isTradingExchange) {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({
          error: `${body.apiName} API requires both API key and secret key`
        });
      }
    } else if (isFreeProvider) {
      // Free providers don't require API keys
      // Continue without validation
    } else if (!isAutoEnabled) {
      // Research APIs that require user-provided keys: NewsData, CryptoCompare, CoinGecko, etc.
      const primaryProviders = ['cryptocompare', 'coingecko', 'newsdata'];
      if (body.enabled && primaryProviders.includes(body.apiName) && !body.apiKey) {
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
      const integrationData: { enabled: boolean; apiKey?: string; type: string } = {
        enabled: true,
        type: providerType
      };

      // Only set API key for providers that require it
      if (!isFreeProvider && body.apiKey) {
        integrationData.apiKey = body.apiKey;
      } else if (!isFreeProvider && !body.apiKey) {
        return reply.code(400).send({
          error: `${body.apiName} API requires an API key`,
          saved: false
        });
      }
      // For free providers, no API key is needed

      // Add required logging
      console.log("BACKEND-SAVE", { uid: user.uid, provider: body.apiName, apiKeyLength: body.apiKey?.length || 0 });

      logger.info({
        uid: user.uid,
        apiName: body.apiName,
        docName,
        hasApiKey: !!body.apiKey
      }, 'Saving research API integration');

      await firestoreAdapter.saveIntegration(user.uid, docName, integrationData);

      // Verify it was saved by reading it back
      const saved = await firestoreAdapter.getIntegration(user.uid, docName);
      if (saved && saved.apiKey) {
        logger.info({ uid: user.uid, apiName: docName, saved: !!saved.apiKey }, 'Research API integration saved and verified');
      } else {
        logger.error({ uid: user.uid, apiName: docName }, 'Research API integration save verification failed');
        return reply.code(500).send({
          error: 'Failed to save integration',
          saved: false
        });
      }
    }

    return {
      message: 'Integration updated',
      apiName: body.apiName,
      enabled: true,
      saved: true,
    };
  });

  // Delete an integration
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = integrationDeleteSchema.parse(request.body);

    // Integration name is used directly
    const docName: string = body.apiName;

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

    // Integration name is used directly
    const docName: string = body.apiName;

    // Check if this is a trading exchange (Binance, Bitget, BingX, Weex)
    const tradingExchanges = ['binance', 'bitget', 'bingx', 'weex'];
    const isTradingExchange = tradingExchanges.includes(body.apiName);

    // Check if this is an auto-enabled research API (Binance Public, Free mode providers)
    const autoEnabledAPIs = ['binancepublic', 'cryptocompare-freemode-1', 'cryptocompare-freemode-2'];
    const isAutoEnabled = autoEnabledAPIs.includes(body.apiName);

    // Check if this is a free provider that doesn't require API keys
    const freeProviders = ['cryptocompare-freemode-1', 'cryptocompare-freemode-2'];
    const isFreeProvider = freeProviders.includes(body.apiName);

    // Validate required fields based on API type
    if (isTradingExchange) {
      if (body.enabled && (!body.apiKey || !body.secretKey)) {
        return reply.code(400).send({
          error: `${body.apiName} API requires both API key and secret key`
        });
      }
    } else if (isFreeProvider) {
      // Free providers don't require API keys
      // Continue without validation
    } else if (!isAutoEnabled) {
      // Research APIs that require user-provided keys: NewsData, CryptoCompare, CoinGecko, etc.
      const primaryProviders = ['cryptocompare', 'coingecko', 'newsdata'];
      if (body.enabled && primaryProviders.includes(body.apiName) && !body.apiKey) {
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
      await firestoreAdapter.saveIntegration(user.uid, docName, {
        enabled: true,
      });
    }

    return {
      message: 'API connected successfully',
      apiName: body.apiName,
      enabled: true,
      saved: true,
    };
  });

  // Validate API integration
  fastify.post('/validate', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = integrationUpdateSchema.parse(request.body);

    try {
      // Validate based on API type (no CoinAPI sub-types)
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
      } else if (body.apiName === 'newsdata') {
        // NewsData.io API key is required
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'NewsData.io API requires an API key',
            apiName: 'newsdata',
          });
        }

        try {
          const newsData = await fetchNewsData(body.apiKey);

          return {
            valid: true,
            apiName: 'newsdata',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'NewsData.io API validation failed',
            apiName: 'newsdata',
          });
        }
      } else if (body.apiName === 'coinmarketcap') {
        // CoinMarketCap API key is optional
        try {
          const { fetchCoinMarketCapMarketData } = await import('../services/coinMarketCapAdapter');
          const cmcData = await fetchCoinMarketCapMarketData('ETH', body.apiKey);

          return {
            valid: true,
            apiName: 'coinmarketcap',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CoinMarketCap API validation failed',
            apiName: 'coinmarketcap',
          });
        }
      } else if (body.apiName === 'cryptocompare') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'CryptoCompare API requires an API key',
            apiName: 'cryptocompare',
          });
        }

        try {
          const { CryptoCompareAdapter } = await import('../services/cryptocompareAdapter');
          const adapter = new CryptoCompareAdapter(body.apiKey);
          // Test with a simple call
          await adapter.getMarketData('ETH');

          return {
            valid: true,
            apiName: 'cryptocompare',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CryptoCompare API validation failed',
            apiName: 'cryptocompare',
          });
        }
      } else if (body.apiName === 'binancepublic') {
        // Binance Public API is auto-enabled, no validation needed
        return {
          valid: true,
          apiName: 'binancepublic',
          note: 'Binance Public API is auto-enabled and does not require API keys',
        };
      } else if (body.apiName === 'cryptocompare-freemode-1' || body.apiName === 'cryptocompare-freemode-2') {
        // CryptoCompare Free Mode providers are auto-enabled, no validation needed
        return {
          valid: true,
          apiName: body.apiName,
          note: 'CryptoCompare Free Mode is auto-enabled and does not require API keys',
        };
      } else if (body.apiName === 'kucoinpublic') {
        // KuCoin Public API is auto-enabled, no validation needed
        return {
          valid: true,
          apiName: 'kucoinpublic',
          note: 'KuCoin Public API is auto-enabled and does not require API keys',
        };
      } else if (body.apiName === 'bybitpublic') {
        // Bybit Public API is auto-enabled, no validation needed
        return {
          valid: true,
          apiName: 'bybitpublic',
          note: 'Bybit Public API is auto-enabled and does not require API keys',
        };
      } else if (body.apiName === 'okxpublic') {
        // OKX Public API is auto-enabled, no validation needed
        return {
          valid: true,
          apiName: 'okxpublic',
          note: 'OKX Public API is auto-enabled and does not require API keys',
        };
      } else if (body.apiName === 'bitgetpublic') {
        // Bitget Public API is auto-enabled, no validation needed
        return {
          valid: true,
          apiName: 'bitgetpublic',
          note: 'Bitget Public API is auto-enabled and does not require API keys',
        };
      } else if (body.apiName === 'coingecko') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'CoinGecko API requires an API key',
            apiName: 'coingecko',
          });
        }

        try {
          // Import and validate CoinGecko API
          // TODO: Fix CoinGecko adapter module resolution issue
          // const { fetchCoinGeckoMarketData } = await import('../services/coinGeckoAdapter');
          // const coinGeckoData = await fetchCoinGeckoMarketData('bitcoin', body.apiKey);
          throw new Error('CoinGecko adapter temporarily disabled due to module resolution issue');

          return {
            valid: true,
            apiName: 'coingecko',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CoinGecko API validation failed',
            apiName: 'coingecko',
          });
        }
      } else if (body.apiName === 'coinpaprika') {
        // CoinPaprika can work without API key for basic functionality
        try {
          const { fetchCoinPaprikaMarketData } = await import('../services/coinPaprikaAdapter');
          const paprikaData = await fetchCoinPaprikaMarketData('btc-bitcoin');

          return {
            valid: true,
            apiName: 'coinpaprika',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CoinPaprika API validation failed',
            apiName: 'coinpaprika',
          });
        }
      } else if (body.apiName === 'nomics') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'Nomics API requires an API key',
            apiName: 'nomics',
          });
        }

        try {
          const { fetchNomicsMarketData } = await import('../services/nomicsAdapter');
          const nomicsData = await fetchNomicsMarketData('BTC', body.apiKey);

          return {
            valid: true,
            apiName: 'nomics',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'Nomics API validation failed',
            apiName: 'nomics',
          });
        }
      } else if (body.apiName === 'messari') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'Messari API requires an API key',
            apiName: 'messari',
          });
        }

        try {
          const { fetchMessariMarketData } = await import('../services/messariAdapter');
          const messariData = await fetchMessariMarketData('bitcoin', body.apiKey);

          return {
            valid: true,
            apiName: 'messari',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'Messari API validation failed',
            apiName: 'messari',
          });
        }
      } else if (body.apiName === 'cryptorank') {
        // CryptoRank can work without API key for basic functionality
        try {
          const { fetchCryptoRankMarketData } = await import('../services/cryptoRankAdapter');
          const rankData = await fetchCryptoRankMarketData();

          return {
            valid: true,
            apiName: 'cryptorank',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CryptoRank API validation failed',
            apiName: 'cryptorank',
          });
        }
      } else if (body.apiName === 'cryptopanic') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'CryptoPanic API requires an API key',
            apiName: 'cryptopanic',
          });
        }

        try {
          const { fetchCryptoPanicNews } = await import('../services/cryptoPanicAdapter');
          const panicData = await fetchCryptoPanicNews(body.apiKey);

          return {
            valid: true,
            apiName: 'cryptopanic',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'CryptoPanic API validation failed',
            apiName: 'cryptopanic',
          });
        }
      } else if (body.apiName === 'gnews') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'GNews API requires an API key',
            apiName: 'gnews',
          });
        }

        try {
          const { fetchGNews } = await import('../services/gnewsAdapter');
          const gnewsData = await fetchGNews('bitcoin', body.apiKey);

          return {
            valid: true,
            apiName: 'gnews',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'GNews API validation failed',
            apiName: 'gnews',
          });
        }
      } else if (body.apiName === 'reddit') {
        // Reddit API can work without explicit API key for basic functionality
        try {
          const { fetchRedditCryptoNews } = await import('../services/redditAdapter');
          const redditData = await fetchRedditCryptoNews();

          return {
            valid: true,
            apiName: 'reddit',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'Reddit API validation failed',
            apiName: 'reddit',
          });
        }
      } else if (body.apiName === 'twitter') {
        if (!body.apiKey) {
          return reply.code(400).send({
            valid: false,
            error: 'Twitter API requires an API key',
            apiName: 'twitter',
          });
        }

        try {
          const { fetchTwitterCryptoNews } = await import('../services/twitterAdapter');
          const twitterData = await fetchTwitterCryptoNews(body.apiKey);

          return {
            valid: true,
            apiName: 'twitter',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'Twitter API validation failed',
            apiName: 'twitter',
          });
        }
      } else if (body.apiName === 'alternativeme') {
        // Alternative.me API works without API key
        try {
          const { fetchAlternativeMeNews } = await import('../services/alternativeMeAdapter');
          const altData = await fetchAlternativeMeNews();

          return {
            valid: true,
            apiName: 'alternativeme',
          };
        } catch (error: any) {
          return reply.code(400).send({
            valid: false,
            error: error.message || 'Alternative.me API validation failed',
            apiName: 'alternativeme',
          });
        }
      } else {
        return reply.code(400).send({
          valid: false,
          error: 'Unknown API name',
        });
      }
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'API validation error');
      return reply.code(500).send({
        valid: false,
        error: error.message || 'Internal server error',
      });
    }
  });

  // POST /api/integrations/upsert - Create or update integration (admin only)
  fastify.post('/upsert', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: {
    userId?: string;
    apiName: string;
    enabled: boolean;
    apiKey?: string;
    secretKey?: string;
    apiType?: string;
  } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { userId, apiName, enabled, apiKey, secretKey, apiType } = request.body;

      // Allow admin to specify userId, otherwise use current user
      const targetUserId = userId || user.uid;

      // Check if user has admin permissions to modify other users
      if (userId && userId !== user.uid) {
        const isAdmin = await firestoreAdapter.isAdmin(user.uid);
        if (!isAdmin) {
          return reply.code(403).send({ error: 'Admin permission required to modify other users' });
        }
      }

      await firestoreAdapter.saveIntegration(targetUserId, apiName, {
        enabled,
        apiKey,
        secretKey,
        apiType
      });

      logger.info({
        uid: user.uid,
        targetUid: targetUserId,
        apiName,
        enabled,
        hasApiKey: !!apiKey,
        hasSecretKey: !!secretKey
      }, 'Integration upserted');

      return {
        success: true,
        apiName,
        enabled,
        message: 'Integration updated successfully'
      };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error upserting integration');
      return reply.code(500).send({
        error: err.message || 'Error upserting integration',
        success: false
      });
    }
  });

  // POST /api/integrations/setup-exchange - Setup exchange configuration (admin only)
  fastify.post('/setup-exchange', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: {
    userId?: string;
    exchange: string;
    apiKey: string;
    secret: string;
    passphrase?: string;
    testnet?: boolean;
  } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const { userId, exchange, apiKey, secret, passphrase, testnet = true } = request.body;

      // Allow admin to specify userId, otherwise use current user
      const targetUserId = userId || user.uid;

      // Check if user has admin permissions to modify other users
      if (userId && userId !== user.uid) {
        const isAdmin = await firestoreAdapter.isAdmin(user.uid);
        if (!isAdmin) {
          return reply.code(403).send({ error: 'Admin permission required to modify other users' });
        }
      }

      // Validate required fields
      if (!apiKey || !secret) {
        return reply.code(400).send({ error: 'API key and secret are required' });
      }

      const db = getFirebaseAdmin().firestore();
      const docRef = db
        .collection('users')
        .doc(targetUserId)
        .collection('exchangeConfig')
        .doc('current');

      const configData: any = {
        exchange,
        apiKeyEncrypted: encrypt(apiKey),
        secretEncrypted: encrypt(secret),
        testnet,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      if (passphrase) {
        configData.passphraseEncrypted = encrypt(passphrase);
      }

      await docRef.set(configData, { merge: true });

      logger.info({
        uid: user.uid,
        targetUid: targetUserId,
        exchange,
        hasPassphrase: !!passphrase,
        testnet
      }, 'Exchange configuration setup');

      return {
        success: true,
        exchange,
        testnet,
        message: 'Exchange configuration updated successfully'
      };
    } catch (err: any) {
      logger.error({ err, uid: (request as any).user?.uid }, 'Error setting up exchange configuration');
      return reply.code(500).send({ error: err.message || 'Error setting up exchange configuration' });
    }
  });

  // GET /api/integrations - Get all user integrations
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const integrations = await getUserIntegrations(user.uid);
      logger.info({
        uid: user.uid,
        providers: Object.entries(integrations || {}).map(([k, v]: any) => ({
          provider: k,
          enabled: !!v?.enabled,
          type: v?.type,
          providerName: v?.providerName || k,
          decryptedLen: typeof v?.apiKey === 'string' ? v.apiKey.length : 0
        }))
      }, 'Integrations response snapshot (lengths only)');
      return { integrations };
    } catch (err: any) {
      logger.error({ err, uid: user.uid }, 'Error getting user integrations');
      return reply.code(500).send({ error: err.message || 'Error fetching integrations' });
    }
  });

  fastify.get('/internal/debug/integrations', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const BACKEND_SECRET_HASH = getEncryptionKeyHash();
      const integrations = await firestoreAdapter.getAllIntegrations(user.uid);
      const providers: Record<string, { encryptedLen: number; decryptedLen: number; needsReencrypt?: boolean; type?: any; enabled?: boolean }> = {};

      for (const [providerId, integration] of Object.entries(integrations)) {
        const encryptedKey = integration.apiKey || '';
        let decryptedKey = '';
        try {
          decryptedKey = encryptedKey ? decrypt(encryptedKey) || '' : '';
        } catch {
          decryptedKey = '';
        }

        providers[providerId] = {
          encryptedLen: encryptedKey.length,
          decryptedLen: decryptedKey.length,
          needsReencrypt: (integration as any).needsReencrypt || false,
          type: (integration as any).type || integration.apiType,
          enabled: integration.enabled
        };
      }

      logger.debug({ uid: user.uid, BACKEND_SECRET_HASH }, 'Internal integrations debug snapshot');

      return {
        BACKEND_SECRET_HASH,
        providers
      };
    } catch (err: any) {
      logger.error({ uid: user.uid, err: err.message }, 'Failed to load internal integrations debug snapshot');
      return reply.code(500).send({ error: err.message || 'Failed to load integrations debug data' });
    }
  });

  // POST /api/integrations/backup/add - Add backup API for a provider
  fastify.post('/backup/add', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { providerName: string; backupData: { name: string; apiKey: string; endpoint?: string; active: boolean } } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = z.object({
      providerName: z.string(),
      backupData: z.object({
        name: z.string(),
        apiKey: z.string(),
        endpoint: z.string().optional(),
        active: z.boolean()
      })
    }).parse(request.body || {});

    try {
      const { providerName, backupData } = body;

      // Get current integrations
      const currentIntegrations = await firestoreAdapter.getAllIntegrations(user.uid);

      // Initialize backup APIs array if not exists
      if (!currentIntegrations[providerName.toLowerCase()]) {
        currentIntegrations[providerName.toLowerCase()] = {
          enabled: false,
          apiKey: '',
          backupApis: [],
          updatedAt: admin.firestore.Timestamp.now()
        };
      }

      if (!currentIntegrations[providerName.toLowerCase()].backupApis) {
        currentIntegrations[providerName.toLowerCase()].backupApis = [];
      }

      // Encrypt the API key
      const encryptedApiKey = encrypt(backupData.apiKey);

      // Add the backup API
      const newBackup = {
        name: backupData.name,
        apiKey: encryptedApiKey,
        endpoint: backupData.endpoint,
        active: backupData.active,
        createdAt: admin.firestore.Timestamp.now()
      };

      currentIntegrations[providerName.toLowerCase()].backupApis.push(newBackup);

      // Save back to Firestore
      await firestoreAdapter.saveIntegration(user.uid, providerName.toLowerCase(), currentIntegrations[providerName.toLowerCase()]);

      logger.info({
        uid: user.uid,
        providerName,
        backupName: backupData.name
      }, 'Backup API added successfully');

      return {
        success: true,
        message: 'Backup API added successfully',
        backup: {
          name: backupData.name,
          active: backupData.active,
          endpoint: backupData.endpoint
        }
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid: user.uid }, 'Failed to add backup API');
      return reply.code(500).send({
        error: 'Failed to add backup API',
        reason: error.message || 'Unknown error occurred'
      });
    }
  });

  // Provider routes (aliases for frontend compatibility)

  // GET /provider/list - List providers by type
  fastify.get('/provider/list', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Querystring: { type?: string } }>, reply: FastifyReply) => {
    const user = (request as any).user;
    const { type } = request.query;

    try {
      const integrations = await firestoreAdapter.getAllIntegrations(user.uid);

      // Return integrations with masked keys
      const result: any = {};

      // Group by type if requested
      if (type) {
        const filtered: any = {};
        for (const [key, integration] of Object.entries(integrations)) {
          // Simple type filtering
          if (type === 'marketData' && ['coingecko', 'coinpaprika', 'coinmarketcap', 'coinapi', 'bravenewcoin', 'messari', 'kaiko', 'livecoinwatch', 'coinstats', 'coincheckup'].includes(key)) {
            filtered[key] = {
              enabled: integration.enabled,
              apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
            };
          } else if (type === 'news' && ['newsdataio', 'cryptopanic', 'reddit', 'cointelegraph', 'altcoinbuzz', 'gnews', 'marketaux', 'webz', 'coinstatsnews', 'newscatcher', 'cryptocomparenews'].includes(key)) {
            filtered[key] = {
              enabled: integration.enabled,
              apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
            };
          } else if (type === 'metadata' && ['cryptocompare', 'coincap', 'coinranking', 'nomics'].includes(key)) {
            filtered[key] = {
              enabled: integration.enabled,
              apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
            };
          }
        }
        return { providers: filtered, type };
      }

      // Return all if no type filter
      for (const [key, integration] of Object.entries(integrations)) {
        result[key] = {
          enabled: integration.enabled,
          apiKey: integration.apiKey ? maskKey(integration.apiKey) : null,
          secretKey: integration.secretKey ? maskKey(integration.secretKey) : null,
        };
      }

      return { providers: result };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Provider list failed');
      return reply.code(500).send({ error: err.message || 'Failed to list providers' });
    }
  });

  // POST /provider/update - Update provider
  fastify.post('/provider/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = request.body as any;
    const { apiName, enabled, apiKey, type } = body;

    try {
      logger.info({
        uid: user.uid,
        apiName,
        enabled,
        hasApiKey: !!apiKey
      }, 'Provider update request');

      await firestoreAdapter.saveIntegration(user.uid, apiName, {
        enabled,
        apiKey: apiKey || undefined,
        apiType: type
      });

      return { success: true };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Provider update failed');
      return reply.code(500).send({ error: err.message || 'Failed to update provider' });
    }
  });

  // POST /provider/test - Test provider
  fastify.post('/provider/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = request.body as any;
    const { apiName, apiKey, type } = body;

    try {
      logger.info({
        uid: user.uid,
        apiName,
        hasApiKey: !!apiKey
      }, 'Provider test request');

      // Simple test - just check if the provider exists and is enabled
      const integration = await firestoreAdapter.getIntegration(user.uid, apiName);

      return {
        success: true,
        message: integration?.enabled ? 'Provider is configured' : 'Provider is not enabled'
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Provider test failed');
      return reply.code(500).send({ error: err.message || 'Failed to test provider' });
    }
  });
}

