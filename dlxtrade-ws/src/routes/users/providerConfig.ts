import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../../services/keyManager';
import { IntegrationDocument } from '../../services/firestoreAdapter';
import { decrypt } from '../../services/keyManager';
import { providerRequiresApiKey, getProviderById } from '../../config/apiProviders';
import { apiUsageTracker } from '../../services/apiUsageTracker';

// CRITICAL: Strict context definition to prevent "unknown" context errors
const CONTEXT_USER_REQUEST = "user_request";
const CONTEXT_BACKGROUND_JOB = "background_job";

/**
 * Sanitize Firestore payload by removing undefined values and converting them to FieldValue.delete()
 */
function sanitizeFirestorePayload(payload: any): any {
  const sanitized: any = {};
  let sanitizedCount = 0;

  // PHASE 1 RUNTIME TRACE: Log ALL sanitization operations
  const stack = new Error().stack;
  const callerFile = stack.split('\n')[2]?.includes('(')
    ? stack.split('\n')[2].split('(')[1]?.split(':')[0]?.replace(__dirname, '[PROJECT_ROOT]') || 'unknown'
    : 'unknown';

  console.log(`🔍 [RUNTIME_SANITIZE_TRACE] PROVIDER_CONFIG SANITIZE EXECUTION:`, {
    callerFile,
    inputPayload: payload,
    inputKeys: Object.keys(payload),
    exchangeValue: payload?.exchange,
    exchangeType: typeof payload?.exchange,
    timestamp: new Date().toISOString()
  });

  for (const [key, value] of Object.entries(payload)) {
    console.log(`🔍 [RUNTIME_SANITIZE_FIELD] PROVIDER_CONFIG Processing field "${key}":`, {
      value: value,
      valueType: typeof value,
      isUndefined: value === undefined,
      isNull: value === null,
      isEmptyString: value === '',
      callerFile,
      timestamp: new Date().toISOString()
    });

    // CRITICAL: Exchange field must never be undefined or empty - throw if invalid
    if (key === 'exchange') {
      if (!value || typeof value !== 'string' || value.trim() === '') {
        console.error(`🚫 [RUNTIME_SANITIZE_VIOLATION] PROVIDER_CONFIG Exchange field invalid during sanitization`);
        console.error(`   Value: ${String(value)} (type: ${typeof value})`);
        console.error(`   Payload:`, payload);
        console.error(`   Caller:`, callerFile);
        throw new Error(`Exchange field cannot be undefined/empty during sanitization: ${String(value)}`);
      }
      sanitized[key] = value;
      console.log(`✅ [RUNTIME_SANITIZE_EXCHANGE] PROVIDER_CONFIG Exchange field sanitized: "${value}"`);
    } else if (value === undefined) {
      sanitized[key] = admin.firestore.FieldValue.delete();
      console.log(`🔥 [RUNTIME_SANITIZE_DELETE] PROVIDER_CONFIG Field "${key}" converted to delete`);
      console.log('🔥 [HARD_LOG] [PROVIDER_FIELD_SANITIZED]', {
        field: key,
        action: 'CONVERTED_UNDEFINED_TO_DELETE'
      });
      sanitizedCount++;
    } else {
      sanitized[key] = value;
      console.log(`✅ [RUNTIME_SANITIZE_KEEP] PROVIDER_CONFIG Field "${key}" preserved: ${typeof value}`);
    }
  }

  console.log(`🔍 [RUNTIME_SANITIZE_COMPLETE] PROVIDER_CONFIG Sanitization finished:`, {
    outputKeys: Object.keys(sanitized),
    sanitizedCount,
    exchangeOutput: sanitized?.exchange,
    callerFile,
    timestamp: new Date().toISOString()
  });

  if (sanitizedCount > 0) {
    console.log('🔥 [HARD_LOG] [PAYLOAD_SANITIZED]', {
      sanitizedFields: sanitizedCount,
      totalFields: Object.keys(payload).length
    });
  }

  return sanitized;
}

