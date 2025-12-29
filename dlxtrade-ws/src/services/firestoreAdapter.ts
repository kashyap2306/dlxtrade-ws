import * as admin from 'firebase-admin';
import { getFirebaseAdmin } from '../utils/firebase';
import { logger } from '../utils/logger';
import { encrypt } from './keyManager';

const db = () => getFirebaseAdmin().firestore();

/**
 * Sanitize Firestore payload by removing undefined values and converting them to FieldValue.delete()
 */
function sanitizeFirestorePayload(payload: any): any {
  const sanitized: any = {};
  let sanitizedCount = 0;

  // WRITE-ONCE exchange fields: NEVER convert undefined to FieldValue.delete()
  const writeOnceExchangeFields = [
    'exchangeStatus',
    'keysClearedAt',
    'keysClearedReason'
  ];

  for (const [key, value] of Object.entries(payload)) {
    // PROTECTED: Skip WRITE-ONCE exchange fields if undefined
    if (writeOnceExchangeFields.includes(key) && value === undefined) {
      // SKIP: Do not include in sanitized payload
      console.log('🔥 [HARD_LOG] [WRITE_ONCE_FIELD_PROTECTED]', {
        field: key,
        action: 'SKIPPED_UNDEFINED_FIELD'
      });
      continue;
    }

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

// WARN when non-canonical exchange config paths are accessed
export function warnNonCanonicalExchangeConfigAccess(uid: string, accessedPath: string, context: string): void {
  const canonicalPath = `users/${uid}/exchangeConfig/current`;
  if (accessedPath !== canonicalPath) {
    logger.warn({
      uid,
      accessedPath,
      canonicalPath,
      context,
      warning: 'NON_CANONICAL_EXCHANGE_CONFIG_ACCESS'
    }, `⚠️ NON_CANONICAL_EXCHANGE_CONFIG_ACCESS: ${context} accessed ${accessedPath} instead of ${canonicalPath}`);
  }
}

// CRITICAL: Write guard for exchange config - ONLY canonical path allowed
export function assertExchangeConfigWritePath(uid: string, attemptedPath: string): void {
  const canonicalPath = `users/${uid}/exchangeConfig/current`;

  if (attemptedPath !== canonicalPath) {
    logger.error({
      uid,
      attemptedPath,
      canonicalPath,
      blocked: true
    }, 'LEGACY_EXCHANGE_WRITE_ATTEMPT_BLOCKED');

    // CRITICAL: Block the write by throwing
    throw new Error(`EXCHANGE_CONFIG_WRITE_BLOCKED: Only canonical path allowed. Attempted: ${attemptedPath}, Required: ${canonicalPath}`);
  }

  logger.debug({
    uid,
    writePath: canonicalPath,
    canonical: true
  }, 'EXCHANGE_CONFIG_WRITE_TO_CANONICAL_PATH_VERIFIED');
}

/**
 * CRITICAL: Runtime guard against INVALID_KEYS writes outside connect flow
 * This should NEVER be called except in POST /exchange/connect
 */
export function assertInvalidKeysWriteAllowed(context: string): void {
  const allowedContexts = ['exchange_connect'];

  if (!allowedContexts.includes(context)) {
    const error = new Error(
      `INVALID_KEYS_WRITE_VIOLATION: INVALID_KEYS can only be written in ${allowedContexts.join(', ')}, ` +
      `not in '${context}'. This indicates a critical regression.`
    );

    logger.error({
      context,
      allowedContexts,
      violation: 'INVALID_KEYS_WRITE_OUTSIDE_CONNECT'
    }, 'INVALID_KEYS_WRITE_VIOLATION_DETECTED');

    throw error;
  }

  logger.debug({ context }, 'INVALID_KEYS_WRITE_ALLOWED: Context verified for connect flow');
}

/**
 * CRITICAL: Runtime guard against ANY exchangeStatus writes outside exchange routes
 * Background jobs, schedulers, and other services MUST NEVER write exchangeStatus
 */
export function assertExchangeStatusWriteAllowed(context: string): void {
  const allowedContexts = ['exchange_connect', 'exchange_disconnect'];

  if (!allowedContexts.includes(context)) {
    const error = new Error(
      `EXCHANGE_STATUS_WRITE_VIOLATION: exchangeStatus can only be written in ${allowedContexts.join(', ')}, ` +
      `not in '${context}'. Background jobs must never mutate exchange state.`
    );

    logger.error({
      context,
      allowedContexts,
      violation: 'EXCHANGE_STATUS_WRITE_OUTSIDE_EXCHANGE_ROUTES'
    }, 'EXCHANGE_STATUS_WRITE_VIOLATION_DETECTED');

    throw error;
  }

  logger.debug({ context }, 'EXCHANGE_STATUS_WRITE_ALLOWED: Context verified for exchange operations');
}

// REQUEST-SCOPED CACHE: Prevent multiple Firestore reads for exchange usability in same request
// Key: `${uid}:${context}`, Value: Promise<{ usable: boolean; reason: string; exchange?: string }>
const REQUEST_CACHE = new Map<string, Promise<{ usable: boolean; reason: string; exchange?: string }>>();

/**
 * REQUEST CACHE MANAGEMENT: Clear exchange usability cache for diagnostic contexts
 * Call this at the start of diagnostic routes to ensure fresh reads
 */
export function clearExchangeUsabilityCache(): void {
  REQUEST_CACHE.clear();
  console.log('🔄 [EXCHANGE_CACHE_CLEARED] Request-scoped exchange usability cache cleared');
}

// SHARED exchange usability guard for all major code paths
/**
 * SAFE STARTUP CLEANUP: Automatically clear stale INVALID_KEYS states
 * INVALID_KEYS is transient and should not persist. This runs on server startup
 * to clean any stale INVALID_KEYS found in the database.
 *
 * CRITICAL SAFETY: Only affects INVALID_KEYS states, never touches valid exchanges
 */
export async function startupCleanupStaleInvalidKeys(): Promise<{ processed: number; cleared: number; errors: number }> {
  try {
    const usersSnapshot = await db().collection('users').limit(1000).get(); // Process in batches
    let processed = 0;
    let cleared = 0;
    let errors = 0;

    logger.info({ userCount: usersSnapshot.docs.length }, 'STARTUP_CLEANUP_STALE_INVALID_KEYS: Starting cleanup of stale INVALID_KEYS states');

    for (const userDoc of usersSnapshot.docs) {
      const uid = userDoc.id;

      // Skip system UIDs
      if (uid.startsWith('system-') || uid.length < 10) continue;

      try {
        processed++;
        const exchangeDoc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

        if (exchangeDoc.exists) {
          const config = exchangeDoc.data();

          // ONLY clear INVALID_KEYS states - never touch CONNECTED or DISCONNECTED
          if (config?.exchangeStatus === 'INVALID_KEYS') {
            await exchangeDoc.ref.update({
              exchangeStatus: 'DISCONNECTED',
              keysClearedAt: admin.firestore.FieldValue.delete(),
              keysClearedReason: admin.firestore.FieldValue.delete(),
              updatedAt: admin.firestore.Timestamp.now(),
            });

            logger.info({
              uid,
              exchange: config.exchange,
              originalReason: config.keysClearedReason
            }, 'STARTUP_CLEANUP: Cleared stale INVALID_KEYS → DISCONNECTED');

            cleared++;
          }
        }
      } catch (userError: any) {
        logger.warn({ uid, error: userError.message }, 'STARTUP_CLEANUP: Error processing user');
        errors++;
      }

      // Yield to prevent blocking
      if (processed % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    }

    logger.info({
      processed,
      cleared,
      errors,
      cleanupRate: processed > 0 ? (cleared / processed * 100).toFixed(1) + '%' : '0%'
    }, 'STARTUP_CLEANUP_STALE_INVALID_KEYS: Completed');

    return { processed, cleared, errors };
  } catch (error: any) {
    logger.error({ error: error.message }, 'STARTUP_CLEANUP_STALE_INVALID_KEYS: Failed');
    return { processed: 0, cleared: 0, errors: 1 };
  }
}

/**
 * MANUAL UTILITY: Clear stale INVALID_KEYS for specific user
 */
export async function clearStaleInvalidKeys(uid: string): Promise<{ cleared: boolean; reason: string }> {
  try {
    const doc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

    if (!doc.exists) {
      return { cleared: false, reason: 'No exchange config found' };
    }

    const config = doc.data();
    if (!config || config.exchangeStatus !== 'INVALID_KEYS') {
      return { cleared: false, reason: 'Exchange status is not INVALID_KEYS' };
    }

    // Clear the INVALID_KEYS state by setting to DISCONNECTED
    await doc.ref.update({
      exchangeStatus: 'DISCONNECTED',
      keysClearedAt: admin.firestore.FieldValue.delete(),
      keysClearedReason: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.Timestamp.now(),
    });

    logger.info({
      uid,
      exchange: config.exchange,
      keysClearedReason: config.keysClearedReason
    }, 'CLEARED_STALE_INVALID_KEYS: Converted INVALID_KEYS to DISCONNECTED');

    return { cleared: true, reason: 'Stale INVALID_KEYS cleared successfully' };
  } catch (error: any) {
    logger.error({ uid, error: error.message }, 'FAILED_TO_CLEAR_STALE_INVALID_KEYS');
    return { cleared: false, reason: `Clear failed: ${error.message}` };
  }
}

/**
 * Update cached flags for control-plane routes
 * Called by background processes only - NEVER from routes
 */
export async function updateCachedFlags(uid: string): Promise<void> {
  try {
    // Check exchange configuration presence
    // exchangeConfigured = exchangeConfig document EXISTS (nothing else)
    let exchangeConfigured = false;
    try {
      const exchangeDoc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
      exchangeConfigured = exchangeDoc.exists;
    } catch (configError: any) {
      logger.debug({ uid, error: configError.message }, 'Failed to check exchange config for cached flags');
      exchangeConfigured = false;
    }

    // Check provider configuration (lightweight check)
    const dbInstance = db();
    const integrationsSnapshot = await dbInstance.collection('users').doc(uid).collection('integrations').limit(1).get();
    const providersConfigured = !integrationsSnapshot.empty;

    // Update cached flags
    await firestoreAdapter.saveBackgroundResearchSettings(uid, {
      exchangeConfigured,
      providersConfigured,
      lastExchangeCheckAt: admin.firestore.Timestamp.now(),
      lastProviderValidationAt: admin.firestore.Timestamp.now(),
    });

    logger.debug({
      uid,
      exchangeConfigured,
      providersConfigured
    }, 'CACHED_FLAGS_UPDATED_BY_BACKGROUND_PROCESS');

  } catch (error: any) {
    logger.warn({
      uid,
      error: error.message
    }, 'FAILED_TO_UPDATE_CACHED_FLAGS');
  }
}

export async function isExchangeUsable(
  uid: string,
  context?: 'background_job' | 'user_request' | 'exchange_connect' | 'exchange_validate' | 'engine_check'
): Promise<{ usable: boolean; reason: string; exchange?: string }> {
  console.log(`🔍 [EXCHANGE_USABLE_CALLED] uid: ${uid}, context: '${context || 'undefined'}', timestamp: ${Date.now()}`);

  // REQUEST-SCOPED CACHING: For diagnostic contexts (user_request), cache result to prevent multiple Firestore reads
  const cacheKey = `${uid}:${context || 'undefined'}`;
  if ((context === 'user_request') && REQUEST_CACHE.has(cacheKey)) {
    console.log(`🔍 [EXCHANGE_CACHE_HIT] Returning cached result for uid: ${uid}, context: ${context}`);
    return REQUEST_CACHE.get(cacheKey)!;
  }

  // CRITICAL: Full validation (with decryption) ONLY for explicit exchange operations
  // All other contexts (background_job, engine_check, user_request, etc.) just check exchangeStatus
  const shouldDoFullValidation = context === 'exchange_connect' || context === 'exchange_validate';

  if (!shouldDoFullValidation) {
    console.log(`🔍 [EXCHANGE_GUARD] Context '${context || 'undefined'}' is NON-EXCHANGE - checking exchangeStatus only for uid: ${uid}`);
    logger.debug({
      uid,
      context,
      action: 'EXCHANGE_VALIDATION_SKIPPED'
    }, 'EXCHANGE_VALIDATION_SKIPPED: Non-exchange context - checking status only');

    // For non-exchange contexts: ONLY check if exchangeStatus === 'CONNECTED'
    // HARD GUARD: keysClearedReason, keysClearedAt, and ALL legacy flags MUST NOT affect runtime usability
    // These fields are WRITE-ONCE and only relevant during exchange_connect operations
    const doc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

    if (!doc.exists) {
      console.log(`🔍 [EXCHANGE_GUARD] No config document for uid: ${uid}. Returning { usable: false, reason: 'not_connected' }`);
      return { usable: false, reason: 'not_connected' };
    }

    const config = doc.data();

    // RULE: If exchangeConfig/current is missing, empty {}, or exchangeStatus missing/undefined/empty
    if (!config || !config.exchangeStatus || config.exchangeStatus === '') {
      console.log(`🔍 [EXCHANGE_GUARD] Missing/empty/undefined exchangeConfig for uid: ${uid}. Returning { usable: false, reason: 'not_connected' }`);
      return {
        usable: false,
        reason: 'not_connected',
        exchange: config?.exchange
      };
    }

    const exchangeStatus = config?.exchangeStatus;
    const keysClearedReason = config?.keysClearedReason;
    const keysClearedAt = config?.keysClearedAt;

    // HARD LOGGING: Track ALL exchange usability decisions
    logger.error({
      uid,
      exchangeStatus,
      keysClearedReason,
      keysClearedAt,
      context,
      decision: exchangeStatus === 'CONNECTED' ? 'USABLE' : 'NOT_USABLE',
      exchange: config?.exchange
    }, '[EXCHANGE_RUNTIME_PROOF] isExchangeUsable decision');

    // HARD GUARD: Explicitly ignore poisoned legacy fields in non-exchange contexts
    // keysClearedReason, keysClearedAt must NEVER influence usability decisions here
    // They are only relevant during exchange_connect for setting INVALID_KEYS

    // CRITICAL: exchangeStatus is the ONLY source of truth for validity
    // HARD GUARD: When CONNECTED, ignore ALL legacy invalid markers (keysClearedReason, keysClearedAt, etc.)
    // These fields MUST NEVER be checked or used in usability decisions in non-exchange contexts
    if (exchangeStatus === 'CONNECTED') {
      console.log(`🔍 [EXCHANGE_GUARD] exchangeStatus=CONNECTED for uid: ${uid}, exchange: ${config?.exchange}`);
      const result = {
        usable: true,
        reason: 'connected',
        exchange: config?.exchange
      };

      // CACHE RESULT: For diagnostic contexts, cache to prevent multiple Firestore reads per request
      if (context === 'user_request') {
        REQUEST_CACHE.set(cacheKey, Promise.resolve(result));
      }

      return result;
    }

    // STRICT REASON MAPPING (Fix 1)
    let mappedReason = 'not_connected';
    if (exchangeStatus === 'INVALID_KEYS') {
      // FIX 2: INVALID_KEYS is a transient event, not persistent state
      // If we encounter INVALID_KEYS outside connect flow, it means stale state
      // Must return not_connected to prevent INVALID_KEYS from persisting

      // REGRESSION PROTECTION: INVALID_KEYS must never be returned when exchangeConfig is missing or after disconnect
      // This assertion documents the invariant that INVALID_KEYS is transient and should be treated as stale state
      console.log(`🔒 [REGRESSION_GUARD] INVALID_KEYS encountered in non-connect context (${context}) for uid: ${uid} - treating as stale event, returning not_connected`);

      mappedReason = 'not_connected';
    } else if (exchangeStatus === 'DISCONNECTED') {
      mappedReason = 'disconnected';
    }

    console.log(`🔍 [EXCHANGE_GUARD] exchangeStatus=${exchangeStatus} for uid: ${uid} - returning strict reason: ${mappedReason}`);
    const result = {
      usable: false,
      reason: mappedReason,
      exchange: config?.exchange
    };

    // CACHE RESULT: For diagnostic contexts, cache to prevent multiple Firestore reads per request
    if (context === 'user_request') {
      REQUEST_CACHE.set(cacheKey, Promise.resolve(result));
    }

    return result;
  } else {
    // --- VALIDATION CONTEXTS: exchange_connect | exchange_validate ---
    // DO NOT decrypt inside firestoreAdapter - only check config existence and encrypted fields
    console.log(`🔍 [EXCHANGE_GUARD] Context '${context}' is VALIDATION - checking config existence and encrypted fields for uid: ${uid}`);

    try {
      // Load exchange config document
      const doc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

      if (!doc.exists) {
        console.log(`🔍 [EXCHANGE_VALIDATION] No config document for uid: ${uid}`);
        return { usable: false, reason: 'not_connected' };
      }

      const config = doc.data();
      if (!config) {
        console.log(`🔍 [EXCHANGE_VALIDATION] Empty config for uid: ${uid}`);
        return { usable: false, reason: 'not_connected' };
      }

      // Check for encrypted keys existence (NO DECRYPTION)
      const hasApiKey = config.apiKeyEncrypted || config.apiKey;
      const hasSecret = config.secretEncrypted || config.secretKeyEncrypted || config.secret;

      if (!hasApiKey || !hasSecret) {
        console.log(`🔍 [EXCHANGE_VALIDATION] Missing encrypted fields for uid: ${uid}`);
        return { usable: false, reason: 'not_connected' };
      }

      // SUCCESS: Config exists and has encrypted fields (no decryption attempted)
      console.log(`🔍 [EXCHANGE_VALIDATION] Config exists with encrypted fields for uid: ${uid}, exchange: ${config.exchange}`);
      return {
        usable: true,
        reason: 'connected',
        exchange: config.exchange
      };

    } catch (error: any) {
      console.log(`🔍 [EXCHANGE_VALIDATION] Error loading config for uid: ${uid}: ${error.message}`);
      return { usable: false, reason: 'not_connected' };
    }
  }
}

/**
 * ONE-TIME RECOVERY UTILITY: Clear encrypted exchange keys when decryption fails
 * Forces user to reconnect exchange, preventing silent failures
 * Should be called when decryptOrThrow fails for exchange keys
 */
export async function clearInvalidExchangeKeys(
  uid: string,
  markInvalid: boolean = false,
  context?: string
): Promise<void> {
  // 🚫 HARD-DISABLED: Background/adapter code MUST NEVER delete exchange keys
  // Only /exchange/connect route can reset credentials
  console.log('🚫 [HARD_DISABLED] [EXCHANGE_KEY_CLEAR_BLOCKED]', {
    uid,
    context,
    reason: 'clearInvalidExchangeKeys() is NO-OP - background processes cannot mutate credentials',
    action: 'LOG_ONLY_NO_MUTATION',
    timestamp: Date.now()
  });

  logger.warn({
    uid,
    context,
    blocked: true
  }, '🚫 clearInvalidExchangeKeys() BLOCKED - background processes cannot delete exchange keys');

  // NO-OP: Do not delete keys, do not update timestamps, do not mutate Firestore
}


export interface ApiKeyDocument {
  id?: string;
  exchange: string;
  name: string;
  apiKeyEncrypted: string;
  apiSecretEncrypted: string;
  testnet: boolean;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
}

export interface SettingsDocument {
  id?: string;
  symbol: string;
  quoteSize: number;
  adversePct: number;
  cancelMs: number;
  maxPos: number;
  minAccuracyThreshold: number;
  // CRITICAL: autoTradeEnabled is LEGACY - do NOT use it
  // Auto Trade state comes from autoTradeConfig/current.autoTradeEnabled
  // This field is kept for backward compatibility but should be ignored
  autoTradeEnabled?: boolean; // Marked optional to indicate it's legacy
  strategy?: string; // 'orderbook_imbalance' | 'smc_hybrid' | 'stat_arb' (market_making_hft is handled by HFT engine)
  liveMode?: boolean; // Default false - requires explicit confirmation
  max_loss_pct?: number; // Max daily loss as percentage of balance
  max_drawdown_pct?: number; // Max drawdown as percentage
  per_trade_risk_pct?: number; // Risk per trade as percentage
  status?: string; // 'active' | 'paused_by_risk' | 'paused_manual'
  // Provider configuration
  providerConfig?: {
    marketData: string[];
    news: string[];
    metadata: string[];
  };
  // Trading settings
  tradingSettings?: {
    mode: 'MANUAL' | 'TOP_100' | 'TOP_10';
    manualCoins: string[];
    maxPositionPerTrade: number;
    tradeType: 'Scalping' | 'Swing' | 'Position';
    accuracyTrigger: number;
    maxDailyLoss: number;
    maxTradesPerDay: number;
    positionSizingMap: Array<{
      min: number;
      max: number;
      percent: number;
    }>;
  };
  // Notification settings
  notificationSettings?: {
    enableAutoTradeAlerts: boolean;
    enableAccuracyAlerts: boolean;
    enableWhaleAlerts: boolean;
    tradeConfirmationRequired: boolean;
    notificationSounds: boolean;
    notificationVibration: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
  };
  // New structured notifications
  notifications?: {
    autoTradeAlerts?: boolean;
    autoTradeAlertsPrereqMet?: boolean;
    accuracyAlerts?: {
      enabled?: boolean;
      threshold?: number;
    };
    whaleAlerts?: {
      enabled?: boolean;
      sensitivity?: 'low' | 'medium' | 'high';
    };
    tradeConfirmationRequired?: boolean;
    soundEnabled?: boolean;
    vibrateEnabled?: boolean;
    telegramEnabled?: boolean;
    telegramChatId?: string;
  };
  dismissedNotifications?: Array<{
    id: string;
    dismissedAt: any;
  }>;
  // Legacy notification settings (keeping for backward compatibility)
  enableAutoTradeAlerts?: boolean;
  enableAccuracyAlerts?: boolean;
  enableWhaleAlerts?: boolean;
  tradeConfirmationRequired?: boolean;
  notificationSounds?: boolean;
  notificationVibration?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  updatedAt: admin.firestore.Timestamp;
}

export interface ResearchLogDocument {
  id?: string;
  symbol: string;
  timestamp: admin.firestore.Timestamp;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  orderbookImbalance: number;
  recommendedAction: string;
  microSignals: any;
  createdAt: admin.firestore.Timestamp;
}

export interface ExecutionLogDocument {
  id?: string;
  symbol: string;
  timestamp: admin.firestore.Timestamp;
  action: 'EXECUTED' | 'SKIPPED';
  reason?: string;
  accuracy?: number;
  accuracyUsed?: number; // The accuracy value used for decision
  orderId?: string;
  orderIds?: string[]; // Multiple order IDs for market making
  executionLatency?: number;
  slippage?: number;
  pnl?: number;
  strategy?: string;
  signal?: 'BUY' | 'SELL' | 'HOLD';
  status?: string; // Order status
  createdAt: admin.firestore.Timestamp;
}

export interface IntegrationDocument {
  enabled: boolean;
  providerName?: string; // Provider display name
  apiKey?: string; // encrypted
  secretKey?: string; // encrypted (only for Binance)
  apiKeyEncrypted?: string; // encrypted
  secretKeyEncrypted?: string; // encrypted (only for Binance)
  apiType?: string; // For CoinAPI: 'market' | 'flatfile' | 'exchangerate'
  type?: string; // provider type: 'marketData' | 'news' | 'metadata' | 'trading'
  usageStats?: any; // Usage statistics
  backupApis?: Array<{
    name: string;
    apiKey: string; // encrypted
    endpoint?: string;
    active: boolean;
    createdAt: admin.firestore.Timestamp;
  }>;
  updatedAt: admin.firestore.Timestamp;
}

export interface HFTSettingsDocument {
  id?: string;
  symbol: string;
  quoteSize: number;
  adversePct: number;
  cancelMs: number;
  maxPos: number;
  minSpreadPct: number;
  maxTradesPerDay: number;
  enabled: boolean;
  updatedAt: admin.firestore.Timestamp;
}

export interface TradingSettingsDocument {
  symbol: string;
  maxPositionPerTrade: number;
  tradeType: 'Scalping' | 'Swing' | 'Position';
  accuracyTrigger: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  positionSizingMap: Array<{
    min: number;
    max: number;
    percent: number;
  }>;
  updatedAt: admin.firestore.Timestamp;
}

export interface HFTExecutionLogDocument {
  id?: string;
  symbol: string;
  timestamp: admin.firestore.Timestamp;
  action: string; // 'BID_PLACED' | 'ASK_PLACED' | 'FILLED' | 'CANCELED'
  orderId?: string;
  orderIds?: string[];
  price?: number;
  quantity?: number;
  side?: 'BUY' | 'SELL';
  reason?: string;
  strategy: string;
  status?: string;
  createdAt: admin.firestore.Timestamp;
}

export class FirestoreAdapter {
  // Warm start function to pre-load Firestore cache at startup
  async warmStart(): Promise<void> {
    try {
      logger.info('Starting Firestore cache warm-up...');

      // Touch agents collection
      await db().collection('agents').limit(1).get();

      // Touch a sample user document to warm settings and notifications
      // We'll use a dummy query that should be fast
      const sampleQuery = await db().collection('users').limit(1).get();
      if (!sampleQuery.empty) {
        const sampleUid = sampleQuery.docs[0].id;

        // Touch settings subcollection
        await db().collection('users').doc(sampleUid).collection('settings').limit(1).get();

        // Touch notifications subcollection
        await db().collection('notifications').doc(sampleUid).collection('items').limit(1).get();
      }

      logger.info('Firestore cache warm-up completed');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Firestore cache warm-up failed, continuing...');
    }
  }

  /**
   * CRITICAL: Prevent ANY code from writing notification settings to wrong locations.
   * As per requirements, all notification settings MUST be in users/{uid}/settings/current.
   */
  public guardAgainstIllegalWrites(path: string, data: any, context?: string) {
    // 🔍 INSTRUMENTATION: Log all attempts to write to exchangeConfig/current
    const isExchangeConfigCurrent = path.includes('/exchangeConfig/current');
    if (isExchangeConfigCurrent) {
      logger.info({
        path,
        context,
        attemptedKeys: data ? Object.keys(data) : [],
        operation: 'EXCHANGE_CONFIG_WRITE_ATTEMPT'
      }, '🔍 [INSTRUMENTATION] Exchange config write attempt detected');
    }

    const restrictedKeys = [
      'notifications',
      'notificationSettings',
      'enableAutoTradeAlerts',
      'enableAccuracyAlerts',
      'enableWhaleAlerts',
      'tradeConfirmationRequired',
      'notificationSounds',
      'notificationVibration'
    ];

    const exchangeRestrictedKeys = [
      'exchangeStatus',
      'keysClearedAt',
      'keysClearedReason'
    ];

    const isSettingsCurrent = path.includes('/settings/current');

    // 🚨 HARD ASSERT: Non-exchange_connect contexts CANNOT touch exchangeConfig/current
    if (isExchangeConfigCurrent && context !== 'exchange_connect') {
      logger.error({
        path,
        data,
        context,
        isExchangeConfigCurrent,
        operation: 'EXCHANGE_CONFIG_ACCESS_BLOCKED'
      }, '🚨 [HARD_ASSERT] Non-exchange_connect context attempted to write to exchangeConfig/current');

      throw new Error(`HARD_ASSERT_VIOLATION: Only 'exchange_connect' context can write to exchangeConfig/current. Context: ${context}, Path: ${path}`);
    }

    // 1. Check notification restricted keys
    for (const key of restrictedKeys) {
      if (data && data[key] !== undefined) {
        if (!isSettingsCurrent) {
          logger.error({ path, key, data }, '🚨 HARD ERROR: Attempted to write notification fields outside authorized path');
          throw new Error(`ILLEGAL_WRITE: Field "${key}" can only be written to users/{uid}/settings/current. Path attempted: ${path}`);
        }
      }
    }

    // 2. STRICT WRITE-ONCE RULE: Exchange status fields can ONLY be written during exchange_connect
    for (const key of exchangeRestrictedKeys) {
      if (data && (data[key] !== undefined || data[key] instanceof admin.firestore.FieldValue)) {
        const isAuthorizedContext = context === 'exchange_connect';
        const isAuthorizedPath = isExchangeConfigCurrent;

        if (!isAuthorizedContext || !isAuthorizedPath) {
          logger.error({
            path,
            key,
            data,
            context,
            isAuthorizedContext,
            isAuthorizedPath
          }, '🚨 [SAFETY] Non-user context attempted exchangeStatus mutation — blocked');

          throw new Error(`ILLEGAL_EXCHANGE_STATUS_WRITE: Field "${key}" can only be written to users/{uid}/exchangeConfig/current during 'exchange_connect'. Context: ${context}, Path: ${path}`);
        }
      }
    }
  }

  // API Keys
  async saveApiKey(uid: string, keyData: {
    exchange: string;
    name: string;
    apiKey: string;
    apiSecret: string;
    testnet: boolean;
  }): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('apikeys').doc();

    const doc: ApiKeyDocument = {
      exchange: keyData.exchange,
      name: keyData.name,
      apiKeyEncrypted: encrypt(keyData.apiKey),
      apiSecretEncrypted: encrypt(keyData.apiSecret),
      testnet: keyData.testnet,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info({ uid, keyId: docRef.id }, 'API key saved to Firestore');
    return docRef.id;
  }

  async getApiKeys(uid: string): Promise<ApiKeyDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument));
  }

  async getApiKey(uid: string, keyId: string): Promise<ApiKeyDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .doc(keyId)
      .get();

    if (!doc.exists) return null;

    return {
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument;
  }

  async updateApiKey(uid: string, keyId: string, updates: Partial<{
    name: string;
    apiKey: string;
    apiSecret: string;
    testnet: boolean;
  }>): Promise<void> {
    const updateData: any = {
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (updates.name) updateData.name = updates.name;
    if (updates.apiKey) updateData.apiKeyEncrypted = encrypt(updates.apiKey);
    if (updates.apiSecret) updateData.apiSecretEncrypted = encrypt(updates.apiSecret);
    if (updates.testnet !== undefined) updateData.testnet = updates.testnet;

    await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .doc(keyId)
      .update(updateData);

    logger.info({ uid, keyId }, 'API key updated in Firestore');
  }

  async deleteApiKey(uid: string, keyId: string): Promise<void> {
    await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .doc(keyId)
      .delete();

    logger.info({ uid, keyId }, 'API key deleted from Firestore');
  }

  async getLatestApiKey(uid: string, exchange: string): Promise<ApiKeyDocument | null> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('apikeys')
      .where('exchange', '==', exchange)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument;
  }

  // CRITICAL: Remove undefined values from objects before Firestore write
  // Firestore rejects writes containing undefined values
  private sanitizeForFirestore(obj: any): any {
    if (obj === null || obj === undefined) {
      return null;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeForFirestore(item));
    }
    if (typeof obj === 'object' && obj.constructor === Object) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Skip undefined values completely
        if (value !== undefined) {
          sanitized[key] = this.sanitizeForFirestore(value);
        }
      }
      return sanitized;
    }
    return obj;
  }

  // Settings
  async saveSettings(uid: string, settings: Partial<SettingsDocument>): Promise<void> {
    try {
      const docRef = db().collection('users').doc(uid).collection('settings').doc('current');

      // CRITICAL: Get existing document first to merge properly
      const existingDoc = await docRef.get();
      const existingData = existingDoc.exists ? (existingDoc.data() || {}) : {};

      // CRITICAL: Deep merge for structured notification objects to prevent partial overwrites
      const mergedNotifications = settings.notifications ? {
        ...(existingData.notifications || {}),
        ...settings.notifications
      } : existingData.notifications;

      const mergedNotificationSettings = settings.notificationSettings ? {
        ...(existingData.notificationSettings || {}),
        ...settings.notificationSettings
      } : existingData.notificationSettings;

      const mergedTradingSettings = settings.tradingSettings ? {
        ...(existingData.tradingSettings || {}),
        ...settings.tradingSettings
      } : existingData.tradingSettings;

      // CRITICAL: Merge with existing, then sanitize to remove ALL undefined values
      const merged = {
        ...existingData,
        ...settings,
        notifications: mergedNotifications,
        notificationSettings: mergedNotificationSettings,
        tradingSettings: mergedTradingSettings,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // CRITICAL: Sanitize AFTER merge to remove any undefined values from both existing and new data
      const sanitized = this.sanitizeForFirestore(merged);

      // CRITICAL: Log notification object writes (Task 4)
      if (settings.notifications || settings.notificationSettings) {
        logger.info({
          uid,
          hasNotifications: !!settings.notifications,
          hasNotificationSettings: !!settings.notificationSettings,
          notificationsPayload: settings.notifications ? JSON.stringify(settings.notifications) : undefined
        }, "🔔 [NOTIFICATION_WRITE] Writing notification objects to users/{uid}/settings/current");
      }

      // CRITICAL: Runtime Guard Check
      this.guardAgainstIllegalWrites(`users/${uid}/settings/current`, sanitized, 'background_job');

      // CRITICAL: Use set() with merge: true, but sanitized data has no undefined values
      await docRef.set(sanitized, { merge: true });

      logger.info({ uid }, 'Settings saved to Firestore');
    } catch (error: any) {
      logger.error({ uid, error: error.message, stack: error.stack }, 'Failed to save settings to Firestore');
      // Re-throw to allow route handlers to return 500
      throw error;
    }
  }

  async getSettings(uid: string): Promise<SettingsDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('settings')
      .doc('current')
      .get();

    if (!doc.exists) return null;

    return doc.data() as SettingsDocument;
  }

  // Research Logs
  async saveResearchLog(uid: string, research: Omit<ResearchLogDocument, 'id' | 'createdAt'>): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('researchLogs').doc();

    const doc: ResearchLogDocument = {
      ...research,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.debug({ uid, symbol: research.symbol, accuracy: research.accuracy }, 'Research log saved');
    return docRef.id;
  }

  async getResearchLogs(uid: string, limit: number = 100): Promise<ResearchLogDocument[]> {
    // Get logs from both researchLogs collection (scheduled research) and old research collection
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('researchLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as ResearchLogDocument));
  }

  // Execution Logs
  async saveExecutionLog(uid: string, execution: Omit<ExecutionLogDocument, 'id' | 'createdAt'>): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('executionLogs').doc();

    const doc: ExecutionLogDocument = {
      ...execution,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info({ uid, action: execution.action, symbol: execution.symbol }, 'Execution log saved');
    return docRef.id;
  }

  async getExecutionLogs(uid: string, limit: number = 100): Promise<ExecutionLogDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('executionLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as ExecutionLogDocument));
  }

  // Integrations
  async getIntegration(uid: string, apiName: string): Promise<IntegrationDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName)
      .get();

    if (!doc.exists) return null;

    return doc.data() as IntegrationDocument;
  }

  async getAllIntegrations(uid: string): Promise<Record<string, IntegrationDocument>> {
    // CRITICAL: Assert UID is provided and valid
    if (!uid) {
      throw new Error("getAllIntegrations called with null/undefined uid");
    }
    console.log("[UID_ASSERT]", { authUid: uid });

    const firestore = db();
    console.log("[INT-LOAD] Reading integrations for UID =", uid);
    console.log("[INT-LOAD] Path =", `users/${uid}/integrations`);

    const snapshot = await firestore
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .get();

    console.log("[INT-LOAD] Snap size =", snapshot.size);
    snapshot.forEach((doc) => console.log("[INT-LOAD DOC]", doc.id, doc.data()));

    if (snapshot.size === 0) {
      console.log("[INT-LOAD] FIRESTORE CLIENT =", firestore.constructor.name);
      if (firestore.constructor.name.toLowerCase().includes('mock')) {
        console.log("[INT-LOAD WARNING] Using mock Firestore - data will always be empty");
      }
      try {
        const cols = await firestore.collection('users').doc(uid).listCollections();
        console.log("[INT DEBUG DOCS] Listing all subcollections:", cols.map((c) => c.id));
      } catch (err: any) {
        console.log("[INT DEBUG DOCS] Failed to list subcollections:", err?.message);
      }
    }

    console.log("[FIRESTORE_INTEGRATIONS]", uid, snapshot.docs.map((d) => d.id));

    const out: Record<string, any> = {};

    // FIX: Include ALL providers from providerConfig.ts sets to prevent filtering issues
    const OFFICIAL_PROVIDERS = new Set<string>([
      // Market Data Providers
      "cryptocompare", "bybit", "okx", "kucoin", "bitget", "coinstats",
      "livecoinwatch", "marketaux", "kaiko", "messari", "coinapi",
      "coinmarketcap", "coinlore", "coincheckup", "bravenewcoin",

      // News Providers
      "newsdata", "cryptopanic", "reddit", "webzio",
      "gnews", "newscatcher", "coinstatsnews",
      "altcoinbuzz_rss", "cointelegraph_rss",

      // Metadata Providers
      "coingecko", "coinpaprika", "coincap"
    ]);
    // FIX: Consistent provider type mapping matching providerConfig.ts
    const PROVIDER_TYPES: Record<string, 'marketdata' | 'news' | 'metadata'> = {
      // Market Data Providers (normalized to lowercase)
      'cryptocompare': 'marketdata',
      'bybit': 'marketdata',
      'okx': 'marketdata',
      'kucoin': 'marketdata',
      'bitget': 'marketdata',
      'coinstats': 'marketdata',
      'livecoinwatch': 'marketdata',
      'marketaux': 'marketdata',
      'kaiko': 'marketdata',
      'messari': 'marketdata',
      'coinapi': 'marketdata',
      'coinmarketcap': 'marketdata',
      'coinlore': 'marketdata',
      'coincheckup': 'marketdata',
      'bravenewcoin': 'marketdata',

      // News Providers
      'newsdata': 'news',
      'cryptopanic': 'news',
      'reddit': 'news',
      'webzio': 'news',
      'gnews': 'news',
      'newscatcher': 'news',
      'coinstatsnews': 'news',
      'altcoinbuzz_rss': 'news',
      'cointelegraph_rss': 'news',

      // Metadata Providers
      'coingecko': 'metadata',
      'coinpaprika': 'metadata',
      'coincap': 'metadata'
    };
    const ALLOWED_TYPES = new Set(['marketdata', 'news', 'metadata']);

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const providerId = (doc.id || '').toLowerCase();
      if (!OFFICIAL_PROVIDERS.has(providerId)) {
        out[providerId] = {
          ...data,
          providerName: data.providerName || providerId,
          enabled: typeof data.enabled === 'boolean' ? data.enabled : false,
          type: (data.type && ALLOWED_TYPES.has(data.type)) ? data.type : (data.apiType || 'marketData'),
          updatedAt: data.updatedAt || null,
        };
        console.log("[FIRESTORE_INTEGRATIONS_UNOFFICIAL]", providerId, out[providerId]);
        return;
      }

      // HARD ENFORCE TYPE FOR KNOWN PROVIDERS - don't trust stored type blindly
      const rawType = data.type || data.apiType;
      const resolvedType = PROVIDER_TYPES[providerId] || 'marketData';

      // SPECIAL ENFORCEMENT: CryptoCompare must ALWAYS be marketData
      const finalType = providerId === 'cryptocompare' ? 'marketData' : resolvedType;

      // WARN if type was corrected
      if (rawType && rawType !== finalType) {
        console.warn(`[FIRESTORE_TYPE_CORRECTION] ${providerId}: stored type "${rawType}" corrected to "${finalType}"`);
      }

      console.log(`[FIRESTORE_TYPE_ENFORCEMENT] ${providerId}: rawType="${rawType}" → resolvedType="${finalType}"`);

      const entry: any = {
        ...data,
        providerName: (typeof data.providerName === 'string' && data.providerName.trim())
          ? data.providerName
          : providerId,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : false,
        type: finalType, // Use the enforced type
        updatedAt: data.updatedAt || null,
      };

      // Ensure required fields always exist for downstream consumers
      entry.apiKeyEncrypted = data.apiKeyEncrypted !== undefined ? data.apiKeyEncrypted : null;
      entry.secretKeyEncrypted = data.secretKeyEncrypted !== undefined ? data.secretKeyEncrypted : null;
      entry.usageStats = (entry.usageStats && typeof entry.usageStats === 'object') ? entry.usageStats : { calls: 0 };

      // Remove any accidental plaintext leakage (do not transform or re-encrypt)
      delete (entry as any).apiKey;
      delete (entry as any).secretKey;

      out[providerId] = entry;
      console.log("[FIRESTORE_INTEGRATIONS_KEEP]", { providerId, resolvedType, hasApiKeyEncrypted: !!entry.apiKeyEncrypted, enabled: entry.enabled });
    });

    return out;
  }

  async getEnabledIntegrations(uid: string): Promise<Record<string, { apiKey: string; secretKey?: string }>> {
    // 🚫 ADAPTER CRYPTO-AGNOSTIC: Integration decryption should happen at application layer
    throw new Error('CRYPTO_OPERATION_BLOCKED: getEnabledIntegrations() performs decryption and should not be called from firestoreAdapter. Use integration service layer instead.');
  }

  async saveIntegration(uid: string, apiName: string, data: {
    enabled: boolean;
    apiKey?: string; // plain text, will be encrypted
    secretKey?: string; // plain text, will be encrypted (only for Binance)
    apiType?: string; // For CoinAPI type
    type?: string; // provider type: 'marketData' | 'news' | 'metadata' | 'trading'
  }): Promise<void> {
    const docRef = db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName);

    // Check if document exists to determine if we should set createdAt
    const existingDoc = await docRef.get();
    const now = admin.firestore.Timestamp.now();

    const docData: IntegrationDocument = {
      enabled: data.enabled,
      updatedAt: now,
    };

    // Add createdAt only if document doesn't exist
    if (!existingDoc.exists) {
      (docData as any).createdAt = now;
    }

    if (data.apiKey) {
      docData.apiKeyEncrypted = encrypt(data.apiKey);
    }
    if (data.secretKey) {
      docData.secretKeyEncrypted = encrypt(data.secretKey);
    }
    if (data.apiType) {
      docData.apiType = data.apiType;
    }
    if (data.type) {
      docData.type = data.type;
    }

    const sanitizedDocData = sanitizeFirestorePayload(docData);
    await docRef.set(sanitizedDocData, { merge: true });
    logger.info({
      uid,
      apiName,
      enabled: data.enabled,
      hasApiKey: !!data.apiKey,
      hasSecretKey: !!data.secretKey,
      hasCreatedAt: !existingDoc.exists
    }, 'Integration saved to Firestore');
  }

  async deleteIntegration(uid: string, apiName: string): Promise<void> {
    await db()
      .collection('users')
      .doc(uid)
      .collection('integrations')
      .doc(apiName)
      .delete();

    logger.info({ uid, apiName }, 'Integration deleted from Firestore');
  }


  // HFT Settings
  async saveHFTSettings(uid: string, settings: Partial<HFTSettingsDocument>): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('hftSettings').doc('current');

    const payload = {
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    };
    const sanitizedPayload = sanitizeFirestorePayload(payload);

    await docRef.set(sanitizedPayload, { merge: true });

    logger.info({ uid }, 'HFT settings saved to Firestore');
  }

  async getHFTSettings(uid: string): Promise<HFTSettingsDocument | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('hftSettings')
      .doc('current')
      .get();

    if (!doc.exists) return null;

    return doc.data() as HFTSettingsDocument;
  }

  // HFT Execution Logs
  async saveHFTExecutionLog(uid: string, execution: Omit<HFTExecutionLogDocument, 'id' | 'createdAt'>): Promise<string> {
    const docRef = db().collection('users').doc(uid).collection('hftExecutionLogs').doc();

    const doc: HFTExecutionLogDocument = {
      ...execution,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info({ uid, action: execution.action, symbol: execution.symbol }, 'HFT execution log saved');
    return docRef.id;
  }

  async getHFTExecutionLogs(uid: string, limit: number = 100): Promise<HFTExecutionLogDocument[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('hftExecutionLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    } as HFTExecutionLogDocument));
  }

  // Agent Management
  async unlockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);

    await docRef.set({
      unlocked: true,
      unlockedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info({ uid, agentName }, 'Agent unlocked');
  }

  async lockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('agents').doc(agentName);

    await docRef.set({
      unlocked: false,
      unlockedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info({ uid, agentName }, 'Agent locked');
  }

  async getAgentStatus(uid: string, agentName: string): Promise<{ unlocked: boolean; unlockedAt?: admin.firestore.Timestamp } | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('agents')
      .doc(agentName)
      .get();

    if (!doc.exists) return null;

    const data = doc.data();
    return {
      unlocked: data?.unlocked || false,
      unlockedAt: data?.unlockedAt,
    };
  }

  async getAllUserAgents(uid: string): Promise<Record<string, { unlocked: boolean; unlockedAt?: admin.firestore.Timestamp }>> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('agents')
      .get();

    const agents: Record<string, { unlocked: boolean; unlockedAt?: admin.firestore.Timestamp }> = {};
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      agents[doc.id] = {
        unlocked: data?.unlocked || false,
        unlockedAt: data?.unlockedAt,
      };
    });

    return agents;
  }

  // User Profile Management
  async getUserProfile(uid: string): Promise<{ role?: string; email?: string;[key: string]: any } | null> {
    const doc = await db().collection('users').doc(uid).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return data?.profile || {};
  }

  // --- NEW: User Statistics Management ---
  async incrementUserStat(uid: string, statKey: string, amount: number = 1, metadata?: Record<string, any>): Promise<void> {
    try {
      const userRef = db().collection('users').doc(uid);

      // Use atomic increment
      const updateData: any = {
        [`stats.${statKey}`]: admin.firestore.FieldValue.increment(amount),
        [`stats.lastUpdated`]: admin.firestore.FieldValue.serverTimestamp()
      };

      if (metadata) {
        // Flatten metadata updates into dot notation to avoid overwriting nested objects if not intended,
        // or just set 'stats.lastActivity' object
        if (metadata.lastActivity) {
          updateData[`stats.lastActivity`] = metadata.lastActivity;
        }
      }

      await userRef.update(updateData);
      // logger.debug({ uid, statKey, amount }, 'User stat incremented'); 
    } catch (err: any) {
      if (err.code === 5 || err.message?.includes('NOT_FOUND')) {
        // If user doc doesn't exist or stats field issues, try set with merge
        try {
          await db().collection('users').doc(uid).set({
            stats: {
              [statKey]: amount,
              lastUpdated: admin.firestore.Timestamp.now(),
              ...(metadata?.lastActivity ? { lastActivity: metadata.lastActivity } : {})
            }
          }, { merge: true });
        } catch (retryErr: any) {
          logger.error({ uid, statKey, error: retryErr.message }, 'Failed to initialize user stats');
        }
      } else {
        logger.error({ uid, statKey, error: err.message }, 'Failed to increment user stat');
      }
    }
  }

  /**
   * Get User Stats directly
   */
  async getUserStats(uid: string): Promise<any> {
    const doc = await db().collection('users').doc(uid).get();
    if (!doc.exists) return {};
    return doc.data()?.stats || {};
  }



  async getAllUsers(): Promise<Array<{ uid: string; email?: string; role?: string; createdAt?: admin.firestore.Timestamp }>> {
    const snapshot = await db().collection('users').get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      const profile = data?.profile || {};
      return {
        uid: doc.id,
        email: profile.email || data?.email,
        role: profile.role,
        createdAt: data?.createdAt || profile.createdAt,
      };
    });
  }

  // ========== USERS COLLECTION METHODS ==========
  async createOrUpdateUser(uid: string, userData: any): Promise<void> {
    const userRef = db().collection('users').doc(uid);
    const existing = await userRef.get();

    // CRITICAL: Hard Isolation Rule - Strip sensitive fields from root document write
    const {
      settings,
      notifications,
      notificationSettings,
      autoTrade,
      autoTradeConfig,
      backgroundResearch,
      tradingSettings,
      riskLimits,
      thresholds,
      ...safeUserData
    } = userData;

    const updateData: any = {
      ...safeUserData,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (!existing.exists) {
      updateData.uid = uid;
      updateData.createdAt = admin.firestore.Timestamp.now();
    }

    // CRITICAL: Runtime Guard Check
    this.guardAgainstIllegalRootWrites(`users/${uid}`, updateData);

    await userRef.set(updateData, { merge: true });
    logger.info({ uid }, 'User created/updated in users collection (root doc restricted)');
  }

  /**
   * Hard Isolation Rule: Runtime Write Guard
   * Prevents unauthorized writes to sensitive user settings paths.
   */
  /**
   * Hard Isolation Rule: Runtime Write Guard
   * Prevents unauthorized writes to sensitive user settings paths.
   */
  private guardAgainstIllegalRootWrites(path: string, data: any): void {
    const forbiddenFields = [
      'settings',
      'notifications',
      'notificationSettings',
      'autoTrade',
      'autoTradeConfig',
      'backgroundResearch',
      'tradingSettings',
      'riskLimits',
      'thresholds'
    ];

    // If writing to root user document, ensure no forbidden fields are present
    if (path.match(/^users\/[^/]+$/)) {
      for (const field of forbiddenFields) {
        if (data[field] !== undefined) {
          const error = new Error(`CRITICAL: Unauthorized write to forbidden field '${field}' on user root document! Path: ${path}`);
          logger.error({
            path,
            field,
            stack: error.stack,
            data: JSON.stringify(data).substring(0, 500)
          }, 'HARD_ISOLATION_VIOLATION');
          throw error;
        }
      }
    }

    // Logic for provider/integration writes (if they try to write to restricted subcollections)
    if (path.includes('/integrations/') || path.includes('/providers/')) {
      for (const field of forbiddenFields) {
        if (data[field] !== undefined) {
          const error = new Error(`CRITICAL: Provider logic attempted to write restricted field '${field}' to path: ${path}`);
          logger.error({
            path,
            field,
            stack: error.stack
          }, 'PROVIDER_ISOLATION_VIOLATION');
          throw error;
        }
      }
    }
  }

  async getUser(uid: string): Promise<any | null> {
    const doc = await db().collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  // ========== AGENTS COLLECTION METHODS ==========
  async getAllAgents(): Promise<Array<{ id: string; name: string; price: number; features: string[];[key: string]: any }>> {
    const snapshot = await db().collection('agents').get();
    return snapshot.docs
      .filter((doc) => doc.id !== '_init' && !doc.id.startsWith('_'))
      .map((doc) => ({ id: doc.id, ...doc.data() } as any));
  }

  async getAgent(agentId: string): Promise<any | null> {
    const doc = await db().collection('agents').doc(agentId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  // ========== USER AGENTS METHODS ==========
  async getUserAgents(uid: string): Promise<Array<{ id: string; name: string; price: number; features: string[];[key: string]: any }>> {
    const snapshot = await db().collection('users').doc(uid).collection('agents').get();
    return snapshot.docs
      .filter((doc) => doc.id !== '_init' && !doc.id.startsWith('_')) // Filter out _init and other system documents
      .map((doc) => ({ id: doc.id, ...doc.data() } as any));
  }

  async getUserAgent(uid: string, agentId: string): Promise<any | null> {
    const doc = await db().collection('users').doc(uid).collection('agents').doc(agentId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  // ========== USER FEATURES METHODS ==========
  async getUserFeatures(uid: string): Promise<Array<{ id: string; name: string; enabled: boolean;[key: string]: any }>> {
    const snapshot = await db().collection('users').doc(uid).collection('features').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
  }

  async enableUserFeature(uid: string, featureId: string, featureData: any): Promise<void> {
    const featureRef = db().collection('users').doc(uid).collection('features').doc(featureId);
    await featureRef.set({
      id: featureId,
      enabled: true,
      enabledAt: admin.firestore.Timestamp.now(),
      ...featureData,
    }, { merge: true });
    logger.info({ uid, featureId }, 'User feature enabled');
  }

  async disableUserFeature(uid: string, featureId: string): Promise<void> {
    const featureRef = db().collection('users').doc(uid).collection('features').doc(featureId);
    await featureRef.update({
      enabled: false,
      disabledAt: admin.firestore.Timestamp.now(),
    });
    logger.info({ uid, featureId }, 'User feature disabled');
  }

  // ========== AGENT PURCHASE REQUESTS METHODS ==========
  async createAgentPurchaseRequest(requestData: {
    uid: string;
    agentId: string;
    agentName: string;
    userName: string;
    email: string;
    phoneNumber: string;
    status?: string;
  }): Promise<string> {
    const requestRef = db().collection('agentPurchaseRequests').doc();
    const data = {
      id: requestRef.id,
      status: requestData.status || 'pending',
      createdAt: admin.firestore.Timestamp.now(),
      ...requestData,
    };
    await requestRef.set(data);
    logger.info({ uid: requestData.uid, agentId: requestData.agentId, requestId: requestRef.id }, 'Agent purchase request created');
    return requestRef.id;
  }

  async getAgentPurchaseRequests(): Promise<any[]> {
    const snapshot = await db().collection('agentPurchaseRequests').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async approveAgentPurchaseRequest(requestId: string, adminUid: string): Promise<void> {
    const requestRef = db().collection('agentPurchaseRequests').doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new Error('Purchase request not found');
    }

    const requestData = requestDoc.data();
    if (!requestData) {
      throw new Error('Invalid purchase request data');
    }

    // Update request status
    await requestRef.update({
      status: 'approved',
      approvedAt: admin.firestore.Timestamp.now(),
      approvedBy: adminUid,
    });

    // Mark the agent as unlocked in the user's agents collection
    const userAgentRef = db().collection('users').doc(requestData.uid).collection('agents').doc(requestData.agentId);
    await userAgentRef.update({
      unlocked: true,
      unlockedAt: admin.firestore.Timestamp.now(),
      purchaseRequestId: requestId,
    });

    // Enable the feature for the user (for sidebar)
    await this.enableUserFeature(requestData.uid, requestData.agentId, {
      name: requestData.agentName,
      type: 'agent',
      purchaseRequestId: requestId,
    });

    logger.info({ requestId, uid: requestData.uid, agentId: requestData.agentId }, 'Agent purchase request approved, agent unlocked, and feature enabled');
  }

  async rejectAgentPurchaseRequest(requestId: string, adminUid: string, reason?: string): Promise<void> {
    const requestRef = db().collection('agentPurchaseRequests').doc(requestId);
    await requestRef.update({
      status: 'rejected',
      rejectedAt: admin.firestore.Timestamp.now(),
      rejectedBy: adminUid,
      rejectionReason: reason,
    });
    logger.info({ requestId }, 'Agent purchase request rejected');
  }

  // ========== AGENT UNLOCKS COLLECTION METHODS ==========
  async createAgentUnlock(uid: string, agentName: string, metadata?: any): Promise<void> {
    const unlockRef = db().collection('agentUnlocks').doc();
    await unlockRef.set({
      uid,
      agentName,
      unlockedAt: admin.firestore.Timestamp.now(),
      ...metadata,
    });
    logger.info({ uid, agentName }, 'Agent unlock recorded');
  }

  async getUserAgentUnlocks(uid: string): Promise<any[]> {
    try {
      const snapshot = await db()
        .collection('agentUnlocks')
        .where('uid', '==', uid)
        .orderBy('unlockedAt', 'desc')
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'getUserAgentUnlocks fell back due to index; returning unordered');
      const snapshot = await db()
        .collection('agentUnlocks')
        .where('uid', '==', uid)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
  }

  // Optimized method to get user's unlocked agents from users/{uid}/agents
  // Treats all agents in users/{uid}/agents as unlocked by default unless explicitly locked
  async getUserUnlockedAgents(uid: string): Promise<string[]> {
    try {
      // PRIMARY: Fetch from users/{uid}/agents - same source as getUserAgents
      const snapshot = await db().collection('users').doc(uid).collection('agents').get();

      const unlockedAgentIds: string[] = [];
      snapshot.docs.forEach((doc) => {
        // Skip system documents
        if (doc.id === '_init' || doc.id.startsWith('_')) {
          return;
        }

        const data = doc.data();
        // Treat as unlocked by default unless explicitly locked
        // unlocked field can be: true (explicitly unlocked), false (explicitly locked), or undefined (default unlocked)
        if (data?.unlocked !== false) {
          unlockedAgentIds.push(doc.id);
        }
      });

      return unlockedAgentIds;
    } catch (err: any) {
      logger.warn({ err: err.message, uid }, 'getUserUnlockedAgents failed, returning empty array');
      return [];
    }
  }

  // ========== API KEYS COLLECTION METHODS (top-level) ==========
  async saveApiKeyToCollection(uid: string, keyData: {
    publicKey: string;
    secretKey: string; // will be encrypted
    exchange?: string;
  }): Promise<string> {
    const docRef = db().collection('apiKeys').doc();
    const { encrypt } = await import('./keyManager');

    await docRef.set({
      uid,
      publicKey: keyData.publicKey,
      secretKeyEncrypted: encrypt(keyData.secretKey),
      exchange: keyData.exchange || 'binance',
      createdAt: admin.firestore.Timestamp.now(),
    });

    logger.info({ uid, keyId: docRef.id }, 'API key saved to apiKeys collection');
    return docRef.id;
  }

  async getUserApiKeys(uid: string): Promise<any[]> {
    const snapshot = await db()
      .collection('apiKeys')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  // ========== ACTIVITY LOGS COLLECTION METHODS ==========
  async logActivity(uid: string, type: string, metadata?: any): Promise<void> {
    const logRef = db().collection('activityLogs').doc();
    await logRef.set({
      uid,
      type,
      message: metadata?.message || `Activity: ${type}`,
      metadata: metadata || {},
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, type }, 'Activity logged');
  }

  async getActivityLogs(uid?: string, limit: number = 100): Promise<any[]> {
    let query: admin.firestore.Query = db().collection('activityLogs');

    if (uid) {
      query = query.where('uid', '==', uid);
    }

    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== ENGINE STATUS COLLECTION METHODS ==========
  async saveEngineStatus(uid: string, status: {
    active: boolean;
    engineType?: 'auto' | 'hft';
    symbol?: string;
    config?: any;
  }): Promise<void> {
    const statusDoc = {
      uid,
      ...status,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    // CRITICAL: Runtime Guard Check
    this.guardAgainstIllegalWrites(`engineStatus/${uid}`, statusDoc, 'background_job');

    const statusRef = db().collection('engineStatus').doc(uid);
    await statusRef.set(statusDoc, { merge: true });
    logger.debug({ uid, active: status.active }, 'Engine status saved');
  }

  async getEngineStatus(uid: string): Promise<any | null> {
    const doc = await db().collection('engineStatus').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  // ========== BACKGROUND RESEARCH SETTINGS METHODS ==========
  async saveBackgroundResearchSettings(uid: string, settings: {
    backgroundResearchEnabled?: boolean;
    telegramBackgroundResearchEnabled?: boolean; // Explicit flag for Telegram Background Research mode
    telegramEnabled?: boolean;
    telegramBotToken?: string;
    telegramChatId?: string;
    researchFrequencyMinutes?: number;
    accuracyTrigger?: number | { min: number; max: number }; // Support both number and object formats
    lastResearchRun?: admin.firestore.Timestamp | null;
    lastRunAt?: admin.firestore.Timestamp | null;
    nextRunAt?: admin.firestore.Timestamp | null;
    lastAccuracy?: number;
    selectedCoins?: string[];
    lastAlertSent?: { [coin: string]: { timestamp: admin.firestore.Timestamp; accuracy: number } };
    engineState?: 'RUNNING' | 'STOPPED'; // Engine state persistence
    scheduled?: boolean; // User is registered in scheduler
    lastScheduledAt?: admin.firestore.Timestamp; // When user was last scheduled
    // CACHED FLAGS for control-plane routes (updated by background processes only)
    exchangeConfigured?: boolean; // Cached: exchange keys exist and decryptable
    providersConfigured?: boolean; // Cached: at least one research provider configured
    lastExchangeCheckAt?: admin.firestore.Timestamp; // When exchange configuration was last checked
    lastProviderValidationAt?: admin.firestore.Timestamp; // When providers were last validated
  }): Promise<void> {
    try {
      const docRef = db().collection('users').doc(uid).collection('settings').doc('backgroundResearch');

      // CRITICAL: Get existing document first to merge properly
      const existingDoc = await docRef.get();
      const existingData = existingDoc.exists ? (existingDoc.data() || {}) : {};

      // CRITICAL: Preserve Telegram credentials if not explicitly provided in settings
      // Never clear Telegram credentials on decrypt failure or other errors
      // Only update if explicitly provided (not undefined)
      const preservedTelegramBotToken = settings.telegramBotToken !== undefined
        ? settings.telegramBotToken
        : (existingData.telegramBotToken || undefined);
      const preservedTelegramChatId = settings.telegramChatId !== undefined
        ? settings.telegramChatId
        : (existingData.telegramChatId || undefined);

      // CRITICAL: Preserve enabled state if not explicitly provided
      // Refresh should NOT reset enabled state
      const preservedBackgroundResearchEnabled = settings.backgroundResearchEnabled !== undefined
        ? settings.backgroundResearchEnabled
        : (existingData.backgroundResearchEnabled !== undefined ? existingData.backgroundResearchEnabled : undefined);
      const preservedTelegramBackgroundResearchEnabled = settings.telegramBackgroundResearchEnabled !== undefined
        ? settings.telegramBackgroundResearchEnabled
        : (existingData.telegramBackgroundResearchEnabled !== undefined ? existingData.telegramBackgroundResearchEnabled : undefined);

      // CRITICAL: Merge with existing, preserving Telegram credentials and enabled state
      // Only explicitly provided fields are updated
      const merged = {
        ...existingData,
        ...settings,
        // CRITICAL: Always preserve Telegram credentials unless explicitly cleared by user
        telegramBotToken: preservedTelegramBotToken,
        telegramChatId: preservedTelegramChatId,
        // CRITICAL: Preserve enabled state unless explicitly provided
        backgroundResearchEnabled: preservedBackgroundResearchEnabled,
        telegramBackgroundResearchEnabled: preservedTelegramBackgroundResearchEnabled,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      const sanitized = this.sanitizeForFirestore(merged);

      // CRITICAL: Runtime Guard Check
      this.guardAgainstIllegalWrites(`users/${uid}/settings/backgroundResearch`, sanitized, 'background_job');

      await docRef.set(sanitized, { merge: true });
      logger.info({ uid }, 'Background research settings saved to Firestore');
    } catch (error: any) {
      logger.error({ uid, error: error.message, stack: error.stack }, 'Failed to save background research settings to Firestore');
      // Re-throw to allow route handlers to return 500
      throw error;
    }
  }

  async getBackgroundResearchSettings(uid: string): Promise<any | null> {
    const doc = await db()
      .collection('users')
      .doc(uid)
      .collection('settings')
      .doc('backgroundResearch')
      .get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async getAllEngineStatuses(): Promise<any[]> {
    const snapshot = await db().collection('engineStatus').get();
    return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  }

  // ========== HFT LOGS COLLECTION METHODS ==========
  async saveHFTLog(uid: string, logData: {
    symbol: string;
    action: string;
    orderId?: string;
    price?: number;
    quantity?: number;
    side?: 'BUY' | 'SELL';
    pnl?: number;
    metadata?: any;
  }): Promise<void> {
    const logRef = db().collection('hftLogs').doc();
    await logRef.set({
      uid,
      ...logData,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, action: logData.action }, 'HFT log saved');
  }

  async getHFTLogs(uid?: string, limit: number = 100): Promise<any[]> {
    let query: admin.firestore.Query = db().collection('hftLogs');

    if (uid) {
      query = query.where('uid', '==', uid);
    }

    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== TRADES COLLECTION METHODS ==========
  async saveTrade(uid: string, tradeData: {
    symbol: string;
    side: 'BUY' | 'SELL' | 'buy' | 'sell';
    qty: number;
    entryPrice: number;
    exitPrice?: number;
    pnl?: number;
    timestamp?: admin.firestore.Timestamp;
    engineType: 'AI' | 'HFT' | 'Manual' | 'auto';
    orderId?: string;
    metadata?: any;
    exchange?: string;
    signalAccuracy?: number;
    status?: 'open' | 'closed';
  }): Promise<string> {
    const tradeRef = db().collection('trades').doc();
    const side = tradeData.side.toLowerCase() as 'buy' | 'sell';
    const status = tradeData.status || (tradeData.exitPrice ? 'closed' : 'open');
    await tradeRef.set({
      uid,
      symbol: tradeData.symbol,
      side,
      qty: tradeData.qty,
      entryPrice: tradeData.entryPrice,
      exitPrice: tradeData.exitPrice,
      pnl: tradeData.pnl,
      timestamp: tradeData.timestamp || admin.firestore.Timestamp.now(),
      engineType: tradeData.engineType,
      exchange: tradeData.exchange,
      signalAccuracy: tradeData.signalAccuracy,
      status,
      ...(tradeData.orderId && { orderId: tradeData.orderId }),
      ...(tradeData.metadata && { metadata: tradeData.metadata }),
    });
    logger.info({ uid, symbol: tradeData.symbol, side, exchange: tradeData.exchange, status }, 'Trade saved');
    return tradeRef.id;
  }

  async getTrades(uid?: string, limit: number = 100): Promise<any[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    try {
      let query: admin.firestore.Query = db().collection('trades');
      if (uid) {
        query = query.where('uid', '==', uid);
      }
      const snapshot = await query
        .orderBy('timestamp', 'desc')
        .limit(safeLimit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate().toISOString(),
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, 'getTrades fell back due to index; returning unordered limited set');
      let query: admin.firestore.Query = db().collection('trades');
      if (uid) {
        query = query.where('uid', '==', uid);
      }
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate().toISOString(),
      }));
    }
  }

  // ========== NOTIFICATIONS COLLECTION METHODS ==========
  async createNotification(uid: string, notification: {
    title: string;
    message: string;
    type?: string;
    metadata?: any;
  }): Promise<string> {
    const notifRef = db().collection('notifications').doc();
    await notifRef.set({
      uid,
      ...notification,
      read: false,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, title: notification.title }, 'Notification created');
    return notifRef.id;
  }

  async getUserNotifications(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection('notifications')
      .where('uid', '==', uid)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // Optimized method for notifications subcollection structure used in routes
  async getUserNotificationsFromSubcollection(uid: string, limit: number = 50): Promise<any[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    try {
      // Try new subcollection path first (notifications/{uid}/items)
      const snapshot = await db()
        .collection('notifications')
        .doc(uid)
        .collection('items')
        .orderBy('timestamp', 'desc')
        .limit(safeLimit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
      }));
    } catch (err: any) {
      // Fallback to old path (users/{uid}/notifications)
      const snapshot = await db()
        .collection('users')
        .doc(uid)
        .collection('notifications')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
      }));
    }
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await db().collection('notifications').doc(notificationId).update({
      read: true,
      readAt: admin.firestore.Timestamp.now(),
    });
  }

  async getUnreadNotificationCount(uid: string): Promise<number> {
    const snapshot = await db()
      .collection('notifications')
      .where('uid', '==', uid)
      .where('read', '==', false)
      .get();
    return snapshot.size;
  }

  // ========== ADMIN COLLECTION METHODS ==========
  async createAdmin(uid: string, adminData: {
    email: string;
    permissions?: string[];
    role?: string;
  }): Promise<void> {
    const adminRef = db().collection('admin').doc(uid);
    await adminRef.set({
      uid,
      ...adminData,
      createdAt: admin.firestore.Timestamp.now(),
    });
    logger.info({ uid, email: adminData.email }, 'Admin created');
  }

  async getAdmin(uid: string): Promise<any | null> {
    const doc = await db().collection('admin').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async isAdmin(uid: string): Promise<boolean> {
    const userDoc = await db().collection('users').doc(uid).get();
    if (!userDoc.exists) return false;
    const data: any = userDoc.data() || {};
    return data.role === 'admin' || data.isAdmin === true;
  }

  async getAllAdmins(): Promise<any[]> {
    const snapshot = await db().collection('admin').get();
    return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  }

  // ========== SETTINGS COLLECTION METHODS (global) ==========
  async getGlobalSettings(): Promise<any | null> {
    const doc = await db().collection('settings').doc('global').get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async updateGlobalSettings(settings: {
    maintenanceMode?: boolean;
    exchangeExecution?: boolean;
    hftMode?: boolean;
    riskThresholds?: any;
    uiThemeDefaults?: any;
    [key: string]: any;
  }): Promise<void> {
    const settingsRef = db().collection('settings').doc('global');
    await settingsRef.set({
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.info('Global settings updated');
  }

  // ========== LOGS COLLECTION METHODS (system logs) ==========
  async saveSystemLog(logData: {
    type: string;
    message: string;
    level?: 'info' | 'warn' | 'error';
    metadata?: any;
  }): Promise<void> {
    const logRef = db().collection('logs').doc();
    await logRef.set({
      ...logData,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ type: logData.type }, 'System log saved');
  }

  async getSystemLogs(limit: number = 100): Promise<any[]> {
    const snapshot = await db()
      .collection('logs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== UI PREFERENCES COLLECTION METHODS ==========
  async getUserUIPreferences(uid: string): Promise<any | null> {
    const doc = await db().collection('uiPreferences').doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async updateUIPreferences(uid: string, preferences: {
    dismissedAgents?: string[];
    hideDashboardCard?: string[];
    theme?: 'light' | 'dark';
    sidebarPinned?: boolean;
    [key: string]: any;
  }): Promise<void> {
    const prefsRef = db().collection('uiPreferences').doc(uid);
    await prefsRef.set({
      uid,
      ...preferences,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.debug({ uid }, 'UI preferences updated');
  }

  async updateIntegrationUsageStats(uid: string, providerId: string, stats: any): Promise<void> {
    const docRef = db().collection('users').doc(uid).collection('integrations').doc(providerId);
    await docRef.set({
      usageStats: stats,
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });
  }

  // ========== API USAGE TRACKING METHODS ==========
  async getApiUsage(userId: string): Promise<any | null> {
    try {
      const doc = await db().collection('apiUsage').doc(userId).get();
      if (!doc.exists) return null;
      return { userId: doc.id, ...doc.data() };
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to get API usage');
      return null;
    }
  }

  async saveApiUsage(userId: string, usage: any): Promise<void> {
    try {
      const usageRef = db().collection('apiUsage').doc(userId);
      await usageRef.set({
        ...usage,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      logger.debug({ userId }, 'API usage saved');
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to save API usage');
      throw error;
    }
  }

  // ========== GLOBAL STATS COLLECTION METHODS ==========
  async getGlobalStats(): Promise<any | null> {
    // PART A: Use 'main' as doc ID
    const doc = await db().collection('globalStats').doc('main').get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async updateGlobalStats(stats: {
    totalUsers?: number;
    totalTrades?: number;
    totalAgentsUnlocked?: number;
    runningEngines?: number;
    runningHFT?: number;
    totalPnl?: number;
    [key: string]: any;
  }): Promise<void> {
    // PART A: Use 'main' as doc ID
    const statsRef = db().collection('globalStats').doc('main');
    await statsRef.set({
      ...stats,
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });
    logger.debug('Global stats updated');
  }

  // ========== AUTO-TRADE SPECIFIC METHODS ==========
  async getActiveTrades(uid: string, limit: number = 50): Promise<any[]> {
    // PERFORMANCE OPTIMIZATION: Avoid composite index dependency
    // Use single where clause on uid and filter status in memory
    try {
      const snapshot = await db()
        .collection('trades')
        .where('uid', '==', uid)
        .orderBy('timestamp', 'desc')
        .limit(limit * 2) // Fetch more to account for filtering
        .get();

      // Filter for open status in memory (no composite index required)
      const activeTrades = snapshot.docs
        .filter(doc => doc.data().status === 'open')
        .slice(0, limit) // Apply limit after filtering
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            symbol: data.symbol,
            side: data.side,
            entryPrice: data.entryPrice,
            currentPrice: data.currentPrice,
            pnl: data.pnl,
            pnlPercent: data.pnlPercent,
            stopLoss: data.stopLoss,
            takeProfit: data.takeProfit,
            accuracyAtEntry: data.signalAccuracy,
            status: data.status,
            entryTime: data.timestamp?.toDate?.()?.toISOString() || new Date(data.timestamp).toISOString(),
            ...data,
          };
        });

      return activeTrades;

      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          symbol: data.symbol,
          side: data.side,
          entryPrice: data.entryPrice,
          currentPrice: data.currentPrice,
          pnl: data.pnl,
          pnlPercent: data.pnlPercent,
          stopLoss: data.stopLoss,
          takeProfit: data.takeProfit,
          accuracyAtEntry: data.signalAccuracy,
          status: data.status,
          entryTime: data.timestamp?.toDate?.()?.toISOString() || new Date(data.timestamp).toISOString(),
          ...data,
        };
      });
    } catch (error: any) {
      logger.warn({ uid, error: error.message }, 'Error fetching active trades from trades collection, falling back to autoTradeActiveTrades');
      // Fallback to old collection for backward compatibility
      const snapshot = await db()
        .collection('users')
        .doc(uid)
        .collection('autoTradeActiveTrades')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
    }
  }

  async getAutoTradeActivity(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeActivity')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  /**
   * Save pending trade for user confirmation
   */
  async savePendingTrade(uid: string, tradeData: {
    requestId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    accuracy: number;
    researchRequestId?: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<string> {
    const docRef = db()
      .collection('users')
      .doc(uid)
      .collection('pendingTrades')
      .doc(tradeData.requestId);

    const payload = {
      ...tradeData,
      status: 'PENDING',
      createdAt: admin.firestore.Timestamp.fromDate(tradeData.createdAt),
      expiresAt: admin.firestore.Timestamp.fromDate(tradeData.expiresAt),
      updatedAt: admin.firestore.Timestamp.now(),
    };
    const sanitizedPayload = sanitizeFirestorePayload(payload);

    await docRef.set(sanitizedPayload);

    logger.info({ uid, requestId: tradeData.requestId, symbol: tradeData.symbol }, 'Pending trade saved');
    return docRef.id;
  }

  /**
   * Get pending trades for a user
   * REFACTORED: Filter expiration in-memory to avoid composite index requirement
   */
  async getPendingTrades(uid: string): Promise<any[]> {
    try {
      const now = admin.firestore.Timestamp.now();
      const snapshot = await db()
        .collection('users')
        .doc(uid)
        .collection('pendingTrades')
        .where('status', '==', 'PENDING')
        // .where('expiresAt', '>', now) // Removed to avoid composite index requirement (status + expiresAt)
        // .orderBy('expiresAt', 'asc')
        .get();

      if (snapshot.empty) return [];

      const pendingTrades = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
          expiresAt: doc.data().expiresAt?.toDate?.()?.toISOString(),
          _expiresAtTimestamp: doc.data().expiresAt // Internal use for sorting/filtering
        }))
        .filter(trade => {
          // Filter expired trades in memory
          if (!trade._expiresAtTimestamp) return true; // Keep if no expiry
          return trade._expiresAtTimestamp.toMillis() > now.toMillis();
        })
        .sort((a, b) => {
          // Sort by expiration ascending
          if (!a._expiresAtTimestamp) return 1;
          if (!b._expiresAtTimestamp) return -1;
          return a._expiresAtTimestamp.toMillis() - b._expiresAtTimestamp.toMillis();
        });

      // Remove internal field before returning
      return pendingTrades.map(({ _expiresAtTimestamp, ...trade }) => trade);
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to fetch pending trades');
      return [];
    }
  }

  /**
   * Update pending trade status (APPROVED or REJECTED)
   */
  async updatePendingTradeStatus(uid: string, requestId: string, status: 'APPROVED' | 'REJECTED'): Promise<void> {
    const docRef = db()
      .collection('users')
      .doc(uid)
      .collection('pendingTrades')
      .doc(requestId);

    await docRef.update({
      status,
      updatedAt: admin.firestore.Timestamp.now(),
      resolvedAt: admin.firestore.Timestamp.now(),
    });

    logger.info({ uid, requestId, status }, 'Pending trade status updated');
  }

  async getTradeProposals(uid: string): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeProposals')
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  async getAutoTradeLogs(uid: string, limit: number = 100): Promise<any[]> {
    const snapshot = await db()
      .collection('users')
      .doc(uid)
      .collection('autoTradeLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // ========== TRADING SETTINGS METHODS ==========
  async getTradingSettings(uid: string): Promise<any> {
    try {
      const doc = await db()
        .collection('users')
        .doc(uid)
        .collection('settings')
        .doc('trading')
        .get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        ...data,
        updatedAt: data?.updatedAt?.toDate().toISOString(),
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting trading settings');
      throw error;
    }
  }

  async saveTradingSettings(uid: string, settings: any): Promise<any> {
    try {
      const settingsDoc = {
        ...settings,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // CRITICAL: Runtime Guard Check
      this.guardAgainstIllegalWrites(`users/${uid}/settings/trading`, settingsDoc, 'background_job');

      await db()
        .collection('users')
        .doc(uid)
        .collection('settings')
        .doc('trading')
        .set(settingsDoc, { merge: true });

      logger.info({ uid, settings }, 'Trading settings saved');
      return settings;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error saving trading settings');
      throw error;
    }
  }

  /**
   * Save prediction snapshot for accuracy tracking
   */
  async savePredictionMetrics(uid: string, snapshotData: any): Promise<void> {
    try {
      const docRef = db().collection('users').doc(uid).collection('predictions').doc();
      const payload = {
        ...snapshotData,
        id: docRef.id
      };
      const sanitizedPayload = sanitizeFirestorePayload(payload);

      await docRef.set(sanitizedPayload);
      logger.debug({ uid, predictionId: docRef.id }, 'Prediction snapshot saved');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error saving prediction snapshot');
      throw error;
    }
  }

  /**
   * Get prediction snapshot by requestId
   */
  async getPredictionSnapshot(requestId: string): Promise<any> {
    try {
      // Search across all users (simplified - in production you'd want better indexing)
      const usersRef = db().collection('users');
      const usersSnapshot = await usersRef.listDocuments();

      for (const userRef of usersSnapshot) {
        const predictionRef = userRef.collection('predictions').where('requestId', '==', requestId);
        const predictionSnapshot = await predictionRef.get();

        if (!predictionSnapshot.empty) {
          const doc = predictionSnapshot.docs[0];
          return { ...doc.data(), id: doc.id };
        }
      }

      return null;
    } catch (error: any) {
      logger.error({ error: error.message, requestId }, 'Error getting prediction snapshot');
      throw error;
    }
  }

  /**
   * Update prediction outcome
   */
  async updatePredictionOutcome(requestId: string, outcome: any): Promise<void> {
    try {
      // Find and update the prediction document
      const snapshot = await this.getPredictionSnapshot(requestId);
      if (snapshot) {
        const userRef = db().collection('users').doc(snapshot.userId);
        await userRef.collection('predictions').doc(snapshot.id).update({
          outcome,
          completedAt: new Date()
        });
      }
      logger.debug({ requestId }, 'Prediction outcome updated');
    } catch (error: any) {
      logger.error({ error: error.message, requestId }, 'Error updating prediction outcome');
      throw error;
    }
  }

  /**
   * Update accuracy calibration buckets
   */
  async updateAccuracyCalibration(uid: string, bucketKey: number, win: boolean): Promise<void> {
    try {
      const calibrationRef = db().collection('users').doc(uid).collection('calibration').doc('accuracy');
      const calibrationDoc = await calibrationRef.get();
      const currentData = calibrationDoc.exists ? calibrationDoc.data() || {} : {};

      // Initialize bucket if it doesn't exist
      if (!currentData[bucketKey]) {
        currentData[bucketKey] = { total: 0, wins: 0 };
      }

      // Update bucket stats
      currentData[bucketKey].total += 1;
      if (win) currentData[bucketKey].wins += 1;

      await calibrationRef.set(currentData);
      logger.debug({ uid, bucketKey, win }, 'Accuracy calibration updated');
    } catch (error: any) {
      logger.error({ error: error.message, uid, bucketKey }, 'Error updating accuracy calibration');
      throw error;
    }
  }

  /**
   * Get accuracy history and calibration stats
   */
  async getAccuracyHistory(uid: string, filters: { strategy?: string; symbol?: string; limit?: number }): Promise<any> {
    try {
      let query: any = db().collection('users').doc(uid).collection('predictions');

      if (filters.symbol) {
        query = query.where('symbol', '==', filters.symbol);
      }

      if (filters.strategy) {
        query = query.where('strategy', '==', filters.strategy);
      }

      query = query.orderBy('timestamp', 'desc').limit(filters.limit || 100);

      const snapshot = await query.get();
      const predictions = snapshot.docs.map((doc: any) => ({ ...doc.data(), id: doc.id }));

      // Get calibration data
      const calibrationRef = db().collection('users').doc(uid).collection('calibration').doc('accuracy');
      const calibrationDoc = await calibrationRef.get();
      const calibrationData = calibrationDoc.exists ? calibrationDoc.data() || {} : {};

      // Calculate rolling accuracy
      const totalPredictions = predictions.length;
      const winningPredictions = predictions.filter((p: any) => p.outcome?.win).length;
      const rollingAccuracy = totalPredictions > 0 ? (winningPredictions / totalPredictions) * 100 : 0;

      return {
        rollingAccuracy: Math.round(rollingAccuracy * 100) / 100,
        totalPredictions,
        winningPredictions,
        calibrationBuckets: calibrationData,
        recentPredictions: predictions.slice(0, 20) // Return last 20 for display
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting accuracy history');
      throw error;
    }
  }

  /**
   * Get user provider settings
   */
  async getUserProviderSettings(uid: string): Promise<any> {
    try {
      const doc = await db().collection('users').doc(uid).collection('settings').doc('providers').get();
      if (!doc.exists) {
        return null;
      }
      return doc.data();
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting user provider settings');
      throw error;
    }
  }

  /**
   * Save user provider settings
   */
  async saveUserProviderSettings(uid: string, settings: any): Promise<void> {
    try {
      await db().collection('users').doc(uid).collection('settings').doc('providers').set({
        ...settings,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (error: any) {
      logger.error({ error: error.message, uid, settings }, 'Error saving user provider settings');
      throw error;
    }
  }

  /**
   * Get exchange config for a user
   *
   * WARNING: keysClearedReason and keysClearedAt fields should NEVER be used
   * for usability decisions in non-exchange_connect contexts. Use isExchangeUsable()
   * instead, which properly ignores these legacy fields.
   *
   * If exchangeStatus === 'CONNECTED', legacy fields MUST be ignored completely.
   */
  async getExchangeConfig(uid: string): Promise<any> {
    try {
      const doc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
      if (!doc.exists) {
        return null;
      }

      const data = doc.data();

      // HARD LOGGING: Track getExchangeConfig calls
      logger.error({
        uid,
        exchangeStatus: data?.exchangeStatus,
        keysClearedReason: data?.keysClearedReason,
        keysClearedAt: data?.keysClearedAt,
        hasLegacyFields: !!(data?.keysClearedReason || data?.keysClearedAt),
        context: 'getExchangeConfig'
      }, '[EXCHANGE_RUNTIME_PROOF] getExchangeConfig called');

      // RUNTIME PROTECTION: Strip legacy poison fields from CONNECTED exchanges
      // NO Firestore writes during READ operations - just protect runtime usage
      if (data?.exchangeStatus === 'CONNECTED') {
        // Strip from runtime object to prevent any usage of legacy fields
        delete data.keysClearedReason;
        delete data.keysClearedAt;

        logger.error({
          uid,
          strippedLegacyFields: true,
          context: 'getExchangeConfig'
        }, '[EXCHANGE_RUNTIME_PROTECTION] Legacy fields stripped from CONNECTED exchange');
      }

      return data;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting exchange config');
      return null;
    }
  }

  /**
   * DEPRECATED: Legacy exchange credentials method - DO NOT USE
   * Exchange credentials are now stored in users/{uid}/exchangeConfig/current
   * This method is disabled to prevent data corruption and inconsistencies
   */
  async saveExchangeCredentials(uid: string, exchange: string, credentials: {
    apiKey: string;
    secret: string;
    passphrase?: string;
    testnet: boolean;
  }): Promise<void> {
    throw new Error(`DEPRECATED: saveExchangeCredentials() is no longer supported. Exchange credentials must be saved to users/${uid}/exchangeConfig/current only.`);
  }

  /**
   * Get exchange credentials for a user - UPDATED for new system
   * Reads from users/{uid}/exchangeConfig/current and returns credentials
   * only if the stored exchange matches the requested exchange
   */
  async getExchangeCredentials(uid: string, exchange: string): Promise<any> {
    try {
      const doc = await db().collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
      if (!doc.exists) {
        return null;
      }
      const config = doc.data();
      if (!config || config.exchange !== exchange) {
        return null;
      }
      // Return credentials in the expected format
      return {
        apiKey: config.apiKeyEncrypted,
        secretKeyEncrypted: config.secretKeyEncrypted || config.secretEncrypted,
        passphrase: config.passphraseEncrypted,
        testnet: config.testnet
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid, exchange }, 'Error getting exchange credentials from new system');
      throw error;
    }
  }

  /**
   * DEPRECATED: Legacy exchange credentials method - DO NOT USE
   * Exchange credentials are now stored in users/{uid}/exchangeConfig/current
   * This method is disabled to prevent data corruption and inconsistencies
   */
  async deleteExchangeCredentials(uid: string, exchange: string): Promise<void> {
    throw new Error(`DEPRECATED: deleteExchangeCredentials() is no longer supported. Exchange credentials must be managed in users/${uid}/exchangeConfig/current only.`);
  }

  /**
   * Store the latest successful research result for a user
   * Used to share research results between UI and Auto-Trade
   */
  async storeLatestResearchResult(uid: string, researchResult: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);

      await userRef.collection('researchCache').doc('latest').set({
        researchResult,
        timestamp: admin.firestore.Timestamp.now(),
        source: 'ui_research'
      });

      logger.info({ uid, symbol: researchResult.symbol }, '✅ [RESEARCH_CACHE] Stored latest research result');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, '❌ [RESEARCH_CACHE] Failed to store latest research result');
      // Don't throw - caching failure shouldn't break research
    }
  }

  /**
   * Get the latest successful research result for a user
   * Returns null if no cached result or result is too old (>5 minutes)
   */
  async getLatestResearchResult(uid: string): Promise<any | null> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);
      const cacheDoc = await userRef.collection('researchCache').doc('latest').get();

      if (!cacheDoc.exists) {
        return null;
      }

      const cacheData = cacheDoc.data();
      if (!cacheData) {
        return null;
      }

      const cacheTime = cacheData.timestamp.toDate();
      const now = new Date();
      const ageMinutes = (now.getTime() - cacheTime.getTime()) / (1000 * 60);

      // Cache expires after 5 minutes
      if (ageMinutes > 5) {
        logger.info({ uid, ageMinutes }, '📅 [RESEARCH_CACHE] Cached research result expired');
        return null;
      }

      logger.info({ uid, ageMinutes: ageMinutes.toFixed(1) }, '✅ [RESEARCH_CACHE] Retrieved valid cached research result');
      return cacheData.researchResult;
    } catch (error: any) {
      logger.error({ uid, error: error.message }, '❌ [RESEARCH_CACHE] Failed to retrieve latest research result');
      return null;
    }
  }

  /**
   * Clear the cached research result for a user
   */
  async clearLatestResearchResult(uid: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);

      await userRef.collection('researchCache').doc('latest').delete();
      logger.info({ uid }, '🗑️ [RESEARCH_CACHE] Cleared cached research result');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, '❌ [RESEARCH_CACHE] Failed to clear cached research result');
      // Don't throw - clearing failure shouldn't break anything
    }
  }

  /**
   * Store research history entry for a user
   */
  async storeResearchHistory(uid: string, historyEntry: any): Promise<void> {
    // HARD BLOCK: ERROR_CYCLE must NEVER be written for AUTO_TRADE source
    if (historyEntry.symbol === 'ERROR_CYCLE' && historyEntry.source === 'AUTO_TRADE') {
      logger.error({
        uid,
        symbol: historyEntry.symbol,
        source: historyEntry.source,
        entry: historyEntry
      }, '🚫 [ARCHITECTURE_VIOLATION] ERROR_CYCLE BLOCKED for AUTO_TRADE source - this should NEVER happen');
      throw new Error('ARCHITECTURE_VIOLATION: ERROR_CYCLE not allowed for AUTO_TRADE source');
    }

    // DEBUG: Log ERROR_CYCLE writes to catch any remaining violations
    if (historyEntry.symbol === 'ERROR_CYCLE') {
      console.log('🔥 [FIRESTORE_DEBUG] ERROR_CYCLE being written:', {
        uid,
        source: historyEntry.source,
        skipReason: historyEntry.skipReason,
        error: historyEntry.error
      });
    }

    // CRITICAL: Validate required fields before attempting Firestore write
    // AUTO_TRADE SKIPPED entries: Allow missing accuracy and symbol (they track research cycles)
    // TELEGRAM entries: Require accuracy for all entries, require symbol for non-SKIPPED
    if (historyEntry.source === 'AUTO_TRADE' && historyEntry.status === 'SKIPPED') {
      // AUTO_TRADE SKIPPED: Allow missing accuracy and symbol - these are research cycle trackers
      // No validation needed, proceed with save
    } else {
      // TELEGRAM or AUTO_TRADE EXECUTED: Require accuracy
      if (typeof historyEntry.accuracy !== 'number' || isNaN(historyEntry.accuracy)) {
        logger.warn({ uid, symbol: historyEntry.symbol, source: historyEntry.source, status: historyEntry.status }, 'Skipping history save - accuracy is missing or invalid');
        return; // Skip save cleanly, do NOT throw
      }

      // Require symbol for non-SKIPPED entries
      if (!historyEntry.symbol && historyEntry.status !== 'SKIPPED') {
        logger.warn({ uid, source: historyEntry.source, status: historyEntry.status }, 'Skipping history save - symbol is missing and status is not SKIPPED');
        return; // Skip save cleanly for non-SKIPPED entries without symbol
      }
    }

    // TEMPORARY DEBUG LOGGING: Log before saving history
    console.log("🔥 [HISTORY_DEBUG] BEFORE save", {
      uid,
      source: historyEntry.source,
      symbol: historyEntry.symbol,
      accuracy: historyEntry.accuracy,
      status: historyEntry.status,
      skipReason: historyEntry.skipReason,
      timestamp: new Date().toISOString()
    });

    // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE ATTEMPT
    console.log("🔥 [FIRESTORE_HISTORY] BEFORE write", {
      uid,
      symbol: historyEntry.symbol,
      firestorePath: `users/${uid}/research_history`,
      entry: historyEntry,
      timestamp: new Date().toISOString()
    });

    try {
      // CRITICAL: Sanitize entry to remove any undefined values before Firestore write
      const sanitizedEntry = this.sanitizeForFirestore(historyEntry);

      const result = await db().collection('users')
        .doc(uid)
        .collection('research_history')
        .add({
          ...sanitizedEntry,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

      // TEMPORARY DEBUG LOGGING: Log after successful save
      console.log("🔥 [HISTORY_DEBUG] AFTER save success", {
        uid,
        source: historyEntry.source,
        symbol: historyEntry.symbol,
        accuracy: historyEntry.accuracy,
        status: historyEntry.status,
        skipReason: historyEntry.skipReason,
        docId: result.id,
        timestamp: new Date().toISOString()
      });

      // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE SUCCESS
      console.log("🔥 [FIRESTORE_HISTORY] AFTER write success", {
        uid,
        symbol: historyEntry.symbol,
        docId: result.id,
        timestamp: new Date().toISOString()
      });

      logger.info({ uid, symbol: historyEntry.symbol }, '✅ [FIRESTORE] Research history entry saved');
    } catch (error: any) {
      // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE FAILURE
      console.log("🔥 [FIRESTORE_HISTORY] AFTER write failure", {
        uid,
        symbol: historyEntry.symbol,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      logger.error({ uid, error: error.message }, '❌ [FIRESTORE] Failed to save research history');
    }
  }

  /**
   * Update existing research history entry
   */
  async updateResearchHistory(uid: string, historyId: string, updates: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const historyRef = db.collection('users').doc(uid).collection('research_history').doc(historyId);

      await historyRef.update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now()
      });

      logger.debug({ uid, historyId }, '✅ [HISTORY_UPDATE] Research history entry updated');
    } catch (error: any) {
      logger.error({ uid, historyId, error: error.message }, '❌ [HISTORY_UPDATE] Failed to update research history');
      throw error;
    }
  }

  /**
   * Retrieve research history for a user
   * OPTIMIZED: Returns lightweight version for list view performance
   * Uses select() to only fetch required fields from Firestore
   */
  async getResearchHistory(uid: string, limit: number = 50): Promise<any[]> {
    try {
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const snapshot = await db().collection('users')
        .doc(uid)
        .collection('research_history')
        .select('symbol', 'signal', 'accuracy', 'price', 'timestamp', 'source', 'status', 'decision', 'executionStatus', 'tradePlan', 'skipReason')
        .orderBy('timestamp', 'desc')
        .limit(safeLimit)
        .get();

      return snapshot.docs.map(doc => {
        const data = doc.data();

        // CRITICAL OPTIMIZATION: Exclude heavy nested objects for list view performance
        // Keep only essential fields needed for history list display
        const { indicators, analysis, tradePlan, ...lightweightData } = data;

        // Normalize status based on source
        let normalizedStatus;
        if (data.source === 'AUTO_TRADE') {
          // AUTO_TRADE: Use status field AS-IS, or force SKIPPED if skipReason exists
          if (data.status) {
            normalizedStatus = data.status;
          } else if (data.skipReason) {
            normalizedStatus = 'SKIPPED';
          } else {
            normalizedStatus = 'UNKNOWN';
          }
        } else {
          // TELEGRAM: Use existing normalization logic
          normalizedStatus = data.decision === 'EXECUTED' ? 'COMPLETED' :
            data.decision === 'SKIPPED' ? 'SKIPPED' :
              data.executionStatus === 'SUCCESS' ? 'COMPLETED' :
                data.executionStatus === 'FAILED' ? 'FAILED' :
                  data.status || 'UNKNOWN';
        }

        return {
          id: doc.id,
          ...lightweightData,
          // Convert Firestore Timestamp to ISO string
          timestamp: data.timestamp?.toDate ? data.timestamp.toDate().toISOString() : new Date().toISOString(),
          // Use normalized status
          status: normalizedStatus,
          // Include minimal tradePlan info for display (exclude nested objects)
          tradePlan: tradePlan ? {
            entryPrice: tradePlan.entryPrice,
            stopLoss: tradePlan.stopLoss,
            takeProfit: tradePlan.takeProfit || tradePlan.takeProfit2,
            takeProfit1: tradePlan.takeProfit1,
            takeProfit2: tradePlan.takeProfit2,
            takeProfit3: tradePlan.takeProfit3
          } : null
        };
      });
    } catch (error: any) {
      logger.error({ uid, error: error.message }, '❌ [FIRESTORE] Failed to retrieve research history');
      return [];
    }
  }
}

export async function saveMarketSnapshot({
  topMovers,
  source
}: {
  topMovers: any[];
  source: string;
}) {
  const docRef = db().collection('system').doc('marketSnapshots');
  await docRef.set(
    {
      topMovers,
      source,
      snapshotTimestamp: new Date().toISOString(),
    },
    { merge: true }
  );
}

export const firestoreAdapter = new FirestoreAdapter();

