import * as admin from "firebase-admin";
import { getFirebaseAdmin } from "../utils/firebase";
import { logger } from "../utils/logger";
import { encrypt, decrypt, maskKey, getEncryptionKeyHash } from "./keyManager";


const db = () => getFirebaseAdmin().firestore();


// REMOVED: shouldAutoClearKeys function
// Background jobs can NEVER write exchange status, and user requests don't auto-clear keys
// This function was causing confusion and is no longer needed

/**
 * Sanitize Firestore payload by removing undefined values and converting them to FieldValue.delete()
 */
function sanitizeFirestorePayload(payload: any): any {
  const sanitized: any = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      sanitized[key] = admin.firestore.FieldValue.delete();
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// WARN when non-canonical exchange config paths are accessed
export function warnNonCanonicalExchangeConfigAccess(
  uid: string,
  accessedPath: string,
  context: string,
): void {
  const canonicalPath = `users/${uid}/exchangeConfig/current`;
  if (accessedPath !== canonicalPath) {
    logger.warn(
      {
        uid,
        accessedPath,
        canonicalPath,
        context,
        warning: "NON_CANONICAL_EXCHANGE_CONFIG_ACCESS",
      },
      `⚠️ NON_CANONICAL_EXCHANGE_CONFIG_ACCESS: ${context} accessed ${accessedPath} instead of ${canonicalPath}`,
    );
  }
}

// CRITICAL: Write guard for exchange config - ONLY canonical path allowed
export function assertExchangeConfigWritePath(
  uid: string,
  attemptedPath: string,
): void {
  const canonicalPath = `users/${uid}/exchangeConfig/current`;

  if (attemptedPath !== canonicalPath) {
    logger.error(
      {
        uid,
        attemptedPath,
        canonicalPath,
        blocked: true,
      },
      "LEGACY_EXCHANGE_WRITE_ATTEMPT_BLOCKED",
    );

    // CRITICAL: Block the write by throwing
    throw new Error(
      `EXCHANGE_CONFIG_WRITE_BLOCKED: Only canonical path allowed. Attempted: ${attemptedPath}, Required: ${canonicalPath}`,
    );
  }

  logger.debug(
    {
      uid,
      writePath: canonicalPath,
      canonical: true,
    },
    "EXCHANGE_CONFIG_WRITE_TO_CANONICAL_PATH_VERIFIED",
  );
}



// ===== HARDENING METHODS =====





export async function getDailySafetyCounters(agentId: string): Promise<{
  consecutiveLosses: number;
  dailyPnL: number;
  tradesToday: number;
  lastResetDate: Date;
}> {
    try {
      const db = getFirebaseAdmin().firestore();
      const doc = await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('dailyCounters')
        .doc('current')
        .get();

      if (!doc.exists) {
        return {
          consecutiveLosses: 0,
          dailyPnL: 0,
          tradesToday: 0,
          lastResetDate: new Date()
        };
      }

      const data = doc.data();
      const lastResetDate = data?.lastResetDate ? data.lastResetDate.toDate() : new Date();

      // Check if we need to reset counters (UTC day change)
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const lastReset = new Date(lastResetDate.getFullYear(), lastResetDate.getMonth(), lastResetDate.getDate());

      if (today > lastReset) {
        // Reset counters for new day
        await resetDailySafetyCounters(agentId);
        return {
          consecutiveLosses: 0,
          dailyPnL: 0,
          tradesToday: 0,
          lastResetDate: now
        };
      }

      return {
        consecutiveLosses: data?.consecutiveLosses || 0,
        dailyPnL: data?.dailyPnL || 0,
        tradesToday: data?.tradesToday || 0,
        lastResetDate
      };
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to get daily safety counters');
      // Return safe defaults
      return {
        consecutiveLosses: 0,
        dailyPnL: 0,
        tradesToday: 0,
        lastResetDate: new Date()
      };
    }
  }

export async function updateDailySafetyCounters(
  agentId: string,
  updates: {
    consecutiveLosses?: number;
    dailyPnL?: number;
    tradesToday?: number;
    }
  ): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const now = new Date();

      await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('dailyCounters')
        .doc('current')
        .set({
          ...updates,
          lastResetDate: admin.firestore.Timestamp.fromDate(now),
          updatedAt: admin.firestore.Timestamp.now()
        }, { merge: true });

      logger.debug({ agentId, updates }, 'Daily safety counters updated');
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to update daily safety counters');
      throw error;
    }
  }

export async function resetDailySafetyCounters(agentId: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const now = new Date();

      await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('dailyCounters')
        .doc('current')
        .set({
          consecutiveLosses: 0,
          dailyPnL: 0,
          tradesToday: 0,
          lastResetDate: admin.firestore.Timestamp.fromDate(now),
          updatedAt: admin.firestore.Timestamp.now()
        });

      logger.info({ agentId }, 'Daily safety counters reset');
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to reset daily safety counters');
      throw error;
    }
  }

  /**
   * Get per-pair cooldown timestamp
   */
export async function getPairCooldown(agentId: string, tradingPair: string): Promise<Date | null> {
    try {
      const db = getFirebaseAdmin().firestore();
      const doc = await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('cooldowns')
        .doc(tradingPair)
        .get();

      if (!doc.exists) return null;

      const data = doc.data();
      return data?.cooldownUntil ? data.cooldownUntil.toDate() : null;
    } catch (error: any) {
      logger.error({ error: error.message, agentId, tradingPair }, 'Failed to get pair cooldown');
      return null;
    }
  }

  /**
   * Set per-pair cooldown timestamp
   */
export async function setPairCooldown(agentId: string, tradingPair: string, cooldownUntil: Date): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('cooldowns')
        .doc(tradingPair)
        .set({
          cooldownUntil: admin.firestore.Timestamp.fromDate(cooldownUntil),
          setAt: admin.firestore.Timestamp.now()
        });

      logger.debug({ agentId, tradingPair, cooldownUntil: cooldownUntil.toISOString() }, 'Pair cooldown set');
    } catch (error: any) {
      logger.error({ error: error.message, agentId, tradingPair }, 'Failed to set pair cooldown');
      throw error;
    }
  }

// SHARED exchange usability guard for all major code paths
/**
 * Update cached flags for control-plane routes
 * Called by background processes only - NEVER from routes
 */
export async function updateCachedFlags(uid: string): Promise<void> {
  try {
    // Check exchange configuration
    const exchangeUsable = await isExchangeUsable(uid, "background_job");
    const exchangeConfigured = exchangeUsable.usable;

    // Check provider configuration (lightweight check)
    const dbInstance = db();
    const integrationsSnapshot = await dbInstance
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .limit(1)
      .get();
    const providersConfigured = !integrationsSnapshot.empty;

    // Update cached flags
    await firestoreAdapter.saveBackgroundResearchSettings(uid, {
      exchangeConfigured,
      providersConfigured,
      lastExchangeValidationAt: admin.firestore.Timestamp.now(),
      lastProviderValidationAt: admin.firestore.Timestamp.now(),
    });

    logger.debug(
      {
        uid,
        exchangeConfigured,
        providersConfigured,
      },
      "CACHED_FLAGS_UPDATED_BY_BACKGROUND_PROCESS",
    );
  } catch (error: any) {
    logger.warn(
      {
        uid,
        error: error.message,
      },
      "FAILED_TO_UPDATE_CACHED_FLAGS",
    );
  }
}

// Trading Agent Methods (standalone exported functions)
export async function getLastProcessedCandle(agentId: string, tradingPair: string): Promise<Date | null> {
    try {
      const db = getFirebaseAdmin().firestore();
      const doc = await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('executionState')
        .doc(`candle_${tradingPair}`)
        .get();

      if (!doc.exists) return null;

      const data = doc.data();
      return data?.lastProcessedCandle ? new Date(data.lastProcessedCandle.toDate()) : null;
    } catch (error: any) {
      logger.error({ error: error.message, agentId, tradingPair }, 'Failed to get last processed candle');
      return null;
    }
}

export async function updateLastProcessedCandle(agentId: string, tradingPair: string, candleTimestamp: Date): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db
        .collection('tradingAgents')
        .doc(agentId)
        .collection('executionState')
        .doc(`candle_${tradingPair}`)
        .set({
          lastProcessedCandle: admin.firestore.Timestamp.fromDate(candleTimestamp),
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

      logger.debug({ agentId, tradingPair, candleTimestamp: candleTimestamp.toISOString() }, 'Last processed candle updated');
    } catch (error: any) {
      logger.error({ error: error.message, agentId, tradingPair }, 'Failed to update last processed candle');
      throw error;
    }
}

export async function isSignalExecuted(agentId: string, signalId: string): Promise<boolean> {
    try {
      const db = getFirebaseAdmin().firestore();
      const signalDoc = await db
        .collection('agentTrades')
        .where('agentId', '==', agentId)
        .where('signalId', '==', signalId)
        .limit(1)
        .get();

      return !signalDoc.empty;
    } catch (error: any) {
      logger.error({ error: error.message, agentId, signalId }, 'Failed to check signal execution');
      return false;
    }
}

export async function getCurrentPositionCount(agentId: string): Promise<{ pairPositions: number; totalPositions: number }> {
    try {
      const db = getFirebaseAdmin().firestore();
      const openTradesSnapshot = await db
        .collection('agentTrades')
        .where('agentId', '==', agentId)
        .where('status', '==', 'OPEN')
        .get();

      let totalPositions = 0;
      const pairPositions: { [pair: string]: number } = {};

      openTradesSnapshot.forEach(doc => {
        const trade = doc.data();
        totalPositions++;
        const pair = trade.tradingPair || 'UNKNOWN';
        pairPositions[pair] = (pairPositions[pair] || 0) + 1;
      });

      return {
        pairPositions: Object.keys(pairPositions).length,
        totalPositions,
      };
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to get current position count');
      return { pairPositions: 0, totalPositions: 0 };
    }
}

