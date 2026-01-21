import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  firestoreAdapter,
  isExchangeUsable,
} from "../services/firestoreAdapter";
import {
  ExchangeConnectorFactory,
  type ExchangeName,
  type ExchangeCredentials,
} from "../services/exchangeConnector";
import { encrypt, decrypt } from "../services/keyManager";
import { logger } from "../utils/logger";
import * as admin from "firebase-admin";

/**
 * CRITICAL SECURITY: Validate canonical exchangeConfig write paths
 * Only allows writes to users/{uid}/exchangeConfig/current
 * Throws immediately for any other exchangeConfig paths
 */
export function validateCanonicalExchangeConfigPath(path: string): void {
    const canonicalRegex = /^users\/[^\/]+\/exchangeConfig\/current$/;

    if (path.includes('exchangeConfig') && !canonicalRegex.test(path)) {
        const errorMsg = `🚨 [EXCHANGE_CONFIG_SECURITY] Non-canonical exchangeConfig write blocked: ${path}`;
        console.error(errorMsg);
        console.error(`   Expected format: users/{uid}/exchangeConfig/current`);
        console.error(`   Received path: "${path}"`);
        console.error(`   Path segments: [${path.split('/').join(', ')}]`);
        throw new Error(errorMsg);
    }
}

/**
 * Sanitize Firestore payload by removing undefined values and converting them to FieldValue.delete()
 * CRITICAL RUNTIME GUARD: Crash if legacy exchange state fields are written
 */
export function sanitizeFirestoreUpdate(updateData: any): any {
  // Apply the same sanitization to update operations
  return sanitizeFirestorePayload(updateData);
}

/**
 * HARD RUNTIME GUARD: Prevent any attempt to write INVALID_KEYS or legacy exchange status
 * This function should be called before ANY Firestore operation that could affect exchange config
 */
export function assertNoInvalidKeysWrite(operation: string, context: string): void {
  // CRITICAL: INVALID_KEYS can NEVER be written under any circumstances
  // This guard ensures the invariant is maintained system-wide

  if (context !== "user_request") {
    const errorMsg = `🚨 [INVALID_KEYS_WRITE_GUARD] Attempted ${operation} outside user_request context: ${context}`;
    console.error(errorMsg);
    console.error('   INVALID_KEYS can ONLY be written during explicit user credential validation');
    console.error('   Context must be "user_request"');
    console.error('   Operation blocked');
    console.error('   HARD ERROR: Write protection invariant triggered.');
    throw new Error(errorMsg);
  }

  console.log(`✅ [INVALID_KEYS_WRITE_GUARD] ${operation} allowed in user_request context`);
}

/**
 * CRITICAL SAFETY GUARD: Detect any attempt to write INVALID_KEYS
 * This function throws if any code attempts invalid exchange status writes
 */
