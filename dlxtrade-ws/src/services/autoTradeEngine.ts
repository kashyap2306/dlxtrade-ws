import { logger } from "../utils/logger";
import { BinanceAdapter } from "./binanceAdapter";
import { firestoreAdapter, isExchangeUsable } from "./firestoreAdapter";
import { getFirebaseAdmin } from "../utils/firebase";
import { userNotificationService } from "./userNotificationService";
import * as admin from "firebase-admin";
import {
  safeSetInterval,
  shouldRunBackgroundTasks,
  withTimeout,
  yieldToEventLoop,
  safeExternalCall,
  runBackgroundTask,
} from "../utils/safeBackgroundRunner";
import type { FreeModeDeepResearchResult, TradePlan } from "./researchTypes";
import { evaluateTelegramAlertDecision } from "./telegramAlertDecisionService";
import { adjustAutoTradeFrequencyForTelegram } from "./telegramConfigService";
import { sendConsolidatedTelegramAlert } from "./telegramAlertOrchestrator";
import {
  logAutoTradeSkip,
  saveAutoTradeHistorySkipped,
  saveAutoTradeHistoryWithExecutionStatus,
} from "./autoTradeHistory";
import {
  checkRiskGuards,
  calculateDynamicParams,
  validateAccuracyForExecution,
  checkSystemRisk,
} from "./riskAndLimitsEngine";
import {
  AccuracyGuard,
  runDeepResearchWithCoinSelection,
} from "./accuracyAndSignalEngine";
// Import functions from new supporting files
import { isSymbolInTop10, getCurrentEquity } from "./autoTradeGuards";
import {
  sendTradeConfirmationNotification,
  checkWhaleAlerts,
} from "./autoTradeTelegram";
import {
  calculateNewsScoreFromArticles,
  calculateSLTP,
  getCurrentMarketPrice,
  validateTradeSignal,
  validateTradingMode,
  calculatePositionSize,
  getDefaultAccuracyRiskConfig,
} from "./autoTradeUtils";
import {
  setLeverageOnExchange,
  setMarginType,
  placeEntryOrder,
  placeScalpingTPOrders,
  placeSingleTPOrder,
  placeStopLossOrder,
  executeEmergencyClose,
  cancelOrder,
  placePanicCloseOrder,
} from "./autoTradeOrderExecutor";

// Accuracy-based Risk Configuration (Single Source of Truth)
export interface AccuracyRiskConfigItem {
  minAccuracy: number; // Minimum accuracy for this range (inclusive)
  maxAccuracy: number | null; // Maximum accuracy for this range (inclusive, null = no upper limit)
  tradeSizePct: number; // Trade size as % of wallet balance (0-10) - percentage of total account equity, NOT margin-based or fixed amount
  leverage: number; // Leverage multiplier (1-10) - hard cap is 10x, default for ≥90% is 9x
}

// Trading Settings Interface
export interface TradingSettings {
  coinSelectionMode: "manual" | "top100" | "top10";
  selectedCoins: string[];
  maxPositionPct: number;
  accuracyTrigger: {
    min: number;
    max: number;
  };
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  autoTradeIntervalMinutes: number;
  tradeConfirmationRequired: boolean;
  tradeType: "Scalping" | "Swing" | "Position";
  notifications?: {
    tradeConfirmationRequired?: boolean;
    whaleAlerts?: boolean;
  };
  positionSizingMap: {
    "0-84": number;
    "85-89": number;
    "90-94": number;
    "95-99": number;
    "100": number;
  };
  // NEW: Accuracy-based risk configuration (replaces hardcoded calculateDynamicParams logic)
  accuracyRiskConfig?: AccuracyRiskConfigItem[];
}

// Position Sizing Result
export interface PositionSizingResult {
  positionPercent: number;
  reason: string;
}

// Research result interface for auto trade
export interface ResearchDataResult {
  symbol: string;
  signal: "BUY" | "SELL" | "HOLD";
  accuracy: number;
  price?: number;
  result: FreeModeDeepResearchResult;
  processingTimeMs: number;
  metadata?: {
    symbol: string;
    [key: string]: unknown;
  };
}

export interface ResearchData {
  results: ResearchDataResult[];
  coinsAnalyzed: string[];
}

// Type-safe account balance interfaces
interface FuturesBalance {
  asset: string;
  free?: string | number;
  available?: string | number;
  locked?: string | number;
  frozen?: string | number;
}

interface AccountInfo {
  futuresBalances?: FuturesBalance[];
  data?: Array<{
    marginCoin?: string;
    productType?: string;
    equity?: string | number;
    available?: string | number;
  }>;
  totalEquity?: number | string;
  equity?: number | string;
}

// Type-safe provider config (matches deepResearchEngine signature)
interface ProviderConfigs {
  binance?: { primary: string; backups: string[] };
  cryptocompare?: { primary: string; backups: string[] };
  cmc?: { primary: string; backups: string[] };
  news?: { primary: string; backups: string[] };
}

// Type-safe integration result
interface IntegrationResult {
  providerConfig?: ProviderConfigs;
  [key: string]: unknown;
}

// Type-safe exchange constraints
interface ExchangeConstraints {
  minQuantity?: number;
  maxQuantity?: number;
  stepSize?: number;
  minNotional?: number;
  maxNotional?: number;
  tickSize?: number;
}

// Accuracy validation result
interface AccuracyValidationResult {
  isValid: boolean;
  normalizedAccuracy: number; // 0-100 scale
  reason?: string;
}

// Idempotency key for duplicate execution prevention
type IdempotencyKey = string;

export interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number; // percent of account equity per trade (default 1)
  maxConcurrentTrades: number; // default 3
  maxDailyLossPct: number; // stop trading if loss exceeds (default 5)
  stopLossPct: number; // default 1.5
  takeProfitPct: number; // default 3
  manualOverride: boolean; // when true, engine pauses for user actions
  mode: "AUTO" | "MANUAL";
  maxTradesPerDay?: number; // max trades per day
  cooldownSeconds?: number; // cooldown between trades in seconds (per-symbol)
  symbolCooldowns?: { [symbol: string]: string }; // Per-symbol cooldown timestamps (ISO string format for Firestore)
  panicStopEnabled?: boolean; // enable panic stop functionality
  slippageBlocker?: boolean; // enable slippage protection

  lastRun?: Date;
  // P3-A: Over-trading protection state
  consecutiveLosses?: number;
  cooldownUntil?: Date; // Global cooldown for consecutive losses (kept for safety)
  stats?: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    totalPnL: number;
    dailyPnL: number;
    dailyTrades: number;
  };
  equitySnapshot?: number;
}

export interface TradeSignal {
  symbol: string;
  signal: "BUY" | "SELL";
  entryPrice: number;
  accuracy: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  reasoning: string;
  requestId: string;
  timestamp: Date;
  // P3-C: High-impact news detection
  highImpactNewsDetected?: boolean;
  newsEvent?: string;
  leverage?: number;
}

export interface TradeExecution {
  tradeId: string;
  tradeDocId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED" | "PANIC_CLOSED";
  orderId?: string;
  fillPrice?: number;
  pnl?: number;
  timestamp: Date;
  mode: "AUTO" | "MANUAL";
  takeProfitOrderId?: string;
  stopLossOrderId?: string;
  takeProfitPct?: number;
  stopLossPct?: number;
  exitPrice?: number;
  leverage?: number;
  // Scalping-specific fields
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  takeProfit1OrderId?: string;
  takeProfit2OrderId?: string;
  takeProfit3OrderId?: string;
  originalQuantity?: number; // Original position size for partial close calculations
  remainingQuantity?: number; // Remaining position after partial closes
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  tp3Hit?: boolean;
  isScalping?: boolean; // Track if this is a scalping trade
  trailingStopLoss?: number; // Current trailing SL price

  // Runtime-only monitoring fields (never persisted directly)
  lastMonitorAt?: number;
  monitorErrorCount?: number;
  monitorCooldownUntil?: number;
}
const DEFAULT_CONFIG: AutoTradeConfig = {
  autoTradeEnabled: false,
  perTradeRiskPct: 1, // 1% of equity per trade
  maxConcurrentTrades: 3,
  maxDailyLossPct: 5, // 5% max daily loss
  stopLossPct: 1.5, // 1.5% stop loss
  takeProfitPct: 3, // 3% take profit
  manualOverride: false,
  mode: "MANUAL", // Start in manual mode for safety
  maxTradesPerDay: 5, // P3-A: Reduced to SAFE default (was 50)
  cooldownSeconds: 15, // Reduced from 30 to 15 seconds for 2-5 trades/day
  panicStopEnabled: false,
  slippageBlocker: false,

  stats: {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnL: 0,
    dailyPnL: 0,
    dailyTrades: 0,
  },
};

export const AUTO_TRADE_REASONS = {
  ACCURACY_TOO_LOW: "ACCURACY_TOO_LOW",
  HOLD_SIGNAL: "HOLD_SIGNAL",
  NO_SIGNAL: "NO_SIGNAL",
  DAILY_LOSS_LIMIT: "DAILY_LOSS_LIMIT",
  DAILY_TRADES_LIMIT: "DAILY_TRADES_LIMIT",
  COOLDOWN_ACTIVE: "COOLDOWN_ACTIVE",
  NEWS_BLOCK: "NEWS_BLOCK",
  EXTREME_VOLATILITY: "EXTREME_VOLATILITY",
  HIGH_VOLATILITY_SKIP: "HIGH_VOLATILITY_SKIP",
  INSUFFICIENT_LIQUIDITY: "INSUFFICIENT_LIQUIDITY",
  MIN_NOTIONAL: "MIN_NOTIONAL",
  NO_RESEARCH_KEYS: "NO_RESEARCH_KEYS",
  RISK_REJECTION: "RISK_REJECTION",
  MANUAL_OVERRIDE: "MANUAL_OVERRIDE",
  PENDING_CONFIRMATION: "PENDING_CONFIRMATION",
  TRADE_EXECUTED: "TRADE_EXECUTED",
  TRADE_FAILED: "TRADE_FAILED",
  TRADE_SKIPPED: "TRADE_SKIPPED",
  NO_CONNECTED_EXCHANGE: "NO_CONNECTED_EXCHANGE",
  AUTO_TRADE_SKIPPED_LOW_ACCURACY: "AUTO_TRADE_SKIPPED_LOW_ACCURACY",
  SYSTEM_RISK_FAILURE: "SYSTEM_RISK_FAILURE",
  SKIPPED_EXCHANGE_UNAVAILABLE: "SKIPPED_EXCHANGE_UNAVAILABLE",
} as const;

export type AutoTradeReason =
  (typeof AUTO_TRADE_REASONS)[keyof typeof AUTO_TRADE_REASONS];

// Strict mode enum
export type AutoTradeMode = "AUTO" | "MANUAL";

// Strict status enum
export type TradeExecutionStatus =
  | "PENDING"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "PANIC_CLOSED";

// Strict signal enum
export type TradeSignalType = "BUY" | "SELL" | "HOLD";

// Strict volatility state enum
export type VolatilityState = "OK" | "HIGH" | "EXTREME";

/**
 * Unified Trade Decision Function
 * Applies the SAME validation rules across ALL flows: Research UI, Telegram alerts, Auto-Trade execution
 *
 * @param signal - Trade signal (BUY/SELL/HOLD)
 * @param accuracy - Accuracy value (may be decimal 0-1 or percentage 0-100)
 * @param isFinal - Whether research result is FINAL
 * @param tradePlan - Trade plan with entryPrice, stopLoss, takeProfit, riskRewardRatio
 * @param indicators - Technical indicators (for entry zone and ATR validation)
 * @param threshold - Accuracy threshold (uses user-defined accuracyTrigger.min for auto-trade, 60 for manual)
 * @returns Unified decision result
 */
export interface UnifiedTradeDecision {
  allowed: boolean;
  reason?: string;
  accuracyUsed: number; // Percentage (0-100)
  rr: number; // Risk-Reward ratio
  volatilityState: "OK" | "HIGH" | "EXTREME";
  entryZoneValid: boolean;
  isFinal: boolean;
}

export function makeUnifiedTradeDecision(
  signal: TradeSignalType,
  accuracy: number,
  isFinal: boolean,
  tradePlan: {
    entryPrice?: number;
    stopLoss?: number;
    takeProfit?: number;
    riskRewardRatio?: number;
  } | null,
  indicators: {
    vwap?: { deviation?: number };
    atr?: { classification?: string; atrPercentile?: number };
    supportResistance?: { majorSupport?: number; majorResistance?: number };
  } | null,
  threshold: number = 75,
): UnifiedTradeDecision {
  // 1. Use centralized accuracy guard for normalization and validation
  const accuracyValidation = AccuracyGuard.validateAndNormalize(accuracy);
  if (!accuracyValidation.isValid) {
    return {
      allowed: false,
      reason: `INVALID_ACCURACY: ${accuracyValidation.reason}`,
      accuracyUsed: accuracyValidation.normalizedAccuracy,
      rr: 0,
      volatilityState: "OK",
      entryZoneValid: false,
      isFinal,
    };
  }

  const accuracyPercent = accuracyValidation.normalizedAccuracy;

  // 4. Accuracy threshold check
  if (accuracyPercent < threshold) {
    return {
      allowed: false,
      reason: `ACCURACY_TOO_LOW: ${accuracyPercent.toFixed(1)}% < ${threshold}% threshold`,
      accuracyUsed: accuracyPercent,
      rr: 0,
      volatilityState: "OK",
      entryZoneValid: false,
      isFinal: true,
    };
  }

  // 5. Entry zone validation: BUY near resistance → BLOCK, SELL near support → BLOCK
  let entryZoneValid = true;
  const vwapDeviation = indicators?.vwap?.deviation || 0;
  if (signal === "BUY" && vwapDeviation > 2) {
    entryZoneValid = false;
  } else if (signal === "SELL" && vwapDeviation < -2) {
    entryZoneValid = false;
  }

  // Also check support/resistance levels if available
  if (tradePlan?.entryPrice) {
    const entryPrice = tradePlan.entryPrice;
    const majorResistance = indicators?.supportResistance?.majorResistance;
    const majorSupport = indicators?.supportResistance?.majorSupport;

    if (signal === "BUY" && majorResistance && entryPrice > 0) {
      const distanceToResistance =
        ((majorResistance - entryPrice) / entryPrice) * 100;
      if (distanceToResistance < 2) {
        // Within 2% of resistance
        entryZoneValid = false;
      }
    } else if (signal === "SELL" && majorSupport && entryPrice > 0) {
      const distanceToSupport =
        ((entryPrice - majorSupport) / entryPrice) * 100;
      if (distanceToSupport < 2) {
        // Within 2% of support
        entryZoneValid = false;
      }
    }
  }

  if (!entryZoneValid) {
    return {
      allowed: false,
      reason:
        signal === "BUY"
          ? "ENTRY_ZONE_INVALID: BUY near resistance"
          : "ENTRY_ZONE_INVALID: SELL near support",
      accuracyUsed: accuracyPercent,
      rr: tradePlan?.riskRewardRatio || 0,
      volatilityState: "OK",
      entryZoneValid: false,
      isFinal: true,
    };
  }

  // 6. Risk-Reward gate: RR < 1.2 → BLOCK (reduced from 1.2 for 2-5 trades/day)
  const rr = tradePlan?.riskRewardRatio || 0;
  if (rr > 0 && rr < 1.2) {
    return {
      allowed: false,
      reason: `LOW_RR: Risk-Reward ratio ${rr.toFixed(2)} < 1.2 minimum`,
      accuracyUsed: accuracyPercent,
      rr,
      volatilityState: "OK",
      entryZoneValid: true,
      isFinal: true,
    };
  }

  // 7. Volatility (ATR) guard
  const atrClassification = indicators?.atr?.classification;
  const atrPercentile = indicators?.atr?.atrPercentile;
  let volatilityState: VolatilityState = "OK";

  // Check ATR classification
  if (atrClassification === "high") {
    volatilityState = "HIGH";
  }

  // Check ATR percentile if available (0-1 range, convert to percentage)
  if (typeof atrPercentile === "number") {
    const atrPercent = atrPercentile > 1 ? atrPercentile : atrPercentile * 100;
    if (atrPercent >= 95) {
      volatilityState = "EXTREME";
    } else if (atrPercent >= 85) {
      volatilityState = "HIGH";
    }
  }

  // Block if extreme volatility
  if (volatilityState === "EXTREME") {
    return {
      allowed: false,
      reason: "EXTREME_VOLATILITY: ATR percentile >= 95%",
      accuracyUsed: accuracyPercent,
      rr,
      volatilityState: "EXTREME",
      entryZoneValid: true,
      isFinal: true,
    };
  }

  // All checks passed
  return {
    allowed: true,
    accuracyUsed: accuracyPercent,
    rr,
    volatilityState,
    entryZoneValid: true,
    isFinal: true,
  };
}

export class AutoTradeEngine {
  private userEngines: Map<
    string,
    {
      config: AutoTradeConfig;
      adapter: BinanceAdapter | null;
      activeTrades: Map<string, TradeExecution>;
      circuitBreaker: boolean;
      lastEquityCheck: Date;
    }
  > = new Map();

  // Auto-trade background loop tracking
  private autoTradeLoops: Map<
    string,
    {
      intervalId: NodeJS.Timeout | null;
      isRunning: boolean;
      lastResearchTime: Date | null;
      researchInProgress: boolean;
    }
  > = new Map();

  // Guard to prevent infinite recursion and redundant default config creation
  private static configCreatedOnce: Set<string> = new Set();

  /**
   * Get or create user engine instance
   */
  private async getUserEngine(uid: string): Promise<{
    config: AutoTradeConfig;
    adapter: BinanceAdapter | null;
    activeTrades: Map<string, TradeExecution>;
    circuitBreaker: boolean;
    lastEquityCheck: Date;
  }> {
    if (!this.userEngines.has(uid)) {
      const config = await this.loadConfig(uid);
      this.userEngines.set(uid, {
        config,
        adapter: null,
        activeTrades: new Map(),
        circuitBreaker: false,
        lastEquityCheck: new Date(0),
      });
    }
    return this.userEngines.get(uid)!;
  }

  /**
   * P4: Calculate dynamic trade parameters based on accuracy and volatility
   * CRITICAL: Uses user's accuracyRiskConfig (single source of truth) instead of hardcoded values
   */

  /**
   * Load user configuration from Firestore
   */
  async loadConfig(uid: string): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db
        .collection("users")
        .doc(uid)
        .collection("autoTradeConfig")
        .doc("current")
        .get();

      if (configDoc.exists) {
        const data = configDoc.data()!;

        const mergedConfig = {
          ...DEFAULT_CONFIG,
          ...data,
          lastRun: data.lastRun?.toDate(),
          stats: data.stats || DEFAULT_CONFIG.stats,
        } as AutoTradeConfig;

        return mergedConfig;
      }

      // [DIAGNOSTIC] Document does not exist
      console.log(
        "[AUTO_TRADE_ENGINE_LOAD_CONFIG_DIAGNOSTIC] Document does not exist, initializing default config:",
        { uid },
      );

      // CRITICAL: Block infinite recursion if we already tried creating this session
      if (AutoTradeEngine.configCreatedOnce.has(uid)) {
        console.warn(
          "[AUTO_TRADE_ENGINE_LOAD_CONFIG_DIAGNOSTIC] Default config already created once this session, returning memory default to prevent loop:",
          { uid },
        );
        return DEFAULT_CONFIG;
      }

      // Mark as created BEFORE write to ensure re-entry is blocked even if write is in progress
      AutoTradeEngine.configCreatedOnce.add(uid);

      // CRITICAL FIX: Direct write to Firestore to prevent infinite recursion loop
      // We set the default config directly with merge:false to ensure a clean slate, then return it.
      try {
        await db
          .collection("users")
          .doc(uid)
          .collection("autoTradeConfig")
          .doc("current")
          .set(DEFAULT_CONFIG, { merge: false });
        console.log(
          "[AUTO_TRADE_CONFIG_CREATED_ONCE] Created default auto-trade configuration for user:",
          uid,
        );
        logger.info({ uid }, "Created default auto-trade configuration");
      } catch (saveErr: any) {
        logger.warn(
          { uid, error: saveErr.message },
          "Failed to save default config (possible race condition), utilizing default in-memory",
        );
      }

