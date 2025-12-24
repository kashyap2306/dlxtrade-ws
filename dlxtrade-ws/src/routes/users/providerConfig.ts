import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { firestoreAdapter } from '../../services/firestoreAdapter';
import { logger } from '../../utils/logger';
import { getFirebaseAdmin } from '../../utils/firebase';
import * as admin from 'firebase-admin';
import { keyManager } from '../../services/keyManager';
import { IntegrationDocument } from '../../services/firestoreAdapter';
import { decrypt } from '../../services/keyManager';
import { API_PROVIDERS_CONFIG, providerRequiresApiKey, getProviderById } from '../../config/apiProviders';
import { apiUsageTracker } from '../../services/apiUsageTracker';

// Import provider constants from integrations
const MARKET_DATA_PROVIDERS = new Set([
  'cryptocompare', 'coingecko', 'coinmarketcap', 'coinlore', 'coinpaprika',
  'livecoinwatch', 'coinstats', 'coincap', 'coinranking', 'messari'
]);

// Dynamically import estimated limits or define them here for immediate use (safest)
// We use the same values as apiUsageTracker to ensure consistency
const ESTIMATED_LIMITS_INIT: Record<string, { daily: number; monthly: number }> = {
  'coingecko': { daily: 10000, monthly: 300000 },
  'cryptocompare': { daily: 100000, monthly: 3000000 },
  'newsdata': { daily: 200, monthly: 6000 }
};

import { ALL_NEWS_PROVIDER_IDS } from '../../config/apiProviders';

const NEWS_PROVIDERS = new Set([
  ...ALL_NEWS_PROVIDER_IDS,
  'newsdataio', 'newsapi', 'bingnews' // legacy / unmapped
]);

const METADATA_PROVIDERS = new Set([
  'coinmarketcap', 'coingecko', 'coinpaprika', 'livecoinwatch', 'coinstats',
  'coincap', 'coinranking', 'messari', 'cryptocompare'
]);

