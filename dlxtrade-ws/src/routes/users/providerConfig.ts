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
    // Read all provider integration docs for this user
    const allIntegrations = await firestoreAdapter.getAllIntegrations(uid);
    console.log("[BACKEND_RAW_INTEGRATIONS]", allIntegrations);

    // Safe decrypt helper - returns empty string on any failure
    const decryptSafe = (value?: string): string => {
      if (!value) {
        console.log(`DECRYPT_DEBUG: No encrypted value provided`);
        return '';
      }
      try {
        const decrypted = keyManager.decrypt(value) || '';
        console.log(`DECRYPT_DEBUG: Attempting to decrypt value of length ${value.length}`);
        console.log(`DECRYPT_DEBUG: Decryption result length: ${decrypted.length}, starts with: ${decrypted.substring(0, 10)}...`);
        return decrypted;
      } catch (err: any) {
        console.error("DECRYPT_ERROR", err);
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

      const normalized = normalizeProviderId(providerKey, safeDoc.type, providerId);

      // CRITICAL: Only decrypt if we have encrypted keys - never fallback to plain text
      let decryptedKey = '';
      console.log("[DECRYPT_ATTEMPT]", providerKey, safeDoc.apiKeyEncrypted?.length);
      if (safeDoc.apiKeyEncrypted) {
        decryptedKey = decryptSafe(safeDoc.apiKeyEncrypted);
      } else if (safeDoc.apiKey) {
        // If no encrypted version exists, try to decrypt the plain text key
        // This handles legacy data that might not be encrypted
        decryptedKey = decryptSafe(safeDoc.apiKey);
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
    }

    console.log("BACKEND_FINAL_PROVIDER_CONFIG", JSON.stringify(providerConfig, null, 2));
    console.log("BACKEND_PROVIDER_CONFIG_FINAL", JSON.stringify(providerConfig, null, 2));
    console.log("[BACKEND_PROVIDER_FINAL]", providerConfig);

    return providerConfig;

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

      const { uid } = request.params;
      const authUid = (request as any).user?.uid;
      const urlUid = request.params.uid;

      // Auth check: ensure user is authenticated
      if (!authUid) {
        console.error("AUTH ERROR: User token missing - request.user is null");
        return reply.status(401).send({ error: "Unauthorized: user token missing" });
      }

      const user = (request as any).user;

      // Auth check: user can only update their own config unless they're admin
      const isAdmin = await firestoreAdapter.isAdmin(authUid);
      if (uid !== authUid && !isAdmin) {
        logger.warn({ authUid, urlUid }, 'Access denied: user can only update their own provider config');
        return reply.code(403).send({ success: false, message: 'Forbidden' });
      }

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

      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);

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
        const normalizedType = normalized ? normalized.type : type || 'marketData';
        const enabledValue = enabled ?? true;

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

        try {
          if (!apiKey || apiKey.trim() === '') {
            console.log("SKIPPING EMPTY PROVIDER:", providerName);
            continue;
          }
          if (apiKey && apiKey.trim() !== '') {
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

        // Save to integrations collection with encrypted keys
        const integrationsDocRef = userRef.collection('integrations').doc(normalizedProviderName);
        const integrationsPayload: any = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          type: normalizedType,
          usageStats: usageStats || {}
        };

        // Only set encrypted keys if encryption succeeded
        if (encryptedApiKey) {
          integrationsPayload.apiKeyEncrypted = encryptedApiKey;
        }
        if (encryptedSecretKey) {
          integrationsPayload.secretKeyEncrypted = encryptedSecretKey;
        }

        // Set enabled only if there's an encrypted key present
        const hasEncryptedKey = !!encryptedApiKey || !!encryptedSecretKey;
        integrationsPayload.enabled = hasEncryptedKey ? enabledValue : false;

        try {
          await integrationsDocRef.set(integrationsPayload, { merge: true });
        } catch (err: any) {
          console.error("FIRESTORE SAVE ERROR:", err);
          // Continue with other providers but log the error
        }

        // Accumulate provider config for response
        flatProviderConfig[normalizedProviderName] = {
          providerName: normalizedProviderName,
          apiKeyEncrypted: encryptedApiKey,
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
        await firestoreAdapter.logActivity(uid, 'PROVIDER_CONFIG_UPDATED', {
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
    try {
      const { uid } = request.params;
      const user = (request as any).user;

      // Users can only view their own config unless they're admin
      // Skip auth check if auth is disabled (for testing)
      let isAdmin = false;
      if (user && user.uid) {
        isAdmin = await firestoreAdapter.isAdmin(user.uid);
        if (uid !== user.uid && !isAdmin) {
          return reply.code(403).send({ error: 'Access denied' });
        }
      }

      // Use the centralized getProviderConfig function
      const providerConfig = await getProviderConfig(uid);

      console.log("FINAL_PROVIDER_CONFIG", providerConfig);

      return reply.send(providerConfig);
    } catch (err: any) {
      logger.error({ err }, 'Error getting provider config');
      return reply.code(500).send({ error: 'Failed to get provider config' });
    }
  });
}