      return DEFAULT_CONFIG;
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error loading auto-trade config",
      );
      // On error, return default but DO NOT attempt to write (could be a permission issue causing a loop)
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save user configuration to Firestore
   */
  async saveConfig(
    uid: string,
    config: Partial<AutoTradeConfig>,
  ): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();

      // [DIAGNOSTIC] Log incoming config to save
      console.log("[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Input config:", {
        uid,
        inputConfig: config,
        autoTradeEnabledInInput: config.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof config.autoTradeEnabled,
      });

      const currentConfig = await this.loadConfig(uid);

      // [DIAGNOSTIC] Log current config before merge
      console.log(
        "[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Current config before merge:",
        {
          uid,
          currentAutoTradeEnabled: currentConfig.autoTradeEnabled,
          typeofCurrentAutoTradeEnabled: typeof currentConfig.autoTradeEnabled,
        },
      );

      const updatedConfig = {
        ...currentConfig,
        ...config,
        lastRun: new Date(),
      };

      // [DIAGNOSTIC] Log updated config after merge
      console.log(
        "[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Updated config after merge:",
        {
          uid,
          updatedAutoTradeEnabled: updatedConfig.autoTradeEnabled,
          typeofUpdatedAutoTradeEnabled: typeof updatedConfig.autoTradeEnabled,
        },
      );

      // CRITICAL: Build config document, only including defined fields
      // Firestore rejects writes containing undefined values
      const configDoc: any = {
        autoTradeEnabled: updatedConfig.autoTradeEnabled,
        perTradeRiskPct: updatedConfig.perTradeRiskPct,
        maxConcurrentTrades: updatedConfig.maxConcurrentTrades,
        maxDailyLossPct: updatedConfig.maxDailyLossPct,
        stopLossPct: updatedConfig.stopLossPct,
        takeProfitPct: updatedConfig.takeProfitPct,
        manualOverride: updatedConfig.manualOverride,
        mode: updatedConfig.mode,
        maxTradesPerDay:
          updatedConfig.maxTradesPerDay || DEFAULT_CONFIG.maxTradesPerDay,
        cooldownSeconds:
          updatedConfig.cooldownSeconds || DEFAULT_CONFIG.cooldownSeconds,
        panicStopEnabled:
          updatedConfig.panicStopEnabled || DEFAULT_CONFIG.panicStopEnabled,
        slippageBlocker:
          updatedConfig.slippageBlocker || DEFAULT_CONFIG.slippageBlocker,
        stats: updatedConfig.stats || DEFAULT_CONFIG.stats,
        lastRun: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };

      // Only include equitySnapshot if it's defined (not undefined)
      if (
        updatedConfig.equitySnapshot !== undefined &&
        updatedConfig.equitySnapshot !== null
      ) {
        configDoc.equitySnapshot = updatedConfig.equitySnapshot;
      }

      // CRITICAL: Remove any undefined values from configDoc BEFORE merge
      const sanitizedConfigDoc: any = {};
      for (const [key, value] of Object.entries(configDoc)) {
        if (value !== undefined) {
          sanitizedConfigDoc[key] = value;
        }
      }

      // CRITICAL: Get existing document first to merge properly
      const configDocRef = db
        .collection("users")
        .doc(uid)
        .collection("autoTradeConfig")
        .doc("current");
      const existingConfigDoc = await configDocRef.get();
      const existingConfig = existingConfigDoc.exists
        ? existingConfigDoc.data() || {}
        : {};

      // CRITICAL: Merge with existing config first
      const mergedConfig = {
        ...existingConfig,
        ...sanitizedConfigDoc,
      };

      // CRITICAL: Remove any undefined values AFTER merge (existing doc might have undefined)
      const finalSanitized: any = {};
      for (const [key, value] of Object.entries(mergedConfig)) {
        if (value !== undefined) {
          finalSanitized[key] = value;
        }
      }

      // [DIAGNOSTIC] Log final document to be written to Firestore
      console.log(
        "[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Document to write to Firestore:",
        {
          uid,
          path: `users/${uid}/autoTradeConfig/current`,
          autoTradeEnabled: finalSanitized.autoTradeEnabled,
          typeofAutoTradeEnabled: typeof finalSanitized.autoTradeEnabled,
          hasEquitySnapshot: "equitySnapshot" in finalSanitized,
        },
      );

      // CRITICAL: Runtime Guard Check using central adapter
      firestoreAdapter.guardAgainstIllegalWrites(
        `users/${uid}/autoTradeConfig/current`,
        finalSanitized,
      );

      await configDocRef.set(finalSanitized, { merge: true });

      // [DIAGNOSTIC] Verify write by reading back
      const verifyDoc = await db
        .collection("users")
        .doc(uid)
        .collection("autoTradeConfig")
        .doc("current")
        .get();
      const verifyData = verifyDoc.data();
      console.log(
        "[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Verification read after write:",
        {
          uid,
          autoTradeEnabled: verifyData?.autoTradeEnabled,
          typeofAutoTradeEnabled: typeof verifyData?.autoTradeEnabled,
        },
      );

      logger.info(
        { uid, config: configDoc },
        "Auto-trade config saved to Firestore",
      );

      // Update in-memory config
      const engine = await this.getUserEngine(uid);
      engine.config = updatedConfig as AutoTradeConfig;

      // [DIAGNOSTIC] Log final return value
      console.log(
        "[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Returning config:",
        {
          uid,
          autoTradeEnabled: updatedConfig.autoTradeEnabled,
          typeofAutoTradeEnabled: typeof updatedConfig.autoTradeEnabled,
        },
      );

      return updatedConfig as AutoTradeConfig;
    } catch (error: any) {
      logger.error(
        { error: error.message, stack: error.stack, uid },
        "Error saving auto-trade config",
      );
      console.error("[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Error:", {
        uid,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Initialize adapter for user (load API keys securely using unified resolver)
   * Supports all exchanges: binance, bitget, bingx, weex
   */
  async initializeAdapter(uid: string): Promise<any> {
    try {
      // TEMPORARY DEBUG: Log initialization call and stack trace
      console.log(`🔥 [DEBUG] [INITIALIZE_ADAPTER_CALL] uid: ${uid}`);
      console.log("🔥 [DEBUG] [INITIALIZE_ADAPTER_STACK]", new Error().stack);

      const { resolveExchangeConnector } = await import("./exchangeResolver");
      console.log(`🔥 [DEBUG] [BEFORE_RESOLVE_EXCHANGE_CONNECTOR] uid: ${uid}`);
      
      // CRITICAL FIX: Use "user_request" context to match isExchangeUsable() context
      // This ensures consistency between usability check and adapter initialization
      const resolved = await resolveExchangeConnector(uid, "user_request");
      console.log(
        `🔥 [DEBUG] [AFTER_RESOLVE_EXCHANGE_CONNECTOR] result: ${resolved ? "SUCCESS" : "NULL"}`,
      );

      if (!resolved) {
        logger.warn(
          { uid },
          "No exchange API credentials found for auto-trade",
        );
        return null;
      }

      const { connector, exchange } = resolved;

      // Validate connector has required methods
      if (!connector || typeof connector.placeOrder !== "function") {
        logger.error(
          { uid, exchange },
          "Exchange connector missing required methods",
        );
        return null;
      }

      // For Binance, optionally validate API key permissions
      if (
        exchange === "binance" &&
        typeof connector.validateApiKey === "function"
      ) {
        try {
          console.log(
            `🔥 [DEBUG] [BEFORE_VALIDATE_API_KEY] uid: ${uid}, exchange: ${exchange}`,
          );
          const validation = await connector.validateApiKey();
          console.log(
            `🔥 [DEBUG] [AFTER_VALIDATE_API_KEY] result:`,
            validation,
          );
          if (!validation.valid || !validation.canTrade) {
            logger.error(
              { uid, exchange },
              "API key validation failed - insufficient permissions",
            );
            return null;
          }
        } catch (valError: any) {
          logger.warn(
            { uid, exchange, error: valError.message },
            "API key validation error, continuing anyway",
          );
        }
      }

      const engine = await this.getUserEngine(uid);
      engine.adapter = connector;

      logger.info(
        { uid, exchange },
        "Auto-trade adapter initialized successfully",
      );
      return connector;
    } catch (error: any) {
      logger.error(
        { error: error.message, stack: error.stack, uid },
        "Error initializing adapter",
      );
      return null;
    }
  }

  /**
   * Execute trade
   */
  async executeTrade(
    uid: string,
    signal: TradeSignal,
    skipConfirmationCheck: boolean = false,
  ): Promise<TradeExecution> {
    const requestId =
      signal.requestId ||
      `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info(
      { uid, symbol: signal.symbol, requestId },
      "Starting trade execution",
    );

    // FAIL-SAFE: Load trading settings FIRST and validate all required fields
    let settings: TradingSettings;
    try {
      settings = await AutoTradeEngine.getTradingSettings(uid);
      logger.info(
        { uid, maxTradesPerDay: settings.maxTradesPerDay },
        "Loaded trading settings for execution (enforcing limit)",
      );

      // Strict validation: Block if ANY required setting is undefined/null
      if (
        !settings ||
        settings.maxPositionPct === undefined ||
        settings.maxDailyLossPct === undefined ||
        settings.maxTradesPerDay === undefined ||
        !settings.positionSizingMap ||
        typeof settings.positionSizingMap !== "object"
      ) {
        await this.logTradeEvent(uid, "TRADE_REJECTED", {
          signal,
          reason:
            "TRADING_SETTINGS_INVALID: One or more required trading settings are missing or invalid",
        });
        throw new Error(
          "Trading settings validation failed - blocking trade for safety",
        );
      }

      // Validate positionSizingMap structure
      const requiredKeys = ["0-84", "85-89", "90-94", "95-99", "100"];
      const missingKeys = requiredKeys.filter(
        (key) => settings.positionSizingMap[key] === undefined,
      );
      if (missingKeys.length > 0) {
        await this.logTradeEvent(uid, "TRADE_REJECTED", {
          signal,
          reason: `POSITION_SIZING_MAP_INVALID: Missing ranges: ${missingKeys.join(", ")}`,
        });
        throw new Error(
          "Position sizing map validation failed - blocking trade for safety",
        );
      }
    } catch (settingsError: any) {
      logger.error(
        { uid, error: settingsError.message },
        "CRITICAL: Trading settings load/validation failed",
      );
      // If settings fail to load, stop auto-trade loop for safety
      await this.stopAutoTradeLoop(uid);
      await this.logTradeEvent(uid, "AUTO_TRADE_STOPPED", {
        reason: "SETTINGS_LOAD_FAILURE",
        error: settingsError.message,
      });
      throw new Error(
        "Trading settings unavailable - auto-trade stopped for safety",
      );
    }

    // CRITICAL: Consolidated accuracy validation
    const accuracyValidation = validateAccuracyForExecution(
      signal.accuracy,
      settings,
      skipConfirmationCheck,
    );
    const accuracyThreshold = accuracyValidation.threshold;

    logger.info(
      {
        uid,
        symbol: signal.symbol,
        userAccuracyTrigger: settings.accuracyTrigger,
        executionThreshold: accuracyThreshold,
        skipConfirmationCheck,
        usingUserSetting:
          !skipConfirmationCheck && settings.accuracyTrigger?.min !== undefined,
      },
      `[EXECUTE_TRADE] Using accuracy threshold: ${accuracyThreshold}% (user-defined: ${settings.accuracyTrigger?.min ?? "not set, using default 75%"})`,
    );

    // Check if trade confirmation is required
    // CRITICAL: Use pre-loaded user settings (centralized source)
    try {
      const requiresConfirmation =
        !skipConfirmationCheck &&
        settings.notifications?.tradeConfirmationRequired === true;

      // Auto Trade goal: FULLY AUTOMATIC (no manual confirmation)
      // This requirement implies that automated background trades should bypass confirmation.
      // However, we respect the setting above to maintain safety if the user explicitly wants confirm.

      if (requiresConfirmation) {
        // Load config for equity calculation
        const config = await this.loadConfig(uid);
        // Calculate position size for pending trade
        const equity = config.equitySnapshot || 1000;
        // Calculate actual position size
        const positionSizing = calculatePositionSize(signal.accuracy, settings);
        let finalPositionPercent = Math.min(
          positionSizing.positionPercent,
          settings.maxPositionPct,
        );

        // If it would be a 0% position, force 1% for the pending trade so the user can see/approve it
        if (finalPositionPercent <= 0) {
          finalPositionPercent = 1.0;
          logger.info(
            { uid, symbol: signal.symbol },
            "PENDING_TRADE_SIZE_BOOST: Enforcing minimum 1% for pending trade notification",
          );
        }

        const quantity =
          (equity * (finalPositionPercent / 100)) / signal.entryPrice;

        // Save pending trade to Firestore for user approval
        await this.savePendingTrade(uid, {
          requestId,
          symbol: signal.symbol,
          side: signal.signal,
          quantity: Math.floor(quantity * 100) / 100, // Round to 2 decimals
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss || signal.entryPrice * 0.985,
          takeProfit: signal.takeProfit || signal.entryPrice * 1.03,
          takeProfit1: signal.takeProfit1,
          takeProfit2: signal.takeProfit2,
          takeProfit3: signal.takeProfit3,
          accuracy: signal.accuracy,
          researchRequestId: signal.requestId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // Increased to 15 minute expiry
        });

        // Send trade confirmation notification
        await sendTradeConfirmationNotification(uid, signal);
        await this.logTradeEvent(uid, "TRADE_CONFIRMATION_REQUIRED", {
          signal,
          requestId,
          message:
            "Trade confirmation required - pending trade created, awaiting user approval",
        });

        // Return a pending trade execution (not rejected, just pending)
        const pendingTrade: TradeExecution = {
          tradeId: requestId,
          symbol: signal.symbol,
          side: signal.signal,
          quantity: Math.floor(quantity * 100) / 100,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss || signal.entryPrice * 0.985,
          takeProfit: signal.takeProfit || signal.entryPrice * 1.03,
          status: "PENDING",
          timestamp: new Date(),
          mode: "AUTO",
        };

        return pendingTrade;
      }
    } catch (confirmationError: any) {
      logger.warn(
        { uid, error: confirmationError.message },
        "Failed to check trade confirmation setting, proceeding with execution",
      );
    }

    // Check for whale alerts if enabled AND auto trade is active
    try {
      if (settings.notifications?.whaleAlerts) {
        const engine = await this.getUserEngine(uid);
        await checkWhaleAlerts(
          uid,
          signal.symbol,
          engine.adapter,
          this.logTradeEvent.bind(this),
        );
      }
    } catch (whaleError: any) {
      logger.warn(
        { uid, error: whaleError.message },
        "Failed to check whale alerts",
      );
    }

    // ALWAYS load config fresh from Firestore before execution
    const config = await this.loadConfig(uid);
    const engine = await this.getUserEngine(uid);
    engine.config = config; // Update in-memory config

    // CRITICAL DIAGNOSTIC: Log config state at executeTrade entry
    logger.info(
      {
        uid,
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        autoTradeEnabled: config.autoTradeEnabled,
        manualOverride: config.manualOverride,
        skipConfirmationCheck,
        configSource: "fresh-load-in-executeTrade",
        configLastRun: config.lastRun?.toISOString(),
      },
      "🔍 [EXECUTE_TRADE] Starting trade execution with fresh config",
    );

    // Check risk guards (passing skipConfirmationCheck as isManualApproval)
    const riskCheck = await checkRiskGuards(uid, signal, skipConfirmationCheck);
    if (!riskCheck.allowed) {
      const reason = riskCheck.reason || "Trade rejected by risk guards";
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "RISK_GUARDS_BLOCKED",
          reason,
          accuracy: signal.accuracy,
          autoTradeEnabled: config.autoTradeEnabled,
          manualOverride: config.manualOverride,
        },
        "🔍 [DEBUG_TRACE] BLOCKED at risk guards check",
      );

      // Get user settings for threshold
      const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
      const userThreshold = skipConfirmationCheck
        ? 60
        : (tradingSettings.accuracyTrigger?.min ?? 75);

      // Note: Skip logging already done in checkRiskGuards, but log here too for executeTrade context
      await logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: userThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? "available" : "unavailable",
        additionalDetails: {
          autoTradeEnabled: config.autoTradeEnabled,
          manualOverride: config.manualOverride,
          skipConfirmationCheck,
          userAccuracyTrigger: tradingSettings.accuracyTrigger,
        },
      });

      await this.logTradeEvent(uid, "TRADE_REJECTED", {
        signal,
        reason,
      });

      // NOTIFICATION: Consolidated Telegram Skip Alert
      await sendConsolidatedTelegramAlert(uid, "skipped", {
        symbol: signal.symbol,
        reason,
        accuracy: signal.accuracy,
      });

      throw new Error(reason);
    }

    // 🔍 [DEBUG] Risk guards PASSED - proceeding to adapter initialization
    logger.info(
      {
        uid,
        symbol: signal.symbol,
        step: "RISK_GUARDS_PASSED_IN_EXECUTE",
        hasAdapter: !!engine.adapter,
        nextStep: "ADAPTER_INIT_OR_POSITION_SIZING",
      },
      "🔍 [DEBUG_TRACE] Risk guards PASSED in executeTrade - proceeding to adapter/position sizing",
    );

    // Note: Redundant accuracy check removed. checkRiskGuards handles the user-defined accuracy trigger (or 60% for manual).

    // Initialize adapter if needed
    if (!engine.adapter) {
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          step: "ADAPTER_INIT_START",
        },
        "🔍 [DEBUG_TRACE] Adapter missing - initializing",
      );

      await this.initializeAdapter(uid);
      if (!engine.adapter) {
        logger.error(
          {
            uid,
            symbol: signal.symbol,
            step: "ADAPTER_INIT_FAILED",
          },
          "🔍 [DEBUG_TRACE] BLOCKED: Adapter initialization failed",
        );
        throw new Error("Failed to initialize exchange adapter");
      }

      logger.info(
        {
          uid,
          symbol: signal.symbol,
          step: "ADAPTER_INIT_SUCCESS",
          adapterType: engine.adapter?.constructor?.name,
        },
        "🔍 [DEBUG_TRACE] Adapter initialized successfully",
      );
    } else {
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          step: "ADAPTER_EXISTS",
          adapterType: engine.adapter?.constructor?.name,
        },
        "🔍 [DEBUG_TRACE] Adapter already exists",
      );
    }

    // Get current equity using imported function from autoTradeGuards
    const equity = await getCurrentEquity(
      uid,
      engine.adapter,
      config,
      this.saveConfig.bind(this),
    );

    // Get trading settings for position sizing
    const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);

    // 🔍 [DEBUG] Starting position sizing calculation
    logger.info(
      {
        uid,
        symbol: signal.symbol,
        step: "POSITION_SIZING_START",
        equity,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        hasTradePlan: !!(signal as any).researchResult?.result?.tradePlan,
      },
      "🔍 [DEBUG_TRACE] Starting position sizing calculation",
    );

    // P2-B: Volatility-Based Position Sizing
    // Goal: Risk fixed % of capital per trade based on SL distance

    // 1. Determine Risk Amount
    const riskPct = Math.min(1.0, config.perTradeRiskPct || 1.0); // Safety Rule: Hard cap at 1% risk of account equity
    const riskAmount = equity * (riskPct / 100);

    // 2. Determine SL Distance
    // signal.stopLoss is guaranteed by P2-A logic or fallback defaults
    const slDistance = Math.abs(signal.entryPrice - signal.stopLoss);

    // 🔍 [DEBUG] Validate SL/TP before position sizing
    if (!signal.stopLoss || signal.stopLoss <= 0 || isNaN(signal.stopLoss)) {
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          stopLoss: signal.stopLoss,
          entryPrice: signal.entryPrice,
        },
        "🔍 [DEBUG_TRACE] BLOCKED: Stop loss missing or invalid",
      );
      throw new Error(`Invalid stop loss: ${signal.stopLoss}`);
    }

    if (
      !signal.entryPrice ||
      signal.entryPrice <= 0 ||
      isNaN(signal.entryPrice)
    ) {
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          entryPrice: signal.entryPrice,
        },
        "🔍 [DEBUG_TRACE] BLOCKED: Entry price missing or invalid",
      );
      throw new Error(`Invalid entry price: ${signal.entryPrice}`);
    }

    // Safety check for SL distance
    if (slDistance <= 0 || isNaN(slDistance)) {
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          slDistance,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
        },
        "🔍 [DEBUG_TRACE] BLOCKED: Invalid SL distance",
      );
      throw new Error(
        `Invalid SL distance (${slDistance}) for volatility sizing - aborting trade`,
      );
    }

    // SL distance guard: Check if SL too close to entry (minimum tick size check)
    // For most exchanges, minimum tick size is ~0.1% for major pairs
    const minimumTickSize = signal.entryPrice * 0.001; // 0.1% of entry price
    if (slDistance < minimumTickSize) {
      const reason = "SL_TOO_CLOSE_TO_ENTRY";
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          reason,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          slDistance,
          minimumTickSize,
          slDistancePct:
            ((slDistance / signal.entryPrice) * 100).toFixed(4) + "%",
        },
        `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - SL distance (${slDistance.toFixed(8)}) < minimum tick size (${minimumTickSize.toFixed(8)})`,
      );

      await logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? "available" : "unavailable",
        additionalDetails: {
          slDistance,
          minimumTickSize,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
        },
      });

      await this.logTradeEvent(uid, "TRADE_SKIPPED", {
        signal,
        reason,
        details: `Stop loss too close to entry price. SL distance: ${slDistance.toFixed(8)}, minimum required: ${minimumTickSize.toFixed(8)}`,
        accuracy: signal.accuracy,
      });

      // Final mandatory log
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          acc: signal.accuracy.toFixed(1),
          rr: 0,
          qty: 0,
          minNotional: 10,
          reason,
        },
        `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=0.00 qty=0.000000 minNotional=10 → BLOCKED (${reason})`,
      );

      throw new Error(
        `${reason}: Stop loss is too close to entry price (${slDistance.toFixed(8)} < ${minimumTickSize.toFixed(8)})`,
      );
    }

    // 4. Calculate Raw Quantity based on Risk
    // riskAmount = quantity * slDistance  =>  quantity = riskAmount / slDistance
    let quantity = riskAmount / slDistance;

    logger.info(
      {
        uid,
        symbol: signal.symbol,
        step: "POSITION_SIZING_CALC",
        riskPct,
        riskAmount,
        slDistance,
        rawQuantity: quantity,
      },
      "🔍 [DEBUG_TRACE] Raw quantity calculated from risk",
    );

    // P4: Dynamic Params (Leverage and Model-based Size)
    // CRITICAL: Uses user's accuracyRiskConfig (single source of truth)
    const modelParams = await calculateDynamicParams(
      uid,
      signal.accuracy,
      (signal as any).volatilityClassification || "low",
      50,
    );
    const modelLeverage = signal.leverage || modelParams.leverage || 1;

    // CRITICAL: Trade size % is calculated as percentage of wallet balance (account equity)
    // modelSizePct represents the percentage of total account equity to allocate to this trade
    // This is NOT margin-based sizing or fixed-amount sizing - it's strictly wallet balance percentage
    // Example: If equity = $1000 and modelSizePct = 5%, then position value = $50
    const modelSizePct = modelParams.sizePct;
    const modelMaxQuantity =
      (equity * (modelSizePct / 100)) / signal.entryPrice;

    // Log selected range and applied values for audit trail
    if (modelParams.matchedRange) {
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          accuracy: signal.accuracy,
          matchedRange: `${modelParams.matchedRange.minAccuracy}-${modelParams.matchedRange.maxAccuracy ?? "∞"}%`,
          appliedSizePct: modelParams.sizePct,
          appliedLeverage: modelParams.leverage,
          positionValueUSD: equity * (modelSizePct / 100),
          skipReason: modelParams.skip,
        },
        "✅ [ACCURACY_RISK_CONFIG] Applied configuration - trade size as % of wallet balance",
      );
    }

    // Apply strict model caps
    if (quantity > modelMaxQuantity) {
      quantity = modelMaxQuantity;
      logger.debug(
        { uid, quantity, modelMaxQuantity },
        "Quantity capped by balance model",
      );
    }

    // 4. Apply Hard Cap (Max Position %)
    // Critical safety: never exceed user's hard cap per trade
    const maxPositionValue = equity * (tradingSettings.maxPositionPct / 100);
    const maxQuantity = maxPositionValue / signal.entryPrice;

    const volatilityQuantity = quantity;
    const positionSizeBeforeCap = quantity;
    const positionValueBeforeCap = positionSizeBeforeCap * signal.entryPrice;
    let capped = "NO";

    // Apply Cap
    if (quantity > maxQuantity) {
      quantity = maxQuantity;
      capped = "YES";
    }

    // 5. Final Value Calculation
    let positionValue = quantity * signal.entryPrice;

    // 🔍 [CHECKPOINT] Position size logging - before and after safety caps
    logger.info(
      {
        uid,
        symbol: signal.symbol,
        step: "POSITION_SIZING_CHECKPOINT",
        accuracySlab: modelParams.matchedRange
          ? `${modelParams.matchedRange.minAccuracy}-${modelParams.matchedRange.maxAccuracy ?? "∞"}%`
          : "N/A",
        userSelectedSizePct: modelParams.sizePct,
        positionSizeBeforeCap,
        positionValueBeforeCap: positionValueBeforeCap.toFixed(2),
        positionSizeAfterCap: quantity,
        positionValueAfterCap: positionValue.toFixed(2),
        maxPositionPct: tradingSettings.maxPositionPct,
        maxPositionValue: maxPositionValue.toFixed(2),
        capped,
        equity,
        entryPrice: signal.entryPrice,
      },
      "✅ [POSITION_SIZING_CHECKPOINT] Position size before/after safety caps logged",
    );

    // 🔍 [DEBUG] Position value calculated
    logger.info(
      {
        uid,
        symbol: signal.symbol,
        step: "POSITION_VALUE_CALC",
        positionValue,
        quantity,
        entryPrice: signal.entryPrice,
      },
      "🔍 [DEBUG_TRACE] Position value calculated",
    );

    // Low balance handling: Trade MUST still execute if balance >= 10 USDT.
    // Ensure minimum notional of 10 USDT if equity >= 10.
    const minNotional = 10;
    if (positionValue < minNotional && equity >= minNotional) {
      const originalQuantity = quantity;
      const originalPositionValue = positionValue;
      const originalRiskAmount = riskAmount;

      quantity = minNotional / signal.entryPrice;
      positionValue = quantity * signal.entryPrice;

      // Recalculate risk impact after min-notional adjustment
      const adjustedRiskAmount = quantity * slDistance;
      const adjustedRiskPct = (adjustedRiskAmount / equity) * 100;
      const maxAllowedRiskPct = Math.min(1.0, config.perTradeRiskPct || 1.0);

      // If adjusted risk exceeds allowed max, BLOCK with clear reason
      if (adjustedRiskPct > maxAllowedRiskPct) {
        const reason = "MIN_NOTIONAL_RISK_EXCEEDED";
        logger.error(
          {
            uid,
            symbol: signal.symbol,
            step: "POSITION_SIZING_BLOCKED",
            reason,
            equity,
            originalQuantity,
            originalPositionValue,
            originalRiskAmount,
            originalRiskPct: (originalRiskAmount / equity) * 100,
            adjustedQuantity: quantity,
            adjustedPositionValue: positionValue,
            adjustedRiskAmount,
            adjustedRiskPct,
            maxAllowedRiskPct,
            minNotional,
          },
          `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Adjusting to min notional (${minNotional} USDT) would exceed max risk (${adjustedRiskPct.toFixed(2)}% > ${maxAllowedRiskPct.toFixed(2)}%)`,
        );

        await logAutoTradeSkip(uid, reason, {
          symbol: signal.symbol,
          accuracy: signal.accuracy,
          threshold: accuracyThreshold,
          signal: signal.signal,
          exchangeStatus: engine.adapter ? "available" : "unavailable",
          additionalDetails: {
            adjustedRiskPct,
            maxAllowedRiskPct,
            minNotional,
            quantity,
            equity,
          },
        });

        await this.logTradeEvent(uid, "TRADE_SKIPPED", {
          signal,
          reason,
          details: `Minimum notional adjustment would exceed max risk. Adjusted risk: ${adjustedRiskPct.toFixed(2)}%, max allowed: ${maxAllowedRiskPct.toFixed(2)}%`,
          accuracy: signal.accuracy,
          equity,
        });

        // Final mandatory log
        const rr =
          signal.takeProfit && signal.stopLoss && signal.entryPrice
            ? Math.abs(
                (signal.takeProfit - signal.entryPrice) /
                  Math.abs(signal.entryPrice - signal.stopLoss),
              )
            : 0;
        logger.info(
          {
            uid,
            symbol: signal.symbol,
            acc: signal.accuracy.toFixed(1),
            rr: rr.toFixed(2),
            qty: quantity.toFixed(6),
            minNotional,
            reason,
          },
          `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=${minNotional} → BLOCKED (${reason})`,
        );

        throw new Error(
          `${reason}: Adjusting to min notional would exceed max risk (${adjustedRiskPct.toFixed(2)}% > ${maxAllowedRiskPct.toFixed(2)}%)`,
        );
      }

      logger.info(
        {
          uid,
          symbol: signal.symbol,
          equity,
          originalValue: originalPositionValue,
          adjustedValue: positionValue,
          originalQuantity,
          adjustedQuantity: quantity,
          adjustedRiskPct: adjustedRiskPct.toFixed(2) + "%",
        },
        `✅ Adjusting quantity to meet minimum notional of ${minNotional} USDT (risk: ${adjustedRiskPct.toFixed(2)}%)`,
      );
    }

    let finalPositionPercent = (positionValue / equity) * 100;

    // CRITICAL FIX: If manual approval (skipConfirmationCheck=true), enforce minimum size
    // This prevents trades from being skipped due to positionSizingMap returning 0.
    if (
      skipConfirmationCheck &&
      (quantity <= 0 || finalPositionPercent <= 0.5)
    ) {
      const minP = Math.min(1.0, tradingSettings.maxPositionPct);
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          originalQuantity: quantity,
          originalPercent: finalPositionPercent,
          enforcedMin: minP,
        },
        "Manual approval detected with insufficient quantity - forcing minimum position",
      );
      finalPositionPercent = minP;
      quantity = (equity * (finalPositionPercent / 100)) / signal.entryPrice;
    }

    // Position sizing validation (CRITICAL)
    if (quantity <= 0 || isNaN(quantity)) {
      const reason = "POSITION_SIZE_INVALID";
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          reason,
          quantity,
          equity,
          riskPct,
          riskAmount,
          slDistance,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          positionValue,
          minNotional: 10,
        },
        `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Calculated quantity is zero or negative`,
      );

      await logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? "available" : "unavailable",
        additionalDetails: {
          quantity,
          equity,
          riskPct,
          slDistance,
        },
      });

      await this.logTradeEvent(uid, "TRADE_SKIPPED", {
        signal,
        reason,
        details: `Calculated quantity is zero or negative. Quantity: ${quantity}, Equity: ${equity}, Risk%: ${riskPct}%, SL Distance: ${slDistance}`,
        accuracy: signal.accuracy,
        equity,
      });

      // Final mandatory log
      const rr =
        signal.takeProfit && signal.stopLoss && signal.entryPrice
          ? Math.abs(
              (signal.takeProfit - signal.entryPrice) /
                Math.abs(signal.entryPrice - signal.stopLoss),
            )
          : 0;
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          acc: signal.accuracy.toFixed(1),
          rr: rr.toFixed(2),
          qty: quantity.toFixed(6),
          minNotional: 10,
          reason,
        },
        `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`,
      );

      throw new Error(
        `${reason}: Calculated position size is zero or negative (${quantity}) - try increasing equity or perTradeRiskPct`,
      );
    }

    if (positionValue <= 0 || isNaN(positionValue)) {
      const reason = "POSITION_VALUE_INVALID";
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          reason,
          positionValue,
          quantity,
          entryPrice: signal.entryPrice,
          equity,
          minNotional: 10,
        },
        `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Position value is zero or negative`,
      );

      await this.logTradeEvent(uid, "TRADE_SKIPPED", {
        signal,
        reason,
        details: `Position value is zero or negative. Position Value: ${positionValue}, Quantity: ${quantity}, Entry Price: ${signal.entryPrice}`,
        accuracy: signal.accuracy,
        equity,
      });

      // Final mandatory log
      const rr =
        signal.takeProfit && signal.stopLoss && signal.entryPrice
          ? Math.abs(
              (signal.takeProfit - signal.entryPrice) /
                Math.abs(signal.entryPrice - signal.stopLoss),
            )
          : 0;
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          acc: signal.accuracy.toFixed(1),
          rr: rr.toFixed(2),
          qty: quantity.toFixed(6),
          minNotional: 10,
          reason,
        },
        `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`,
      );

      throw new Error(
        `${reason}: Position value is zero or negative (${positionValue})`,
      );
    }

    if (positionValue < minNotional && equity < minNotional) {
      const reason = "INSUFFICIENT_BALANCE";
      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "POSITION_SIZING_BLOCKED",
          reason,
          positionValue,
          equity,
          minNotional,
          quantity,
        },
        `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Equity (${equity}) < min notional (${minNotional})`,
      );

      await logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? "available" : "unavailable",
        additionalDetails: {
          equity,
          minNotional,
          positionValue,
          quantity,
        },
      });

      await this.logTradeEvent(uid, "TRADE_SKIPPED", {
        signal,
        reason,
        details: `Insufficient balance. Equity: ${equity}, Min Notional: ${minNotional}`,
        accuracy: signal.accuracy,
        equity,
      });

      // Final mandatory log
      const rr =
        signal.takeProfit && signal.stopLoss && signal.entryPrice
          ? Math.abs(
              (signal.takeProfit - signal.entryPrice) /
                Math.abs(signal.entryPrice - signal.stopLoss),
            )
          : 0;
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          acc: signal.accuracy.toFixed(1),
          rr: rr.toFixed(2),
          qty: quantity.toFixed(6),
          minNotional,
          reason,
        },
        `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=${minNotional} → BLOCKED (${reason})`,
      );

      throw new Error(
        `${reason}: Equity (${equity}) is below minimum notional (${minNotional} USDT)`,
      );
    }

    // Final mandatory log (single line summary) - Position sizing passed all validations
    const rr =
      signal.takeProfit && signal.stopLoss && signal.entryPrice
        ? Math.abs(
            (signal.takeProfit - signal.entryPrice) /
              Math.abs(signal.entryPrice - signal.stopLoss),
          )
        : 0;

    logger.info(
      {
        uid,
        symbol: signal.symbol,
        acc: signal.accuracy.toFixed(1),
        rr: rr.toFixed(2),
        qty: quantity.toFixed(6),
        minNotional,
        positionValue: positionValue.toFixed(2),
      },
      `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=${minNotional} → ALLOWED`,
    );

    logger.info(
      {
        uid,
        symbol: signal.symbol,
        step: "POSITION_SIZING_COMPLETE",
        finalQuantity: quantity,
        finalPositionValue: positionValue,
        finalPositionPercent,
        leverage: modelLeverage,
      },
      "🔍 [DEBUG_TRACE] Position sizing complete - proceeding to order placement",
    );

    logger.info(
      {
        uid,
        symbol: signal.symbol,
        equity,
        riskPct,
        riskAmount,
        slDistance,
        leverage: modelLeverage,
        volatilityQuantity,
        maxQuantity,
        finalQuantity: quantity,
        finalPositionValue: positionValue,
        finalPositionPercent,
        capped,
      },
      "✅ Position size calculated using Volatility-Based Sizing and Dynamic Model (P4)",
    );

    // Detect if scalping mode
    const isScalping =
      (await AutoTradeEngine.getTradingSettings(uid)).tradeType === "Scalping";

    // Create trade execution record
    // Note: leverage will be validated and potentially capped before execution
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trade: TradeExecution = {
      tradeId,
      symbol: signal.symbol,
      side: signal.signal,
      quantity,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      leverage: modelLeverage, // Will be validated/capped before execution
      status: "PENDING",
      timestamp: new Date(),
      mode: config.mode,
      takeProfit1: signal.takeProfit1,
      takeProfit2: signal.takeProfit2,
      takeProfit3: signal.takeProfit3,
      originalQuantity: quantity,
      remainingQuantity: quantity,
      isScalping: isScalping,
      trailingStopLoss: signal.stopLoss, // Start with initial SL
    };

    // Execute based on mode OR manual confirmation (override)
    const shouldExecute =
      (config.autoTradeEnabled && !config.manualOverride) ||
      skipConfirmationCheck;

    // CRITICAL DIAGNOSTIC: Log execution decision
    logger.info(
      {
        uid,
        symbol: signal.symbol,
        shouldExecute,
        autoTradeEnabled: config.autoTradeEnabled,
        manualOverride: config.manualOverride,
        skipConfirmationCheck,
        reason: shouldExecute
          ? "EXECUTING: All conditions met"
          : `BLOCKED: autoTradeEnabled=${config.autoTradeEnabled}, manualOverride=${config.manualOverride}, skipConfirmationCheck=${skipConfirmationCheck}`,
      },
      shouldExecute
        ? "✅ [EXECUTE_TRADE] Proceeding with trade execution"
        : "⛔ [EXECUTE_TRADE] Trade execution blocked",
    );

    if (!shouldExecute) {
      const rr =
        signal.takeProfit && signal.stopLoss && signal.entryPrice
          ? Math.abs(
              (signal.takeProfit - signal.entryPrice) /
                Math.abs(signal.entryPrice - signal.stopLoss),
            )
          : 0;
      const reason =
        config.autoTradeEnabled === false
          ? "AUTO_TRADE_DISABLED"
          : config.manualOverride === true
            ? "MANUAL_OVERRIDE"
            : "EXECUTION_BLOCKED";

      logger.error(
        {
          uid,
          symbol: signal.symbol,
          step: "EXECUTION_BLOCKED",
          autoTradeEnabled: config.autoTradeEnabled,
          manualOverride: config.manualOverride,
          skipConfirmationCheck,
          reason,
        },
        "🔍 [DEBUG_TRACE] BLOCKED: shouldExecute is false - trade will not execute",
      );

      // Final mandatory log for blocked execution
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          acc: signal.accuracy.toFixed(1),
          rr: rr.toFixed(2),
          qty: quantity.toFixed(6),
          minNotional: 10,
          reason,
        },
        `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`,
      );

      await logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? "available" : "unavailable",
        additionalDetails: {
          autoTradeEnabled: config.autoTradeEnabled,
          manualOverride: config.manualOverride,
          skipConfirmationCheck,
        },
      });

      await this.logTradeEvent(uid, "TRADE_SKIPPED", {
        signal,
        reason,
        details: `Execution blocked: autoTradeEnabled=${config.autoTradeEnabled}, manualOverride=${config.manualOverride}`,
        accuracy: signal.accuracy,
      });

      throw new Error(
        `${reason}: Trade execution blocked - autoTradeEnabled=${config.autoTradeEnabled}, manualOverride=${config.manualOverride}`,
      );
    }

    if (shouldExecute) {
      // 🔍 [CHECKPOINT] Leverage validation
      const MAX_LEVERAGE = 10; // Hard cap (exchange limit for most symbols)
      const userSelectedLeverage = modelLeverage;
      let finalLeverage = modelLeverage;
      let leverageCapped = false;

      // Validate leverage against hard cap
      if (finalLeverage > MAX_LEVERAGE) {
        finalLeverage = MAX_LEVERAGE;
        leverageCapped = true;
        logger.warn(
          {
            uid,
            symbol: signal.symbol,
            userSelectedLeverage,
            finalLeverage,
            maxLeverage: MAX_LEVERAGE,
          },
          "⚠️ [LEVERAGE_VALIDATION] Leverage capped at exchange maximum",
        );
      }

      // Update trade object with validated leverage
      trade.leverage = finalLeverage;

      // 🔍 [CHECKPOINT] Log leverage before/after validation
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          step: "LEVERAGE_CHECKPOINT",
          userSelectedLeverage,
          finalLeverage,
          maxLeverage: MAX_LEVERAGE,
          leverageCapped,
          accuracySlab: modelParams.matchedRange
            ? `${modelParams.matchedRange.minAccuracy}-${modelParams.matchedRange.maxAccuracy ?? "∞"}%`
            : "N/A",
        },
        "✅ [LEVERAGE_CHECKPOINT] User-selected vs final leverage logged",
      );

      // 🔍 [DEBUG] Final pre-execution check
      logger.info(
        {
          uid,
          symbol: signal.symbol,
          step: "PRE_ORDER_PLACEMENT",
          quantity,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          leverage: finalLeverage,
          hasAdapter: !!engine.adapter,
          adapterType: engine.adapter?.constructor?.name,
        },
        "🔍 [DEBUG_TRACE] All checks passed - proceeding to order placement",
      );
      // REAL TRADE EXECUTION
      try {
        // P4: Set Leverage on Exchange before placing order
        if (
          engine.adapter &&
          typeof engine.adapter.setLeverage === "function"
        ) {
          try {
            await engine.adapter.setLeverage(signal.symbol, finalLeverage);
            logger.info(
              { uid, symbol: signal.symbol, leverage: finalLeverage },
              "Leverage set on exchange",
            );
          } catch (levErr: any) {
            // Check if error is due to leverage exceeding exchange limit
            if (
              levErr.message?.includes("leverage") ||
              levErr.message?.includes("Leverage")
            ) {
              const reason = "LEVERAGE_EXCEEDS_EXCHANGE_LIMIT";
              logger.error(
                {
                  uid,
                  symbol: signal.symbol,
                  step: "LEVERAGE_VALIDATION_FAILED",
                  reason,
                  requestedLeverage: finalLeverage,
                  error: levErr.message,
                },
                `❌ [LEVERAGE_VALIDATION] BLOCKED: ${reason} - Exchange rejected leverage ${finalLeverage}x`,
              );

              await logAutoTradeSkip(uid, reason, {
                symbol: signal.symbol,
                accuracy: signal.accuracy,
                threshold: accuracyThreshold,
                signal: signal.signal,
                exchangeStatus: "available",
                additionalDetails: {
                  requestedLeverage: finalLeverage,
                  exchangeError: levErr.message,
                },
              });

              throw new Error(
                `${reason}: Exchange rejected leverage ${finalLeverage}x - ${levErr.message}`,
              );
            }
            logger.warn(
              { uid, symbol: signal.symbol, error: levErr.message },
              "Failed to set leverage on exchange, proceeding with order",
            );
          }
        }

        // P4: Set Margin Type (ISOLATED for safety)
        if (
          engine.adapter &&
          typeof engine.adapter.setMarginType === "function"
        ) {
          try {
            await engine.adapter.setMarginType(signal.symbol, "ISOLATED");
          } catch (marginErr) {
            /* ignore already set errors */
          }
        }

        logger.info(
          { uid, symbol: signal.symbol, requestId },
          "Pre-trade validation: checking orderbook liquidity",
        );

        // Pre-trade validation: orderbook liquidity & min notional
        const orderbook = await engine.adapter!.getOrderbook(signal.symbol, 5);
        const bestBid = parseFloat(orderbook.bids[0]?.price || "0");
        const bestAsk = parseFloat(orderbook.asks[0]?.price || "0");

        if (bestBid === 0 || bestAsk === 0) {
          throw new Error("Insufficient order book liquidity");
        }

        // SCALPING: Check spread - abort if > 0.5% (only for scalping mode)
        if (isScalping) {
          const spread = bestAsk - bestBid;
          const spreadPct = (spread / bestBid) * 100;
          if (spreadPct > 0.5) {
            throw new Error(
              `Spread too wide for scalping: ${spreadPct.toFixed(3)}% (max 0.5%)`,
            );
          }
          logger.info(
            {
              uid,
              symbol: signal.symbol,
              spreadPct: spreadPct.toFixed(3) + "%",
            },
            "[SCALPING] Spread check passed",
          );
        }

        // Check min notional (e.g., $10 minimum for Binance)
        const notional = quantity * signal.entryPrice;
        if (notional < 10) {
          throw new Error(
            `Order notional (${notional.toFixed(2)}) below minimum (10)`,
          );
        }

        // Exchange constraint visibility: Check minQty and stepSize if available
        let exchangeConstraints: any = {};
        try {
          if (
            engine.adapter &&
            typeof (engine.adapter as any).getSymbolInfo === "function"
          ) {
            const symbolInfo = await (engine.adapter as any).getSymbolInfo(
              signal.symbol,
            );
            if (symbolInfo) {
              exchangeConstraints = {
                minQty: symbolInfo.minQty,
                stepSize: symbolInfo.stepSize,
                minNotional: symbolInfo.minNotional,
              };
            }
          }
        } catch (constraintError: any) {
          logger.warn(
            { uid, symbol: signal.symbol, error: constraintError.message },
            "Failed to fetch exchange constraints (non-critical)",
          );
        }

        // Validate quantity against exchange constraints if available
        if (
          exchangeConstraints.minQty &&
          quantity < exchangeConstraints.minQty
        ) {
          const reason = "QUANTITY_BELOW_EXCHANGE_MIN";
          logger.error(
            {
              uid,
              symbol: signal.symbol,
              step: "ORDER_PLACEMENT_BLOCKED",
              reason,
              calculatedQty: quantity,
              minQty: exchangeConstraints.minQty,
              stepSize: exchangeConstraints.stepSize,
            },
            `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Calculated quantity (${quantity}) < exchange minQty (${exchangeConstraints.minQty})`,
          );

          await logAutoTradeSkip(uid, reason, {
            symbol: signal.symbol,
            accuracy: signal.accuracy,
            threshold: accuracyThreshold,
            signal: signal.signal,
            exchangeStatus: "available",
            additionalDetails: {
              calculatedQty: quantity,
              minQty: exchangeConstraints.minQty,
              stepSize: exchangeConstraints.stepSize,
            },
          });

          await this.logTradeEvent(uid, "TRADE_SKIPPED", {
            signal,
            reason,
            details: `Calculated quantity below exchange minimum. Quantity: ${quantity}, MinQty: ${exchangeConstraints.minQty}`,
            accuracy: signal.accuracy,
          });

          // Final mandatory log
          const rr =
            signal.takeProfit && signal.stopLoss && signal.entryPrice
              ? Math.abs(
                  (signal.takeProfit - signal.entryPrice) /
                    Math.abs(signal.entryPrice - signal.stopLoss),
                )
              : 0;
          logger.info(
            {
              uid,
              symbol: signal.symbol,
              acc: signal.accuracy.toFixed(1),
              rr: rr.toFixed(2),
              qty: quantity.toFixed(6),
              minNotional: 10,
              reason,
            },
            `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`,
          );

          throw new Error(
            `${reason}: Calculated quantity (${quantity}) is below exchange minimum (${exchangeConstraints.minQty})`,
          );
        }

        // Round quantity to stepSize if available
        if (exchangeConstraints.stepSize) {
          const stepSize = parseFloat(exchangeConstraints.stepSize);
          if (stepSize > 0) {
            quantity = Math.floor(quantity / stepSize) * stepSize;
            if (quantity < exchangeConstraints.minQty) {
              const reason = "QUANTITY_ROUNDED_BELOW_MIN";
              logger.error(
                {
                  uid,
                  symbol: signal.symbol,
                  step: "ORDER_PLACEMENT_BLOCKED",
                  reason,
                  originalQty: quantity,
                  stepSize,
                  roundedQty: quantity,
                  minQty: exchangeConstraints.minQty,
                },
                `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Rounded quantity (${quantity}) < minQty (${exchangeConstraints.minQty})`,
              );

              await logAutoTradeSkip(uid, reason, {
                symbol: signal.symbol,
                accuracy: signal.accuracy,
                threshold: accuracyThreshold,
                signal: signal.signal,
                exchangeStatus: "available",
                additionalDetails: {
                  roundedQty: quantity,
                  minQty: exchangeConstraints.minQty,
                  stepSize: exchangeConstraints.stepSize,
                },
              });

              await this.logTradeEvent(uid, "TRADE_SKIPPED", {
                signal,
                reason,
                details: `Quantity rounded below minimum. Rounded: ${quantity}, MinQty: ${exchangeConstraints.minQty}`,
                accuracy: signal.accuracy,
              });

              // Final mandatory log
              const rr =
                signal.takeProfit && signal.stopLoss && signal.entryPrice
                  ? Math.abs(
                      (signal.takeProfit - signal.entryPrice) /
                        Math.abs(signal.entryPrice - signal.stopLoss),
                    )
                  : 0;
              logger.info(
                {
                  uid,
                  symbol: signal.symbol,
                  acc: signal.accuracy.toFixed(1),
                  rr: rr.toFixed(2),
                  qty: quantity.toFixed(6),
                  minNotional: 10,
                  reason,
                },
                `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`,
              );

              throw new Error(
                `${reason}: Quantity rounded to stepSize is below minimum`,
              );
            }
            positionValue = quantity * signal.entryPrice; // Recalculate after rounding
          }
        }

        logger.info(
          {
            uid,
            symbol: signal.symbol,
            quantity,
            entryPrice: signal.entryPrice,
            notional: positionValue,
            side: signal.signal,
            requestId,
            exchangeConstraints,
          },
          "Placing live order",
        );

        // 🔍 [DEBUG] Final order payload before placement
        logger.info(
          {
            uid,
            symbol: signal.symbol,
            step: "ORDER_PLACEMENT_START",
            orderPayload: {
              symbol: signal.symbol,
              side: signal.signal,
              type: "MARKET",
              quantity,
            },
            leverage: modelLeverage,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            exchangeConstraints,
          },
          "🔍 [DEBUG_TRACE] Final order payload - placing order now",
        );

        // Place order
        const orderResult = await engine.adapter!.placeOrder({
          symbol: signal.symbol,
          side: signal.signal,
          type: "MARKET",
          quantity: quantity,
        });

        // 🔍 [DEBUG] Order placed successfully
        logger.info(
          {
            uid,
            symbol: signal.symbol,
            step: "ORDER_PLACED_SUCCESS",
            orderId: orderResult.exchangeOrderId || orderResult.id,
            fillPrice: orderResult.avgPrice || orderResult.price,
            quantity: orderResult.quantity || quantity,
          },
          "🔍 [DEBUG_TRACE] Order placed successfully - proceeding to TP/SL",
        );

        trade.status = "FILLED";
        trade.orderId = orderResult.exchangeOrderId || orderResult.id;
        trade.fillPrice = parseFloat(
          orderResult.avgPrice?.toString() ||
            orderResult.price?.toString() ||
            signal.entryPrice.toString(),
        );

        // Extract base and quote currencies from symbol (e.g., BTCUSDT -> BTC, USDT)
        const baseCurrency = signal.symbol
          .replace("USDT", "")
          .replace("USD", "");
        const quoteCurrency = signal.symbol.includes("USDT") ? "USDT" : "USD";
        const executedPrice = trade.fillPrice!;
        const executedQuantity = orderResult.quantity || quantity;

        // Place TP/SL orders - SCALPING: Multiple TP levels with partial closes
        let tpOrderId: string | undefined;
        let slOrderId: string | undefined;
        let tp1OrderId: string | undefined;
        let tp2OrderId: string | undefined;
        let tp3OrderId: string | undefined;

        try {
          // SCALPING MODE: Place multiple TP orders with partial quantities
          if (isScalping && signal.takeProfit1 && signal.takeProfit2) {
            const originalQty = executedQuantity;

            // TP1: Close 50% of position
            const tp1Quantity = Math.floor(originalQty * 0.5 * 100) / 100; // Round to 2 decimals
            if (tp1Quantity > 0) {
              const tp1Order = await engine.adapter!.placeOrder({
                symbol: `${baseCurrency}${quoteCurrency}`,
                side: signal.signal === "BUY" ? "SELL" : "BUY",
                type: "LIMIT",
                quantity: tp1Quantity,
                price: signal.takeProfit1,
              });
              tp1OrderId = tp1Order.exchangeOrderId || tp1Order.clientOrderId;
              trade.takeProfit1OrderId = tp1OrderId;
              logger.info(
                {
                  uid,
                  symbol: signal.symbol,
                  tp1Price: signal.takeProfit1,
                  tp1Quantity,
                  tp1OrderId,
                },
                "[SCALPING] TP1 order placed - 50% partial close",
              );
            }

            // TP2: Close 20% more (70% total of original)
            const tp2Quantity = Math.floor(originalQty * 0.2 * 100) / 100;
            if (tp2Quantity > 0) {
              const tp2Order = await engine.adapter!.placeOrder({
                symbol: `${baseCurrency}${quoteCurrency}`,
                side: signal.signal === "BUY" ? "SELL" : "BUY",
                type: "LIMIT",
                quantity: tp2Quantity,
                price: signal.takeProfit2,
              });
              tp2OrderId = tp2Order.exchangeOrderId || tp2Order.clientOrderId;
              trade.takeProfit2OrderId = tp2OrderId;
              logger.info(
                {
                  uid,
                  symbol: signal.symbol,
                  tp2Price: signal.takeProfit2,
                  tp2Quantity,
                  tp2OrderId,
                },
                "[SCALPING] TP2 order placed - 20% additional (70% total)",
              );
            }

            // TP3: Close remaining 30% (100% total)
            if (signal.takeProfit3) {
              const tp3Quantity = Math.floor(originalQty * 0.3 * 100) / 100;
              if (tp3Quantity > 0) {
                const tp3Order = await engine.adapter!.placeOrder({
                  symbol: `${baseCurrency}${quoteCurrency}`,
                  side: signal.signal === "BUY" ? "SELL" : "BUY",
                  type: "LIMIT",
                  quantity: tp3Quantity,
                  price: signal.takeProfit3,
                });
                tp3OrderId = tp3Order.exchangeOrderId || tp3Order.clientOrderId;
                trade.takeProfit3OrderId = tp3OrderId;
                logger.info(
                  {
                    uid,
                    symbol: signal.symbol,
                    tp3Price: signal.takeProfit3,
                    tp3Quantity,
                    tp3OrderId,
                  },
                  "[SCALPING] TP3 order placed - 30% final (100% total)",
                );
              }
            } else {
              // No TP3: Close remaining 30% at TP2
              const remainingQty = originalQty - tp1Quantity - tp2Quantity;
              if (remainingQty > 0) {
                // Update TP2 order to include remaining quantity (if exchange supports order modification)
                // For now, we'll handle this in monitoring
                logger.info(
                  {
                    uid,
                    symbol: signal.symbol,
                    remainingQty,
                  },
                  "[SCALPING] No TP3 - remaining 30% will be closed at TP2 or SL",
                );
              }
            }
          } else {
            // NON-SCALPING: Use legacy single TP/SL logic
            if (config.takeProfitPct && config.takeProfitPct > 0) {
              const tpPrice =
                signal.signal === "BUY"
                  ? executedPrice * (1 + config.takeProfitPct / 100)
                  : executedPrice * (1 - config.takeProfitPct / 100);

              const tpOrder = await engine.adapter!.placeOrder({
                symbol: `${baseCurrency}${quoteCurrency}`,
                side: signal.signal === "BUY" ? "SELL" : "BUY",
                type: "LIMIT",
                quantity: executedQuantity,
                price: tpPrice,
              });

              tpOrderId = tpOrder.exchangeOrderId || tpOrder.clientOrderId;
              trade.takeProfitOrderId = tpOrderId;
              trade.takeProfitPct = config.takeProfitPct;

              logger.info(
                {
                  uid,
                  symbol: signal.symbol,
                  tpPrice,
                  tpOrderId,
                },
                "TP order placed (non-scalping)",
              );
            }
          }

          // Stop Loss: Always place for full remaining quantity
          // For scalping, SL will be updated (trailed) as TP levels are hit
          const slPrice = signal.stopLoss;
          const slQuantity = isScalping ? executedQuantity : executedQuantity; // Full quantity for SL

          const slOrder = await engine.adapter!.placeOrder({
            symbol: `${baseCurrency}${quoteCurrency}`,
            side: signal.signal === "BUY" ? "SELL" : "BUY",
            type: "LIMIT",
            quantity: slQuantity,
            price: slPrice,
          });

          slOrderId = slOrder.exchangeOrderId || slOrder.clientOrderId;
          trade.stopLossOrderId = slOrderId;
          trade.trailingStopLoss = slPrice; // Initialize trailing SL

          logger.info(
            {
              uid,
              symbol: signal.symbol,
              slPrice,
              slQuantity,
              slOrderId,
              isScalping,
            },
            isScalping
              ? "[SCALPING] SL order placed (will trail on TP hits)"
              : "SL order placed",
          );
        } catch (tpslError: any) {
          // P0 FIX: Atomic Execution Failure - Emergency Close
          logger.error(
            {
              error: tpslError.message,
              uid,
              symbol: signal.symbol,
              tradeId: trade.tradeId,
            },
            "CRITICAL: TP/SL placement failed. Executing EMERGENCY CLOSE to protect capital.",
          );

          try {
            // Attempt to close the position immediately with a MARKET order
            await engine.adapter!.placeOrder({
              symbol: signal.symbol,
              side: signal.signal === "BUY" ? "SELL" : "BUY", // Inverted side to close
              type: "MARKET",
              quantity: executedQuantity,
            });

            trade.status = "CANCELLED"; // Mark as cancelled/failed
            await this.logTradeEvent(uid, "EMERGENCY_CLOSE", {
              tradeId,
              symbol: signal.symbol,
              reason: "TP/SL placement failed",
              originalError: tpslError.message,
            });

            // Throw to stop further processing
            throw new Error(
              `Trade aborted: TP/SL placement failed. Position emergency closed. Error: ${tpslError.message}`,
            );
          } catch (closeError: any) {
            // Worst case scenario: Position is open and unprotected, and close failed
            logger.error(
              {
                uid,
                symbol: signal.symbol,
                closeError: closeError.message,
                originalError: tpslError.message,
              },
              "FATAL: EMERGENCY CLOSE FAILED. Position is UNPROTECTED.",
            );

            await this.logTradeEvent(uid, "CRITICAL_FAILURE", {
              tradeId,
              symbol: signal.symbol,
              message:
                "Position left OPEN and UNPROTECTED. Emergency close failed.",
              error: closeError.message,
            });

            throw closeError; // Re-throw the close error
          }
        }

        // Save trade to trades collection for performance stats
        const db = getFirebaseAdmin().firestore();
        const exchangeConfigDoc = await db
          .collection("users")
          .doc(uid)
          .collection("exchangeConfig")
          .doc("current")
          .get();
        const exchangeConfig = exchangeConfigDoc.exists
          ? exchangeConfigDoc.data()
          : null;
        const exchangeName = exchangeConfig?.exchange || "unknown";

        const tradeDocId = await firestoreAdapter.saveTrade(uid, {
          symbol: signal.symbol,
          side: signal.signal,
          qty: quantity,
          entryPrice: signal.entryPrice,
          exitPrice: undefined, // Will be set when trade is closed
          pnl: 0, // Will be calculated when trade is closed
          engineType: "AI",
          orderId: trade.orderId,
          exchange: exchangeName,
          signalAccuracy: signal.accuracy,
          status: "open",
          metadata: {
            requestId,
            takeProfitOrderId: tpOrderId,
            stopLossOrderId: slOrderId,
            fillPrice: trade.fillPrice,
            mode: "AUTO",
          },
        });

        trade.tradeDocId = tradeDocId;

        await this.logTradeEvent(uid, "TRADE_EXECUTED", {
          trade,
          signal,
          equity,
          quantity,
          orderResult,
          requestId,
          exchangeResponse: orderResult,
          config: {
            mode: config.mode,
            perTradeRiskPct: config.perTradeRiskPct,
            stopLossPct: config.stopLossPct,
            takeProfitPct: config.takeProfitPct,
          },
          takeProfitOrderId: tpOrderId,
          stopLossOrderId: slOrderId,
        });

        logger.info(
          {
            uid,
            tradeId,
            symbol: signal.symbol,
            orderId: trade.orderId,
            fillPrice: trade.fillPrice,
            takeProfitOrderId: tpOrderId,
            stopLossOrderId: slOrderId,
            requestId,
            mode: "AUTO",
          },
          "Trade executed (LIVE mode)",
        );

        // NOTIFICATION: Auto Trade Alert - COMPLETED with all details
        // CRITICAL: Only send if Auto Trade is enabled AND autoTradeAlerts is enabled
        try {
          const userSettings = await firestoreAdapter.getSettings(uid);
          const config = await this.loadConfig(uid);

          // Check both: Auto Trade must be ON and alerts must be enabled
          if (
            config.autoTradeEnabled &&
            userSettings?.notifications?.autoTradeAlerts
          ) {
            userNotificationService.sendAutoTradeAlert(
              uid,
              signal.symbol,
              signal.signal.toLowerCase() as "buy" | "sell",
              trade.fillPrice || trade.entryPrice,
              trade.stopLoss,
              trade.takeProfit,
              signal.accuracy,
            );
            logger.info(
              { uid, symbol: signal.symbol },
              "Auto-trade alert sent (trade executed)",
            );

            // NOTIFICATION: Consolidated Telegram Execution Alert
            await sendConsolidatedTelegramAlert(uid, "execution", {
              symbol: signal.symbol,
              signal: signal.signal,
              entryPrice: trade.fillPrice || trade.entryPrice,
              stopLoss: trade.stopLoss,
              takeProfit: trade.takeProfit,
              accuracy: signal.accuracy,
              requestId,
            });
          } else {
            logger.debug(
              {
                uid,
                autoTradeEnabled: config.autoTradeEnabled,
                autoTradeAlerts: userSettings?.notifications?.autoTradeAlerts,
              },
              "Auto-trade alert skipped (disabled or auto-trade off)",
            );
          }
        } catch (notifError: any) {
          logger.warn(
            { uid, error: notifError.message },
            "Failed to send auto-trade notification",
          );
        }
      } catch (error: any) {
        trade.status = "REJECTED";
        await this.logTradeEvent(uid, "TRADE_FAILED", {
          trade,
          signal,
          error: error.message,
          requestId,
          exchangeError: error.response?.data || error.message,
        });
        logger.error(
          {
            uid,
            tradeId,
            symbol: signal.symbol,
            error: error.message,
            requestId,
          },
          "Trade execution failed",
        );
        throw error;
      }
    } else {
      // Consolidated mode validation
      const modeCheck = validateTradingMode(config, "executeTrade");
      const reason = modeCheck.reason || "MODE_VALIDATION_FAILED";

      trade.status = "CANCELLED";
      await this.logTradeEvent(uid, "TRADE_CANCELLED", {
        trade,
        signal,
        reason,
        requestId,
      });
      logger.warn(
        { uid, symbol: signal.symbol, requestId, reason },
        "Trade cancelled due to mode validation",
      );
      throw new Error(`Trading mode validation failed: ${reason}`);
    }

    // Store active trade
    engine.activeTrades.set(tradeId, trade);

    // Set per-symbol cooldown (reduced duration for 2-5 trades/day)
    const cooldownSeconds = config.cooldownSeconds || 15;
    const symbolCooldowns = config.symbolCooldowns || {};
    const symbolCooldownEnd = new Date(Date.now() + cooldownSeconds * 1000);
    symbolCooldowns[signal.symbol] = symbolCooldownEnd.toISOString();

    // Update config with per-symbol cooldown
    await this.saveConfig(uid, {
      symbolCooldowns: symbolCooldowns,
    });

    logger.info(
      {
        uid,
        symbol: signal.symbol,
        cooldownSeconds,
        cooldownUntil: symbolCooldownEnd.toISOString(),
      },
      "✅ [PER_SYMBOL_COOLDOWN] Per-symbol cooldown set (other symbols can still trade)",
    );

    // Update stats
    await this.updateStats(uid, trade);

    return trade;
  }

  /**
   * Get trading settings for a user with caching
   * This is the main function the auto-trade engine calls to get current settings
   */
  static async getTradingSettings(uid: string): Promise<TradingSettings> {
    try {
      const settings = await firestoreAdapter.getTradingSettings(uid);

      if (!settings) {
        // Return default settings
        return {
          coinSelectionMode: "manual",
          selectedCoins: ["BTCUSDT", "ETHUSDT"],
          maxPositionPct: 10,
          accuracyTrigger: { min: 75, max: 100 },
          maxDailyLossPct: 5,
          maxTradesPerDay: 5, // Default safe limit
          autoTradeIntervalMinutes: 5,
          tradeConfirmationRequired: false,
          tradeType: "Scalping",
          positionSizingMap: {
            "0-84": 0,
            "85-89": 3,
            "90-94": 6,
            "95-99": 8.5,
            "100": 10,
          },
          accuracyRiskConfig: getDefaultAccuracyRiskConfig(),
        };
      }

      // Also check main settings for tradeConfirmationRequired
      const userSettings = await firestoreAdapter.getSettings(uid);

      // Enforce maxTradesPerDay limits (1-30)
      // Default to 30 (effectively unlimited) if undefined
      let maxTrades = settings.maxTradesPerDay || 30;
      if (maxTrades < 1) maxTrades = 30;
      if (maxTrades > 30) maxTrades = 30;

      // Map old structure to new structure if needed
      const backgroundResearchSettings =
        await firestoreAdapter.getBackgroundResearchSettings(uid);

      // Rule: If Telegram disabled, default Auto Trade interval to 5 minutes.
      let unifiedFrequency =
        backgroundResearchSettings?.researchFrequencyMinutes ||
        settings.autoTradeIntervalMinutes ||
        5;
      unifiedFrequency = await adjustAutoTradeFrequencyForTelegram(
        uid,
        unifiedFrequency,
      );

      return {
        coinSelectionMode:
          settings.coinSelectionMode ||
          (settings.mode === "MANUAL"
            ? "manual"
            : settings.mode === "TOP_100"
              ? "top100"
              : "top10"),
        selectedCoins: settings.selectedCoins ||
          settings.manualCoins || ["BTCUSDT", "ETHUSDT"],
        maxPositionPct:
          settings.maxPositionPct || settings.maxPositionPerTrade || 10,
        accuracyTrigger:
          typeof settings.accuracyTrigger === "object"
            ? settings.accuracyTrigger
            : { min: settings.accuracyTrigger || 75, max: 100 },
        maxDailyLossPct: settings.maxDailyLossPct || settings.maxDailyLoss || 7,
        maxTradesPerDay: maxTrades,
        autoTradeIntervalMinutes: unifiedFrequency,
        tradeConfirmationRequired:
          userSettings?.notifications?.tradeConfirmationRequired ?? false,
        tradeType: settings.tradeType || "Scalping",
        positionSizingMap: settings.positionSizingMap || {
          "0-84": 0,
          "85-89": 3,
          "90-94": 6,
          "95-99": 8.5,
          "100": 10,
        },
        accuracyRiskConfig:
          settings.accuracyRiskConfig &&
          Array.isArray(settings.accuracyRiskConfig) &&
          settings.accuracyRiskConfig.length > 0
            ? settings.accuracyRiskConfig
            : getDefaultAccuracyRiskConfig(),
      };
    } catch (error: any) {
      logger.error(
        { error: error.message, uid },
        "Error getting trading settings, using defaults",
      );
      // Return defaults on error
      // Use centralized default config method

      return {
        coinSelectionMode: "manual" as const,
        selectedCoins: ["BTCUSDT"],
        maxPositionPct: 10,
        tradeConfirmationRequired: false,
        accuracyTrigger: { min: 75, max: 100 },
        maxDailyLossPct: 7,
        maxTradesPerDay: 30, // Default to 30 (limitless feeling)
        autoTradeIntervalMinutes: 5,
        tradeType: "Scalping",
        positionSizingMap: {
          "0-84": 0,
          "85-89": 3,
          "90-94": 6,
          "95-99": 8.5,
          "100": 10,
        },
        accuracyRiskConfig: getDefaultAccuracyRiskConfig(),
      };
    }
  }

  /**
   * Update trade statistics
   */
  async updateStats(uid: string, trade: TradeExecution): Promise<void> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;
    const stats = config.stats || DEFAULT_CONFIG.stats!;

    // Reset daily stats if new day
    const now = new Date();
    const lastRun = config.lastRun || new Date(0);
    if (now.toDateString() !== lastRun.toDateString()) {
      stats.dailyPnL = 0;
      stats.dailyTrades = 0;
      engine.circuitBreaker = false; // Reset circuit breaker for new day
      // P3-A: Reset loss streak on new day
      engine.config.consecutiveLosses = 0;
    }

    stats.totalTrades += 1;
    stats.dailyTrades += 1;

    // Calculate PnL when trade is closed (simplified for now)
    if (trade.pnl !== undefined) {
      stats.totalPnL += trade.pnl;
      stats.dailyPnL += trade.pnl;

      if (trade.pnl > 0) {
        stats.winningTrades += 1;
      } else {
        stats.losingTrades += 1;
      }
    }

    await this.saveConfig(uid, { stats, lastRun: now });
  }

  /**
   * Log trade event to Firestore
   */
  async logTradeEvent(
    uid: string,
    eventType: string,
    data: any,
  ): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection("users").doc(uid).collection("autoTradeLogs").add({
        eventType,
        data,
        timestamp: admin.firestore.Timestamp.now(),
        userId: uid,
      });
    } catch (error: any) {
      logger.error(
        { error: error.message, uid, eventType },
        "Error logging trade event",
      );
    }
  }

  /**
   * Log auto-trade skip reason with full context for audit
   * This method ensures ALL skip reasons are logged with:
   * - accuracy value
   * - required threshold
   * - exchange status
   * - signal availability
   */

  /**
   * Get engine status
   */
  async getStatus(uid: string): Promise<{
    enabled: boolean;
    mode: string;
    activeTrades: number;
    dailyPnL: number;
    dailyTrades: number;
    circuitBreaker: boolean;
    manualOverride: boolean;
    equity: number;
    exchangeConnected: boolean;
  }> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;

    // Try to get current equity from exchange if adapter is available
    let equity = config.equitySnapshot || 0;
    if (engine.adapter && typeof engine.adapter.getAccount === "function") {
      try {
        const accountInfo = await engine.adapter.getAccount();

        // Handle different exchange response formats
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          const usdtBalance = accountInfo.balances.find(
            (b: any) => b.asset === "USDT",
          );
          if (usdtBalance) {
            const free = parseFloat(
              usdtBalance.free || usdtBalance.available || "0",
            );
            const locked = parseFloat(
              usdtBalance.locked || usdtBalance.frozen || "0",
            );
            equity = free + locked;
          }
        } else if (accountInfo.totalEquity) {
          equity = parseFloat(accountInfo.totalEquity.toString());
        } else if (accountInfo.equity) {
          equity = parseFloat(accountInfo.equity.toString());
        }

        if (equity > 0 && !isNaN(equity)) {
          await this.saveConfig(uid, { equitySnapshot: equity });
        }
      } catch (error: any) {
        logger.warn(
          { error: error.message, uid },
          "Could not fetch equity for status",
        );
      }
    }

    return {
      enabled: config.autoTradeEnabled,
      mode: config.mode,
      activeTrades: engine.activeTrades.size,
      dailyPnL: config.stats?.dailyPnL || 0,
      dailyTrades: config.stats?.dailyTrades || 0,
      circuitBreaker: engine.circuitBreaker,
      manualOverride: config.manualOverride,
      equity,
      exchangeConnected: !!engine.adapter,
    };
  }

  /**
   * Reset circuit breaker (admin only)
   */
  async resetCircuitBreaker(uid: string): Promise<void> {
    const engine = await this.getUserEngine(uid);
    engine.circuitBreaker = false;
    await this.logTradeEvent(uid, "CIRCUIT_BREAKER_RESET", {});
  }

  /**
   * P3-B: Execute Panic Stop
   * Closes all open positions immediately and sets cooldown
   */
  async executePanicStop(uid: string): Promise<void> {
    logger.warn(
      { uid },
      "🚨 PANIC STOP ACTIVATED: Initiating forced exit of all trades",
    );

    // We need fresh engine state
    const engine = await this.getUserEngine(uid);

    // Initialize adapter if needed
    if (!engine.adapter && engine.activeTrades.size > 0) {
      await this.initializeAdapter(uid);
    }

    // 1. Set Cooldown immediately
    const cooldownDurationMs = 24 * 60 * 60 * 1000; // 24 hours
    const cooldownUntil = new Date(Date.now() + cooldownDurationMs);

    // Update config to reflect cooldown and disable panic switch to prevent re-trigger
    await this.saveConfig(uid, {
      cooldownUntil,
      panicStopEnabled: false, // Reset switch so it doesn't stay stuck ON
    });

    await this.logTradeEvent(uid, "PANIC_STOP_TRIGGERED", {
      reason: "User panic stop enabled",
      cooldownUntil: cooldownUntil.toISOString(),
      activeTrades: engine.activeTrades.size,
    });

    if (!engine.adapter && engine.activeTrades.size > 0) {
      logger.error(
        { uid },
        "Panic stop failed to close trades: No adapter available",
      );
      // We still set cooldown, but couldn't close trades.
      // We should probably try to log failed closes.
      for (const tradeId of engine.activeTrades.keys()) {
        await this.logTradeEvent(uid, "PANIC_CLOSE_FAILED", {
          tradeId,
          error: "No adapter",
        });
      }
      return;
    }

    if (engine.activeTrades.size === 0) {
      return;
    }

    // 2. Iterate and Close Trades
    const tradesToClose = Array.from(engine.activeTrades.values());

    for (const trade of tradesToClose) {
      if (trade.status !== "FILLED") continue;

      try {
        logger.info(
          { uid, tradeId: trade.tradeId, symbol: trade.symbol },
          "Panic closing trade",
        );

        // A. Cancel Open Orders
        if (trade.takeProfitOrderId) {
          try {
            await engine.adapter!.cancelOrder(
              trade.symbol,
              trade.takeProfitOrderId,
            );
          } catch (e: any) {
            logger.warn(
              { uid, symbol: trade.symbol, error: e.message },
              "Failed to cancel TP order",
            );
          }
        }
        if (trade.stopLossOrderId) {
          try {
            await engine.adapter!.cancelOrder(
              trade.symbol,
              trade.stopLossOrderId,
            );
          } catch (e: any) {
            logger.warn(
              { uid, symbol: trade.symbol, error: e.message },
              "Failed to cancel SL order",
            );
          }
        }

        // B. Place Market Close Order
        const closeSide = trade.side === "BUY" ? "SELL" : "BUY";

        // Execute Market Close
        const order = await engine.adapter!.placeOrder({
          symbol: trade.symbol,
          side: closeSide,
          type: "MARKET",
          quantity: trade.quantity,
        });

        // C. Update internal state
        trade.status = "PANIC_CLOSED";
        engine.activeTrades.delete(trade.tradeId);

        // D. Log success
        await this.logTradeEvent(uid, "PANIC_CLOSED", {
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          exitPrice: order.avgPrice || order.price,
          reason: "Panic Stop",
          timestamp: new Date(),
        });
      } catch (error: any) {
        logger.error(
          { uid, tradeId: trade.tradeId, error: error.message },
          "Failed to panic close trade",
        );
        await this.logTradeEvent(uid, "PANIC_CLOSE_FAILED", {
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          error: error.message,
        });
      }
    }
  }

  /**
   * P1: Monitor active trades and manage state
   * Tracks open orders, updates status, and detects orphans
   */
  async monitorActiveTrades(uid: string): Promise<void> {
    try {
      const engine = await this.getUserEngine(uid);

      // SINGLE-WATCHER GUARANTEE (per user): prevent concurrent monitor loops
      if ((engine as any).__dlxTradeMonitorInProgress === true) {
        return;
      }
      (engine as any).__dlxTradeMonitorInProgress = true;

      // We need an adapter to check status
      if (!engine.adapter && engine.activeTrades.size > 0) {
        await this.initializeAdapter(uid);
      }

      if (!engine.adapter || engine.activeTrades.size === 0) return;

      logger.info(
        { uid, activeTradeCount: engine.activeTrades.size },
        "Monitoring active trades",
      );

      const tradesToRemove: string[] = [];

      // POLLING SAFETY: hard minimum interval between polls per trade
      const MIN_TRADE_POLL_INTERVAL_MS = 30_000;

      for (const [tradeId, trade] of engine.activeTrades.entries()) {
        // Only monitor filled trades that are currently considered OPEN in our system
        if (trade.status !== "FILLED") continue;

        // POLLING SAFETY: per-trade cooldown/backoff
        const nowMs = Date.now();
        const cooldownUntilMs = trade.monitorCooldownUntil || 0;
        const lastMonitorAtMs = trade.lastMonitorAt || 0;

        if (nowMs < cooldownUntilMs) {
          continue;
        }
        if (nowMs - lastMonitorAtMs < MIN_TRADE_POLL_INTERVAL_MS) {
          continue;
        }

        trade.lastMonitorAt = nowMs;
        console.log(
          "🔥 [HARD_LOG] [TRADE_MONITOR_POLL_START]",
          JSON.stringify({ uid, tradeId, symbol: trade.symbol, orderId: trade.orderId }),
        );

        try {
          // Check TP/SL status
          let isClosed = false;
          let closeReason = "";

          let tpStatus = "UNKNOWN";
          let slStatus = "UNKNOWN";

          // SCALPING: Check multiple TP orders for partial closes
          if (trade.isScalping) {
            // Check TP1
            if (trade.takeProfit1OrderId && !trade.tp1Hit) {
              try {
                const tp1Order = await engine.adapter.getOrderStatus(
                  trade.symbol,
                  trade.takeProfit1OrderId,
                );
                if (tp1Order.status === "FILLED") {
                  trade.tp1Hit = true;
                  const closedQty = trade.originalQuantity! * 0.5;
                  trade.remainingQuantity =
                    (trade.remainingQuantity || trade.originalQuantity!) -
                    closedQty;

                  // TRAILING SL: Move SL to entry price (break-even)
                  // CRITICAL: SL must NEVER move backward
                  const newSL = trade.entryPrice;
                  const currentSL = trade.trailingStopLoss || trade.stopLoss;

                  // Ensure SL never moves backward (for BUY: newSL >= currentSL, for SELL: newSL <= currentSL)
                  const slMovedBackward =
                    trade.side === "BUY"
                      ? newSL < currentSL
                      : newSL > currentSL;

                  if (slMovedBackward) {
                    logger.warn(
                      {
                        uid,
                        tradeId,
                        currentSL,
                        attemptedNewSL: newSL,
                        side: trade.side,
                      },
                      "[SCALPING] Trailing SL to entry would move backward - keeping current SL",
                    );
                    continue; // Skip SL update
                  }

                  if (trade.trailingStopLoss !== newSL) {
                    // Cancel old SL order
                    if (trade.stopLossOrderId) {
                      try {
                        await engine.adapter.cancelOrder(
                          trade.symbol,
                          trade.stopLossOrderId,
                        );
                      } catch (cancelErr) {
                        logger.warn(
                          { uid, tradeId, error: cancelErr },
                          "Failed to cancel old SL for trailing",
                        );
                      }
                    }

                    // Place new SL at entry
                    const newSLOrder = await engine.adapter.placeOrder({
                      symbol: trade.symbol,
                      side: trade.side === "BUY" ? "SELL" : "BUY",
                      type: "LIMIT",
                      quantity: trade.remainingQuantity!,
                      price: newSL,
                    });

                    trade.stopLossOrderId =
                      newSLOrder.exchangeOrderId || newSLOrder.clientOrderId;
                    trade.trailingStopLoss = newSL;

                    logger.info(
                      {
                        uid,
                        tradeId,
                        symbol: trade.symbol,
                        tp1Price: trade.takeProfit1,
                        closedQty,
                        remainingQty: trade.remainingQuantity,
                        newSL: newSL,
                        slOrderId: trade.stopLossOrderId,
                      },
                      "[SCALPING] TP1 HIT → 50% closed, SL moved to entry (break-even)",
                    );

                    await this.logTradeEvent(uid, "SCALPING_TP1_HIT", {
                      tradeId,
                      symbol: trade.symbol,
                      closedQty,
                      remainingQty: trade.remainingQuantity,
                      slMovedToEntry: true,
                    });
                  }
                }
              } catch (e: any) {
                logger.warn(
                  { uid, tradeId, error: e.message },
                  "Failed to fetch TP1 order status",
                );
              }
            }

            // Check TP2
            if (trade.takeProfit2OrderId && trade.tp1Hit && !trade.tp2Hit) {
              try {
                const tp2Order = await engine.adapter.getOrderStatus(
                  trade.symbol,
                  trade.takeProfit2OrderId,
                );
                if (tp2Order.status === "FILLED") {
                  trade.tp2Hit = true;
                  const closedQty = trade.originalQuantity! * 0.2; // Additional 20%
                  trade.remainingQuantity =
                    (trade.remainingQuantity || trade.originalQuantity!) -
                    closedQty;

                  // TRAILING SL: Move SL to entry + 0.2% (small profit buffer)
                  // CRITICAL: SL must NEVER move backward
                  const profitBuffer = trade.entryPrice * 0.002; // 0.2%
                  const newSL =
                    trade.side === "BUY"
                      ? trade.entryPrice + profitBuffer
                      : trade.entryPrice - profitBuffer;

                  // Ensure SL never moves backward (for BUY: newSL >= currentSL, for SELL: newSL <= currentSL)
                  const currentSL = trade.trailingStopLoss || trade.stopLoss;
                  const slMovedBackward =
                    trade.side === "BUY"
                      ? newSL < currentSL
                      : newSL > currentSL;

                  if (slMovedBackward) {
                    logger.warn(
                      {
                        uid,
                        tradeId,
                        currentSL,
                        attemptedNewSL: newSL,
                        side: trade.side,
                      },
                      "[SCALPING] Trailing SL would move backward - keeping current SL",
                    );
                    continue; // Skip SL update
                  }

                  if (trade.trailingStopLoss !== newSL) {
                    // Cancel old SL order
                    if (trade.stopLossOrderId) {
                      try {
                        await engine.adapter.cancelOrder(
                          trade.symbol,
                          trade.stopLossOrderId,
                        );
                      } catch (cancelErr) {
                        logger.warn(
                          { uid, tradeId, error: cancelErr },
                          "Failed to cancel old SL for trailing",
                        );
                      }
                    }

                    // Place new trailing SL
                    const newSLOrder = await engine.adapter.placeOrder({
                      symbol: trade.symbol,
                      side: trade.side === "BUY" ? "SELL" : "BUY",
                      type: "LIMIT",
                      quantity: trade.remainingQuantity!,
                      price: newSL,
                    });

                    trade.stopLossOrderId =
                      newSLOrder.exchangeOrderId || newSLOrder.clientOrderId;
                    trade.trailingStopLoss = newSL;

                    logger.info(
                      {
                        uid,
                        tradeId,
                        symbol: trade.symbol,
                        tp2Price: trade.takeProfit2,
                        closedQty,
                        remainingQty: trade.remainingQuantity,
                        newSL: newSL,
                        slOrderId: trade.stopLossOrderId,
                      },
                      "[SCALPING] TP2 HIT → 70% total closed, SL trailed to entry +0.2%",
                    );

                    await this.logTradeEvent(uid, "SCALPING_TP2_HIT", {
                      tradeId,
                      symbol: trade.symbol,
                      closedQty,
                      remainingQty: trade.remainingQuantity,
                      slTrailed: true,
                      slPrice: newSL,
                    });
                  }
                }
              } catch (e: any) {
                logger.warn(
                  { uid, tradeId, error: e.message },
                  "Failed to fetch TP2 order status",
                );
              }
            }

            // Check TP3 (full exit)
            if (trade.takeProfit3OrderId && trade.tp2Hit && !trade.tp3Hit) {
              try {
                const tp3Order = await engine.adapter.getOrderStatus(
                  trade.symbol,
                  trade.takeProfit3OrderId,
                );
                if (tp3Order.status === "FILLED") {
                  trade.tp3Hit = true;
                  isClosed = true;
                  closeReason = "TAKE_PROFIT3_FILLED";

                  logger.info(
                    {
                      uid,
                      tradeId,
                      symbol: trade.symbol,
                      tp3Price: trade.takeProfit3,
                      totalClosed: trade.originalQuantity,
                    },
                    "[SCALPING] TP3 HIT → 100% closed, full exit",
                  );

                  await this.logTradeEvent(uid, "SCALPING_TP3_HIT", {
                    tradeId,
                    symbol: trade.symbol,
                    fullExit: true,
                  });
                }
              } catch (e: any) {
                logger.warn(
                  { uid, tradeId, error: e.message },
                  "Failed to fetch TP3 order status",
                );
              }
            }
          } else {
            // NON-SCALPING: Legacy single TP check
            if (trade.takeProfitOrderId) {
              try {
                const tpOrder = await engine.adapter.getOrderStatus(
                  trade.symbol,
                  trade.takeProfitOrderId,
                );
                tpStatus = tpOrder.status;
                if (tpStatus === "FILLED") {
                  isClosed = true;
                  closeReason = "TAKE_PROFIT_FILLED";
                }
              } catch (e: any) {
                logger.warn(
                  { uid, tradeId, error: e.message },
                  "Failed to fetch TP order status",
                );
              }
            }
          }

          // Check SL Order (if not already known closed)
          if (!isClosed && trade.stopLossOrderId) {
            try {
              const slOrder = await engine.adapter.getOrderStatus(
                trade.symbol,
                trade.stopLossOrderId,
              );
              slStatus = slOrder.status;
              if (slStatus === "FILLED") {
                isClosed = true;
                closeReason = "STOP_LOSS_FILLED";
              }
            } catch (e: any) {
              logger.warn(
                { uid, tradeId, error: e.message },
                "Failed to fetch SL order status",
              );
            }
          }

          // EDGE CASE: Manual close detection.
          // If both TP and SL are present but both are inactive (canceled/rejected/expired), treat as terminal.
          const inactiveStatuses = [
            "CANCELED",
            "CANCELLED",
            "REJECTED",
            "EXPIRED",
          ];
          const tpInactive =
            trade.takeProfitOrderId && inactiveStatuses.includes(tpStatus);
          const slInactive =
            trade.stopLossOrderId && inactiveStatuses.includes(slStatus);

          if (!isClosed && tpInactive && slInactive) {
            isClosed = true;
            closeReason = "MANUAL_CLOSE_DETECTED";
          }

          // Update trade in memory after partial closes
          engine.activeTrades.set(tradeId, trade);

          if (isClosed) {
            logger.info(
              { uid, tradeId, reason: closeReason },
              "Trade closed by exchange order",
            );
            tradesToRemove.push(tradeId);

            console.log(
              "🔥 [HARD_LOG] [TRADE_MONITOR_POLL_STOP_TERMINAL]",
              JSON.stringify({ uid, tradeId, symbol: trade.symbol, reason: closeReason }),
            );

            // DELTA-ONLY FIRESTORE WRITE: update the trades collection ONLY if state changed
            try {
              if (trade.tradeDocId) {
                let exitPrice: number | undefined = undefined;
                if (closeReason.includes("TAKE_PROFIT")) {
                  exitPrice = trade.takeProfit;
                } else if (closeReason.includes("STOP_LOSS")) {
                  exitPrice = trade.trailingStopLoss || trade.stopLoss;
                }

                const updateRes = await firestoreAdapter.updateTradeDocDelta(
                  trade.tradeDocId,
                  {
                    status: "closed",
                    exitPrice,
                  },
                );

                console.log(
                  "🔥 [HARD_LOG] [TRADE_MONITOR_FIRESTORE_DELTA]",
                  JSON.stringify({ uid, tradeId, tradeDocId: trade.tradeDocId, updateRes }),
                );
              }
            } catch (persistErr: any) {
              logger.warn(
                { uid, tradeId, error: persistErr.message },
                "Failed to persist trade close state to Firestore",
              );
            }

            // P3-A: Loss Streak Tracking
            let consecutiveLosses = engine.config.consecutiveLosses || 0;
            let cooldownUntil = engine.config.cooldownUntil;
            let enteredCooldown = false;

            if (closeReason === "STOP_LOSS_FILLED") {
              consecutiveLosses++;
              // Max consecutive losses = 2 (hardcoded for P3-A as requested)
              if (consecutiveLosses >= 2) {
                // Enter 24h Cooldown
                const cooldownDurationMs = 24 * 60 * 60 * 1000;
                cooldownUntil = new Date(Date.now() + cooldownDurationMs);
                enteredCooldown = true;

                logger.warn(
                  { uid, consecutiveLosses },
                  "🚨 MAX CONSECUTIVE LOSSES REACHED: Entering 24h Cooldown.",
                );
              }
            } else if (closeReason === "TAKE_PROFIT_FILLED") {
              // Reset on win
              consecutiveLosses = 0;
            }

            // Persist state
            await this.saveConfig(uid, {
              consecutiveLosses,
              cooldownUntil,
            });

            if (enteredCooldown) {
              await this.logTradeEvent(uid, "COOLDOWN_ENTERED", {
                reason: "Max consecutive losses reached",
                duration: "24h",
                consecutiveLosses,
              });
            }

            const stats = engine.config.stats || {
              totalTrades: 0,
              winningTrades: 0,
              losingTrades: 0,
              totalPnL: 0,
              dailyPnL: 0,
              dailyTrades: 0,
            };

            // Note: Accurate PnL requires fetch of fill price.
            // For P1/Stabilization, we log the event and remove the trade to allow new trades.
            // Logic to update PnL stats specifically should be added in P2.

            await this.logTradeEvent(uid, "TRADE_CLOSED", {
              tradeId,
              symbol: trade.symbol,
              reason: closeReason,
              timestamp: new Date(),
            });

            // NOTIFICATION: Telegram Closed Alert
            try {
              const bgSettings =
                await firestoreAdapter.getBackgroundResearchSettings(uid);
              if (
                bgSettings?.backgroundResearchEnabled &&
                bgSettings?.telegramBotToken &&
                bgSettings?.telegramChatId
              ) {
                const { telegramService } = await import("./telegramService");

                // Determine reason for Telegram
                let telegramReason: "TP" | "SL" | "MANUAL" | "PANIC" = "TP";
                if (closeReason.includes("STOP_LOSS")) telegramReason = "SL";
                else if (closeReason.includes("PANIC"))
                  telegramReason = "PANIC";
                else if (closeReason.includes("MANUAL"))
                  telegramReason = "MANUAL";

                telegramService.sendTradeClosedAlert(
                  bgSettings.telegramBotToken,
                  bgSettings.telegramChatId,
                  {
                    symbol: trade.symbol,
                    side: trade.side as "BUY" | "SELL",
                    exitPrice: 0, // Placeholder as PnL/Exit price isn't fully tracked here yet in P1
                    pnl: 0, // Placeholder
                    reason: telegramReason,
                  },
                );
              }
            } catch (e) {
              logger.warn({ uid }, "Failed to send Telegram closed alert");
            }

            continue;
          }

          // P1.6 ORPHAN PROTECTION
          // Check if both TP and SL are missing or inactive (CANCELED/REJECTED/EXPIRED/UNKNOWN)
          const isTpActive = ["NEW", "PARTIALLY_FILLED"].includes(tpStatus);
          const isSlActive = ["NEW", "PARTIALLY_FILLED"].includes(slStatus);

          // If we had IDs but neither is active now (and trade is not closed), it's an orphan
          if (
            trade.takeProfitOrderId &&
            trade.stopLossOrderId &&
            !isTpActive &&
            !isSlActive
          ) {
            logger.warn(
              { uid, tradeId, symbol: trade.symbol },
              "🚨 ORPHAN TRADE DETECTED: Position is UNPROTECTED (No active TP/SL)",
            );
            // Log only, do not auto-close in P1 significantly to avoid race conditions with manual user actions
          }
        } catch (error: any) {
          // ERROR BACKOFF: do not allow exchange/API errors to create fast retry loops
          trade.monitorErrorCount = (trade.monitorErrorCount || 0) + 1;
          const backoffMs =
            trade.monitorErrorCount >= 5
              ? 5 * 60 * 1000
              : 60 * 1000;
          trade.monitorCooldownUntil = Date.now() + backoffMs;

          logger.error(
            { uid, tradeId, error: error.message },
            "Error monitoring trade",
          );
        }
      }

      // Cleanup closed trades from memory
      for (const id of tradesToRemove) {
        engine.activeTrades.delete(id);
      }
    } catch (error: any) {
      logger.error(
        { uid, error: error.message },
        "Fatal error in monitorActiveTrades",
      );
    } finally {
      try {
        const engine = await this.getUserEngine(uid);
        (engine as any).__dlxTradeMonitorInProgress = false;
      } catch {
        // ignore
      }
    }
  }

  /**
   * Start auto-trade background research loop for a user
   * Runs deep research every 5 minutes when enabled
   *
   * REFACTORED: Uses safe background runner to prevent event loop blocking
   * - Each iteration has hard timeout (30s max)
   * - Yields control back to event loop
   * - Auto-pauses if event loop lag is detected
   */
  async startAutoTradeLoop(
    uid: string,
    researchFrequencyMinutes?: number,
  ): Promise<void> {
    logger.info(
      { uid, researchFrequencyMinutes },
      "🔄 [AUTOTRADE] Starting auto-trade for user - Persisting state and triggering scheduler",
    );

    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection("users").doc(uid);

      // 1. Get existing background research settings to preserve frequency if not provided
      const existingBgSettings =
        await firestoreAdapter.getBackgroundResearchSettings(uid);
      const finalFrequency =
        researchFrequencyMinutes ||
        existingBgSettings?.researchFrequencyMinutes ||
        5;

      // 2. Update autoTradeConfig - ensure engine knows it should be enabled
      await userRef.collection("autoTradeConfig").doc("current").set(
        {
          autoTradeEnabled: true,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      // 3. CRITICAL: Sync root users/{uid} document with auto-trade state
      // UI reads from root document - must be in sync with autoTradeConfig/current
      // NOTE: Cached flags (apiConnected, apiStatus) removed
      // Use isExchangeUsable() as single source of truth
      await userRef.set(
        {
          autoTradeEnabled: true,
          autoTrade: { enabled: true },
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      console.log("🔥 [HARD_LOG] [AUTO_TRADE_USERS_DOC_SYNCED]", {
        uid,
        autoTradeEnabled: true,
        source: "startAutoTradeLoop",
      });

      // 4. Update backgroundResearchSettings - ensure scheduler knows it should run
      // CRITICAL: Persist research frequency for scheduler
      await userRef.collection("settings").doc("backgroundResearch").set(
        {
          backgroundResearchEnabled: true,
          researchFrequencyMinutes: finalFrequency,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      // 4. Trigger immediate schedule update in BackgroundResearchScheduler
      const { backgroundResearchScheduler } =
        await import("./backgroundResearchScheduler");
      await backgroundResearchScheduler.onUserSettingsChanged(uid);

      logger.info(
        { uid, frequency: finalFrequency },
        "✅ [AUTOTRADE] Auto-trade enabled and scheduled successfully",
      );
    } catch (err: any) {
      logger.error(
        { uid, error: err.message },
        "❌ [AUTOTRADE] Failed to start/persist auto-trade state",
      );
      throw err;
    }
  }

  /**
   * Safe wrapper for runAutoTradeResearchCycle
   * Wraps all external calls with timeouts to prevent blocking
   *
   * AUTO-TRADE LIFECYCLE DOCUMENTATION:
   * - Called by BackgroundResearchScheduler at configured frequency (researchFrequencyMinutes)
   * - Runs server-side independently of frontend
   * - Survives user logout, tab close, or browser shutdown
   * - Does NOT depend on WebSocket connections, frontend polling, or UI presence
   * - Only exchange decryption failure blocks execution (not UI state)
   * - Execution continues when website is closed
   *
   * @param uid User ID
   * @param skipHistoryStorage If true, history storage is skipped (caller will handle it)
   */
  async runAutoTradeResearchCycleSafe(
    uid: string,
    skipHistoryStorage: boolean = false,
    schedulerCycleId: string,
    researchResult: any,
  ): Promise<ResearchDataResult | null> {
    const cycleStartTimestamp: number = Date.now();
    const cycleId = schedulerCycleId || `engine_${cycleStartTimestamp}`;
    console.log(
      "🔥 [HARD_LOG] [AUTO_TRADE_SAFE_START] runAutoTradeResearchCycleSafe() called for user:",
      uid,
      "skipHistoryStorage:",
      skipHistoryStorage,
      "cycleId:",
      cycleId,
    );

    // CRITICAL: Atomic concurrency guard - ensure only ONE auto-trade cycle runs at a time per user
    const userLoopState = this.autoTradeLoops.get(uid);
    if (userLoopState?.researchInProgress) {
      logger.warn(
        { uid, cycleId },
        "⚠️ [AUTO_TRADE_CONCURRENCY] Cycle blocked - another auto-trade cycle already running for user",
      );
      console.log(
        "🔥 [HARD_LOG] [AUTO_TRADE_CONCURRENCY_BLOCK] Cycle blocked for user:",
        uid,
        "cycleId:",
        cycleId,
      );
      return null; // Exit immediately without creating duplicate history
    }

    // Set concurrency guard BEFORE any async operations
    if (!userLoopState) {
      this.autoTradeLoops.set(uid, {
        intervalId: null,
        isRunning: false,
        lastResearchTime: null,
        researchInProgress: true,
      });
    } else {
      userLoopState.researchInProgress = true;
    }

    try {
      // CRITICAL: Verify encryption key consistency for auto-trade engine
      const { verifyEncryptionKeyConsistency } = await import("./keyManager");
      verifyEncryptionKeyConsistency("background_job");

      logger.info({ uid, cycleId }, "🚀 [AUTO_TRADE_CYCLE] Cycle STARTED");

      // Check if we should run
      if (!shouldRunBackgroundTasks()) {
        logger.info(
          { uid, cycleId, reason: "BACKGROUND_TASKS_PAUSED" },
          "⏸️ [AUTO_TRADE_CYCLE] Cycle SKIPPED - background tasks paused",
        );

        // Save SKIPPED history for background tasks paused
        await saveAutoTradeHistorySkipped(
          uid,
          "BACKGROUND_TASKS_PAUSED",
          "Background tasks are currently paused by system administrator",
        );

        // CRITICAL FIX: Also write diagnostic entry for "Recent Cycle Results" UI
        try {
          await firestoreAdapter.saveAgentDiagnostic('AUTO_TRADE_AGENT', {
            agentType: 'TRADING_AGENT',
            tradingPair: 'AUTO_TRADE_CYCLE',
            direction: 'LONG',
            decision: {
              action: 'SKIP',
              reason: 'Background tasks paused by system administrator'
            },
            execution: {
              status: 'SKIPPED',
              success: false,
              exchangeErrorReason: null
            }
          }, uid);
        } catch (diagnosticErr: any) {
          logger.warn({ uid, error: diagnosticErr.message }, 'Failed to save diagnostic for background tasks paused');
        }

        return null; // Cycle completed with SKIPPED history
      }

      // Yield control before heavy operations
      await yieldToEventLoop();

      // 🔥 DEBUG: Log auto-trade research cycle start
      logger.info(
        {
          uid,
          skipHistoryStorage,
          serverSide: true,
          frontendIndependent: true,
          cycleId,
          hasResearchResult: !!researchResult,
        },
        "🔍 [AUTO_TRADE_LIFECYCLE_DEBUG] Starting auto-trade research cycle - server-side only",
      );

      // AUTO_TRADE IS CONSUMER ONLY: Use research result provided by scheduler
      if (!researchResult) {
        logger.info(
          { uid, cycleId },
          "🚫 [AUTO_TRADE_CONSUMER] No research result provided by scheduler - exiting silently (scheduler should never call with null research)",
        );
        return null; // Exit silently - no SKIPPED history for AUTO_TRADE mode
      }

      // Run trade execution with provided research result
      return await this.runAutoTradeExecutionCycle(
        uid,
        skipHistoryStorage,
        cycleId,
        researchResult,
      );
    } finally {
      // CRITICAL: Always clear concurrency guard when function exits
      const userLoopState = this.autoTradeLoops.get(uid);
      if (userLoopState) {
        userLoopState.researchInProgress = false;
        console.log(
          "🔥 [HARD_LOG] [AUTO_TRADE_CONCURRENCY_CLEAR] Concurrency guard cleared for user:",
          uid,
          "cycleId:",
          cycleId,
        );
      }
    }
  }

  /**
   * Run auto-trade execution cycle with provided research result
   * CRITICAL: AUTO_TRADE IS CONSUMER ONLY - this function NEVER generates research
   * It only executes trades based on research result provided by scheduler
   */
  private async runAutoTradeExecutionCycle(
    uid: string,
    skipHistoryStorage: boolean,
    cycleId: string,
    researchResult: any,
  ): Promise<ResearchDataResult | null> {
    // CRITICAL: Load config and settings ONCE at cycle start
    let userConfig: AutoTradeConfig;
    let userSettings: any;
    let tradingSettings: any;

    try {
      userConfig = await this.loadConfig(uid);
      userSettings = await firestoreAdapter.getSettings(uid);
      tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
    } catch (configError: any) {
      logger.error(
        { uid, error: configError.message },
        "❌ [CONFIG_LOAD] Failed to load user config/settings at cycle start",
      );
      if (!skipHistoryStorage) {
        await saveAutoTradeHistorySkipped(
          uid,
          "SYSTEM_ERROR",
          `CONFIG_LOAD_FAILED: ${configError.message}`,
          cycleId,
        );
      }
      return null;
    }

    // CRITICAL: Check exchange usability once at cycle start and reuse result
    // Use user_request context for actual trading operations that need credential validation
    const exchangeUsability = await isExchangeUsable(uid, "user_request");

    // PRIORITY ORDER: isExchangeUsable().usable result > disconnected flags > historical state
    // If isExchangeUsable() returns usable=true, ALWAYS proceed regardless of reason
    if (exchangeUsability.usable) {
      // Exchange is usable - log success and proceed
      // CRITICAL FIX: When usable=true, NEVER block regardless of disconnected flags
      logger.info(
        {
          uid,
          exchange: exchangeUsability.exchange,
          reason: exchangeUsability.reason,
          usable: exchangeUsability.usable,
        },
        `[AUTO_TRADE_PROCEED] Exchange is usable - proceeding with auto-trade cycle`,
      );
      // CRITICAL: Clear any disconnected flags when exchange is usable
      // This ensures disconnected state doesn't persist when decryption succeeds
      
      // SKIP the entire exchange blocking logic when usable=true
      // Continue to the rest of the auto-trade cycle
    } else {
      const normalizedExchangeReason =
        exchangeUsability.reason === "connected"
          ? "connected"
          : exchangeUsability.reason === "disconnected"
            ? "disconnected"
            : "not_connected";

      // MANDATORY INVARIANT: Same as scheduler
      // 1. not_connected → SOFT SKIP ONLY
      if (normalizedExchangeReason === "not_connected") {
        // SOFT SKIP: Exchange not usable - skip this cycle
        logger.warn(
          {
            uid,
            exchange: exchangeUsability.exchange,
            reason: normalizedExchangeReason,
            usable: exchangeUsability.usable,
            softSkipOnly: true,
          },
          `[AUTO_TRADE_SOFT_SKIP] Exchange not usable (not_connected) - skipping cycle without stopping`,
        );

        // Save SKIPPED history for not_connected
        if (!skipHistoryStorage) {
          await saveAutoTradeHistorySkipped(
            uid,
            "EXCHANGE_NOT_CONNECTED",
            "Exchange not connected - soft skip only",
            cycleId,
          );
        }

        // CRITICAL FIX: Also write diagnostic entry for "Recent Cycle Results" UI
        try {
          await firestoreAdapter.saveAgentDiagnostic('AUTO_TRADE_AGENT', {
            agentType: 'TRADING_AGENT',
            tradingPair: 'AUTO_TRADE_CYCLE',
            direction: 'LONG',
            decision: {
              action: 'SKIP',
              reason: 'Exchange not connected'
            },
            execution: {
              status: 'SKIPPED',
              success: false,
              exchangeErrorReason: 'Exchange not connected'
            }
          }, uid);
        } catch (diagnosticErr: any) {
          logger.warn({ uid, error: diagnosticErr.message }, 'Failed to save diagnostic for exchange not connected');
        }

        return null; // Cycle completed with SKIPPED history (SOFT SKIP)
      } else if (normalizedExchangeReason === "disconnected") {
        // HARD STOP: Exchange disconnected by user
        logger.warn(
          {
            uid,
            exchange: exchangeUsability.exchange,
            reason: normalizedExchangeReason,
            usable: exchangeUsability.usable,
            hardStop: true,
          },
          `AUTO_TRADE_BLOCKED: EXCHANGE_${normalizedExchangeReason.toUpperCase()} - hard stop required`,
        );

        // Save SKIPPED history for disconnected
        if (!skipHistoryStorage) {
          await saveAutoTradeHistorySkipped(
            uid,
            "EXCHANGE_NOT_USABLE",
            normalizedExchangeReason,
            cycleId,
          );
        }

        return null; // Cycle completed with SKIPPED history (HARD STOP)
      }
    }

    // CRITICAL: Validate provided research result
    if (!researchResult || !researchResult.symbol || !researchResult.signal) {
      logger.error(
        { uid, cycleId, researchResult },
        "❌ [AUTO_TRADE_CONSUMER] Invalid research result provided by scheduler",
      );
      if (!skipHistoryStorage) {
        await saveAutoTradeHistorySkipped(
          uid,
          "INVALID_RESEARCH_RESULT",
          "Scheduler provided invalid research result for auto-trade execution",
          cycleId,
        );
      }
      return null;
    }

    // Check if research meets trade criteria
    const hasValidSignal =
      researchResult.signal === "BUY" || researchResult.signal === "SELL";
    const hasValidAccuracy = researchResult.accuracy >= 0.7;
    const hasTradePlan = !!researchResult.tradePlan;

    // CRITICAL FIX: Handle deep research failure case
    // If deep research failed but accuracy scan succeeded, use specific skip reason
    const deepResearchFailed = (researchResult as any).deepResearchFailed === true;
    const deepResearchError = (researchResult as any).deepResearchError;

    if (!hasValidSignal || !hasValidAccuracy || !hasTradePlan || deepResearchFailed) {
      logger.info(
        {
          uid,
          cycleId,
          symbol: researchResult.symbol,
          signal: researchResult.signal,
          accuracy: researchResult.accuracy,
          hasTradePlan,
          deepResearchFailed,
          deepResearchError,
        },
        "🚫 [AUTO_TRADE_CONSUMER] Research result does not meet trade criteria - skipping",
      );

      // CRITICAL FIX: Save actual symbol and accuracy when criteria not met
      // Instead of generic 'AUTO_TRADE_CYCLE' and 0, save the real research data
      let skipReason = "";
      if (deepResearchFailed) {
        skipReason = deepResearchError || "Deep research failed"; // Use specific error reason
      } else if (!hasValidSignal) {
        skipReason = "Invalid signal";
      } else if (!hasValidAccuracy) {
        skipReason = "Below accuracy threshold";
      } else if (!hasTradePlan) {
        skipReason = "Missing trade plan";
      }

      const researchData = {
        results: [researchResult],
        coinsAnalyzed: [researchResult.symbol],
      };
      const researchSymbol = researchResult.symbol;
      const finalResult = researchResult.result || researchResult;
      const finalTradePlan = researchResult.tradePlan;

      await saveAutoTradeHistoryWithExecutionStatus(
        uid,
        researchResult,
        researchData,
        researchSymbol,
        finalResult,
        finalTradePlan,
        researchResult.accuracy || 0,
        researchResult.signal || "HOLD",
        researchResult.price || 0,
        "SKIPPED",
        null,
        null,
      );

      return null;
    }

    // Research meets criteria - proceed with trade execution
    logger.info(
      {
        uid,
        cycleId,
        symbol: researchResult.symbol,
        signal: researchResult.signal,
        accuracy: researchResult.accuracy,
      },
      "✅ [AUTO_TRADE_CONSUMER] Research meets criteria - proceeding with trade execution",
    );

    // Execute the trade using the existing trade execution logic
    return await this.executeTradeWithResearchResult(
      uid,
      userConfig,
      tradingSettings,
      researchResult,
      cycleId,
      skipHistoryStorage,
    );
  }

  /**
   * Execute trade with provided research result
   * This is the core trade execution logic extracted from runAutoTradeResearchCycle
   */
  private async executeTradeWithResearchResult(
    uid: string,
    userConfig: AutoTradeConfig,
    tradingSettings: any,
    researchResult: any,
    cycleId: string,
    skipHistoryStorage: boolean,
  ): Promise<ResearchDataResult | null> {
    // Convert research result to ResearchDataResult format for execution pipeline
    const researchDataResult: ResearchDataResult = {
      symbol: researchResult.symbol,
      signal: researchResult.signal,
      accuracy: researchResult.accuracy,
      result: {
        signal: researchResult.signal,
        accuracy: researchResult.accuracy,
        tradePlan: researchResult.tradePlan,
        price: researchResult.price || 0,
        snapshotAccuracy: researchResult.accuracy,
        accuracyBreakdown: researchResult.accuracyBreakdown || {
          indicatorScore: 0,
          marketStructureScore: 0,
          momentumScore: 0,
          volumeScore: 0,
          newsScore: 0,
          riskPenalty: 0,
        },
        accuracyWeightsUsed: researchResult.accuracyWeightsUsed || {},
        indicators: researchResult.indicators || {
          rsi: null,
          ma50: null,
          ma200: null,
          ema20: null,
          ema50: null,
          macd: null,
          volume: null,
          vwap: null,
          atr: null,
          pattern: null,
          momentum: null,
        },
        metadata: researchResult.metadata || {},
        news: researchResult.news || { articles: [] },
        raw: researchResult.raw || {
          marketData: null,
          cryptocompare: null,
          metadata: null,
          news: null,
        },
        providers: researchResult.providers || {
          marketData: null,
          metadata: null,
          news: null,
        },
      },
      processingTimeMs: researchResult.processingTimeMs || 0,
      metadata: researchResult.metadata || { symbol: researchResult.symbol },
    };

    // Use the existing trade execution pipeline but with pre-validated research
    const cycleStartTimestamp = Date.now();

    // Set up execution variables
    let cycleResult: AutoTradeReason = AUTO_TRADE_REASONS.TRADE_EXECUTED;
    let accuracy = researchResult.accuracy;
    let signal: TradeSignalType = researchResult.signal;
    let skipReason = "";
    let decisionStatus: "EXECUTED" | "SKIPPED" = "EXECUTED";
    let tradeId: string | null = null;

    // Mark research as executed (since it was provided)
    const researchExecuted = true;
    const useCachedResults = true; // We have the research result

    // Set up function-level variables
    let executionBlocked = false;
    let executionBlockReason = "";

    // Set up research data for history
    const researchData = {
      results: [researchDataResult],
      coinsAnalyzed: [researchResult.symbol],
    };
    const researchSymbol = researchResult.symbol;
    const finalResult = researchDataResult.result;
    const finalTradePlan = researchResult.tradePlan;

    try {
      // Execute trade using existing logic
      // Only execute if signal is BUY or SELL (not HOLD)
      if (signal === "BUY" || signal === "SELL") {
        // Build trade signal from research result
        const tradeSignal: TradeSignal = {
          symbol: researchResult.symbol,
          signal: signal,
          accuracy,
          entryPrice: researchResult.price || 0,
          stopLoss: finalTradePlan?.stopLoss || 0,
          takeProfit: finalTradePlan?.takeProfit || 0,
          takeProfit1: finalTradePlan?.takeProfit1,
          takeProfit2: finalTradePlan?.takeProfit2,
          takeProfit3: finalTradePlan?.takeProfit3,
          reasoning: `Auto-trade execution from background research (cycle: ${cycleId})`,
          requestId: cycleId,
          timestamp: new Date(cycleStartTimestamp),
          leverage: finalTradePlan?.leverage,
        };

        // Execute the trade
        const execution = await this.executeTrade(uid, tradeSignal, false);

        logger.info(
          {
            uid,
            cycleId,
            tradeId: execution.tradeId,
            symbol: researchResult.symbol,
          },
          "✅ [AUTO_TRADE_EXECUTION] Trade executed successfully",
        );
      } else {
        logger.info(
          { uid, cycleId, signal, symbol: researchResult.symbol },
          "⏭️ [AUTO_TRADE_EXECUTION] Skipping trade - signal is HOLD",
        );
      }

      // Return the research result
      return researchDataResult;
    } catch (executionError: any) {
      logger.error(
        { uid, cycleId, error: executionError.message },
        "❌ [AUTO_TRADE_EXECUTION] Trade execution failed",
      );

      // Save error history
      if (!skipHistoryStorage) {
        await saveAutoTradeHistoryWithExecutionStatus(
          uid,
          researchDataResult,
          researchData,
          researchSymbol,
          finalResult,
          finalTradePlan,
          accuracy,
          signal,
          finalResult.price || 0,
          "SKIPPED",
          null,
          null,
        );
      }

      return null;
    }
  }

  /**
   * Stop auto-trade background research loop for a user
   */
  async stopAutoTradeLoop(uid: string): Promise<void> {
    logger.info(
      { uid },
      "🔄 [AUTOTRADE] Stopping auto-trade for user - Persisting state and triggering scheduler",
    );

    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection("users").doc(uid);

      // 1. Update autoTradeConfig
      await userRef.collection("autoTradeConfig").doc("current").set(
        {
          autoTradeEnabled: false,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      // 2. CRITICAL: Sync root users/{uid} document with auto-trade state
      // UI reads from root document - must be in sync with autoTradeConfig/current
      await userRef.set(
        {
          autoTradeEnabled: false,
          autoTrade: { enabled: false },
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      console.log("🔥 [HARD_LOG] [AUTO_TRADE_USERS_DOC_SYNCED]", {
        uid,
        autoTradeEnabled: false,
        apiConnected: undefined, // Don't touch exchange flags when disabling
        source: "stopAutoTradeLoop",
      });

      // 3. Update backgroundResearchSettings
      await userRef.collection("settings").doc("backgroundResearch").set(
        {
          backgroundResearchEnabled: false,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true },
      );

      // 3. Trigger scheduler update (which will disable the job)
      const { backgroundResearchScheduler } =
        await import("./backgroundResearchScheduler");
      await backgroundResearchScheduler.onUserSettingsChanged(uid);

      logger.info(
        { uid },
        "✅ [AUTOTRADE] Auto-trade disabled and unscheduled successfully",
      );
    } catch (err: any) {
      logger.error(
        { uid, error: err.message },
        "❌ [AUTOTRADE] Failed to stop/persist auto-trade state",
      );
      throw err;
    }
  }

  /**
   * Check if auto-trade loop is running for a user
   * CRITICAL: Now uses BackgroundResearchScheduler state (single source of truth)
   */
  async isAutoTradeRunning(uid: string): Promise<boolean> {
    try {
      // Check scheduler state (single source of truth)
      const { backgroundResearchScheduler } =
        await import("./backgroundResearchScheduler");
      const hasInterval = backgroundResearchScheduler.isUserScheduled(uid);
      const jobState = backgroundResearchScheduler.getUserJobState(uid);

      if (hasInterval && jobState) {
        const mode = (jobState as any).mode;
        // Auto-trade is running if scheduler has interval and mode is AUTO_TRADE_RESEARCH
        if (mode === "AUTO_TRADE_RESEARCH") {
          return true;
        }
      }

      // Fallback: Check Firestore config
      const config = await this.loadConfig(uid);
      return config.autoTradeEnabled === true;
    } catch (error: any) {
      logger.warn(
        { uid, error: error.message },
        "Failed to check auto-trade running state, using config fallback",
      );
      // Fallback: Check Firestore config
      const config = await this.loadConfig(uid);
      return config.autoTradeEnabled === true;
    }
  }

  /**
   * Bootstrap all enabled auto-trade loops across all users
   * CRITICAL: Use this on server startup to resume trading for all users
   */
  async bootstrapLoops(): Promise<void> {
    if (process.env.DISABLE_AUTOTRADE === "true") {
      logger.warn("Auto-trade bootstrap aborted: DISABLE_AUTOTRADE=true");
      return;
    }

    try {
      logger.info(
        "🔄 [AUTOTRADE] Bootstrapping enabled loops for all users...",
      );
      const db = getFirebaseAdmin().firestore();

      const usersSnapshot = await db.collection("users").get();
      let count = 0;

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;

        if (uid.startsWith("_")) continue;

        try {
          const config = await this.loadConfig(uid);
          if (config.autoTradeEnabled) {
            await this.startAutoTradeLoop(uid);
            count++;
            logger.info(
              { uid },
              "✅ [BOOTSTRAP] Resumed auto-trade loop for user",
            );
          }
        } catch (userErr: any) {
          logger.warn(
            { uid, error: userErr.message },
            "⚠️ [BOOTSTRAP] Failed to resume loop for user, skipping",
          );
        }
      }

      logger.info(
        { count },
        `✅ [BOOTSTRAP] Multi-user auto-trade bootstrap completed. Resumed ${count} loops.`,
      );
    } catch (error: any) {
      logger.error(
        { error: error.message },
        "❌ [BOOTSTRAP] Fatal error during auto-trade bootstrap",
      );
    }
  }

  /**
   * Get last research time for a user
   * CRITICAL: Now uses BackgroundResearchScheduler state (single source of truth)
   */
  async getLastResearchTime(uid: string): Promise<string | null> {
    try {
      // Check scheduler state (single source of truth)
      const { backgroundResearchScheduler } =
        await import("./backgroundResearchScheduler");
      const jobState = backgroundResearchScheduler.getUserJobState(uid);
      if (jobState?.lastRunAt) {
        return jobState.lastRunAt.toISOString();
      }

      // Fallback: Check Firestore research history
      const history = await firestoreAdapter.getResearchHistory(uid, 1);
      if (history && history.length > 0 && history[0].timestamp) {
        return typeof history[0].timestamp === "string"
          ? history[0].timestamp
          : new Date(history[0].timestamp).toISOString();
      }

      return null;
    } catch (error: any) {
      logger.warn(
        { uid, error: error.message },
        "Failed to get last research time, using history fallback",
      );
      // Fallback: Check Firestore research history
      try {
        const history = await firestoreAdapter.getResearchHistory(uid, 1);
        if (history && history.length > 0 && history[0].timestamp) {
          return typeof history[0].timestamp === "string"
            ? history[0].timestamp
            : new Date(history[0].timestamp).toISOString();
        }
      } catch (histError: any) {
        logger.warn(
          { uid, error: histError.message },
          "Failed to get research history",
        );
      }
      return null;
    }
  }

  /**
   * Run a single auto-trade research cycle
   * This is called every 5 minutes by the background loop
   *
   * REFACTORED: All external calls wrapped with timeouts
   *
   * @param uid User ID
   * @param skipHistoryStorage If true, history storage is skipped (caller handles it with correct source)
   */
  async runAutoTradeResearchCycle(
    uid: string,
    skipHistoryStorage: boolean = false,
    cycleId?: string,
  ): Promise<ResearchDataResult | null> {
    const cycleStartTimestamp: number = Date.now();

    // CRITICAL: Load config and settings ONCE at cycle start and reuse throughout
    let userConfig: AutoTradeConfig;
    let userSettings: any;
    let tradingSettings: any;

    try {
      userConfig = await this.loadConfig(uid);
      userSettings = await firestoreAdapter.getSettings(uid);
      tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
    } catch (configError: any) {
      logger.error(
        { uid, error: configError.message },
        "❌ [CONFIG_LOAD] Failed to load user config/settings at cycle start",
      );
      await saveAutoTradeHistorySkipped(
        uid,
        "SYSTEM_ERROR",
        `CONFIG_LOAD_FAILED: ${configError.message} (timestamp: ${cycleStartTimestamp})`,
        cycleId,
      );
      return null;
    }

    // CRITICAL: Check exchange usability once at cycle start and reuse result
    // Use user_request context for actual trading operations that need credential validation
    const exchangeUsability = await isExchangeUsable(uid, "user_request");

    // PRIORITY ORDER: isExchangeUsable().usable result > disconnected flags > historical state
    // If isExchangeUsable() returns usable=true, ALWAYS proceed regardless of reason
    if (exchangeUsability.usable) {
      // Exchange is usable - log success and proceed
      logger.info(
        {
          uid,
          exchange: exchangeUsability.exchange,
          reason: exchangeUsability.reason,
          usable: exchangeUsability.usable,
        },
        `[AUTO_TRADE_RESEARCH_PROCEED] Exchange is usable - proceeding with auto-trade research cycle`,
      );
      // CRITICAL: Clear any disconnected flags when exchange is usable
      // This ensures disconnected state doesn't persist when decryption succeeds
      
      // SKIP the entire exchange blocking logic when usable=true
      // Continue to the rest of the research cycle
    } else {
      const normalizedExchangeReason =
        exchangeUsability.reason === "connected"
          ? "connected"
          : exchangeUsability.reason === "disconnected"
            ? "disconnected"
            : "not_connected";

      // MANDATORY INVARIANT: Same as scheduler
      // 1. not_connected → SOFT SKIP ONLY
      if (normalizedExchangeReason === "not_connected") {
        // SOFT SKIP: Exchange not usable - skip this cycle
        logger.warn(
          {
            uid,
            exchange: exchangeUsability.exchange,
            reason: normalizedExchangeReason,
            usable: exchangeUsability.usable,
            softSkipOnly: true,
          },
          `[AUTO_TRADE_RESEARCH_SOFT_SKIP] Exchange not usable (not_connected) - skipping cycle without stopping`,
        );

        // Save SKIPPED history for not_connected
        if (!skipHistoryStorage) {
          await saveAutoTradeHistorySkipped(
            uid,
            "EXCHANGE_NOT_CONNECTED",
            "Exchange not connected - soft skip only",
          );
        }

        return null; // Cycle completed with SKIPPED history (SOFT SKIP)
      } else if (normalizedExchangeReason === "disconnected") {
        // HARD STOP: Exchange disconnected by user
        logger.warn(
          {
            uid,
            exchange: exchangeUsability.exchange,
            reason: normalizedExchangeReason,
            usable: exchangeUsability.usable,
            hardStop: true,
          },
          `AUTO_TRADE_RESEARCH_BLOCKED: EXCHANGE_${normalizedExchangeReason.toUpperCase()} - hard stop required`,
        );

        // Save SKIPPED history for disconnected
        if (!skipHistoryStorage) {
          await saveAutoTradeHistorySkipped(
            uid,
            "EXCHANGE_NOT_USABLE",
            normalizedExchangeReason,
          );
        }

        return null; // Cycle completed with SKIPPED history (HARD STOP)
      }
    }
    console.log(
      "🔥 [HARD_LOG] [AUTO_TRADE_CYCLE_START] runAutoTradeResearchCycle() called for user:",
      uid,
      "skipHistoryStorage:",
      skipHistoryStorage,
    );

    // CRITICAL: Declare all execution pipeline variables at function level
    let cycleResult: AutoTradeReason = AUTO_TRADE_REASONS.NO_SIGNAL;
    let accuracy = 0;
    let signal: TradeSignalType | "UNKNOWN" | "ANALYZING" | "PENDING" =
      "UNKNOWN";
    let skipReason = "";
    let decisionStatus: "EXECUTED" | "SKIPPED" = "SKIPPED";
    let tradeId: string | null = null;
    let executionBlocked = false;
    let executionBlockReason = "";
    let researchExecuted = false;
    let researchAttempted = false;
    let useCachedResults = false;
    let researchResult: ResearchDataResult | null = null;
    let researchData: any = null;
    let researchSymbol: string | null = null;
    let finalResult: any = null;
    let finalTradePlan: any = null;
    let settings: any = null;

    // CRITICAL: AUTO-TRADE ENGINE IS A CONSUMER ONLY - it consumes research generated by scheduler
    // The scheduler should have already generated and cached research results for this cycle
    try {
      const { firestoreAdapter } = await import("./firestoreAdapter");

      // FIRST: Check for fresh cached research result (generated by scheduler in this cycle)
      const cachedResearch =
        await firestoreAdapter.getLatestResearchResult(uid);
      if (
        cachedResearch &&
        cachedResearch.source === "TELEGRAM_BACKGROUND" &&
        cachedResearch.timestamp &&
        Date.now() - cachedResearch.timestamp.toDate().getTime() < 5 * 60 * 1000
      ) {
        // Use cached research result from scheduler
        console.log(
          "🔥 [AUTO_TRADE_CONSUMER] ✅ USING SCHEDULER-GENERATED RESEARCH RESULT:",
          {
            symbol: cachedResearch.symbol,
            signal: cachedResearch.signal,
            accuracy: cachedResearch.accuracy,
            source: cachedResearch.source,
            ageSeconds: (
              (Date.now() - cachedResearch.timestamp.toDate().getTime()) /
              1000
            ).toFixed(1),
          },
        );

        // Convert cached result to ResearchDataResult format for execution pipeline
        const researchDataResult: ResearchDataResult = {
          symbol: cachedResearch.symbol,
          signal: cachedResearch.signal,
          accuracy: cachedResearch.accuracy,
          result: {
            signal: cachedResearch.signal,
            accuracy: cachedResearch.accuracy,
            tradePlan: cachedResearch.tradePlan,
            price: cachedResearch.price || 0,
            snapshotAccuracy: cachedResearch.accuracy,
            accuracyBreakdown: {
              indicatorScore: 0,
              marketStructureScore: 0,
              momentumScore: 0,
              volumeScore: 0,
              newsScore: 0,
              riskPenalty: 0,
            },
            accuracyWeightsUsed: {},
            indicators: cachedResearch.indicators || {
              rsi: null,
              ma50: null,
              ma200: null,
              ema20: null,
              ema50: null,
              macd: null,
              volume: null,
              vwap: null,
              atr: null,
              pattern: null,
              momentum: null,
            },
            metadata: {},
            news: { articles: [] },
            raw: {
              marketData: null,
              cryptocompare: null,
              metadata: null,
              news: null,
            },
            providers: { marketData: null, metadata: null, news: null },
          },
          processingTimeMs: 0,
          metadata: { symbol: cachedResearch.symbol },
        };

        // Set function-level variables as if research just completed successfully
        console.log(
          "🔥 [AUTO_TRADE_CONSUMER] Setting up execution variables from cached research",
        );

        // Set function-level variables as if research just completed successfully
        cycleResult = AUTO_TRADE_REASONS.TRADE_EXECUTED;
        accuracy = cachedResearch.accuracy;
        signal = cachedResearch.signal as TradeSignalType;
        skipReason = "";
        decisionStatus = "EXECUTED";
        tradeId = cachedResearch.tradeId || null;
        executionBlocked = false;
        executionBlockReason = "";
        researchExecuted = true;

        // Set function-level variables for execution
        researchResult = researchDataResult;
        researchData = {
          results: [researchDataResult],
          coinsAnalyzed: [cachedResearch.symbol],
        };
        finalResult = researchDataResult.result;
        finalTradePlan = cachedResearch.tradePlan;
        researchSymbol = cachedResearch.symbol;

        // Use pre-loaded settings for existing results
        settings = tradingSettings;

        // Set flag to skip research execution
        useCachedResults = true;

        console.log(
          "🔥 [AUTO_TRADE_CONSUMER] Function-level variables set, continuing to execution pipeline",
        );
      } else {
        // AUTO-TRADE CONSUMER: No cached research available - skip gracefully
        console.log(
          "🔥 [AUTO_TRADE_CONSUMER] No cached research available - skipping auto-trade cycle",
        );
        logger.info(
          { uid, cycleId },
          "🚫 [AUTO_TRADE_CONSUMER] No cached research available - skipping cycle gracefully",
        );

        // Save SKIPPED history for no cached research
        if (!skipHistoryStorage) {
          await saveAutoTradeHistorySkipped(
            uid,
            "NO_CACHED_RESEARCH",
            "Auto-trade is consumer-only - no research results available to consume",
            cycleId,
          );
        }

        return null; // Exit gracefully - no research to consume
      }
    } catch (cacheError) {
      console.error(
        "🔥 [AUTO_TRADE_CONSUMER] Error checking cached research:",
        cacheError.message,
      );
      // For consumer mode, if cache check fails, skip gracefully
      logger.info(
        { uid, cycleId },
        "🚫 [AUTO_TRADE_CONSUMER] Cache check failed - skipping cycle gracefully",
      );

      // Save SKIPPED history for cache error
      if (!skipHistoryStorage) {
        await saveAutoTradeHistorySkipped(
          uid,
          "CACHE_CHECK_FAILED",
          "Failed to check for cached research results",
          cycleId,
        );
      }

      return null; // Exit gracefully on cache error
    }

    // CRITICAL: Auto-trade generates research AND executes trades
    // If no cached result exists, we run research normally
    // This ensures research is always generated for auto-trade consumption

    // CRITICAL: Prevent duplicate execution per cycle using uid+timestamp key
    // This ensures only ONE execution per user per cycle, even if called multiple times

    // CRITICAL: Track active cycles to prevent duplicate execution
    // Use a properly typed in-memory set to track active cycles (cleared after completion)
    interface GlobalWithAutoTradeCycles {
      __autoTradeActiveCycles?: Set<string>;
    }
    const globalWithCycles = global as GlobalWithAutoTradeCycles;
    if (!globalWithCycles.__autoTradeActiveCycles) {
      globalWithCycles.__autoTradeActiveCycles = new Set<string>();
    }
    const activeCycles = globalWithCycles.__autoTradeActiveCycles;

    // SCHEDULER IS SINGLE SOURCE OF TRUTH: No duplicate cycle guard in AutoTradeEngine
    // The scheduler ensures only one cycle runs at a time, so this guard is redundant
    // and can cause conflicts with the scheduler's cycle management

    // CRITICAL: Load config and settings ONCE at cycle start and reuse throughout
    try {
      // 1. Initial Guards
      // CRITICAL: These guards only prevent research if system-wide flags are set
      // They do NOT check accuracy, signal, or trade conditions (those are evaluated AFTER research)

      // SKIP RESEARCH EXECUTION FOR CACHED RESULTS
      if (useCachedResults) {
        console.log(
          "🔥 [RESEARCH_CACHE] Skipping research execution - using cached results",
        );
      } else {
        if (process.env.DISABLE_AUTOTRADE === "true") {
          const reason =
            "DISABLE_AUTOTRADE_ENV_FLAG: Auto-trade disabled by environment variable";
          logger.info(
            { uid, reason },
            "⏭️ [AUTO_TRADE_SKIP] Research skipped - DISABLE_AUTOTRADE env flag set",
          );
          await logAutoTradeSkip(uid, reason, {
            exchangeStatus: "unknown",
          });

          // Save SKIPPED history when auto-trade is disabled
          await saveAutoTradeHistorySkipped(
            uid,
            "AUTO_TRADE_DISABLED",
            "Auto-trade is currently disabled in user settings",
          );

          return null; // Cycle completed with SKIPPED history
        }
        if (!shouldRunBackgroundTasks()) {
          const reason = "BACKGROUND_TASKS_PAUSED: Background tasks are paused";
          logger.info(
            { uid, reason },
            "⏭️ [AUTO_TRADE_SKIP] Research skipped - background tasks paused",
          );
          await logAutoTradeSkip(uid, reason, {
            exchangeStatus: "unknown",
          });

          // Save SKIPPED history when background tasks are paused
          await saveAutoTradeHistorySkipped(
            uid,
            "BACKGROUND_TASKS_PAUSED",
            "Background tasks are paused by system administrator",
          );

          return null; // Cycle completed with SKIPPED history
        }

        logger.info(
          { uid, cycleStartTime: new Date(cycleStartTimestamp).toISOString() },
          "🔄 [CYCLE_START] Auto-trade research cycle initiated",
        );
        console.log(
          "🔥 [HARD_LOG] [AUTO_TRADE_CYCLE_INIT] Auto-trade research cycle initiated for user:",
          uid,
        );

        // 2. Load Settings & Integrations (using pre-loaded config)
        const settings = tradingSettings;
        const { getUserIntegrations } = await import("../routes/integrations");
        const integrationResult = await getUserIntegrations(uid);
        const integrations = (integrationResult as any).providerConfig;

        // Verify Research API Keys (Standard Logic Requirement)
        const hasResearchKeys =
          (integrations?.marketData &&
            Object.keys(integrations.marketData).length > 0) ||
          (integrations?.metadata &&
            Object.keys(integrations.metadata).length > 0);

        if (!hasResearchKeys) {
          // CRITICAL: Do NOT store history for skipped cycles (no research keys)
          // History should only be stored for completed FINAL research with real accuracy values
          // Skipped cycles do NOT represent completed research
          const reason = AUTO_TRADE_REASONS.NO_RESEARCH_KEYS;
          logger.info(
            {
              uid,
              skipReason: reason,
              historyBlocked: true,
              reason: "Research keys missing - research did not execute",
            },
            "⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save for no-research-keys - only FINAL completed research should be saved",
          );

          await logAutoTradeSkip(uid, reason, {
            exchangeStatus: "unknown",
            additionalDetails: {
              details:
                "No research API keys configured. Please add keys to enable auto-trading.",
            },
          });
          // Return null instead of throwing - this is a configuration issue, not a system error

          // CRITICAL: Do NOT save history when research did NOT run (no research keys)
          // History should ONLY be saved when research actually executed and produced results
          // BTCUSDT fallback removed - only save history with REAL research data
          logger.info(
            {
              uid,
              skipReason: reason,
              historyBlocked: true,
              reason:
                "Research did not run - no history saved (BTC fallback removed)",
            },
            "⏭️ [HISTORY_GUARD] BLOCKED: Research did not run (no research keys) - saving SKIPPED history",
          );

          // Save SKIPPED history when no research keys are configured
          await saveAutoTradeHistorySkipped(
            uid,
            "NO_RESEARCH_KEYS",
            "No research API keys configured (CryptoCompare, NewsData, etc.)",
          );

          return null; // Cycle completed with SKIPPED history
        }

        // 3. CRITICAL: Early exchange decryption check for AUTO_TRADE_RESEARCH mode
        // Skip deep research if exchange API key decryption fails to prevent "missing final aggregated data" errors

        // CRITICAL: Reuse exchange usability result from cycle start (already checked above)
        // If exchange decryption failed, do NOT skip research.
        // Research must run to support Telegram alerts and History. Only EXECUTION is blocked.
        // PRIORITY ORDER: isExchangeUsable().usable result > disconnected flags > historical state

        // CRITICAL FIX: Only block execution if exchange is NOT usable according to isExchangeUsable()
        // Rule 1: If isExchangeUsable().usable === true, NEVER block execution
        // Rule 2: disconnected/disconnectedAt flags must be ignored when usability check succeeds
        if (!exchangeUsability.usable) {
          const executionExchangeReason = exchangeUsability.reason as string;

          // Always block execution if exchange is not usable, but handle differently based on reason
          if (executionExchangeReason === "not_connected") {
            // SOFT SKIP: Block execution only, continue research
            executionBlocked = true;
            executionBlockReason = "EXCHANGE_NOT_CONNECTED";
            const reason = AUTO_TRADE_REASONS.SKIPPED_EXCHANGE_UNAVAILABLE;

            logger.warn(
              {
                uid,
                error: exchangeUsability.reason,
                usable: exchangeUsability.usable,
                executionBlocked: true,
                softSkipOnly: true,
                reason:
                  "Exchange not usable (not_connected) - execution will be skipped, but research continues",
              },
              "⚠️ [AUTO_TRADE_SOFT_SKIP] Exchange not usable - research will continue, only execution blocked",
            );
          } else if (executionExchangeReason === "disconnected") {
            // HARD STOP for execution, but still continue with research
            executionBlocked = true;
            executionBlockReason =
              "EXCHANGE_" + executionExchangeReason.toUpperCase();
            const reason = AUTO_TRADE_REASONS.SKIPPED_EXCHANGE_UNAVAILABLE;

            logger.warn(
              {
                uid,
                error: executionExchangeReason,
                usable: exchangeUsability.usable,
                executionBlocked: true,
                hardStop: true,
                reason: `Exchange ${executionExchangeReason} - execution will be blocked with hard stop`,
              },
              `⚠️ [AUTO_TRADE_HARD_STOP] Exchange ${executionExchangeReason} - research will continue, execution blocked with hard stop`,
            );
          }

          if (executionBlocked) {
            // Log activity but CONTINUE to research
            await logAutoTradeSkip(uid, AUTO_TRADE_REASONS.SKIPPED_EXCHANGE_UNAVAILABLE, {
              exchangeStatus: "unavailable",
              additionalDetails: {
                details: "Exchange not usable according to isExchangeUsable(). Execution blocked, but research will continue.",
                error: exchangeUsability.reason,
                usable: exchangeUsability.usable,
              },
            });

            // DO NOT RETURN NULL - Proceed to research
          }
        } else {
          // CRITICAL FIX: Exchange is usable - NEVER block execution regardless of disconnected flags
          // When isExchangeUsable().usable === true, both research and execution should proceed normally
          // CLEAR any execution blocking flags that might have been set elsewhere
          executionBlocked = false;
          executionBlockReason = null;
          
          logger.info(
            {
              uid,
              exchange: exchangeUsability.exchange,
              reason: exchangeUsability.reason,
              usable: exchangeUsability.usable,
              executionAllowed: true,
            },
            `[AUTO_TRADE_EXECUTION_ALLOWED] Exchange is usable - both research and execution will proceed`,
          );
        }

        // 4. Trade Monitoring (Cleanup)
        await withTimeout(() => this.monitorActiveTrades(uid), 5000);

        // HEARTBEAT: Log cycle start (fires even if no trade happens)
        logger.info(
          {
            uid,
            cycleRunning: true,
            timestamp: new Date().toISOString(),
          },
          "[AUTO_TRADE_HEARTBEAT] cycleRunning=true",
        );

        // 5. Run Research with error handling
        let researchData: ResearchData;
        let researchError: any = null;

        // CRITICAL: Store selected symbol BEFORE research to avoid BTC fallback on error
        let selectedSymbolForHistory: string | null = null;

        researchAttempted = true;
        try {
          researchData = await runDeepResearchWithCoinSelection(
            uid,
            settings,
            undefined,
            integrations,
          );

          // CRITICAL: If no research data returned (no usable providers), save SKIPPED history
          if (!researchData) {
            logger.warn(
              {
                uid,
                reason: "NO_USABLE_PROVIDERS",
              },
              "Auto-trade cycle: No usable providers - saving NEWS_UNAVAILABLE history entry",
            );

            // Save visible history entry for news provider unavailable
            // This ensures history is always visible even when providers are down
            if (!skipHistoryStorage) {
              // Create placeholder research data for history entry
              const placeholderResearchResult: ResearchDataResult = {
                symbol: "NEWS_UNAVAILABLE",
                signal: "HOLD",
                accuracy: 0,
                result: {
                  signal: "HOLD",
                  accuracy: 0,
                  price: 0,
                  snapshotAccuracy: 0,
                  accuracyBreakdown: { indicatorScore: 0, marketStructureScore: 0, momentumScore: 0, volumeScore: 0, newsScore: 0, riskPenalty: 0 },
                  accuracyWeightsUsed: {},
                  indicators: { rsi: null, ma50: null, ma200: null, ema20: null, ema50: null, macd: null, volume: null, vwap: null, atr: null, pattern: null, momentum: null },
                  metadata: {},
                  news: { articles: [] },
                  raw: { marketData: null, cryptocompare: null, metadata: null, news: null },
                  providers: { marketData: null, metadata: null, news: null },
                },
                processingTimeMs: 0,
                metadata: { symbol: "NEWS_UNAVAILABLE" },
              };

              const placeholderResearchData: ResearchData = {
                results: [],
                coinsAnalyzed: [],
              };

              const placeholderFinalResult = {
                signal: "HOLD",
                accuracy: 0,
                price: 0,
                analysis: {},
                indicators: {},
                metadata: {},
                news: { articles: [] },
                raw: {},
                providers: {},
              };

              await saveAutoTradeHistoryWithExecutionStatus(
                uid,
                placeholderResearchResult,
                placeholderResearchData,
                "NEWS_UNAVAILABLE",
                placeholderFinalResult,
                null, // finalTradePlan
                0, // accuracy
                "HOLD", // signal
                0, // historyPrice
                "SKIPPED", // decisionStatus
                null, // executionStatus
                null, // tradeId
              );
            }

            logger.info(
              {
                uid,
                cycleId: `cycle_${cycleStartTimestamp}`,
                duration: Date.now() - cycleStartTimestamp,
                result: "SKIPPED",
                reason: "NO_USABLE_PROVIDERS",
                historySaved: true,
              },
              "⏭️ [AUTO_TRADE_CYCLE] Cycle COMPLETED (SKIPPED) - NEWS_UNAVAILABLE history written",
            );

            return null; // Cycle completed with SKIPPED history
          }

          // CRITICAL: Mark research as executed ONLY if it actually returned results
          if (researchData.results && researchData.results.length > 0) {
            researchExecuted = true;
          }
          // Extract selected symbol from research data (coinsAnalyzed is populated even on partial failure)
          selectedSymbolForHistory =
            researchData.coinsAnalyzed?.[0] ||
            researchData.results?.[0]?.symbol ||
            null;
        } catch (researchErr: any) {
          researchError = researchErr;
          logger.error(
            { uid, error: researchErr.message },
            "❌ [AUTO_TRADE] Research execution failed",
          );

          // CRITICAL FIX: Only skip history if coin selection NEVER happened
          // If coin selection already happened (symbol exists), history MUST be saved even if execution fails
          // Check if we have ANY symbol available (selectedSymbolForHistory, researchData, or researchResult.symbol)
          let symbolForHistory = selectedSymbolForHistory;
          // Try to extract symbol from partial researchData if it exists (might be available even on error)
          if (!symbolForHistory && researchData) {
            symbolForHistory =
              researchData.coinsAnalyzed?.[0] ||
              researchData.results?.[0]?.symbol ||
              null;
          }
          // Also check researchResult.symbol if researchData exists (might be partially populated)
          if (!symbolForHistory && researchData?.results?.[0]?.symbol) {
            symbolForHistory = researchData.results[0].symbol;
          }

          // CRITICAL: If research failed completely and no symbol was selected, save SKIPPED history
          if (!symbolForHistory) {
            logger.warn(
              {
                uid,
                error: researchErr.message,
                reason: "RESEARCH_FAILED_BEFORE_COIN_SELECTION",
              },
              "Auto-trade cycle: Research failed before coin selection - saving SKIPPED history",
            );

            await saveAutoTradeHistorySkipped(
              uid,
              "RESEARCH_FAILED",
              `Research execution failed before coin selection: ${researchErr.message}`,
            );

            await logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
              exchangeStatus: "available",
              additionalDetails: {
                error: researchErr.message,
                details: "Research execution failed before producing results",
              },
            });

            logger.info(
              {
                uid,
                cycleId: `cycle_${cycleStartTimestamp}`,
                duration: Date.now() - cycleStartTimestamp,
                result: "SKIPPED",
                reason: "RESEARCH_FAILED_BEFORE_COIN_SELECTION",
                historySaved: true,
              },
              "⏭️ [AUTO_TRADE_CYCLE] Cycle COMPLETED (SKIPPED)",
            );

            return null; // Cycle completed with SKIPPED history
          }
          // CRITICAL: If research failed, do NOT save history with accuracy=0
          // History must only reflect real research runs with valid accuracy calculations
          // Research that fails before completion should not generate history entries

          // Log skip and save history
          await logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
            exchangeStatus: "available",
            additionalDetails: {
              error: researchErr.message,
              details: "Research execution failed",
            },
          });

          // CRITICAL: Save ERROR history for research execution failure
          // Every execution path must save history before returning
          if (!skipHistoryStorage) {
            await saveAutoTradeHistorySkipped(
              uid,
              "RESEARCH_EXECUTION_FAILED",
              `Research execution failed: ${researchErr.message}`,
            );
          }
          return null;
        }

        // Get symbol from researchData (from coinsAnalyzed or first result)
        // CRITICAL: Remove BTC fallback - if no symbol available, use null and save history anyway
        const researchSymbol =
          researchData.coinsAnalyzed?.[0] ||
          researchData.results?.[0]?.symbol ||
          null; // NO BTC fallback - use null and save history with null symbol

        if (!researchData.results || researchData.results.length === 0) {
          skipReason = AUTO_TRADE_REASONS.NO_SIGNAL;
          cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;

          logger.warn(
            {
              uid,
              symbol: researchSymbol,
              reason: "NO_RESEARCH_RESULTS",
            },
            "Auto-trade cycle: Research produced no results - saving SKIPPED history",
          );

          await saveAutoTradeHistorySkipped(
            uid,
            "NO_RESEARCH_RESULTS",
            "Research completed but produced no actionable signals or results",
          );

          await logAutoTradeSkip(uid, skipReason, {
            symbol: researchSymbol,
            exchangeStatus: "available",
            additionalDetails: {
              resultsCount: researchData.results?.length || 0,
            },
          });

          return null; // Cycle completed with SKIPPED history
        }

        const researchResult = researchData.results[0];

        // CRITICAL: Safe Symbol & Accuracy Access - use guarded defaults
        const safeSymbol = researchResult?.symbol || "UNKNOWN";
        const safeAccuracy =
          typeof researchResult?.accuracy === "number"
            ? researchResult.accuracy
            : 0;

        // CRITICAL: Null Research Guard - If researchResult is null, do NOT throw, write ONE SKIPPED history
        if (!researchResult) {
          logger.warn(
            {
              uid,
              reason: "RESEARCH_RESULT_MISSING",
            },
            "Auto-trade cycle: Research result is null - writing ONE SKIPPED history entry",
          );

          // Write ONE SKIPPED history with reason: RESEARCH_RESULT_MISSING
          if (!skipHistoryStorage) {
            await saveAutoTradeHistorySkipped(
              uid,
              "RESEARCH_RESULT_MISSING",
              "Research execution completed but returned null result - no data available for trading decisions",
            );
          }

          await logAutoTradeSkip(uid, "RESEARCH_RESULT_MISSING", {
            exchangeStatus: "available",
            additionalDetails: {
              reason: "Research completed but result is null",
            },
          });

          return null; // Exit safely without ERROR_CYCLE
        }

        // CRITICAL: Verify symbol is in Top 25 before processing
        let symbolTop25Check = true; // Default to PASS - only block if check succeeds and returns false
        try {
          // Use imported function from autoTradeGuards
          symbolTop25Check = await isSymbolInTop10(
            uid,
            researchResult?.symbol || "UNKNOWN",
          );
        } catch (error: any) {
          logger.error(
            {
              uid,
              symbol: researchResult?.symbol || "UNKNOWN",
              error: error.message,
            },
            "❌ [TOP_25_ERROR] Error checking if symbol is in top 25 - defaulting to PASS",
          );
          // On error, be safe and allow (don't block research) - default to PASS
          symbolTop25Check = true;
        }
        if (!symbolTop25Check) {
          logger.warn(
            {
              uid,
              symbol: researchResult?.symbol || "UNKNOWN",
              reason: "SYMBOL_OUTSIDE_TOP_25",
            },
            "Auto-trade cycle: Symbol outside Top 25 - saving SKIPPED history",
          );

          await saveAutoTradeHistorySkipped(
            uid,
            "SYMBOL_OUTSIDE_TOP_25",
            `Research completed but symbol ${researchResult?.symbol || "UNKNOWN"} is outside Top 25`,
          );

          await logAutoTradeSkip(uid, "NOT_TOP_25", {
            symbol: researchResult?.symbol || "UNKNOWN",
            exchangeStatus: "available",
            additionalDetails: {
              reason: "Symbol outside Top 25 detected in research result",
            },
          });

          return null; // Cycle completed with SKIPPED history
        }

        // CRITICAL: Use FINAL Deep Research result as source of truth
        // researchResult.result is the full FreeModeDeepResearchResult from researchAggregator
        const finalResult = researchResult.result;

        if (!finalResult) {
          logger.warn(
            {
              uid,
              symbol: researchResult?.symbol || "UNKNOWN",
              reason: "MISSING_FINAL_RESULT",
            },
            "Auto-trade cycle: Research missing final aggregated result - saving SKIPPED history",
          );

          await saveAutoTradeHistorySkipped(
            uid,
            "MISSING_FINAL_RESULT",
            `Research completed for ${researchResult?.symbol || "UNKNOWN"} but final aggregated result is missing`,
          );

          await logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
            symbol: researchResult?.symbol || "UNKNOWN",
            exchangeStatus: "available",
            additionalDetails: {
              details: "Research result missing final aggregated data",
            },
          });

          return null; // Cycle completed with SKIPPED history
        }

        // CRITICAL: Extract FINAL signal from aggregated result (source of truth)
        signal = finalResult.signal || researchResult.signal || "HOLD";

        // CRITICAL: Extract FINAL accuracy from aggregated result using centralized AccuracyGuard
        // finalResult.accuracy is the final aggregated accuracy from researchAggregator
        const finalAccuracyRaw = finalResult.accuracy;
        const accuracyValidation =
          AccuracyGuard.validateAndNormalize(finalAccuracyRaw);
        if (!accuracyValidation.isValid) {
          logger.warn(
            {
              uid,
              symbol: researchResult?.symbol || "UNKNOWN",
              accuracy: finalAccuracyRaw,
              reason: "INVALID_ACCURACY",
              validationReason: accuracyValidation.reason,
            },
            "Auto-trade cycle: Research produced invalid accuracy - saving SKIPPED history",
          );

          await saveAutoTradeHistorySkipped(
            uid,
            "INVALID_ACCURACY",
            `Research completed for ${researchResult?.symbol || "UNKNOWN"} but accuracy ${finalAccuracyRaw} is invalid: ${accuracyValidation.reason}`,
          );

          // Return null instead of throwing - this is a data validation failure, not a system error
          return null; // Cycle completed with SKIPPED history
        }
        const accuracy = accuracyValidation.normalizedAccuracy;

        // INSTRUMENTATION: Log research cycle details
        logger.info(
          {
            uid,
            symbol: researchResult.symbol,
            accuracy,
            signal,
            isFinal: finalResult.isFinal,
            hasTradePlan: !!finalResult.tradePlan,
            top25Verified: true,
            timestamp: new Date().toISOString(),
          },
          "🔍 [TOP_25_RESEARCH] Research cycle completed - Top 25 verified, accuracy calculated",
        );

        // CRITICAL HARD GUARD: Detect if this is a FINAL guard cached result (execution was skipped)
        // FINAL guard returns cached results with isFinal=true but execution was NOT performed
        // These should NOT be saved to history as they represent skipped executions, not completed research
        const isCachedResult =
          finalResult.isFinal === true &&
          (finalResult as any).isProcessing === false &&
          accuracy === 0 &&
          signal === "HOLD";

        if (isCachedResult) {
          logger.warn(
            {
              uid,
              symbol: researchResult?.symbol || "UNKNOWN",
              reason: "FINAL_GUARD_CACHED_RESULT",
            },
            "Auto-trade cycle: FINAL guard returned cached result - saving SKIPPED history",
          );

          await saveAutoTradeHistorySkipped(
            uid,
            "FINAL_GUARD_CACHED",
            `Symbol ${researchResult?.symbol || "UNKNOWN"} has existing FINAL result - research was skipped`,
          );

          await logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
            symbol: researchResult?.symbol || "UNKNOWN",
            exchangeStatus: "available",
            additionalDetails: {
              details: "FINAL guard cached result - execution was skipped",
            },
          });

          return null; // Cycle completed with SKIPPED history
        }

        // CRITICAL: Extract FINAL trade plan from aggregated result (ensures consistency with signal/accuracy)
        // The tradePlan is at root level of FreeModeDeepResearchResult
        if (!useCachedResults) {
          finalTradePlan = finalResult.tradePlan || null;
        } // finalTradePlan already set for cached results
      } // End of research execution conditional (skip for cached results)

      // INSTRUMENTATION: Log trade plan generation result
      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          accuracy,
          signal,
          hasTradePlan: !!finalTradePlan,
          entryPrice: finalTradePlan?.entryPrice,
          stopLoss: finalTradePlan?.stopLoss,
          takeProfit:
            finalTradePlan?.takeProfit1 ?? finalTradePlan?.takeProfit2,
          riskRewardRatio: finalTradePlan?.riskRewardRatio,
          top25Verified: true,
          timestamp: new Date().toISOString(),
        },
        finalTradePlan
          ? "✅ [TOP_25_TRADE_PLAN] Trade plan generated successfully"
          : "⏭️ [TOP_25_TRADE_PLAN] Trade plan rejected (null)",
      );

      // CRITICAL: Extract current market price from FINAL result
      // Priority: result.price > analysis.priceAction.price > indicators.price > metadata.price
      const historyPrice =
        finalResult.price ||
        finalResult.analysis?.priceAction?.currentPrice ||
        finalResult.analysis?.priceAction?.price ||
        finalResult.indicators?.price ||
        finalResult.metadata?.price ||
        0;

      // Validate price is valid
      if (historyPrice <= 0) {
        logger.warn(
          {
            uid,
            symbol: researchResult.symbol,
            priceSources: {
              resultPrice: finalResult.price,
              analysisPrice: finalResult.analysis?.priceAction?.price,
              indicatorsPrice: finalResult.indicators?.price,
              metadataPrice: finalResult.metadata?.price,
            },
          },
          "⚠️ [HISTORY] Market price not found in final result - storing 0",
        );
      }

      // 5. Send Telegram Alert (if auto-trade is ON and accuracy >= telegramAccuracyTrigger)
      // CRITICAL: When Auto-Trade is ON, Telegram alerts come from AutoTradeEngine results
      // This replaces the Telegram background research engine alerts
      // CRITICAL: Must respect Telegram accuracy settings AND spam prevention
      // CRITICAL: Alerts are sent on EVERY qualifying research cycle (no silent skips)
      try {
        const alertId = `auto_trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const finalResult = researchResult.result;
        const finalTradePlan = finalResult?.tradePlan || null;

        const decision = await evaluateTelegramAlertDecision(
          uid,
          researchResult?.symbol || "UNKNOWN",
          signal,
          accuracy,
          finalTradePlan,
          alertId,
        );

        if (decision.shouldSend && decision.alertData) {
          // Send consolidated Telegram research alert
          await sendConsolidatedTelegramAlert(uid, "research", {
            symbol: decision.alertData.symbol,
            signal: decision.alertData.signal,
            accuracy: decision.alertData.accuracy,
            tradePlan: decision.alertData.tradePlan,
          });

          // Update last alert sent tracking
          const bgSettings =
            await firestoreAdapter.getBackgroundResearchSettings(uid);
          const updatedLastAlertSent = {
            ...(bgSettings.lastAlertSent || {}),
            [researchResult.symbol]: {
              timestamp: admin.firestore.Timestamp.now(),
              accuracy: accuracy,
            },
          };
          await firestoreAdapter.saveBackgroundResearchSettings(uid, {
            lastAlertSent: updatedLastAlertSent,
          });
        }
      } catch (telegramError: any) {
        const alertId = `auto_trade_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        logger.error(
          {
            alertId,
            uid,
            symbol: researchResult?.symbol || "UNKNOWN",
            mode: "AUTO_TRADE",
            accuracy,
            status: "FAILED",
            error: telegramError.message,
          },
          "❌ [TELEGRAM_ALERT_ERROR] Failed to send Telegram alert from AutoTradeEngine",
        );
      }

      // 6. EXECUTION ORDER ENFORCEMENT
      // STRICT ORDER: System Risk -> Accuracy Gate -> Execution

      // STEP 1: SYSTEM RISK CHECKS
      // Verify account health (Daily Loss, Cooldown, etc.) BEFORE evaluating accuracy or creating signals
      const systemRiskCheck = await checkSystemRisk(
        uid,
        false,
        settings,
        researchResult?.symbol || "UNKNOWN",
      );

      if (!systemRiskCheck.allowed) {
        skipReason = systemRiskCheck.reason || "System risk check failed";
        cycleResult = AUTO_TRADE_REASONS.SYSTEM_RISK_FAILURE;
        logger.info(
          { uid, reason: skipReason, step: "SYSTEM_RISK_CHECK" },
          "⛔ [EXECUTION_ORDER] BLOCKED: System risk check failed",
        );
        await logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult?.symbol || "UNKNOWN",
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: "available",
        });
        // CRITICAL: Save SKIPPED history for system risk failure
        // Every execution path must save history before returning
        if (!skipHistoryStorage && researchExecuted) {
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            researchResult.price || 0,
            decisionStatus,
            null, // executionStatus
            null, // tradeId
          );
        }
        return researchResult;
      }

      // STEP 2: ACCURACY GATE (User-Defined)
      // Consolidated accuracy validation for trade execution
      const accuracyValidation = validateAccuracyForExecution(
        accuracy,
        settings,
        false,
      ); // Always use auto-trade threshold

      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          accuracy,
          userAccuracyTrigger: settings.accuracyTrigger,
          executionThreshold: accuracyValidation.threshold,
          signal,
          willExecute: accuracyValidation.allowed && signal !== "HOLD",
          usingUserSetting: settings.accuracyTrigger?.min !== undefined,
        },
        `🎯 [RESEARCH_CYCLE] Accuracy gate evaluation - threshold: ${accuracyValidation.threshold}% (user-defined: ${settings.accuracyTrigger?.min ?? "not set, using default 75%"})`,
      );

      if (!accuracyValidation.allowed) {
        skipReason = accuracyValidation.reason || "ACCURACY_VALIDATION_FAILED";
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = "SKIPPED";
        logger.info(
          {
            uid,
            symbol: researchResult?.symbol || "UNKNOWN",
            accuracy,
            threshold: accuracyValidation.threshold,
            reason: skipReason,
          },
          "⛔ [RESEARCH_CYCLE] BLOCKED: Accuracy validation failed",
        );
        await logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult?.symbol || "UNKNOWN",
          accuracy,
          threshold: accuracyValidation.threshold,
          signal,
          exchangeStatus: "available",
        });
        // CRITICAL: Save SKIPPED history for accuracy validation failure
        if (!skipHistoryStorage && researchExecuted) {
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            researchResult.price || 0,
            decisionStatus,
            null, // executionStatus
            null, // tradeId
          );
        }
        return researchResult;
      }

      // Consolidated signal validation
      const signalValidation = validateTradeSignal(signal);
      if (!signalValidation.valid) {
        skipReason = signalValidation.reason || AUTO_TRADE_REASONS.NO_SIGNAL;
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = "SKIPPED";
        await logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult?.symbol || "UNKNOWN",
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: "available",
        });
        // CRITICAL: Save SKIPPED history for signal validation failure
        if (!skipHistoryStorage && researchExecuted) {
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            researchResult.price || 0,
            decisionStatus,
            null, // executionStatus
            null, // tradeId
          );
        }
        return researchResult;
      }

      // 7. Dynamic Parameters & Volatility Check (Requirement P4)
      // CRITICAL: Uses user's accuracyRiskConfig (single source of truth)
      const volClassification =
        researchResult.result?.analysis?.volatility?.classification || "low";

      // Calculate news score for sentiment adjustment
      const newsArticles = researchResult.result?.news || [];
      const newsScore = calculateNewsScoreFromArticles(newsArticles);

      const params = await calculateDynamicParams(
        uid,
        accuracy,
        volClassification,
        newsScore,
      );

      if (params.skip) {
        skipReason = params.skip;
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = "SKIPPED";
        await logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult?.symbol || "UNKNOWN",
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: "available",
          additionalDetails: {
            volatility: volClassification,
            newsScore,
          },
        });
        // CRITICAL: Save SKIPPED history for dynamic params failure
        // Every execution path must save history before returning
        if (!skipHistoryStorage && researchExecuted) {
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            researchResult.price || 0,
            decisionStatus,
            null, // executionStatus
            null, // tradeId
          );
        }
        return researchResult;
      }

      // 8. Deterministic SL/TP (Requirement P5)
      const engine = await this.getUserEngine(uid);
      const currentPrice = await getCurrentMarketPrice(
        researchResult?.symbol || "UNKNOWN",
        uid,
        engine.adapter,
      );
      const atr = researchResult.result?.analysis?.volatility?.atr || 0;
      const sr = {
        supportLevel: researchResult.result?.analysis?.structure?.support,
        resistanceLevel: researchResult.result?.analysis?.structure?.resistance,
      };

      // DETECT SCALPING MODE from Trading Settings
      let isScalping = false;
      try {
        const tradingSettings = await firestoreAdapter.getTradingSettings(uid);
        isScalping = tradingSettings?.tradeType === "Scalping";
      } catch (e) {
        logger.warn(
          { uid, error: e.message },
          "Failed to fetch trading settings, defaulting to non-scalping",
        );
      }

      const sltp = calculateSLTP(
        signal as "BUY" | "SELL",
        currentPrice,
        accuracy,
        atr,
        sr,
        isScalping,
      );

      // 9. Create & Execute Trade Signal
      const tradeSignal: TradeSignal = {
        symbol: researchResult.symbol,
        signal: signal as "BUY" | "SELL",
        entryPrice: currentPrice,
        accuracy: accuracy,
        stopLoss: sltp.stopLoss,
        takeProfit: sltp.takeProfit,
        takeProfit1: isScalping ? sltp.takeProfit1 : undefined,
        takeProfit2: isScalping ? sltp.takeProfit2 : undefined,
        takeProfit3: isScalping ? sltp.takeProfit3 : undefined,
        leverage: params.leverage,
        reasoning: `Accuracy ${accuracy.toFixed(1)}% | Model Size ${params.sizePct}% | Leverage ${params.leverage}x${isScalping ? " | SCALPING" : ""}`,
        requestId: `auto_${uid}_${Date.now()}`,
        timestamp: new Date(),
        highImpactNewsDetected:
          researchResult.result?.analysis?.news?.highImpact,
        newsEvent: researchResult.result?.analysis?.news?.event,
      };

      // Attach researchResult for unified decision logic
      (tradeSignal as any).researchResult = researchResult;

      // News check (SIMPLIFIED: Only block high-impact news, normal news does NOT block)
      const newsDetected = !!researchResult.result?.analysis?.news?.highImpact;
      if (newsDetected) {
        tradeSignal.highImpactNewsDetected = true;
        tradeSignal.newsEvent = researchResult.result?.analysis?.news?.event;
        // CRITICAL: High-impact news blocks trade (safety measure)
        // Normal news does NOT block trades (removed deep sentiment penalties)
        logger.info(
          {
            uid,
            symbol: researchResult.symbol,
            highImpactNews: true,
            newsEvent: researchResult.result?.analysis?.news?.event,
          },
          "⚠️ [NEWS_BLOCK] High-impact news detected - trade will be blocked for safety",
        );
      }

      // STEP 3: TRADE EXECUTION
      // Accuracy Gate (75%) and System Checks passed above.

      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          accuracy,
          step: "EXECUTION",
        },
        "🚀 [EXECUTION_ORDER] Proceeding to Trade Execution",
      );

      // CRITICAL: Load config fresh before execution to ensure latest state
      const freshConfig = await this.loadConfig(uid);

      // CRITICAL: Check if execution is blocked by earlier failures (e.g. Exchange Decryption)
      if (executionBlocked) {
        skipReason = executionBlockReason || "EXECUTION_BLOCKED";
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = "SKIPPED";

        logger.warn(
          {
            uid,
            symbol: researchResult.symbol,
            reason: executionBlockReason,
            step: "PRE_EXECUTION_GUARD",
            exchangeStatus: "unavailable",
            executionBlocked: true,
          },
          `⛔ [EXECUTION_BLOCKED] Trade execution blocked - ${executionBlockReason}. Research completed, but trade execution skipped.`,
        );

        await logAutoTradeSkip(uid, "EXECUTION_BLOCKED", {
          symbol: researchResult.symbol,
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: "unavailable",
          additionalDetails: {
            reason: executionBlockReason,
          },
        });

        // CRITICAL: Save SKIPPED history for execution blocked
        // Every execution path must save history before returning
        if (!skipHistoryStorage && researchExecuted) {
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            researchResult.price || 0,
            decisionStatus,
            null, // executionStatus
            null, // tradeId
          );
        }
        return researchResult;
      }

      // CRITICAL: Race Condition Guard - Consolidated mode validation
      const modeCheck = validateTradingMode(
        freshConfig,
        "runAutoTradeResearchCycle",
      );
      if (!modeCheck.allowed) {
        skipReason =
          modeCheck.reason || "MODE_VALIDATION_FAILED_DURING_RESEARCH";
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = "SKIPPED";

        logger.warn(
          {
            uid,
            symbol: researchResult.symbol,
            reason: modeCheck.reason,
            step: "PRE_EXECUTION_GUARD",
          },
          "⛔ [RACE_CONDITION_PREVENTED] Mode validation failed during research cycle - aborting execution",
        );

        await logAutoTradeSkip(
          uid,
          modeCheck.reason || "MODE_VALIDATION_FAILED",
          {
            symbol: researchResult.symbol,
            accuracy,
            signal,
            exchangeStatus: "available",
            additionalDetails: {
              reason: modeCheck.reason,
            },
          },
        );

        // CRITICAL: Save SKIPPED history for mode validation failure
        if (!skipHistoryStorage && researchExecuted) {
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            researchResult.price || 0,
            decisionStatus,
            null, // executionStatus
            null, // tradeId
          );
        }
        return researchResult;
      }

      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          signal,
          accuracy,
          autoTradeEnabled: freshConfig.autoTradeEnabled,
          manualOverride: freshConfig.manualOverride,
          configSource: "fresh-load-before-execution",
        },
        "🔍 [RESEARCH_CYCLE] Loading fresh config before executeTrade call",
      );

      // 🔍 [CHECKPOINT] Pre-execution validation and logging
      // Calculate Risk-Reward ratio
      const riskAmount = Math.abs(
        tradeSignal.entryPrice - tradeSignal.stopLoss,
      );
      const rewardAmount =
        tradeSignal.signal === "BUY"
          ? tradeSignal.takeProfit - tradeSignal.entryPrice
          : tradeSignal.entryPrice - tradeSignal.takeProfit;
      const rr = riskAmount > 0 ? rewardAmount / riskAmount : 0;

      // Validate TP is logical vs SL
      let tpValid = true;
      let tpValidationError = "";
      if (tradeSignal.signal === "BUY") {
        if (tradeSignal.takeProfit <= tradeSignal.entryPrice) {
          tpValid = false;
          tpValidationError = `TP (${tradeSignal.takeProfit}) must be > entry (${tradeSignal.entryPrice}) for BUY`;
        } else if (tradeSignal.stopLoss >= tradeSignal.entryPrice) {
          tpValid = false;
          tpValidationError = `SL (${tradeSignal.stopLoss}) must be < entry (${tradeSignal.entryPrice}) for BUY`;
        }
      } else {
        // SELL
        if (tradeSignal.takeProfit >= tradeSignal.entryPrice) {
          tpValid = false;
          tpValidationError = `TP (${tradeSignal.takeProfit}) must be < entry (${tradeSignal.entryPrice}) for SELL`;
        } else if (tradeSignal.stopLoss <= tradeSignal.entryPrice) {
          tpValid = false;
          tpValidationError = `SL (${tradeSignal.stopLoss}) must be > entry (${tradeSignal.entryPrice}) for SELL`;
        }
      }

      // Validate RR >= 1.2 (minimum for 2-5 trades/day)
      if (rr > 0 && rr < 1.2) {
        const reason = "LOW_RR_PRE_EXECUTION";
        logger.error(
          {
            uid,
            symbol: researchResult.symbol,
            step: "PRE_EXECUTION_VALIDATION_FAILED",
            reason,
            calculatedRR: rr.toFixed(2),
            minimumRR: 1.2,
            entryPrice: tradeSignal.entryPrice,
            stopLoss: tradeSignal.stopLoss,
            takeProfit: tradeSignal.takeProfit,
            riskAmount,
            rewardAmount,
          },
          `❌ [PRE_EXECUTION_VALIDATION] BLOCKED: ${reason} - RR ${rr.toFixed(2)} < 1.2 minimum`,
        );

        await logAutoTradeSkip(uid, reason, {
          symbol: researchResult.symbol,
          accuracy: tradeSignal.accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal: tradeSignal.signal,
          exchangeStatus: "available",
          additionalDetails: {
            calculatedRR: rr,
            minimumRR: 1.2,
            entryPrice: tradeSignal.entryPrice,
            stopLoss: tradeSignal.stopLoss,
            takeProfit: tradeSignal.takeProfit,
          },
        });

        throw new Error(
          `${reason}: Risk-Reward ratio ${rr.toFixed(2)} < 1.2 minimum - trade blocked`,
        );
      }

      // Validate TP logic
      if (!tpValid) {
        const reason = "INVALID_TP_LOGIC";
        logger.error(
          {
            uid,
            symbol: researchResult.symbol,
            step: "PRE_EXECUTION_VALIDATION_FAILED",
            reason,
            tpValidationError,
            signal: tradeSignal.signal,
            entryPrice: tradeSignal.entryPrice,
            stopLoss: tradeSignal.stopLoss,
            takeProfit: tradeSignal.takeProfit,
          },
          `❌ [PRE_EXECUTION_VALIDATION] BLOCKED: ${reason} - ${tpValidationError}`,
        );

        await logAutoTradeSkip(uid, reason, {
          symbol: researchResult.symbol,
          accuracy: tradeSignal.accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal: tradeSignal.signal,
          exchangeStatus: "available",
          additionalDetails: {
            tpValidationError,
            entryPrice: tradeSignal.entryPrice,
            stopLoss: tradeSignal.stopLoss,
            takeProfit: tradeSignal.takeProfit,
          },
        });

        throw new Error(`${reason}: ${tpValidationError}`);
      }

      // Get accuracy slab info for logging (will be recalculated in executeTrade, but log what we have)
      const accuracySlabInfo = params.matchedRange
        ? `${params.matchedRange.minAccuracy}-${params.matchedRange.maxAccuracy ?? "∞"}%`
        : "N/A";

      // 🔍 [CHECKPOINT] Log all trade parameters before execution
      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          step: "PRE_EXECUTION_CHECKPOINT",
          signal: tradeSignal.signal,
          entryPrice: tradeSignal.entryPrice,
          stopLoss: tradeSignal.stopLoss,
          takeProfit: tradeSignal.takeProfit,
          takeProfit1: tradeSignal.takeProfit1,
          takeProfit2: tradeSignal.takeProfit2,
          takeProfit3: tradeSignal.takeProfit3,
          riskRewardRatio: rr.toFixed(2),
          riskAmount: riskAmount.toFixed(8),
          rewardAmount: rewardAmount.toFixed(8),
          accuracy: tradeSignal.accuracy,
          leverage: tradeSignal.leverage,
          accuracySlab: accuracySlabInfo,
          hasResearchResult: !!(tradeSignal as any).researchResult,
          top25Verified: true,
          timestamp: new Date().toISOString(),
        },
        "✅ [PRE_EXECUTION_CHECKPOINT] All validations passed - entryPrice, SL, TP, RR logged [TOP_25_VERIFIED]",
      );

      const execution = await this.executeTrade(uid, tradeSignal);

      // 🔍 [DEBUG] executeTrade returned
      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          step: "EXECUTE_TRADE_RETURNED",
          executionStatus: execution.status,
          tradeId: execution.tradeId,
        },
        "🔍 [DEBUG_TRACE] executeTrade returned successfully",
      );

      cycleResult =
        execution.status === "PENDING"
          ? AUTO_TRADE_REASONS.PENDING_CONFIRMATION
          : AUTO_TRADE_REASONS.TRADE_EXECUTED;
      decisionStatus = "EXECUTED";
      tradeId = execution.tradeId || null;

      logger.info(
        {
          uid,
          symbol: researchResult.symbol,
          signal,
          accuracy,
          result: cycleResult,
          executionStatus: execution.status,
          tradeId: execution.tradeId,
        },
        "✅ [CYCLE_COMPLETE] Trade cycle successful",
      );

      // CRITICAL: Save history ONLY if research actually executed
      // Do NOT save fake history when research never ran
      if (!skipHistoryStorage && researchExecuted) {
        try {
          // Extract execution status from execution result
          const executionStatus = execution.status; // 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PANIC_CLOSED'

          // Save complete history entry with execution status
          await saveAutoTradeHistoryWithExecutionStatus(
            uid,
            researchResult,
            researchData,
            researchSymbol,
            finalResult,
            finalTradePlan,
            accuracy,
            signal,
            historyPrice,
            decisionStatus, // 'EXECUTED' - determined by execution outcome
            executionStatus,
            execution.tradeId || null,
          );
          logger.info(
            {
              uid,
              symbol: researchResult.symbol,
              executionStatus,
              decisionStatus,
            },
            "✅ [HISTORY] Auto-trade history saved with final execution status",
          );
        } catch (histError: any) {
          logger.error(
            { uid, error: histError.message },
            "❌ [HISTORY] Failed to save auto-trade history after execution",
          );
        }
      }

      return researchResult;
    } catch (error: any) {
      cycleResult = AUTO_TRADE_REASONS.TRADE_FAILED;
      skipReason = error.message;

      logger.error(
        { uid, error: error.message, stack: error.stack },
        "❌ [CYCLE_FAILED] Trade cycle failed",
      );

      // CRITICAL: Save ERROR history for failed cycles
      // Every execution path must save history before returning
      if (!skipHistoryStorage) {
        try {
          await saveAutoTradeHistorySkipped(
            uid,
            "TRADE_EXECUTION_FAILED",
            `Trade cycle failed: ${error.message}`,
          );
          logger.info(
            { uid },
            "✅ [HISTORY] ERROR history saved for failed trade cycle",
          );
        } catch (histError: any) {
          logger.error(
            { uid, error: histError.message },
            "❌ [HISTORY] Failed to save ERROR history for failed cycle",
          );
        }
      }

      if (
        Object.values(AUTO_TRADE_REASONS).includes(
          skipReason as AutoTradeReason,
        )
      ) {
        // Skip reason is already standardized
      } else {
        await firestoreAdapter.logActivity(uid, "TRADE_FAILED", {
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }

      // CRITICAL: Return null on error (research attempted but failed)
      // Scheduler will still update lastRunAt to track the attempt
      const cycleEndTime = Date.now();
      logger.info(
        {
          uid,
          cycleId: `cycle_${cycleStartTimestamp}`,
          duration: cycleEndTime - cycleStartTimestamp,
          result: "ERROR",
          error: error.message,
        },
        "❌ [AUTO_TRADE_CYCLE] Cycle FAILED",
      );
      return null;
    }

    // Log successful cycle completion
    const cycleEndTime = Date.now();
    logger.info(
      {
        uid,
        cycleId: `cycle_${cycleStartTimestamp}`,
        duration: cycleEndTime - cycleStartTimestamp,
        result: researchExecuted ? "EXECUTED" : "SKIPPED",
        historySaved: !skipHistoryStorage && researchExecuted,
      },
      "✅ [AUTO_TRADE_CYCLE] Cycle COMPLETED",
    );
  }

  /**
   * Save pending trade for user confirmation
   */
  private async savePendingTrade(
    uid: string,
    tradeData: {
      requestId: string;
      symbol: string;
      side: "BUY" | "SELL";
      quantity: number;
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      takeProfit1?: number;
      takeProfit2?: number;
      takeProfit3?: number;
      accuracy: number;
      researchRequestId?: string;
      createdAt: Date;
      expiresAt: Date;
    },
  ): Promise<void> {
    await firestoreAdapter.savePendingTrade(uid, tradeData);
  }

  /**
   * Execute an approved pending trade
   */
  async executeApprovedPendingTrade(
    uid: string,
    requestId: string,
  ): Promise<TradeExecution> {
    try {
      // Get pending trade
      const pendingTrades = await firestoreAdapter.getPendingTrades(uid);
      const pendingTrade = pendingTrades.find(
        (t) => t.id === requestId || t.requestId === requestId,
      );

      if (!pendingTrade) {
        // Double check Firestore for expired trades to give better error

        throw new Error(
          "Pending trade not found or expired. Please re-run research.",
        );
      }

      if (pendingTrade.status !== "PENDING") {
        throw new Error(`Trade already ${pendingTrade.status}`);
      }

      // Create trade signal from pending trade
      const signal: TradeSignal = {
        symbol: pendingTrade.symbol,
        signal: pendingTrade.side,
        entryPrice: pendingTrade.entryPrice,
        stopLoss: pendingTrade.stopLoss,
        takeProfit: pendingTrade.takeProfit,
        takeProfit1: (pendingTrade as any).takeProfit1,
        takeProfit2: (pendingTrade as any).takeProfit2,
        takeProfit3: (pendingTrade as any).takeProfit3,
        accuracy: pendingTrade.accuracy,
        reasoning: pendingTrade.reasoning || "Auto-generated trade signal",
        timestamp: new Date(),
        requestId: pendingTrade.requestId || requestId,
      };

      try {
        // Execute the trade (passing true to skip confirmation check)
        const execution = await this.executeTrade(uid, signal, true);

        // Mark pending trade as approved
        await firestoreAdapter.updatePendingTradeStatus(
          uid,
          requestId,
          "APPROVED",
        );

        logger.info(
          { uid, requestId, symbol: signal.symbol },
          "Approved pending trade executed",
        );
        return execution;
      } catch (error: any) {
        logger.error(
          { uid, requestId, error: error.message },
          "Failed to execute approved pending trade",
        );
        throw error;
      }
    } catch (error: any) {
      logger.error(
        { uid, requestId, error: error.message },
        "Failed to execute approved pending trade",
      );
      throw error;
    }
  }

  /**
   * Reject a pending trade
   */
  async rejectPendingTrade(uid: string, requestId: string): Promise<void> {
    await firestoreAdapter.updatePendingTradeStatus(uid, requestId, "REJECTED");
    await this.logTradeEvent(uid, "TRADE_REJECTED", {
      requestId,
      reason: "User rejected pending trade",
    });
    logger.info({ uid, requestId }, "Pending trade rejected by user");
  }

  /**
   * Handle settings change (e.g. frequency update)
   * CRITICAL: Now delegates to BackgroundResearchScheduler (single source of truth)
   * This method is kept for backward compatibility but scheduler handles the actual update
   */
  async onUserSettingsChanged(uid: string): Promise<void> {
    // CRITICAL: Scheduler is the single source of truth for scheduling
    // Just trigger scheduler update - it will handle mode detection and interval management
    try {
      const { backgroundResearchScheduler } =
        await import("./backgroundResearchScheduler");
      await backgroundResearchScheduler.onUserSettingsChanged(uid);
      logger.info(
        { uid },
        "🔄 [AUTOTRADE] Settings changed, scheduler notified",
      );
    } catch (error: any) {
      logger.warn(
        { uid, error: error.message },
        "Failed to notify scheduler of settings change",
      );
      // Fallback: Try to restart loop (for backward compatibility)
      try {
        await this.startAutoTradeLoop(uid);
      } catch (fallbackError: any) {
        logger.error(
          { uid, error: fallbackError.message },
          "Failed to restart auto-trade loop",
        );
      }
    }
  }
}

export const autoTradeEngine = new AutoTradeEngine();