// Extract provider config logic into a separate function for testing
// BACKGROUND SERVICE FUNCTION: Safe for schedulers/jobs - NO request context required
// CRITICAL: context parameter determines execution context for proper API key decryption
export async function getUserIntegrationsByUid(uid: string, context: 'user_request' | 'background_job' = 'background_job') {
  // CRITICAL: Assert UID is provided and valid
  if (!uid) {
    throw new Error("getUserIntegrationsByUid called with null/undefined uid");
  }
  console.log("[PROVIDER_CONFIG_UID_ASSERT]", { uid, context });

  // LOGGING GUARD: Log uid for background context
  console.log(`[BACKGROUND_PROVIDER_CONFIG_ENTRY] getUserIntegrationsByUid called with UID: ${uid}`);

  try {
    // FIRESTORE ACCESS INVARIANT: Background job context - isolated per user
    console.log(`[BACKGROUND_FIRESTORE_INVARIANT_ENFORCED] Reading from path: users/${uid}/integrations`);

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Firestore operation timeout')), 8000);
    });

    const firestoreOperation = async () => {
      const db = getFirebaseAdmin().firestore();
      const readPath = `users/${uid}/integrations`;
      console.log("[BACKGROUND_PROVIDER_READ_PATH]", readPath);

      // FINAL CONFIRMATION LOG
      console.log("[PROVIDER_CONFIG_READ_CONFIRM]", {
        uid,
        firestoreProjectId: getFirebaseAdmin().options.projectId,
        readPath,
        context
      });
      const snap = await db.collection(readPath).get();
      console.log("[BACKGROUND_PROVIDER_READ_DOC_IDS]", snap.docs.map(d => d.id));
      console.log("[BACKGROUND_INT DEBUG RESULT] snapshot size:", snap.size);
      if (snap.empty) {
        try {
          const cols = await db.collection('users').doc(uid).listCollections();
          console.log(`[BACKGROUND_COLLECTIONS_DEBUG] User ${uid} has collections:`, cols.map(c => c.id));
        } catch (colErr: any) {
          console.log("[BACKGROUND_COLLECTIONS_DEBUG_ERROR]", colErr.message);
        }
        return { marketData: {}, news: {}, metadata: {} };
      }

      const providerConfig: any = {
        marketData: {},
        news: {},
        metadata: {}
      };

      for (const doc of snap.docs) {
        const providerId = doc.id.toLowerCase();
        const data = doc.data() || {};

        // Get provider config to determine type and API key requirements
        const providerConfigInfo = getProviderById(providerId);
        let type: "marketData" | "news" | "metadata" = providerConfigInfo?.type || "marketData";
        let apiKeyRequired = providerConfigInfo?.apiKeyRequired ?? providerRequiresApiKey(providerId);

        // FORCE NewsData to be key-required
        if (providerId === 'newsdata' || providerId === 'newsdataio') {
          apiKeyRequired = true;
        }

        // Decrypt API keys ONLY if required
        const apiKeyEncrypted = data.apiKeyEncrypted;
        const secretKeyEncrypted = data.secretKeyEncrypted;

        // 🔥 HARD_LOG: PROVIDER_READ
        console.log('🔥 [HARD_LOG] [PROVIDER_READ]', {
          uid,
          providerId,
          context,
          hasApiKeyEncrypted: !!apiKeyEncrypted,
          apiKeyEncryptedLength: apiKeyEncrypted?.length || 0,
          hasSecretKeyEncrypted: !!secretKeyEncrypted,
          secretKeyEncryptedLength: secretKeyEncrypted?.length || 0,
          willAttemptDecrypt: context === 'user_request' && apiKeyRequired === true
        });

        let apiKey = '';
        let secretKey = '';

        // CRITICAL: Background jobs MUST NOT decrypt at all - skip BOTH apiKey AND secretKey decryption
        if (context === 'background_job') {
          // For background jobs: return both keys as empty strings always
          // Use encrypted presence only for enable logic
          apiKey = '';
          secretKey = '';
        } else {
          // CRITICAL: Only attempt decryption if:
          // 1. apiKeyRequired === true
          // 2. encrypted key exists AND is non-empty
          // NEVER decrypt for free/RSS/news providers
          if (apiKeyRequired === true && apiKeyEncrypted && apiKeyEncrypted.trim().length > 0) {
            try {
              // 🔥 DIAGNOSTIC: PROVE API KEY DECRYPTION
              console.log("🔥 [API_KEY_DECRYPT] BEFORE decrypt", {
                uid,
                providerId,
                context,
                hasApiKeyEncrypted: !!apiKeyEncrypted,
                apiKeyEncryptedLength: apiKeyEncrypted?.length || 0
              });


              // 🔥 CRITICAL FIX: Explicitly pass context constant
              apiKey = decrypt(apiKeyEncrypted, CONTEXT_USER_REQUEST) || '';

              // 🔥 DIAGNOSTIC: PROVE API KEY DECRYPTION RESULT
              console.log("🔥 [API_KEY_DECRYPT] AFTER decrypt", {
                uid,
                providerId,
                context, // Should be 'user_request' here
                usedContext: CONTEXT_USER_REQUEST,
                decryptedLength: apiKey?.length || 0,
                isEmpty: !apiKey || apiKey.trim().length === 0
              });

              // HARD ASSERTION: If decryption returns empty result, mark provider as INVALID
              if (!apiKey && apiKeyEncrypted.trim().length > 0) {
                console.log('🔥 [HARD_LOG] [PROVIDER_INVALIDATED]', {
                  uid,
                  providerId,
                  context,
                  reason: 'API_KEY_DECRYPT_RETURNED_EMPTY',
                  encryptedLength: apiKeyEncrypted.length,
                  decryptedLength: 0,
                  action: 'MARKED_INVALID'
                });
                // Continue with empty key - provider will be marked as invalid
              }
            } catch (decryptErr: any) {
              // CRITICAL: Decryption failure indicates corrupted encrypted key
              // Log as HARD_LOG and treat provider as INVALID (not just unavailable)
              console.log('🔥 [HARD_LOG] [DECRYPTION_FAILED]', {
                uid,
                providerId,
                context,
                error: decryptErr.message,
                apiKeyEncryptedLength: apiKeyEncrypted?.length || 0,
                action: 'TREAT_AS_INVALID'
              });

              logger.debug({
                uid,
                providerId,
                context,
                error: decryptErr.message
              }, `Failed to decrypt API key for ${providerId} - corrupted encrypted key, treating as invalid`);
              // Continue with empty key - provider will be marked as unavailable
              apiKey = ''; // Ensure empty key on any decryption error
            }
          }

          // CRITICAL: Only attempt decryption if encrypted value exists and is non-empty
          // Do NOT attempt decryption on missing or empty values
          if (secretKeyEncrypted && secretKeyEncrypted.trim().length > 0) {
            try {
              secretKey = decrypt(secretKeyEncrypted, CONTEXT_USER_REQUEST) || '';
              // HARD ASSERTION: If secret decryption returns empty result, mark provider as INVALID
              if (!secretKey && secretKeyEncrypted.trim().length > 0) {
                console.log('🔥 [HARD_LOG] [PROVIDER_INVALIDATED]', {
                  uid,
                  providerId,
                  context,
                  reason: 'SECRET_KEY_DECRYPT_RETURNED_EMPTY',
                  encryptedLength: secretKeyEncrypted.length,
                  decryptedLength: 0,
                  action: 'MARKED_INVALID'
                });
                // Continue with empty key - provider will be marked as invalid
              }
            } catch (decryptErr: any) {
              // CRITICAL: Graceful decryption failure handling
              // Log debug (not warning) to reduce noise - treat provider as unavailable
              logger.debug({
                uid,
                providerId,
                context,
                error: decryptErr.message
              }, `Failed to decrypt secret key for ${providerId} - treating as unavailable`);
              // Continue with empty key - provider will be marked as unavailable
              secretKey = ''; // Ensure empty key on any decryption error
            }
          }
        }

        // CRITICAL FIX: Explicitly mark API as INVALID if decryption returns empty string
        // If encrypted key exists but decrypts to empty, mark as INVALID (not just missing)
        // This distinguishes between "API key not configured" vs "API key exists but decryption failed"
        const hasEncryptedKey = !!(apiKeyEncrypted && apiKeyEncrypted.trim().length > 0);
        const decryptionFailed = hasEncryptedKey && (!apiKey || apiKey.trim().length === 0);

        // CRITICAL: Provider must stay in config - NEVER drop due to decrypt failure
        // Only mark as enabled=false and apiStatus='invalid'

        // STRICT Provider Enable Rules (SOURCE OF TRUTH)
        // enabled MUST depend ONLY on:
        // - presence of encrypted key (apiKeyEncrypted)
        // - OR stored enabled flag for free/backups
        // enabled must NEVER depend on decrypted value or decrypted key length
        let isEnabled = false;

        if (providerId === 'coingecko' && type === 'marketData') {
          isEnabled = true; // CoinGecko always enabled
        } else if (apiKeyRequired === true) {
          // Key-required providers: enabled if encrypted key exists
          isEnabled = !!apiKeyEncrypted;
        } else {
          // Free/backups/key-optional: use stored enabled flag
          isEnabled = data.enabled === true;
        }

        // CRITICAL: Determine API status (missing vs decryption failed)
        // For background jobs: we don't decrypt, so status based on encrypted presence only
        // For user requests: check decrypted key availability
        // For non-key-required providers: always 'valid' (no key needed)
        const apiStatus: 'valid' | 'missing' | 'invalid' = context === 'background_job'
          ? (apiKeyRequired ? (hasEncryptedKey ? 'valid' : 'missing') : 'valid')
          : (apiKeyRequired
            ? (apiKey && apiKey.trim().length > 0
              ? 'valid'
              : (hasEncryptedKey ? 'invalid' : 'missing'))
            : 'valid'); // Non-key-required providers are always 'valid'

        // apiStatus='invalid' is informational ONLY
        // enabled depends ONLY on encrypted key presence OR stored flag

        providerConfig[type][providerId] = {
          providerName: data.providerName || providerId,
          type, // Provider bucket remains deterministic (no type mutation)
          enabled: isEnabled, // Final computed value based on enable rules
          apiKeyRequired: apiKeyRequired, // Boolean indicating if API key is required
          apiKey,
          secretKey,
          apiStatus, // CRITICAL: Explicit status - 'valid', 'missing', or 'invalid' (decryption failed)
          updatedAt: data.updatedAt,
          usageStats: data.usageStats || {}
        };
      }

      // CRITICAL: Ensure CoinGecko is always present and enabled in marketData bucket
      if (providerConfig.marketData?.coingecko) {
        providerConfig.marketData.coingecko.enabled = true;
        providerConfig.marketData.coingecko.apiKeyRequired = false;
      }

      return providerConfig;
    };

    const result = await Promise.race([firestoreOperation(), timeoutPromise]);
    console.log("[PROVIDER_CONFIG_RESULT]", {
      uid,
      marketDataKeys: Object.keys(result.marketData || {}),
      newsKeys: Object.keys(result.news || {}),
      metadataKeys: Object.keys(result.metadata || {}),
      context
    });

    return result;
  } catch (err: any) {
    const errorTime = Date.now();
    console.error("[PROVIDER_CONFIG_ERROR]", {
      error: err.message,
      uid,
      context,
      stack: err.stack
    });
    logger.error({ err, uid }, 'Error getting user integrations for background job');
    throw err;
  }
}

