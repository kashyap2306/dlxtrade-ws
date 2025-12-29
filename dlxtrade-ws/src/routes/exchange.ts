import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { firestoreAdapter, isExchangeUsable } from '../services/firestoreAdapter';
import { ExchangeConnectorFactory, type ExchangeName, type ExchangeCredentials } from '../services/exchangeConnector';
import { encrypt, decrypt } from '../services/keyManager';
import { logger } from '../utils/logger';
import * as admin from 'firebase-admin';

/**
 * Sanitize Firestore payload by removing undefined values and converting them to FieldValue.delete()
 */
function sanitizeFirestorePayload(payload: any): any {
  const sanitized: any = {};
  let sanitizedCount = 0;

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      sanitized[key] = admin.firestore.FieldValue.delete();
      console.log('🔥 [HARD_LOG] [PROVIDER_FIELD_SANITIZED]', {
        field: key,
        action: 'CONVERTED_UNDEFINED_TO_DELETE'
      });
      sanitizedCount++;
    } else {
      sanitized[key] = value;
    }
  }

  if (sanitizedCount > 0) {
    console.log('🔥 [HARD_LOG] [PAYLOAD_SANITIZED]', {
      sanitizedFields: sanitizedCount,
      totalFields: Object.keys(payload).length
    });
  }

  return sanitized;
}

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

        // Check if user has explicitly disconnected
        if (config.disconnected === true) {
          return reply.code(400).send({
            message: { error: 'Exchange has been disconnected. Please reconnect to continue.' },
            success: false,
          });
        }

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

      // CRITICAL: Clear stale exchangeStatus when decryption + connection test passes
      // This ensures diagnostic treats successful decrypt as source of truth
      if (isSuccess && config) {
        try {
          await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').update({
            exchangeStatus: admin.firestore.FieldValue.delete()
          }).catch(err => {
            logger.debug({ uid: user.uid, error: err.message }, 'Failed to clear exchangeStatus after successful test (non-critical)');
          });
        } catch (clearErr: any) {
          logger.debug({ uid: user.uid, error: clearErr.message }, 'Error clearing exchangeStatus after successful test (non-critical)');
        }
      }

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
        const userDoc = await firestoreAdapter.getUser(user.uid);

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

        // PRIMARY: Use users document as source of truth for connected status
        const isConnected = userDoc?.apiConnected === true &&
                           userDoc?.connectedExchanges?.includes(query.exchange);

        // Check if decrypt would fail (informational only for exchangeStatus)
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
          connected: isConnected, // Use users document as truth
          exchangeStatus: decryptFailed ? 'CONFIGURED_BUT_DECRYPT_FAILED' : 'CONFIGURED'
        };
      } else {
        // Get status for all exchanges
        const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
        const exchangeConfig = await firestoreAdapter.getExchangeConfig(user.uid);
        const userDoc = await firestoreAdapter.getUser(user.uid);

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

          // PRIMARY: Use users document as source of truth for connected status
          const isConnected = userDoc?.apiConnected === true &&
                             userDoc?.connectedExchanges?.includes(exchange);

          // Check if decrypt would fail (informational only for exchangeStatus)
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
            connected: isConnected, // Use users document as truth
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

      // PRIMARY: Check users document as source of truth
      const userDoc = await firestoreAdapter.getUser(user.uid);
      if (userDoc?.apiConnected === true && userDoc?.connectedExchanges?.length > 0) {
        // Get the configured exchange from users document
        const configuredExchange = userDoc.connectedExchanges[0]; // Take first connected exchange
        connectedExchanges.push({
          exchange: configuredExchange,
          connected: true,
          testnet: true // Default to testnet for status display
        });
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
    // CRITICAL: Verify encryption key consistency for API requests
    const { verifyEncryptionKeyConsistency } = await import('../services/keyManager');
    verifyEncryptionKeyConsistency(`exchange-connect-api-${(request as any).user?.uid || 'unknown'}`);

    const user = (request as any).user;

    // CRITICAL: Log UID consistency for exchange connect
    logger.info({
      uid: user.uid,
      uidSource: 'auth_middleware_request_user_uid',
      uidLength: user.uid.length,
      action: 'exchange_connect_attempt'
    }, 'EXCHANGE_CONNECT_UID_CONSISTENCY_CHECK');

    try {
      const body = request.body as any;
      const { apiKey, secret, exchange, passphrase, type } = body || {};

      // LOG: Raw values before any processing
      console.log(`[EXCHANGE_CONNECT_RAW] UID:${user.uid} - Raw request values:`, {
        exchange,
        apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'UNDEFINED',
        secret: secret ? `${secret.substring(0, 8)}...` : 'UNDEFINED',
        passphrase: passphrase ? `${passphrase.substring(0, 8)}...` : 'UNDEFINED',
        apiKeyLength: apiKey?.length || 0,
        secretLength: secret?.length || 0,
        passphraseLength: passphrase?.length || 0
      });

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

      // VALIDATE: Check for missing/empty API keys BEFORE encryption
      if (!resolvedExchange) {
        console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: Missing exchange`);
        // 🔥 HARD_LOG: VALIDATION_FAILED_RETURN_PATH
        console.log('🔥 [HARD_LOG] [VALIDATION_FAILED_RETURN_PATH]', {
          uid: user.uid,
          error: 'Exchange is required for exchange configuration',
          validationField: 'exchange',
          operation: 'exchange_connect'
        });
        return reply.code(400).send({ error: 'Exchange is required for exchange configuration' });
      }

      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: apiKey missing/empty`);
        // 🔥 HARD_LOG: VALIDATION_FAILED_RETURN_PATH
        console.log('🔥 [HARD_LOG] [VALIDATION_FAILED_RETURN_PATH]', {
          uid: user.uid,
          error: 'Exchange API key is missing from request',
          validationField: 'apiKey',
          operation: 'exchange_connect'
        });
        return reply.code(400).send({ error: 'Exchange API key is missing from request' });
      }

      if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
        console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: secret missing/empty`);
        // 🔥 HARD_LOG: VALIDATION_FAILED_RETURN_PATH
        console.log('🔥 [HARD_LOG] [VALIDATION_FAILED_RETURN_PATH]', {
          uid: user.uid,
          error: 'Exchange API secret is missing from request',
          validationField: 'secret',
          operation: 'exchange_connect'
        });
        return reply.code(400).send({ error: 'Exchange API secret is missing from request' });
      }

      // ASSERT: Raw keys are valid before encryption
      console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - SUCCESS: All validations passed, proceeding to encrypt`);

      // CRITICAL: Assert write to canonical path only
      const { assertExchangeConfigWritePath } = await import('../services/firestoreAdapter');
      assertExchangeConfigWritePath(user.uid, `users/${user.uid}/exchangeConfig/current`);

      // 🔥 HARD_LOG: BEFORE_ENCRYPTION
      console.log('🔥 [HARD_LOG] [BEFORE_ENCRYPTION]', {
        uid: user.uid,
        exchange: resolvedExchange,
        apiKeyLength: apiKey.length,
        secretLength: secret.length,
        passphraseLength: passphrase?.length || 0
      });

      // ATOMIC WRITE: Always include all required fields, never partial
      // CRITICAL: Clear any INVALID_KEYS status since keys are successfully encrypted
      let exchangeConfig: any;

      try {
        exchangeConfig = {
          exchange: resolvedExchange,
          apiKeyEncrypted: encrypt(apiKey),
          secretEncrypted: encrypt(secret),
          testnet: false,
          exchangeStatus: admin.firestore.FieldValue.delete(), // Clear INVALID_KEYS status
          disconnected: false, // Clear disconnected flag when reconnecting
          updatedAt: admin.firestore.Timestamp.now(),
        };

        if (passphrase) {
          exchangeConfig.passphraseEncrypted = encrypt(passphrase);
        }

        if (!existingDoc.exists) {
          exchangeConfig.createdAt = admin.firestore.Timestamp.now();
        }

        // 🔥 HARD_LOG: AFTER_ENCRYPTION
        console.log('🔥 [HARD_LOG] [AFTER_ENCRYPTION]', {
          uid: user.uid,
          exchange: resolvedExchange,
          apiKeyEncryptedLength: exchangeConfig.apiKeyEncrypted.length,
          secretEncryptedLength: exchangeConfig.secretEncrypted.length,
          passphraseEncryptedLength: exchangeConfig.passphraseEncrypted?.length || 0,
          encryptionSuccess: true
        });

      } catch (encryptError: any) {
        // 🔥 HARD_LOG: ENCRYPTION_FAILED
        console.log('🔥 [HARD_LOG] [ENCRYPTION_FAILED]', {
          uid: user.uid,
          exchange: resolvedExchange,
          error: encryptError.message,
          errorType: 'ENCRYPTION_ERROR'
        });
        throw encryptError; // Re-throw to prevent Firestore write
      }

      // 🔥 HARD_LOG: IMMEDIATELY_BEFORE_FIRESTORE_WRITE
      console.log('🔥 [HARD_LOG] [IMMEDIATELY_BEFORE_FIRESTORE_WRITE]', {
        uid: user.uid,
        exchange: resolvedExchange,
        firestorePath: `users/${user.uid}/exchangeConfig/current`,
        mergeMode: 'merge_true',
        dataKeys: Object.keys(exchangeConfig)
      });

      // CRITICAL: Firestore write MUST ALWAYS execute if encryption succeeds
      // No early returns allowed between encryption and Firestore write
      // CRITICAL: Always OVERWRITE entire document with fresh config - do NOT merge
      const sanitizedExchangeConfig = sanitizeFirestorePayload(exchangeConfig);
      await docRef.set(sanitizedExchangeConfig); // No merge = full overwrite

      // 🔥 HARD_LOG: IMMEDIATELY_AFTER_FIRESTORE_WRITE
      console.log('🔥 [HARD_LOG] [IMMEDIATELY_AFTER_FIRESTORE_WRITE]', {
        uid: user.uid,
        exchange: resolvedExchange,
        firestorePath: `users/${user.uid}/exchangeConfig/current`,
        writeSuccess: true
      });

      // CRITICAL: IMMEDIATELY read back the same document and log verification
      try {
        const readBackDoc = await docRef.get();
        const readBackData = readBackDoc.data();

        // 🔥 HARD_LOG: READ_BACK_VERIFICATION
        console.log('🔥 [HARD_LOG] [READ_BACK_VERIFICATION]', {
          uid: user.uid,
          exchange: resolvedExchange,
          documentExists: readBackDoc.exists,
          hasApiKeyEncrypted: !!readBackData?.apiKeyEncrypted,
          hasSecretEncrypted: !!readBackData?.secretEncrypted,
          hasPassphraseEncrypted: !!readBackData?.passphraseEncrypted,
          exchangeInDoc: readBackData?.exchange,
          fieldsPresent: Object.keys(readBackData || {}),
          readBackSuccess: true
        });

        if (!readBackDoc.exists) {
          // 🔥 HARD_LOG: READ_BACK_FAILED_DOCUMENT_MISSING
          console.log('🔥 [HARD_LOG] [READ_BACK_FAILED_DOCUMENT_MISSING]', {
            uid: user.uid,
            exchange: resolvedExchange,
            firestorePath: `users/${user.uid}/exchangeConfig/current`
          });
          throw new Error('CRITICAL: Document not found after write - Firestore write failed');
        }

        if (!readBackData?.apiKeyEncrypted || !readBackData?.secretEncrypted) {
          // 🔥 HARD_LOG: READ_BACK_FAILED_KEYS_MISSING
          console.log('🔥 [HARD_LOG] [READ_BACK_FAILED_KEYS_MISSING]', {
            uid: user.uid,
            exchange: resolvedExchange,
            hasApiKey: !!readBackData?.apiKeyEncrypted,
            hasSecret: !!readBackData?.secretEncrypted
          });
          throw new Error('CRITICAL: Encrypted keys missing after write - Firestore write corrupted');
        }

      } catch (readBackError: any) {
        // 🔥 HARD_LOG: READ_BACK_EXCEPTION
        console.log('🔥 [HARD_LOG] [READ_BACK_EXCEPTION]', {
          uid: user.uid,
          exchange: resolvedExchange,
          error: readBackError.message,
          readBackFailed: true
        });
        throw readBackError; // Re-throw to fail the entire operation
      }

      // LOG: Confirm encrypted keys saved to Firestore
      console.log(`[EXCHANGE_CONNECT_SAVED] UID:${user.uid} - Firestore save verification:`, {
        exchange: exchangeConfig.exchange,
        hasApiKeyEncrypted: !!exchangeConfig.apiKeyEncrypted,
        apiKeyEncryptedLength: exchangeConfig.apiKeyEncrypted?.length || 0,
        hasSecretEncrypted: !!exchangeConfig.secretEncrypted,
        secretEncryptedLength: exchangeConfig.secretEncrypted?.length || 0,
        hasPassphraseEncrypted: !!exchangeConfig.passphraseEncrypted,
        passphraseEncryptedLength: exchangeConfig.passphraseEncrypted?.length || 0,
        exchangeStatusCleared: exchangeConfig.exchangeStatus === admin.firestore.FieldValue.delete()
      });

      logger.info({
        uid: user.uid,
        exchange
      }, 'Exchange connected successfully');

      // CRITICAL: Update users/{uid} document with exchange connection status
      // This ensures UI and engine read correct state instead of stale flags
      // MUST succeed for operation to be considered successful
      await db.collection('users').doc(user.uid).set({
        apiConnected: true,
        isApiConnected: true,
        apiStatus: 'connected',
        connectedExchanges: [resolvedExchange],
        exchangeLastConnected: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });

      console.log('🔥 [HARD_LOG] [EXCHANGE_CONNECT_USERS_DOC_SYNCED]', {
        uid: user.uid,
        exchange: resolvedExchange,
        fieldsUpdated: ['apiConnected', 'isApiConnected', 'apiStatus', 'connectedExchanges']
      });

      // 🔥 HARD_LOG: SUCCESS_RETURN_PATH
      console.log('🔥 [HARD_LOG] [SUCCESS_RETURN_PATH]', {
        uid: user.uid,
        exchange: resolvedExchange,
        operation: 'exchange_connect',
        result: 'success',
        connected: true
      });

      return {
        success: true,
        connected: true,
        exchange
      };
    } catch (err: any) {
      if (err.message && err.message.includes('EXCHANGE_KEY_DECRYPTION_FAILED')) {
        logger.error({ error: err.message, uid: user.uid }, 'Exchange credential decryption failed');
        // 🔥 HARD_LOG: DECRYPTION_FAILED_RETURN_PATH
        console.log('🔥 [HARD_LOG] [DECRYPTION_FAILED_RETURN_PATH]', {
          uid: user.uid,
          error: err.message,
          operation: 'exchange_connect',
          result: 'decryption_failed'
        });
        return reply.code(400).send({ error: err.message || 'Failed to decrypt credentials', connected: false });
      }
      logger.error({ error: err.message, uid: user.uid }, 'Exchange connect failed: users document sync not completed');
      // CRITICAL: Cannot return success without users/{uid} sync completion
      // 🔥 HARD_LOG: TRANSIENT_ERROR_RETURN_PATH
      console.log('🔥 [HARD_LOG] [TRANSIENT_ERROR_RETURN_PATH]', {
        uid: user.uid,
        error: err.message,
        operation: 'exchange_connect',
        result: 'transient_error_users_sync_failed'
      });
      return reply.code(500).send({ error: 'Exchange connection failed: ' + err.message, connected: false });
    }
  });


  // GET /exchange/balance - Get Live Futures Balance
  fastify.get('/exchange/balance', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;

    // CRITICAL: Log UID consistency for exchange balance
    logger.info({
      uid: user.uid,
      uidSource: 'auth_middleware_request_user_uid',
      uidLength: user.uid.length,
      action: 'exchange_balance_attempt'
    }, 'EXCHANGE_BALANCE_UID_CONSISTENCY_CHECK');

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

      // 2. Check Exchange Usability - Use unified logic
      const exchangeUsability = await isExchangeUsable(user.uid, 'user_request');
      if (!exchangeUsability.usable) {
        logger.info({
          uid: user.uid,
          exchange: exchangeName,
          reason: exchangeUsability.reason
        }, 'Exchange balance: exchange not usable, skipping balance fetch');
        return reply.code(200).send({
          success: false,
          reason: 'EXCHANGE_NOT_USABLE',
          exchange: exchangeName,
          message: { error: exchangeUsability.reason }
        });
      }

      // 3. Decrypt & Validate Credentials - Now safe since usability check passed
      const { decrypt } = await import('../services/keyManager');
      const decryptedApiKey = decrypt(config.apiKeyEncrypted);
      const decryptedSecret = decrypt(config.secretKeyEncrypted || config.secretEncrypted);
      const decryptedPassphrase = config.passphraseEncrypted ? decrypt(config.passphraseEncrypted) : undefined;

      const credentials: ExchangeCredentials = {
        apiKey: decryptedApiKey!,
        secret: decryptedSecret!,
        passphrase: decryptedPassphrase,
        testnet: config.testnet ?? true,
      };

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
      const { exchange, permanentDelete = false } = body;

      logger.info({
        uid: user.uid,
        exchange,
        permanentDelete
      }, 'Exchange disconnect request');

      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = admin.firestore(getFirebaseAdmin());

      if (permanentDelete) {
        // Only delete credentials if explicitly requested
        await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').delete();

        // 🔥 HARD_LOG: EXCHANGE_DISCONNECT
        console.log('🔥 [HARD_LOG] [EXCHANGE_DISCONNECT]', {
          uid: user.uid,
          exchange,
          permanentDelete: true,
          credentialsDeleted: true
        });

        logger.info({
          uid: user.uid,
          exchange
        }, 'Exchange credentials permanently deleted');
      }

      if (!permanentDelete) {
        // Default behavior: Clear all exchange credentials to prevent usage
        // CRITICAL: Disconnect ALWAYS succeeds, even if exchangeConfig/current doesn't exist
        const docRef = db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current');
        const existingDoc = await docRef.get();

        const disconnectPayload = {
          exchange: null,
          apiKeyEncrypted: admin.firestore.FieldValue.delete(),
          secretEncrypted: admin.firestore.FieldValue.delete(),
          passphraseEncrypted: admin.firestore.FieldValue.delete(),
          disconnected: true,
          disconnectedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const sanitizedDisconnectPayload = sanitizeFirestorePayload(disconnectPayload);
        await docRef.set(sanitizedDisconnectPayload, { merge: true });

        // 🔥 HARD_LOG: EXCHANGE_DISCONNECT
        console.log('🔥 [HARD_LOG] [EXCHANGE_DISCONNECT]', {
          uid: user.uid,
          exchange,
          permanentDelete: false,
          credentialsCleared: true,
          documentExisted: existingDoc.exists,
          disconnectAlwaysSucceeds: true
        });

        logger.info({
          uid: user.uid,
          exchange,
          documentExisted: existingDoc.exists
        }, 'Exchange disconnected - always succeeds, credentials cleared or document created in disconnected state');
      }

      // CRITICAL: Update users/{uid} document to reflect disconnected state
      // This ensures UI and engine read correct state instead of stale flags
      try {
        await db.collection('users').doc(user.uid).set({
          apiConnected: false,
          isApiConnected: false,
          apiStatus: 'disconnected',
          connectedExchanges: [],
          exchangeLastDisconnected: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log('🔥 [HARD_LOG] [EXCHANGE_DISCONNECT_USERS_DOC_SYNCED]', {
          uid: user.uid,
          fieldsUpdated: ['apiConnected', 'isApiConnected', 'apiStatus', 'connectedExchanges']
        });
      } catch (syncError: any) {
        console.error('🔥 [HARD_LOG] [EXCHANGE_DISCONNECT_USERS_DOC_SYNC_FAILED]', {
          uid: user.uid,
          error: syncError.message
        });
        // Don't fail the entire operation if sync fails
      }

      // CRITICAL: Force disable auto-trade when exchange is disconnected/disconnected (both cases)
      const autoTradeRef = db.collection('users').doc(user.uid).collection('autoTradeConfig').doc('current');
      await autoTradeRef.set({
        autoTradeEnabled: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // 🔥 HARD_LOG: AUTO_TRADE_FORCE_DISABLED
      console.log('🔥 [HARD_LOG] [AUTO_TRADE_FORCE_DISABLED]', {
        uid: user.uid,
        reason: permanentDelete ? 'exchange_permanently_deleted' : 'exchange_disconnected',
        autoTradeEnabled: false
      });

      // CRITICAL: Force stop background research scheduler for this UID
      const { backgroundResearchScheduler } = await import('../services/backgroundResearchScheduler');
      await backgroundResearchScheduler.forceStopUserScheduler(user.uid);

      // 🔥 HARD_LOG: SCHEDULER_FORCE_STOPPED
      console.log('🔥 [HARD_LOG] [SCHEDULER_FORCE_STOPPED]', {
        uid: user.uid,
        reason: permanentDelete ? 'exchange_permanently_deleted' : 'exchange_disconnected',
        intervalsCleared: true,
        jobStateCleared: true
      });

      return {
        success: true,
        connected: false,
        credentialsPreserved: !permanentDelete
      };
    } catch (err: any) {
      logger.error({ error: err.message, uid: user.uid }, 'Exchange disconnect failed');
      return reply.code(500).send({ error: err.message || 'Failed to disconnect from exchange' });
    }
  });
}

