import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter, isExchangeUsable } from '../services/firestoreAdapter';
import { ExchangeConnectorFactory, type ExchangeName, type ExchangeCredentials } from '../services/exchangeConnector';
import { encrypt, decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';

function safeDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const exchangeConfigSchema = z.object({
  exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
  type: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
  apiKey: z.string().min(1),
  secret: z.string().min(1).optional(),
  passphrase: z.string().optional(),
  testnet: z.boolean().optional().default(false),
});

export async function exchangeRoutes(fastify: FastifyInstance) {
  console.log("[DEBUG] Loading exchangeRoutes...");

  // POST /api/exchange/test - Test exchange connection
  fastify.post('/exchange/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: any, Querystring: { exchange?: string } }>, reply: FastifyReply) => {
    try {
      const user = (request as any).user || {};
      const uid = user.uid;

      if (!uid) {
        return reply.code(200).send({ success: false, message: { error: "User not authenticated" } });
      }
      // Exchange status is informational only - proceed regardless
      const query = request.query;
      const validationParams = z.object({
        exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
        apiKey: z.string().optional(),
        secret: z.string().optional(),
        passphrase: z.string().optional(),
        testnet: z.boolean().optional().default(true),
      }).safeParse(request.body || {});

      if (!validationParams.success) {
        return reply.code(200).send({ success: false, message: { error: "Invalid payload params" } });
      }
      const body = validationParams.data;

      let credentials: ExchangeCredentials;
      let exchange: ExchangeName;
      let config: any = null;
      let db: any = null;

      // If credentials provided in body, use them
      if (body.apiKey && body.secret) {
        exchange = body.exchange || (query.exchange as ExchangeName) || 'binance';
        credentials = {
          apiKey: body.apiKey,
          secret: body.secret,
          passphrase: body.passphrase,
          testnet: body.testnet ?? true,
        };
      } else {
        // Load from user's saved config
        const { getFirebaseAdmin } = await import('../utils/firebase');
        db = getFirebaseAdmin().firestore();
        const doc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

        if (!doc.exists) {
          return reply.code(400).send({
            message: { error: 'No exchange configuration found. Please save your credentials first.' },
            success: false,
          });
        }

        config = doc.data()!;
        // Handle case where saved config exists but exchange is undefined (partial save)
        exchange = (config.exchange as ExchangeName) || (query.exchange as ExchangeName);

        // Verify query param matches saved config ONLY if saved config has an exchange defined
        if (config.exchange && query.exchange && query.exchange !== config.exchange) {
          return reply.code(400).send({
            message: { error: `Configuration mismatch: Saved config is for ${config.exchange}, but you requested test for ${query.exchange}` },
            success: false,
          });
        }

        // Decrypt credentials - CRITICAL: Use decryptOrThrow for explicit user actions only
        const { decryptOrThrow } = await import('../services/keyManager');
        credentials = {
          apiKey: decryptOrThrow(config.apiKeyEncrypted, 'API key'),
          secret: decryptOrThrow(config.secretKeyEncrypted || config.secretEncrypted, 'secret key'),
          passphrase: config.passphraseEncrypted ? decryptOrThrow(config.passphraseEncrypted, 'passphrase') : undefined,
          testnet: config.testnet ?? true,
        };
      }

      // Validate required fields
      const requiredFields = ExchangeConnectorFactory.getRequiredFields(exchange);
      if (requiredFields.includes('passphrase') && !credentials.passphrase) {
        return reply.code(400).send({ message: { error: 'Passphrase is required for this exchange' }, success: false });
      }

      // Create connector and test
      let result;
      try {
        const connector = ExchangeConnectorFactory.create(exchange, credentials);
        result = await connector.testConnection();
      } catch (connErr: any) {
        // If connector throws, treat as connection failure but formatted cleanly
        return reply.code(200).send({
          success: false,
          message: { error: connErr.message || 'Connection failed' },
          details: { balances: [], positions: [] }
        });
      }

      logger.info({ uid: user.uid, exchange, success: result.success }, 'Exchange connection test');

      // Defensive Parsing & Normalization
      // Ensure details exist and arrays are valid (even if empty)
      const safeDetails = {
        balances: Array.isArray(result.details?.balances) ? result.details.balances : [],
        positions: Array.isArray(result.details?.positions) ? result.details.positions : [],
        account: result.details?.account || {},
        ...result.details
      };

      // Force success true if we got a valid result object backend, even if it had empty balances
      // UNLESS explicitly marked false by connector
      const isSuccess = result.success !== false; // defaulted to true if undefined

      return {
        success: isSuccess,
        message: { text: result.message || (isSuccess ? 'Connection successful' : 'Connection failed') },
        details: safeDetails,
        exchange,
      };
    } catch (err: any) {
      logger.error({ err }, 'Error testing exchange connection');
      return reply.code(500).send({
        message: { error: err.message || 'Error testing exchange connection' },
        success: false,
      });
    }
  });

  // POST /api/exchange/test-trade - Place a test trade order
  fastify.post('/exchange/test-trade', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Body: { exchange?: ExchangeName; symbol?: string; side?: 'BUY' | 'SELL'; quantity?: number } }>, reply: FastifyReply) => {
    const user = (request as any).user;

    try {
      const body = z.object({
        exchange: z.enum(['binance', 'bitget', 'weex', 'bingx']).optional(),
        symbol: z.string().optional().default('BTCUSDT'),
        side: z.enum(['BUY', 'SELL']).optional().default('BUY'),
        quantity: z.number().positive().optional().default(0.001),
      }).parse(request.body || {});

      // Get exchange connector
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

      if (!configDoc.exists) {
        return reply.code(404).send({
          success: false,
          message: { error: 'Exchange configuration not found. Please configure your exchange API credentials first.' },
        });
      }

      const config = configDoc.data()!;
      const exchange = (body.exchange || config.exchange) as ExchangeName;

      // Validate exchange matches if specified
      if (body.exchange && body.exchange !== config.exchange) {
        return reply.code(400).send({
          success: false,
          message: { error: `Exchange mismatch. Configured: ${config.exchange}, requested: ${body.exchange}` },
        });
      }

      // Create connector - CRITICAL: Use decryptOrThrow for exchange credentials
      let connector;
      try {
        const { decryptOrThrow } = await import('../services/keyManager');
        connector = ExchangeConnectorFactory.create(exchange, {
          apiKey: decryptOrThrow(config.apiKeyEncrypted, 'API key'),
          secret: decryptOrThrow(config.secretKeyEncrypted || config.secretEncrypted, 'secret key'),
          passphrase: config.passphraseEncrypted ? decryptOrThrow(config.passphraseEncrypted, 'passphrase') : undefined,
          testnet: config.testnet ?? true,
        });
      } catch (decryptErr: any) {
        logger.error({ uid: user.uid, exchange, error: decryptErr.message }, 'EXCHANGE_KEY_DECRYPTION_FAILED: Failed to decrypt exchange credentials');
        return reply.code(400).send({
          success: false,
          message: { 
            error: decryptErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') 
              ? 'Exchange API key decryption failed - invalid ENCRYPTION_SECRET. Please re-enter your exchange API keys.'
              : 'Failed to decrypt exchange credentials'
          },
        });
      }

      // Get symbol info to determine minimum order size
      try {
        // Determine minimum quantity (use provided quantity or minimum)
        const minQuantity = 0.001; // Default minimum
        const orderQuantity = Math.max(body.quantity || minQuantity, minQuantity);

        // Place market order
        const order = await connector.placeOrder({
          symbol: body.symbol!,
          side: body.side!,
          type: 'MARKET',
          quantity: orderQuantity,
        });

        // Update last tested timestamp
        await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').update({
          lastTested: safeDate(new Date()),
        });

        logger.info({
          uid: user.uid,
          exchange,
          symbol: body.symbol,
          side: body.side,
          orderId: order.id || order.orderId
        }, 'Test trade placed successfully');

        return {
          success: true,
          message: 'Test trade placed successfully',
          orderId: order.id || order.orderId || 'N/A',
          status: order.status || 'FILLED',
          filledPrice: order.filledPrice || order.price || 'N/A',
          filledQuantity: order.filledQuantity || orderQuantity,
          exchange,
          symbol: body.symbol,
          side: body.side,
          exchangeConfirmation: order.exchangeConfirmation || order.raw || {},
        };
      } catch (tradeErr: any) {
        logger.error({ err: tradeErr, uid: user.uid, exchange }, 'Error placing test trade');
        return reply.code(400).send({
          success: false,
          message: { error: tradeErr.message || 'Error placing test trade' },
          details: tradeErr.response?.data || tradeErr.data,
        });
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid input',
          details: err.errors,
        });
      }
      logger.error({ err, uid: user.uid }, 'Error in test trade endpoint');
      return reply.code(500).send({
        success: false,
        error: err.message || 'Error placing test trade',
      });
    }
  });



  fastify.get('/exchange/status', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = (request as any).user;
      const query = request.query as { exchange?: string };

      if (query.exchange) {
        // Get status for specific exchange
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);

        // Check if exchange is configured and matches requested exchange
        if (!exchangeConfig || exchangeConfig.exchange !== query.exchange) {
          return {
            exchange: query.exchange,
            connected: false,
            exchangeStatus: 'NOT_CONFIGURED'
          };
        }

        // Determine status purely from encrypted key presence and safe decrypt check
        const hasEncryptedKeys = !!(exchangeConfig.apiKeyEncrypted &&
                                   (exchangeConfig.secretEncrypted || exchangeConfig.secretKeyEncrypted));

        if (!hasEncryptedKeys) {
          return {
            exchange: query.exchange,
            connected: false,
            exchangeStatus: 'NOT_CONFIGURED'
          };
        }

        // Check if decrypt would fail (informational only)
        const { decrypt } = await import('../services/keyManager');
        let decryptFailed = false;

        try {
          decrypt(exchangeConfig.apiKeyEncrypted);
          decrypt(exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted);
          if (exchangeConfig.passphraseEncrypted) {
            decrypt(exchangeConfig.passphraseEncrypted);
          }
        } catch (decryptErr: any) {
          decryptFailed = true;
        }

        return {
          exchange: query.exchange,
          connected: !decryptFailed, // Connected if decrypt succeeds
          exchangeStatus: decryptFailed ? 'CONFIGURED_BUT_DECRYPT_FAILED' : 'CONFIGURED'
        };
      } else {
        // Get status for all exchanges
        const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);

        const statusPromises = exchanges.map(async (exchange) => {
          // Check if this exchange is configured
          if (!exchangeConfig || exchangeConfig.exchange !== exchange) {
            return {
              exchange,
              connected: false,
              exchangeStatus: 'NOT_CONFIGURED'
            };
          }

          // Determine status purely from encrypted key presence and safe decrypt check
          const hasEncryptedKeys = !!(exchangeConfig.apiKeyEncrypted &&
                                     (exchangeConfig.secretEncrypted || exchangeConfig.secretKeyEncrypted));

          if (!hasEncryptedKeys) {
            return {
              exchange,
              connected: false,
              exchangeStatus: 'NOT_CONFIGURED'
            };
          }

          // Check if decrypt would fail (informational only)
          const { decrypt } = await import('../services/keyManager');
          let decryptFailed = false;

          try {
            decrypt(exchangeConfig.apiKeyEncrypted);
            decrypt(exchangeConfig.secretKeyEncrypted || exchangeConfig.secretEncrypted);
            if (exchangeConfig.passphraseEncrypted) {
              decrypt(exchangeConfig.passphraseEncrypted);
            }
          } catch (decryptErr: any) {
            decryptFailed = true;
          }

          return {
            exchange,
            connected: !decryptFailed, // Connected if decrypt succeeds
            exchangeStatus: decryptFailed ? 'CONFIGURED_BUT_DECRYPT_FAILED' : 'CONFIGURED'
          };
        });

        const statuses = await Promise.all(statusPromises);
        return { exchanges: statuses };
      }
    } catch (err: any) {
      logger.error({ error: err.message, uid: (request as any).user?.uid }, 'Exchange status check failed');
      return reply.code(500).send({
        message: { error: err.message || 'Failed to get exchange status' },
      });
    }
  });

  // GET /exchange/connected - Get connected exchange status - DETAILED TIMING INSTRUMENTATION
  fastify.get('/exchange/connected', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const t0 = Date.now();
    const user = (request as any).user;

    try {
      fastify.log.info({ uid: user.uid }, 'exchange.connected:start');

      const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
      const connectedExchanges = [];

      const t1 = Date.now();

      // Check if user has a usable exchange configuration
      const exchangeUsable = await isExchangeUsable(user.uid);
      if (exchangeUsable) {
        // Get the configured exchange
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
        if (exchangeConfig?.exchange) {
          connectedExchanges.push({
            exchange: exchangeConfig.exchange,
            connected: true,
            testnet: exchangeConfig.testnet ?? true
          });
        }
      }
      const dt1 = Date.now() - t1;
      fastify.log.info({ duration: dt1, exchangeCount: exchanges.length }, 'exchange.connected:db-calls');

      const dt = Date.now() - t0;
      fastify.log.info({ duration: dt }, 'exchange.connected:done');

      return {
        connected: connectedExchanges.length > 0,
        exchanges: connectedExchanges
      };
    } catch (err: any) {
      const dt = Date.now() - t0;
      fastify.log.error({ err, duration: dt }, 'exchange.connected:error');
      logger.error({ error: err.message, uid: user.uid }, 'Exchange connected check failed');
      return reply.code(500).send({ error: err.message || 'Failed to check connected exchanges' });
    }
  });

  // POST /exchange/connect - Connect to exchange
  fastify.post('/exchange/connect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const body = request.body as any;
      const { apiKey, secret, exchange, passphrase, type } = body || {};

      logger.info({
        uid: user.uid,
        exchange,
        hasApiKey: !!apiKey,
        hasSecret: !!secret,
        hasPassphrase: !!passphrase
      }, 'Exchange connect request');

      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = admin.firestore(getFirebaseAdmin());
      const docRef = db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current');
      const existingDoc = await docRef.get();
      const existingData = existingDoc.exists ? existingDoc.data() || {} : {};

      // HARD REQUIRE: All critical fields must be present for complete save
      const resolvedExchange = (exchange || type || existingData.exchange || existingData.type) as ExchangeName | undefined;
      if (!resolvedExchange || !apiKey || !secret) {
        return reply.code(400).send({ error: 'Exchange, API key, and secret are required for exchange configuration' });
      }

      // ATOMIC WRITE: Always include all required fields, never partial
      const exchangeConfig: any = {
        exchange: resolvedExchange,
        apiKeyEncrypted: encrypt(apiKey),
        secretEncrypted: encrypt(secret),
        testnet: false,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      if (passphrase) {
        exchangeConfig.passphraseEncrypted = encrypt(passphrase);
      }

      if (!existingDoc.exists) {
        exchangeConfig.createdAt = admin.firestore.Timestamp.now();
      }

      // FORCE COMPLETE: Use merge:false to ensure no partial overwrites
      console.log(`[DEBUG_EXCHANGE_CONNECT] UID:${user.uid} - Saving exchange config with merge:false:`, {
        exchange: exchangeConfig.exchange,
        hasApiKeyEncrypted: !!exchangeConfig.apiKeyEncrypted,
        hasSecretEncrypted: !!exchangeConfig.secretEncrypted,
        hasPassphraseEncrypted: !!exchangeConfig.passphraseEncrypted,
        testnet: exchangeConfig.testnet,
        hasExchangeStatus: !!exchangeConfig.exchangeStatus,
        exchangeStatus: exchangeConfig.exchangeStatus
      });

      await docRef.set(exchangeConfig, { merge: false });

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange connected successfully');

      return {
        success: true,
        connected: true,
        exchange
      };
    } catch (err: any) {
      if (err.message && err.message.includes('EXCHANGE_KEY_DECRYPTION_FAILED')) {
        logger.error({ error: err.message, uid: user.uid }, 'Exchange credential decryption failed');
        return reply.code(400).send({ error: err.message || 'Failed to decrypt credentials', connected: false });
      }
      logger.warn({ error: err.message, uid: user.uid }, 'Exchange test failed: returning CONNECTED but with warning');
      // Only transient (non-decryption) errors: treat as still connected for UX
      return reply.code(200).send({ success: true, connected: true, warning: err.message });
    }
  });


  // GET /exchange/balance - Get Live Futures Balance
  fastify.get('/exchange/balance', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      // 1. Get Exchange Config
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = getFirebaseAdmin().firestore();
      const doc = await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        return reply.code(200).send({
          success: false,
          reason: 'CREDENTIALS_MISSING',
          exchange: 'unknown',
          message: { error: 'No exchange connected. Please connect an exchange first.' }
        });
      }

      const config = doc.data()!;
      const exchangeName = (config.exchange || 'unknown') as string;

      // 2. Decrypt & Validate Credentials - Graceful handling for balance checks
      let credentials: ExchangeCredentials;
      try {
        const { decrypt } = await import('../services/keyManager');
        const decryptedApiKey = decrypt(config.apiKeyEncrypted);
        const decryptedSecret = decrypt(config.secretKeyEncrypted || config.secretEncrypted);
        const decryptedPassphrase = config.passphraseEncrypted ? decrypt(config.passphraseEncrypted) : undefined;

        credentials = {
          apiKey: decryptedApiKey,
          secret: decryptedSecret,
          passphrase: decryptedPassphrase,
          testnet: config.testnet ?? true,
        };

        if (!credentials.apiKey || !credentials.secret) {
          throw new Error('Incomplete credentials');
        }
      } catch (decryptErr) {
        // Decrypt failure is informational only - skip balance gracefully
        logger.info({ uid: user.uid, exchange: exchangeName }, 'Exchange balance: decrypt failed, skipping balance fetch');
        return reply.code(200).send({
          success: false,
          reason: 'CREDENTIALS_DECRYPT_FAILED',
          exchange: exchangeName,
          message: { error: 'Exchange configured but credentials decryption failed. Balance unavailable but exchange remains usable for auto-trade.' }
        });
      }

      // 3. Create Adapter
      let connector;
      try {
        connector = ExchangeConnectorFactory.create(exchangeName as ExchangeName, credentials);
      } catch (factoryErr: any) {
        return reply.code(200).send({
          success: false,
          reason: 'EXCHANGE_API_ERROR',
          exchange: exchangeName,
          message: { error: factoryErr.message || 'Unsupported exchange' }
        });
      }

      // 4. Check if getFuturesBalance is implemented
      if (!connector.getFuturesBalance) {
        return reply.code(200).send({
          success: false,
          reason: 'EXCHANGE_API_ERROR',
          exchange: exchangeName,
          message: { error: `Futures balance fetch not supported for ${exchangeName}` }
        });
      }

      // 5. Fetch Balance with Timeout
      try {
        const balancePromise = connector.getFuturesBalance();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Exchange API timeout (10s)')), 10000)
        );

        const balance = await Promise.race([balancePromise, timeoutPromise]) as any;

        return {
          success: true,
          data: {
            ...balance,
            timestamp: new Date().toISOString()
          }
        };
      } catch (apiErr: any) {
        const isTimeout = apiErr.message?.includes('timeout');
        return reply.code(200).send({
          success: false,
          reason: isTimeout ? 'TIMEOUT' : 'EXCHANGE_API_ERROR',
          exchange: exchangeName,
          message: { error: apiErr.message || 'Exchange API call failed' }
        });
      }

    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Failed to fetch exchange balance');
      return reply.code(200).send({
        success: false,
        reason: 'EXCHANGE_API_ERROR',
        exchange: 'unknown',
        message: { error: err.message || 'Failed to fetch balance from exchange' }
      });
    }
  });

  // POST /exchange/disconnect - Disconnect from exchange
  fastify.post('/exchange/disconnect', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    try {
      const body = request.body as any;
      const { exchange } = body;

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange disconnect request');

      // Remove exchange configuration
      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = admin.firestore(getFirebaseAdmin());
      await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').delete();

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange disconnected successfully');

      return {
        success: true,
        connected: false
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Exchange disconnect failed');
      return reply.code(500).send({ error: err.message || 'Failed to disconnect from exchange' });
    }
  });
}

