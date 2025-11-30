import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../services/firestoreAdapter';
import { z } from 'zod';
import { maskKey, encrypt, decrypt } from '../services/keyManager';
import { BinanceAdapter } from '../services/binanceAdapter';
import { fetchNewsData } from '../services/newsDataAdapter';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';

// Validation schemas - ONLY 4 providers allowed
const integrationUpdateSchema = z.object({
  apiName: z.enum(['binance', 'cryptocompare', 'newsdata', 'coinmarketcap']),
  enabled: z.boolean(),
  apiKey: z.string().optional(),
  secretKey: z.string().optional(),
});

const integrationDeleteSchema = z.object({
  apiName: z.enum(['binance', 'cryptocompare', 'newsdata', 'coinmarketcap']),
});

export async function integrationsRoutes(fastify: FastifyInstance) {
  // Load all integrations for the user
  fastify.get('/load', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const db = admin.firestore(getFirebaseAdmin());

    const providers = ['binance', 'cryptocompare', 'newsdata', 'coinmarketcap'];
    const result: Record<string, any> = {};

    for (const provider of providers) {
      try {
        const docRef = db.collection('users').doc(user.uid).collection('integrations').doc(provider);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
          const data = docSnap.data();

          let decryptedKey = null;
          let decryptedSecret = null;

          // Decrypt apiKey with error handling
          if (data?.apiKey) {
            try {
              decryptedKey = decrypt(data.apiKey);
            } catch (err) {
              logger.warn({ uid: user.uid, provider }, 'Decrypt apiKey failed', err.message);
              decryptedKey = null;
            }
          }

          // Decrypt secretKey for binance only
          if (provider === 'binance' && data?.secretKey) {
            try {
              decryptedSecret = decrypt(data.secretKey);
            } catch (err) {
              logger.warn({ uid: user.uid, provider }, 'Decrypt secretKey failed', err.message);
              decryptedSecret = null;
            }
          }

          result[provider] = {
            enabled: data.enabled || false,
            apiKey: decryptedKey ? maskKey(decryptedKey) : null
          };

          if (provider === 'binance') {
            result[provider].secretKey = decryptedSecret ? maskKey(decryptedSecret) : null;
          }

        } else {
          result[provider] = {
            enabled: false,
            apiKey: null
          };
          if (provider === 'binance') {
            result[provider].secretKey = null;
          }
        }
      } catch (error) {
        logger.warn({ uid: user.uid, provider }, 'Load integration error', error.message);
        // Never throw errors - return disabled state
        result[provider] = {
          enabled: false,
          apiKey: null
        };
        if (provider === 'binance') {
          result[provider].secretKey = null;
        }
      }
    }

    return result;
  });

  // Update or create an integration
  fastify.post('/update', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = integrationUpdateSchema.parse(request.body);

      const provider = body.apiName;
      const db = admin.firestore(getFirebaseAdmin());
      const ref = db.collection("users").doc(user.uid).collection("integrations").doc(provider);

      logger.info({
        uid: user.uid,
        provider,
        enabled: body.enabled,
        hasApiKey: !!body.apiKey,
        hasSecretKey: !!body.secretKey
      }, 'Integration update request');

      // Handle enabled flag explicitly
      if (body.enabled === false) {
        // Set enabled false and clear keys
        const clearData: any = {
          enabled: false,
          apiKey: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // Only clear secretKey for binance
        if (provider === 'binance') {
          clearData.secretKey = null;
        }

        await ref.set(clearData, { merge: true });

        logger.info({ uid: user.uid, provider }, 'Integration disabled and keys cleared');

        return reply.status(200).send({ success: true, disabled: true });
      }

      // When enabling, validate required keys
      if (provider === 'binance') {
        if (!body.apiKey || !body.secretKey) {
          logger.warn({ uid: user.uid, provider }, 'Binance update failed: missing required keys');
          return reply.code(400).send({
            success: false,
            error: 'Binance requires both API key and secret key'
          });
        }
      } else {
        // Research providers
        if (!body.apiKey) {
          logger.warn({ uid: user.uid, provider }, 'Research provider update failed: missing API key');
          return reply.code(400).send({
            success: false,
            error: `${provider} requires an API key`
          });
        }
      }

      // Save with proper document structure
      if (provider === 'binance') {
        const encryptedKey = encrypt(body.apiKey!);
        const encryptedSecret = encrypt(body.secretKey!);

        const docData = {
          enabled: true,
          apiKey: encryptedKey,
          secretKey: encryptedSecret,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await ref.set(docData, { merge: true });

      } else {
        const encryptedKey = encrypt(body.apiKey!);

        const docData = {
          enabled: true,
          apiKey: encryptedKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await ref.set(docData, { merge: true });
      }

      logger.info({ uid: user.uid, provider }, 'Integration enabled and saved successfully');

      return reply.status(200).send({ success: true });

    } catch (error: any) {
      logger.error({ uid: (request as any).user?.uid, provider: (request.body as any)?.apiName }, 'Integration update error', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  // Delete an integration
  fastify.post('/delete', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = integrationDeleteSchema.parse(request.body);

      const provider = body.apiName;
      const db = admin.firestore(getFirebaseAdmin());
      const ref = db.collection("users").doc(user.uid).collection("integrations").doc(provider);

      await ref.delete();

      logger.info({ uid: user.uid, provider }, 'Integration deleted successfully');

      return reply.status(200).send({
        success: true,
        message: 'Integration deleted',
        apiName: body.apiName
      });

    } catch (error: any) {
      logger.error({ uid: (request as any).user?.uid, provider: (request.body as any)?.apiName }, 'Integration delete error', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Delete failed'
      });
    }
  });

  // Connect API (alias for update, for backward compatibility)
  fastify.post('/connect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const body = integrationUpdateSchema.parse(request.body);

      const provider = body.apiName;
      const db = admin.firestore(getFirebaseAdmin());
      const ref = db.collection("users").doc(user.uid).collection("integrations").doc(provider);

      logger.info({
        uid: user.uid,
        provider,
        enabled: body.enabled,
        hasApiKey: !!body.apiKey,
        hasSecretKey: !!body.secretKey
      }, 'Integration connect request');

      // Handle enabled flag explicitly (same as /update)
      if (body.enabled === false) {
        const clearData: any = {
          enabled: false,
          apiKey: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (provider === 'binance') {
          clearData.secretKey = null;
        }

        await ref.set(clearData, { merge: true });

        logger.info({ uid: user.uid, provider }, 'Integration disabled via connect');

        return reply.status(200).send({ success: true, disabled: true });
      }

      // When enabling, validate required keys
      if (provider === 'binance') {
        if (!body.apiKey || !body.secretKey) {
          logger.warn({ uid: user.uid, provider }, 'Binance connect failed: missing required keys');
          return reply.code(400).send({
            success: false,
            error: 'Binance requires both API key and secret key'
          });
        }
      } else {
        if (!body.apiKey) {
          logger.warn({ uid: user.uid, provider }, 'Research provider connect failed: missing API key');
          return reply.code(400).send({
            success: false,
            error: `${provider} requires an API key`
          });
        }
      }

      // Save with proper document structure
      if (provider === 'binance') {
        const encryptedKey = encrypt(body.apiKey!);
        const encryptedSecret = encrypt(body.secretKey!);

        const docData = {
          enabled: true,
          apiKey: encryptedKey,
          secretKey: encryptedSecret,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await ref.set(docData, { merge: true });

      } else {
        const encryptedKey = encrypt(body.apiKey!);

        const docData = {
          enabled: true,
          apiKey: encryptedKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await ref.set(docData, { merge: true });
      }

      logger.info({ uid: user.uid, provider }, 'Integration connected successfully');

      return reply.status(200).send({ success: true });

    } catch (error: any) {
      logger.error({ uid: (request as any).user?.uid, provider: (request.body as any)?.apiName }, 'Integration connect error', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  // Validate API integration
  fastify.post('/validate', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const body = integrationUpdateSchema.parse(request.body);

    try {
      if (body.apiName === 'binance') {
        // binance: require apiKey + secretKey
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

      } else if (body.apiName === 'cryptocompare') {
        // cryptocompare: require apiKey, test simple market call
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

      } else if (body.apiName === 'newsdata') {
        // newsdata: require apiKey, test simple fetch
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
        // coinmarketcap: apiKey optional but validate if provided
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

}