// HTTP REQUEST CONTEXT FUNCTION: STRICTLY requires authenticated request context
export async function getProviderConfig(request: any, uid?: string) {
  // CRITICAL: MUST be called from HTTP request context
  if (!request || !request.user || !request.user.uid) {
    throw new Error("getProviderConfig() MUST be called from authenticated HTTP request context with request.user.uid");
  }

  const authUid = request.user.uid;
  const finalUid = uid || authUid;

  // CRITICAL: In HTTP context, UID must match authenticated user (unless admin override)
  if (finalUid !== authUid) {
    // Check if this is an admin request (allow admin to view other users)
    const isAdmin = await firestoreAdapter.isAdmin(authUid);
    if (!isAdmin) {
      throw new Error(`HTTP context violation: Cannot access UID ${finalUid} as user ${authUid} (not admin)`);
    }
    console.log("[ADMIN_UID_OVERRIDE]", { adminUid: authUid, targetUid: finalUid, context: "http_request_admin" });
  }

  // CRITICAL: Assert UID is provided and valid
  if (!finalUid) {
    throw new Error("getProviderConfig called with null/undefined uid");
  }
  console.log("[UID_ASSERT]", { authUid: finalUid, context: "http_request" });

  // LOGGING GUARD: Log auth.uid once at provider-config entry
  console.log(`[PROVIDER_CONFIG_ENTRY] getProviderConfig called with UID: ${finalUid}`);

  return getUserIntegrationsByUid(authUid, CONTEXT_USER_REQUEST);
}

