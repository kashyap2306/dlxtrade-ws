import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../../services/keyManager';
import { IntegrationDocument } from '../../services/firestoreAdapter';

// REQUIRED HARD MAPPING - STRICT PROVIDER TYPE NORMALIZATION
const MARKET_DATA_PROVIDERS = new Set([
  "cryptocompare", "bybit", "okx", "kucoin", "bitget", "coinstats",
  "livecoinwatch", "marketaux", "kaiko", "messari", "coinapi"
]);

const NEWS_PROVIDERS = new Set([
  "newsdata", "cryptopanic", "reddit", "webzio",
  "gnews", "newscatcher", "coinstatsnews",
  "altcoinbuzz_rss", "cointelegraph_rss"
]);

const METADATA_PROVIDERS = new Set([
  "coingecko", "coinpaprika", "coincap", "coinlore",
  "coinmarketcap", "livecoinwatch"
]);

function normalizeProviderId(
  id: string | undefined | null,
  docType?: string | null,
  fallbackId?: string | null
): { id: string; type: "marketData" | "news" | "metadata" } {
  const fallback = (typeof fallbackId === 'string' ? fallbackId : '')?.toLowerCase().trim();
  const base = (typeof id === 'string' && id.trim() ? id : fallback || '').toLowerCase().trim();
  const lower = base;

  let cleanId = lower;
  if (lower.endsWith("_metadata")) {
    cleanId = lower.replace("_metadata", "");
  } else if (lower.endsWith("_news")) {
    cleanId = lower.replace("_news", "");
  }

  const hasMarket = MARKET_DATA_PROVIDERS.has(cleanId);
  const hasNews = NEWS_PROVIDERS.has(cleanId);
  const hasMetadata = METADATA_PROVIDERS.has(cleanId);

  const resolvedType = (() => {
    if (hasMarket) return "marketData";
    if (hasNews) return "news";
    if (hasMetadata) return "metadata";
    if (docType === "marketData" || docType === "news" || docType === "metadata") {
      return docType;
    }
    return "marketData";
  })();

  const resolvedId = cleanId || lower || fallback || (id || '') || 'unknown-provider';

  return { id: resolvedId, type: resolvedType };
}

function normalizeProviderType(name: string): "marketData" | "news" | "metadata" {
  const normalizedName = name.toLowerCase().trim();
  if (MARKET_DATA_PROVIDERS.has(normalizedName)) return "marketData";
  if (NEWS_PROVIDERS.has(normalizedName)) return "news";
  if (METADATA_PROVIDERS.has(normalizedName)) return "metadata";
  console.warn("UNKNOWN PROVIDER:", normalizedName, "- DEFAULTING TO metadata");
  return "metadata";
}