export async function isExchangeUsable(
  uid: string,
  context: "background_job" | "user_request",
): Promise<{ usable: boolean; reason: string; exchange?: string }> {
  // Standardize context - treat anything other than "user_request" as "background_job"
  const standardContext =
    context === "user_request" ? "user_request" : "background_job";

  // PURE READ-ONLY FUNCTION: NEVER write to Firestore
  if (standardContext !== "user_request") {
    // DO NOT decrypt, DO NOT validate keys
    // Simply check if exchangeConfig/current exists with basic fields
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("exchangeConfig")
      .doc("current")
      .get();

    if (!doc.exists) {
      return {
        usable: false,
        reason: "not_connected",
      };
    }

    const config = doc.data();
    if (!config) {
      return {
        usable: false,
        reason: "not_connected",
      };
    }

    // Check if user has explicitly disconnected
    if (config.disconnected === true) {
      return {
        usable: false,
        reason: "disconnected",
        exchange: config.exchange,
      };
    }

    // LEGACY SAFETY: Strip legacy fields if present (read-only cleanup)
    const cleanConfig = { ...config };
    if (cleanConfig.exchangeStatus !== undefined) {
      delete cleanConfig.exchangeStatus;
    }
    if (cleanConfig.keysClearedAt !== undefined) {
      delete cleanConfig.keysClearedAt;
    }
    if (cleanConfig.keysClearedReason !== undefined) {
      delete cleanConfig.keysClearedReason;
    }

    const exchange = (cleanConfig.exchange && typeof cleanConfig.exchange === 'string')
      ? cleanConfig.exchange.toLowerCase().trim()
      : null;

    // For background jobs: Check if required encrypted fields exist (DO NOT decrypt)
    // This allows us to determine if exchange is configured without expensive decryption
    const hasApiKey = !!cleanConfig.apiKeyEncrypted;
    const hasSecret = !!(cleanConfig.secretKeyEncrypted || cleanConfig.secretEncrypted);
    const hasExchange = !!exchange;

    if (!hasApiKey || !hasSecret || !hasExchange) {
      return {
        usable: false,
        reason: "not_connected",
        exchange: exchange || undefined,
      };
    }

    // Exchange config exists with all required fields
    return {
      usable: true,
      reason: "connected",
      exchange: exchange || undefined,
    };
  }

  // USER REQUEST CONTEXT: Full decryption and validation
  // ENFORCE: ONLY canonical path - users/{uid}/exchangeConfig/current
  const canonicalPath = `users/${uid}/exchangeConfig/current`;
  const doc = await db()
    .collection("users")
    .doc(uid)
    .collection("exchangeConfig")
    .doc("current")
    .get();

  // Log canonical path usage once per request
  logger.debug(
    {
      uid,
      firestorePathUsed: canonicalPath,
      canonical: true,
    },
    "EXCHANGE_CONFIG_READ_FROM_CANONICAL_PATH",
  );

  if (!doc.exists) {
    logger.info(
      {
        uid,
        canonicalPath,
        reason: "EXCHANGE_CONFIG_MISSING_AT_CANONICAL_PATH",
      },
      "EXCHANGE_CONFIG_MISSING_AT_CANONICAL_PATH - treating as NOT_USABLE",
    );
    return { usable: false, reason: "not_connected" };
  }

  const config = doc.data();
  if (!config) {
    return { usable: false, reason: "not_connected" };
  }

  // LEGACY SAFETY: Strip legacy fields if present (read-only cleanup)
  const cleanConfig = { ...config };
  if (cleanConfig.exchangeStatus !== undefined) {
    delete cleanConfig.exchangeStatus;
  }
  if (cleanConfig.keysClearedAt !== undefined) {
    delete cleanConfig.keysClearedAt;
  }
  if (cleanConfig.keysClearedReason !== undefined) {
    delete cleanConfig.keysClearedReason;
  }

  // Check if user has explicitly disconnected
  if (cleanConfig.disconnected === true) {
    return {
      usable: false,
      reason: "disconnected",
      exchange: cleanConfig.exchange,
    };
  }

  const exchange = (cleanConfig.exchange || "").toLowerCase().trim();

  // CRITICAL: Check for encrypted keys presence BEFORE attempting decryption
  // EMPTY/MISSING encrypted keys = NOT_CONNECTED (not decryption failure)
  const hasApiKey = cleanConfig.apiKeyEncrypted &&
    typeof cleanConfig.apiKeyEncrypted === 'string' &&
    cleanConfig.apiKeyEncrypted.trim().length > 0;
  const hasSecretKey = (cleanConfig.secretKeyEncrypted &&
    typeof cleanConfig.secretKeyEncrypted === 'string' &&
    cleanConfig.secretKeyEncrypted.trim().length > 0) ||
    (cleanConfig.secretEncrypted &&
      typeof cleanConfig.secretEncrypted === 'string' &&
      cleanConfig.secretEncrypted.trim().length > 0);

  if (!hasApiKey || !hasSecretKey) {
    logger.debug(
      { uid, context, exchange, hasApiKey, hasSecretKey },
      "USER_REQUEST: Encrypted keys missing or empty - returning not_connected (NOT decryption failure)",
    );
    return { usable: false, reason: "not_connected", exchange };
  }
  if (!["binance", "bitget", "bingx", "weex"].includes(exchange)) {
    return {
      usable: false,
      reason: `Unsupported exchange: ${exchange}`,
      exchange,
    };
  }

  // CRITICAL: Test actual decryption to verify usability (USER REQUEST ONLY)
  // DO NOT rely on cached exchangeStatus - always test current decryption capability
  try {
    const { decrypt, getEncryptionKeyStatus } = await import("./keyManager");

    // Verify encryption key is properly initialized
    const keyStatus = getEncryptionKeyStatus();
    if (!keyStatus.initialized) {
      logger.error(
        {
          uid,
          exchange,
          keyStatus,
        },
        "EXCHANGE_DECRYPTION_FAILED: Encryption key not initialized - server startup issue",
      );
      return {
        usable: false,
        reason: "not_connected",
        exchange,
      };
    }

    const apiKey = decrypt(cleanConfig.apiKeyEncrypted, standardContext);
    const secret = decrypt(
      cleanConfig.secretKeyEncrypted || cleanConfig.secretEncrypted,
      standardContext,
    );
    const passphrase = cleanConfig.passphraseEncrypted
      ? decrypt(cleanConfig.passphraseEncrypted, standardContext)
      : undefined;

    // Log detailed decryption results for diagnosis
    const isBitget = exchange === "bitget";
    const passphraseValid = isBitget
      ? passphrase !== null || !config.passphraseEncrypted
      : true;
    const decryptionValid =
      apiKey !== null && secret !== null && passphraseValid;

    // Log decryption details for troubleshooting
    logger.info(
      {
        uid,
        exchange,
        decryptionValid,
        apiKeyDecrypted: apiKey !== null,
        secretDecrypted: secret !== null,
        passphraseRequired: isBitget,
        passphraseDecrypted: isBitget
          ? passphrase !== null || !cleanConfig.passphraseEncrypted
          : "N/A",
        passphraseFieldExists: !!cleanConfig.passphraseEncrypted,
        apiKeyLength: cleanConfig.apiKeyEncrypted?.length || 0,
        secretLength:
          (cleanConfig.secretKeyEncrypted || cleanConfig.secretEncrypted)?.length || 0,
        passphraseLength: cleanConfig.passphraseEncrypted?.length || 0,
        encryptionKeyHash: keyStatus.keyHash,
        encryptionKeyInitialized: keyStatus.initialized,
      },
      "EXCHANGE_DECRYPTION_DIAGNOSIS",
    );

    // CRITICAL: NEVER write INVALID_KEYS or clear keys in isExchangeUsable
    // This function reports usability ONLY - status writes happen in POST /exchange/connect
    // INVARIANT: isExchangeUsable is READ-ONLY - it never mutates Firestore
    const result = {
      usable: decryptionValid,
      reason: decryptionValid ? "connected" : "not_connected",
      exchange,
    };

    // Log exchange usability decision once per request
    logger.info(
      {
        uid,
        exchange,
        usable: result.usable,
        reason: result.reason,
      },
      `EXCHANGE_USABILITY_CHECKED: ${result.usable ? "USABLE" : "NOT_USABLE"} - ${result.reason}`,
    );

    return result;
  } catch (error: any) {
    // CRITICAL: Decryption exceptions are NOT credential validation failures
    // NEVER write INVALID_KEYS here - only in POST /exchange/connect
    logger.warn(
      {
        uid,
        exchange,
        error: error.message,
      },
      "EXCHANGE_DECRYPTION_EXCEPTION: Decryption failed - NOT writing INVALID_KEYS (invariant protection)",
    );

    const result = {
      usable: false,
      reason: "not_connected",
      exchange,
    };

    logger.warn(
      {
        uid,
        exchange,
        error: error.message,
      },
      `EXCHANGE_USABILITY_CHECKED: NOT_USABLE - ${result.reason}`,
    );

    return result;
  }
}

/**
 * CRITICAL SAFETY ASSERTION: Background jobs can NEVER write exchange status
 * This is a permanent guard against background job state mutations
 */