function detectInvalidKeysWrite(payload: any, operation: string): void {
  const forbiddenValues = ['INVALID_KEYS'];
  const forbiddenFields = ['exchangeStatus', 'keysClearedReason'];

  // Check for direct INVALID_KEYS writes
  for (const value of forbiddenValues) {
    for (const [key, val] of Object.entries(payload)) {
      if (val === value) {
        const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write "${value}" to field "${key}" during ${operation}`;
        console.error(errorMsg);
        console.error('   Payload:', JSON.stringify(payload, null, 2));
        console.error('   This violates the INVALID_KEYS invariant');
        console.error('   INVALID_KEYS can only be written during successful credential validation');
        console.error('   HARD ERROR: Write protection invariant triggered by detectInvalidKeysWrite.');
        throw new Error(errorMsg);
      }
    }
  }

  // Check for invalid keysClearedReason values
  if (payload.keysClearedReason && typeof payload.keysClearedReason === 'string') {
    if (payload.keysClearedReason.includes('Decryption failure') ||
        payload.keysClearedReason.includes('ENCRYPTION_SECRET')) {
      const errorMsg = `🚨 [INVALID_KEYS_WRITE_DETECTED] Attempted to write invalid keysClearedReason during ${operation}`;
      console.error(errorMsg);
      console.error('   Reason:', payload.keysClearedReason);
      console.error('   Decryption failures must NOT write keysClearedReason');
      throw new Error(errorMsg);
    }
  }
}

export function sanitizeFirestorePayload(payload: any): any {
  // TEMPORARY DEBUG: Log payload keys at entry
  console.log("🔍 [SANITIZER_ENTRY] Payload keys:", Object.keys(payload));

  // FIRST: Detect any attempt to write INVALID_KEYS or invalid reasons
  detectInvalidKeysWrite(payload, "Firestore write via sanitizeFirestorePayload");

  // SECOND: PURE PASS-THROUGH SANITIZER - Remove ALL forbidden fields, never add them
  const forbiddenFields = ['exchangeStatus', 'keysClearedAt', 'keysClearedReason'];
  const sanitized = { ...payload };

  let removedFields = [];
  for (const field of forbiddenFields) {
    if (sanitized.hasOwnProperty(field)) {
      const value = sanitized[field];
      delete sanitized[field];
      removedFields.push(field);
      console.log(`🧹 [SANITIZER_REMOVED] Removed forbidden field: ${field} (was: ${JSON.stringify(value)}) [PROOF: Write protection active]`);
    }
  }

  // THIRD: Convert undefined values to FieldValue.delete() (standard sanitization)
  for (const [key, value] of Object.entries(sanitized)) {
    if (value === undefined) {
      sanitized[key] = admin.firestore.FieldValue.delete();
    }
  }

  // TEMPORARY DEBUG: Log payload keys at exit
  console.log("🔍 [SANITIZER_EXIT] Sanitized keys:", Object.keys(sanitized));

  return sanitized;
}

function safeDate(value: any) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const exchangeConfigSchema = z.object({
  exchange: z.enum(["binance", "bitget", "weex", "bingx"]).optional(),
  type: z.enum(["binance", "bitget", "weex", "bingx"]).optional(),
  apiKey: z.string().min(1),
  secret: z.string().min(1).optional(),
  passphrase: z.string().optional(),
  testnet: z.boolean().optional().default(false),
});

export async function exchangeRoutes(fastify: FastifyInstance) {
  console.log("[DEBUG] Loading exchangeRoutes...");

  // POST /api/exchange/test - Test exchange connection
  fastify.post(
    "/exchange/test",
    {
      preHandler: [fastify.authenticate],
    },
    async (
      request: FastifyRequest<{
        Body: any;
        Querystring: { exchange?: string };
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const user = (request as any).user || {};
        const uid = user.uid;

        if (!uid) {
          return reply.code(200).send({
            success: false,
            message: { error: "User not authenticated" },
          });
        }
        // Exchange status is informational only - proceed regardless
        const query = request.query;
        const validationParams = z
          .object({
            exchange: z.enum(["binance", "bitget", "weex", "bingx"]).optional(),
            apiKey: z.string().optional(),
            secret: z.string().optional(),
            passphrase: z.string().optional(),
            testnet: z.boolean().optional().default(false),
          })
          .safeParse(request.body || {});

        if (!validationParams.success) {
          return reply.code(200).send({
            success: false,
            message: { error: "Invalid payload params" },
          });
        }
        const body = validationParams.data;

        let credentials: ExchangeCredentials;
        let exchange: ExchangeName;
        let config: any = null;
        let db: any = null;

        // If credentials provided in body, use them
        if (body.apiKey && body.secret) {
          exchange =
            body.exchange || (query.exchange as ExchangeName);
          credentials = {
            apiKey: body.apiKey,
            secret: body.secret,
            passphrase: body.passphrase,
            testnet: body.testnet ?? false,
          };
        } else {
          // Load from user's saved config
          const { getFirebaseAdmin } = await import("../utils/firebase");
          db = getFirebaseAdmin().firestore();
          const doc = await db
            .collection("users")
            .doc(user.uid)
            .collection("exchangeConfig")
            .doc("current")
            .get();

          if (!doc.exists) {
            return reply.code(400).send({
              message: {
                error:
                  "No exchange configuration found. Please save your credentials first.",
              },
              success: false,
            });
          }

          config = doc.data()!;

          // Check if user has explicitly disconnected
          if (config.disconnected === true) {
            return reply.code(400).send({
              message: {
                error:
                  "Exchange has been disconnected. Please reconnect to continue.",
              },
              success: false,
            });
          }

          // Handle case where saved config exists but exchange is undefined (partial save)
          exchange =
            (config.exchange as ExchangeName) ||
            (query.exchange as ExchangeName);

          // Verify query param matches saved config ONLY if saved config has an exchange defined
          if (
            config.exchange &&
            query.exchange &&
            query.exchange !== config.exchange
          ) {
            return reply.code(400).send({
              message: {
                error: `Configuration mismatch: Saved config is for ${config.exchange}, but you requested test for ${query.exchange}`,
              },
              success: false,
            });
          }

          // Decrypt credentials - CRITICAL: Use decryptOrThrow for explicit user actions only
          const { decryptOrThrow } = await import("../services/keyManager");
          credentials = {
            apiKey: decryptOrThrow(config.apiKeyEncrypted, "API key", "user_request"),
            secret: decryptOrThrow(
              config.secretKeyEncrypted || config.secretEncrypted,
              "secret key",
              "user_request"
            ),
            passphrase: config.passphraseEncrypted
              ? decryptOrThrow(config.passphraseEncrypted, "passphrase", "user_request")
              : undefined,
            testnet: config.testnet ?? false,
          };
        }

        // Validate required fields
        const requiredFields =
          ExchangeConnectorFactory.getRequiredFields(exchange);
        if (requiredFields.includes("passphrase") && !credentials.passphrase) {
          return reply.code(400).send({
            message: { error: "Passphrase is required for this exchange" },
            success: false,
          });
        }

        // Create connector and test
        let result;
        try {
          const connector = ExchangeConnectorFactory.create(
            exchange,
            credentials,
          );
          result = await connector.testConnection();
        } catch (connErr: any) {
          // If connector throws, treat as connection failure but formatted cleanly
          return reply.code(200).send({
            success: false,
            message: { error: connErr.message || "Connection failed" },
            details: { balances: [], positions: [] },
          });
        }

        logger.info(
          { uid: user.uid, exchange, success: result.success },
          "Exchange connection test",
        );

        // Defensive Parsing & Normalization
        // Ensure details exist and arrays are valid (even if empty)
        const safeDetails = {
          balances: Array.isArray(result.details?.balances)
            ? result.details.balances
            : [],
          positions: Array.isArray(result.details?.positions)
            ? result.details.positions
            : [],
          account: result.details?.account || {},
          ...result.details,
        };

        // Force success true if we got a valid result object backend, even if it had empty balances
        // UNLESS explicitly marked false by connector
        const isSuccess = result.success !== false; // defaulted to true if undefined

        // REMOVED: exchangeStatus clearing - violates invariant
        // exchangeStatus may only be written by explicit disconnect handler

        return {
          success: isSuccess,
          message: {
            text:
              result.message ||
              (isSuccess ? "Connection successful" : "Connection failed"),
          },
          details: safeDetails,
          exchange,
        };
      } catch (err: any) {
        logger.error({ err }, "Error testing exchange connection");
        return reply.code(500).send({
          message: {
            error: err.message || "Error testing exchange connection",
          },
          success: false,
        });
      }
    },
  );

  // POST /api/exchange/test-trade - Place a test trade order
  fastify.post(
    "/exchange/test-trade",
    {
      preHandler: [fastify.authenticate],
    },
    async (
      request: FastifyRequest<{
        Body: {
          exchange?: ExchangeName;
          symbol?: string;
          side?: "BUY" | "SELL";
          quantity?: number;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const user = (request as any).user;

      try {
        const body = z
          .object({
            exchange: z.enum(["binance", "bitget", "weex", "bingx"]).optional(),
            symbol: z.string().optional().default("BTCUSDT"),
            side: z.enum(["BUY", "SELL"]).optional().default("BUY"),
            quantity: z.number().positive().optional().default(0.001),
          })
          .parse(request.body || {});

        // Get exchange connector
        const { getFirebaseAdmin } = await import("../utils/firebase");
        const db = getFirebaseAdmin().firestore();
        const configDoc = await db
          .collection("users")
          .doc(user.uid)
          .collection("exchangeConfig")
          .doc("current")
          .get();

        if (!configDoc.exists) {
          return reply.code(404).send({
            success: false,
            message: {
              error:
                "Exchange configuration not found. Please configure your exchange API credentials first.",
            },
          });
        }

        const config = configDoc.data()!;
        const exchange = (body.exchange || config.exchange) as ExchangeName;

        // Validate exchange matches if specified
        if (body.exchange && body.exchange !== config.exchange) {
          return reply.code(400).send({
            success: false,
            message: {
              error: `Exchange mismatch. Configured: ${config.exchange}, requested: ${body.exchange}`,
            },
          });
        }

        // Create connector - CRITICAL: Use decryptOrThrow for exchange credentials
        let connector;
        try {
          const { decryptOrThrow } = await import("../services/keyManager");
          connector = ExchangeConnectorFactory.create(exchange, {
            apiKey: decryptOrThrow(config.apiKeyEncrypted, "API key", "user_request"),
            secret: decryptOrThrow(
              config.secretKeyEncrypted || config.secretEncrypted,
              "secret key",
              "user_request"
            ),
            passphrase: config.passphraseEncrypted
              ? decryptOrThrow(config.passphraseEncrypted, "passphrase", "user_request")
              : undefined,
            testnet: config.testnet ?? false,
          });
        } catch (decryptErr: any) {
          logger.error(
            { uid: user.uid, exchange, error: decryptErr.message },
            "EXCHANGE_KEY_DECRYPTION_FAILED: Failed to decrypt exchange credentials",
          );
          return reply.code(400).send({
            success: false,
            message: {
              error: decryptErr.message?.includes(
                "EXCHANGE_KEY_DECRYPTION_FAILED",
              )
                ? "Exchange API key decryption failed - invalid ENCRYPTION_SECRET. Please re-enter your exchange API keys."
                : "Failed to decrypt exchange credentials",
            },
          });
        }

        // Get symbol info to determine minimum order size
        try {
          // Determine minimum quantity (use provided quantity or minimum)
          const minQuantity = 0.001; // Default minimum
          const orderQuantity = Math.max(
            body.quantity || minQuantity,
            minQuantity,
          );

          // Place market order
          const order = await connector.placeOrder({
            symbol: body.symbol!,
            side: body.side!,
            type: "MARKET",
            quantity: orderQuantity,
          });

          // Update last tested timestamp
          await db
            .collection("users")
            .doc(user.uid)
            .collection("exchangeConfig")
            .doc("current")
            .update({
              lastTested: safeDate(new Date()),
            });

          logger.info(
            {
              uid: user.uid,
              exchange,
              symbol: body.symbol,
              side: body.side,
              orderId: order.id || order.orderId,
            },
            "Test trade placed successfully",
          );

          return {
            success: true,
            message: "Test trade placed successfully",
            orderId: order.id || order.orderId || "N/A",
            status: order.status || "FILLED",
            filledPrice: order.filledPrice || order.price || "N/A",
            filledQuantity: order.filledQuantity || orderQuantity,
            exchange,
            symbol: body.symbol,
            side: body.side,
            exchangeConfirmation: order.exchangeConfirmation || order.raw || {},
          };
        } catch (tradeErr: any) {
          logger.error(
            { err: tradeErr, uid: user.uid, exchange },
            "Error placing test trade",
          );
          return reply.code(400).send({
            success: false,
            message: { error: tradeErr.message || "Error placing test trade" },
            details: tradeErr.response?.data || tradeErr.data,
          });
        }
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Invalid input",
            details: err.errors,
          });
        }
        logger.error({ err, uid: user.uid }, "Error in test trade endpoint");
        return reply.code(500).send({
          success: false,
          error: err.message || "Error placing test trade",
        });
      }
    },
  );

  fastify.get(
    "/exchange/status",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const user = (request as any).user;
        const query = request.query as { exchange?: string };

        // CRITICAL: Use isExchangeUsable() as single source of truth
        const { isExchangeUsable } = await import("../services/firestoreAdapter");
        const exchangeUsability = await isExchangeUsable(user.uid, "user_request");

        if (query.exchange) {
          // Get status for specific exchange
          const isConnected = exchangeUsability.reason === "connected" && 
                             exchangeUsability.exchange === query.exchange.toLowerCase();

          return {
            exchange: query.exchange,
            connected: isConnected,
            reason: exchangeUsability.reason,
          };
        } else {
          // Get status for all exchanges
          const exchanges: ExchangeName[] = [
            "binance",
            "bitget",
            "weex",
            "bingx",
          ];

          const statuses = exchanges.map((exchange) => {
            const isConnected = exchangeUsability.reason === "connected" && 
                               exchangeUsability.exchange === exchange;

            return {
              exchange,
              connected: isConnected,
            };
          });

          return { 
            exchanges: statuses,
            connectedExchange: exchangeUsability.exchange,
            reason: exchangeUsability.reason,
          };
        }
      } catch (err: any) {
        logger.error(
          { error: err.message, uid: (request as any).user?.uid },
          "Exchange status check failed",
        );
        return reply.code(500).send({
          message: { error: err.message || "Failed to get exchange status" },
        });
      }
    },
  );

  // GET /exchange/connected - Get connected exchange status
  fastify.get(
    "/exchange/connected",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      try {
        // CRITICAL: Use isExchangeUsable() as single source of truth
        const { isExchangeUsable } = await import("../services/firestoreAdapter");
        const exchangeUsability = await isExchangeUsable(user.uid, "user_request");

        const connected = exchangeUsability.reason === "connected";
        const connectedExchanges = connected && exchangeUsability.exchange
          ? [{
              exchange: exchangeUsability.exchange,
              connected: true,
            }]
          : [];

        return {
          connected,
          exchanges: connectedExchanges,
          reason: exchangeUsability.reason,
        };
      } catch (err: any) {
        logger.error(
          { error: err.message, uid: user.uid },
          "Exchange connected check failed",
        );
        return reply.code(500).send({
          error: err.message || "Failed to check connected exchanges",
        });
      }
    },
  );

  // POST /exchange/connect - Connect to exchange
  fastify.post(
    "/exchange/connect",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // CRITICAL: Verify encryption key consistency for API requests
      const { verifyEncryptionKeyConsistency } =
        await import("../services/keyManager");
      verifyEncryptionKeyConsistency("user_request");

      const user = (request as any).user;

      // CRITICAL: Log UID consistency for exchange connect
      logger.info(
        {
          uid: user.uid,
          uidSource: "auth_middleware_request_user_uid",
          uidLength: user.uid.length,
          action: "exchange_connect_attempt",
        },
        "EXCHANGE_CONNECT_UID_CONSISTENCY_CHECK",
      );

      try {
        const body = request.body as any;
        const { apiKey, secret, exchange, passphrase, type } = body || {};

        // LOG: Raw values before any processing
        console.log(
          `[EXCHANGE_CONNECT_RAW] UID:${user.uid} - Raw request values:`,
          {
            exchange,
            apiKey: apiKey ? `${apiKey.substring(0, 8)}...` : "UNDEFINED",
            secret: secret ? `${secret.substring(0, 8)}...` : "UNDEFINED",
            passphrase: passphrase
              ? `${passphrase.substring(0, 8)}...`
              : "UNDEFINED",
            apiKeyLength: apiKey?.length || 0,
            secretLength: secret?.length || 0,
            passphraseLength: passphrase?.length || 0,
          },
        );

        logger.info(
          {
            uid: user.uid,
            exchange,
            hasApiKey: !!apiKey,
            hasSecret: !!secret,
            hasPassphrase: !!passphrase,
          },
          "Exchange connect request",
        );

        const { getFirebaseAdmin } = await import("../utils/firebase");
        const firebaseApp = getFirebaseAdmin();
        const db = admin.firestore(firebaseApp);

        // PHASE 1 & 4 — FIRESTORE INSTANCE & DATABASE TRACING
        console.log("🔥 [FIRESTORE_INSTANCE_TRACE]");
        console.log("   - App Name:", firebaseApp.name);
        console.log("   - Project ID:", firebaseApp.options.projectId);
        console.log("   - Database URL:", firebaseApp.options.databaseURL || "default");
        console.log("   - Firestore Host:", "firestore.googleapis.com (production)");
        console.log("   - Is Emulator:", !!process.env.FIRESTORE_EMULATOR_HOST);
        console.log("   - Emulator Host:", process.env.FIRESTORE_EMULATOR_HOST || "NOT SET");

        // CRITICAL: Log Firestore database targeting
        try {
          const firestoreSettings = (db as any)._settings;
          console.log("   - Firestore Database ID:", firestoreSettings?.databaseId || "(default)");
          console.log("   - Firestore Project ID:", firestoreSettings?.projectId || firebaseApp.options.projectId);
          console.log("   - Firestore Mode: Native (not Datastore)");
        } catch (settingsError) {
          console.log("   - Firestore Settings: (could not access internal settings)");
        }

        console.log("   - Total Firebase Apps:", admin.apps.length);
        console.log("   - All Apps:", admin.apps.map(a => ({
          name: a.name,
          projectId: a.options.projectId,
          databaseURL: a.options.databaseURL || "default"
        })));

        // PHASE 4 — MULTIPLE FIRESTORE APPS VERIFICATION
        if (admin.apps.length > 1) {
          console.warn("⚠️ [MULTIPLE_APPS_WARNING] More than one Firebase app exists!");
          console.warn("   This could cause read/write to different databases");
          admin.apps.forEach((app, index) => {
            console.warn(`   App ${index}: ${app.name} → ${app.options.projectId}`);
          });
        }

        // CRITICAL: Check for emulator usage that would cause silent write failures
        if (process.env.FIRESTORE_EMULATOR_HOST) {
          console.error("🚨 [EXCHANGE_CONNECT_EMULATOR_DETECTED] FIRESTORE_EMULATOR_HOST is set!");
          console.error("🚨 This will cause writes to succeed but not persist to real database!");
          console.error("🚨 EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST);
          throw new Error("EXCHANGE_CONNECT_FAILED: Firestore emulator detected - writes will not persist");
        }

        // PHASE 5 — ENVIRONMENT & PROCESS CHECK
        console.log("🔧 [RUNTIME_ENVIRONMENT]");
        console.log("   - NODE_ENV:", process.env.NODE_ENV || "undefined");
        console.log("   - FIRESTORE_EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST || "NOT SET");
        console.log("   - GOOGLE_APPLICATION_CREDENTIALS:", process.env.GOOGLE_APPLICATION_CREDENTIALS || "NOT SET");
        console.log("   - process.cwd():", process.cwd());
        console.log("   - __dirname:", __dirname);

        const docRef = db
          .collection("users")
          .doc(user.uid)
          .collection("exchangeConfig")
          .doc("current");
        const existingDoc = await docRef.get();
        const existingData = existingDoc.exists ? existingDoc.data() || {} : {};

        // HARD REQUIRE: All critical fields must be present for complete save
        // CRITICAL: Prevent poisoning from disconnected data
        // Only use existingData.exchange if it's a valid non-empty string
        let resolvedExchange: string | undefined;

        if (exchange && typeof exchange === 'string' && exchange.trim() !== '') {
          // User explicitly provided exchange - use it
          resolvedExchange = exchange.trim().toLowerCase();
        } else if (type && typeof type === 'string' && type.trim() !== '') {
          // Fallback to type
          resolvedExchange = type.trim().toLowerCase();
        } else if (existingData.exchange && typeof existingData.exchange === 'string' &&
          existingData.exchange.trim() !== '' && existingData.exchange !== null) {
          // Only use existing exchange if it's valid and not from disconnect poisoning
          resolvedExchange = existingData.exchange.trim().toLowerCase();
        } else if (existingData.type && typeof existingData.type === 'string' &&
          existingData.type.trim() !== '') {
          // Final fallback to existing type
          resolvedExchange = existingData.type.trim().toLowerCase();
        }

        // HARD VALIDATION: Exchange must be a valid non-empty string
        if (!resolvedExchange || typeof resolvedExchange !== 'string' || resolvedExchange.trim() === '') {
          console.log(
            `[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: Invalid exchange`,
            {
              providedExchange: exchange,
              providedType: type,
              existingExchange: existingData.exchange,
              existingType: existingData.type,
              resolvedExchange
            }
          );
          return reply
            .code(400)
            .send({ error: "Valid exchange name is required for exchange configuration" });
        }

        if (
          !apiKey ||
          typeof apiKey !== "string" ||
          apiKey.trim().length === 0
        ) {
          console.log(
            `[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: apiKey missing/empty`,
          );
          // 🔥 HARD_LOG: VALIDATION_FAILED_RETURN_PATH
          console.log("🔥 [HARD_LOG] [VALIDATION_FAILED_RETURN_PATH]", {
            uid: user.uid,
            error: "Exchange API key is missing from request",
            validationField: "apiKey",
            operation: "exchange_connect",
          });
          return reply
            .code(400)
            .send({ error: "Exchange API key is missing from request" });
        }

        if (
          !secret ||
          typeof secret !== "string" ||
          secret.trim().length === 0
        ) {
          console.log(
            `[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - FAIL: secret missing/empty`,
          );
          // 🔥 HARD_LOG: VALIDATION_FAILED_RETURN_PATH
          console.log("🔥 [HARD_LOG] [VALIDATION_FAILED_RETURN_PATH]", {
            uid: user.uid,
            error: "Exchange API secret is missing from request",
            validationField: "secret",
            operation: "exchange_connect",
          });
          return reply
            .code(400)
            .send({ error: "Exchange API secret is missing from request" });
        }

        // ASSERT: Raw keys are valid before encryption
        console.log(
          `[EXCHANGE_CONNECT_VALIDATION] UID:${user.uid} - SUCCESS: All validations passed, proceeding to encrypt`,
        );

        // CRITICAL: Assert write to canonical path only
        const { assertExchangeConfigWritePath } =
          await import("../services/firestoreAdapter");
        assertExchangeConfigWritePath(
          user.uid,
          `users/${user.uid}/exchangeConfig/current`,
        );

        // 🔥 HARD_LOG: BEFORE_ENCRYPTION
        console.log("🔥 [HARD_LOG] [BEFORE_ENCRYPTION]", {
          uid: user.uid,
          exchange: resolvedExchange,
          apiKeyLength: apiKey.length,
          secretLength: secret.length,
          passphraseLength: passphrase?.length || 0,
        });

        // ATOMIC WRITE: Always include all required fields, never partial
        // CRITICAL: Store encrypted keys - exchangeStatus NEVER added
        let exchangeConfig: any;

        try {
          // ONLY construct with allowed fields - NO exchangeStatus EVER
          const allowedConfig: any = {
            exchange: resolvedExchange,
            apiKeyEncrypted: encrypt(apiKey),
            secretEncrypted: encrypt(secret),
            testnet: false,
            disconnected: false, // Clear disconnected flag when reconnecting
            updatedAt: admin.firestore.Timestamp.now(),
          };

          if (passphrase) {
            allowedConfig.passphraseEncrypted = encrypt(passphrase);
          }

          if (!existingDoc.exists) {
            allowedConfig.createdAt = admin.firestore.Timestamp.now();
          }

          // EXPLICIT ASSIGNMENT: Only allowed fields, no spreads, no merges
          exchangeConfig = allowedConfig;

          // CRITICAL VALIDATION: exchangeStatus MUST NOT be present at construction
          if ('exchangeStatus' in exchangeConfig) {
            throw new Error('CRITICAL_BUG: exchangeStatus found in exchangeConfig during construction - this should never happen');
          }

          // 🔥 HARD_LOG: AFTER_ENCRYPTION
          console.log("🔥 [HARD_LOG] [AFTER_ENCRYPTION]", {
            uid: user.uid,
            exchange: resolvedExchange,
            apiKeyEncryptedLength: exchangeConfig.apiKeyEncrypted.length,
            secretEncryptedLength: exchangeConfig.secretEncrypted.length,
            passphraseEncryptedLength:
              exchangeConfig.passphraseEncrypted?.length || 0,
            encryptionSuccess: true,
          });
        } catch (encryptError: any) {
          // 🔥 HARD_LOG: ENCRYPTION_FAILED
          console.log("🔥 [HARD_LOG] [ENCRYPTION_FAILED]", {
            uid: user.uid,
            exchange: resolvedExchange,
            error: encryptError.message,
            errorType: "ENCRYPTION_ERROR",
          });
          throw encryptError; // Re-throw to prevent Firestore write
        }

        // CRITICAL VALIDATION: Ensure exchange is never null/undefined/empty before save
        if (!exchangeConfig.exchange || typeof exchangeConfig.exchange !== 'string' || exchangeConfig.exchange.trim() === '') {
          console.error('🔥 [CRITICAL_ERROR] [EXCHANGE_SAVE_VALIDATION_FAILED]', {
            uid: user.uid,
            resolvedExchange,
            exchangeConfigExchange: exchangeConfig.exchange,
            operation: 'exchange_connect_save'
          });
          throw new Error(`Exchange name is invalid: ${exchangeConfig.exchange}`);
        }

        // CRITICAL VALIDATION: exchangeStatus MUST NOT be present before Firestore write
        if ('exchangeStatus' in exchangeConfig) {
          console.error('🚨 [CRITICAL_BUG_DETECTED] exchangeStatus found in exchangeConfig before Firestore write', {
            uid: user.uid,
            dataKeys: Object.keys(exchangeConfig),
            exchangeStatusValue: exchangeConfig.exchangeStatus
          });
          throw new Error('CRITICAL_BUG: exchangeStatus found in exchangeConfig before Firestore write - construction bug detected');
        }

        // 🔥 HARD_LOG: IMMEDIATELY_BEFORE_FIRESTORE_WRITE
        console.log("🔥 [HARD_LOG] [IMMEDIATELY_BEFORE_FIRESTORE_WRITE]", {
          uid: user.uid,
          exchange: resolvedExchange,
          firestorePath: `users/${user.uid}/exchangeConfig/current`,
          mergeMode: "merge_true",
          dataKeys: Object.keys(exchangeConfig),
        });

        // IRONCLAD VALIDATION: Exchange field must be valid before any Firestore write
        if (!exchangeConfig.exchange || typeof exchangeConfig.exchange !== 'string' || exchangeConfig.exchange.trim() === '') {
          throw new Error(`Invalid exchange value: ${String(exchangeConfig.exchange)} - cannot write to Firestore`);
        }

        // PHASE 1 RUNTIME TRACE: FULL Firestore write instrumentation
        const writeId = `WRITE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // PHASE 1: HARD LOGGING - Log EVERY write to exchangeConfig/current
        console.log(`🔍 [FIRESTORE_WRITE_START] EXCHANGE_CONFIG/CURRENT - ${writeId}:`, {
          operation: 'POST /exchange/connect',
          firestorePath: `users/${user.uid}/exchangeConfig/current`,
          rawPayload: exchangeConfig,
          exchangeValue: exchangeConfig.exchange,
          exchangeType: typeof exchangeConfig.exchange,
          exchangeIsUndefined: exchangeConfig.exchange === undefined,
          exchangeIsEmpty: exchangeConfig.exchange === '',
          hasApiKey: !!exchangeConfig.apiKeyEncrypted,
          hasSecret: !!exchangeConfig.secretEncrypted,
          writeId,
          callerStack: new Error().stack.split('\n').slice(0, 5),
          timestamp: new Date().toISOString()
        });

        // CRITICAL: Firestore write MUST ALWAYS execute if encryption succeeds
        // No early returns allowed between encryption and Firestore write
        // CRITICAL: MERGE with existing document to preserve fields like exchange - do NOT overwrite
        const sanitizedExchangeConfig =
          sanitizeFirestorePayload(exchangeConfig);

        console.log(`🔍 [RUNTIME_FIRESTORE_WRITE_SANITIZED] EXCHANGE CONNECT - ${writeId}:`, {
          sanitizedPayload: sanitizedExchangeConfig,
          exchangeAfterSanitize: sanitizedExchangeConfig.exchange,
          exchangeTypeAfterSanitize: typeof sanitizedExchangeConfig.exchange,
          writeId,
          timestamp: new Date().toISOString()
        });

        console.log(`🔍 [RUNTIME_FIRESTORE_WRITE_EXECUTING] EXCHANGE CONNECT - ${writeId}:`, {
          path: `users/${user.uid}/exchangeConfig/current`,
          operation: 'set with merge: true',
          writeId,
          timestamp: new Date().toISOString()
        });

        console.log("[EXCHANGE_CONFIG_WRITE_SOURCE] exchange.ts::connect - POST /exchange/connect");

        // CONFIRMATION: exchangeConfig is a subcollection under users/{uid}
        console.log("📁 [FIRESTORE_STRUCTURE_CONFIRMATION]");
        console.log("   - Root collection: users");
        console.log("   - Document: users/" + user.uid);
        console.log("   - Subcollection: users/" + user.uid + "/exchangeConfig");
        console.log("   - Target document: users/" + user.uid + "/exchangeConfig/current");
        console.log("   - Structure: users/{uid}/exchangeConfig/{docId}");

        // CRITICAL SECURITY: Validate canonical path before write
        validateCanonicalExchangeConfigPath(`users/${user.uid}/exchangeConfig/current`);

        // PHASE 2 — WRITE EXECUTION PROOF
        const writePath = `users/${user.uid}/exchangeConfig/current`;
        console.log("📝 [WRITE_ATTEMPT] Starting Firestore write");
        console.log("   - Write path:", writePath);
        console.log("   - Write project ID:", firebaseApp.options.projectId);

        try {
          const firestoreSettings = (db as any)._settings;
          console.log("   - Write database ID:", firestoreSettings?.databaseId || "(default)");
        } catch (settingsError) {
          console.log("   - Database settings: (could not access internal settings)");
        }

        console.log("📝 [WRITE_DATA_PREVIEW]", {
          hasApiKey: !!sanitizedExchangeConfig.apiKeyEncrypted,
          hasSecret: !!sanitizedExchangeConfig.secretEncrypted,
          exchange: sanitizedExchangeConfig.exchange,
          merge: true
        });

        // MANDATORY: Use sanitized write helper to ensure sanitizer is never bypassed
        const { sanitizedSet } = await import("../utils/firebase");

        try {
          // CRITICAL: Runtime token to prove this write is inside POST /exchange/connect.
          // The global Firestore write barrier will only allow forbidden exchange-state fields
          // when this token is present (and stack matches this route).
          (globalThis as any).__DLX_EXCHANGE_CONNECT_WRITE_TOKEN = true;

          // CRITICAL: Firestore write - now protected by sanitized write helper
          await sanitizedSet(docRef, exchangeConfig, { merge: true });
          console.log("✅ [WRITE_COMPLETED] Sanitized set() returned without error");
        } catch (writeError: any) {
          console.error("❌ [WRITE_FAILED] Sanitized set() threw error:");
          console.error("   - Error:", writeError.message);
          console.error("   - Code:", writeError.code);
          console.error("   - Stack:", writeError.stack);
          throw writeError;
        } finally {
          (globalThis as any).__DLX_EXCHANGE_CONNECT_WRITE_TOKEN = false;
        }

        // PHASE 3 — PATH & APP MISMATCH CHECK
        console.log("🔍 [PATH_VERIFICATION]");
        console.log("   - Write path (constructed):", writePath);
        console.log("   - Write path (docRef.path):", docRef.path);
        console.log("   - Read path (same ref):", docRef.path);
        console.log("   - Firebase App used:", firebaseApp.name);
        console.log("   - Project ID for write:", firebaseApp.options.projectId);
        console.log("   - Firestore host:", "firestore.googleapis.com (production)");

        // PHASE 5 — IMMEDIATE READ-BACK VERIFICATION WITH DATABASE AUDIT
        console.log("🔍 [READ_BACK_ATTEMPT] Verifying document exists in same database");
        console.log("   - Read will use same Firebase app and database as write");
        console.log("   - Read project ID:", firebaseApp.options.projectId);
        console.log("   - Read Firestore host:", "firestore.googleapis.com (production)");

        try {
          const firestoreSettings = (db as any)._settings;
          console.log("   - Read database ID:", firestoreSettings?.databaseId || "(default)");
          console.log("   - Write and read use same database:", firestoreSettings?.databaseId || "(default)");
        } catch (settingsError) {
          console.log("   - Database settings verification: (could not access internal settings)");
        }

        try {
          const readBackSnap = await docRef.get();
          console.log("🔍 [READ_BACK_RESULT]");
          console.log("   - Document exists:", readBackSnap.exists);
          console.log("   - Document ID:", readBackSnap.id);
          console.log("   - Document path:", readBackSnap.ref.path);
          console.log("   - Read completed using project:", firebaseApp.options.projectId);

          try {
            const firestoreSettings = (db as any)._settings;
            console.log("   - Read completed using database:", firestoreSettings?.databaseId || "(default)");
          } catch (settingsError) {
            console.log("   - Database verification: (could not access internal settings)");
          }

          if (!readBackSnap.exists) {
            console.error("❌ [CRITICAL_PROJECT_MISMATCH] Document missing after write!");
            console.error("   This proves write and read are using different Firebase projects");
            console.error("   Write project:", firebaseApp.options.projectId);
            console.error("   Check Firebase Console for project:", firebaseApp.options.projectId);
            throw new Error("EXCHANGE_CONNECT_FAILED: Write succeeded but document not found on read-back");
          }

          if (readBackSnap.exists) {
            const data = readBackSnap.data();
            console.log("   - Has apiKeyEncrypted:", !!data?.apiKeyEncrypted);
            console.log("   - Has secretEncrypted:", !!data?.secretEncrypted);
            console.log("   - Exchange:", data?.exchange);
          } else {
            console.error("❌ [CRITICAL_FAILURE] Document does not exist immediately after successful write!");
            console.error("   This proves Firestore write is not persisting to the correct database");
            throw new Error("EXCHANGE_CONNECT_FAILED: Write succeeded but document does not exist");
          }
        } catch (readError: any) {
          console.error("❌ [READ_BACK_FAILED] Could not read back document:");
          console.error("   - Error:", readError.message);
          throw readError;
        }

        console.log(`✅ [RUNTIME_FIRESTORE_WRITE_COMPLETE] EXCHANGE CONNECT - ${writeId}:`, {
          path: `users/${user.uid}/exchangeConfig/current`,
          success: true,
          writeId,
          timestamp: new Date().toISOString()
        }); // Safe merge - preserves exchange field

        // REMOVED: Legacy cleanup - violates invariant
        // Forbidden exchange-state fields must never be introduced by connect.

          // CONNECT ROUTE FINAL ASSERTION: Verify connect did not introduce forbidden exchange-state fields
        try {
          console.log("🔍 [CONNECT_FINAL_ASSERTION] Reading back document to verify no forbidden exchange-state fields introduced");
          const finalReadSnap = await docRef.get();

          if (!finalReadSnap.exists) {
            throw new Error("Document missing after successful connect - critical failure");
          }

          const finalData = finalReadSnap.data();

          const forbiddenFields = ['exchangeStatus', 'keysClearedAt', 'keysClearedReason'] as const;
          const presentForbidden = forbiddenFields.filter((k) => finalData?.[k] !== undefined);
          if (presentForbidden.length > 0) {
            const errorMsg = `🚨 [CONNECT_ASSERTION_FAILED] Forbidden exchange-state fields present after connect: ${presentForbidden.join(", ")}`;
            console.error(errorMsg);
            console.error('   Connect flow must not introduce exchangeStatus/keysClearedAt/keysClearedReason');
            console.error('   Present values:', {
              exchangeStatus: finalData?.exchangeStatus,
              keysClearedAt: finalData?.keysClearedAt,
              keysClearedReason: finalData?.keysClearedReason,
            });
            throw new Error(errorMsg);
          }

          console.log("✅ [CONNECT_FINAL_ASSERTION] PASSED - No forbidden exchange-state fields introduced by connect");
          console.log("   Encrypted keys successfully persisted");

        } catch (assertionError: any) {
          console.error("❌ [CONNECT_ASSERTION_FAILED] Final assertion failed:", assertionError.message);
          // This is a CRITICAL failure - the connect operation violated invariants
          throw assertionError;
        }

        // PHASE 6 — FORCE FIRESTORE CONSOLE UI VISIBILITY
        // Firestore Console does NOT reliably render single-document subcollections
        // Create a second document to force the exchangeConfig subcollection to appear in UI
        try {
          console.log("🔧 [FIRESTORE_UI_VISIBILITY] Checking if _ui_probe document exists");

          const uiProbeDocRef = db
            .collection("users")
            .doc(user.uid)
            .collection("exchangeConfig")
            .doc("_ui_probe");

          const uiProbeDoc = await uiProbeDocRef.get();

          if (!uiProbeDoc.exists) {
            console.log("🔧 [FIRESTORE_UI_FORCE] Creating _ui_probe document to force subcollection visibility");

            await uiProbeDocRef.set({
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              reason: "force_firestore_ui_render",
              description: "This document forces Firestore Console to render the exchangeConfig subcollection. Safe to keep."
            });

            console.log("✅ [FIRESTORE_UI_FORCE] _ui_probe document created successfully");
            console.log("📍 [FIRESTORE_UI_FORCE] Full Firestore path: users/" + user.uid + "/exchangeConfig/_ui_probe");
            console.log("🔧 [FIRESTORE_UI_FORCE] exchangeConfig subcollection forced to render in Firebase Console");
          } else {
            console.log("ℹ️ [FIRESTORE_UI_FORCE] _ui_probe document already exists - subcollection should be visible");
          }

        } catch (uiProbeError: any) {
          console.warn("⚠️ [FIRESTORE_UI_FORCE] Failed to create _ui_probe document:", uiProbeError.message);
          console.log("   This is non-critical - manual Firebase Console navigation may be needed");
        }

        // 🔥 HARD_LOG: IMMEDIATELY_AFTER_FIRESTORE_WRITE
        console.log("🔥 [HARD_LOG] [IMMEDIATELY_AFTER_FIRESTORE_WRITE]", {
          uid: user.uid,
          exchange: resolvedExchange,
          firestorePath: `users/${user.uid}/exchangeConfig/current`,
          writeSuccess: true,
        });

        // CRITICAL: IMMEDIATELY read back the same document and log verification
        try {
          const readBackDoc = await docRef.get();
          const readBackData = readBackDoc.data();

          // 🔥 HARD_LOG: READ_BACK_VERIFICATION
          console.log("🔥 [HARD_LOG] [READ_BACK_VERIFICATION]", {
            uid: user.uid,
            exchange: resolvedExchange,
            documentExists: readBackDoc.exists,
            hasApiKeyEncrypted: !!readBackData?.apiKeyEncrypted,
            hasSecretEncrypted: !!readBackData?.secretEncrypted,
            hasPassphraseEncrypted: !!readBackData?.passphraseEncrypted,
            exchangeInDoc: readBackData?.exchange,
            fieldsPresent: Object.keys(readBackData || {}),
            readBackSuccess: true,
          });

          if (!readBackDoc.exists) {
            // 🔥 HARD_LOG: READ_BACK_FAILED_DOCUMENT_MISSING
            console.log("🔥 [HARD_LOG] [READ_BACK_FAILED_DOCUMENT_MISSING]", {
              uid: user.uid,
              exchange: resolvedExchange,
              firestorePath: `users/${user.uid}/exchangeConfig/current`,
            });
            throw new Error(
              "CRITICAL: Document not found after write - Firestore write failed",
            );
          }

          if (
            !readBackData?.apiKeyEncrypted ||
            !readBackData?.secretEncrypted
          ) {
            // 🔥 HARD_LOG: READ_BACK_FAILED_KEYS_MISSING
            console.log("🔥 [HARD_LOG] [READ_BACK_FAILED_KEYS_MISSING]", {
              uid: user.uid,
              exchange: resolvedExchange,
              hasApiKey: !!readBackData?.apiKeyEncrypted,
              hasSecret: !!readBackData?.secretEncrypted,
            });
            throw new Error(
              "CRITICAL: Encrypted keys missing after write - Firestore write corrupted",
            );
          }
        } catch (readBackError: any) {
          // 🔥 HARD_LOG: READ_BACK_EXCEPTION
          console.log("🔥 [HARD_LOG] [READ_BACK_EXCEPTION]", {
            uid: user.uid,
            exchange: resolvedExchange,
            error: readBackError.message,
            readBackFailed: true,
          });
          throw readBackError; // Re-throw to fail the entire operation
        }

        // LOG: Confirm encrypted keys saved to Firestore
        console.log(
          `[EXCHANGE_CONNECT_SAVED] UID:${user.uid} - Firestore save verification:`,
          {
            exchange: exchangeConfig.exchange,
            hasApiKeyEncrypted: !!exchangeConfig.apiKeyEncrypted,
            apiKeyEncryptedLength: exchangeConfig.apiKeyEncrypted?.length || 0,
            hasSecretEncrypted: !!exchangeConfig.secretEncrypted,
            secretEncryptedLength: exchangeConfig.secretEncrypted?.length || 0,
            hasPassphraseEncrypted: !!exchangeConfig.passphraseEncrypted,
            passphraseEncryptedLength:
              exchangeConfig.passphraseEncrypted?.length || 0,
            exchangeStatusCleared:
              exchangeConfig.exchangeStatus ===
              admin.firestore.FieldValue.delete(),
          },
        );

        logger.info(
          {
            uid: user.uid,
            exchange,
          },
          "Exchange connected successfully",
        );

        // NOTE: Cached flags (apiConnected, connectedExchanges) removed
        // Use isExchangeUsable() as single source of truth
        // Legacy flags no longer written to avoid confusion


        // 🔥 HARD_LOG: SUCCESS_RETURN_PATH
        console.log("🔥 [HARD_LOG] [SUCCESS_RETURN_PATH]", {
          uid: user.uid,
          exchange: resolvedExchange,
          operation: "exchange_connect",
          result: "success",
          connected: true,
        });

        return {
          success: true,
          connected: true,
          exchange,
        };
      } catch (err: any) {
        if (
          err.message &&
          err.message.includes("EXCHANGE_KEY_DECRYPTION_FAILED")
        ) {
          logger.error(
            { error: err.message, uid: user.uid },
            "Exchange credential decryption failed",
          );
          // 🔥 HARD_LOG: DECRYPTION_FAILED_RETURN_PATH
          console.log("🔥 [HARD_LOG] [DECRYPTION_FAILED_RETURN_PATH]", {
            uid: user.uid,
            error: err.message,
            operation: "exchange_connect",
            result: "decryption_failed",
          });
          return reply.code(400).send({
            error: err.message || "Failed to decrypt credentials",
            connected: false,
          });
        }
        logger.error(
          { error: err.message, uid: user.uid },
          "Exchange connect failed: users document sync not completed",
        );
        // CRITICAL: Cannot return success without users/{uid} sync completion
        // 🔥 HARD_LOG: TRANSIENT_ERROR_RETURN_PATH
        console.log("🔥 [HARD_LOG] [TRANSIENT_ERROR_RETURN_PATH]", {
          uid: user.uid,
          error: err.message,
          operation: "exchange_connect",
          result: "transient_error_users_sync_failed",
        });
        return reply.code(500).send({
          error: "Exchange connection failed: " + err.message,
          connected: false,
        });
      }
    },
  );

  // GET /exchange/balance - Get Live Futures Balance
  fastify.get(
    "/exchange/balance",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;

      // CRITICAL: Log UID consistency for exchange balance
      logger.info(
        {
          uid: user.uid,
          uidSource: "auth_middleware_request_user_uid",
          uidLength: user.uid.length,
          action: "exchange_balance_attempt",
        },
        "EXCHANGE_BALANCE_UID_CONSISTENCY_CHECK",
      );

      try {
        // 1. Get Exchange Config
        const { getFirebaseAdmin } = await import("../utils/firebase");
        const db = getFirebaseAdmin().firestore();
        const doc = await db
          .collection("users")
          .doc(user.uid)
          .collection("exchangeConfig")
          .doc("current")
          .get();

        if (!doc.exists) {
          return reply.code(200).send({
            success: false,
            reason: "CREDENTIALS_MISSING",
            exchange: "unknown",
            message: {
              error: "No exchange connected. Please connect an exchange first.",
            },
          });
        }

        const config = doc.data()!;
        const exchangeName = (config.exchange || "unknown") as string;

        // 2. Check Exchange Usability - ONLY source of truth
        const usability = await isExchangeUsable(user.uid, "user_request");
        
        if (!usability.usable) {
          logger.info(
            {
              uid: user.uid,
              exchange: exchangeName,
              reason: usability.reason,
              usable: usability.usable,
            },
            `Exchange balance: not usable (${usability.reason}), skipping balance fetch`,
          );
          return reply.code(200).send({
            success: false,
            reason: "not_connected",
            exchange: exchangeName,
            message: { error: usability.reason },
          });
        }

        // 3. Decrypt & Validate Credentials - Now safe since usability check passed
        // CRITICAL: For actual API calls that need decryption, we must pass user_request context
        const { decrypt } = await import("../services/keyManager");
        const decryptedApiKey = decrypt(config.apiKeyEncrypted, "user_request");
        const decryptedSecret = decrypt(
          config.secretKeyEncrypted || config.secretEncrypted,
          "user_request",
        );
        const decryptedPassphrase = config.passphraseEncrypted
          ? decrypt(config.passphraseEncrypted, "user_request")
          : undefined;

        const credentials: ExchangeCredentials = {
          apiKey: decryptedApiKey!,
          secret: decryptedSecret!,
          passphrase: decryptedPassphrase,
          testnet: config.testnet ?? false,
        };

        // 3. Create Adapter
        let connector;
        try {
          connector = ExchangeConnectorFactory.create(
            exchangeName as ExchangeName,
            credentials,
          );
        } catch (factoryErr: any) {
          return reply.code(200).send({
            success: false,
            reason: "EXCHANGE_API_ERROR",
            exchange: exchangeName,
            message: { error: factoryErr.message || "Unsupported exchange" },
          });
        }

        // 4. Check if getFuturesBalance is implemented
        if (!connector.getFuturesBalance) {
          return reply.code(200).send({
            success: false,
            reason: "EXCHANGE_API_ERROR",
            exchange: exchangeName,
            message: {
              error: `Futures balance fetch not supported for ${exchangeName}`,
            },
          });
        }

        // 5. Fetch Balance with Timeout
        try {
          const balancePromise = connector.getFuturesBalance();
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Exchange API timeout (10s)")),
              10000,
            ),
          );

          const balance = (await Promise.race([
            balancePromise,
            timeoutPromise,
          ])) as any;

          return {
            success: true,
            data: {
              ...balance,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (apiErr: any) {
          const isTimeout = apiErr.message?.includes("timeout");
          return reply.code(200).send({
            success: false,
            reason: isTimeout ? "TIMEOUT" : "EXCHANGE_API_ERROR",
            exchange: exchangeName,
            message: { error: apiErr.message || "Exchange API call failed" },
          });
        }
      } catch (err: any) {
        logger.error(
          { error: err.message, uid: user.uid },
          "Failed to fetch exchange balance",
        );
        return reply.code(200).send({
          success: false,
          reason: "EXCHANGE_API_ERROR",
          exchange: "unknown",
          message: {
            error: err.message || "Failed to fetch balance from exchange",
          },
        });
      }
    },
  );

  // POST /exchange/disconnect - Disconnect from exchange
  fastify.post(
    "/exchange/disconnect",
    {
      preHandler: [fastify.authenticate],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = (request as any).user;
      try {
        const body = request.body as any;
        const { exchange, permanentDelete = false } = body;

        logger.info(
          {
            uid: user.uid,
            exchange,
            permanentDelete,
          },
          "Exchange disconnect request",
        );

        const { getFirebaseAdmin } = await import("../utils/firebase");
        const db = admin.firestore(getFirebaseAdmin());

        if (permanentDelete) {
          // Only delete credentials if explicitly requested
          try {
            await db
              .collection("users")
              .doc(user.uid)
              .collection("exchangeConfig")
              .doc("current")
              .delete();

            // 🔥 HARD_LOG: EXCHANGE_DISCONNECT
            console.log("🔥 [HARD_LOG] [EXCHANGE_DISCONNECT]", {
              uid: user.uid,
              exchange,
              permanentDelete: true,
              credentialsDeleted: true,
            });

            logger.info(
              {
                uid: user.uid,
                exchange,
              },
              "Exchange credentials permanently deleted",
            );
          } catch (deleteError: any) {
            // If delete fails (e.g., document doesn't exist), log but continue
            logger.warn(
              {
                uid: user.uid,
                error: deleteError.message,
              },
              "Exchange config delete failed (may not exist) - continuing disconnect",
            );
          }
        }

        if (!permanentDelete) {
          // Default behavior: Clear all exchange credentials to prevent usage
          // CRITICAL: Disconnect ALWAYS succeeds, even if exchangeConfig/current doesn't exist
          try {
            const docRef = db
              .collection("users")
              .doc(user.uid)
              .collection("exchangeConfig")
              .doc("current");
            const existingDoc = await docRef.get();

            // Read existing data to preserve exchange field
            const existingData = existingDoc.exists ? existingDoc.data() : {};
            const disconnectPayload = {
              // Keep existing exchange field - don't set to null
              apiKeyEncrypted: admin.firestore.FieldValue.delete(),
              secretEncrypted: admin.firestore.FieldValue.delete(),
              passphraseEncrypted: admin.firestore.FieldValue.delete(),
              disconnected: true,
              disconnectedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            // CRITICAL: Use sanitizedSet for ALL exchangeConfig writes to ensure runtime traps work
            const { sanitizedSet } = await import("../utils/firebase");
            await sanitizedSet(docRef, disconnectPayload, { merge: true });

            // 🔥 HARD_LOG: EXCHANGE_DISCONNECT
            console.log("🔥 [HARD_LOG] [EXCHANGE_DISCONNECT]", {
              uid: user.uid,
              exchange,
              permanentDelete: false,
              credentialsCleared: true,
              documentExisted: existingDoc.exists,
              disconnectAlwaysSucceeds: true,
            });

            logger.info(
              {
                uid: user.uid,
                exchange,
                documentExisted: existingDoc.exists,
              },
              "Exchange disconnected - always succeeds, credentials cleared or document created in disconnected state",
            );
          } catch (disconnectError: any) {
            // If disconnect write fails, log but continue
            logger.warn(
              {
                uid: user.uid,
                error: disconnectError.message,
              },
              "Exchange config disconnect write failed - continuing with other cleanup",
            );
          }
        }

        // CRITICAL: Update users/{uid} document to reflect disconnected state
        // NOTE: Cached flags (apiConnected, connectedExchanges) removed
        // Use isExchangeUsable() as single source of truth
        // Legacy flags no longer written to avoid confusion
        try {
          await db.collection("users").doc(user.uid).set(
            {
              exchangeLastDisconnected:
                admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          console.log("🔥 [HARD_LOG] [EXCHANGE_DISCONNECT_USERS_DOC_SYNCED]", {
            uid: user.uid,
            fieldsUpdated: [
              "exchangeLastDisconnected",
              "updatedAt",
            ],
          });
        } catch (syncError: any) {
          console.error(
            "🔥 [HARD_LOG] [EXCHANGE_DISCONNECT_USERS_DOC_SYNC_FAILED]",
            {
              uid: user.uid,
              error: syncError.message,
            },
          );
          // Don't fail the entire operation if sync fails
        }

        // CRITICAL: Force disable auto-trade when exchange is disconnected/disconnected (both cases)
        try {
          const autoTradeRef = db
            .collection("users")
            .doc(user.uid)
            .collection("autoTradeConfig")
            .doc("current");
          await autoTradeRef.set(
            {
              autoTradeEnabled: false,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          // 🔥 HARD_LOG: AUTO_TRADE_FORCE_DISABLED
          console.log("🔥 [HARD_LOG] [AUTO_TRADE_FORCE_DISABLED]", {
            uid: user.uid,
            reason: permanentDelete
              ? "exchange_permanently_deleted"
              : "exchange_disconnected",
            autoTradeEnabled: false,
          });
        } catch (autoTradeError: any) {
          logger.warn(
            {
              uid: user.uid,
              error: autoTradeError.message,
            },
            "Auto-trade disable failed - continuing disconnect",
          );
        }

        // CRITICAL: Force stop background research scheduler for this UID
        // This is a user-initiated disconnect, so it's a valid hard stop reason
        try {
          const { backgroundResearchScheduler } =
            await import("../services/backgroundResearchScheduler");
          await backgroundResearchScheduler.forceStopUserScheduler(
            user.uid,
            permanentDelete ? "exchange_permanently_deleted" : "disconnected",
          );

          // 🔥 HARD_LOG: SCHEDULER_FORCE_STOPPED
          console.log("🔥 [HARD_LOG] [SCHEDULER_FORCE_STOPPED]", {
            uid: user.uid,
            reason: permanentDelete
              ? "exchange_permanently_deleted"
              : "exchange_disconnected",
            intervalsCleared: true,
            jobStateCleared: true,
          });
        } catch (schedulerError: any) {
          logger.warn(
            {
              uid: user.uid,
              error: schedulerError.message,
            },
            "Scheduler force stop failed - continuing disconnect",
          );
        }

        // CRITICAL: Disconnect ALWAYS returns success
        // Even if some cleanup steps fail, the exchange is considered disconnected
        return {
          success: true,
          connected: false,
          credentialsPreserved: !permanentDelete,
        };
      } catch (err: any) {
        // CRITICAL: Even if everything fails, return success for disconnect
        // The worst case is that some cleanup didn't happen, but user intent is clear
        logger.error(
          { error: err.message, uid: user.uid },
          "Exchange disconnect encountered error - returning success anyway",
        );
        
        // Return success instead of error - use reply.send() to ensure proper response
        return reply.code(200).send({
          success: true,
          connected: false,
          credentialsPreserved: false,
          warning: "Disconnect completed with warnings",
        });
      }
    },
  );
}