// Extract provider config logic into a separate function for testing
export async function getProviderConfig(uid: string) {
  try {
    const dbgDb = getFirebaseAdmin().firestore();
    console.log("[INT DEBUG] Attempt path:", `users/${uid}/integrations`);
    const dbgSnap = await dbgDb.collection(`users/${uid}/integrations`).get();
    console.log("[INT DEBUG RESULT] snapshot size:", dbgSnap.size);
    if (dbgSnap.empty) {
      try {
        const cols = await dbgDb.collection('users').doc(uid).listCollections();
        console.log("[INT DEBUG DOCS] Subcollections:", cols.map((c) => c.id));
      } catch (err: any) {
        console.log("[INT DEBUG DOCS] Failed to list subcollections:", err?.message);
      }
    }
    // Read all provider integration docs for this user
    const allIntegrations = await firestoreAdapter.getAllIntegrations(uid);
    console.log("[PCONFIG_STAGE1_RAW_INTEGRATIONS]", allIntegrations);
    console.log("[PROVCFG-FIRESTORE-COUNT]", uid, Object.keys(allIntegrations || {}).length, allIntegrations ? Object.keys(allIntegrations).slice(0,20) : []);
    console.log("[BACKEND_RAW_INTEGRATIONS]", allIntegrations);
    const rawPreview = Object.entries(allIntegrations || {}).slice(0, 2).map(([id, data]: any) => ({
      id,
      type: data?.type,
      enabled: data?.enabled,
      apiKeyEncryptedLength: data?.apiKeyEncrypted?.length || 0
    }));
    console.log("[BACKEND_INTEGRATIONS_PREVIEW]", rawPreview);
    console.log("[BACKEND_INTEGRATIONS_COUNTS]", {
      marketData: Object.values(allIntegrations || {}).filter((p: any) => p?.type === 'marketData').length,
      news: Object.values(allIntegrations || {}).filter((p: any) => p?.type === 'news').length,
      metadata: Object.values(allIntegrations || {}).filter((p: any) => p?.type === 'metadata').length,
    });

    // Safe decrypt helper - returns empty string on any failure
    const decryptSafe = (value?: string, providerId?: string): string => {
      if (!value) {
        console.log(`DECRYPT_DEBUG: No encrypted value provided for ${providerId || 'unknown'}`);
        return '';
      }
      try {
        const decrypted = keyManager.decrypt(value) || '';
        console.log(`DECRYPT_DEBUG: Attempting to decrypt value of length ${value.length} for ${providerId || 'unknown'}`);
        console.log(`DECRYPT_DEBUG: Decryption result length: ${decrypted.length}, starts with: ${decrypted.substring(0, 10)}...`);
        return decrypted;
      } catch (err: any) {
        console.error("[PROVCFG-DECRYPT-ERR]", providerId || 'unknown', String(err));
        return '';
      }
    };

    // Bucket structure (must not change)
    const providerConfig: any = {
      marketData: {},
      news: {},
      metadata: {},
    };

    // Process each provider and bucket them correctly
    for (const [providerId, integration] of Object.entries(allIntegrations)) {
      console.log("[BACKEND_PROVIDER_LOOP] Processing", providerId);
      const d = integration as any;
      const safeDoc: any = d && typeof d === 'object' ? d : {};
      const rawName = typeof safeDoc.providerName === 'string' && safeDoc.providerName.trim()
        ? safeDoc.providerName
        : (typeof providerId === 'string' ? providerId : '');
      const providerKey = (rawName || '').toLowerCase().trim();
      console.log("[PROVIDER_SAFE_DOC]", providerKey, {
        hasEncrypted: !!safeDoc.apiKeyEncrypted,
        encryptedLen: safeDoc.apiKeyEncrypted?.length || 0,
        hasPlain: !!safeDoc.apiKey,
        type: safeDoc.type,
        enabled: safeDoc.enabled
      });

      const normalized = normalizeProviderId(providerKey, safeDoc.type, providerId);
      console.log("[PCONFIG_STAGE2_NORMALIZED]", { providerId, normalized });

      // CRITICAL: Only decrypt if we have encrypted keys - never fallback to plain text
      let decryptedKey = '';
      console.log("[DECRYPT_ATTEMPT]", providerKey, safeDoc.apiKeyEncrypted?.length);
      if (safeDoc.apiKeyEncrypted) {
        decryptedKey = decryptSafe(safeDoc.apiKeyEncrypted, providerKey);
      }
      console.log("[DECRYPT_RESULT]", providerKey, decryptedKey ? "non-empty" : "EMPTY");
      console.log("FINAL_KEY", providerKey, decryptedKey.length);

      const providerData = {
        providerName: normalized.id,
        apiKey: decryptedKey || "",
        enabled: decryptedKey.length > 0,
        type: normalized.type,
        usageStats: safeDoc.usageStats || {},
        updatedAt: safeDoc.updatedAt ?? null
      };

      providerConfig[normalized.type][normalized.id] = providerData;
      console.log("[PCONFIG_STAGE3_GROUPED]", { type: normalized.type, id: normalized.id, providerData });
    }

    const finalConfig = providerConfig;
    console.log("[PCONFIG_STAGE4_FINAL]", finalConfig);
    console.log("BACKEND_FINAL_PROVIDER_CONFIG", JSON.stringify(finalConfig, null, 2));
    console.log("BACKEND_PROVIDER_CONFIG_FINAL", JSON.stringify(finalConfig, null, 2));
    console.log("[BACKEND_PROVIDER_FINAL]", finalConfig);

    return finalConfig;

  } catch (err: any) {
    logger.error({ err }, "Error getting provider config");
    throw new Error("Failed to get provider config");
  }
}