function assertBackgroundJobCannotWriteExchangeStatus(context: string, operation: string): void {
  if (context === "background_job") {
    const errorMsg = `FATAL INVARIANT VIOLATION: Background job attempted ${operation} on exchange status. Background jobs are READ-ONLY for exchange state.`;
    logger.error({ context, operation }, errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * GLOBAL INVARIANT: Prevent ANY background job from writing exchangeStatus or INVALID_KEYS
 * This function MUST be called before ANY Firestore write that could affect exchangeStatus
 */
export function assertNoExchangeStatusWriteInBackground(context: string, operation: string): void {
  if (context === "background_job") {
    const errorMsg = `CRITICAL SECURITY VIOLATION: Background job attempted to write exchange status during ${operation}. This is FORBIDDEN.`;
    console.error(`🚨 [FATAL_SECURITY_VIOLATION] ${errorMsg}`);
    logger.error({
      context,
      operation,
      securityViolation: true,
      forbiddenOperation: "exchange_status_write"
    }, errorMsg);
    console.error('   HARD ERROR: Write protection invariant triggered by assertNoExchangeStatusWriteInBackground. [PROOF]');
    throw new Error(errorMsg);
  }
}

/**
 * COMPREHENSIVE FIRESTORE GUARD: Intercept ALL writes to exchangeConfig collection
 * This is a final safety net that blocks background jobs from writing ANYTHING to exchangeConfig
 */
function createExchangeConfigWriteGuard(): void {
  // This guard is installed at module load time
  const originalDb = db;
  // Note: This is a runtime guard that would need to be implemented at the Firestore adapter level
  // For now, we rely on explicit guards in all write functions
}

/**
 * FINAL SAFETY NET: Global exchangeConfig write blocker for background jobs
 * This function wraps ALL Firestore operations that could modify exchangeConfig
 */
export async function safeExchangeConfigWrite(
  uid: string,
  operation: () => Promise<any>,
  context: "background_job" | "user_request",
  operationName: string
): Promise<any> {
  // CRITICAL: Block ALL background job writes to exchangeConfig
  if (context === "background_job") {
    const errorMsg = `BLOCKED: Background job attempted exchangeConfig write during ${operationName}. Background jobs are READ-ONLY.`;
    console.error(`🚫 [EXCHANGE_CONFIG_WRITE_BLOCKED] ${errorMsg}`);
    logger.error({
      uid,
      context,
      operation: operationName,
      blocked: true
    }, errorMsg);
    throw new Error(errorMsg);
  }

  // Allow user-initiated writes
  return await operation();
}

/**
 * ONE-TIME RECOVERY UTILITY: Clear encrypted exchange keys when decryption fails
 * Forces user to reconnect exchange, preventing silent failures
 * Should be called when decryptOrThrow fails for exchange keys
 */
// REMOVED: clearInvalidExchangeKeys function
// INVALID_KEYS is no longer a stored state - it's computed by isExchangeUsable()
// This function is permanently removed to prevent any INVALID_KEYS writes

/**
 * CRITICAL SAFEGUARD: Prevent any attempt to write INVALID_KEYS to exchange config
 * This function should be called before any Firestore write to exchangeConfig
 */
export function assertNoInvalidKeysWrite(data: any, operation: string): void {
  if (!data || typeof data !== 'object') return;
  
  // Check for direct INVALID_KEYS assignment
  for (const [key, value] of Object.entries(data)) {
    if (value === 'INVALID_KEYS') {
      const errorMsg = `🚨 [INVALID_KEYS_WRITE_ATTEMPT] ${operation} attempted to write INVALID_KEYS to field "${key}"`;
      console.error(errorMsg);
      console.error('   Payload:', JSON.stringify(data, null, 2));
      console.error('   Stack trace:', new Error().stack);
      throw new Error(errorMsg);
    }
  }
  
  // Check for forbidden field names
  const forbiddenFields = ['exchangeStatus', 'keysClearedAt', 'keysClearedReason'];
  for (const field of forbiddenFields) {
    if (field in data) {
      const errorMsg = `🚨 [FORBIDDEN_FIELD_WRITE] ${operation} attempted to write forbidden field "${field}"`;
      console.error(errorMsg);
      console.error('   Payload:', JSON.stringify(data, null, 2));
      console.error('   Stack trace:', new Error().stack);
      throw new Error(errorMsg);
    }
  }
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
    mode: "MANUAL" | "TOP_100" | "TOP_10";
    manualCoins: string[];
    maxPositionPerTrade: number;
    tradeType: "Scalping" | "Swing" | "Position";
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
      sensitivity?: "low" | "medium" | "high";
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
  signal: "BUY" | "SELL" | "HOLD";
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
  action: "EXECUTED" | "SKIPPED";
  reason?: string;
  accuracy?: number;
  accuracyUsed?: number; // The accuracy value used for decision
  orderId?: string;
  orderIds?: string[]; // Multiple order IDs for market making
  executionLatency?: number;
  slippage?: number;
  pnl?: number;
  strategy?: string;
  signal?: "BUY" | "SELL" | "HOLD";
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
  tradeType: "Scalping" | "Swing" | "Position";
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
  side?: "BUY" | "SELL";
  reason?: string;
  strategy: string;
  status?: string;
  createdAt: admin.firestore.Timestamp;
}

export class FirestoreAdapter {
  // ===== TRADING AGENT METHODS =====

  /**
   * Create a new trading agent request
   */
  async createTradingAgentRequest(agentData: {
    userId: string;
    name: string;
    tradingPair: 'BTC/USDT' | 'ETH/USDT';
    marketType: 'spot' | 'futures';
  }): Promise<string> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const agentRef = db.collection('tradingAgents').doc(agentId);
      await agentRef.set({
        id: agentId,
        ...agentData,
        status: 'PENDING_APPROVAL',
        riskPerTrade: 1.0, // 1% default
        maxConcurrentTrades: 1,
        maxTradesPerDay: 6,
        createdAt: admin.firestore.Timestamp.now(),
        dailyTrades: 0,
        consecutiveLosses: 0,
        dailyPnL: 0,
        totalPnL: 0,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        drawdown: 0
      });

      logger.info({ agentId, userId: agentData.userId }, 'Trading agent request created');
      return agentId;
    } catch (error: any) {
      logger.error({ error: error.message, userId: agentData.userId }, 'Failed to create trading agent request');
      throw error;
    }
  }

  /**
   * Approve a trading agent request
   */
  async approveTradingAgentRequest(agentId: string, adminId: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentRef = db.collection('tradingAgents').doc(agentId);

      await db.runTransaction(async (transaction) => {
        const agentDoc = await transaction.get(agentRef);
        const agentData: any = agentDoc.data() || {};
        const requestedByUid = agentData.userId || agentData.requestedBy || agentData.requestedByUid;

        transaction.update(agentRef, {
          status: 'ACTIVE',
          approvedAt: admin.firestore.Timestamp.now(),
          approvedBy: adminId,
        });

        if (requestedByUid) {
          const userRef = db.collection('users').doc(requestedByUid);
          transaction.set(
            userRef,
            {
              unlockedAgents: admin.firestore.FieldValue.arrayUnion('TRADING_AGENT'),
            },
            { merge: true },
          );

          // Also create the specific user-agent linkage document
          const userAgentRef = db.collection('users').doc(requestedByUid).collection('agents').doc('trading-agent');
          transaction.set(
            userAgentRef,
            {
              agentId: 'trading-agent',
              status: 'ACTIVE',
              createdAt: admin.firestore.Timestamp.now(),
              unlocked: true,
              unlockedAt: admin.firestore.Timestamp.now(),
            },
            { merge: true },
          );
        }
      });

      logger.info({ agentId, adminId }, 'Trading agent request approved');
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to approve trading agent request');
      throw error;
    }
  }

  /**
   * Reject a trading agent request
   */
  async rejectTradingAgentRequest(agentId: string, adminId: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentRef = db.collection('tradingAgents').doc(agentId);

      await agentRef.update({
        status: 'REJECTED',
        rejectedAt: admin.firestore.Timestamp.now(),
        rejectedBy: adminId
      });

      logger.info({ agentId, adminId }, 'Trading agent request rejected');
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to reject trading agent request');
      throw error;
    }
  }

  /**
   * Get all active trading agents
   */
  async getActiveTradingAgents(): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentsSnapshot = await db
        .collection('tradingAgents')
        .where('status', '==', 'ACTIVE')
        .get();

      const agents: any[] = [];
      agentsSnapshot.forEach(doc => {
        agents.push(doc.data());
      });

      return agents;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get active trading agents');
      return [];
    }
  }

  /**
   * Get trading agent configuration
   */
  async getTradingAgentConfig(agentId: string): Promise<any | null> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentDoc = await db.collection('tradingAgents').doc(agentId).get();

      if (!agentDoc.exists) {
        return null;
      }

      return agentDoc.data();
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to get trading agent config');
      return null;
    }
  }

  /**
   * Update trading agent status
   */
  async updateAgentStatus(agentId: string, status: 'ACTIVE' | 'PAUSED' | 'STOPPED'): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentRef = db.collection('tradingAgents').doc(agentId);

      await agentRef.update({
        status,
        updatedAt: admin.firestore.Timestamp.now()
      });

      logger.info({ agentId, status }, 'Trading agent status updated');
    } catch (error: any) {
      logger.error({ error: error.message, agentId, status }, 'Failed to update agent status');
      throw error;
    }
  }

  /**
   * Update trading agent configuration
   */
  async updateAgentConfig(agentId: string, updates: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentRef = db.collection('tradingAgents').doc(agentId);

      await agentRef.update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now()
      });

      logger.info({ agentId }, 'Trading agent config updated');
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to update agent config');
      throw error;
    }
  }

  /**
   * Save agent trade record
   */
  async saveAgentTrade(trade: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const tradeRef = db.collection('agentTrades').doc(trade.id);

      await tradeRef.set({
        ...trade,
        createdAt: admin.firestore.Timestamp.now()
      });

      logger.info({ tradeId: trade.id, agentId: trade.agentId }, 'Agent trade saved');
    } catch (error: any) {
      logger.error({ error: error.message, tradeId: trade.id }, 'Failed to save agent trade');
      throw error;
    }
  }

  /**
   * Update agent trade status
   */
  async updateTradeStatus(tradeId: string, status: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const tradeRef = db.collection('agentTrades').doc(tradeId);

      await tradeRef.update({
        status,
        updatedAt: admin.firestore.Timestamp.now(),
      });
    } catch (error: any) {
      logger.error({ error: error.message, tradeId, status }, 'Failed to update agent trade status');
      throw error;
    }
  }

  /**
   * Get agent trades
   */
  async getAgentTrades(agentId: string, limit: number = 50): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const tradesSnapshot = await db
        .collection('agentTrades')
        .where('agentId', '==', agentId)
        .orderBy('entryTime', 'desc')
        .limit(limit)
        .get();

      const trades: any[] = [];
      tradesSnapshot.forEach(doc => {
        trades.push(doc.data());
      });

      return trades;
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to get agent trades');
      return [];
    }
  }

  async getDailySafetyCounters(agentId: string): Promise<{
    consecutiveLosses: number;
    dailyPnL: number;
    tradesToday: number;
    lastResetDate: Date;
  }> {
    return getDailySafetyCounters(agentId);
  }

  async updateDailySafetyCounters(
    agentId: string,
    updates: {
      consecutiveLosses?: number;
      dailyPnL?: number;
      tradesToday?: number;
    },
  ): Promise<void> {
    return updateDailySafetyCounters(agentId, updates);
  }

  async resetDailySafetyCounters(agentId: string): Promise<void> {
    return resetDailySafetyCounters(agentId);
  }

  async getPairCooldown(agentId: string, tradingPair: string): Promise<Date | null> {
    return getPairCooldown(agentId, tradingPair);
  }

  async setPairCooldown(agentId: string, tradingPair: string, cooldownUntil: Date): Promise<void> {
    return setPairCooldown(agentId, tradingPair, cooldownUntil);
  }

  async getLastProcessedCandle(agentId: string, tradingPair: string): Promise<Date | null> {
    return getLastProcessedCandle(agentId, tradingPair);
  }

  async updateLastProcessedCandle(agentId: string, tradingPair: string, candleTimestamp: Date): Promise<void> {
    return updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
  }

  async isSignalExecuted(agentId: string, signalId: string): Promise<boolean> {
    return isSignalExecuted(agentId, signalId);
  }

  async getCurrentPositionCount(agentId: string): Promise<{ pairPositions: number; totalPositions: number }> {
    return getCurrentPositionCount(agentId);
  }

  /**
   * Get user's trading agents
   */
  async getUserTradingAgents(userId: string): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const agentsSnapshot = await db
        .collection('tradingAgents')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .get();

      const agents: any[] = [];
      agentsSnapshot.forEach(doc => {
        agents.push(doc.data());
      });

      return agents;
    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to get user trading agents');
      return [];
    }
  }

  // ===== VWAP STATE PERSISTENCE METHODS =====

  /**
   * Save VWAP agent state to Firestore
   * Path: users/{uid}/agents/vwap_strategy
   */
  async saveVWAPAgentState(uid: string, state: {
    agentId: string;
    userId: string;
    status: 'STOPPED' | 'RUNNING';
    strategyType: 'VWAP_MEAN_REVERSION';
    exchange?: string;
    startedAt?: Date;
    lastHeartbeat?: Date;
    stoppedAt?: Date;
    stoppedReason?: string;
    stoppedForDayKey?: string;
    dayKey?: string;
    dayStartEquity?: number;
  }): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const docRef = db.collection('users').doc(uid).collection('agents').doc('vwap_strategy');

      const firestoreData: any = {
        agentId: state.agentId,
        userId: state.userId,
        status: state.status,
        strategyType: state.strategyType,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Add optional fields if present
      if (state.exchange !== undefined) firestoreData.exchange = state.exchange;
      if (state.startedAt) firestoreData.startedAt = admin.firestore.Timestamp.fromDate(state.startedAt);
      if (state.lastHeartbeat) firestoreData.lastHeartbeat = admin.firestore.Timestamp.fromDate(state.lastHeartbeat);
      if (state.stoppedAt) firestoreData.stoppedAt = admin.firestore.Timestamp.fromDate(state.stoppedAt);
      if (state.stoppedReason !== undefined) firestoreData.stoppedReason = state.stoppedReason;
      if (state.stoppedForDayKey !== undefined) firestoreData.stoppedForDayKey = state.stoppedForDayKey;
      if (state.dayKey !== undefined) firestoreData.dayKey = state.dayKey;
      if (state.dayStartEquity !== undefined) firestoreData.dayStartEquity = state.dayStartEquity;

      await docRef.set(firestoreData, { merge: true });

      logger.debug({ uid, status: state.status }, 'VWAP agent state saved to Firestore');
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to save VWAP agent state');
      // Don't throw - allow in-memory state to continue working
    }
  }

  /**
   * Get VWAP agent state from Firestore
   * Path: users/{uid}/agents/vwap_strategy
   */
  async getVWAPAgentState(uid: string): Promise<{
    agentId: string;
    userId: string;
    status: 'STOPPED' | 'RUNNING';
    strategyType: 'VWAP_MEAN_REVERSION';
    exchange?: string;
    startedAt?: Date;
    lastHeartbeat?: Date;
    stoppedAt?: Date;
    stoppedReason?: string;
    stoppedForDayKey?: string;
    dayKey?: string;
    dayStartEquity?: number;
  } | null> {
    try {
      const db = getFirebaseAdmin().firestore();
      const docRef = db.collection('users').doc(uid).collection('agents').doc('vwap_strategy');
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      if (!data) return null;

      return {
        agentId: data.agentId,
        userId: data.userId,
        status: data.status || 'STOPPED',
        strategyType: data.strategyType || 'VWAP_MEAN_REVERSION',
        exchange: data.exchange,
        startedAt: data.startedAt?.toDate(),
        lastHeartbeat: data.lastHeartbeat?.toDate(),
        stoppedAt: data.stoppedAt?.toDate(),
        stoppedReason: data.stoppedReason,
        stoppedForDayKey: data.stoppedForDayKey,
        dayKey: data.dayKey,
        dayStartEquity: data.dayStartEquity,
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Failed to get VWAP agent state');
      return null;
    }
  }

  /**
   * Get all running VWAP agents from Firestore
   * Queries all users for agents/vwap_strategy documents where status === 'RUNNING'
   */
  async getAllRunningVWAPAgents(): Promise<Array<{
    agentId: string;
    userId: string;
    status: 'STOPPED' | 'RUNNING';
    strategyType: 'VWAP_MEAN_REVERSION';
    exchange?: string;
    startedAt?: Date;
    lastHeartbeat?: Date;
    stoppedAt?: Date;
    stoppedReason?: string;
    stoppedForDayKey?: string;
    dayKey?: string;
    dayStartEquity?: number;
  }>> {
    try {
      const db = getFirebaseAdmin().firestore();
      
      // Use collection group query to find all vwap_strategy documents across all users
      const snapshot = await db.collectionGroup('agents')
        .where('strategyType', '==', 'VWAP_MEAN_REVERSION')
        .where('status', '==', 'RUNNING')
        .get();

      const runningAgents: any[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        runningAgents.push({
          agentId: data.agentId,
          userId: data.userId,
          status: data.status,
          strategyType: data.strategyType || 'VWAP_MEAN_REVERSION',
          exchange: data.exchange,
          startedAt: data.startedAt?.toDate(),
          lastHeartbeat: data.lastHeartbeat?.toDate(),
          stoppedAt: data.stoppedAt?.toDate(),
          stoppedReason: data.stoppedReason,
          stoppedForDayKey: data.stoppedForDayKey,
          dayKey: data.dayKey,
          dayStartEquity: data.dayStartEquity,
        });
      });

      logger.info({ count: runningAgents.length }, 'Retrieved running VWAP agents from Firestore');
      return runningAgents;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get all running VWAP agents');
      return [];
    }
  }

  /**
   * Get pending trading agent requests (for admin)
   */
  async getPendingTradingAgentRequests(): Promise<any[]> {
    try {
      const db = getFirebaseAdmin().firestore();
      const requestsSnapshot = await db
        .collection('tradingAgents')
        .where('status', '==', 'PENDING_APPROVAL')
        .orderBy('createdAt', 'desc')
        .get();

      const requests: any[] = [];
      requestsSnapshot.forEach(doc => {
        requests.push(doc.data());
      });

      return requests;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get pending trading agent requests');
      return [];
    }
  }

  // Warm start function to pre-load Firestore cache at startup
  async warmStart(): Promise<void> {
    try {
      logger.info("Starting Firestore cache warm-up...");

      // Touch agents collection
      await db().collection("agents").limit(1).get();

      // Touch a sample user document to warm settings and notifications
      // We'll use a dummy query that should be fast
      const sampleQuery = await db().collection("users").limit(1).get();
      if (!sampleQuery.empty) {
        const sampleUid = sampleQuery.docs[0].id;

        // Touch settings subcollection
        await db()
          .collection("users")
          .doc(sampleUid)
          .collection("settings")
          .limit(1)
          .get();

        // Touch notifications subcollection
        await db()
          .collection("notifications")
          .doc(sampleUid)
          .collection("items")
          .limit(1)
          .get();
      }

      logger.info("Firestore cache warm-up completed");
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        "Firestore cache warm-up failed, continuing...",
      );
    }
  }

  /**
   * CRITICAL: Prevent ANY code from writing notification settings to wrong locations.
   * As per requirements, all notification settings MUST be in users/{uid}/settings/current.
   */
  public guardAgainstIllegalWrites(path: string, data: any) {
    const restrictedKeys = [
      "notifications",
      "notificationSettings",
      "enableAutoTradeAlerts",
      "enableAccuracyAlerts",
      "enableWhaleAlerts",
      "tradeConfirmationRequired",
      "notificationSounds",
      "notificationVibration",
    ];

    const isSettingsCurrent = path.includes("/settings/current");

    // Check if any restricted key is present in the data being written
    for (const key of restrictedKeys) {
      if (data && data[key] !== undefined) {
        // If it's NOT the authorized path, throw HARD error
        if (!isSettingsCurrent) {
          logger.error(
            { path, key, data },
            "🚨 HARD ERROR: Attempted to write notification fields outside authorized path",
          );
          throw new Error(
            `ILLEGAL_WRITE: Field "${key}" can only be written to users/{uid}/settings/current. Path attempted: ${path}`,
          );
        }
      }
    }
  }

  // API Keys
  async saveApiKey(
    uid: string,
    keyData: {
      exchange: string;
      name: string;
      apiKey: string;
      apiSecret: string;
      testnet: boolean;
    },
  ): Promise<string> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("apikeys")
      .doc();

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
    logger.info({ uid, keyId: docRef.id }, "API key saved to Firestore");
    return docRef.id;
  }

  async getApiKeys(uid: string): Promise<ApiKeyDocument[]> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("apikeys")
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as ApiKeyDocument,
    );
  }

  async getApiKey(uid: string, keyId: string): Promise<ApiKeyDocument | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("apikeys")
      .doc(keyId)
      .get();

    if (!doc.exists) return null;

    return {
      id: doc.id,
      ...doc.data(),
    } as ApiKeyDocument;
  }

  async updateApiKey(
    uid: string,
    keyId: string,
    updates: Partial<{
      name: string;
      apiKey: string;
      apiSecret: string;
      testnet: boolean;
    }>,
  ): Promise<void> {
    const updateData: any = {
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (updates.name) updateData.name = updates.name;
    if (updates.apiKey) updateData.apiKeyEncrypted = encrypt(updates.apiKey);
    if (updates.apiSecret)
      updateData.apiSecretEncrypted = encrypt(updates.apiSecret);
    if (updates.testnet !== undefined) updateData.testnet = updates.testnet;

    await db()
      .collection("users")
      .doc(uid)
      .collection("apikeys")
      .doc(keyId)
      .update(updateData);

    logger.info({ uid, keyId }, "API key updated in Firestore");
  }

  async deleteApiKey(uid: string, keyId: string): Promise<void> {
    await db()
      .collection("users")
      .doc(uid)
      .collection("apikeys")
      .doc(keyId)
      .delete();

    logger.info({ uid, keyId }, "API key deleted from Firestore");
  }

  async getLatestApiKey(
    uid: string,
    exchange: string,
  ): Promise<ApiKeyDocument | null> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("apikeys")
      .where("exchange", "==", exchange)
      .orderBy("updatedAt", "desc")
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
      return obj.map((item) => this.sanitizeForFirestore(item));
    }
    if (typeof obj === "object" && obj.constructor === Object) {
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
  async saveSettings(
    uid: string,
    settings: Partial<SettingsDocument>,
  ): Promise<void> {
    try {
      const docRef = db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("current");

      // CRITICAL: Get existing document first to merge properly
      const existingDoc = await docRef.get();
      const existingData = existingDoc.exists ? existingDoc.data() || {} : {};

      // CRITICAL: Deep merge for structured notification objects to prevent partial overwrites
      const mergedNotifications = settings.notifications
        ? {
          ...(existingData.notifications || {}),
          ...settings.notifications,
        }
        : existingData.notifications;

      const mergedNotificationSettings = settings.notificationSettings
        ? {
          ...(existingData.notificationSettings || {}),
          ...settings.notificationSettings,
        }
        : existingData.notificationSettings;

      const mergedTradingSettings = settings.tradingSettings
        ? {
          ...(existingData.tradingSettings || {}),
          ...settings.tradingSettings,
        }
        : existingData.tradingSettings;

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
        logger.info(
          {
            uid,
            hasNotifications: !!settings.notifications,
            hasNotificationSettings: !!settings.notificationSettings,
            notificationsPayload: settings.notifications
              ? JSON.stringify(settings.notifications)
              : undefined,
          },
          "🔔 [NOTIFICATION_WRITE] Writing notification objects to users/{uid}/settings/current",
        );
      }

      // CRITICAL: Runtime Guard Check
      this.guardAgainstIllegalWrites(
        `users/${uid}/settings/current`,
        sanitized,
      );

      // CRITICAL: Use set() with merge: true, but sanitized data has no undefined values
      await docRef.set(sanitized, { merge: true });

      logger.info({ uid }, "Settings saved to Firestore");
    } catch (error: any) {
      logger.error(
        { uid, error: error.message, stack: error.stack },
        "Failed to save settings to Firestore",
      );
      // Re-throw to allow route handlers to return 500
      throw error;
    }
  }

  async getSettings(uid: string): Promise<SettingsDocument | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("settings")
      .doc("current")
      .get();

    if (!doc.exists) return null;

    return doc.data() as SettingsDocument;
  }

  // Research Logs
  async saveResearchLog(
    uid: string,
    research: Omit<ResearchLogDocument, "id" | "createdAt">,
  ): Promise<string> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("researchLogs")
      .doc();

    const doc: ResearchLogDocument = {
      ...research,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.debug(
      { uid, symbol: research.symbol, accuracy: research.accuracy },
      "Research log saved",
    );
    return docRef.id;
  }

  async getResearchLogs(
    uid: string,
    limit: number = 100,
  ): Promise<ResearchLogDocument[]> {
    // Get logs from both researchLogs collection (scheduled research) and old research collection
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("researchLogs")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as ResearchLogDocument,
    );
  }

  // Execution Logs
  async saveExecutionLog(
    uid: string,
    execution: Omit<ExecutionLogDocument, "id" | "createdAt">,
  ): Promise<string> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("executionLogs")
      .doc();

    const doc: ExecutionLogDocument = {
      ...execution,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info(
      { uid, action: execution.action, symbol: execution.symbol },
      "Execution log saved",
    );
    return docRef.id;
  }

  async getExecutionLogs(
    uid: string,
    limit: number = 100,
  ): Promise<ExecutionLogDocument[]> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("executionLogs")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as ExecutionLogDocument,
    );
  }

  // Integrations
  async getIntegration(
    uid: string,
    apiName: string,
  ): Promise<IntegrationDocument | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .doc(apiName)
      .get();

    if (!doc.exists) return null;

    return doc.data() as IntegrationDocument;
  }

  async getAllIntegrations(
    uid: string,
  ): Promise<Record<string, IntegrationDocument>> {
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
    snapshot.forEach((doc) =>
      console.log("[INT-LOAD DOC]", doc.id, doc.data()),
    );

    if (snapshot.size === 0) {
      console.log("[INT-LOAD] FIRESTORE CLIENT =", firestore.constructor.name);
      if (firestore.constructor.name.toLowerCase().includes("mock")) {
        console.log(
          "[INT-LOAD WARNING] Using mock Firestore - data will always be empty",
        );
      }
      try {
        const cols = await firestore
          .collection("users")
          .doc(uid)
          .listCollections();
        console.log(
          "[INT DEBUG DOCS] Listing all subcollections:",
          cols.map((c) => c.id),
        );
      } catch (err: any) {
        console.log(
          "[INT DEBUG DOCS] Failed to list subcollections:",
          err?.message,
        );
      }
    }

    console.log(
      "[FIRESTORE_INTEGRATIONS]",
      uid,
      snapshot.docs.map((d) => d.id),
    );

    const out: Record<string, any> = {};

    // FIX: Include ALL providers from providerConfig.ts sets to prevent filtering issues
    const OFFICIAL_PROVIDERS = new Set<string>([
      // Market Data Providers
      "cryptocompare",
      "bybit",
      "okx",
      "kucoin",
      "bitget",
      "coinstats",
      "livecoinwatch",
      "marketaux",
      "kaiko",
      "messari",
      "coinapi",
      "coinmarketcap",
      "coinlore",
      "coincheckup",
      "bravenewcoin",

      // News Providers
      "newsdata",
      "cryptopanic",
      "reddit",
      "webzio",
      "gnews",
      "newscatcher",
      "coinstatsnews",
      "altcoinbuzz_rss",
      "cointelegraph_rss",

      // Metadata Providers
      "coingecko",
      "coinpaprika",
      "coincap",
    ]);
    // FIX: Consistent provider type mapping matching providerConfig.ts
    const PROVIDER_TYPES: Record<string, "marketdata" | "news" | "metadata"> = {
      // Market Data Providers (normalized to lowercase)
      cryptocompare: "marketdata",
      bybit: "marketdata",
      okx: "marketdata",
      kucoin: "marketdata",
      bitget: "marketdata",
      coinstats: "marketdata",
      livecoinwatch: "marketdata",
      marketaux: "marketdata",
      kaiko: "marketdata",
      messari: "marketdata",
      coinapi: "marketdata",
      coinmarketcap: "marketdata",
      coinlore: "marketdata",
      coincheckup: "marketdata",
      bravenewcoin: "marketdata",

      // News Providers
      newsdata: "news",
      cryptopanic: "news",
      reddit: "news",
      webzio: "news",
      gnews: "news",
      newscatcher: "news",
      coinstatsnews: "news",
      altcoinbuzz_rss: "news",
      cointelegraph_rss: "news",

      // Metadata Providers
      coingecko: "metadata",
      coinpaprika: "metadata",
      coincap: "metadata",
    };
    const ALLOWED_TYPES = new Set(["marketdata", "news", "metadata"]);

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const providerId = (doc.id || "").toLowerCase();
      if (!OFFICIAL_PROVIDERS.has(providerId)) {
        out[providerId] = {
          ...data,
          providerName: data.providerName || providerId,
          enabled: typeof data.enabled === "boolean" ? data.enabled : false,
          type:
            data.type && ALLOWED_TYPES.has(data.type)
              ? data.type
              : data.apiType || "marketData",
          updatedAt: data.updatedAt || null,
        };
        console.log(
          "[FIRESTORE_INTEGRATIONS_UNOFFICIAL]",
          providerId,
          out[providerId],
        );
        return;
      }

      // HARD ENFORCE TYPE FOR KNOWN PROVIDERS - don't trust stored type blindly
      const rawType = data.type || data.apiType;
      const resolvedType = PROVIDER_TYPES[providerId] || "marketData";

      // SPECIAL ENFORCEMENT: CryptoCompare must ALWAYS be marketData
      const finalType =
        providerId === "cryptocompare" ? "marketData" : resolvedType;

      // WARN if type was corrected
      if (rawType && rawType !== finalType) {
        console.warn(
          `[FIRESTORE_TYPE_CORRECTION] ${providerId}: stored type "${rawType}" corrected to "${finalType}"`,
        );
      }

      console.log(
        `[FIRESTORE_TYPE_ENFORCEMENT] ${providerId}: rawType="${rawType}" → resolvedType="${finalType}"`,
      );

      const entry: any = {
        ...data,
        providerName:
          typeof data.providerName === "string" && data.providerName.trim()
            ? data.providerName
            : providerId,
        enabled: typeof data.enabled === "boolean" ? data.enabled : false,
        type: finalType, // Use the enforced type
        updatedAt: data.updatedAt || null,
      };

      // Ensure required fields always exist for downstream consumers
      entry.apiKeyEncrypted =
        data.apiKeyEncrypted !== undefined ? data.apiKeyEncrypted : null;
      entry.secretKeyEncrypted =
        data.secretKeyEncrypted !== undefined ? data.secretKeyEncrypted : null;
      entry.usageStats =
        entry.usageStats && typeof entry.usageStats === "object"
          ? entry.usageStats
          : { calls: 0 };

      // Remove any accidental plaintext leakage (do not transform or re-encrypt)
      delete (entry as any).apiKey;
      delete (entry as any).secretKey;

      out[providerId] = entry;
      console.log("[FIRESTORE_INTEGRATIONS_KEEP]", {
        providerId,
        resolvedType,
        hasApiKeyEncrypted: !!entry.apiKeyEncrypted,
        enabled: entry.enabled,
      });
    });

    return out;
  }

  async saveIntegration(
    uid: string,
    apiName: string,
    data: {
      enabled: boolean;
      apiKey?: string; // plain text, will be encrypted
      secretKey?: string; // plain text, will be encrypted (only for Binance)
      apiType?: string; // For CoinAPI type
      type?: string; // provider type: 'marketData' | 'news' | 'metadata' | 'trading'
    },
  ): Promise<void> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("integrations")
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
      docData.apiKey = encrypt(data.apiKey);
    }
    if (data.secretKey) {
      docData.secretKey = encrypt(data.secretKey);
    }
    if (data.apiType) {
      docData.apiType = data.apiType;
    }
    if (data.type) {
      docData.type = data.type;
    }

    const sanitizedDocData = sanitizeFirestorePayload(docData);
    await docRef.set(sanitizedDocData, { merge: true });
    logger.info(
      {
        uid,
        apiName,
        enabled: data.enabled,
        hasApiKey: !!data.apiKey,
        hasSecretKey: !!data.secretKey,
        hasCreatedAt: !existingDoc.exists,
      },
      "Integration saved to Firestore",
    );
  }

  async deleteIntegration(uid: string, apiName: string): Promise<void> {
    await db()
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .doc(apiName)
      .delete();

    logger.info({ uid, apiName }, "Integration deleted from Firestore");
  }

  async getEnabledIntegrations(
    uid: string,
    context: string = "user_request",
  ): Promise<Record<string, { apiKey: string; secretKey?: string }>> {
    if (context !== "user_request") {
      logger.warn(
        { uid, context },
        "BLOCKED: getEnabledIntegrations called outside user_request"
      );
      return {};
    }

    const allIntegrations = await this.getAllIntegrations(uid);
    const enabled: Record<string, { apiKey: string; secretKey?: string }> = {};

    for (const [apiName, integration] of Object.entries(allIntegrations)) {
      if (integration.enabled && integration.apiKeyEncrypted) {
        try {
          const decryptedApiKey = decrypt(integration.apiKeyEncrypted, "user_request");
          const decryptedSecretKey = integration.secretKeyEncrypted
            ? decrypt(integration.secretKeyEncrypted, "user_request")
            : undefined;

          if (decryptedApiKey && decryptedApiKey.trim() !== "") {
            enabled[apiName] = {
              apiKey: decryptedApiKey,
              ...(decryptedSecretKey && decryptedSecretKey.trim() !== ""
                ? { secretKey: decryptedSecretKey }
                : {}),
            };
            logger.debug(
              {
                uid,
                apiName,
                apiKeyLen: decryptedApiKey.length,
                hasSecret: !!decryptedSecretKey,
              },
              "Enabled integration loaded with decrypted key",
            );
          } else {
            logger.warn(
              { uid, apiName },
              "Skipping integration with invalid/empty decrypted API key",
            );
          }
        } catch (error: any) {
          logger.error(
            { error: error.message, uid, apiName },
            "Failed to decrypt integration keys, skipping",
          );
        }
      } else {
        logger.debug(
          {
            uid,
            apiName,
            enabled: integration.enabled,
            hasApiKeyEncrypted: !!integration.apiKeyEncrypted,
          },
          "Integration not enabled or missing apiKeyEncrypted, skipping for diagnostics",
        );
      }
    }

    return enabled;
  }

  // HFT Settings
  async saveHFTSettings(
    uid: string,
    settings: Partial<HFTSettingsDocument>,
  ): Promise<void> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("hftSettings")
      .doc("current");

    const payload = {
      ...settings,
      updatedAt: admin.firestore.Timestamp.now(),
    };
    const sanitizedPayload = sanitizeFirestorePayload(payload);

    await docRef.set(sanitizedPayload, { merge: true });

    logger.info({ uid }, "HFT settings saved to Firestore");
  }

  async getHFTSettings(uid: string): Promise<HFTSettingsDocument | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("hftSettings")
      .doc("current")
      .get();

    if (!doc.exists) return null;

    return doc.data() as HFTSettingsDocument;
  }

  // HFT Execution Logs
  async saveHFTExecutionLog(
    uid: string,
    execution: Omit<HFTExecutionLogDocument, "id" | "createdAt">,
  ): Promise<string> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("hftExecutionLogs")
      .doc();

    const doc: HFTExecutionLogDocument = {
      ...execution,
      createdAt: admin.firestore.Timestamp.now(),
    };

    await docRef.set(doc);
    logger.info(
      { uid, action: execution.action, symbol: execution.symbol },
      "HFT execution log saved",
    );
    return docRef.id;
  }

  async getHFTExecutionLogs(
    uid: string,
    limit: number = 100,
  ): Promise<HFTExecutionLogDocument[]> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("hftExecutionLogs")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map(
      (doc) =>
        ({
          id: doc.id,
          ...doc.data(),
        }) as HFTExecutionLogDocument,
    );
  }

  // Agent Management
  async unlockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("agents")
      .doc(agentName);

    await docRef.set(
      {
        unlocked: true,
        unlockedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );

    logger.info({ uid, agentName }, "Agent unlocked");
  }

  async lockAgent(uid: string, agentName: string): Promise<void> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("agents")
      .doc(agentName);

    await docRef.set(
      {
        unlocked: false,
        unlockedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );

    logger.info({ uid, agentName }, "Agent locked");
  }

  async getAgentStatus(
    uid: string,
    agentName: string,
  ): Promise<{
    unlocked: boolean;
    unlockedAt?: admin.firestore.Timestamp;
  } | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("agents")
      .doc(agentName)
      .get();

    if (!doc.exists) return null;

    const data = doc.data();
    return {
      unlocked: data?.unlocked || false,
      unlockedAt: data?.unlockedAt,
    };
  }

  async getAllUserAgents(
    uid: string,
  ): Promise<
    Record<
      string,
      { unlocked: boolean; unlockedAt?: admin.firestore.Timestamp }
    >
  > {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("agents")
      .get();

    const agents: Record<
      string,
      { unlocked: boolean; unlockedAt?: admin.firestore.Timestamp }
    > = {};
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
  async getUserProfile(
    uid: string,
  ): Promise<{ role?: string; email?: string;[key: string]: any } | null> {
    const doc = await db().collection("users").doc(uid).get();
    if (!doc.exists) return null;

    const data = doc.data();
    return data?.profile || {};
  }

  // --- NEW: User Statistics Management ---
  async incrementUserStat(
    uid: string,
    statKey: string,
    amount: number = 1,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const userRef = db().collection("users").doc(uid);

      // Use atomic increment
      const updateData: any = {
        [`stats.${statKey}`]: admin.firestore.FieldValue.increment(amount),
        [`stats.lastUpdated`]: admin.firestore.FieldValue.serverTimestamp(),
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
      if (err.code === 5 || err.message?.includes("NOT_FOUND")) {
        // If user doc doesn't exist or stats field issues, try set with merge
        try {
          await db()
            .collection("users")
            .doc(uid)
            .set(
              {
                stats: {
                  [statKey]: amount,
                  lastUpdated: admin.firestore.Timestamp.now(),
                  ...(metadata?.lastActivity
                    ? { lastActivity: metadata.lastActivity }
                    : {}),
                },
              },
              { merge: true },
            );
        } catch (retryErr: any) {
          logger.error(
            { uid, statKey, error: retryErr.message },
            "Failed to initialize user stats",
          );
        }
      } else {
        logger.error(
          { uid, statKey, error: err.message },
          "Failed to increment user stat",
        );
      }
    }
  }

  /**
   * Get User Stats directly
   */
  async getUserStats(uid: string): Promise<any> {
    const doc = await db().collection("users").doc(uid).get();
    if (!doc.exists) return {};
    return doc.data()?.stats || {};
  }

  async getAllUsers(): Promise<
    Array<{
      uid: string;
      email?: string;
      role?: string;
      createdAt?: admin.firestore.Timestamp;
    }>
  > {
    const snapshot = await db().collection("users").get();

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
    const userRef = db().collection("users").doc(uid);
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

    const { unlockedAgents, ...safeUserDataWithoutUnlockedAgents } = safeUserData as any;

    const updateData: any = {
      ...safeUserDataWithoutUnlockedAgents,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    if (Array.isArray(unlockedAgents) && unlockedAgents.length > 0) {
      updateData.unlockedAgents = admin.firestore.FieldValue.arrayUnion(...unlockedAgents);
    }

    if (!existing.exists) {
      updateData.uid = uid;
      updateData.createdAt = admin.firestore.Timestamp.now();
    }

    // CRITICAL: Runtime Guard Check
    this.guardAgainstIllegalRootWrites(`users/${uid}`, updateData);

    await userRef.set(updateData, { merge: true });
    logger.info(
      { uid },
      "User created/updated in users collection (root doc restricted)",
    );
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
      "settings",
      "notifications",
      "notificationSettings",
      "autoTrade",
      "autoTradeConfig",
      "backgroundResearch",
      "tradingSettings",
      "riskLimits",
      "thresholds",
    ];

    // If writing to root user document, ensure no forbidden fields are present
    if (path.match(/^users\/[^/]+$/)) {
      for (const field of forbiddenFields) {
        if (data[field] !== undefined) {
          const error = new Error(
            `CRITICAL: Unauthorized write to forbidden field '${field}' on user root document! Path: ${path}`,
          );
          logger.error(
            {
              path,
              field,
              stack: error.stack,
              data: JSON.stringify(data).substring(0, 500),
            },
            "HARD_ISOLATION_VIOLATION",
          );
          throw error;
        }
      }
    }

    // Logic for provider/integration writes (if they try to write to restricted subcollections)
    if (path.includes("/integrations/") || path.includes("/providers/")) {
      for (const field of forbiddenFields) {
        if (data[field] !== undefined) {
          const error = new Error(
            `CRITICAL: Provider logic attempted to write restricted field '${field}' to path: ${path}`,
          );
          logger.error(
            {
              path,
              field,
              stack: error.stack,
            },
            "PROVIDER_ISOLATION_VIOLATION",
          );
          throw error;
        }
      }
    }
  }

  async getUser(uid: string): Promise<any | null> {
    const doc = await db().collection("users").doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  // ========== AGENTS COLLECTION METHODS ==========
  async getAllAgents(): Promise<
    Array<{
      id: string;
      name: string;
      price: number;
      features: string[];
      [key: string]: any;
    }>
  > {
    const snapshot = await db().collection("agents").get();
    return snapshot.docs
      .filter((doc) => doc.id !== "_init" && !doc.id.startsWith("_"))
      .map((doc) => ({ id: doc.id, ...doc.data() }) as any);
  }

  async getAgent(agentId: string): Promise<any | null> {
    const doc = await db().collection("agents").doc(agentId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  // ========== USER AGENTS METHODS ==========
  async getUserAgents(uid: string): Promise<
    Array<{
      id: string;
      name: string;
      price: number;
      features: string[];
      unlocked: boolean;
      unlockedAt?: any;
      [key: string]: any;
    }>
  > {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("agents")
      .get();
    return snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        return doc.id !== "_init" && !doc.id.startsWith("_") && data.unlocked === true;
      }) // Filter out system documents and locked agents
      .map((doc) => ({ id: doc.id, ...doc.data() }) as any);
  }

  /**
   * Ensure agent access document exists in Firestore
   */
  async ensureAgentAccessDoc(uid: string, agentId: string): Promise<void> {
    try {
      const agentRef = db()
        .collection("users")
        .doc(uid)
        .collection("agents")
        .doc(agentId);

      const doc = await agentRef.get();
      if (!doc.exists) {
        await agentRef.set({
          unlocked: false,
          unlockedAt: null,
          createdAt: new Date(),
        });
      }
    } catch (error) {
      logger.error({ error, uid, agentId }, 'Error ensuring agent access doc');
      throw error;
    }
  }

  async getUserAgent(uid: string, agentId: string): Promise<any | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("agents")
      .doc(agentId)
      .get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  // ========== USER FEATURES METHODS ==========
  async getUserFeatures(
    uid: string,
  ): Promise<
    Array<{ id: string; name: string; enabled: boolean;[key: string]: any }>
  > {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("features")
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as any);
  }

  async enableUserFeature(
    uid: string,
    featureId: string,
    featureData: any,
  ): Promise<void> {
    const featureRef = db()
      .collection("users")
      .doc(uid)
      .collection("features")
      .doc(featureId);
    await featureRef.set(
      {
        id: featureId,
        enabled: true,
        enabledAt: admin.firestore.Timestamp.now(),
        ...featureData,
      },
      { merge: true },
    );
    logger.info({ uid, featureId }, "User feature enabled");
  }

  async disableUserFeature(uid: string, featureId: string): Promise<void> {
    const featureRef = db()
      .collection("users")
      .doc(uid)
      .collection("features")
      .doc(featureId);
    await featureRef.update({
      enabled: false,
      disabledAt: admin.firestore.Timestamp.now(),
    });
    logger.info({ uid, featureId }, "User feature disabled");
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
    const requestRef = db().collection("agentPurchaseRequests").doc();
    const data = {
      id: requestRef.id,
      status: requestData.status || "pending",
      createdAt: admin.firestore.Timestamp.now(),
      ...requestData,
    };
    await requestRef.set(data);
    logger.info(
      {
        uid: requestData.uid,
        agentId: requestData.agentId,
        requestId: requestRef.id,
      },
      "Agent purchase request created",
    );
    return requestRef.id;
  }

  async getAgentPurchaseRequests(): Promise<any[]> {
    const snapshot = await db()
      .collection("agentPurchaseRequests")
      .orderBy("createdAt", "desc")
      .get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async approveAgentPurchaseRequest(
    requestId: string,
    adminUid: string,
  ): Promise<void> {
    const requestRef = db().collection("agentPurchaseRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      throw new Error("Purchase request not found");
    }

    const requestData = requestDoc.data();
    if (!requestData) {
      throw new Error("Invalid purchase request data");
    }

    // Update request status
    await requestRef.update({
      status: "approved",
      approvedAt: admin.firestore.Timestamp.now(),
      approvedBy: adminUid,
    });

    // Mark the agent as unlocked in the user's agents collection
    const userAgentRef = db()
      .collection("users")
      .doc(requestData.uid)
      .collection("agents")
      .doc(requestData.agentId);
    await userAgentRef.set({
      unlocked: true,
      status: 'approved',
      unlockedAt: admin.firestore.Timestamp.now(),
      purchaseRequestId: requestId,
      approvedAt: admin.firestore.Timestamp.now(),
      approvedBy: adminUid,
    }, { merge: true });

    // Enable the feature for the user (for sidebar)
    await this.enableUserFeature(requestData.uid, requestData.agentId, {
      name: requestData.agentName,
      type: "agent",
      purchaseRequestId: requestId,
    });

    logger.info(
      { requestId, uid: requestData.uid, agentId: requestData.agentId },
      "Agent purchase request approved, agent unlocked, and feature enabled",
    );
  }

  async rejectAgentPurchaseRequest(
    requestId: string,
    adminUid: string,
    reason?: string,
  ): Promise<void> {
    const requestRef = db().collection("agentPurchaseRequests").doc(requestId);
    await requestRef.update({
      status: "rejected",
      rejectedAt: admin.firestore.Timestamp.now(),
      rejectedBy: adminUid,
      rejectionReason: reason,
    });
    logger.info({ requestId }, "Agent purchase request rejected");
  }

  // ========== AGENT UNLOCKS COLLECTION METHODS ==========
  async createAgentUnlock(
    uid: string,
    agentName: string,
    metadata?: any,
  ): Promise<void> {
    const unlockRef = db().collection("agentUnlocks").doc();
    await unlockRef.set({
      uid,
      agentName,
      unlockedAt: admin.firestore.Timestamp.now(),
      ...metadata,
    });
    logger.info({ uid, agentName }, "Agent unlock recorded");
  }

  async getUserAgentUnlocks(uid: string): Promise<any[]> {
    try {
      const snapshot = await db()
        .collection("agentUnlocks")
        .where("uid", "==", uid)
        .orderBy("unlockedAt", "desc")
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        "getUserAgentUnlocks fell back due to index; returning unordered",
      );
      const snapshot = await db()
        .collection("agentUnlocks")
        .where("uid", "==", uid)
        .get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }
  }

  // Optimized method to get user's unlocked agents from users/{uid}/agents
  // Treats all agents in users/{uid}/agents as unlocked by default unless explicitly locked
  async getUserUnlockedAgents(uid: string): Promise<string[]> {
    try {
      // PRIMARY: Fetch from users/{uid}/agents - same source as getUserAgents
      const snapshot = await db()
        .collection("users")
        .doc(uid)
        .collection("agents")
        .get();

      const unlockedAgentIds: string[] = [];
      snapshot.docs.forEach((doc) => {
        // Skip system documents
        if (doc.id === "_init" || doc.id.startsWith("_")) {
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
      logger.warn(
        { err: err.message, uid },
        "getUserUnlockedAgents failed, returning empty array",
      );
      return [];
    }
  }

  // ========== ACTIVITY LOGS COLLECTION METHODS ==========
  async logActivity(uid: string, type: string, metadata?: any): Promise<void> {
    const logRef = db().collection("activityLogs").doc();
    await logRef.set({
      uid,
      type,
      message: metadata?.message || `Activity: ${type}`,
      metadata: metadata || {},
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, type }, "Activity logged");
  }

  async getActivityLogs(uid?: string, limit: number = 100): Promise<any[]> {
    let query: admin.firestore.Query = db().collection("activityLogs");

    if (uid) {
      query = query.where("uid", "==", uid);
    }

    const snapshot = await query
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== ENGINE STATUS COLLECTION METHODS ==========
  async saveEngineStatus(
    uid: string,
    status: {
      active: boolean;
      engineType?: "auto" | "hft";
      symbol?: string;
      config?: any;
    },
  ): Promise<void> {
    const statusDoc = {
      uid,
      ...status,
      updatedAt: admin.firestore.Timestamp.now(),
    };

    // CRITICAL: Runtime Guard Check
    this.guardAgainstIllegalWrites(`engineStatus/${uid}`, statusDoc);

    const statusRef = db().collection("engineStatus").doc(uid);
    await statusRef.set(statusDoc, { merge: true });
    logger.debug({ uid, active: status.active }, "Engine status saved");
  }

  async getEngineStatus(uid: string): Promise<any | null> {
    const doc = await db().collection("engineStatus").doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  // ========== BACKGROUND RESEARCH SETTINGS METHODS ==========
  async saveBackgroundResearchSettings(
    uid: string,
    settings: {
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
      lastAlertSent?: {
        [coin: string]: {
          timestamp: admin.firestore.Timestamp;
          accuracy: number;
        };
      };
      engineState?: "RUNNING" | "STOPPED"; // Engine state persistence
      scheduled?: boolean; // User is registered in scheduler
      lastScheduledAt?: admin.firestore.Timestamp; // When user was last scheduled
      // CACHED FLAGS for control-plane routes (updated by background processes only)
      exchangeConfigured?: boolean; // Cached: exchange keys exist and decryptable
      providersConfigured?: boolean; // Cached: at least one research provider configured
      lastExchangeValidationAt?: admin.firestore.Timestamp; // When exchange was last validated
      lastProviderValidationAt?: admin.firestore.Timestamp; // When providers were last validated
    },
  ): Promise<void> {
    try {
      const docRef = db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("backgroundResearch");

      // CRITICAL: Get existing document first to merge properly
      const existingDoc = await docRef.get();
      const existingData = existingDoc.exists ? existingDoc.data() || {} : {};

      // CRITICAL: Preserve Telegram credentials if not explicitly provided in settings
      // Never clear Telegram credentials on decrypt failure or other errors
      // Only update if explicitly provided (not undefined)
      const preservedTelegramBotToken =
        settings.telegramBotToken !== undefined
          ? settings.telegramBotToken
          : existingData.telegramBotToken || undefined;
      const preservedTelegramChatId =
        settings.telegramChatId !== undefined
          ? settings.telegramChatId
          : existingData.telegramChatId || undefined;

      // CRITICAL: Preserve enabled state if not explicitly provided
      // Refresh should NOT reset enabled state
      const preservedBackgroundResearchEnabled =
        settings.backgroundResearchEnabled !== undefined
          ? settings.backgroundResearchEnabled
          : existingData.backgroundResearchEnabled !== undefined
            ? existingData.backgroundResearchEnabled
            : undefined;
      const preservedTelegramBackgroundResearchEnabled =
        settings.telegramBackgroundResearchEnabled !== undefined
          ? settings.telegramBackgroundResearchEnabled
          : existingData.telegramBackgroundResearchEnabled !== undefined
            ? existingData.telegramBackgroundResearchEnabled
            : undefined;

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
        telegramBackgroundResearchEnabled:
          preservedTelegramBackgroundResearchEnabled,
        updatedAt: admin.firestore.Timestamp.now(),
      };

      const sanitized = this.sanitizeForFirestore(merged);

      // CRITICAL: Runtime Guard Check
      this.guardAgainstIllegalWrites(
        `users/${uid}/settings/backgroundResearch`,
        sanitized,
      );

      await docRef.set(sanitized, { merge: true });
      logger.info({ uid }, "Background research settings saved to Firestore");
    } catch (error: any) {
      logger.error(
        { uid, error: error.message, stack: error.stack },
        "Failed to save background research settings to Firestore",
      );
      // Re-throw to allow route handlers to return 500
      throw error;
    }
  }

  async getBackgroundResearchSettings(uid: string): Promise<any | null> {
    const doc = await db()
      .collection("users")
      .doc(uid)
      .collection("settings")
      .doc("backgroundResearch")
      .get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async getAllEngineStatuses(): Promise<any[]> {
    const snapshot = await db().collection("engineStatus").get();
    return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  }

  // ========== HFT LOGS COLLECTION METHODS ==========
  async saveHFTLog(
    uid: string,
    logData: {
      symbol: string;
      action: string;
      orderId?: string;
      price?: number;
      quantity?: number;
      side?: "BUY" | "SELL";
      pnl?: number;
      metadata?: any;
    },
  ): Promise<void> {
    const logRef = db().collection("hftLogs").doc();
    await logRef.set({
      uid,
      ...logData,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, action: logData.action }, "HFT log saved");
  }

  async getHFTLogs(uid?: string, limit: number = 100): Promise<any[]> {
    let query: admin.firestore.Query = db().collection("hftLogs");

    if (uid) {
      query = query.where("uid", "==", uid);
    }

    const snapshot = await query
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // ========== TRADES COLLECTION METHODS ==========
  async saveTrade(
    uid: string,
    tradeData: {
      symbol: string;
      side: "BUY" | "SELL" | "buy" | "sell";
      qty: number;
      entryPrice: number;
      exitPrice?: number;
      pnl?: number;
      timestamp?: admin.firestore.Timestamp;
      engineType: "AI" | "HFT" | "Manual" | "auto";
      orderId?: string;
      metadata?: any;
      exchange?: string;
      signalAccuracy?: number;
      status?: "open" | "closed";
      leverage?: number;
      riskPercent?: number;
    },
  ): Promise<string> {
    const tradeRef = db().collection("trades").doc();
    const side = tradeData.side.toLowerCase() as "buy" | "sell";
    const status =
      tradeData.status || (tradeData.exitPrice ? "closed" : "open");
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
      leverage: tradeData.leverage,
      riskPercent: tradeData.riskPercent,
      ...(tradeData.orderId && { orderId: tradeData.orderId }),
      ...(tradeData.metadata && { metadata: tradeData.metadata }),
    });
    logger.info(
      {
        uid,
        symbol: tradeData.symbol,
        side,
        exchange: tradeData.exchange,
        status,
      },
      "Trade saved",
    );
    return tradeRef.id;
  }

  async updateTradeDocDelta(
    tradeDocId: string,
    updates: Record<string, any>,
  ): Promise<{ updated: boolean; reason?: string }> {
    const tradeRef = db().collection("trades").doc(tradeDocId);
    const snapshot = await tradeRef.get();
    if (!snapshot.exists) {
      return { updated: false, reason: "not_found" };
    }

    const existing = snapshot.data() || {};
    const delta: Record<string, any> = {};
    let changed = false;

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      if ((existing as any)[key] !== value) {
        (delta as any)[key] = value;
        changed = true;
      }
    }

    if (!changed) {
      return { updated: false, reason: "no_change" };
    }

    await tradeRef.set(
      {
        ...delta,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    return { updated: true };
  }

  async getTrades(uid?: string, limit: number = 100): Promise<any[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    try {
      let query: admin.firestore.Query = db().collection("trades");
      if (uid) {
        query = query.where("uid", "==", uid);
      }
      const snapshot = await query
        .orderBy("timestamp", "desc")
        .limit(safeLimit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate().toISOString(),
      }));
    } catch (err: any) {
      logger.warn(
        { err: err.message },
        "getTrades fell back due to index; returning unordered limited set",
      );
      let query: admin.firestore.Query = db().collection("trades");
      if (uid) {
        query = query.where("uid", "==", uid);
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
  async createNotification(
    uid: string,
    notification: {
      title: string;
      message: string;
      type?: string;
      metadata?: any;
    },
  ): Promise<string> {
    const notifRef = db().collection("notifications").doc();
    await notifRef.set({
      uid,
      ...notification,
      read: false,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ uid, title: notification.title }, "Notification created");
    return notifRef.id;
  }

  async getUserNotifications(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection("notifications")
      .where("uid", "==", uid)
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate().toISOString(),
    }));
  }

  // Optimized method for notifications subcollection structure used in routes
  async getUserNotificationsFromSubcollection(
    uid: string,
    limit: number = 50,
  ): Promise<any[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    try {
      // Try new subcollection path first (notifications/{uid}/items)
      const snapshot = await db()
        .collection("notifications")
        .doc(uid)
        .collection("items")
        .orderBy("timestamp", "desc")
        .limit(safeLimit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp:
          doc.data().timestamp?.toDate?.()?.toISOString() ||
          new Date().toISOString(),
      }));
    } catch (err: any) {
      // Fallback to old path (users/{uid}/notifications)
      const snapshot = await db()
        .collection("users")
        .doc(uid)
        .collection("notifications")
        .orderBy("timestamp", "desc")
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp:
          doc.data().timestamp?.toDate?.()?.toISOString() ||
          new Date().toISOString(),
      }));
    }
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await db().collection("notifications").doc(notificationId).update({
      read: true,
      readAt: admin.firestore.Timestamp.now(),
    });
  }

  async getUnreadNotificationCount(uid: string): Promise<number> {
    const snapshot = await db()
      .collection("notifications")
      .where("uid", "==", uid)
      .where("read", "==", false)
      .get();
    return snapshot.size;
  }

  // ========== ADMIN COLLECTION METHODS ==========
  async createAdmin(
    uid: string,
    adminData: {
      email: string;
      permissions?: string[];
      role?: string;
    },
  ): Promise<void> {
    const adminRef = db().collection("admin").doc(uid);
    await adminRef.set({
      uid,
      ...adminData,
      createdAt: admin.firestore.Timestamp.now(),
    });
    logger.info({ uid, email: adminData.email }, "Admin created");
  }

  async getAdmin(uid: string): Promise<any | null> {
    const doc = await db().collection("admin").doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async isAdmin(uid: string): Promise<boolean> {
    const userDoc = await db().collection("users").doc(uid).get();
    if (!userDoc.exists) return false;
    const data: any = userDoc.data() || {};
    return data.role === "admin" || data.isAdmin === true;
  }

  async getAllAdmins(): Promise<any[]> {
    const snapshot = await db().collection("admin").get();
    return snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
  }

  // ========== SETTINGS COLLECTION METHODS (global) ==========
  async getGlobalSettings(): Promise<any | null> {
    const doc = await db().collection("settings").doc("global").get();
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
    const settingsRef = db().collection("settings").doc("global");
    await settingsRef.set(
      {
        ...settings,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    logger.info("Global settings updated");
  }

  // ========== LOGS COLLECTION METHODS (system logs) ==========
  async saveSystemLog(logData: {
    type: string;
    message: string;
    level?: "info" | "warn" | "error";
    metadata?: any;
  }): Promise<void> {
    const logRef = db().collection("logs").doc();
    await logRef.set({
      ...logData,
      timestamp: admin.firestore.Timestamp.now(),
    });
    logger.debug({ type: logData.type }, "System log saved");
  }

  async getSystemLogs(limit: number = 100): Promise<any[]> {
    const snapshot = await db()
      .collection("logs")
      .orderBy("timestamp", "desc")
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
    const doc = await db().collection("uiPreferences").doc(uid).get();
    if (!doc.exists) return null;
    return { uid: doc.id, ...doc.data() };
  }

  async updateUIPreferences(
    uid: string,
    preferences: {
      dismissedAgents?: string[];
      hideDashboardCard?: string[];
      theme?: "light" | "dark";
      sidebarPinned?: boolean;
      [key: string]: any;
    },
  ): Promise<void> {
    const prefsRef = db().collection("uiPreferences").doc(uid);
    await prefsRef.set(
      {
        uid,
        ...preferences,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    logger.debug({ uid }, "UI preferences updated");
  }

  async updateIntegrationUsageStats(
    uid: string,
    providerId: string,
    stats: any,
  ): Promise<void> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("integrations")
      .doc(providerId);
    await docRef.set(
      {
        usageStats: stats,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
  }

  // ========== API USAGE TRACKING METHODS ==========
  async getApiUsage(userId: string): Promise<any | null> {
    try {
      const doc = await db().collection("apiUsage").doc(userId).get();
      if (!doc.exists) return null;
      return { userId: doc.id, ...doc.data() };
    } catch (error: any) {
      logger.error({ error: error.message, userId }, "Failed to get API usage");
      return null;
    }
  }

  async saveApiUsage(userId: string, usage: any): Promise<void> {
    try {
      const usageRef = db().collection("apiUsage").doc(userId);
      await usageRef.set({
        ...usage,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      logger.debug({ userId }, "API usage saved");
    } catch (error: any) {
      logger.error(
        { error: error.message, userId },
        "Failed to save API usage",
      );
      throw error;
    }
  }

  // ========== GLOBAL STATS COLLECTION METHODS ==========
  async getGlobalStats(): Promise<any | null> {
    // PART A: Use 'main' as doc ID
    const doc = await db().collection("globalStats").doc("main").get();
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
    const statsRef = db().collection("globalStats").doc("main");
    await statsRef.set(
      {
        ...stats,
        updatedAt: admin.firestore.Timestamp.now(),
      },
      { merge: true },
    );
    logger.debug("Global stats updated");
  }

  // ========== AUTO-TRADE SPECIFIC METHODS ==========
  async getActiveTrades(uid: string, limit: number = 50): Promise<any[]> {
    // PERFORMANCE OPTIMIZATION: Avoid composite index dependency
    // Use single where clause on uid and filter status in memory
    try {
      const snapshot = await db()
        .collection("trades")
        .where("uid", "==", uid)
        .orderBy("timestamp", "desc")
        .limit(limit * 2) // Fetch more to account for filtering
        .get();

      // Filter for open status in memory (no composite index required)
      const activeTrades = snapshot.docs
        .filter((doc) => doc.data().status === "open")
        .slice(0, limit) // Apply limit after filtering
        .map((doc) => {
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
            entryTime:
              data.timestamp?.toDate?.()?.toISOString() ||
              new Date(data.timestamp).toISOString(),
            ...data,
          };
        });

      return activeTrades;

      return snapshot.docs.map((doc) => {
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
          entryTime:
            data.timestamp?.toDate?.()?.toISOString() ||
            new Date(data.timestamp).toISOString(),
          ...data,
        };
      });
    } catch (error: any) {
      logger.warn(
        { uid, error: error.message },
        "Error fetching active trades from trades collection, falling back to autoTradeActiveTrades",
      );
      // Fallback to old collection for backward compatibility
      const snapshot = await db()
        .collection("users")
        .doc(uid)
        .collection("autoTradeActiveTrades")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    }
  }

  async getAutoTradeActivity(uid: string, limit: number = 50): Promise<any[]> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("autoTradeActivity")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  /**
   * Save pending trade for user confirmation
   */
  async savePendingTrade(
    uid: string,
    tradeData: {
      requestId: string;
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      accuracy: number;
      researchRequestId?: string;
      createdAt: Date;
      expiresAt: Date;
    },
  ): Promise<string> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("pendingTrades")
      .doc(tradeData.requestId);

    const payload = {
      ...tradeData,
      status: "PENDING",
      createdAt: admin.firestore.Timestamp.fromDate(tradeData.createdAt),
      expiresAt: admin.firestore.Timestamp.fromDate(tradeData.expiresAt),
      updatedAt: admin.firestore.Timestamp.now(),
    };
    const sanitizedPayload = sanitizeFirestorePayload(payload);

    await docRef.set(sanitizedPayload);

    logger.info(
      { uid, requestId: tradeData.requestId, symbol: tradeData.symbol },
      "Pending trade saved",
    );
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
        .collection("users")
        .doc(uid)
        .collection("pendingTrades")
        .where("status", "==", "PENDING")
        // .where('expiresAt', '>', now) // Removed to avoid composite index requirement (status + expiresAt)
        // .orderBy('expiresAt', 'asc')
        .get();

      if (snapshot.empty) return [];

      const pendingTrades = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
          expiresAt: doc.data().expiresAt?.toDate?.()?.toISOString(),
          _expiresAtTimestamp: doc.data().expiresAt, // Internal use for sorting/filtering
        }))
        .filter((trade) => {
          // Filter expired trades in memory
          if (!trade._expiresAtTimestamp) return true; // Keep if no expiry
          return trade._expiresAtTimestamp.toMillis() > now.toMillis();
        })
        .sort((a, b) => {
          // Sort by expiration ascending
          if (!a._expiresAtTimestamp) return 1;
          if (!b._expiresAtTimestamp) return -1;
          return (
            a._expiresAtTimestamp.toMillis() - b._expiresAtTimestamp.toMillis()
          );
        });

      // Remove internal field before returning
      return pendingTrades.map(({ _expiresAtTimestamp, ...trade }) => trade);
    } catch (error: any) {
      logger.error(
        { uid, error: error.message },
        "Failed to fetch pending trades",
      );
      return [];
    }
  }

  /**
   * Update pending trade status (APPROVED or REJECTED)
   */
  async updatePendingTradeStatus(
    uid: string,
    requestId: string,
    status: "APPROVED" | "REJECTED",
  ): Promise<void> {
    const docRef = db()
      .collection("users")
      .doc(uid)
      .collection("pendingTrades")
      .doc(requestId);

    await docRef.update({
      status,
      updatedAt: admin.firestore.Timestamp.now(),
      resolvedAt: admin.firestore.Timestamp.now(),
    });

    logger.info({ uid, requestId, status }, "Pending trade status updated");
  }

  async getTradeProposals(uid: string): Promise<any[]> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("autoTradeProposals")
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  async getAutoTradeLogs(uid: string, limit: number = 100): Promise<any[]> {
    const snapshot = await db()
      .collection("users")
      .doc(uid)
      .collection("autoTradeLogs")
      .orderBy("timestamp", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }

  // ========== TRADING SETTINGS METHODS ==========
  async getTradingSettings(uid: string): Promise<any> {
    try {
      const doc = await db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("trading")
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
      logger.error(
        { error: error.message, uid },
        "Error getting trading settings",
      );
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
      this.guardAgainstIllegalWrites(
        `users/${uid}/settings/trading`,
        settingsDoc,
      );

      await db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("trading")
        .set(settingsDoc, { merge: true });

      logger.info({ uid, settings }, "Trading settings saved");
      return settings;
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error saving trading settings",
      );
      throw error;
    }
  }

  /**
   * Save prediction snapshot for accuracy tracking
   */
  async savePredictionMetrics(uid: string, snapshotData: any): Promise<void> {
    try {
      const docRef = db()
        .collection("users")
        .doc(uid)
        .collection("predictions")
        .doc();
      const payload = {
        ...snapshotData,
        id: docRef.id,
      };
      const sanitizedPayload = sanitizeFirestorePayload(payload);

      await docRef.set(sanitizedPayload);
      logger.debug(
        { uid, predictionId: docRef.id },
        "Prediction snapshot saved",
      );
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error saving prediction snapshot",
      );
      throw error;
    }
  }

  /**
   * Get prediction snapshot by requestId
   */
  async getPredictionSnapshot(requestId: string): Promise<any> {
    try {
      // Search across all users (simplified - in production you'd want better indexing)
      const usersRef = db().collection("users");
      const usersSnapshot = await usersRef.listDocuments();

      for (const userRef of usersSnapshot) {
        const predictionRef = userRef
          .collection("predictions")
          .where("requestId", "==", requestId);
        const predictionSnapshot = await predictionRef.get();

        if (!predictionSnapshot.empty) {
          const doc = predictionSnapshot.docs[0];
          return { ...doc.data(), id: doc.id };
        }
      }

      return null;
    } catch (error: any) {
      logger.error(
        { error: error.message, requestId },
        "Error getting prediction snapshot",
      );
      throw error;
    }
  }

  /**
   * Update prediction outcome
   */
  async updatePredictionOutcome(
    requestId: string,
    outcome: any,
  ): Promise<void> {
    try {
      // Find and update the prediction document
      const snapshot = await this.getPredictionSnapshot(requestId);
      if (snapshot) {
        const userRef = db().collection("users").doc(snapshot.userId);
        await userRef.collection("predictions").doc(snapshot.id).update({
          outcome,
          completedAt: new Date(),
        });
      }
      logger.debug({ requestId }, "Prediction outcome updated");
    } catch (error: any) {
      logger.error(
        { error: error.message, requestId },
        "Error updating prediction outcome",
      );
      throw error;
    }
  }

  /**
   * Update accuracy calibration buckets
   */
  async updateAccuracyCalibration(
    uid: string,
    bucketKey: number,
    win: boolean,
  ): Promise<void> {
    try {
      const calibrationRef = db()
        .collection("users")
        .doc(uid)
        .collection("calibration")
        .doc("accuracy");
      const calibrationDoc = await calibrationRef.get();
      const currentData = calibrationDoc.exists
        ? calibrationDoc.data() || {}
        : {};

      // Initialize bucket if it doesn't exist
      if (!currentData[bucketKey]) {
        currentData[bucketKey] = { total: 0, wins: 0 };
      }

      // Update bucket stats
      currentData[bucketKey].total += 1;
      if (win) currentData[bucketKey].wins += 1;

      await calibrationRef.set(currentData);
      logger.debug({ uid, bucketKey, win }, "Accuracy calibration updated");
    } catch (error: any) {
      logger.error(
        { error: error.message, uid, bucketKey },
        "Error updating accuracy calibration",
      );
      throw error;
    }
  }

  /**
   * Get accuracy history and calibration stats
   */
  async getAccuracyHistory(
    uid: string,
    filters: { strategy?: string; symbol?: string; limit?: number },
  ): Promise<any> {
    try {
      let query: any = db()
        .collection("users")
        .doc(uid)
        .collection("predictions");

      if (filters.symbol) {
        query = query.where("symbol", "==", filters.symbol);
      }

      if (filters.strategy) {
        query = query.where("strategy", "==", filters.strategy);
      }

      query = query.orderBy("timestamp", "desc").limit(filters.limit || 100);

      const snapshot = await query.get();
      const predictions = snapshot.docs.map((doc: any) => ({
        ...doc.data(),
        id: doc.id,
      }));

      // Get calibration data
      const calibrationRef = db()
        .collection("users")
        .doc(uid)
        .collection("calibration")
        .doc("accuracy");
      const calibrationDoc = await calibrationRef.get();
      const calibrationData = calibrationDoc.exists
        ? calibrationDoc.data() || {}
        : {};

      // Calculate rolling accuracy
      const totalPredictions = predictions.length;
      const winningPredictions = predictions.filter(
        (p: any) => p.outcome?.win,
      ).length;
      const rollingAccuracy =
        totalPredictions > 0
          ? (winningPredictions / totalPredictions) * 100
          : 0;

      return {
        rollingAccuracy: Math.round(rollingAccuracy * 100) / 100,
        totalPredictions,
        winningPredictions,
        calibrationBuckets: calibrationData,
        recentPredictions: predictions.slice(0, 20), // Return last 20 for display
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error getting accuracy history",
      );
      throw error;
    }
  }

  /**
   * Get user provider settings
   */
  async getUserProviderSettings(uid: string): Promise<any> {
    try {
      const doc = await db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("providers")
        .get();
      if (!doc.exists) {
        return null;
      }
      return doc.data();
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error getting user provider settings",
      );
      throw error;
    }
  }

  /**
   * Save user provider settings
   */
  async saveUserProviderSettings(uid: string, settings: any): Promise<void> {
    try {
      await db()
        .collection("users")
        .doc(uid)
        .collection("settings")
        .doc("providers")
        .set(
          {
            ...settings,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
    } catch (error: any) {
      logger.error(
        { error: error.message, uid, settings },
        "Error saving user provider settings",
      );
      throw error;
    }
  }

  /**
   * Get exchange config for a user
   */
  async getExchangeConfig(uid: string): Promise<any> {
    try {
      const doc = await db()
        .collection("users")
        .doc(uid)
        .collection("exchangeConfig")
        .doc("current")
        .get();
      if (!doc.exists) {
        return null;
      }

      const data = doc.data();

      // CRITICAL: Filter out INVALID_KEYS from legacy data to prevent UI exposure
      // This prevents INVALID_KEYS from leaking to frontend even if legacy data exists
      if (data && data.exchangeStatus === 'INVALID_KEYS') {
        logger.warn(
          { uid },
          "LEGACY_INVALID_KEYS_DETECTED: Filtering INVALID_KEYS from getExchangeConfig response"
        );
        const cleanData = { ...data };
        delete cleanData.exchangeStatus;
        delete cleanData.keysClearedAt;
        delete cleanData.keysClearedReason;
        return cleanData;
      }

      return data;
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error getting exchange config",
      );
      return null;
    }
  }

  /**
   * DEPRECATED: Legacy exchange credentials method - DO NOT USE
   * Exchange credentials are now stored in users/{uid}/exchangeConfig/current
   * This method is disabled to prevent data corruption and inconsistencies
   */
  async saveExchangeCredentials(
    uid: string,
    exchange: string,
    credentials: {
      apiKey: string;
      secret: string;
      passphrase?: string;
      testnet: boolean;
    },
  ): Promise<void> {
    throw new Error(
      `DEPRECATED: saveExchangeCredentials() is no longer supported. Exchange credentials must be saved to users/${uid}/exchangeConfig/current only.`,
    );
  }

  /**
   * Get exchange credentials for a user - UPDATED for new system
   * Reads from users/{uid}/exchangeConfig/current and returns credentials
   * only if the stored exchange matches the requested exchange
   */
  async getExchangeCredentials(uid: string, exchange: string): Promise<any> {
    try {
      const doc = await db()
        .collection("users")
        .doc(uid)
        .collection("exchangeConfig")
        .doc("current")
        .get();
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
        testnet: config.testnet,
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, uid, exchange },
        "Error getting exchange credentials from new system",
      );
      throw error;
    }
  }

  /**
   * DEPRECATED: Legacy exchange credentials method - DO NOT USE
   * Exchange credentials are now stored in users/{uid}/exchangeConfig/current
   * This method is disabled to prevent data corruption and inconsistencies
   */
  async deleteExchangeCredentials(
    uid: string,
    exchange: string,
  ): Promise<void> {
    throw new Error(
      `DEPRECATED: deleteExchangeCredentials() is no longer supported. Exchange credentials must be managed in users/${uid}/exchangeConfig/current only.`,
    );
  }

  /**
   * Store the latest successful research result for a user
   * Used to share research results between UI and Auto-Trade
   */
  async storeLatestResearchResult(
    uid: string,
    researchResult: any,
  ): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection("users").doc(uid);

      await userRef.collection("researchCache").doc("latest").set({
        researchResult,
        timestamp: admin.firestore.Timestamp.now(),
        source: "ui_research",
      });

      logger.info(
        { uid, symbol: researchResult.symbol },
        "✅ [RESEARCH_CACHE] Stored latest research result",
      );
    } catch (error: any) {
      logger.error(
        { uid, error: error.message },
        "❌ [RESEARCH_CACHE] Failed to store latest research result",
      );
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
      const userRef = db.collection("users").doc(uid);
      const cacheDoc = await userRef
        .collection("researchCache")
        .doc("latest")
        .get();

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
        logger.info(
          { uid, ageMinutes },
          "📅 [RESEARCH_CACHE] Cached research result expired",
        );
        return null;
      }

      logger.info(
        { uid, ageMinutes: ageMinutes.toFixed(1) },
        "✅ [RESEARCH_CACHE] Retrieved valid cached research result",
      );
      return cacheData.researchResult;
    } catch (error: any) {
      logger.error(
        { uid, error: error.message },
        "❌ [RESEARCH_CACHE] Failed to retrieve latest research result",
      );
      return null;
    }
  }

  /**
   * Clear the cached research result for a user
   */
  async clearLatestResearchResult(uid: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection("users").doc(uid);

      await userRef.collection("researchCache").doc("latest").delete();
      logger.info(
        { uid },
        "🗑️ [RESEARCH_CACHE] Cleared cached research result",
      );
    } catch (error: any) {
      logger.error(
        { uid, error: error.message },
        "❌ [RESEARCH_CACHE] Failed to clear cached research result",
      );
      // Don't throw - clearing failure shouldn't break anything
    }
  }

  /**
   * Store research history entry for a user
   */
  async storeResearchHistory(uid: string, historyEntry: any): Promise<void> {
    // HARD BLOCK: ERROR_CYCLE must NEVER be written for AUTO_TRADE source
    if (
      historyEntry.symbol === "ERROR_CYCLE" &&
      historyEntry.source === "AUTO_TRADE"
    ) {
      logger.error(
        {
          uid,
          symbol: historyEntry.symbol,
          source: historyEntry.source,
          entry: historyEntry,
        },
        "🚫 [ARCHITECTURE_VIOLATION] ERROR_CYCLE BLOCKED for AUTO_TRADE source - this should NEVER happen",
      );
      throw new Error(
        "ARCHITECTURE_VIOLATION: ERROR_CYCLE not allowed for AUTO_TRADE source",
      );
    }

    // DEBUG: Log ERROR_CYCLE writes to catch any remaining violations
    if (historyEntry.symbol === "ERROR_CYCLE") {
      console.log("🔥 [FIRESTORE_DEBUG] ERROR_CYCLE being written:", {
        uid,
        source: historyEntry.source,
        skipReason: historyEntry.skipReason,
        error: historyEntry.error,
      });
    }

    // CRITICAL: Validate required fields before attempting Firestore write
    // AUTO_TRADE SKIPPED entries: Allow missing accuracy and symbol (they track research cycles)
    // TELEGRAM entries: Require accuracy for all entries, require symbol for non-SKIPPED
    if (
      historyEntry.source === "AUTO_TRADE" &&
      historyEntry.status === "SKIPPED"
    ) {
      // AUTO_TRADE SKIPPED: Allow missing accuracy and symbol - these are research cycle trackers
      // No validation needed, proceed with save
    } else {
      // TELEGRAM or AUTO_TRADE EXECUTED: Require accuracy
      if (
        typeof historyEntry.accuracy !== "number" ||
        isNaN(historyEntry.accuracy)
      ) {
        logger.warn(
          {
            uid,
            symbol: historyEntry.symbol,
            source: historyEntry.source,
            status: historyEntry.status,
          },
          "Skipping history save - accuracy is missing or invalid",
        );
        return; // Skip save cleanly, do NOT throw
      }

      // Require symbol for non-SKIPPED entries
      if (!historyEntry.symbol && historyEntry.status !== "SKIPPED") {
        logger.warn(
          { uid, source: historyEntry.source, status: historyEntry.status },
          "Skipping history save - symbol is missing and status is not SKIPPED",
        );
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
      timestamp: new Date().toISOString(),
    });

    // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE ATTEMPT
    console.log("🔥 [FIRESTORE_HISTORY] BEFORE write", {
      uid,
      symbol: historyEntry.symbol,
      firestorePath: `users/${uid}/research_history`,
      entry: historyEntry,
      timestamp: new Date().toISOString(),
    });

    try {
      // CRITICAL: Sanitize entry to remove any undefined values before Firestore write
      const sanitizedEntry = this.sanitizeForFirestore(historyEntry);

      const result = await db()
        .collection("users")
        .doc(uid)
        .collection("research_history")
        .add({
          ...sanitizedEntry,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
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
        timestamp: new Date().toISOString(),
      });

      // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE SUCCESS
      console.log("🔥 [FIRESTORE_HISTORY] AFTER write success", {
        uid,
        symbol: historyEntry.symbol,
        docId: result.id,
        timestamp: new Date().toISOString(),
      });

      logger.info(
        { uid, symbol: historyEntry.symbol },
        "✅ [FIRESTORE] Research history entry saved",
      );
    } catch (error: any) {
      // 🔥 DIAGNOSTIC: PROVE HISTORY WRITE FAILURE
      console.log("🔥 [FIRESTORE_HISTORY] AFTER write failure", {
        uid,
        symbol: historyEntry.symbol,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      logger.error(
        { uid, error: error.message },
        "❌ [FIRESTORE] Failed to save research history",
      );
    }
  }

  /**
   * Update existing research history entry
   */
  async updateResearchHistory(
    uid: string,
    historyId: string,
    updates: any,
  ): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const historyRef = db
        .collection("users")
        .doc(uid)
        .collection("research_history")
        .doc(historyId);

      await historyRef.update({
        ...updates,
        updatedAt: admin.firestore.Timestamp.now(),
      });

      logger.debug(
        { uid, historyId },
        "✅ [HISTORY_UPDATE] Research history entry updated",
      );
    } catch (error: any) {
      logger.error(
        { uid, historyId, error: error.message },
        "❌ [HISTORY_UPDATE] Failed to update research history",
      );
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
      const snapshot = await db()
        .collection("users")
        .doc(uid)
        .collection("research_history")
        .select(
          "symbol",
          "signal",
          "accuracy",
          "price",
          "timestamp",
          "source",
          "status",
          "decision",
          "executionStatus",
          "tradePlan",
          "skipReason",
        )
        .orderBy("timestamp", "desc")
        .limit(safeLimit)
        .get();

      // AUTO_TRADE OBSERVABILITY FIX: Filter out legacy placeholder entries
      const AUTO_TRADE_OBSERVABILITY_FIX_TIMESTAMP = new Date('2026-01-11T00:00:00Z');

      const entries: any[] = snapshot.docs.map((doc) => {
        const data = doc.data();

        // CRITICAL OPTIMIZATION: Exclude heavy nested objects for list view performance
        // Keep only essential fields needed for history list display
        const { indicators, analysis, tradePlan, ...lightweightData } = data;

        // Normalize status based on source
        let normalizedStatus;
        if (data.source === "AUTO_TRADE") {
          // AUTO_TRADE: Use status field AS-IS, or force SKIPPED if skipReason exists
          if (data.status) {
            normalizedStatus = data.status;
          } else if (data.skipReason) {
            normalizedStatus = "SKIPPED";
          } else {
            normalizedStatus = "UNKNOWN";
          }
        } else {
          // TELEGRAM: Use existing normalization logic
          normalizedStatus =
            data.decision === "EXECUTED"
              ? "COMPLETED"
              : data.decision === "SKIPPED"
                ? "SKIPPED"
                : data.executionStatus === "SUCCESS"
                  ? "COMPLETED"
                  : data.executionStatus === "FAILED"
                    ? "FAILED"
                    : data.status || "UNKNOWN";
        }

        return {
          id: doc.id,
          ...lightweightData,
          // Convert Firestore Timestamp to ISO string
          timestamp: data.timestamp?.toDate
            ? data.timestamp.toDate().toISOString()
            : new Date().toISOString(),
          // Use normalized status
          status: normalizedStatus,
          // Include minimal tradePlan info for display (exclude nested objects)
          tradePlan: tradePlan
            ? {
              entryPrice: tradePlan.entryPrice,
              stopLoss: tradePlan.stopLoss,
              takeProfit: tradePlan.takeProfit || tradePlan.takeProfit2,
              takeProfit1: tradePlan.takeProfit1,
              takeProfit2: tradePlan.takeProfit2,
              takeProfit3: tradePlan.takeProfit3,
            }
            : null,
        };
      });

      // Filter out legacy AUTO_TRADE entries with placeholder data
      const filteredEntries = entries.filter((entry: any) => {
        // Skip filtering if not AUTO_TRADE source
        if (entry.source !== "AUTO_TRADE") {
          return true;
        }

        // Check if this is a legacy placeholder entry
        const isLegacyPlaceholder =
          (entry.symbol === "NO_RESEARCH" || entry.symbol === "AUTO_TRADE_CYCLE") &&
          entry.accuracy === 0;

        if (!isLegacyPlaceholder) {
          return true; // Keep valid entries
        }

        // Check timestamp - only filter if created before observability fix
        const entryTimestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
        const isBeforeFix = entryTimestamp < AUTO_TRADE_OBSERVABILITY_FIX_TIMESTAMP;

        // Keep entry if it's NOT a legacy placeholder OR was created after the fix
        return !isBeforeFix;
      });

      return filteredEntries;
    } catch (error: any) {
      logger.error(
        { uid, error: error.message },
        "❌ [FIRESTORE] Failed to retrieve research history",
      );
      return [];
    }
  }

  // ===== AGENT DIAGNOSTICS METHODS =====

  /**
   * Save agent diagnostic log entry
   * Path: agentDiagnostics/{agentId}/logs/{auto-id}
   */
  async saveAgentDiagnostic(agentId: string, diagnostic: {
    agentType: 'TRADING_AGENT' | 'VWAP_STRATEGY' | 'LIQUIDITY_SWEEP_AGENT' | 'COPY_TRADING_AGENT';
    tradingPair?: string;
    decision: {
      action: 'TRADE' | 'SKIP' | 'STOPPED_FOR_DAY';
      reason: string;
    };
    signal?: {
      direction: 'LONG' | 'SHORT';
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      rrRatio: number;
    };
    execution?: {
      success: boolean;
      orderId?: string;
      error?: string;
    };
    runtimeState?: any;
    consensusResults?: any;
  }): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const logsRef = db.collection('agentDiagnostics').doc(agentId).collection('logs');

      await logsRef.add({
        timestamp: admin.firestore.Timestamp.now(),
        agentId,
        agentType: diagnostic.agentType,
        tradingPair: diagnostic.tradingPair || null,
        decision: diagnostic.decision,
        signal: diagnostic.signal || null,
        execution: diagnostic.execution || null,
        runtimeState: diagnostic.runtimeState || null,
        consensusResults: diagnostic.consensusResults || null,
      });

      logger.debug({ agentId, action: diagnostic.decision.action }, 'Agent diagnostic saved');

      // Cleanup old diagnostics (keep last 100)
      await this.cleanupOldDiagnostics(agentId);
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to save agent diagnostic');
      // Don't throw - diagnostics are non-critical
    }
  }

  /**
   * Get agent diagnostics from Firestore
   * Path: agentDiagnostics/{agentId}/logs
   * Returns most recent entries ordered by timestamp desc
   */
  async getAgentDiagnostics(agentId: string, limit: number = 20): Promise<Array<{
    id: string;
    timestamp: Date;
    agentId: string;
    agentType: string;
    tradingPair?: string;
    decision: {
      action: string;
      reason: string;
    };
    signal?: any;
    execution?: any;
    runtimeState?: any;
    consensusResults?: any;
  }>> {
    try {
      const db = getFirebaseAdmin().firestore();
      const logsRef = db.collection('agentDiagnostics').doc(agentId).collection('logs');

      const snapshot = await logsRef
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      const diagnostics: any[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        diagnostics.push({
          id: doc.id,
          timestamp: data.timestamp?.toDate() || new Date(),
          agentId: data.agentId,
          agentType: data.agentType,
          tradingPair: data.tradingPair,
          decision: data.decision,
          signal: data.signal,
          execution: data.execution,
          runtimeState: data.runtimeState,
          consensusResults: data.consensusResults,
        });
      });

      return diagnostics;
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to get agent diagnostics');
      return [];
    }
  }

  /**
   * Cleanup old diagnostics - keep only last 100 entries per agent
   */
  async cleanupOldDiagnostics(agentId: string): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      const logsRef = db.collection('agentDiagnostics').doc(agentId).collection('logs');

      // Get count of documents
      const countSnapshot = await logsRef.count().get();
      const totalCount = countSnapshot.data().count;

      if (totalCount <= 100) {
        return; // No cleanup needed
      }

      // Get documents to delete (oldest ones beyond 100)
      const toDeleteCount = totalCount - 100;
      const oldestSnapshot = await logsRef
        .orderBy('timestamp', 'asc')
        .limit(toDeleteCount)
        .get();

      // Delete in batches
      const batch = db.batch();
      oldestSnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      logger.debug({ agentId, deletedCount: toDeleteCount }, 'Cleaned up old agent diagnostics');
    } catch (error: any) {
      logger.error({ error: error.message, agentId }, 'Failed to cleanup old diagnostics');
      // Don't throw - cleanup is non-critical
    }
  }
}