export async function providerConfigRoutes(fastify: FastifyInstance) {
  console.log("🔥 PROVIDER-CONFIG HARD SAVE VERSION ACTIVE");
  // 🚨 PROVIDER-CONFIG ROUTE MOVED TO TOP - BEFORE ANY OTHER ROUTES
  // POST /api/users/:uid/provider-config - Save provider configuration
  fastify.post('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    console.log("🔥 BACKEND_POST_PROVIDER_CONFIG_HIT", request.body);
    let responseSent = false; // FIX: Track response to ensure exactly one response per request

    try {
      console.log("=== PROVIDER CONFIG SAVE START ===");

      const { uid: paramUid } = request.params;
      console.log("[UID-DEBUG] provider-config route called with uid =", paramUid);
      const authUid = (request as any).user?.uid;
      console.log("[UID_ASSERT]", { authUid });
      console.log("[PROVIDER_SAVE_UID] authUid:", authUid, "paramUid:", paramUid);

      // CRITICAL: HARD ASSERTION - Auth UID must exist and be valid
      if (!authUid) {
        console.error("AUTH ERROR: User token missing - request.user.uid is null");
        throw new Error("Authentication failed: request.user.uid is missing");
      }

      // CRITICAL: REMOVE admin logic for provider-config - ALWAYS use auth.uid only
      // Providers MUST ALWAYS be saved under the authenticated user's UID
      const targetUid = authUid;

      console.log("[PROVIDER_SAVE_TARGET] targetUid (auth.uid only):", targetUid);

      // CRITICAL: Runtime assertion - paramUid MUST equal authUid for provider-config
      if (paramUid !== authUid) {
        const errorMsg = `CRITICAL UID MISMATCH: paramUid=${paramUid} !== authUid=${authUid}`;
        console.error("[PROVIDER_SAVE_CRITICAL_ERROR]", errorMsg);
        logger.error({ paramUid, authUid }, 'Provider-config UID mismatch - operation blocked');
        return reply.code(403).send({ error: errorMsg, message: 'Provider config can only be saved for authenticated user' });
      }

      console.log(`[AUTH_UID_USED] Provider config POST route using: ${authUid}`);

      // CRITICAL: Reject ANY test/demo/_init UIDs - no exceptions
      if (targetUid.startsWith('test_') || targetUid.startsWith('demo_') || targetUid.includes('seed') ||
        targetUid.includes('mock') || targetUid === '_init' || targetUid.includes('_init')) {
        const errorMsg = `CRITICAL: Test/demo/_init UID rejected: ${targetUid}`;
        console.error("[PROVIDER_SAVE_CRITICAL_ERROR]", errorMsg);
        logger.error({ targetUid }, 'Provider-config test UID rejected');
        return reply.code(403).send({ error: errorMsg, message: 'Test/demo UIDs not allowed for provider config' });
      }

      const body = request.body as any;

      // Validate the provider config structure - accept BOTH legacy and flat formats
      const requestBody = request.body as any;
      if (!requestBody || typeof requestBody !== 'object') {
        logger.error({ body }, 'Invalid request body - not an object');
        return reply.status(400).send({ success: false, message: 'Invalid request body' });
      }

      // FIRST: Normalize payload - detect flat vs legacy and convert to consistent format
      let providerConfig: any;
      let payloadType = 'unknown';

      if (requestBody.providerId && requestBody.providerType) {
        // FLAT PAYLOAD (NEW): { providerId, providerType, apiKey, enabled }
        payloadType = 'flat';
        console.log('[PROVIDER_SAVE] payload=flat - normalizing to legacy format');

        // Normalize flat payload to legacy format internally
        providerConfig = {
          [requestBody.providerId]: {
            providerName: requestBody.providerId,
            apiKey: requestBody.apiKey,
            enabled: requestBody.enabled ?? true,
            type: requestBody.providerType
          }
        };
      } else if (requestBody.providerConfig) {
        // LEGACY PAYLOAD: { providerConfig: { ... } }
        payloadType = 'legacy';
        console.log('[PROVIDER_SAVE] payload=legacy - using as-is');
        providerConfig = requestBody.providerConfig;
      } else {
        // Neither format - invalid
        logger.error({ requestBody }, 'Invalid payload - missing providerId/providerType or providerConfig');
        return reply.status(400).send({ success: false, message: 'Invalid payload format - missing providerId/providerType or providerConfig' });
      }

      console.log('[PROVIDER_SAVE_FLOW] stage=normalized');

      // AFTER normalization, validate providerConfig
      if (!providerConfig || typeof providerConfig !== 'object') {
        logger.error({ providerConfig }, 'Invalid normalized providerConfig - not an object');
        return reply.status(400).send({ success: false, message: 'Invalid provider configuration' });
      }

      console.log('[PROVIDER_SAVE_FLOW] stage=validated');
      console.log("🔥 PROVIDER_SAVE_KEYS", Object.keys(providerConfig));
      const providerPreview = Object.entries(providerConfig || {}).slice(0, 2).map(([id, val]: any) => ({
        id,
        type: val?.type,
        enabled: val?.enabled,
        apiKeyLength: val?.apiKey?.length || 0
      }));
      console.log("[PROVIDER_SAVE_REQUEST_BODY]", {
        payloadType,
        providerCount: Object.keys(providerConfig || {}).length,
        preview: providerPreview
      });

      const db = getFirebaseAdmin().firestore();
      const firebaseApp = getFirebaseAdmin();
      console.log("[PROVIDER_SAVE_FIRESTORE_INIT] Firebase app projectId:", firebaseApp.options.projectId);
      console.log("[PROVIDER_SAVE_FIRESTORE_INIT] Firestore instance type:", typeof db);
      console.log("[PROVIDER_SAVE_FIRESTORE_INIT] Firestore constructor:", db.constructor.name);
      console.log("[PROVIDER_SAVE_FIRESTORE_INIT] FIRESTORE_EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST || "NOT SET");
      console.log("[PROVIDER_SAVE_FIRESTORE_INIT] Using emulator:", !!process.env.FIRESTORE_EMULATOR_HOST);

      // CRITICAL: Check if we're using emulator - this could explain silent failures
      if (process.env.FIRESTORE_EMULATOR_HOST) {
        console.error("[PROVIDER_SAVE_FIRESTORE_INIT] ⚠️  WARNING: Using Firestore EMULATOR - data will not persist!");
        console.error("[PROVIDER_SAVE_FIRESTORE_INIT] ⚠️  EMULATOR_HOST:", process.env.FIRESTORE_EMULATOR_HOST);
      } else {
        console.log("[PROVIDER_SAVE_FIRESTORE_INIT] ✅ Using REAL Firestore - data should persist");
      }

      const userRef = db.collection('users').doc(targetUid);
      console.log("[PROVIDER_SAVE_FIRESTORE] CRITICAL: Saving to path: users/" + targetUid + "/integrations");
      console.log("[PROVIDER_SAVE_FIRESTORE] This MUST be the real authenticated user's UID:", targetUid);
      console.log("[PROVIDER_SAVE_FIRESTORE] User document reference path:", userRef.path);


      // Process each provider in the config (supports single or multi-provider payloads)
      const flatProviderConfig: Record<string, any> = {};
      let processedCount = 0;
      let encryptedCount = 0;
      const processedProviders: string[] = [];

      for (const providerName of Object.keys(providerConfig)) {
        const providerBody = providerConfig[providerName];

        if (!providerName) {
          console.error("SYNC ERROR: Missing providerName");
          continue;
        }

        const { apiKey, secretKey, enabled = true, type, usageStats, apiKeyEncrypted, secretKeyEncrypted, encryptedApiKey, encryptedSecretKey } = providerBody || {};
        const normalizedProviderName = (providerName || '').toLowerCase().trim();

        console.log("[PROVIDER_SAVE_INPUT]", {
          providerName,
          normalizedProviderName,
          apiKeyLength: apiKey?.length || 0,
          secretKeyLength: secretKey?.length || 0,
        });

        // Validate apiKey is not an error message or invalid string
        if (apiKey && typeof apiKey === 'string') {
          if (apiKey.length > 200) {
            console.error(`❌ VALIDATION FAILED: apiKey for ${providerName} appears to be an error message (length: ${apiKey.length})`);
            continue; // Skip this provider
          }
          if (apiKey.includes('Fix DLXTRADE') || apiKey.includes('backend expects') || apiKey.includes('frontend is sending')) {
            console.error(`❌ VALIDATION FAILED: apiKey for ${providerName} contains error message text`);
            continue; // Skip this provider
          }
        }

        // Encrypt API keys if present and non-empty (reuse existing encrypted values if provided)
        let finalEncryptedApiKey = apiKeyEncrypted || encryptedApiKey || '';
        let finalEncryptedSecretKey = secretKeyEncrypted || encryptedSecretKey || '';
        let encryptionSuccess = true;
        const isApiKeyEmpty = !apiKey || apiKey.trim() === '';

        // 🔥 HARD_LOG: PROVIDER_SAVE
        console.log('🔥 [HARD_LOG] [PROVIDER_SAVE]', {
          uid: targetUid,
          providerId: normalizedProviderName,
          action: 'SAVE_PROVIDER',
          hasApiKeyEncrypted: !!finalEncryptedApiKey,
          apiKeyEncryptedLength: finalEncryptedApiKey?.length || 0,
          hasSecretKeyEncrypted: !!finalEncryptedSecretKey,
          secretKeyEncryptedLength: finalEncryptedSecretKey?.length || 0,
          willEncryptNew: (!finalEncryptedApiKey && !isApiKeyEmpty) || (!finalEncryptedSecretKey && secretKey && secretKey.trim() !== '')
        });

        try {
          if (!finalEncryptedApiKey && !isApiKeyEmpty) {
            finalEncryptedApiKey = keyManager.encrypt(apiKey);
            encryptedCount++;
          }

          if (!finalEncryptedSecretKey && secretKey && secretKey.trim() !== '') {
            finalEncryptedSecretKey = keyManager.encrypt(secretKey);
            encryptedCount++;
          }
        } catch (err: any) {
          console.error("ENCRYPT ERROR:", err);
          encryptionSuccess = false;
          // Continue with other providers but log the error
        }

        // HARD ASSERTION: Test decrypt immediately after encryption to ensure validity
        if (encryptionSuccess) {
          let testDecryptSuccess = true;
          let testApiKeyLength = 0;
          let testSecretKeyLength = 0;

          try {
            // Test decrypt apiKey if we just encrypted it
            if (finalEncryptedApiKey && !isApiKeyEmpty) {
              console.log(`🔍 [PROVIDER_TEST_DECRYPT] Testing API key decrypt:`, {
                encryptedLength: finalEncryptedApiKey.length,
                originalApiKey: apiKey.substring(0, 10) + '...',
                context: CONTEXT_USER_REQUEST
              });

              // CRITICAL FIX: Use constant to prevent "unknown" context
              const testApiKey = decrypt(finalEncryptedApiKey, CONTEXT_USER_REQUEST);
              testApiKeyLength = testApiKey?.length || 0;

              console.log(`🔍 [PROVIDER_TEST_DECRYPT] API key result:`, {
                decryptedLength: testApiKeyLength,
                matches: testApiKey === apiKey,
                decrypted: testApiKey?.substring(0, 10) + '...'
              });

              if (!testApiKey || testApiKey.trim().length === 0 || testApiKey !== apiKey) {
                console.error(`❌ [TEST_DECRYPT_FAILED_AFTER_ENCRYPT] API key mismatch:`, {
                  expected: apiKey.substring(0, 10) + '...',
                  got: testApiKey?.substring(0, 10) + '...' || 'null',
                  encrypted: finalEncryptedApiKey.substring(0, 20) + '...'
                });
                throw new Error('API key test decrypt failed');
              }
            }

            // Test decrypt secretKey if we just encrypted it
            if (finalEncryptedSecretKey && secretKey && secretKey.trim() !== '') {
              console.log(`🔍 [PROVIDER_TEST_DECRYPT] Testing secret key decrypt:`, {
                encryptedLength: finalEncryptedSecretKey.length,
                originalSecretKey: secretKey.substring(0, 10) + '...',
                context: CONTEXT_USER_REQUEST
              });

              // CRITICAL FIX: Use constant to prevent "unknown" context
              const testSecretKey = decrypt(finalEncryptedSecretKey, CONTEXT_USER_REQUEST);
              testSecretKeyLength = testSecretKey?.length || 0;

              console.log(`🔍 [PROVIDER_TEST_DECRYPT] Secret key result:`, {
                decryptedLength: testSecretKeyLength,
                matches: testSecretKey === secretKey,
                decrypted: testSecretKey?.substring(0, 10) + '...'
              });

              if (!testSecretKey || testSecretKey.trim().length === 0 || testSecretKey !== secretKey) {
                console.error(`❌ [TEST_DECRYPT_FAILED_AFTER_ENCRYPT] Secret key mismatch:`, {
                  expected: secretKey.substring(0, 10) + '...',
                  got: testSecretKey?.substring(0, 10) + '...' || 'null',
                  encrypted: finalEncryptedSecretKey.substring(0, 20) + '...'
                });
                throw new Error('Secret key test decrypt failed');
              }
            }
          } catch (testDecryptErr: any) {
            testDecryptSuccess = false;
            console.log('🔥 [HARD_LOG] [PROVIDER_SAVE_ABORTED_INVALID_ENCRYPTION]', {
              uid: targetUid,
              providerId: normalizedProviderName,
              action: 'SAVE_ABORTED',
              reason: 'TEST_DECRYPT_FAILED_AFTER_ENCRYPT',
              error: testDecryptErr.message,
              encryptedApiKeyLength: finalEncryptedApiKey?.length || 0,
              encryptedSecretKeyLength: finalEncryptedSecretKey?.length || 0,
              testApiKeyLength,
              testSecretKeyLength,
              aborted: true
            });
          }

          // FAIL LOUDLY if test decrypt fails - do not save corrupted encryption
          if (!testDecryptSuccess) {
            const errorMsg = `PROVIDER_ENCRYPTION_FAILED: ${normalizedProviderName} - encrypt/decrypt round-trip failed`;
            console.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg); // Throw to return 500 error instead of silent failure
          }
        }

        console.log("[PROVIDER_SAVE_ENCRYPTED]", {
          providerId: normalizedProviderName,
          encryptedApiKeyLength: finalEncryptedApiKey?.length || 0,
          encryptedSecretKeyLength: finalEncryptedSecretKey?.length || 0,
          encryptionSuccess,
        });

        // Save to integrations collection with encrypted keys
        const integrationsDocRef = userRef.collection('integrations').doc(normalizedProviderName);
        console.log("[PROVIDER_SAVE_DOC_REF] Document path:", integrationsDocRef.path);

        const integrationsPayload: any = {
          providerName: normalizedProviderName,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          type: type || 'marketData', // Store the provided type
          enabled: enabled, // Store the provided enabled state
          usageStats: usageStats || {},
          apiKeyEncrypted: finalEncryptedApiKey || null,
          secretKeyEncrypted: finalEncryptedSecretKey || null,
        };

        console.log("[PROVIDER_SAVE_FIRESTORE_PAYLOAD]", {
          providerId: normalizedProviderName,
          type: integrationsPayload.type,
          enabled: integrationsPayload.enabled,
          apiKeyEncryptedLength: finalEncryptedApiKey?.length || 0,
          secretKeyEncryptedLength: finalEncryptedSecretKey?.length || 0,
        });

        let providerWriteSuccess = false;
        try {
          console.log("[PROVIDER_SAVE_WRITE] ABOUT TO CALL set() for", normalizedProviderName);
          const sanitizedPayload = sanitizeFirestorePayload(integrationsPayload);
          await integrationsDocRef.set(sanitizedPayload, { merge: true });
          console.log("[PROVIDER_SAVE_WRITE] SUCCESS: set() completed for", normalizedProviderName);
          providerWriteSuccess = true;
        } catch (err: any) {
          console.error("[PROVIDER_SAVE_WRITE] CRITICAL ERROR for", normalizedProviderName, ":", err?.message);
          console.error("[PROVIDER_SAVE_WRITE] Error stack:", err?.stack);
          console.error("[PROVIDER_SAVE_WRITE] Error code:", err?.code);
          // Continue with other providers but log the error
        }

        // Accumulate provider config for response
        flatProviderConfig[normalizedProviderName] = {
          providerName: normalizedProviderName,
          apiKeyEncrypted: finalEncryptedApiKey || null,
          secretKeyEncrypted: finalEncryptedSecretKey || null,
          type: type || 'marketData',
          enabled: enabled,
          usageStats: usageStats || {},
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        processedProviders.push(providerName);
        processedCount++;
      }

      console.log("FINAL_FLAT_CONFIG_SAVED", flatProviderConfig);

      console.log(`PROVIDER CONFIG SAVE COMPLETE: processed=${processedCount}, encrypted=${encryptedCount}, providers=${processedProviders.join(',')}`);
      console.log('[PROVIDER_SAVE_FLOW] stage=saved');

      // CRITICAL: Only return success if we actually wrote to Firestore
      if (processedCount === 0) {
        console.error("[PROVIDER_SAVE_RESPONSE] CRITICAL: No providers were processed/written to Firestore");
        return reply.status(500).send({ success: false, message: 'No providers were saved to database' });
      }

      console.log("[PROVIDER_SAVE_RESPONSE] Successfully processed", processedCount, "providers");

      // CRITICAL: reply.send() MUST be the LAST operation - ENSURE EXACTLY ONE RESPONSE
      if (!responseSent) {
        responseSent = true;
        const responsePayload = {
          success: true,
          message: `Saved and synced ${processedCount} provider(s) to integrations`,
          processed: processedCount,
          encrypted: encryptedCount,
          providers: processedProviders,
          providerConfig: flatProviderConfig
        };
        reply.send(responsePayload);
      }

      // Log activity AFTER response is sent (won't affect response time)
      if (processedCount > 0) {
        firestoreAdapter.logActivity(targetUid, 'PROVIDER_CONFIG_UPDATED', {
          message: `Updated provider configurations: ${processedProviders.join(', ')}`,
          providers: processedProviders,
          encryptedKeysCount: encryptedCount
        }).catch(activityErr => {
          console.warn('[PROVIDER_SAVE] Activity logging failed:', activityErr?.message);
        });
      }

      return;

    } catch (err: any) {
      console.error("PROVIDER CONFIG SAVE ERROR:", err);
      logger.error({ err, uid: request.params.uid }, 'Error saving provider config & syncing to integrations');
      // ENSURE EXACTLY ONE RESPONSE ON ERROR
      if (!responseSent) {
        responseSent = true;
        return reply.status(500).send({ error: String(err), stack: err.stack });
      }
    }
  });

  // GET /api/users/:uid/provider-config - Get provider configuration
  fastify.get('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    const { uid: paramUid } = request.params;
    const authUid = (request as any).user?.uid;

    // CRITICAL: Runtime assertion - paramUid MUST equal authUid for provider-config
    if (paramUid !== authUid) {
      const errorMsg = `CRITICAL UID MISMATCH: paramUid=${paramUid} !== authUid=${authUid}`;
      console.error("[PROVIDER_GET_CRITICAL_ERROR]", errorMsg);
      logger.error({ paramUid, authUid }, 'Provider-config GET UID mismatch - operation blocked');
      return reply.code(403).send({ error: errorMsg, message: 'Provider config can only be read for authenticated user' });
    }

    return reply.send(await getUserIntegrationsByUid(authUid, CONTEXT_USER_REQUEST));
  });
} 