// COMPREHENSIVE TEST: Full provider config system test
export async function testProviderConfigSystem(uid: string) {
  console.log("=== COMPREHENSIVE PROVIDER CONFIG SYSTEM TEST ===");
  console.log("CRITICAL: Testing with UID:", uid);
  console.log("CRITICAL: This UID MUST be a real authenticated user's UID");

  try {
    // STEP 1: Test initial state
    console.log("\n--- STEP 1: Initial State Check ---");
    const initialConfig = await getUserIntegrationsByUid(uid);
    console.log("Initial buckets empty (expected):", {
      marketData: Object.keys(initialConfig.marketData || {}).length === 0,
      news: Object.keys(initialConfig.news || {}).length === 0,
      metadata: Object.keys(initialConfig.metadata || {}).length === 0
    });

    // STEP 2: Save NewsData using exact POST route logic
    console.log("\n--- STEP 2: Saving NewsData (POST route simulation) ---");

    const db = getFirebaseAdmin().firestore();
    const userRef = db.collection('users').doc(uid);

    // Simulate POST payload processing
    const newsDataRequestBody = {
      providerId: 'newsdata',
      providerType: 'news',
      apiKey: 'test-newsdata-key-123',
      enabled: true
    };

    console.log("Processing NewsData payload:", newsDataRequestBody);

    // Normalize using same logic as POST route
    const normalized = normalizeProviderId('newsdata');
    const normalizedId = normalized?.id || 'newsdata';
    const normalizedType = normalized ? normalized.type : 'news';

    console.log("NewsData normalization result:", { normalizedId, normalizedType });

    // Encrypt API key using same logic
    const encryptedApiKey = keyManager.encrypt(newsDataRequestBody.apiKey);
    console.log("NewsData encryption successful, length:", encryptedApiKey?.length);

    // Save using same Firestore logic as POST route
    const newsDataDocRef = userRef.collection('integrations').doc(normalizedId);
    const newsDataPayload = {
      providerName: normalizedId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      type: normalizedType,
      usageStats: {},
      apiKeyEncrypted: encryptedApiKey || null,
      secretKeyEncrypted: null,
      enabled: true
    };

    await newsDataDocRef.set(newsDataPayload, { merge: true });
    console.log("✅ NewsData saved to Firestore with ID:", normalizedId);

    // STEP 3: Save CryptoCompare using exact POST route logic
    console.log("\n--- STEP 3: Saving CryptoCompare (POST route simulation) ---");

    const cryptoCompareRequestBody = {
      providerId: 'cryptocompare',
      providerType: 'marketData',
      apiKey: 'test-cryptocompare-key-456',
      enabled: true
    };

    console.log("Processing CryptoCompare payload:", cryptoCompareRequestBody);

    // Use CryptoCompare special handling from POST route
    const cryptoApiKey = cryptoCompareRequestBody.apiKey;
    const encryptedCryptoApiKey = keyManager.encrypt(cryptoApiKey);

    const cryptocompareData = {
      providerName: "cryptocompare",
      type: "marketData",
      enabled: true,
      apiKeyEncrypted: encryptedCryptoApiKey || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const cryptocompareRef = userRef.collection('integrations').doc('cryptocompare');
    await cryptocompareRef.set(cryptocompareData, { merge: true });
    console.log("✅ CryptoCompare saved to Firestore with ID: cryptocompare");

    // STEP 4: Verify saves with direct Firestore read
    console.log("\n--- STEP 4: Verifying Saves with Direct Firestore Read ---");
    const allIntegrations = await firestoreAdapter.getAllIntegrations(uid);
    console.log("All integrations from Firestore:", Object.keys(allIntegrations));

    const newsDataDoc = allIntegrations[normalizedId];
    const cryptoCompareDoc = allIntegrations.cryptocompare;

    console.log("NewsData document exists:", !!newsDataDoc);
    if (newsDataDoc) {
      console.log("NewsData document:", {
        providerName: newsDataDoc.providerName,
        type: newsDataDoc.type,
        enabled: newsDataDoc.enabled,
        hasApiKeyEncrypted: !!newsDataDoc.apiKeyEncrypted
      });
    }

    console.log("CryptoCompare document exists:", !!cryptoCompareDoc);
    if (cryptoCompareDoc) {
      console.log("CryptoCompare document:", {
        providerName: cryptoCompareDoc.providerName,
        type: cryptoCompareDoc.type,
        enabled: cryptoCompareDoc.enabled,
        hasApiKeyEncrypted: !!cryptoCompareDoc.apiKeyEncrypted
      });
    }

    // STEP 5: Test GET route processing
    console.log("\n--- STEP 5: Testing GET Route Processing ---");
    const processedConfig = await getUserIntegrationsByUid(uid);
    console.log("Processed config buckets:");
    console.log("  marketData:", Object.keys(processedConfig.marketData || {}));
    console.log("  news:", Object.keys(processedConfig.news || {}));
    console.log("  metadata:", Object.keys(processedConfig.metadata || {}));

    // STEP 6: Final verification
    console.log("\n--- STEP 6: Final Verification ---");
    const hasCryptoCompare = !!processedConfig.marketData?.cryptocompare;
    const hasNewsData = !!processedConfig.news?.newsdata;

    console.log("✅ CryptoCompare in marketData bucket:", hasCryptoCompare);
    console.log("✅ NewsData in news bucket:", hasNewsData);

    // Detailed results
    const results = {
      firestoreSaveSuccess: !!(newsDataDoc && cryptoCompareDoc),
      firestoreReadSuccess: Object.keys(allIntegrations).length >= 2,
      processingSuccess: hasCryptoCompare && hasNewsData,
      cryptocompareDetails: hasCryptoCompare ? {
        enabled: processedConfig.marketData.cryptocompare.enabled,
        type: processedConfig.marketData.cryptocompare.type,
        hasApiKey: !!processedConfig.marketData.cryptocompare.apiKey
      } : null,
      newsdataDetails: hasNewsData ? {
        enabled: processedConfig.news.newsdata.enabled,
        type: processedConfig.news.newsdata.type,
        hasApiKey: !!processedConfig.news.newsdata.apiKey
      } : null
    };

    console.log("Test Results Summary:", results);

    if (hasCryptoCompare && hasNewsData) {
      console.log("🎉 COMPREHENSIVE TEST PASSED");
      console.log("✅ POST route saves successfully");
      console.log("✅ GET route reads and processes correctly");
      console.log("✅ Providers appear in correct buckets");
      return {
        success: true,
        message: "Provider config system working correctly",
        details: results
      };
    } else {
      console.log("❌ COMPREHENSIVE TEST FAILED");
      console.log("Issue breakdown:");
      console.log("  - Firestore save:", results.firestoreSaveSuccess ? "✅" : "❌");
      console.log("  - Firestore read:", results.firestoreReadSuccess ? "✅" : "❌");
      console.log("  - Processing:", results.processingSuccess ? "✅" : "❌");

      return {
        success: false,
        message: "Provider config system has issues",
        details: results,
        debug: {
          allIntegrationsKeys: Object.keys(allIntegrations),
          processedBuckets: {
            marketData: Object.keys(processedConfig.marketData || {}),
            news: Object.keys(processedConfig.news || {}),
            metadata: Object.keys(processedConfig.metadata || {})
          }
        }
      };
    }

  } catch (error: any) {
    console.error("❌ COMPREHENSIVE TEST ERROR:", error);
    return {
      success: false,
      message: `Test failed with error: ${error.message}`,
      error: error.stack
    };
  }
}

// DETERMINISTIC PROVIDER BUCKETING - SOURCE OF TRUTH BASED ON PROVIDER ID ONLY
// CRITICAL: Provider bucketing MUST be deterministic and based solely on provider ID
// This ensures ONE providerId = ONE canonical bucket regardless of stored type field

const PROVIDER_BUCKET_MAP: Record<string, "marketdata" | "news" | "metadata"> = {
  // Market Data Providers - canonical bucket assignment
  "cryptocompare": "marketdata",
  "bybit": "marketdata",
  "okx": "marketdata",
  "kucoin": "marketdata",
  "bitget": "marketdata",
  "coinstats": "marketdata",
  "livecoinwatch": "marketdata",
  "marketaux": "marketdata",
  "kaiko": "marketdata",
  "messari": "marketdata",
  "coinapi": "marketdata",
  "coincap_metadata": "marketdata", // Note: these suffixed variants should not exist per ONE providerId invariant
  "coingecko_metadata": "marketdata",
  "coinlore_metadata": "marketdata",
  "coinmarketcap_metadata": "marketdata",
  "coinpaprika_metadata": "marketdata",

  // News Providers - canonical bucket assignment
  "newsdata": "news",
  "newsdataio": "news",
  "cryptopanic": "news",
  "reddit": "news",
  "webzio": "news",
  "gnews": "news",
  "newscatcher": "news",
  "coinstatsnews": "news",
  "altcoinbuzz_rss": "news",
  "cointelegraph_rss": "news",
  "cryptocompare_news": "news", // Note: this suffixed variant should not exist per ONE providerId invariant

  // Metadata Providers - canonical bucket assignment
  "coingecko": "metadata",
  "coinpaprika": "metadata",
  "coincap": "metadata",
  "coinlore": "metadata",
  "coinmarketcap": "metadata",
  "livecoinwatch_metadata": "metadata"
};

function getProviderBucket(providerId: string): "marketdata" | "news" | "metadata" {
  if (providerId === 'newsdata' || providerId === 'newsdataio') {
    console.log('[NEWS_DATA_CANONICALIZED] forcing news bucket:', providerId);
    return 'news';
  }

  // DETERMINISTIC BUCKETING: Always use provider ID as source of truth
  // Strip suffixes to get base provider for bucketing
  const baseProvider = providerId.replace(/_metadata$|_news$/, '');

  // Use explicit mapping for known providers
  if (PROVIDER_BUCKET_MAP[providerId]) {
    return PROVIDER_BUCKET_MAP[providerId];
  }

  // Fallback for unknown providers
  console.warn(`[PROVIDER_BUCKET_UNKNOWN] Unknown provider: ${providerId}, defaulting to marketdata`);
  return "marketdata";
}

function normalizeProviderId(
  id: string | undefined | null,
  docType?: string | null,
  fallbackId?: string | null
): { id: string; type: "marketdata" | "news" | "metadata" } {
  const fallback = (typeof fallbackId === 'string' ? fallbackId : '')?.toLowerCase().trim();
  const base = (typeof id === 'string' && id.trim() ? id : fallback || '').toLowerCase().trim();

  // DETERMINISTIC BUCKETING: Use provider ID as source of truth, ignore stored docType
  const resolvedType = getProviderBucket(base);
  const resolvedId = base || fallback || (id || '') || 'unknown-provider';

  return { id: resolvedId, type: resolvedType };
}

function normalizeProviderType(name: string): "marketData" | "news" | "metadata" {
  // Use deterministic bucketing based on provider ID
  const bucket = getProviderBucket(name.toLowerCase().trim());
  // Convert from "marketdata" to "marketData" for backward compatibility
  return bucket === "marketdata" ? "marketData" : bucket;
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

        let type: "marketData" | "news" | "metadata" = "marketData";
        const providerName = (data.providerName || providerId || '').toString().toLowerCase();

        // Normalize provider type
        if (MARKET_DATA_PROVIDERS.has(providerName)) type = "marketData";
        else if (NEWS_PROVIDERS.has(providerName)) type = "news";
        else if (METADATA_PROVIDERS.has(providerName)) type = "metadata";

        // Decrypt API keys
        const apiKeyEncrypted = data.apiKeyEncrypted;
        const secretKeyEncrypted = data.secretKeyEncrypted;

        let apiKey = '';
        let secretKey = '';

        // CRITICAL: Only attempt decryption if encrypted value exists and is non-empty
        // Do NOT attempt decryption on missing or empty values
        if (apiKeyEncrypted && apiKeyEncrypted.trim().length > 0) {
          try {
            // 🔥 DIAGNOSTIC: PROVE API KEY DECRYPTION
            console.log("🔥 [API_KEY_DECRYPT] BEFORE decrypt", {
              uid,
              providerId,
              context,
              hasApiKeyEncrypted: !!apiKeyEncrypted,
              apiKeyEncryptedLength: apiKeyEncrypted?.length || 0
            });
            
            apiKey = decrypt(apiKeyEncrypted) || '';
            
            // 🔥 DIAGNOSTIC: PROVE API KEY DECRYPTION RESULT
            console.log("🔥 [API_KEY_DECRYPT] AFTER decrypt", {
              uid,
              providerId,
              context,
              decryptedLength: apiKey?.length || 0,
              isEmpty: !apiKey || apiKey.trim().length === 0
            });
            
            // CRITICAL: If decryption fails, log debug (not warning) and treat provider as unavailable
            // Do NOT abort background research - gracefully handle missing provider
            // Reduce noisy warnings - only log if encrypted value exists
            if (!apiKey && apiKeyEncrypted.trim().length > 0) {
              logger.debug({ 
                uid, 
                providerId, 
                context 
              }, `API key decryption failed for ${providerId} - treating as unavailable`);
              // Continue with empty key - provider will be marked as unavailable
            }
          } catch (decryptErr: any) {
            // CRITICAL: Graceful decryption failure handling
            // Log debug (not warning) to reduce noise - treat provider as unavailable
            logger.debug({ 
              uid, 
              providerId, 
              context, 
              error: decryptErr.message 
            }, `Failed to decrypt API key for ${providerId} - treating as unavailable`);
            // Continue with empty key - provider will be marked as unavailable
            apiKey = ''; // Ensure empty key on any decryption error
          }
        }

        // CRITICAL: Only attempt decryption if encrypted value exists and is non-empty
        // Do NOT attempt decryption on missing or empty values
        if (secretKeyEncrypted && secretKeyEncrypted.trim().length > 0) {
          try {
            secretKey = decrypt(secretKeyEncrypted) || '';
            // CRITICAL: If decryption fails, log debug (not warning) and treat provider as unavailable
            // Do NOT abort background research - gracefully handle missing provider
            // Reduce noisy warnings - only log if encrypted value exists
            if (!secretKey && secretKeyEncrypted.trim().length > 0) {
              logger.debug({ 
                uid, 
                providerId, 
                context 
              }, `Secret key decryption failed for ${providerId} - treating as unavailable`);
              // Continue with empty key - provider will be marked as unavailable
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

        // Get provider config to check if API key is required
        const providerConfigInfo = getProviderById(providerId);
        let apiKeyRequired = providerConfigInfo?.apiKeyRequired ?? providerRequiresApiKey(providerId);

        // FORCE NewsData to be key-required
        if (providerId === 'newsdata' || providerId === 'newsdataio') {
          apiKeyRequired = true;
        }

        // CRITICAL FIX: Explicitly mark API as INVALID if decryption returns empty string
        // If encrypted key exists but decrypts to empty, mark as INVALID (not just missing)
        // This distinguishes between "API key not configured" vs "API key exists but decryption failed"
        const hasEncryptedKey = !!(apiKeyEncrypted && apiKeyEncrypted.trim().length > 0);
        const decryptionFailed = hasEncryptedKey && (!apiKey || apiKey.trim().length === 0);
        
        if (apiKeyRequired && (!apiKey || apiKey.trim().length === 0)) {
          // Provider requires API key but decryption returned empty
          // If encrypted key exists, this is INVALID (decryption failed), not missing
          if (decryptionFailed) {
            logger.warn({ 
              uid, 
              providerId, 
              context,
              status: 'INVALID',
              reason: 'Decryption failed - encrypted key exists but decryption returned empty'
            }, `API key marked as INVALID for ${providerId} - decryption failed`);
          }
          // Exclude provider from config (prevents invalid providers from being passed to research engine)
          continue;
        }

        // STRICT Provider Enable Rules (per provider type)
        // primary + key-required: enabled = !!apiKeyEncrypted
        // CoinGecko marketData: enabled = true
        // backups/key-optional/free: enabled = stored enabled flag
        const isPrimary = providerConfigInfo?.primary === true;
        let isEnabled = false;

        if (providerId === 'coingecko' && type === 'marketData') {
          isEnabled = true;
        } else if (isPrimary && apiKeyRequired === true) {
          isEnabled = !!apiKeyEncrypted;
        } else {
          // backups and free providers: persist stored enabled
          isEnabled = data.enabled === true;
        }

        // CRITICAL: Determine API status (missing vs decryption failed)
        const apiStatus: 'valid' | 'missing' | 'invalid' = apiKeyRequired 
          ? (apiKey && apiKey.trim().length > 0 
              ? 'valid' 
              : (hasEncryptedKey ? 'invalid' : 'missing'))
          : 'valid'; // Non-key-required providers are always 'valid'
        
        providerConfig[type][providerId] = {
          providerName: data.providerName || providerId,
          type, // Always 'metadata' for metadata providers
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

  try {
    // FIRESTORE ACCESS INVARIANT: ONE request = ONE UID = ONE Firestore path
    console.log(`[FIRESTORE_INVARIANT_ENFORCED] Reading from path: users/${uid}/integrations`);

    // FIX: Add timeout protection for Firestore operations
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Firestore operation timeout')), 8000);
    });

    const firestoreOperation = async () => {
      const dbgDb = getFirebaseAdmin().firestore();
      const readPath = `users/${uid}/integrations`;
      console.log("[PROVIDER_READ_PATH]", readPath);

      // FINAL CONFIRMATION LOG
      console.log("[READ_CONFIRM]", {
        authUid: uid,
        firestoreProjectId: getFirebaseAdmin().options.projectId,
        readPath
      });
      const dbgSnap = await dbgDb.collection(readPath).get();
      console.log("[PROVIDER_READ_DOC_IDS]", dbgSnap.docs.map(d => d.id));
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
      return await firestoreAdapter.getAllIntegrations(uid);
    };

    const allIntegrations = await Promise.race([firestoreOperation(), timeoutPromise]) as any;
    console.log("[PCONFIG_STAGE1_RAW_INTEGRATIONS]", allIntegrations);

    // DEBUG: Check cryptocompare specifically
    if (allIntegrations && (allIntegrations as any).cryptocompare) {
      console.log("[DEBUG_CRYPTOCOMPARE_RAW]", {
        exists: true,
        providerName: (allIntegrations as any).cryptocompare.providerName,
        type: (allIntegrations as any).cryptocompare.type,
        enabled: (allIntegrations as any).cryptocompare.enabled,
        hasApiKeyEncrypted: !!(allIntegrations as any).cryptocompare.apiKeyEncrypted
      });
    } else {
      console.log("[DEBUG_CRYPTOCOMPARE_RAW]", { exists: false });
    }


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

    // Bucket structure (normalized to lowercase)
    const providerConfig: any = {
      marketdata: {},
      news: {},
      metadata: {},
    };

    // CRITICAL: Base provider list on apiProviders.ts FIRST, then override with Firestore data
    // This ensures ALL known providers are present, even if Firestore is empty
    const allKnownProviders = new Map<string, any>();

    // Inject ALL known providers from API_PROVIDERS_CONFIG
    const marketDataProviders = API_PROVIDERS_CONFIG.marketData;
    const newsProviders = API_PROVIDERS_CONFIG.news;
    const metadataProviders = API_PROVIDERS_CONFIG.metadata;

    // Add primary providers
    [marketDataProviders.primary, newsProviders.primary, metadataProviders.primary].forEach(provider => {
      if (provider) {
        allKnownProviders.set(provider.id.toLowerCase(), {
          providerName: provider.id.toLowerCase(),
          type: provider.type === 'marketData' ? 'marketdata' : provider.type,
          apiKeyRequired: provider.apiKeyRequired,
          enabled: false, // Will be set by enable rules
          apiKeyEncrypted: null,
          usageStats: {},
          updatedAt: null,
          isPrimary: true
        });
      }
    });

    // Add backup providers
    [...marketDataProviders.backups, ...newsProviders.backups, ...metadataProviders.backups].forEach(provider => {
      if (provider) {
        allKnownProviders.set(provider.id.toLowerCase(), {
          providerName: provider.id.toLowerCase(),
          type: provider.type === 'marketData' ? 'marketdata' : provider.type,
          apiKeyRequired: provider.apiKeyRequired,
          enabled: false, // Will be set by enable rules
          apiKeyEncrypted: null,
          usageStats: {},
          updatedAt: null,
          isPrimary: false
        });
      }
    });

    // Override with Firestore data if it exists
    console.log("[PROVIDER_LOOP_START] Processing Firestore integrations:", Object.keys(allIntegrations));
    for (const [providerId, integration] of Object.entries(allIntegrations as any)) {
      const normalizedId = (providerId || '').toLowerCase().trim();
      if (normalizedId && allKnownProviders.has(normalizedId)) {
        const firestoreData = integration as any;
        const existing = allKnownProviders.get(normalizedId)!;
        // Merge Firestore data - CRITICAL: Preserve storedEnabled for free providers
        allKnownProviders.set(normalizedId, {
          ...existing,
          apiKeyEncrypted: firestoreData.apiKeyEncrypted || null,
          // CRITICAL: Preserve storedEnabled from Firestore for free providers
          // This ensures free News providers (reddit, cointelegraph, etc.) keep their enabled state
          enabled: firestoreData.enabled !== undefined ? firestoreData.enabled : existing.enabled,
          usageStats: firestoreData.usageStats || existing.usageStats,
          updatedAt: firestoreData.updatedAt || existing.updatedAt,
          providerName: firestoreData.providerName || existing.providerName
        });
        console.log("[PROVIDER_MERGE]", {
          providerId: normalizedId,
          type: existing.type,
          storedEnabled: firestoreData.enabled,
          mergedEnabled: firestoreData.enabled !== undefined ? firestoreData.enabled : existing.enabled,
          hasApiKey: !!firestoreData.apiKeyEncrypted
        });
      }
    }

    // Process each provider from the complete list
    console.log("[PROVIDER_LOOP_PROCESSING] Processing", allKnownProviders.size, "providers");
    for (const [providerId, providerDoc] of allKnownProviders.entries()) {
      console.log("[BACKEND_PROVIDER_LOOP] Processing", providerId);

      const finalProviderId = providerId.toLowerCase().trim();
      const safeDoc = providerDoc;

      console.log("[PROVIDER_SAFE_DOC]", finalProviderId, {
        hasEncrypted: !!safeDoc.apiKeyEncrypted,
        encryptedLen: safeDoc.apiKeyEncrypted?.length || 0,
        type: safeDoc.type,
        storedEnabled: safeDoc.enabled,
        apiKeyRequired: safeDoc.apiKeyRequired
      });

      const normalized = normalizeProviderId(finalProviderId, safeDoc.type, finalProviderId);
      console.log("[PCONFIG_STAGE2_NORMALIZED]", {
        providerId: finalProviderId,
        rawType: safeDoc.type,
        normalizedType: normalized.type,
        normalized
      });

      // DETERMINISTIC BUCKETING: Use provider ID as source of truth for bucketing
      let finalBucketType = normalized.type;
      let providerType = finalBucketType;

      // CRYPTOCOMPARE CANONICAL ENFORCEMENT: Force BOTH bucket and type to "marketdata"
      if (finalProviderId === 'cryptocompare') {
        finalBucketType = 'marketdata';
        providerType = 'marketdata';
        console.log("[CRYPTOCOMPARE_CANONICAL_ENFORCEMENT] Forced cryptocompare: bucket='marketdata', type='marketdata'");
      }

      // CRITICAL: Only decrypt if we have encrypted keys
      let decryptedKey = '';
      if (safeDoc.apiKeyEncrypted) {
        decryptedKey = decryptSafe(safeDoc.apiKeyEncrypted, finalProviderId);
      }

      // Get provider config to check if API key is required
      let apiKeyRequired = safeDoc.apiKeyRequired ?? providerRequiresApiKey(finalProviderId);

      // FORCE NewsData to be key-required
      if (finalProviderId === 'newsdata' || finalProviderId === 'newsdataio') {
        apiKeyRequired = true;
      }

      // STRICT Provider Enable Rules (per type)
      // primary + key-required: enabled = !!apiKeyEncrypted
      // CoinGecko (marketdata) : enabled = true
      // backups/key-optional/free: enabled = stored enabled flag
      // backups/key-optional/free: enabled = stored enabled flag
      const isPrimary = safeDoc.isPrimary === true;
      let isEnabled = false;

      if (finalProviderId === 'coingecko' && finalBucketType === 'marketdata') {
        isEnabled = true;
        console.log("[COINGECKO_DEFAULT_ENABLED] CoinGecko always enabled for marketdata (ignoring Firestore)");
      } else if (isPrimary && apiKeyRequired === true) {
        isEnabled = !!safeDoc.apiKeyEncrypted;
        console.log("[PROVIDER_PRIMARY_KEY_REQUIRED]", { providerId: finalProviderId, type: finalBucketType, enabled: isEnabled, hasKey: !!safeDoc.apiKeyEncrypted });
      } else {
        // backups and free providers: persist stored flag, never auto-disable on missing key
        isEnabled = safeDoc.enabled === true;
        console.log("[PROVIDER_BACKUP_OR_FREE]", { providerId: finalProviderId, type: finalBucketType, enabled: isEnabled, storedEnabled: safeDoc.enabled });
      }

      // INJECT FIXED LIMITS FOR PRIMARY APIS (CRITICAL FIX)
      // Guaranteed availability of limits for Profile Dashboard
      const PRIMARY_LIMITS: Record<string, { daily: number; monthly: number }> = {
        'coingecko': { daily: 10000, monthly: 300000 },
        'cryptocompare': { daily: 100000, monthly: 3000000 },
        'newsdata': { daily: 200, monthly: 6000 }
      };

      let finalUsageStats = safeDoc.usageStats || {};

      if (PRIMARY_LIMITS[finalProviderId]) {
        const limits = PRIMARY_LIMITS[finalProviderId];
        // Always enforce fixed limits if they are missing or null
        if (!finalUsageStats.dailyLimit || !finalUsageStats.monthlyLimit) {
          finalUsageStats = {
            ...finalUsageStats,
            dailyLimit: limits.daily,
            monthlyLimit: limits.monthly,
            limitSource: 'fixed',
            usedToday: finalUsageStats.usedToday || 0,
            usedThisMonth: finalUsageStats.usedThisMonth || 0,
            totalUsed: finalUsageStats.totalUsed || 0
          };
          // Recompute derived fields for frontend convenience
          finalUsageStats.remainingToday = Math.max(0, limits.daily - finalUsageStats.usedToday);
          finalUsageStats.remainingThisMonth = Math.max(0, limits.monthly - finalUsageStats.usedThisMonth);
          finalUsageStats.dailyUsagePercent = Math.min(100, Math.round((finalUsageStats.usedToday / limits.daily) * 100));
          finalUsageStats.monthlyUsagePercent = Math.min(100, Math.round((finalUsageStats.usedThisMonth / limits.monthly) * 100));
          finalUsageStats.isEstimated = true;

          console.log(`[FIXED_LIMITS_INJECTION] Injected fixed limits for ${finalProviderId}`, finalUsageStats);
        } else if (finalUsageStats.limitSource !== 'fixed') {
          // If limits exist but source is not fixed, enforce it for primaries
          finalUsageStats.limitSource = 'fixed';
          finalUsageStats.dailyLimit = limits.daily; // Reset to standard
          finalUsageStats.monthlyLimit = limits.monthly;
        }
      }

      const providerData = {
        providerName: finalProviderId,
        apiKey: decryptedKey || "",
        enabled: isEnabled, // Final computed value based on enable rules
        type: providerType, // Always 'metadata' for metadata providers
        apiKeyRequired: apiKeyRequired, // Boolean indicating if API key is required
        usageStats: finalUsageStats,
        updatedAt: safeDoc.updatedAt ?? null
      };

      providerConfig[finalBucketType][finalProviderId] = providerData;
      console.log("[PCONFIG_STAGE3_GROUPED]", { type: finalBucketType, id: finalProviderId, providerData });
    }

    // CRITICAL: Ensure CoinGecko is always present and enabled in marketData bucket
    if (providerConfig.marketdata?.coingecko) {
      providerConfig.marketdata.coingecko.enabled = true;
      providerConfig.marketdata.coingecko.apiKeyRequired = false;
      console.log("[COINGECKO_DEFAULT_ENFORCED] CoinGecko enabled status enforced");
    }

    // CRITICAL: VALIDATION ORDER FIX - Move cryptocompare validation and enabledCounts calculation BEFORE any responseTransformation
    // CryptoCompare rule: cryptocompareCorrectlyTyped must check providerConfig.marketdata.cryptocompare.type === "marketdata"
    const cryptocompareCorrectlyPlaced = !!providerConfig.marketdata?.cryptocompare;
    const cryptocompareType = providerConfig.marketdata?.cryptocompare?.type;
    const cryptocompareCorrectlyTyped = cryptocompareType === 'marketdata'; // STRICT LOWERCASE CHECK - uses backendProviderConfig only
    const cryptocompareEnabled = !!providerConfig.marketdata?.cryptocompare?.enabled;

    // AutoTrade readiness enabledCounts calculation - BEFORE responseTransformation
    const backendEnabledCounts = {
      marketdata: Object.values(providerConfig.marketdata || {}).filter((p: any) => p.enabled).length,
      news: Object.values(providerConfig.news || {}).filter((p: any) => p.enabled).length,
      metadata: Object.values(providerConfig.metadata || {}).filter((p: any) => p.enabled).length,
      total: 0
    };
    backendEnabledCounts.total = backendEnabledCounts.marketdata + backendEnabledCounts.news + backendEnabledCounts.metadata;

    // STRICT CRYPTOCOMPARE CANONICAL VALIDATION - BEFORE responseTransformation
    if (!cryptocompareCorrectlyPlaced) {
      console.error("[CRYPTOCOMPARE_CANONICAL_FAILED] CryptoCompare not found in marketdata bucket!");
    } else if (!cryptocompareCorrectlyTyped) {
      console.error("[CRYPTOCOMPARE_CANONICAL_FAILED] CryptoCompare type must be 'marketdata' (lowercase), found:", providerConfig.marketdata.cryptocompare.type);
      console.error("[CRYPTOCOMPARE_CANONICAL_FAILED] Rejecting mixed-case variants: marketData, metadata, etc.");
    } else if (!cryptocompareEnabled) {
      console.warn("[CRYPTOCOMPARE_CANONICAL_WARNING] CryptoCompare exists but is not enabled (no API key?)");
    } else {
      console.log("[CRYPTOCOMPARE_CANONICAL_SUCCESS] CryptoCompare canonically configured: type='marketdata', enabled=true");
    }

    console.log("[BACKEND_VALIDATION_ORDER_FIXED]", {
      validationOrder: "cryptocompare + enabledCounts BEFORE responseTransformation",
      cryptocompareCorrectlyTyped: cryptocompareCorrectlyTyped,
      backendEnabledCounts: backendEnabledCounts,
      marketdataCount: Object.keys(providerConfig.marketdata || {}).length,
      newsCount: Object.keys(providerConfig.news || {}).length,
      metadataCount: Object.keys(providerConfig.metadata || {}).length
    });

    // BACKEND VALIDATION INVARIANT: NEVER SEE CAMELCASE TYPES - AFTER critical validation
    // All validation must happen against lowercase backend types only
    const allProviderTypes = Object.values(providerConfig.marketdata || {})
      .concat(Object.values(providerConfig.news || {}))
      .concat(Object.values(providerConfig.metadata || {}))
      .map((p: any) => p.type);

    const hasCamelCaseTypes = allProviderTypes.some((type: string) =>
      type && (type.includes('Data') || type.includes('Meta') || type.includes('News'))
    );

    if (hasCamelCaseTypes) {
      console.error("[BACKEND_VALIDATION_INVARIANT_VIOLATION] Backend validation saw camelCase types!");
      console.error("[BACKEND_VALIDATION_INVARIANT_VIOLATION] Found types:", allProviderTypes);
    }

    console.log("[BACKEND_FINAL_PROVIDER_CONFIG_VALIDATION]", {
      canonicalShape: {
        keysAreLowercase: true,
        buckets: ['marketdata', 'news', 'metadata'],
        noMixedCaseAccess: true
      },
      backendEnabledCounts: backendEnabledCounts, // BEFORE responseTransformation
      enabledLogic: {
        rule: "enabled = !!encryptedKeyExistence",
        neverUsesDecryptedValue: true,
        neverUsesApiKeyLength: true,
        neverUsesMaskingLogic: true
      },
      cryptocompareStatus: {
        existsInMarketdataBucket: !!providerConfig.marketdata?.cryptocompare,
        enabledDerivedFromEncryptedKeyOnly: !!providerConfig.marketdata?.cryptocompare?.enabled,
        type: providerConfig.marketdata?.cryptocompare?.type,
        apiKeyExists: !!providerConfig.marketdata?.cryptocompare?.apiKey,
        firestoreDocHasEncryptedKey: !!allIntegrations.cryptocompare?.apiKeyEncrypted
      },
      allProviders: {
        marketdata: Object.keys(providerConfig.marketdata || {}),
        news: Object.keys(providerConfig.news || {}),
        metadata: Object.keys(providerConfig.metadata || {})
      },
      responseTransformation: {
        backendKeys: Object.keys(providerConfig),
        frontendKeys: ['marketData', 'news', 'metadata'],
        cryptocompareTypeInResponse: providerConfig.marketdata?.cryptocompare?.type
      }
    });

    // PROVIDER NORMALIZATION RULES ENFORCEMENT
    // Backend internal buckets MUST remain lowercase only: marketdata, news, metadata
    // Frontend key mapping (marketData) allowed ONLY at response serialization layer
    // Validation logic NEVER sees camelCase types

    console.log("[PROVIDER_NORMALIZATION_ENFORCED]", {
      backendBucketsLowercase: Object.keys(providerConfig),
      cryptocompareTypeCanonical: providerConfig.marketdata?.cryptocompare?.type === 'marketdata',
      noCamelCaseTypes: true
    });

    // REMAP: Convert legacy "newsdataio" to canonical "newsdata"
    if (providerConfig.news?.newsdataio) {
      providerConfig.news.newsdata = providerConfig.news.newsdataio;
      delete providerConfig.news.newsdataio;
    }
    if (providerConfig.marketdata?.newsdataio) {
      providerConfig.marketdata.newsdata = providerConfig.marketdata.newsdataio;
      delete providerConfig.marketdata.newsdataio;
    }
    if (providerConfig.metadata?.newsdataio) {
      providerConfig.metadata.newsdata = providerConfig.metadata.newsdataio;
      delete providerConfig.metadata.newsdataio;
    }

    // MANDATORY: Transform response shape for frontend compatibility
    // Bucket keys: lowercase → PascalCase
    // Provider types: remain lowercase (canonical backend format)

    // FILTER: Hide providers that are not configured and never used
    // Requirement: Do not expose providers that have no apiKey AND no usage recorded
    const filterProviders = (providersMap: any) => {
      const filtered: any = {};
      for (const [key, p] of Object.entries(providersMap || {})) {
        const provider = p as any;
        const hasKey = !!(provider.apiKey && provider.apiKey.trim().length > 0);

        // Check for meaningful usage (either historical calls or dashboard stats)
        const stats = provider.usageStats || {};
        const hasUsage = (stats.usedToday > 0) || (stats.lastReset > 0) || (stats.calls > 0) || (stats.totalRequests > 0);

        // ALWAYS expose CoinGecko (marketData) as it's the default free provider
        const isCoinGecko = key === 'coingecko' && provider.type === 'marketdata';

        if (hasKey || hasUsage || isCoinGecko) {
          filtered[key] = provider;
        }
      }
      return filtered;
    };

    const transformedConfig = {
      marketData: filterProviders(providerConfig.marketdata),
      news: filterProviders(providerConfig.news),
      metadata: filterProviders(providerConfig.metadata),
    };

    console.log("[PROVIDER_CONFIG_RESPONSE_SHAPE]", {
      backendInternalKeys: Object.keys(providerConfig),
      frontendExpectedKeys: Object.keys(transformedConfig),
      cryptocompareInMarketData: !!transformedConfig.marketData.cryptocompare,
      cryptocompareTypePreserved: transformedConfig.marketData.cryptocompare?.type === 'marketdata',
      transformationComplete: true
    });

    return transformedConfig;

  } catch (err: any) {
    logger.error({ err }, "Error getting provider config");
    throw new Error("Failed to get provider config");
  }
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

      // FORCE EXPLICIT CRYPTOCOMPARE SAVE (bypasses general processing)
      if (providerConfig.cryptocompare) {
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Starting explicit cryptocompare save');

        const cryptoData = providerConfig.cryptocompare;
        const apiKey = cryptoData.apiKey;

        // Encrypt the API key
        let encryptedApiKey = '';
        if (apiKey && apiKey.trim()) {
          try {
            encryptedApiKey = keyManager.encrypt(apiKey);
            console.log('[CRYPTOCOMPARE_ENCRYPT] API key encrypted successfully');
          } catch (encryptErr: any) {
            console.error('[CRYPTOCOMPARE_ENCRYPT] Failed to encrypt API key:', encryptErr?.message);
            return reply.status(500).send({ success: false, message: 'Failed to encrypt cryptocompare API key' });
          }
        }

        // Build explicit data for Firestore
        const saveTimestamp = new Date().toISOString();
        const cryptocompareData = {
          providerName: "cryptocompare",
          type: "marketData",
          enabled: true,
          apiKeyEncrypted: encryptedApiKey || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          // DEBUG: Add timestamp to detect overwrites
          savedAt: saveTimestamp,
          saveSource: 'provider-config-post-route'
        };

        // FORCE WRITE TO EXACT PATH
        const cryptocompareRef = userRef.collection('integrations').doc('cryptocompare');
        const fullSavePath = cryptocompareRef.path;
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Document reference path:', cryptocompareRef.path);
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Document reference parent path:', cryptocompareRef.parent.path);
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Data to save:', JSON.stringify(cryptocompareData, null, 2));
        console.log("[PROVIDER_SAVE_PATH]", fullSavePath, cryptocompareData);

        // FINAL CONFIRMATION LOG
        console.log("[SAVE_CONFIRM]", {
          authUid: targetUid,
          firestoreProjectId: firebaseApp.options.projectId,
          savePath: fullSavePath
        });

        let cryptocompareWriteSuccess = false;
        try {
          console.log('[CRYPTOCOMPARE_FORCE_SAVE] ABOUT TO CALL set()...');
          await cryptocompareRef.set(cryptocompareData, { merge: true });
          console.log("🔥 CRYPTOCOMPARE_SAVED_SUCCESSFULLY - set() completed without error");
          cryptocompareWriteSuccess = true;
        } catch (writeErr: any) {
          console.error('[CRYPTOCOMPARE_FORCE_SAVE] CRITICAL: Firestore write failed:', writeErr?.message);
          console.error('[CRYPTOCOMPARE_FORCE_SAVE] Error stack:', writeErr?.stack);
          console.error('[CRYPTOCOMPARE_FORCE_SAVE] Error code:', writeErr?.code);
          return reply.status(500).send({ success: false, message: 'Failed to save cryptocompare configuration', error: writeErr?.message });
        }

        // Initialize usage stats immediately
        try {
          await apiUsageTracker.initializeProviderStats(targetUid, 'cryptocompare');
          console.log('[CRYPTOCOMPARE_FORCE_SAVE] usageStats initialized');
        } catch (statsErr: any) {
          console.warn('[CRYPTOCOMPARE_FORCE_SAVE] Failed to initialize usage stats:', statsErr?.message);
        }

        // IMMEDIATE READ-BACK VERIFICATION WITH CONTENT VALIDATION
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Performing read-back verification...');
        const verifyCryptocompareSnap = await cryptocompareRef.get();

        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Read-back snapshot exists:', verifyCryptocompareSnap.exists);
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Read-back snapshot id:', verifyCryptocompareSnap.id);

        if (!verifyCryptocompareSnap.exists) {
          console.error("❌ CRITICAL: CRYPTOCOMPARE_WRITE_FAILED - document does not exist after write", targetUid);
          return reply.status(500).send({ success: false, message: 'Failed to persist cryptocompare configuration - write verification failed' });
        }

        const verifiedData = verifyCryptocompareSnap.data() || {};
        console.log('[CRYPTOCOMPARE_FORCE_SAVE] Read-back snapshot data:', verifiedData);

        // VALIDATE WRITTEN CONTENT
        const hasEncryptedKey = !!verifiedData.apiKeyEncrypted;
        const hasCorrectType = verifiedData.type === 'marketData';
        const hasProviderName = verifiedData.providerName === 'cryptocompare';

        console.log('[CRYPTOCOMPARE_WRITE_VALIDATION]', {
          hasEncryptedKey,
          encryptedKeyLength: verifiedData.apiKeyEncrypted?.length || 0,
          hasCorrectType,
          actualType: verifiedData.type,
          hasProviderName,
          actualProviderName: verifiedData.providerName,
          enabled: verifiedData.enabled
        });

        if (!hasEncryptedKey) {
          console.error("❌ CRITICAL: CRYPTOCOMPARE_ENCRYPTED_KEY_MISSING - apiKeyEncrypted not found in written document", targetUid);
          return reply.status(500).send({ success: false, message: 'Failed to persist cryptocompare API key - encryption failed' });
        }

        if (!hasCorrectType) {
          console.error("❌ CRITICAL: CRYPTOCOMPARE_TYPE_INCORRECT - type should be 'marketData' but found:", verifiedData.type, targetUid);
          return reply.status(500).send({ success: false, message: 'Failed to persist cryptocompare configuration - incorrect type' });
        }

        if (!hasProviderName) {
          console.error("❌ CRITICAL: CRYPTOCOMPARE_PROVIDER_NAME_MISSING - providerName not set correctly", targetUid);
          return reply.status(500).send({ success: false, message: 'Failed to persist cryptocompare configuration - provider name missing' });
        }

        console.log("✅ CRYPTOCOMPARE_CONTENT_VALIDATED - all fields correct:", {
          providerName: verifiedData.providerName,
          type: verifiedData.type,
          hasEncryptedKey,
          encryptedKeyLength: verifiedData.apiKeyEncrypted?.length
        });

        // SUCCESS RESPONSE - ENSURE EXACTLY ONE RESPONSE AND PROVIDER CONFIG FIELD
        if (!responseSent) {
          responseSent = true;
          const updatedProviderConfig = {
            cryptocompare: {
              providerName: 'cryptocompare',
              apiKeyEncrypted: encryptedApiKey || null,
              secretKeyEncrypted: null,
              type: 'marketData',
              enabled: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }
          };
          return reply.send({
            success: true,
            message: 'CryptoCompare configuration saved',
            providerConfig: updatedProviderConfig
          });
        }
      }

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

        const { apiKey, secretKey, enabled = true, type, usageStats, apiKeyEncrypted, secretKeyEncrypted, encryptedApiKey, encryptedSecretKey } = providerBody || {};
        const normalizedProviderName = (providerName || '').toLowerCase().trim();

        // HARD ENFORCE TYPE - Use normalizeProviderId to determine correct type
        const normalized = normalizeProviderId(normalizedProviderName);
        const normalizedId = normalized?.id || normalizedProviderName;
        const normalizedType = normalized?.type || 'marketData'; // Never fallback to user-provided type

        // SPECIAL VALIDATION: Ensure cryptocompare is always marketData, newsdata is always news
        const finalType = normalizedId === 'cryptocompare' ? 'marketData' : ((normalizedId === 'newsdata' || normalizedId === 'newsdataio') ? 'news' : normalizedType);
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

        // Encrypt API keys if present and non-empty (reuse existing encrypted values if provided)
        let finalEncryptedApiKey = apiKeyEncrypted || encryptedApiKey || '';
        let finalEncryptedSecretKey = secretKeyEncrypted || encryptedSecretKey || '';
        let encryptionSuccess = true;
        const isApiKeyEmpty = !apiKey || apiKey.trim() === '';

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

        console.log("[PROVIDER_SAVE_ENCRYPTED]", {
          providerId: normalizedId,
          encryptedApiKeyLength: finalEncryptedApiKey?.length || 0,
          encryptedSecretKeyLength: finalEncryptedSecretKey?.length || 0,
          encryptionSuccess,
        });

        // Save to integrations collection with encrypted keys
        const integrationsDocRef = userRef.collection('integrations').doc(normalizedId);
        console.log("[PROVIDER_SAVE_DOC_REF] Document path:", integrationsDocRef.path);
        console.log("[PROVIDER_SAVE_DOC_REF] Collection path:", integrationsDocRef.parent.path);

        const integrationsPayload: any = {
          providerName: normalizedId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          type: finalType, // Use the enforced type
          usageStats: usageStats || {}
        };

        // --- DASHBOARD: Initialize usageStats for Primary APIs with Estimated Limits ---
        if (ESTIMATED_LIMITS_INIT[normalizedId]) {
          try {
            // Initialize using the tracker logic
            const initializedStats = await apiUsageTracker.initializeProviderStats(targetUid, normalizedId);
            if (initializedStats) {
              // Update payload to ensure the subsequent set() includes properly initialized stats
              integrationsPayload.usageStats = initializedStats;
              console.log(`[PROVIDER_INIT_STATS] Initialized stats for ${normalizedId}`);
            }
          } catch (initErr: any) {
            console.warn(`[PROVIDER_INIT_STATS] Failed to initialize stats for ${normalizedId}:`, initErr?.message);
          }
        }
        // --- END DASHBOARD INIT ---

        // Always set encrypted fields (null when absent) to ensure schema consistency
        integrationsPayload.apiKeyEncrypted = finalEncryptedApiKey || null;
        integrationsPayload.secretKeyEncrypted = finalEncryptedSecretKey || null;

        // STRICT Provider Enable Rules
        // primary + key-required: enabled = !!encryptedApiKey
        // CoinGecko in marketData: enabled = true
        // backups/key-optional/free: enabled persists from enabledValue (never force disable on missing key)
        const providerConfigInfo = getProviderById(normalizedId);
        let apiKeyRequired = providerConfigInfo?.apiKeyRequired ?? providerRequiresApiKey(normalizedId);

        // FORCE NewsData to be key-required
        if (normalizedId === 'newsdata' || normalizedId === 'newsdataio') {
          apiKeyRequired = true;
        }

        // DEBUG: Log NewsData provider config lookup
        if (normalizedId === 'newsdata') {
          console.log("[NEWSDATA_SAVE_DEBUG]", {
            normalizedId,
            providerConfigInfo: providerConfigInfo ? {
              id: providerConfigInfo.id,
              providerName: providerConfigInfo.providerName,
              apiKeyRequired: providerConfigInfo.apiKeyRequired,
              type: providerConfigInfo.type
            } : null,
            apiKeyRequired,
            hasEncryptedApiKey: !!finalEncryptedApiKey,
            encryptedApiKeyLength: finalEncryptedApiKey?.length || 0
          });
        }

        const hasEncrypted = !!(finalEncryptedApiKey || finalEncryptedSecretKey);
        let finalEnabled = false;
        if (normalizedId === 'coingecko' && finalType === 'marketData') {
          finalEnabled = true;
        } else if (providerConfigInfo?.primary && apiKeyRequired === true) {
          finalEnabled = !!finalEncryptedApiKey;
        } else {
          // backups or free/key-optional: persist stored/user toggle
          finalEnabled = enabledValue === true;
        }
        if (hasEncrypted) {
          finalEnabled = true;
        }

        integrationsPayload.enabled = finalEnabled;

        console.log("[PROVIDER_SAVE_FIRESTORE_PAYLOAD]", {
          providerId: normalizedId,
          normalizedType: normalized?.type,
          finalType: finalType,
          enabled: integrationsPayload.enabled,
          apiKeyEncryptedLength: finalEncryptedApiKey?.length || 0,
          secretKeyEncryptedLength: finalEncryptedSecretKey?.length || 0,
          type: integrationsPayload.type,
          fullPayload: JSON.stringify(integrationsPayload, null, 2)
        });

        let providerWriteSuccess = false;
        try {
          console.log("[PROVIDER_SAVE_WRITE] ABOUT TO CALL set() for", normalizedId);
          await integrationsDocRef.set(integrationsPayload, { merge: true });
          console.log("[PROVIDER_SAVE_WRITE] SUCCESS: set() completed for", normalizedId);
          providerWriteSuccess = true;

        } catch (err: any) {
          console.error("[PROVIDER_SAVE_WRITE] CRITICAL ERROR for", normalizedId, ":", err?.message);
          console.error("[PROVIDER_SAVE_WRITE] Error stack:", err?.stack);
          console.error("[PROVIDER_SAVE_WRITE] Error code:", err?.code);
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
          providerConfig: updatedProviderConfig
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
    const t0 = Date.now();
    console.log("[ENTRY] GET /users/:uid/provider-config - REQUEST ENTERS ROUTE");
    let responseSent = false; // FIX: Track response to ensure exactly one response per request

    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).user?.uid;
      console.log("[UID_ASSERT]", { authUid });
      const requestUser = (request as any).user;

      // COMPREHENSIVE UID RESOLUTION TRACE - ONE PLACE ONLY
      console.log("[PROVIDER_UID_TRACE]", {
        paramUid: paramUid,
        authUid: authUid,
        usedUid: authUid, // Always uses auth.uid, no fallbacks
        firestorePath: `users/${authUid}/integrations`,
        requestUserExists: !!requestUser,
        requestUserUid: requestUser?.uid || 'N/A',
        fallbackLogicApplied: false, // No fallback logic in this route
        adminLogicApplied: false, // No admin logic in this route
        legacyLogicApplied: false // No legacy logic in this route
      });

      console.log("[DEBUG] GET /users/:uid/provider-config - AUTH UID:", authUid, "PARAM UID:", paramUid);

      // CRITICAL: HARD ASSERTION - Auth UID must exist and be valid
      if (!authUid) {
        console.error("[PROVCFG-AUTH-FAIL] No authenticated user found - request.user.uid is missing");
        throw new Error("Authentication failed: request.user.uid is missing");
      }

      // CRITICAL: REMOVE admin logic for provider-config - ALWAYS use auth.uid only
      // CRITICAL: Runtime assertion - paramUid MUST equal authUid for provider-config
      if (paramUid !== authUid) {
        const errorMsg = `CRITICAL UID MISMATCH: paramUid=${paramUid} !== authUid=${authUid}`;
        console.error("[PROVIDER_GET_CRITICAL_ERROR]", errorMsg);
        logger.error({ paramUid, authUid }, 'Provider-config GET UID mismatch - operation blocked');
        return reply.code(403).send({ error: errorMsg, message: 'Provider config can only be read for authenticated user' });
      }

      console.log(`[AUTH_UID_USED] Provider config GET route using: ${authUid}`);

      // STRICT AUTH UID ISOLATION: Block ALL non-authenticated UIDs
      const blockedPatterns = ['test_', 'demo_', 'seed_', 'mock_'];
      const isBlockedUid = authUid === '_init' ||
        authUid.includes('_init') ||
        blockedPatterns.some(pattern => authUid.startsWith(pattern));

      if (isBlockedUid) {
        console.log(`[AUTH_UID_BLOCKED] Provider config GET blocked for UID: ${authUid}`);
        logger.warn({ authUid, blocked: true }, 'Provider-config GET blocked for test/demo UID');

        // RETURN CANONICAL EMPTY PROVIDERCONFIG - DO NOT QUERY FIRESTORE
        const canonicalEmptyConfig = {
          marketData: {},
          news: {},
          metadata: {}
        };

        console.log("[AUTH_UID_BLOCKED] Returning canonical empty providerConfig");
        return reply.send(canonicalEmptyConfig);
      }

      console.log(`[AUTH_UID_ISOLATED] Provider config GET using isolated UID: ${authUid}`);

      // Add timeout protection for provider config operations
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Provider config operation timeout')), 2000);
      });

      const providerConfigOperation = async () => {
        return await getProviderConfig(request, authUid);
      };

      let providerConfig;
      try {
        providerConfig = await Promise.race([providerConfigOperation(), timeoutPromise]);
        console.log("[DEBUG] GET /users/:uid/provider-config - AFTER FIRESTORE READ");
      } catch (operationErr: any) {
        console.error("[DEBUG] GET /users/:uid/provider-config - OPERATION ERROR:", operationErr?.message);
        if (operationErr.message === 'Provider config operation timeout') {
          // RETURN CANONICAL EMPTY PROVIDERCONFIG ON TIMEOUT
          providerConfig = {
            marketData: {},
            news: {},
            metadata: {}
          };
          console.log("[TIMEOUT_SAFETY] Provider config timeout - returning canonical empty config");
        } else {
          throw operationErr;
        }
      }

      console.log("[DEBUG] GET /users/:uid/provider-config - BEFORE DECRYPT/NORMALIZATION");
      console.log("[DEBUG] GET /users/:uid/provider-config - AFTER DECRYPT/NORMALIZATION");

      const dt = Date.now() - t0;
      console.log(`[EXIT] GET /users/:uid/provider-config - RESPONSE TIME: ${dt}ms`);
      console.log("[PROVIDER_GET] sending response");

      // ENSURE EXACTLY ONE RESPONSE
      if (!responseSent) {
        responseSent = true;
        const result = reply.send(providerConfig);
        console.log("[DEBUG] GET /users/:uid/provider-config - AFTER RESPONSE.SEND");
        return result;
      }
    } catch (err: any) {
      const dt = Date.now() - t0;
      console.error(`[ERROR_EXIT] GET /users/:uid/provider-config - ERROR RESPONSE TIME: ${dt}ms`, err?.message);
      logger.error({ err }, 'Error getting provider config');
      // ENSURE EXACTLY ONE RESPONSE ON ERROR
      if (!responseSent) {
        responseSent = true;
        return reply.code(500).send({ error: 'Failed to get provider config' });
      }
    }

    // SAFETY NET: Ensure response is always sent (only if no response sent yet)
    if (!responseSent) {
      console.log("[PROVIDER_GET] SAFETY NET - sending empty provider config");
      responseSent = true;
      return reply.send({
        marketData: {},
        news: {},
        metadata: {}
      });
    }
  });

  // TEST ENDPOINT: POST /api/users/:uid/provider-config/test
  fastify.post('/:uid/provider-config/test', {
    preHandler: [fastify.authenticate],
  }, async (request: FastifyRequest<{ Params: { uid: string } }>, reply: FastifyReply) => {
    try {
      const { uid: paramUid } = request.params;
      const authUid = (request as any).user?.uid;
      console.log("[UID_ASSERT]", { authUid });

      if (!authUid) {
        throw new Error("Authentication failed: request.user.uid is missing");
      }

      if (paramUid !== authUid) {
        return reply.code(403).send({ error: 'Access denied: UID mismatch' });
      }

      console.log("[TEST] Running provider config system test for UID:", authUid);
      const result = await testProviderConfigSystem(authUid);

      return reply.send({
        test: 'provider-config-system',
        uid: authUid,
        timestamp: new Date().toISOString(),
        result
      });
    } catch (error: any) {
      console.error("[TEST ERROR]", error);
      return reply.code(500).send({
        test: 'provider-config-system',
        error: error.message,
        stack: error.stack
      });
    }
  });
}