export async function saveMarketSnapshot({
  topMovers,
  source,
}: {
  topMovers: any[];
  source: string;
}) {
  const docRef = db().collection("system").doc("marketSnapshots");
  await docRef.set(
    {
      topMovers,
      source,
      snapshotTimestamp: new Date().toISOString(),
    },
    { merge: true },
  );
}

// ===== RISK BOT CONFIGURATION =====

/**
 * READ-ONLY: Get risk bot configuration for an agent
 * Returns default values if fields don't exist
 */
export async function getAgentRiskBotConfig(agentId: string): Promise<{
  enabled: boolean;
  bots: string[];
}> {
  try {
    const doc = await db().collection("agents").doc(agentId).get();

    if (!doc.exists) {
      // Return default disabled configuration for non-existent agents
      return {
        enabled: false,
        bots: []
      };
    }

    const data = doc.data();

    // Risk bot configuration with defaults
    // Fields: riskBotEnabled (boolean), enabledRiskBots (array of strings)
    return {
      enabled: data?.riskBotEnabled ?? false,
      bots: data?.enabledRiskBots ?? []
    };

  } catch (error: any) {
    logger.error(
      { agentId, error: error.message },
      "Failed to get agent risk bot configuration"
    );

    // On error, default to disabled for safety
    return {
      enabled: false,
      bots: []
    };
  }
}

export const firestoreAdapter = new FirestoreAdapter();
