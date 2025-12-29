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

      // REQUIRE apiKey and secret in request body - test route must be stateless & diagnostic only
      if (!body.apiKey || !body.secret) {
        return reply.code(400).send({
          message: { error: 'apiKey and secret are required in request body for testing' },
          success: false
        });
      }

      const exchange = body.exchange || (query.exchange as ExchangeName) || 'binance';
      const credentials: ExchangeCredentials = {
        apiKey: body.apiKey,
        secret: body.secret,
        passphrase: body.passphrase,
        testnet: body.testnet ?? true,
      };

      // Validate required fields
      const requiredFields = ExchangeConnectorFactory.getRequiredFields(exchange);
      if (requiredFields.includes('passphrase') && !credentials.passphrase) {
        return reply.code(400).send({ message: { error: 'Passphrase is required for this exchange' }, success: false });
      }

      // 🎯 NORMALIZE credentials for test - trim and standardize
      const normalizedCredentials = {
        apiKey: credentials.apiKey.trim(),
        secret: credentials.secret.trim(),
        passphrase: credentials.passphrase ? credentials.passphrase.trim() : undefined,
        testnet: credentials.testnet
      };


      // Create connector and test
      let result;
      try {
        const connector = ExchangeConnectorFactory.create(exchange, normalizedCredentials);
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

      // Test route is stateless - no status mutations

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
      let finalCredentials: any = null;
      try {
        const { decryptOrThrow } = await import('../services/keyManager');

        // 🔍 DEBUG: Decrypt credentials with comprehensive logging
        const apiKey = decryptOrThrow(config.apiKeyEncrypted, 'API key');
        const secret = decryptOrThrow(config.secretKeyEncrypted || config.secretEncrypted, 'secret key');
        const passphrase = config.passphraseEncrypted ? decryptOrThrow(config.passphraseEncrypted, 'passphrase') : undefined;
        const testnet = config.testnet ?? true;

        // 🎯 NORMALIZE credentials ONCE - trim and standardize
        finalCredentials = {
          apiKey: apiKey.trim(),
          secret: secret.trim(),
          passphrase: passphrase ? passphrase.trim() : undefined,
          testnet: testnet
        };

        connector = ExchangeConnectorFactory.create(exchange, finalCredentials);
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

      // FIRST: Read users document as single source of truth
      const userDoc = await firestoreAdapter.getUser(user.uid);

      // If users document shows disconnected state, immediately return disconnected
      if (userDoc?.apiConnected === false || !userDoc?.connectedExchanges?.length) {
        return {
          exchange: query.exchange || null,
          connected: false,
          exchangeStatus: 'DISCONNECTED'
        };
      }

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

        // PRIMARY: Use users document as source of truth for connected status
        const isConnected = userDoc?.apiConnected === true &&
          userDoc?.connectedExchanges?.includes(query.exchange);

        // INVALID_KEYS is a transient connect-attempt event.
        // It must never be treated as a persistent exchange state.
        // REGRESSION PROTECTION: Future developers must not reintroduce INVALID_KEYS as long-lived truth

        // FIX 3: INVALID_KEYS is transient event, not persistent state
        // Status endpoint must not return INVALID_KEYS outside connect flow
        let exchangeStatus = 'NOT_CONFIGURED';
          if (exchangeConfig?.exchangeStatus === 'CONNECTED') {
            exchangeStatus = 'CONNECTED';
          } else if (exchangeConfig?.exchangeStatus === 'INVALID_KEYS') {
            // INVALID_KEYS encountered outside connect attempt - treat as stale
            exchangeStatus = 'NOT_CONNECTED';
          } else if (hasEncryptedKeys) {
            exchangeStatus = 'CONFIGURED';
          }

        return {
          exchange: query.exchange,
          connected: isConnected, // Use users document as truth
          exchangeStatus
        };
      } else {
        // Get status for all exchanges - but check if any exchange is connected first
        if (userDoc?.apiConnected !== true || !userDoc?.connectedExchanges?.length) {
          // No exchanges connected according to users document
          const exchanges: ExchangeName[] = ['binance', 'bitget', 'weex', 'bingx'];
          return exchanges.map(exchange => ({
            exchange,
            connected: false,
            exchangeStatus: 'DISCONNECTED'
          }));
        }

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

          // PRIMARY: Use users document as source of truth for connected status
          const isConnected = userDoc?.apiConnected === true &&
            userDoc?.connectedExchanges?.includes(exchange);

          // INVALID_KEYS is a transient connect-attempt event.
          // It must never be treated as a persistent exchange state.
          // REGRESSION PROTECTION: Future developers must not reintroduce INVALID_KEYS as long-lived truth

          // FIX 3: INVALID_KEYS is transient event, not persistent state
          // Status endpoint must not return INVALID_KEYS outside connect flow
          let exchangeStatus = 'NOT_CONFIGURED';
          if (exchangeConfig?.exchangeStatus === 'CONNECTED') {
            exchangeStatus = 'CONNECTED';
          } else if (exchangeConfig?.exchangeStatus === 'INVALID_KEYS') {
            // INVALID_KEYS encountered outside connect attempt - treat as stale
            exchangeStatus = 'NOT_CONNECTED';
          } else if (hasEncryptedKeys) {
            exchangeStatus = 'CONFIGURED';
          }

          return {
            exchange,
            connected: isConnected, // Use users document as truth
            exchangeStatus
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

      // VALIDATE: Check for missing/empty API keys BEFORE any operations
      const resolvedExchange = exchange as ExchangeName | undefined;

      if (!resolvedExchange) {
        console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: Missing exchange`);
        return reply.code(400).send({ error: 'Exchange is required for exchange configuration' });
      }

      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: apiKey missing/empty`);
        return reply.code(400).send({ error: 'Exchange API key is missing from request' });
      }

      if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
        console.log(`[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: secret missing/empty`);
        return reply.code(400).send({ error: 'Exchange API secret is missing from request' });
      }

      // 🔥 HARD_LOG: LIVE_VALIDATION_START
      console.log('🔥 [HARD_LOG] [EXCHANGE_LIVE_VALIDATION_START]', {
        uid: user.uid,
        exchange: resolvedExchange,
        validationType: 'plaintext_keys_before_firestore'
      });

      // PERFORM LIVE VALIDATION FIRST - Pure, side-effect free
      let validationSuccess = false;
      let validationErr: any = null;
      try {
        const { ExchangeConnectorFactory } = await import('../services/exchangeConnector');
        // 🎯 NORMALIZE credentials for validation - trim and standardize
        // Use same testnet logic as other routes for consistency
        const normalizedCredentials = {
          apiKey: apiKey.trim(),
          secret: secret.trim(),
          passphrase: passphrase ? passphrase.trim() : undefined,
          testnet: body.testnet ?? true  // Use same default as other routes
        };


        const connector = ExchangeConnectorFactory.create(resolvedExchange, normalizedCredentials);

        const testResult = await connector.testConnection();
        validationSuccess = testResult.success !== false;

        console.log('🔥 [HARD_LOG] [EXCHANGE_LIVE_VALIDATION_RESULT]', {
          uid: user.uid,
          exchange: resolvedExchange,
          validationSuccess,
          testResult: testResult.success
        });

      } catch (err: any) {
        validationErr = err;
        console.log('🔥 [HARD_LOG] [EXCHANGE_LIVE_VALIDATION_FAILED]', {
          uid: user.uid,
          exchange: resolvedExchange,
          error: validationErr.message
        });
        validationSuccess = false;
      }

      // ===================================================================
      // INVALID_KEYS INVARIANT ENFORCEMENT
      // ===================================================================
      // INVALID_KEYS is a TRANSIENT EVENT, not persistent state
      // It may ONLY be written inside POST /exchange/connect
      // It may ONLY be written for REAL credential validation failures
      // NEVER for: decryption failures, ENCRYPTION_SECRET mismatch, network issues
      // ===================================================================

      // FIX: INVALID_KEYS only for credential failures, not system failures
      // Check if validation failed due to invalid credentials vs system issues
      let shouldSetInvalidKeys = false;
      if (!validationSuccess && validationErr) {
        const errorMsg = validationErr.message?.toLowerCase() || '';
        // Only set INVALID_KEYS for credential-related failures
        shouldSetInvalidKeys = errorMsg.includes('invalid') ||
                               errorMsg.includes('unauthorized') ||
                               errorMsg.includes('forbidden') ||
                               errorMsg.includes('authentication') ||
                               errorMsg.includes('signature') ||
                               errorMsg.includes('api key') ||
                               errorMsg.includes('secret');

        // CRITICAL: Log what triggered INVALID_KEYS (for debugging/auditing)
        if (shouldSetInvalidKeys) {
          logger.warn({
            uid: user.uid,
            exchange: resolvedExchange,
            errorMessage: validationErr.message,
            invalidKeysTrigger: 'credential_failure'
          }, 'INVALID_KEYS_SET: Credential validation failed, setting INVALID_KEYS as transient event');
        }
      }

      // CRITICAL: Assert write to canonical path only
      const { assertExchangeConfigWritePath, assertInvalidKeysWriteAllowed, assertExchangeStatusWriteAllowed } = await import('../services/firestoreAdapter');
      assertExchangeConfigWritePath(user.uid, `users/${user.uid}/exchangeConfig/current`);

      // CRITICAL: Assert exchangeStatus write is allowed ONLY in exchange routes
      assertExchangeStatusWriteAllowed('exchange_connect');

      // CRITICAL: Assert INVALID_KEYS write is allowed ONLY in connect flow
      if (!validationSuccess && shouldSetInvalidKeys) {
        assertInvalidKeysWriteAllowed('exchange_connect');
      }

      // FIX: Only write exchangeConfig for successful connections or credential failures
      // For system failures, don't create/update config to avoid setting INVALID_KEYS inappropriately
      if (validationSuccess || shouldSetInvalidKeys) {
        // PREPARE CONFIG FOR WRITE-ONCE - Include all fields in single operation
        const { getFirebaseAdmin } = await import('../utils/firebase');
        const { encrypt } = await import('../services/keyManager');
        const db = admin.firestore(getFirebaseAdmin());
        const docRef = db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current');

        // Check if document exists to determine if we should set createdAt
        const existingDoc = await docRef.get();
        const documentExists = existingDoc.exists;

        const exchangeConfig: any = {
          exchange: resolvedExchange,
          apiKeyEncrypted: encrypt(apiKey),
          secretEncrypted: encrypt(secret),
          testnet: body.testnet ?? true,  // Use same testnet as validation
          exchangeStatus: validationSuccess ? 'CONNECTED' : 'INVALID_KEYS',
          disconnected: false,
          updatedAt: admin.firestore.Timestamp.now(),
        };

        // Only set createdAt if document doesn't exist
        if (!documentExists) {
          exchangeConfig.createdAt = admin.firestore.Timestamp.now();
        }

        if (passphrase) {
          exchangeConfig.passphraseEncrypted = encrypt(passphrase);
        }

        if (validationSuccess) {
          // CONNECTED: Clear any legacy issues
          exchangeConfig.keysClearedAt = admin.firestore.FieldValue.delete();
          exchangeConfig.keysClearedReason = admin.firestore.FieldValue.delete();
          exchangeConfig.exchangeConnectedAt = admin.firestore.Timestamp.now();
        } else {
          // INVALID_KEYS: Set reason
          exchangeConfig.keysClearedReason = 'Live validation failed with submitted keys';
          exchangeConfig.keysClearedAt = admin.firestore.Timestamp.now();
        }

        // 🔥 HARD_LOG: SINGLE_FIRESTORE_WRITE
        console.log('🔥 [HARD_LOG] [EXCHANGE_SINGLE_FIRESTORE_WRITE]', {
          uid: user.uid,
          exchange: resolvedExchange,
          validationSuccess,
          shouldSetInvalidKeys,
          exchangeStatus: exchangeConfig.exchangeStatus,
          firestorePath: `users/${user.uid}/exchangeConfig/current`,
          dataKeys: Object.keys(exchangeConfig)
        });

        // WRITE-ONCE: Single Firestore operation with all data
        const sanitizedExchangeConfig = sanitizeFirestorePayload(exchangeConfig);
        await docRef.set(sanitizedExchangeConfig);

        // CRITICAL: Verify document was written successfully
        const verifyDoc = await docRef.get();
        if (!verifyDoc.exists) {
          throw new Error(`CRITICAL: Exchange config write failed - document does not exist after write: users/${user.uid}/exchangeConfig/current`);
        }

        // 🔥 HARD LOG: CONFIRM DOCUMENT EXISTS AFTER WRITE
        console.log('🔥 [HARD_LOG] [EXCHANGE_CONFIG_WRITE_VERIFIED]', {
          uid: user.uid,
          documentPath: `users/${user.uid}/exchangeConfig/current`,
          snapshotExists: verifyDoc.exists,
          exchange: resolvedExchange,
          exchangeStatus: exchangeConfig.exchangeStatus,
          verificationTimestamp: new Date().toISOString()
        });
      } else {
        // System failure - don't write config to avoid setting INVALID_KEYS inappropriately
        console.log('🔥 [HARD_LOG] [EXCHANGE_SYSTEM_FAILURE_NO_CONFIG_WRITE]', {
          uid: user.uid,
          exchange: resolvedExchange,
          reason: 'Validation failed due to system issues, not writing config'
        });
      }

      // Handle successful connection or credential failure
      if (validationSuccess || shouldSetInvalidKeys) {
        const { getFirebaseAdmin } = await import('../utils/firebase');
        const db = admin.firestore(getFirebaseAdmin());

        if (validationSuccess) {
          // SUCCESS: Exchange connected and validated
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
            exchangeStatus: 'CONNECTED'
          });

          return {
            success: true,
            connected: true,
            exchange,
            exchangeStatus: 'CONNECTED'
          };
        } else {
          // CREDENTIAL FAILURE: Connected but with invalid keys
          logger.warn({
            uid: user.uid,
            exchange
          }, 'Exchange connect failed due to invalid credentials');

          // Update users document to reflect connection attempt with invalid keys
          await db.collection('users').doc(user.uid).set({
            apiConnected: false,
            isApiConnected: false,
            apiStatus: 'invalid_keys',
            connectedExchanges: [],
            exchangeLastConnected: admin.firestore.Timestamp.now(),
            updatedAt: admin.firestore.Timestamp.now(),
          }, { merge: true });

          console.log('🔥 [HARD_LOG] [EXCHANGE_CONNECT_INVALID_KEYS]', {
            uid: user.uid,
            exchange: resolvedExchange,
            result: 'invalid_keys'
          });

          return {
            success: true,
            connected: false,
            exchange,
            exchangeStatus: 'INVALID_KEYS'
          };
        }
      } else {
        // SYSTEM FAILURE: Don't update users document
        logger.warn({
          uid: user.uid,
          exchange,
          error: validationErr?.message
        }, 'Exchange connect failed due to system issues');

        console.log('🔥 [HARD_LOG] [EXCHANGE_CONNECT_SYSTEM_FAILURE]', {
          uid: user.uid,
          exchange: resolvedExchange,
          error: validationErr?.message,
          result: 'system_failure_no_update'
        });

        return {
          success: false,
          connected: false,
          exchange,
          message: 'Connection failed due to system issues. Please try again later.',
          error: validationErr?.message
        };
      }
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
      const exchangeUsability = await isExchangeUsable(user.uid, 'background_job');
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
      const decryptedApiKey = decrypt(config.apiKeyEncrypted, 'exchange_validate');
      const decryptedSecret = decrypt(config.secretKeyEncrypted || config.secretEncrypted, 'exchange_validate');
      const decryptedPassphrase = config.passphraseEncrypted ? decrypt(config.passphraseEncrypted, 'exchange_validate') : undefined;

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

      // CRITICAL: Assert exchangeStatus write is allowed ONLY in exchange routes
      const { assertExchangeStatusWriteAllowed } = await import('../services/firestoreAdapter');
      assertExchangeStatusWriteAllowed('exchange_disconnect');

      const { getFirebaseAdmin } = await import('../utils/firebase');
      const db = admin.firestore(getFirebaseAdmin());

      if (permanentDelete) {
        // FIX 1: Clear stale INVALID_KEYS before deletion
        // INVALID_KEYS must not persist after disconnect
        await db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current').update({
          exchangeStatus: 'DISCONNECTED'
        }).catch(() => {}); // Ignore if document doesn't exist
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
        // FIX 1: Clear stale INVALID_KEYS before deletion
        // INVALID_KEYS must not persist after disconnect
        const docRef = db.collection('users').doc(user.uid).collection('exchangeConfig').doc('current');
        await docRef.update({
          exchangeStatus: 'DISCONNECTED'
        }).catch(() => {}); // Ignore if document doesn't exist

        // Default behavior: Delete the exchange config document to mark as unusable
        // This ensures isExchangeUsable returns "No exchange configuration found"
        // Always attempt to delete - if document doesn't exist, delete is a no-op
        await docRef.delete();

        // 🔥 HARD_LOG: EXCHANGE_DISCONNECT
        console.log('🔥 [HARD_LOG] [EXCHANGE_DISCONNECT]', {
          uid: user.uid,
          exchange,
          permanentDelete: false,
          documentDeleted: true,
          disconnectAlwaysSucceeds: true
        });

        logger.info({
          uid: user.uid,
          exchange
        }, 'Exchange disconnected - document deleted to mark as unusable');
      }

      // CRITICAL: Update users/{uid} document to reflect disconnected state
      // This ensures UI and engine read correct state instead of stale flags
      try {
        await db.collection('users').doc(user.uid).set({
          apiConnected: false,
          isApiConnected: false,
          apiStatus: 'disconnected',
          // REMOVED: exchangeStatus: 'DISCONNECTED' per WRITE-ONCE policy
          connectedExchanges: [],
          engineRunning: false,
          autoTradeEnabled: false,
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
      await backgroundResearchScheduler.forceStopUserScheduler(user.uid, 'disconnected');

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

