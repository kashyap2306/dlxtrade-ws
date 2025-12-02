import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { maskKey, encrypt, decrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import { fetchNewsData } from '../services/newsDataAdapter';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

/**
 * Get user integrations with decrypted keys in the exact format required by deep research
 */
export async function getUserIntegrations(uid: string) {
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

  for (const [apiName, integration] of Object.entries(allIntegrations)) {
    try {
      if (integration.enabled) {
        // Trading exchanges
        if (apiName === 'binance' && integration.apiKey && integration.secretKey) {
          result.binance.apiKey = decrypt(integration.apiKey) || '';
          result.binance.secret = decrypt(integration.secretKey) || '';
        } else if (apiName === 'bitget' && integration.apiKey && integration.secretKey) {
          result.bitget.apiKey = decrypt(integration.apiKey) || '';
          result.bitget.secret = decrypt(integration.secretKey) || '';
          // Note: passphrase is stored in exchangeConfig, not integrations
          result.bitget.passphrase = '';
        } else if (apiName === 'bingx' && integration.apiKey && integration.secretKey) {
          result.bingx.apiKey = decrypt(integration.apiKey) || '';
          result.bingx.secret = decrypt(integration.secretKey) || '';
        } else if (apiName === 'weex' && integration.apiKey && integration.secretKey) {
          result.weex.apiKey = decrypt(integration.apiKey) || '';
          result.weex.secret = decrypt(integration.secretKey) || '';
        }
        // Market data providers
        else if (apiName === 'cryptocompare' && integration.apiKey) {
          result.cryptocompare.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'binancepublic' && integration.apiKey) {
          result.binancepublic.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'kucoinpublic' && integration.apiKey) {
          result.kucoinpublic.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'bybitpublic' && integration.apiKey) {
          result.bybitpublic.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'okxpublic' && integration.apiKey) {
          result.okxpublic.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'bitgetpublic' && integration.apiKey) {
          result.bitgetpublic.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'cryptocompare-freemode-1') {
          // No API key required for free mode providers
          result['cryptocompare-freemode-1'].apiKey = 'FREE_MODE';
        } else if (apiName === 'cryptocompare-freemode-2') {
          // No API key required for free mode providers
          result['cryptocompare-freemode-2'].apiKey = 'FREE_MODE';
        }
        // Metadata providers
        else if (apiName === 'coingecko' && integration.apiKey) {
          result.coingecko.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'coinmarketcap' && integration.apiKey) {
          result.coinmarketcap.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'coinpaprika' && integration.apiKey) {
          result.coinpaprika.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'nomics' && integration.apiKey) {
          result.nomics.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'messari' && integration.apiKey) {
          result.messari.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'cryptorank' && integration.apiKey) {
          result.cryptorank.apiKey = decrypt(integration.apiKey) || '';
        }
        // News providers
        else if (apiName === 'newsdata' && integration.apiKey) {
          result.newsdata.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'cryptopanic' && integration.apiKey) {
          result.cryptopanic.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'gnews' && integration.apiKey) {
          result.gnews.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'reddit' && integration.apiKey) {
          result.reddit.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'twitter' && integration.apiKey) {
          result.twitter.apiKey = decrypt(integration.apiKey) || '';
        } else if (apiName === 'alternativeme' && integration.apiKey) {
          result.alternativeme.apiKey = decrypt(integration.apiKey) || '';
        }
      }
    } catch (error: any) {
      logger.warn({ error: error.message, uid, apiName }, 'Failed to decrypt integration key, using empty string');
      // Continue with empty strings for missing/invalid keys
    }
  }

  return result;
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
  // Load all integrations for the user
  fastify.get('/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const integrations = await firestoreAdapter.getAllIntegrations(user.uid);

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
      const integrationData: { enabled: boolean; apiKey?: string } = {
        enabled: true
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
      const integrationData: { enabled: boolean; apiKey?: string } = {
        enabled: true,
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
}