export async function providerConfigRoutes(fastify: FastifyInstance) {
  // 🚨 PROVIDER-CONFIG ROUTE MOVED TO TOP - BEFORE ANY OTHER ROUTES
  // POST /api/users/:uid/provider-config - Save provider configuration
  fastify.post('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string }; Body: any }>, reply: FastifyReply) => {
    try {
      console.log("=== PROVIDER CONFIG SAVE START ===");

      const { uid: paramUid } = request.params;
      console.log("[UID-DEBUG] provider-config route called with uid =", paramUid);
      console.log("[UID-DEBUG] Firestore path = users/" + paramUid + "/integrations");
      const authUid = (request as any).userId;
      const urlUid = paramUid;

      // Auth check: ensure user is authenticated
      if (!authUid) {
        console.error("AUTH ERROR: User token missing - request.user is null");
        return reply.status(401).send({ error: "Unauthorized: user token missing" });
      }

      // Auth check: user can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (paramUid !== authUid && !isAdmin) {
        logger.warn({ authUid, urlUid }, 'Access denied: user can only update their own provider config');
        return reply.code(403).send({ success: false, message: 'Forbidden' });
      }

      const targetUid = isAdmin ? paramUid : authUid;

      const body = request.body as any;

      // Validate the provider config structure
      const requestBody = request.body as any;
      if (!requestBody || typeof requestBody !== 'object') {
        logger.error({ body }, 'Invalid request body - not an object');
        return reply.status(400).send({ success: false, message: 'Invalid request body' });
      }

      const providerConfig = requestBody.providerConfig;
      if (!providerConfig || typeof providerConfig !== 'object') {
        logger.error({ providerConfig }, 'Invalid providerConfig - not an object');
        return reply.status(400).send({ success: false, message: 'providerConfig required' });
      }
    const providerPreview = Object.entries(providerConfig || {}).slice(0, 2).map(([id, val]: any) => ({
      id,
      type: val?.type,
      enabled: val?.enabled,
      apiKeyLength: val?.apiKey?.length || 0
    }));
    console.log("[PROVIDER_SAVE_REQUEST_BODY]", {
      providerCount: Object.keys(providerConfig || {}).length,
      preview: providerPreview
    });

      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(targetUid);

      // Process each provider in the config (supports single or multi-provider payloads)
      const flatProviderConfig: Record<string, any> = {};
      let processedCount = 0;
      let encryptedCount = 0;
      const processedProviders: string[] = [];
      let updatedProviderConfig: any = {};

      for (const providerName of Object.keys(providerConfig)) {
        const providerBody = providerConfig[providerName];

        if (!providerName) {
          console.error("SYNC ERROR: Missing providerName");
          continue;
        }

        const { apiKey, secretKey, enabled = true, type, usageStats } = providerBody || {};
        const normalizedProviderName = (providerName || '').toLowerCase().trim();

        // Use the normalizeProviderId function to determine correct type
        const normalized = normalizeProviderId(normalizedProviderName);
        const normalizedId = normalized?.id || normalizedProviderName;
        const normalizedType = normalized ? normalized.type : type || 'marketData';
        const enabledValue = enabled ?? true;

        console.log("[PROVIDER_SAVE_INPUT]", {
          providerName,
          normalizedId,
          normalizedType,
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

        // Encrypt API keys if present and non-empty
        let encryptedApiKey = '';
        let encryptedSecretKey = '';
        let encryptionSuccess = true;
        const isApiKeyEmpty = !apiKey || apiKey.trim() === '';

        try {
          if (!isApiKeyEmpty) {
            encryptedApiKey = keyManager.encrypt(apiKey);
            encryptedCount++;
          }

          if (secretKey && secretKey.trim() !== '') {
            encryptedSecretKey = keyManager.encrypt(secretKey);
            encryptedCount++;
          }
        } catch (err: any) {
          console.error("ENCRYPT ERROR:", err);
          encryptionSuccess = false;
          // Continue with other providers but log the error
        }

        console.log("[PROVIDER_SAVE_ENCRYPTED]", {
          providerId: normalizedId,
          encryptedApiKeyLength: encryptedApiKey?.length || 0,
          encryptedSecretKeyLength: encryptedSecretKey?.length || 0,
          encryptionSuccess,
        });

        // Save to integrations collection with encrypted keys
        const integrationsDocRef = userRef.collection('integrations').doc(normalizedId);
        const integrationsPayload: any = {
          providerName: normalizedId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          type: normalizedType,
          usageStats: usageStats || {}
        };

        // Always set encrypted fields (null when absent) to ensure schema consistency
        integrationsPayload.apiKeyEncrypted = encryptedApiKey || null;
        integrationsPayload.secretKeyEncrypted = encryptedSecretKey || null;

        // Set enabled only if there's an encrypted key present
        const hasEncryptedKey = !!encryptedApiKey || !!encryptedSecretKey;
        integrationsPayload.enabled = hasEncryptedKey ? enabledValue : false;
        console.log("[PROVIDER_SAVE_FIRESTORE_PAYLOAD]", {
          providerId: normalizedId,
          enabled: integrationsPayload.enabled,
          apiKeyEncryptedLength: encryptedApiKey?.length || 0,
          secretKeyEncryptedLength: encryptedSecretKey?.length || 0,
          type: integrationsPayload.type
        });

        try {
          await integrationsDocRef.set(integrationsPayload, { merge: true });
        } catch (err: any) {
          console.error("FIRESTORE SAVE ERROR:", err);
          // Continue with other providers but log the error
        }

        // Fetch back to confirm fields exist
        try {
          const savedSnap = await integrationsDocRef.get();
          const savedData = savedSnap.data() || {};
          if (!savedData.apiKeyEncrypted || savedData.apiKeyEncrypted === '') {
            logger.warn({ providerId: normalizedId }, 'Post-save missing apiKeyEncrypted; defaulting to null');
          }
          if (!savedData.secretKeyEncrypted) {
            logger.debug({ providerId: normalizedId }, 'Post-save missing secretKeyEncrypted (may be expected)');
          }
          console.log("[PROVIDER_SAVE_VERIFIED]", {
            providerId: normalizedId,
            hasApiKeyEncrypted: !!savedData.apiKeyEncrypted,
            hasSecretKeyEncrypted: !!savedData.secretKeyEncrypted,
            enabled: savedData.enabled,
            type: savedData.type,
          });
        } catch (verifyErr: any) {
          logger.warn({ providerId: normalizedId, error: verifyErr?.message }, 'Failed to verify integration after save');
        }

        // Accumulate provider config for response
        flatProviderConfig[normalizedId] = {
          providerName: normalizedId,
          apiKeyEncrypted: encryptedApiKey || null,
          secretKeyEncrypted: encryptedSecretKey || null,
          type: normalizedType,
          enabled: integrationsPayload.enabled,
          usageStats: usageStats || {},
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        processedProviders.push(providerName);
        processedCount++;
      }

      // Return the processed provider config
      updatedProviderConfig = flatProviderConfig;
      console.log("FINAL_FLAT_CONFIG_SAVED", flatProviderConfig);

      console.log(`PROVIDER CONFIG SAVE COMPLETE: processed=${processedCount}, encrypted=${encryptedCount}, providers=${processedProviders.join(',')}`);

      // Log activity for audit trail
      if (processedCount > 0) {
        await firestoreAdapter.logActivity(targetUid, 'PROVIDER_CONFIG_UPDATED', {
          message: `Updated provider configurations: ${processedProviders.join(', ')}`,
          providers: processedProviders,
          encryptedKeysCount: encryptedCount
        });
      }

      return reply.send({
        success: true,
        message: `Saved and synced ${processedCount} provider(s) to integrations`,
        processed: processedCount,
        encrypted: encryptedCount,
        providers: processedProviders,
        providerConfig: updatedProviderConfig
      });

    } catch (err: any) {
      console.error("PROVIDER CONFIG SAVE ERROR:", err);
      logger.error({ err, uid: request.params.uid }, 'Error saving provider config & syncing to integrations');
      return reply.status(500).send({ error: String(err), stack: err.stack });
    }
  });

  // GET /api/users/:uid/provider-config - Get provider configuration
  fastify.get('/:uid/provider-config', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    console.log("[PROVCFG] GET handler hit for uid =", request.params.uid);
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).userId;
      console.log("[PROVCFG-INCOMING] reqId:", request.id || 'no-reqid', "authUid:", authUid || 'no-auth-uid', "paramUid:", paramUid);
      console.log("[UID-DEBUG] provider-config route called with uid =", paramUid);
      console.log("[UID-DEBUG] Firestore path = users/" + paramUid + "/integrations");

      // STRICT AUTH CHECK: Param UID must match authenticated user UID
      if (!authUid) {
        console.error("[PROVCFG-AUTH-FAIL] No authenticated user found");
        return reply.code(401).send({ error: 'Authentication required' });
      }
      if (paramUid !== authUid) {
        console.error("[PROVCFG-AUTH-FAIL] UID mismatch - param:", paramUid, "auth:", authUid);
        return reply.code(403).send({ error: 'Access denied: UID mismatch' });
      }

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      let isAdmin = false;
      if (authUid) {
        isAdmin = await firestoreAdapter.isAdmin(authUid);
      }
      if (paramUid !== authUid && !isAdmin) {
        return reply.code(403).send({ error: 'Access denied' });
      }

      // Use the centralized getProviderConfig function
      const providerConfig = await getProviderConfig(paramUid);

      console.log("[PROVCFG-RESPONSE]", paramUid, JSON.stringify(providerConfig, null, 2));

      return reply.send(providerConfig);
    } catch (err: any) {
      logger.error({ err }, 'Error getting provider config');
      return reply.code(500).send({ error: 'Failed to get provider config' });
    }
  });
}