import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';
import { BinanceAdapter } from './binanceAdapter';
import { decrypt } from './keyManager';
import { getFirebaseAdmin } from '../utils/firebase';
import { userNotificationService } from './userNotificationService';
import * as admin from 'firebase-admin';
import {
  safeSetInterval,
  shouldRunBackgroundTasks,
  withTimeout,
  yieldToEventLoop,
  safeExternalCall,
  runBackgroundTask
} from '../utils/safeBackgroundRunner';
import type { FreeModeDeepResearchResult, TradePlan } from './researchTypes';

// Accuracy-based Risk Configuration (Single Source of Truth)
export interface AccuracyRiskConfigItem {
  minAccuracy: number; // Minimum accuracy for this range (inclusive)
  maxAccuracy: number | null; // Maximum accuracy for this range (inclusive, null = no upper limit)
  tradeSizePct: number; // Trade size as % of wallet balance (0-10) - percentage of total account equity, NOT margin-based or fixed amount
  leverage: number; // Leverage multiplier (1-10) - hard cap is 10x, default for ≥90% is 9x
}

// Trading Settings Interface
export interface TradingSettings {
  coinSelectionMode: 'manual' | 'top100' | 'top10';
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
  tradeType: 'Scalping' | 'Swing' | 'Position';
  positionSizingMap: {
    '0-84': number;
    '85-89': number;
    '90-94': number;
    '95-99': number;
    '100': number;
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
interface ResearchDataResult {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  result: FreeModeDeepResearchResult;
  processingTimeMs: number;
  metadata?: {
    symbol: string;
    [key: string]: unknown;
  };
}

interface ResearchData {
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
  mode: 'AUTO' | 'MANUAL';
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
  signal: 'BUY' | 'SELL';
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
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PANIC_CLOSED';
  orderId?: string;
  fillPrice?: number;
  pnl?: number;
  timestamp: Date;
  mode: 'AUTO' | 'MANUAL';
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
}
const DEFAULT_CONFIG: AutoTradeConfig = {
  autoTradeEnabled: false,
  perTradeRiskPct: 1, // 1% of equity per trade
  maxConcurrentTrades: 3,
  maxDailyLossPct: 5, // 5% max daily loss
  stopLossPct: 1.5, // 1.5% stop loss
  takeProfitPct: 3, // 3% take profit
  manualOverride: false,
  mode: 'MANUAL', // Start in manual mode for safety
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
  ACCURACY_TOO_LOW: 'ACCURACY_TOO_LOW',
  HOLD_SIGNAL: 'HOLD_SIGNAL',
  NO_SIGNAL: 'NO_SIGNAL',
  DAILY_LOSS_LIMIT: 'DAILY_LOSS_LIMIT',
  DAILY_TRADES_LIMIT: 'DAILY_TRADES_LIMIT',
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
  NEWS_BLOCK: 'NEWS_BLOCK',
  EXTREME_VOLATILITY: 'EXTREME_VOLATILITY',
  HIGH_VOLATILITY_SKIP: 'HIGH_VOLATILITY_SKIP',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  MIN_NOTIONAL: 'MIN_NOTIONAL',
  NO_RESEARCH_KEYS: 'NO_RESEARCH_KEYS',
  RISK_REJECTION: 'RISK_REJECTION',
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
  PENDING_CONFIRMATION: 'PENDING_CONFIRMATION',
  TRADE_EXECUTED: 'TRADE_EXECUTED',
  TRADE_FAILED: 'TRADE_FAILED',
  TRADE_SKIPPED: 'TRADE_SKIPPED',
  NO_CONNECTED_EXCHANGE: 'NO_CONNECTED_EXCHANGE',
  AUTO_TRADE_SKIPPED_LOW_ACCURACY: 'AUTO_TRADE_SKIPPED_LOW_ACCURACY',
  SYSTEM_RISK_FAILURE: 'SYSTEM_RISK_FAILURE',
  SKIPPED_EXCHANGE_UNAVAILABLE: 'SKIPPED_EXCHANGE_UNAVAILABLE',
} as const;

export type AutoTradeReason = typeof AUTO_TRADE_REASONS[keyof typeof AUTO_TRADE_REASONS];

// Strict mode enum
export type AutoTradeMode = 'AUTO' | 'MANUAL';

// Strict status enum
export type TradeExecutionStatus = 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'PANIC_CLOSED';

// Strict signal enum
export type TradeSignalType = 'BUY' | 'SELL' | 'HOLD';

// Strict volatility state enum
export type VolatilityState = 'OK' | 'HIGH' | 'EXTREME';

/**
 * Centralized Accuracy Guard
 * Single source of truth for accuracy validation and normalization
 * Ensures accuracy is always in 0-100 range and validates against threshold
 */
export class AccuracyGuard {
  /**
   * Normalize and validate accuracy value
   * @param accuracy - Accuracy value (may be 0-1 decimal or 0-100 percentage)
   * @returns Validation result with normalized accuracy (0-100 scale)
   */
  static validateAndNormalize(accuracy: number): AccuracyValidationResult {
    // Normalize to 0-100 scale
    let normalized: number;
    if (accuracy <= 1 && accuracy >= 0) {
      normalized = accuracy * 100;
    } else if (accuracy > 1 && accuracy <= 100) {
      normalized = accuracy;
    } else {
      // Invalid range - clamp to valid bounds
      normalized = Math.max(0, Math.min(100, accuracy));
      logger.warn({
        originalAccuracy: accuracy,
        clampedAccuracy: normalized
      }, '⚠️ [ACCURACY_GUARD] Accuracy value out of range, clamped to 0-100');
    }

    // Sanity check: ensure normalized is in valid range
    if (normalized < 0 || normalized > 100 || isNaN(normalized) || !isFinite(normalized)) {
      return {
        isValid: false,
        normalizedAccuracy: 0,
        reason: `Invalid accuracy value: ${accuracy} (normalized: ${normalized})`
      };
    }

    return {
      isValid: true,
      normalizedAccuracy: normalized
    };
  }

  /**
   * Check if accuracy meets execution threshold
   * @param accuracy - Accuracy value (will be normalized)
   * @param threshold - Minimum threshold (0-100)
   * @param isManualApproval - If true, uses 60% threshold, otherwise uses provided threshold
   * @returns true if accuracy >= threshold
   */
  static meetsThreshold(
    accuracy: number,
    threshold: number,
    isManualApproval: boolean = false
  ): boolean {
    const validation = this.validateAndNormalize(accuracy);
    if (!validation.isValid) {
      return false;
    }

    const effectiveThreshold = isManualApproval ? 60 : threshold;
    return validation.normalizedAccuracy >= effectiveThreshold;
  }

  /**
   * Get normalized accuracy with safety checks
   * @param accuracy - Accuracy value
   * @returns Normalized accuracy (0-100) or 0 if invalid
   */
  static getNormalized(accuracy: number): number {
    const validation = this.validateAndNormalize(accuracy);
    return validation.isValid ? validation.normalizedAccuracy : 0;
  }
}

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
  volatilityState: 'OK' | 'HIGH' | 'EXTREME';
  entryZoneValid: boolean;
  isFinal: boolean;
}

export function makeUnifiedTradeDecision(
  signal: TradeSignalType,
  accuracy: number,
  isFinal: boolean,
  tradePlan: { entryPrice?: number; stopLoss?: number; takeProfit?: number; riskRewardRatio?: number } | null,
  indicators: { vwap?: { deviation?: number }; atr?: { classification?: string; atrPercentile?: number }; supportResistance?: { majorSupport?: number; majorResistance?: number } } | null,
  threshold: number = 75
): UnifiedTradeDecision {
  // 1. Use centralized accuracy guard for normalization and validation
  const accuracyValidation = AccuracyGuard.validateAndNormalize(accuracy);
  if (!accuracyValidation.isValid) {
    return {
      allowed: false,
      reason: `INVALID_ACCURACY: ${accuracyValidation.reason || 'Invalid accuracy value'}`,
      accuracyUsed: 0,
      rr: 0,
      volatilityState: 'OK',
      entryZoneValid: false,
      isFinal: false
    };
  }
  const accuracyPercent = accuracyValidation.normalizedAccuracy;

  // 2. FINAL research enforcement
  if (!isFinal) {
    return {
      allowed: false,
      reason: 'NOT_FINAL: Research result is not final',
      accuracyUsed: accuracyPercent,
      rr: 0,
      volatilityState: 'OK',
      entryZoneValid: false,
      isFinal: false
    };
  }

  // 3. HOLD signal check
  if (signal === 'HOLD') {
    return {
      allowed: false,
      reason: 'HOLD_SIGNAL: Signal is HOLD',
      accuracyUsed: accuracyPercent,
      rr: 0,
      volatilityState: 'OK',
      entryZoneValid: false,
      isFinal: true
    };
  }

  // 4. Accuracy threshold check
  if (accuracyPercent < threshold) {
    return {
      allowed: false,
      reason: `ACCURACY_TOO_LOW: ${accuracyPercent.toFixed(1)}% < ${threshold}% threshold`,
      accuracyUsed: accuracyPercent,
      rr: 0,
      volatilityState: 'OK',
      entryZoneValid: false,
      isFinal: true
    };
  }

  // 5. Entry zone validation: BUY near resistance → BLOCK, SELL near support → BLOCK
  let entryZoneValid = true;
  const vwapDeviation = indicators?.vwap?.deviation || 0;
  if (signal === 'BUY' && vwapDeviation > 2) {
    entryZoneValid = false;
  } else if (signal === 'SELL' && vwapDeviation < -2) {
    entryZoneValid = false;
  }

  // Also check support/resistance levels if available
  if (tradePlan?.entryPrice) {
    const entryPrice = tradePlan.entryPrice;
    const majorResistance = indicators?.supportResistance?.majorResistance;
    const majorSupport = indicators?.supportResistance?.majorSupport;

    if (signal === 'BUY' && majorResistance && entryPrice > 0) {
      const distanceToResistance = ((majorResistance - entryPrice) / entryPrice) * 100;
      if (distanceToResistance < 2) { // Within 2% of resistance
        entryZoneValid = false;
      }
    } else if (signal === 'SELL' && majorSupport && entryPrice > 0) {
      const distanceToSupport = ((entryPrice - majorSupport) / entryPrice) * 100;
      if (distanceToSupport < 2) { // Within 2% of support
        entryZoneValid = false;
      }
    }
  }

  if (!entryZoneValid) {
    return {
      allowed: false,
      reason: signal === 'BUY' ? 'ENTRY_ZONE_INVALID: BUY near resistance' : 'ENTRY_ZONE_INVALID: SELL near support',
      accuracyUsed: accuracyPercent,
      rr: tradePlan?.riskRewardRatio || 0,
      volatilityState: 'OK',
      entryZoneValid: false,
      isFinal: true
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
      volatilityState: 'OK',
      entryZoneValid: true,
      isFinal: true
    };
  }

  // 7. Volatility (ATR) guard
  const atrClassification = indicators?.atr?.classification;
  const atrPercentile = indicators?.atr?.atrPercentile;
  let volatilityState: VolatilityState = 'OK';

  // Check ATR classification
  if (atrClassification === 'high') {
    volatilityState = 'HIGH';
  }

  // Check ATR percentile if available (0-1 range, convert to percentage)
  if (typeof atrPercentile === 'number') {
    const atrPercent = atrPercentile > 1 ? atrPercentile : atrPercentile * 100;
    if (atrPercent >= 95) {
      volatilityState = 'EXTREME';
    } else if (atrPercent >= 85) {
      volatilityState = 'HIGH';
    }
  }

  // Block if extreme volatility
  if (volatilityState === 'EXTREME') {
    return {
      allowed: false,
      reason: 'EXTREME_VOLATILITY: ATR percentile >= 95%',
      accuracyUsed: accuracyPercent,
      rr,
      volatilityState: 'EXTREME',
      entryZoneValid: true,
      isFinal: true
    };
  }

  // All checks passed
  return {
    allowed: true,
    accuracyUsed: accuracyPercent,
    rr,
    volatilityState,
    entryZoneValid: true,
    isFinal: true
  };
}


interface ResearchData {
  results: ResearchDataResult[];
  coinsAnalyzed: string[];
}

// Helper function to run deep research with coin selection based on trading settings
// REFACTORED: Now uses UNIFIED selectBestCoinByAccuracy logic (only 1 best coin)
async function runDeepResearchWithCoinSelection(
  uid: string,
  settings: TradingSettings,
  providerConfigs: ProviderConfigs,
  integrations: IntegrationResult
): Promise<ResearchData> {
  const coinsAnalyzed: string[] = [];
  const results: ResearchDataResult[] = [];

  // STATS: Increment Auto Trade Runs
  try {
    const { firestoreAdapter } = await import('./firestoreAdapter');
    firestoreAdapter.incrementUserStat(uid, 'autoTradeRuns', 1, {
      lastActivity: {
        type: 'Auto Trade',
        timestamp: new Date().toISOString(),
        symbol: 'BATCH_SCAN'
      }
    });
  } catch (err) {
    logger.error({ uid, error: err }, 'Failed to update stats for Auto Trade');
  }

  // CRITICAL: Use the unified selectBestCoinByAccuracy logic
  // This ensures rotation, cooldowns, and TOP 100 scan (not just BTC)
  const { selectBestCoinByAccuracy } = await import('./researchModes');

  // Exclude nothing for start, selectBestCoinByAccuracy handles internal cooldowns
  const selectionResult = await selectBestCoinByAccuracy(uid, []);

  if (!selectionResult) {
    logger.warn({ uid }, 'Auto-trade selection: No suitable coin found by accuracy scan');
    return { results: [], coinsAnalyzed: [] };
  }

  const { symbol, accuracy: estimatedAccuracy } = selectionResult;
  coinsAnalyzed.push(symbol);

  // CRITICAL: Verify symbol is in Top 25 before proceeding
  // CRITICAL FIX: Safe call to isSymbolInTop10 - use static helper to avoid undefined crash
  // Default to PASS (allow research) if any error occurs - never crash research
  let isTop25 = true; // Default to PASS - only block if check succeeds and returns false
  try {
    const { getTop100Coins } = await import('./researchModes');
    const top25 = await getTop100Coins(uid, 25);
    const normalizedSymbol = symbol.toUpperCase();
    isTop25 = top25.some(coin => coin.symbol === normalizedSymbol);
  } catch (error: any) {
    logger.error({ uid, symbol, error: error.message }, '❌ [TOP_25_ERROR] Error checking if symbol is in top 25 - defaulting to PASS');
    // On error, be safe and allow (don't block research) - default to PASS
    isTop25 = true;
  }
  if (!isTop25) {
    logger.error({
      uid,
      symbol,
      stack: new Error().stack
    }, '❌ [TOP_25_VIOLATION] Selected coin outside Top 25 - blocking research');
    return { results: [], coinsAnalyzed: [] };
  }

  // Run deep research for ONLY the selected best coin
  try {
    logger.info({ uid, symbol, estimatedAccuracy, top25Verified: true }, '✅ [TOP_25_RESEARCH] Running deep research for selected best coin (Top 25 verified)');
    const { runFreeModeDeepResearch } = await import('./deepResearchEngine');
    const startTime = Date.now();

    // Execute research with background mode (parallel providers internally)
    const result = await runFreeModeDeepResearch(uid, symbol, providerConfigs, integrations, true);
    const processingTimeMs = Date.now() - startTime;

    if (result) {
      // CRITICAL: Ensure result structure includes tradePlan for signal propagation
      // result is FreeModeDeepResearchResult which has tradePlan at root level
      results.push({
        symbol,
        signal: result.signal as 'BUY' | 'SELL' | 'HOLD',
        accuracy: result.accuracy,
        result, // Contains full FreeModeDeepResearchResult with tradePlan
        processingTimeMs,
        metadata: {
          symbol,
          ...(result.metadata || {})
        }
      });

      // Log signal/tradePlan consistency for verification
      const resultSignal: TradeSignalType = (result.signal === 'HOLD' ? 'HOLD' : (result.signal === 'BUY' ? 'BUY' : 'SELL')) as TradeSignalType;
      if (resultSignal === 'HOLD' || (result.accuracy < 0.60 && result.accuracy > 0)) {
        logger.info({ uid, symbol, signal: result.signal, accuracy: result.accuracy, hasTradePlan: !!result.tradePlan },
          '[RESEARCH_RESULT] HOLD or low accuracy → tradePlan should be null');
      } else if ((resultSignal === 'BUY' || resultSignal === 'SELL') && result.accuracy >= 0.60) {
        logger.info({
          uid, symbol, signal: result.signal, accuracy: result.accuracy, hasTradePlan: !!result.tradePlan,
          hasEntry: !!result.tradePlan?.entryPrice, hasSL: !!result.tradePlan?.stopLoss,
          hasTP1: !!result.tradePlan?.takeProfit1, hasTP2: !!result.tradePlan?.takeProfit2, hasTP3: !!result.tradePlan?.takeProfit3
        },
          '[RESEARCH_RESULT] BUY/SELL with accuracy >= 60% → tradePlan should exist with Entry/SL/TP1/TP2/TP3');
      }
      logger.info({ uid, symbol, signal: result.signal, accuracy: result.accuracy }, 'Deep research completed for selected best coin');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ uid, symbol, error: errorMessage }, 'Research failed for selected coin - not adding result');
    // CRITICAL: Do NOT add accuracy=0 result when research fails
    // Research must actually run and produce valid accuracy to be included in results
    // Empty results array indicates research did not execute successfully
  }

  return {
    results,
    coinsAnalyzed
  };
}


export class AutoTradeEngine {
  private userEngines: Map<string, {
    config: AutoTradeConfig;
    adapter: BinanceAdapter | null;
    activeTrades: Map<string, TradeExecution>;
    circuitBreaker: boolean;
    lastEquityCheck: Date;
  }> = new Map();

  // Auto-trade background loop tracking
  private autoTradeLoops: Map<string, {
    intervalId: NodeJS.Timeout | null;
    isRunning: boolean;
    lastResearchTime: Date | null;
    researchInProgress: boolean;
  }> = new Map();

  // Guard to prevent infinite recursion and redundant default config creation
  private static configCreatedOnce: Set<string> = new Set();

  /**
   * Calculate simplified news score for sentiment-aware trading
   */
  private calculateNewsScoreFromArticles(news: Array<{ sentiment?: number; impact?: string;[key: string]: unknown }>): number {
    if (!news || news.length === 0) return 50;

    let totalSentiment = 0;
    let count = 0;

    for (const item of news) {
      let val = 0;
      if (typeof item.sentiment === 'number') val = item.sentiment;
      else if (item.sentiment === 'positive' || item.sentiment === 'buy') val = 1;
      else if (item.sentiment === 'negative' || item.sentiment === 'sell') val = -1;
      totalSentiment += val;
      count++;
    }

    const avg = count > 0 ? totalSentiment / count : 0;
    return 50 + (avg * 50); // 0 to 100
  }

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
  private async calculateDynamicParams(uid: string, accuracy: number, volatilityClassification: string, newsScore: number): Promise<{
    sizePct: number,
    leverage: number,
    skip?: string,
    matchedRange?: AccuracyRiskConfigItem
  }> {
    // Use centralized accuracy guard for normalization
    const accuracyValidation = AccuracyGuard.validateAndNormalize(accuracy);
    if (!accuracyValidation.isValid) {
      logger.error({ uid, accuracy, reason: accuracyValidation.reason }, '❌ [ACCURACY_GUARD] Invalid accuracy value in calculateDynamicParams');
      return { sizePct: 0, leverage: 1, skip: 'INVALID_ACCURACY' };
    }
    const acc = accuracyValidation.normalizedAccuracy;

    // Get user's trading settings (includes accuracyRiskConfig)
    const settings = await AutoTradeEngine.getTradingSettings(uid);
    let config = settings.accuracyRiskConfig || [];
    let usingFallback = false;
    let fallbackReason = '';

    // CRITICAL: Execution-time fallback guard - validate config structure
    // If config is missing, invalid, partially invalid, or non-continuous, fallback to defaults
    if (!Array.isArray(config) || config.length === 0) {
      config = AutoTradeEngine.getDefaultAccuracyRiskConfig();
      usingFallback = true;
      fallbackReason = 'Config missing or empty';
      logger.warn({ uid, reason: fallbackReason }, '⚠️ [ACCURACY_RISK_CONFIG] Falling back to system defaults - config missing or empty');
    } else {
      // Validate each item structure
      const invalidItems = config.filter((item: AccuracyRiskConfigItem) =>
        typeof item.minAccuracy !== 'number' ||
        (item.maxAccuracy !== null && typeof item.maxAccuracy !== 'number') ||
        typeof item.tradeSizePct !== 'number' ||
        typeof item.leverage !== 'number' ||
        item.minAccuracy < 0 || item.minAccuracy > 100 ||
        item.tradeSizePct < 0 || item.tradeSizePct > 10 ||
        item.leverage < 1 || item.leverage > 10
      );

      if (invalidItems.length > 0) {
        config = AutoTradeEngine.getDefaultAccuracyRiskConfig();
        usingFallback = true;
        fallbackReason = 'Config contains invalid items';
        logger.warn({ uid, reason: fallbackReason, invalidCount: invalidItems.length }, '⚠️ [ACCURACY_RISK_CONFIG] Falling back to system defaults - config contains invalid items');
      } else {
        // Validate continuity (ranges must be continuous and non-overlapping)
        const sorted = [...config].sort((a, b) => a.minAccuracy - b.minAccuracy);
        let isContinuous = true;

        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          const prevMax = prev.maxAccuracy ?? 100;
          if (curr.minAccuracy !== prevMax + 1 && curr.minAccuracy !== prevMax) {
            isContinuous = false;
            break;
          }
        }

        // Last range should cover up to 100%
        const last = sorted[sorted.length - 1];
        if (last && last.maxAccuracy !== null && last.maxAccuracy < 100) {
          isContinuous = false;
        }

        if (!isContinuous) {
          config = AutoTradeEngine.getDefaultAccuracyRiskConfig();
          usingFallback = true;
          fallbackReason = 'Config ranges are not continuous or do not cover up to 100%';
          logger.warn({ uid, reason: fallbackReason }, '⚠️ [ACCURACY_RISK_CONFIG] Falling back to system defaults - ranges not continuous');
        }
      }
    }

    // Determine minimum accuracy threshold from user's config (lowest minAccuracy in config)
    const minConfigAccuracy = config.length > 0 ? Math.min(...config.map(r => r.minAccuracy)) : 75;

    // Log user-selected accuracy slabs and minimum threshold
    logger.info({
      uid,
      accuracy: acc,
      userAccuracySlabs: config.map(r => `${r.minAccuracy}-${r.maxAccuracy ?? '∞'}%: ${r.tradeSizePct}% size, ${r.leverage}x leverage`),
      minimumConfigAccuracy: minConfigAccuracy,
      usingFallback
    }, `[ACCURACY_RISK_CONFIG] User config: ${config.length} slabs, minimum threshold: ${minConfigAccuracy}%`);

    // Default: no trade if accuracy < minimum configured threshold
    let params = { sizePct: 0, leverage: 1 };
    let matchedRange: AccuracyRiskConfigItem | undefined = undefined;

    // Find matching accuracy range from config (user config or fallback defaults)
    for (const range of config) {
      const minMatch = acc >= range.minAccuracy;
      const maxMatch = range.maxAccuracy === null || acc <= range.maxAccuracy;

      if (minMatch && maxMatch) {
        // CRITICAL: Trade size % is calculated as percentage of wallet balance (not margin-based or fixed amount)
        // sizePct represents the percentage of total account equity to allocate to this trade
        params = {
          sizePct: Math.min(10, Math.max(0, range.tradeSizePct)), // Hard cap at 10% of wallet balance
          leverage: Math.min(10, Math.max(1, range.leverage)) // Hard cap at 10x
        };
        matchedRange = range;
        logger.info({
          uid,
          accuracy: acc,
          matchedRange: `${range.minAccuracy}-${range.maxAccuracy ?? '∞'}%`,
          userSelectedSizePct: range.tradeSizePct,
          userSelectedLeverage: range.leverage,
          finalSizePct: params.sizePct,
          finalLeverage: params.leverage,
          usingFallback,
          fallbackReason: usingFallback ? fallbackReason : undefined
        }, usingFallback
          ? '✅ [ACCURACY_RISK_CONFIG] Matched accuracy range from system defaults (user config invalid)'
          : '✅ [ACCURACY_RISK_CONFIG] Matched accuracy range from user config');
        break;
      }
    }

    // If no match found and accuracy < minimum configured threshold, skip trade
    if (!matchedRange && acc < minConfigAccuracy) {
      logger.info({
        uid,
        accuracy: acc,
        minimumConfigAccuracy: minConfigAccuracy
      }, `⏭️ [ACCURACY_RISK_CONFIG] Accuracy ${acc.toFixed(1)}% below minimum configured threshold (${minConfigAccuracy}%) - skipping trade`);
      return { sizePct: 0, leverage: 1, skip: 'ACCURACY_BELOW_MINIMUM' };
    }

    // If no match found but accuracy >= minimum, use lowest configured range as fallback
    if (!matchedRange && acc >= minConfigAccuracy && config.length > 0) {
      const lowestRange = config[0];
      params = {
        sizePct: Math.min(10, Math.max(0, lowestRange.tradeSizePct)),
        leverage: Math.min(10, Math.max(1, lowestRange.leverage))
      };
      matchedRange = lowestRange;
      logger.warn({
        uid,
        accuracy: acc,
        fallbackRange: `${lowestRange.minAccuracy}-${lowestRange.maxAccuracy ?? '∞'}%`,
        sizePct: params.sizePct,
        leverage: params.leverage,
        usingFallback,
        fallbackReason: usingFallback ? fallbackReason : 'No exact match found'
      }, '⚠️ [ACCURACY_RISK_CONFIG] No exact match found, using lowest configured range as fallback');
    }

    // Defensive log if params computed without valid user config
    if (usingFallback) {
      logger.info({
        uid,
        accuracy: acc,
        matchedRange: matchedRange ? `${matchedRange.minAccuracy}-${matchedRange.maxAccuracy ?? '∞'}%` : 'none',
        sizePct: params.sizePct,
        leverage: params.leverage,
        fallbackReason
      }, '🔍 [ACCURACY_RISK_CONFIG] Computed params using system defaults due to invalid user config');
    }

    // 3. Volatility Adjustment Rules (Safety Rules)
    // HIGH -> reduce leverage by 2x and trade size by 25%
    if (volatilityClassification === 'high') {
      params.leverage = Math.max(1, params.leverage - 2);
      params.sizePct = params.sizePct * 0.75;
      logger.info({ uid, acc, volatilityClassification, originalParams: params }, 'Volatility HIGH: Reduced leverage and size');
    }
    // EXTREME -> skip trade completely
    else if (volatilityClassification === 'extreme') {
      return { sizePct: 0, leverage: 1, skip: AUTO_TRADE_REASONS.EXTREME_VOLATILITY };
    }

    // 4. SIMPLIFIED News Logic (for 2-5 trades/day)
    // CRITICAL: Only high-impact news blocks trades (handled in trade signal check)
    // Normal news sentiment does NOT block trades - removed deep sentiment penalties
    // News score can still adjust position size slightly, but does NOT skip trades
    if (newsScore < 30) {
      params.sizePct = params.sizePct * 0.9; // Slight reduction (10%) for negative news, but trade still executes
      logger.info({ uid, acc, newsScore, adjustedSize: params.sizePct }, 'Negative news detected: Slight size reduction (trade NOT blocked)');
    }

    return { ...params, matchedRange };
  }

  /**
   * P5: Deterministic SL/TP Logic
   */
  private calculateSLTP(
    side: 'BUY' | 'SELL',
    price: number,
    accuracy: number,
    atr: number,
    sr: { supportLevel?: number, resistanceLevel?: number },
    isScalping: boolean = false
  ): { stopLoss: number, takeProfit: number, takeProfit1?: number, takeProfit2?: number, takeProfit3?: number } {
    // Ensure accuracy is 0-100 scale
    const acc = accuracy > 1 ? accuracy : accuracy * 100;

    // SCALPING RULES - STRICT ENFORCEMENT
    if (isScalping) {
      const SL_MAX_DISTANCE_PCT = 0.01; // 1% HARD CAP - NEVER exceed
      const SL_DEFAULT_DISTANCE_PCT = 0.005; // 0.5% default
      const SL_MIN_DISTANCE_PCT = 0.003; // 0.3% minimum
      const SL_MAX_DISTANCE_PCT_ATR = 0.008; // 0.8% maximum (ATR-based)
      const TP1_DISTANCE_PCT = 0.008; // 0.8%
      const TP2_DISTANCE_PCT = 0.015; // 1.5%
      const TP3_DISTANCE_PCT = 0.022; // 2.2%

      let stopLoss = 0;
      let takeProfit1 = 0;
      let takeProfit2 = 0;
      let takeProfit3 = 0;

      if (side === 'BUY') {
        // SCALPING SL: Ignore support/resistance, ignore wide ATR
        // Use ATR if available but clamp strictly
        const atrDistance = atr > 0 ? (atr / price) : 0;
        // Clamp SL distance: 0.3% - 0.8% range, default 0.5%
        const slDistance = Math.max(SL_MIN_DISTANCE_PCT, Math.min(SL_MAX_DISTANCE_PCT_ATR, atrDistance || SL_DEFAULT_DISTANCE_PCT));
        stopLoss = price * (1 - slDistance);

        // HARD CAP: NEVER exceed 1% under any condition
        if (price - stopLoss > price * SL_MAX_DISTANCE_PCT) {
          stopLoss = price * (1 - SL_MAX_DISTANCE_PCT);
          logger.warn({ price, calculatedSL: price * (1 - slDistance), clampedSL: stopLoss }, 'SCALPING SL clamped to 1% hard cap');
        }

        // TP levels
        takeProfit1 = price * (1 + TP1_DISTANCE_PCT);
        takeProfit2 = price * (1 + TP2_DISTANCE_PCT);
        takeProfit3 = price * (1 + TP3_DISTANCE_PCT);

        logger.info({
          entry: price,
          sl: stopLoss,
          slDistance: ((price - stopLoss) / price * 100).toFixed(3) + '%',
          tp1: takeProfit1,
          tp2: takeProfit2,
          tp3: takeProfit3
        }, '[SCALPING_PLAN] BUY - Strict scalping SL/TP calculated');
      } else {
        // SELL side
        const atrDistance = atr > 0 ? (atr / price) : 0;
        const slDistance = Math.max(SL_MIN_DISTANCE_PCT, Math.min(SL_MAX_DISTANCE_PCT_ATR, atrDistance || SL_DEFAULT_DISTANCE_PCT));
        stopLoss = price * (1 + slDistance);

        // HARD CAP: NEVER exceed 1%
        if (stopLoss - price > price * SL_MAX_DISTANCE_PCT) {
          stopLoss = price * (1 + SL_MAX_DISTANCE_PCT);
          logger.warn({ price, calculatedSL: price * (1 + slDistance), clampedSL: stopLoss }, 'SCALPING SL clamped to 1% hard cap');
        }

        // TP levels
        takeProfit1 = price * (1 - TP1_DISTANCE_PCT);
        takeProfit2 = price * (1 - TP2_DISTANCE_PCT);
        takeProfit3 = price * (1 - TP3_DISTANCE_PCT);

        logger.info({
          entry: price,
          sl: stopLoss,
          slDistance: ((stopLoss - price) / price * 100).toFixed(3) + '%',
          tp1: takeProfit1,
          tp2: takeProfit2,
          tp3: takeProfit3
        }, '[SCALPING_PLAN] SELL - Strict scalping SL/TP calculated');
      }

      return {
        stopLoss,
        takeProfit: takeProfit2, // Default to TP2 for backward compatibility
        takeProfit1,
        takeProfit2,
        takeProfit3
      };
    }

    // NON-SCALPING: Original logic (swing/position trading)
    // Determine Target RR based on accuracy (Requirement: min RR 1:2)
    let targetRR = 2.0;
    if (acc >= 85) targetRR = 3.0;
    else if (acc >= 80) targetRR = 2.5;

    let stopLoss = 0;
    let takeProfit = 0;

    if (side === 'BUY') {
      const atrSL = price - (2.5 * atr);
      const fixedSL = price * 0.985;
      if (sr.supportLevel && sr.supportLevel < price && sr.supportLevel > price * 0.90) {
        stopLoss = sr.supportLevel;
      } else if (atr > 0 && atrSL < price) {
        stopLoss = atrSL;
      } else {
        stopLoss = fixedSL;
      }
      const riskAmount = price - stopLoss;
      takeProfit = price + (riskAmount * targetRR);
    } else {
      const atrSL = price + (2.5 * atr);
      const fixedSL = price * 1.015;
      if (sr.resistanceLevel && sr.resistanceLevel > price && sr.resistanceLevel < price * 1.10) {
        stopLoss = sr.resistanceLevel;
      } else if (atr > 0 && atrSL > price) {
        stopLoss = atrSL;
      } else {
        stopLoss = fixedSL;
      }
      const riskAmount = stopLoss - price;
      takeProfit = price - (riskAmount * targetRR);
    }
    return { stopLoss, takeProfit }; // Non-scalping: no TP1/TP2/TP3
  }

  /**
   * Load user configuration from Firestore
   */
  async loadConfig(uid: string): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();
      const configDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();

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
      console.log('[AUTO_TRADE_ENGINE_LOAD_CONFIG_DIAGNOSTIC] Document does not exist, initializing default config:', { uid });

      // CRITICAL: Block infinite recursion if we already tried creating this session
      if (AutoTradeEngine.configCreatedOnce.has(uid)) {
        console.warn('[AUTO_TRADE_ENGINE_LOAD_CONFIG_DIAGNOSTIC] Default config already created once this session, returning memory default to prevent loop:', { uid });
        return DEFAULT_CONFIG;
      }

      // Mark as created BEFORE write to ensure re-entry is blocked even if write is in progress
      AutoTradeEngine.configCreatedOnce.add(uid);

      // CRITICAL FIX: Direct write to Firestore to prevent infinite recursion loop
      // We set the default config directly with merge:false to ensure a clean slate, then return it.
      try {
        await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').set(DEFAULT_CONFIG, { merge: false });
        console.log('[AUTO_TRADE_CONFIG_CREATED_ONCE] Created default auto-trade configuration for user:', uid);
        logger.info({ uid }, 'Created default auto-trade configuration');
      } catch (saveErr: any) {
        logger.warn({ uid, error: saveErr.message }, 'Failed to save default config (possible race condition), utilizing default in-memory');
      }

      return DEFAULT_CONFIG;
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error loading auto-trade config');
      // On error, return default but DO NOT attempt to write (could be a permission issue causing a loop)
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save user configuration to Firestore
   */
  async saveConfig(uid: string, config: Partial<AutoTradeConfig>): Promise<AutoTradeConfig> {
    try {
      const db = getFirebaseAdmin().firestore();

      // [DIAGNOSTIC] Log incoming config to save
      console.log('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Input config:', {
        uid,
        inputConfig: config,
        autoTradeEnabledInInput: config.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof config.autoTradeEnabled,
      });

      const currentConfig = await this.loadConfig(uid);

      // [DIAGNOSTIC] Log current config before merge
      console.log('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Current config before merge:', {
        uid,
        currentAutoTradeEnabled: currentConfig.autoTradeEnabled,
        typeofCurrentAutoTradeEnabled: typeof currentConfig.autoTradeEnabled,
      });

      const updatedConfig = { ...currentConfig, ...config, lastRun: new Date() };

      // [DIAGNOSTIC] Log updated config after merge
      console.log('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Updated config after merge:', {
        uid,
        updatedAutoTradeEnabled: updatedConfig.autoTradeEnabled,
        typeofUpdatedAutoTradeEnabled: typeof updatedConfig.autoTradeEnabled,
      });

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
        maxTradesPerDay: updatedConfig.maxTradesPerDay || DEFAULT_CONFIG.maxTradesPerDay,
        cooldownSeconds: updatedConfig.cooldownSeconds || DEFAULT_CONFIG.cooldownSeconds,
        panicStopEnabled: updatedConfig.panicStopEnabled || DEFAULT_CONFIG.panicStopEnabled,
        slippageBlocker: updatedConfig.slippageBlocker || DEFAULT_CONFIG.slippageBlocker,
        stats: updatedConfig.stats || DEFAULT_CONFIG.stats,
        lastRun: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      };



      // Only include equitySnapshot if it's defined (not undefined)
      if (updatedConfig.equitySnapshot !== undefined && updatedConfig.equitySnapshot !== null) {
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
      const configDocRef = db.collection('users').doc(uid).collection('autoTradeConfig').doc('current');
      const existingConfigDoc = await configDocRef.get();
      const existingConfig = existingConfigDoc.exists ? (existingConfigDoc.data() || {}) : {};

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
      console.log('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Document to write to Firestore:', {
        uid,
        path: `users/${uid}/autoTradeConfig/current`,
        autoTradeEnabled: finalSanitized.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof finalSanitized.autoTradeEnabled,
        hasEquitySnapshot: 'equitySnapshot' in finalSanitized,
      });

      // CRITICAL: Runtime Guard Check using central adapter
      firestoreAdapter.guardAgainstIllegalWrites(`users/${uid}/autoTradeConfig/current`, finalSanitized);

      await configDocRef.set(finalSanitized, { merge: true });

      // [DIAGNOSTIC] Verify write by reading back
      const verifyDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();
      const verifyData = verifyDoc.data();
      console.log('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Verification read after write:', {
        uid,
        autoTradeEnabled: verifyData?.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof verifyData?.autoTradeEnabled,
      });

      logger.info({ uid, config: configDoc }, 'Auto-trade config saved to Firestore');

      // Update in-memory config
      const engine = await this.getUserEngine(uid);
      engine.config = updatedConfig as AutoTradeConfig;

      // [DIAGNOSTIC] Log final return value
      console.log('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Returning config:', {
        uid,
        autoTradeEnabled: updatedConfig.autoTradeEnabled,
        typeofAutoTradeEnabled: typeof updatedConfig.autoTradeEnabled,
      });

      return updatedConfig as AutoTradeConfig;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error saving auto-trade config');
      console.error('[AUTO_TRADE_ENGINE_SAVE_CONFIG_DIAGNOSTIC] Error:', {
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
      const { resolveExchangeConnector } = await import('./exchangeResolver');
      const resolved = await resolveExchangeConnector(uid);

      if (!resolved) {
        logger.warn({ uid }, 'No exchange API credentials found for auto-trade');
        return null;
      }

      const { connector, exchange } = resolved;

      // Validate connector has required methods
      if (!connector || typeof connector.placeOrder !== 'function') {
        logger.error({ uid, exchange }, 'Exchange connector missing required methods');
        return null;
      }

      // For Binance, optionally validate API key permissions
      if (exchange === 'binance' && typeof connector.validateApiKey === 'function') {
        try {
          const validation = await connector.validateApiKey();
          if (!validation.valid || !validation.canTrade) {
            logger.error({ uid, exchange }, 'API key validation failed - insufficient permissions');
            return null;
          }
        } catch (valError: any) {
          logger.warn({ uid, exchange, error: valError.message }, 'API key validation error, continuing anyway');
        }
      }

      const engine = await this.getUserEngine(uid);
      engine.adapter = connector;

      logger.info({ uid, exchange }, 'Auto-trade adapter initialized successfully');
      return connector;
    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack, uid }, 'Error initializing adapter');
      return null;
    }
  }



  /**
   * Check risk guards before placing order
   */
  /**
   * CRITICAL: Validate symbol is in top 25 high-liquidity non-stablecoins by market cap
   * System is restricted to top 25 coins (single source of truth)
   * Function name kept for compatibility but checks Top 25
   */
  private async isSymbolInTop10(uid: string, symbol: string): Promise<boolean> {
    try {
      const { getTop100Coins } = await import('./researchModes');
      const top25 = await getTop100Coins(uid, 25);
      const normalizedSymbol = symbol.toUpperCase();
      const isInTop25 = top25.some(coin => coin.symbol === normalizedSymbol);

      if (!isInTop25) {
        logger.error({
          uid,
          symbol: normalizedSymbol,
          top25Symbols: top25.map(c => c.symbol),
          stack: new Error().stack
        }, '❌ [TOP_25_VIOLATION] Symbol outside Top 25 detected in auto-trade engine');
      }

      return isInTop25;
    } catch (error: any) {
      logger.error({ uid, symbol, error: error.message, stack: error.stack }, '❌ [TOP_25_ERROR] Error checking if symbol is in top 25');
      // On error, be safe and block (don't allow non-top-25 coins)
      return false;
    }
  }

  async checkRiskGuards(uid: string, signal: TradeSignal, isManualApproval: boolean = false): Promise<{ allowed: boolean; reason?: string }> {
    // CRITICAL: Ensure engine and config exist before proceeding
    const engine = await this.getUserEngine(uid);
    if (!engine) {
      logger.error({ uid }, 'Risk guard check failed - engine is undefined');
      return { allowed: false, reason: 'Engine initialization failed' };
    }
    const config = engine.config;
    if (!config) {
      logger.error({ uid }, 'Risk guard check failed - config is undefined');
      return { allowed: false, reason: 'Config initialization failed' };
    }

    // CRITICAL DIAGNOSTIC: Log config state at guard entry
    logger.info({
      uid,
      symbol: signal.symbol,
      accuracy: signal.accuracy,
      isManualApproval,
      autoTradeEnabled: config.autoTradeEnabled,
      manualOverride: config.manualOverride,
      circuitBreaker: engine.circuitBreaker,
      activeTradesCount: engine.activeTrades.size,
      maxConcurrentTrades: config.maxConcurrentTrades,
      cooldownUntil: config.cooldownUntil,
      configSource: 'in-memory'
    }, '🔍 [RISK_GUARDS] Starting risk guard checks');

    // CRITICAL: TOP 25 COIN RESTRICTION - Block non-top-25 coins immediately (single source of truth)
    // CRITICAL FIX: Safe call to isSymbolInTop10 - ensure method exists before calling
    // Default to PASS (allow research) if any error occurs - never crash research
    let isTop25 = true; // Default to PASS - only block if check succeeds and returns false
    try {
      if (this && typeof this.isSymbolInTop10 === 'function') {
        isTop25 = await this.isSymbolInTop10(uid, signal.symbol);
      } else {
        // Fallback: use direct helper if method not available
        try {
          const { getTop100Coins } = await import('./researchModes');
          const top25 = await getTop100Coins(uid, 25);
          const normalizedSymbol = signal.symbol.toUpperCase();
          isTop25 = top25.some(coin => coin.symbol === normalizedSymbol);
        } catch (fallbackError: any) {
          logger.error({ uid, symbol: signal.symbol, error: fallbackError.message }, '❌ [TOP_25_ERROR] Fallback helper failed - defaulting to PASS');
          isTop25 = true; // Default to PASS on fallback error
        }
      }
    } catch (error: any) {
      logger.error({ uid, symbol: signal.symbol, error: error.message }, '❌ [TOP_25_ERROR] Error checking if symbol is in top 25 - defaulting to PASS');
      // On error, be safe and allow (don't block research) - default to PASS
      isTop25 = true;
    }
    if (!isTop25) {
      logger.error({
        uid,
        symbol: signal.symbol,
        stack: new Error().stack
      }, '❌ [TOP_25_BLOCK] Trade blocked - symbol not in top 25 high-liquidity non-stablecoins by market cap');
      return {
        allowed: false,
        reason: `NOT_TOP_25: ${signal.symbol} is not in top 25 high-liquidity non-stablecoins by market cap - system restricted to top 25 only`
      };
    }

    // FETCH TRADING SETTINGS FOR ENFORCEMENT
    const settings = await AutoTradeEngine.getTradingSettings(uid);

    // 0. SYSTEM RISK CHECKS (Shared Logic)
    const systemCheck = await this.checkSystemRisk(uid, isManualApproval, settings, signal.symbol);
    if (!systemCheck.allowed) {
      return systemCheck;
    }

    // MANDATORY RISK GUARDS - Trade/Signal Specific Checks

    // 1. Unified trade decision (GLOBAL validation)
    // Extract indicators and trade plan from signal or research result
    const researchResult = (signal as any).researchResult;
    const finalResult = researchResult?.result;
    const indicators = finalResult?.indicators || finalResult?.analysis?.technicalIndicators || {};

    // Build trade plan from signal or final result
    let tradePlan: { entryPrice?: number; stopLoss?: number; takeProfit?: number; riskRewardRatio?: number } | null = null;
    if (signal.entryPrice && signal.stopLoss && signal.takeProfit) {
      // Calculate RR from signal
      const risk = Math.abs(signal.entryPrice - signal.stopLoss);
      const reward = Math.abs(signal.takeProfit - signal.entryPrice);
      const rr = risk > 0 ? reward / risk : 0;
      tradePlan = {
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: rr
      };
    } else if (finalResult?.tradePlan) {
      tradePlan = finalResult.tradePlan;
    }

    // CRITICAL: Use user-defined accuracy trigger, NOT hardcoded 75%
    // For manual approval, use 60% (safety for manual trades)
    // For auto-trade, use user's accuracyTrigger.min from settings
    const threshold = isManualApproval ? 60 : (settings.accuracyTrigger?.min ?? 75);

    // Log user-selected vs execution-time threshold
    logger.info({
      uid,
      symbol: signal.symbol,
      userAccuracyTrigger: settings.accuracyTrigger,
      executionThreshold: threshold,
      isManualApproval,
      usingUserSetting: !isManualApproval && settings.accuracyTrigger?.min !== undefined
    }, `[ACCURACY_TRIGGER] Using threshold: ${threshold}% (user-defined: ${settings.accuracyTrigger?.min ?? 'not set, using default 75%'})`);
    const isFinal = finalResult?.isFinal !== false; // Default to true if not specified (assume final for execution)
    const unifiedDecision = makeUnifiedTradeDecision(
      signal.signal,
      signal.accuracy,
      isFinal,
      tradePlan,
      indicators,
      threshold
    );

    // [TRADE_DECISION] Unified log with Top 25 verification
    logger.info({
      uid,
      symbol: signal.symbol,
      FINAL: unifiedDecision.isFinal,
      acc: unifiedDecision.accuracyUsed.toFixed(1),
      rr: unifiedDecision.rr.toFixed(2),
      atr: unifiedDecision.volatilityState,
      entryZone: unifiedDecision.entryZoneValid ? 'OK' : 'INVALID',
      decision: unifiedDecision.allowed ? 'ALLOWED' : 'BLOCKED',
      reason: unifiedDecision.reason,
      top25Verified: true,
      timestamp: new Date().toISOString()
    }, `[TRADE_DECISION] FINAL=${unifiedDecision.isFinal} acc=${unifiedDecision.accuracyUsed.toFixed(1)} rr=${unifiedDecision.rr.toFixed(2)} atr=${unifiedDecision.volatilityState} → ${unifiedDecision.allowed ? 'ALLOWED' : 'BLOCKED'}${unifiedDecision.reason ? ` (${unifiedDecision.reason})` : ''} [TOP_25_VERIFIED]`);

    if (!unifiedDecision.allowed) {
      const reason = unifiedDecision.reason || 'Trade blocked by unified decision logic';
      // Log skip with full context
      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: unifiedDecision.accuracyUsed,
        threshold,
        signal: signal.signal,
        additionalDetails: {
          rr: unifiedDecision.rr,
          volatilityState: unifiedDecision.volatilityState,
          entryZoneValid: unifiedDecision.entryZoneValid,
          isFinal: unifiedDecision.isFinal,
        }
      });
      return { allowed: false, reason };
    }

    // 🔍 [DEBUG] Unified decision PASSED - tracing execution path
    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'UNIFIED_DECISION_PASSED',
      tradePlanExists: !!tradePlan,
      tradePlanSL: tradePlan?.stopLoss,
      tradePlanTP: (tradePlan as TradePlan | null)?.takeProfit2 || (tradePlan as TradePlan | null)?.takeProfit1 || tradePlan?.takeProfit, // Support both TradePlan (takeProfit1/2/3) and legacy (takeProfit)
      tradePlanRR: tradePlan?.riskRewardRatio,
      entryPrice: tradePlan?.entryPrice || signal.entryPrice
    }, '🔍 [DEBUG_TRACE] Unified decision ALLOWED - proceeding to position checks');

    // 2. Skip if same coin already has an open position
    if (engine.activeTrades.has(signal.symbol)) {
      const reason = `OPEN_POSITION_EXISTS: ${signal.symbol} already has an active trade`;
      logger.info({
        uid,
        symbol: signal.symbol,
        reason: 'OPEN_POSITION_EXISTS'
      }, '⛔ [RISK_GUARDS] BLOCKED: Open position already exists');
      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold,
        signal: signal.signal,
        additionalDetails: {
          activeTradesCount: engine.activeTrades.size,
        }
      });
      return { allowed: false, reason };
    }

    // Check max concurrent trades (KEEP - This is a resource/exchange limit)
    // But maybe allow override if user insists? Exchange limits are real.
    // Let's enforce it but maybe higher limit? No, just enforce.
    if (engine.activeTrades.size >= config.maxConcurrentTrades) {
      // Maybe manual bypasses this too?
      // "ensure manual approvals ALWAYS execute".
      // If I approve, I want it executed.
      if (isManualApproval) {
        logger.info({ uid }, 'MANUAL_APPROVAL_OVERRIDE: Bypassing Max Concurrent Trades');
      } else {
        const reason = `MAX_CONCURRENT_TRADES: ${engine.activeTrades.size} >= ${config.maxConcurrentTrades} limit`;
        logger.info({
          uid,
          symbol: signal.symbol,
          activeTradesCount: engine.activeTrades.size,
          maxConcurrentTrades: config.maxConcurrentTrades,
          reason: 'MAX_CONCURRENT_TRADES'
        }, '⛔ [RISK_GUARDS] BLOCKED: Max concurrent trades reached');
        await this.logAutoTradeSkip(uid, reason, {
          symbol: signal.symbol,
          accuracy: signal.accuracy,
          threshold,
          signal: signal.signal,
          additionalDetails: {
            activeTradesCount: engine.activeTrades.size,
            maxConcurrentTrades: config.maxConcurrentTrades,
          }
        });
        return { allowed: false, reason };
      }
    }

    // Additional safety checks

    // Check if already have position in this symbol (Bypass on manual)
    if (!isManualApproval) {
      for (const trade of engine.activeTrades.values()) {
        if (trade.symbol === signal.symbol && trade.status === 'FILLED') {
          const reason = `OPEN_POSITION_EXISTS: ${signal.symbol} already has an active trade`;
          logger.info({
            uid,
            symbol: signal.symbol,
            existingTradeId: trade.tradeId,
            existingTradeStatus: trade.status,
            reason: 'EXISTING_POSITION'
          }, '⛔ [RISK_GUARDS] BLOCKED: Already have active position in symbol');
          await this.logAutoTradeSkip(uid, reason, {
            symbol: signal.symbol,
            accuracy: signal.accuracy,
            threshold,
            signal: signal.signal,
            additionalDetails: {
              existingTradeId: trade.tradeId,
              existingTradeStatus: trade.status,
            }
          });
          return { allowed: false, reason };
        }
      }
    }

    // [ACCURACY_AUDIT] Log successful guard pass
    logger.info({
      uid,
      symbol: signal.symbol,
      accuracy: signal.accuracy,
      threshold,
      allGuardsPassed: true,
      executionDecision: 'ALLOWED'
    }, '[ACCURACY_AUDIT] Execution gate PASSED - trade will proceed');

    logger.info({
      uid,
      symbol: signal.symbol,
      accuracy: signal.accuracy,
      allGuardsPassed: true
    }, '✅ [RISK_GUARDS] All guards passed - trade allowed');

    // 🔍 [DEBUG] All risk guards PASSED - returning to executeTrade
    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'RISK_GUARDS_PASSED',
      nextStep: 'EXECUTE_TRADE_CONTINUES'
    }, '🔍 [DEBUG_TRACE] Risk guards PASSED - executeTrade will continue');

    return { allowed: true };
  }

  /**
   * Check system-wide risk settings (Daily Loss, Cooldown, Circuit Breaker)
   * Does NOT check signal-specific constraints (Accuracy, Symbol)
   */


  /**
   * Check system-wide risk settings (Daily Loss, Cooldown, Circuit Breaker)
   * Does NOT check signal-specific constraints (Accuracy, Symbol)
   */
  async checkSystemRisk(uid: string, isManualApproval: boolean, settings: TradingSettings, symbol?: string): Promise<{ allowed: boolean; reason?: string }> {
    const engine = await this.getUserEngine(uid);
    const config = engine.config;
    const stats = config.stats || DEFAULT_CONFIG.stats!;
    const equity = config.equitySnapshot || 1000;

    // 1. Check daily loss limit (SAFETY - KEEP)
    // CRITICAL: Use settings.maxDailyLossPct (Default 5%)
    const maxLossPct = settings.maxDailyLossPct || 5;
    const maxDailyLossAmount = equity * (maxLossPct / 100);

    // If daily PnL is negative and exceeds max allowance
    if (stats.dailyPnL < 0 && Math.abs(stats.dailyPnL) >= maxDailyLossAmount) {
      if (!isManualApproval) {
        engine.circuitBreaker = true;
        const reason = `DAILY_LOSS_LIMIT: ${Math.abs(stats.dailyPnL).toFixed(2)} >= ${maxDailyLossAmount.toFixed(2)} (${maxLossPct}% of ${equity})`;
        await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_TRIGGERED', {
          reason: 'Daily loss limit exceeded',
          dailyPnL: stats.dailyPnL,
          maxDailyLoss: maxLossPct,
        });
        await this.logAutoTradeSkip(uid, reason, {
          exchangeStatus: 'available',
          additionalDetails: {
            dailyPnL: stats.dailyPnL,
            maxDailyLossAmount,
            maxDailyLossPct: maxLossPct,
            equity,
            circuitBreaker: true,
          }
        });
        return { allowed: false, reason };
      } else {
        logger.warn({ uid, dailyPnL: stats.dailyPnL }, 'MANUAL_APPROVAL_OVERRIDE: Bypassing Daily Loss Limit');
      }
    }

    // 2. Check max trades per day (BYPASS ON MANUAL)
    if (!isManualApproval && stats.dailyTrades >= settings.maxTradesPerDay) {
      const reason = `MAX_TRADES_PER_DAY: ${stats.dailyTrades} >= ${settings.maxTradesPerDay} limit`;
      logger.info({
        uid,
        dailyTrades: stats.dailyTrades,
        maxTradesPerDay: settings.maxTradesPerDay,
        reason: 'MAX_TRADES_PER_DAY'
      }, '⛔ [RISK_GUARDS] BLOCKED: Max trades per day reached');
      await this.logAutoTradeSkip(uid, reason, {
        exchangeStatus: 'available',
        additionalDetails: {
          dailyTrades: stats.dailyTrades,
          maxTradesPerDay: settings.maxTradesPerDay,
        }
      });
      return { allowed: false, reason };
    }

    // 3. Per-Symbol Cooldown Check (BYPASS ON MANUAL)
    // CRITICAL: Cooldown is now per-symbol, not global - allows trading other symbols
    if (!isManualApproval && symbol) {
      const cooldownSeconds = config.cooldownSeconds || 15; // Default 15 seconds for 2-5 trades/day
      const symbolCooldowns = config.symbolCooldowns || {};
      const symbolCooldownEndStr = symbolCooldowns[symbol];

      if (symbolCooldownEndStr) {
        const cooldownEnd = new Date(symbolCooldownEndStr);
        if (new Date() < cooldownEnd) {
          const reason = `SYMBOL_COOLDOWN_ACTIVE: ${symbol} in cooldown until ${cooldownEnd.toISOString()} (${cooldownSeconds}s per-symbol cooldown)`;
          logger.info({
            uid,
            symbol: symbol,
            cooldownUntil: cooldownEnd.toISOString(),
            now: new Date().toISOString(),
            cooldownSeconds,
            reason: 'SYMBOL_COOLDOWN_ACTIVE'
          }, '⛔ [RISK_GUARDS] BLOCKED: Per-symbol cooldown active (other symbols can still trade)');
          await this.logAutoTradeSkip(uid, reason, {
            symbol: symbol,
            exchangeStatus: 'available',
            additionalDetails: {
              cooldownUntil: cooldownEnd.toISOString(),
              now: new Date().toISOString(),
              cooldownSeconds,
              perSymbolCooldown: true
            }
          });
          return { allowed: false, reason };
        }
      }

      // Also check global cooldown for consecutive losses (keep for safety)
      if (config.cooldownUntil) {
        const globalCooldownEnd = config.cooldownUntil instanceof Date ? config.cooldownUntil : new Date(config.cooldownUntil);
        if (new Date() < globalCooldownEnd) {
          const reason = `GLOBAL_COOLDOWN_ACTIVE: Trading paused until ${globalCooldownEnd.toISOString()} due to consecutive losses`;
          logger.info({
            uid,
            cooldownUntil: globalCooldownEnd.toISOString(),
            now: new Date().toISOString(),
            reason: 'GLOBAL_COOLDOWN_ACTIVE'
          }, '⛔ [RISK_GUARDS] BLOCKED: Global cooldown active (consecutive losses)');
          await this.logAutoTradeSkip(uid, reason, {
            exchangeStatus: 'available',
            additionalDetails: {
              cooldownUntil: globalCooldownEnd.toISOString(),
              now: new Date().toISOString(),
              consecutiveLosses: config.consecutiveLosses,
            }
          });
          return { allowed: false, reason };
        }
      }
    }

    // 4. Check circuit breaker (BYPASS ON MANUAL)
    if (!isManualApproval && engine.circuitBreaker) {
      const reason = 'CIRCUIT_BREAKER_ACTIVE: Daily loss limit exceeded';
      logger.info({
        uid,
        circuitBreaker: engine.circuitBreaker,
        reason: 'CIRCUIT_BREAKER_ACTIVE'
      }, '⛔ [RISK_GUARDS] BLOCKED: Circuit breaker active');
      await this.logAutoTradeSkip(uid, reason, {
        exchangeStatus: 'available',
        additionalDetails: {
          circuitBreaker: engine.circuitBreaker,
          dailyPnL: config.stats?.dailyPnL,
        }
      });
      return { allowed: false, reason };
    }

    // 5. Check manual override (BYPASS ON MANUAL)
    if (!isManualApproval && config.manualOverride) {
      const reason = 'MANUAL_OVERRIDE_ACTIVE: Trading paused by user';
      logger.info({
        uid,
        manualOverride: config.manualOverride,
        reason: 'MANUAL_OVERRIDE_ACTIVE'
      }, '⛔ [RISK_GUARDS] BLOCKED: Manual override active');
      await this.logAutoTradeSkip(uid, reason, {
        exchangeStatus: 'available',
        additionalDetails: {
          manualOverride: config.manualOverride,
        }
      });
      return { allowed: false, reason };
    }

    // 6. Check if auto-trade is enabled (BYPASS ON MANUAL)
    if (!isManualApproval && !config.autoTradeEnabled) {
      const reason = 'AUTO_TRADE_DISABLED: Auto-trading is not enabled';
      logger.warn({
        uid,
        autoTradeEnabled: config.autoTradeEnabled,
        isManualApproval,
        reason: 'AUTO_TRADE_DISABLED'
      }, '⛔ [RISK_GUARDS] BLOCKED: Auto-trade is not enabled in config');
      await this.logAutoTradeSkip(uid, reason, {
        exchangeStatus: 'available',
        additionalDetails: {
          autoTradeEnabled: config.autoTradeEnabled,
        }
      });
      return { allowed: false, reason };
    }

    return { allowed: true };
  }

  /**
   * Execute trade
   */
  async executeTrade(uid: string, signal: TradeSignal, skipConfirmationCheck: boolean = false): Promise<TradeExecution> {
    const requestId = signal.requestId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info({ uid, symbol: signal.symbol, requestId }, 'Starting trade execution');

    // FAIL-SAFE: Load trading settings FIRST and validate all required fields
    let settings: TradingSettings;
    try {
      settings = await AutoTradeEngine.getTradingSettings(uid);
      logger.info({ uid, maxTradesPerDay: settings.maxTradesPerDay }, 'Loaded trading settings for execution (enforcing limit)');

      // Strict validation: Block if ANY required setting is undefined/null
      if (!settings ||
        settings.maxPositionPct === undefined ||
        settings.maxDailyLossPct === undefined ||
        settings.maxTradesPerDay === undefined ||
        !settings.positionSizingMap ||
        typeof settings.positionSizingMap !== 'object') {
        await this.logTradeEvent(uid, 'TRADE_REJECTED', {
          signal,
          reason: 'TRADING_SETTINGS_INVALID: One or more required trading settings are missing or invalid',
        });
        throw new Error('Trading settings validation failed - blocking trade for safety');
      }

      // Validate positionSizingMap structure
      const requiredKeys = ['0-84', '85-89', '90-94', '95-99', '100'];
      const missingKeys = requiredKeys.filter(key => settings.positionSizingMap[key] === undefined);
      if (missingKeys.length > 0) {
        await this.logTradeEvent(uid, 'TRADE_REJECTED', {
          signal,
          reason: `POSITION_SIZING_MAP_INVALID: Missing ranges: ${missingKeys.join(', ')}`,
        });
        throw new Error('Position sizing map validation failed - blocking trade for safety');
      }

    } catch (settingsError: any) {
      logger.error({ uid, error: settingsError.message }, 'CRITICAL: Trading settings load/validation failed');
      // If settings fail to load, stop auto-trade loop for safety
      await this.stopAutoTradeLoop(uid);
      await this.logTradeEvent(uid, 'AUTO_TRADE_STOPPED', {
        reason: 'SETTINGS_LOAD_FAILURE',
        error: settingsError.message,
      });
      throw new Error('Trading settings unavailable - auto-trade stopped for safety');
    }

    // CRITICAL: Determine accuracy threshold from user settings
    // For manual approval (skipConfirmationCheck=true), use 60% (safety)
    // For auto-trade, use user's accuracyTrigger.min from settings
    const accuracyThreshold = skipConfirmationCheck ? 60 : (settings.accuracyTrigger?.min ?? 75);

    logger.info({
      uid,
      symbol: signal.symbol,
      userAccuracyTrigger: settings.accuracyTrigger,
      executionThreshold: accuracyThreshold,
      skipConfirmationCheck,
      usingUserSetting: !skipConfirmationCheck && settings.accuracyTrigger?.min !== undefined
    }, `[EXECUTE_TRADE] Using accuracy threshold: ${accuracyThreshold}% (user-defined: ${settings.accuracyTrigger?.min ?? 'not set, using default 75%'})`);

    // Check if trade confirmation is required
    // CRITICAL: Read EXCLUSIVELY from users/{uid}/settings/current (centralized source)
    try {
      const userSettings = await firestoreAdapter.getSettings(uid);

      const requiresConfirmation = !skipConfirmationCheck && (
        userSettings?.notifications?.tradeConfirmationRequired === true
      );

      // Auto Trade goal: FULLY AUTOMATIC (no manual confirmation)
      // This requirement implies that automated background trades should bypass confirmation.
      // However, we respect the setting above to maintain safety if the user explicitly wants confirm.

      if (requiresConfirmation) {
        // Load config for equity calculation
        const config = await this.loadConfig(uid);
        // Calculate position size for pending trade
        const equity = config.equitySnapshot || 1000;
        // Calculate actual position size
        const positionSizing = AutoTradeEngine.calculatePositionSize(signal.accuracy, settings);
        let finalPositionPercent = Math.min(positionSizing.positionPercent, settings.maxPositionPct);

        // If it would be a 0% position, force 1% for the pending trade so the user can see/approve it
        if (finalPositionPercent <= 0) {
          finalPositionPercent = 1.0;
          logger.info({ uid, symbol: signal.symbol }, 'PENDING_TRADE_SIZE_BOOST: Enforcing minimum 1% for pending trade notification');
        }

        const quantity = (equity * (finalPositionPercent / 100)) / signal.entryPrice;

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
        await this.sendTradeConfirmationNotification(uid, signal);
        await this.logTradeEvent(uid, 'TRADE_CONFIRMATION_REQUIRED', {
          signal,
          requestId,
          message: 'Trade confirmation required - pending trade created, awaiting user approval'
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
          status: 'PENDING',
          timestamp: new Date(),
          mode: 'AUTO'
        };

        return pendingTrade;
      }
    } catch (confirmationError: any) {
      logger.warn({ uid, error: confirmationError.message }, 'Failed to check trade confirmation setting, proceeding with execution');
    }

    // Check for whale alerts if enabled AND auto trade is active
    try {
      const userSettings = await firestoreAdapter.getSettings(uid);
      if (userSettings?.autoTradeEnabled && userSettings?.notifications?.whaleAlerts) {
        await this.checkWhaleAlerts(uid, signal.symbol);
      }
    } catch (whaleError: any) {
      logger.warn({ uid, error: whaleError.message }, 'Failed to check whale alerts');
    }

    // ALWAYS load config fresh from Firestore before execution
    const config = await this.loadConfig(uid);
    const engine = await this.getUserEngine(uid);
    engine.config = config; // Update in-memory config

    // CRITICAL DIAGNOSTIC: Log config state at executeTrade entry
    logger.info({
      uid,
      symbol: signal.symbol,
      accuracy: signal.accuracy,
      autoTradeEnabled: config.autoTradeEnabled,
      manualOverride: config.manualOverride,
      skipConfirmationCheck,
      configSource: 'fresh-load-in-executeTrade',
      configLastRun: config.lastRun?.toISOString()
    }, '🔍 [EXECUTE_TRADE] Starting trade execution with fresh config');

    // Check risk guards (passing skipConfirmationCheck as isManualApproval)
    const riskCheck = await this.checkRiskGuards(uid, signal, skipConfirmationCheck);
    if (!riskCheck.allowed) {
      const reason = riskCheck.reason || 'Trade rejected by risk guards';
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'RISK_GUARDS_BLOCKED',
        reason,
        accuracy: signal.accuracy,
        autoTradeEnabled: config.autoTradeEnabled,
        manualOverride: config.manualOverride
      }, '🔍 [DEBUG_TRACE] BLOCKED at risk guards check');

      // Get user settings for threshold
      const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);
      const userThreshold = skipConfirmationCheck ? 60 : (tradingSettings.accuracyTrigger?.min ?? 75);

      // Note: Skip logging already done in checkRiskGuards, but log here too for executeTrade context
      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: userThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? 'available' : 'unavailable',
        additionalDetails: {
          autoTradeEnabled: config.autoTradeEnabled,
          manualOverride: config.manualOverride,
          skipConfirmationCheck,
          userAccuracyTrigger: tradingSettings.accuracyTrigger,
        }
      });

      await this.logTradeEvent(uid, 'TRADE_REJECTED', {
        signal,
        reason,
      });

      // NOTIFICATION: Telegram Skip Alert
      try {
        const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
        if (bgSettings?.backgroundResearchEnabled && bgSettings?.telegramBotToken && bgSettings?.telegramChatId) {
          const { telegramService } = await import('./telegramService');
          telegramService.sendTradeSkippedAlert(
            bgSettings.telegramBotToken,
            bgSettings.telegramChatId,
            { symbol: signal.symbol, reason, accuracy: signal.accuracy }
          );
        }
      } catch (e) {
        logger.warn({ uid }, 'Failed to send Telegram skip alert');
      }

      throw new Error(reason);
    }

    // 🔍 [DEBUG] Risk guards PASSED - proceeding to adapter initialization
    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'RISK_GUARDS_PASSED_IN_EXECUTE',
      hasAdapter: !!engine.adapter,
      nextStep: 'ADAPTER_INIT_OR_POSITION_SIZING'
    }, '🔍 [DEBUG_TRACE] Risk guards PASSED in executeTrade - proceeding to adapter/position sizing');

    // Note: Redundant accuracy check removed. checkRiskGuards handles the user-defined accuracy trigger (or 60% for manual).

    // Initialize adapter if needed
    if (!engine.adapter) {
      logger.info({
        uid,
        symbol: signal.symbol,
        step: 'ADAPTER_INIT_START'
      }, '🔍 [DEBUG_TRACE] Adapter missing - initializing');

      await this.initializeAdapter(uid);
      if (!engine.adapter) {
        logger.error({
          uid,
          symbol: signal.symbol,
          step: 'ADAPTER_INIT_FAILED'
        }, '🔍 [DEBUG_TRACE] BLOCKED: Adapter initialization failed');
        throw new Error('Failed to initialize exchange adapter');
      }

      logger.info({
        uid,
        symbol: signal.symbol,
        step: 'ADAPTER_INIT_SUCCESS',
        adapterType: engine.adapter?.constructor?.name
      }, '🔍 [DEBUG_TRACE] Adapter initialized successfully');
    } else {
      logger.info({
        uid,
        symbol: signal.symbol,
        step: 'ADAPTER_EXISTS',
        adapterType: engine.adapter?.constructor?.name
      }, '🔍 [DEBUG_TRACE] Adapter already exists');
    }

    // Get current equity
    // CRITICAL: ALWAYS use USDT-M Futures balance - NEVER use spot balance
    // Single source of truth: getFuturesBalance() or futures data from getAccount()
    let equity = config.equitySnapshot || 1000; // Default fallback
    let futuresBalanceFetched = false;

    try {
      // PRIORITY 1: ALWAYS try getFuturesBalance() first if available
      if (engine.adapter && typeof engine.adapter.getFuturesBalance === 'function') {
        try {
          const futuresBalance = await engine.adapter.getFuturesBalance();
          // CRITICAL: Use futures balance even if it's 0 (don't fall back to spot)
          equity = futuresBalance.totalBalance || futuresBalance.availableBalance || 0;
          futuresBalanceFetched = true;
          logger.info({
            uid,
            equity,
            availableBalance: futuresBalance.availableBalance,
            source: 'futures',
            marketType: futuresBalance.marketType
          }, '✅ Equity fetched from USDT-M Futures balance');
          // Update equity snapshot
          await this.saveConfig(uid, { equitySnapshot: equity });
        } catch (futuresErr: any) {
          // CRITICAL: Check if error is due to decryption failure
          if (futuresErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') ||
            futuresErr.message?.includes('empty') ||
            futuresErr.message?.includes('decryption failed')) {
            logger.error({ uid, error: futuresErr.message }, '❌ getFuturesBalance() failed due to decryption error - aborting equity fetch');
            throw futuresErr; // Re-throw to abort execution
          } else {
            logger.warn({ uid, error: futuresErr.message }, '❌ getFuturesBalance() failed');
          }
        }
      }

      // PRIORITY 2: If getFuturesBalance() not available, try getAccount() for futures data
      // CRITICAL: Only check for futures data - NEVER use spot balance
      if (!futuresBalanceFetched && engine.adapter && typeof engine.adapter.getAccount === 'function') {
        const accountInfo = await engine.adapter.getAccount();

        // Check for futures balance in account response
        if (accountInfo.futuresBalances && Array.isArray(accountInfo.futuresBalances)) {
          const usdtBalance = accountInfo.futuresBalances.find((b: any) =>
            b.asset === 'USDT' || b.asset === 'USDT'
          );
          if (usdtBalance) {
            const free = parseFloat(usdtBalance.free || usdtBalance.available || '0');
            const locked = parseFloat(usdtBalance.locked || usdtBalance.frozen || '0');
            equity = free + locked;
            futuresBalanceFetched = true;
            logger.info({ uid, equity, source: 'futures-balances-array' }, '✅ Equity fetched from futures balances array');
          }
        }
        // Check for Bitget futures format in data field
        else if (accountInfo.data && Array.isArray(accountInfo.data)) {
          const usdtAccount = accountInfo.data.find((acc: any) => acc.marginCoin === 'USDT' && acc.productType === 'USDT-FUTURES');
          if (usdtAccount) {
            equity = parseFloat(usdtAccount.equity || usdtAccount.available || '0');
            futuresBalanceFetched = true;
            logger.info({ uid, equity, source: 'futures-data-array' }, '✅ Equity fetched from futures data array');
          }
        }
        // Check for direct equity/available fields (futures balance directly)
        else if (accountInfo.totalEquity !== undefined) {
          // If totalEquity exists (even if 0), assume it's futures balance
          equity = parseFloat(accountInfo.totalEquity.toString());
          futuresBalanceFetched = true;
          logger.info({ uid, equity, source: 'futures-totalEquity' }, '✅ Equity fetched from totalEquity (futures)');
        } else if (accountInfo.equity !== undefined) {
          equity = parseFloat(accountInfo.equity.toString());
          futuresBalanceFetched = true;
          logger.info({ uid, equity, source: 'futures-equity' }, '✅ Equity fetched from equity (futures)');
        }

        // Update equity snapshot if futures balance was found
        if (futuresBalanceFetched) {
          await this.saveConfig(uid, { equitySnapshot: equity });
        }
      }

      // If no futures balance found, use snapshot or default
      if (!futuresBalanceFetched) {
        logger.warn({ uid }, '❌ No USDT-M Futures balance found - using snapshot or default');
        equity = config.equitySnapshot || 1000;
      } else if (equity === 0 || isNaN(equity)) {
        // Even if balance is 0, we fetched it from futures API - that's valid
        logger.info({ uid, equity }, 'Futures balance is 0 - using snapshot as fallback for position sizing');
        equity = config.equitySnapshot || 1000;
      }
    } catch (error: any) {
      logger.warn({ error: error.message, uid }, 'Could not fetch futures balance from exchange, using snapshot');
    }

    // Get trading settings for position sizing
    const tradingSettings = await AutoTradeEngine.getTradingSettings(uid);

    // 🔍 [DEBUG] Starting position sizing calculation
    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'POSITION_SIZING_START',
      equity,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      hasTradePlan: !!(signal as any).researchResult?.result?.tradePlan
    }, '🔍 [DEBUG_TRACE] Starting position sizing calculation');

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
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        stopLoss: signal.stopLoss,
        entryPrice: signal.entryPrice
      }, '🔍 [DEBUG_TRACE] BLOCKED: Stop loss missing or invalid');
      throw new Error(`Invalid stop loss: ${signal.stopLoss}`);
    }

    if (!signal.entryPrice || signal.entryPrice <= 0 || isNaN(signal.entryPrice)) {
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        entryPrice: signal.entryPrice
      }, '🔍 [DEBUG_TRACE] BLOCKED: Entry price missing or invalid');
      throw new Error(`Invalid entry price: ${signal.entryPrice}`);
    }

    // Safety check for SL distance
    if (slDistance <= 0 || isNaN(slDistance)) {
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        slDistance,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss
      }, '🔍 [DEBUG_TRACE] BLOCKED: Invalid SL distance');
      throw new Error(`Invalid SL distance (${slDistance}) for volatility sizing - aborting trade`);
    }

    // SL distance guard: Check if SL too close to entry (minimum tick size check)
    // For most exchanges, minimum tick size is ~0.1% for major pairs
    const minimumTickSize = signal.entryPrice * 0.001; // 0.1% of entry price
    if (slDistance < minimumTickSize) {
      const reason = 'SL_TOO_CLOSE_TO_ENTRY';
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        reason,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        slDistance,
        minimumTickSize,
        slDistancePct: (slDistance / signal.entryPrice * 100).toFixed(4) + '%'
      }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - SL distance (${slDistance.toFixed(8)}) < minimum tick size (${minimumTickSize.toFixed(8)})`);

      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? 'available' : 'unavailable',
        additionalDetails: {
          slDistance,
          minimumTickSize,
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
        }
      });

      await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
        signal,
        reason,
        details: `Stop loss too close to entry price. SL distance: ${slDistance.toFixed(8)}, minimum required: ${minimumTickSize.toFixed(8)}`,
        accuracy: signal.accuracy
      });

      // Final mandatory log
      logger.info({
        uid,
        symbol: signal.symbol,
        acc: signal.accuracy.toFixed(1),
        rr: 0,
        qty: 0,
        minNotional: 10,
        reason
      }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=0.00 qty=0.000000 minNotional=10 → BLOCKED (${reason})`);

      throw new Error(`${reason}: Stop loss is too close to entry price (${slDistance.toFixed(8)} < ${minimumTickSize.toFixed(8)})`);
    }

    // 4. Calculate Raw Quantity based on Risk
    // riskAmount = quantity * slDistance  =>  quantity = riskAmount / slDistance
    let quantity = riskAmount / slDistance;

    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'POSITION_SIZING_CALC',
      riskPct,
      riskAmount,
      slDistance,
      rawQuantity: quantity
    }, '🔍 [DEBUG_TRACE] Raw quantity calculated from risk');

    // P4: Dynamic Params (Leverage and Model-based Size)
    // CRITICAL: Uses user's accuracyRiskConfig (single source of truth)
    const modelParams = await this.calculateDynamicParams(uid, signal.accuracy, (signal as any).volatilityClassification || 'low', 50);
    const modelLeverage = signal.leverage || modelParams.leverage || 1;

    // CRITICAL: Trade size % is calculated as percentage of wallet balance (account equity)
    // modelSizePct represents the percentage of total account equity to allocate to this trade
    // This is NOT margin-based sizing or fixed-amount sizing - it's strictly wallet balance percentage
    // Example: If equity = $1000 and modelSizePct = 5%, then position value = $50
    const modelSizePct = modelParams.sizePct;
    const modelMaxQuantity = (equity * (modelSizePct / 100)) / signal.entryPrice;

    // Log selected range and applied values for audit trail
    if (modelParams.matchedRange) {
      logger.info({
        uid,
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        matchedRange: `${modelParams.matchedRange.minAccuracy}-${modelParams.matchedRange.maxAccuracy ?? '∞'}%`,
        appliedSizePct: modelParams.sizePct,
        appliedLeverage: modelParams.leverage,
        positionValueUSD: equity * (modelSizePct / 100),
        skipReason: modelParams.skip
      }, '✅ [ACCURACY_RISK_CONFIG] Applied configuration - trade size as % of wallet balance');
    }

    // Apply strict model caps
    if (quantity > modelMaxQuantity) {
      quantity = modelMaxQuantity;
      logger.debug({ uid, quantity, modelMaxQuantity }, 'Quantity capped by balance model');
    }

    // 4. Apply Hard Cap (Max Position %)
    // Critical safety: never exceed user's hard cap per trade
    const maxPositionValue = equity * (tradingSettings.maxPositionPct / 100);
    const maxQuantity = maxPositionValue / signal.entryPrice;

    const volatilityQuantity = quantity;
    const positionSizeBeforeCap = quantity;
    const positionValueBeforeCap = positionSizeBeforeCap * signal.entryPrice;
    let capped = 'NO';

    // Apply Cap
    if (quantity > maxQuantity) {
      quantity = maxQuantity;
      capped = 'YES';
    }

    // 5. Final Value Calculation
    let positionValue = quantity * signal.entryPrice;

    // 🔍 [CHECKPOINT] Position size logging - before and after safety caps
    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'POSITION_SIZING_CHECKPOINT',
      accuracySlab: modelParams.matchedRange ? `${modelParams.matchedRange.minAccuracy}-${modelParams.matchedRange.maxAccuracy ?? '∞'}%` : 'N/A',
      userSelectedSizePct: modelParams.sizePct,
      positionSizeBeforeCap,
      positionValueBeforeCap: positionValueBeforeCap.toFixed(2),
      positionSizeAfterCap: quantity,
      positionValueAfterCap: positionValue.toFixed(2),
      maxPositionPct: tradingSettings.maxPositionPct,
      maxPositionValue: maxPositionValue.toFixed(2),
      capped,
      equity,
      entryPrice: signal.entryPrice
    }, '✅ [POSITION_SIZING_CHECKPOINT] Position size before/after safety caps logged');

    // 🔍 [DEBUG] Position value calculated
    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'POSITION_VALUE_CALC',
      positionValue,
      quantity,
      entryPrice: signal.entryPrice
    }, '🔍 [DEBUG_TRACE] Position value calculated');

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
        const reason = 'MIN_NOTIONAL_RISK_EXCEEDED';
        logger.error({
          uid,
          symbol: signal.symbol,
          step: 'POSITION_SIZING_BLOCKED',
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
          minNotional
        }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Adjusting to min notional (${minNotional} USDT) would exceed max risk (${adjustedRiskPct.toFixed(2)}% > ${maxAllowedRiskPct.toFixed(2)}%)`);

        await this.logAutoTradeSkip(uid, reason, {
          symbol: signal.symbol,
          accuracy: signal.accuracy,
          threshold: accuracyThreshold,
          signal: signal.signal,
          exchangeStatus: engine.adapter ? 'available' : 'unavailable',
          additionalDetails: {
            adjustedRiskPct,
            maxAllowedRiskPct,
            minNotional,
            quantity,
            equity,
          }
        });

        await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
          signal,
          reason,
          details: `Minimum notional adjustment would exceed max risk. Adjusted risk: ${adjustedRiskPct.toFixed(2)}%, max allowed: ${maxAllowedRiskPct.toFixed(2)}%`,
          accuracy: signal.accuracy,
          equity
        });

        // Final mandatory log
        const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
          ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
          : 0;
        logger.info({
          uid,
          symbol: signal.symbol,
          acc: signal.accuracy.toFixed(1),
          rr: rr.toFixed(2),
          qty: quantity.toFixed(6),
          minNotional,
          reason
        }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=${minNotional} → BLOCKED (${reason})`);

        throw new Error(`${reason}: Adjusting to min notional would exceed max risk (${adjustedRiskPct.toFixed(2)}% > ${maxAllowedRiskPct.toFixed(2)}%)`);
      }

      logger.info({
        uid,
        symbol: signal.symbol,
        equity,
        originalValue: originalPositionValue,
        adjustedValue: positionValue,
        originalQuantity,
        adjustedQuantity: quantity,
        adjustedRiskPct: adjustedRiskPct.toFixed(2) + '%'
      }, `✅ Adjusting quantity to meet minimum notional of ${minNotional} USDT (risk: ${adjustedRiskPct.toFixed(2)}%)`);
    }

    let finalPositionPercent = (positionValue / equity) * 100;

    // CRITICAL FIX: If manual approval (skipConfirmationCheck=true), enforce minimum size
    // This prevents trades from being skipped due to positionSizingMap returning 0.
    if (skipConfirmationCheck && (quantity <= 0 || finalPositionPercent <= 0.5)) {
      const minP = Math.min(1.0, tradingSettings.maxPositionPct);
      logger.info({ uid, symbol: signal.symbol, originalQuantity: quantity, originalPercent: finalPositionPercent, enforcedMin: minP },
        'Manual approval detected with insufficient quantity - forcing minimum position');
      finalPositionPercent = minP;
      quantity = (equity * (finalPositionPercent / 100)) / signal.entryPrice;
    }

    // Position sizing validation (CRITICAL)
    if (quantity <= 0 || isNaN(quantity)) {
      const reason = 'POSITION_SIZE_INVALID';
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        reason,
        quantity,
        equity,
        riskPct,
        riskAmount,
        slDistance,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        positionValue,
        minNotional: 10
      }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Calculated quantity is zero or negative`);

      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? 'available' : 'unavailable',
        additionalDetails: {
          quantity,
          equity,
          riskPct,
          slDistance,
        }
      });

      await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
        signal,
        reason,
        details: `Calculated quantity is zero or negative. Quantity: ${quantity}, Equity: ${equity}, Risk%: ${riskPct}%, SL Distance: ${slDistance}`,
        accuracy: signal.accuracy,
        equity
      });

      // Final mandatory log
      const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
        ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
        : 0;
      logger.info({
        uid,
        symbol: signal.symbol,
        acc: signal.accuracy.toFixed(1),
        rr: rr.toFixed(2),
        qty: quantity.toFixed(6),
        minNotional: 10,
        reason
      }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`);

      throw new Error(`${reason}: Calculated position size is zero or negative (${quantity}) - try increasing equity or perTradeRiskPct`);
    }

    if (positionValue <= 0 || isNaN(positionValue)) {
      const reason = 'POSITION_VALUE_INVALID';
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        reason,
        positionValue,
        quantity,
        entryPrice: signal.entryPrice,
        equity,
        minNotional: 10
      }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Position value is zero or negative`);

      await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
        signal,
        reason,
        details: `Position value is zero or negative. Position Value: ${positionValue}, Quantity: ${quantity}, Entry Price: ${signal.entryPrice}`,
        accuracy: signal.accuracy,
        equity
      });

      // Final mandatory log
      const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
        ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
        : 0;
      logger.info({
        uid,
        symbol: signal.symbol,
        acc: signal.accuracy.toFixed(1),
        rr: rr.toFixed(2),
        qty: quantity.toFixed(6),
        minNotional: 10,
        reason
      }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`);

      throw new Error(`${reason}: Position value is zero or negative (${positionValue})`);
    }

    if (positionValue < minNotional && equity < minNotional) {
      const reason = 'INSUFFICIENT_BALANCE';
      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'POSITION_SIZING_BLOCKED',
        reason,
        positionValue,
        equity,
        minNotional,
        quantity
      }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Equity (${equity}) < min notional (${minNotional})`);

      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? 'available' : 'unavailable',
        additionalDetails: {
          equity,
          minNotional,
          positionValue,
          quantity,
        }
      });

      await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
        signal,
        reason,
        details: `Insufficient balance. Equity: ${equity}, Min Notional: ${minNotional}`,
        accuracy: signal.accuracy,
        equity
      });

      // Final mandatory log
      const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
        ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
        : 0;
      logger.info({
        uid,
        symbol: signal.symbol,
        acc: signal.accuracy.toFixed(1),
        rr: rr.toFixed(2),
        qty: quantity.toFixed(6),
        minNotional,
        reason
      }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=${minNotional} → BLOCKED (${reason})`);

      throw new Error(`${reason}: Equity (${equity}) is below minimum notional (${minNotional} USDT)`);
    }

    // Final mandatory log (single line summary) - Position sizing passed all validations
    const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
      ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
      : 0;

    logger.info({
      uid,
      symbol: signal.symbol,
      acc: signal.accuracy.toFixed(1),
      rr: rr.toFixed(2),
      qty: quantity.toFixed(6),
      minNotional,
      positionValue: positionValue.toFixed(2)
    }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=${minNotional} → ALLOWED`);

    logger.info({
      uid,
      symbol: signal.symbol,
      step: 'POSITION_SIZING_COMPLETE',
      finalQuantity: quantity,
      finalPositionValue: positionValue,
      finalPositionPercent,
      leverage: modelLeverage
    }, '🔍 [DEBUG_TRACE] Position sizing complete - proceeding to order placement');

    logger.info({
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
      capped
    }, '✅ Position size calculated using Volatility-Based Sizing and Dynamic Model (P4)');

    // Detect if scalping mode
    const isScalping = (await AutoTradeEngine.getTradingSettings(uid)).tradeType === 'Scalping';

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
      status: 'PENDING',
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
    const shouldExecute = (config.autoTradeEnabled && !config.manualOverride) || skipConfirmationCheck;

    // CRITICAL DIAGNOSTIC: Log execution decision
    logger.info({
      uid,
      symbol: signal.symbol,
      shouldExecute,
      autoTradeEnabled: config.autoTradeEnabled,
      manualOverride: config.manualOverride,
      skipConfirmationCheck,
      reason: shouldExecute
        ? 'EXECUTING: All conditions met'
        : `BLOCKED: autoTradeEnabled=${config.autoTradeEnabled}, manualOverride=${config.manualOverride}, skipConfirmationCheck=${skipConfirmationCheck}`
    }, shouldExecute ? '✅ [EXECUTE_TRADE] Proceeding with trade execution' : '⛔ [EXECUTE_TRADE] Trade execution blocked');

    if (!shouldExecute) {
      const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
        ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
        : 0;
      const reason = config.autoTradeEnabled === false ? 'AUTO_TRADE_DISABLED' :
        config.manualOverride === true ? 'MANUAL_OVERRIDE' :
          'EXECUTION_BLOCKED';

      logger.error({
        uid,
        symbol: signal.symbol,
        step: 'EXECUTION_BLOCKED',
        autoTradeEnabled: config.autoTradeEnabled,
        manualOverride: config.manualOverride,
        skipConfirmationCheck,
        reason
      }, '🔍 [DEBUG_TRACE] BLOCKED: shouldExecute is false - trade will not execute');

      // Final mandatory log for blocked execution
      logger.info({
        uid,
        symbol: signal.symbol,
        acc: signal.accuracy.toFixed(1),
        rr: rr.toFixed(2),
        qty: quantity.toFixed(6),
        minNotional: 10,
        reason
      }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`);

      await this.logAutoTradeSkip(uid, reason, {
        symbol: signal.symbol,
        accuracy: signal.accuracy,
        threshold: accuracyThreshold,
        signal: signal.signal,
        exchangeStatus: engine.adapter ? 'available' : 'unavailable',
        additionalDetails: {
          autoTradeEnabled: config.autoTradeEnabled,
          manualOverride: config.manualOverride,
          skipConfirmationCheck,
        }
      });

      await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
        signal,
        reason,
        details: `Execution blocked: autoTradeEnabled=${config.autoTradeEnabled}, manualOverride=${config.manualOverride}`,
        accuracy: signal.accuracy
      });

      throw new Error(`${reason}: Trade execution blocked - autoTradeEnabled=${config.autoTradeEnabled}, manualOverride=${config.manualOverride}`);
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
        logger.warn({
          uid,
          symbol: signal.symbol,
          userSelectedLeverage,
          finalLeverage,
          maxLeverage: MAX_LEVERAGE
        }, '⚠️ [LEVERAGE_VALIDATION] Leverage capped at exchange maximum');
      }

      // Update trade object with validated leverage
      trade.leverage = finalLeverage;

      // 🔍 [CHECKPOINT] Log leverage before/after validation
      logger.info({
        uid,
        symbol: signal.symbol,
        step: 'LEVERAGE_CHECKPOINT',
        userSelectedLeverage,
        finalLeverage,
        maxLeverage: MAX_LEVERAGE,
        leverageCapped,
        accuracySlab: modelParams.matchedRange ? `${modelParams.matchedRange.minAccuracy}-${modelParams.matchedRange.maxAccuracy ?? '∞'}%` : 'N/A'
      }, '✅ [LEVERAGE_CHECKPOINT] User-selected vs final leverage logged');

      // 🔍 [DEBUG] Final pre-execution check
      logger.info({
        uid,
        symbol: signal.symbol,
        step: 'PRE_ORDER_PLACEMENT',
        quantity,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        leverage: finalLeverage,
        hasAdapter: !!engine.adapter,
        adapterType: engine.adapter?.constructor?.name
      }, '🔍 [DEBUG_TRACE] All checks passed - proceeding to order placement');
      // REAL TRADE EXECUTION
      try {
        // P4: Set Leverage on Exchange before placing order
        if (engine.adapter && typeof engine.adapter.setLeverage === 'function') {
          try {
            await engine.adapter.setLeverage(signal.symbol, finalLeverage);
            logger.info({ uid, symbol: signal.symbol, leverage: finalLeverage }, 'Leverage set on exchange');
          } catch (levErr: any) {
            // Check if error is due to leverage exceeding exchange limit
            if (levErr.message?.includes('leverage') || levErr.message?.includes('Leverage')) {
              const reason = 'LEVERAGE_EXCEEDS_EXCHANGE_LIMIT';
              logger.error({
                uid,
                symbol: signal.symbol,
                step: 'LEVERAGE_VALIDATION_FAILED',
                reason,
                requestedLeverage: finalLeverage,
                error: levErr.message
              }, `❌ [LEVERAGE_VALIDATION] BLOCKED: ${reason} - Exchange rejected leverage ${finalLeverage}x`);

              await this.logAutoTradeSkip(uid, reason, {
                symbol: signal.symbol,
                accuracy: signal.accuracy,
                threshold: accuracyThreshold,
                signal: signal.signal,
                exchangeStatus: 'available',
                additionalDetails: {
                  requestedLeverage: finalLeverage,
                  exchangeError: levErr.message,
                }
              });

              throw new Error(`${reason}: Exchange rejected leverage ${finalLeverage}x - ${levErr.message}`);
            }
            logger.warn({ uid, symbol: signal.symbol, error: levErr.message }, 'Failed to set leverage on exchange, proceeding with order');
          }
        }

        // P4: Set Margin Type (ISOLATED for safety)
        if (engine.adapter && typeof engine.adapter.setMarginType === 'function') {
          try {
            await engine.adapter.setMarginType(signal.symbol, 'ISOLATED');
          } catch (marginErr) { /* ignore already set errors */ }
        }

        logger.info({ uid, symbol: signal.symbol, requestId }, 'Pre-trade validation: checking orderbook liquidity');

        // Pre-trade validation: orderbook liquidity & min notional
        const orderbook = await engine.adapter!.getOrderbook(signal.symbol, 5);
        const bestBid = parseFloat(orderbook.bids[0]?.price || '0');
        const bestAsk = parseFloat(orderbook.asks[0]?.price || '0');

        if (bestBid === 0 || bestAsk === 0) {
          throw new Error('Insufficient order book liquidity');
        }

        // SCALPING: Check spread - abort if > 0.5% (only for scalping mode)
        if (isScalping) {
          const spread = bestAsk - bestBid;
          const spreadPct = (spread / bestBid) * 100;
          if (spreadPct > 0.5) {
            throw new Error(`Spread too wide for scalping: ${spreadPct.toFixed(3)}% (max 0.5%)`);
          }
          logger.info({ uid, symbol: signal.symbol, spreadPct: spreadPct.toFixed(3) + '%' }, '[SCALPING] Spread check passed');
        }

        // Check min notional (e.g., $10 minimum for Binance)
        const notional = quantity * signal.entryPrice;
        if (notional < 10) {
          throw new Error(`Order notional (${notional.toFixed(2)}) below minimum (10)`);
        }

        // Exchange constraint visibility: Check minQty and stepSize if available
        let exchangeConstraints: any = {};
        try {
          if (engine.adapter && typeof (engine.adapter as any).getSymbolInfo === 'function') {
            const symbolInfo = await (engine.adapter as any).getSymbolInfo(signal.symbol);
            if (symbolInfo) {
              exchangeConstraints = {
                minQty: symbolInfo.minQty,
                stepSize: symbolInfo.stepSize,
                minNotional: symbolInfo.minNotional
              };
            }
          }
        } catch (constraintError: any) {
          logger.warn({ uid, symbol: signal.symbol, error: constraintError.message }, 'Failed to fetch exchange constraints (non-critical)');
        }

        // Validate quantity against exchange constraints if available
        if (exchangeConstraints.minQty && quantity < exchangeConstraints.minQty) {
          const reason = 'QUANTITY_BELOW_EXCHANGE_MIN';
          logger.error({
            uid,
            symbol: signal.symbol,
            step: 'ORDER_PLACEMENT_BLOCKED',
            reason,
            calculatedQty: quantity,
            minQty: exchangeConstraints.minQty,
            stepSize: exchangeConstraints.stepSize
          }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Calculated quantity (${quantity}) < exchange minQty (${exchangeConstraints.minQty})`);

          await this.logAutoTradeSkip(uid, reason, {
            symbol: signal.symbol,
            accuracy: signal.accuracy,
            threshold: accuracyThreshold,
            signal: signal.signal,
            exchangeStatus: 'available',
            additionalDetails: {
              calculatedQty: quantity,
              minQty: exchangeConstraints.minQty,
              stepSize: exchangeConstraints.stepSize,
            }
          });

          await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
            signal,
            reason,
            details: `Calculated quantity below exchange minimum. Quantity: ${quantity}, MinQty: ${exchangeConstraints.minQty}`,
            accuracy: signal.accuracy
          });

          // Final mandatory log
          const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
            ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
            : 0;
          logger.info({
            uid,
            symbol: signal.symbol,
            acc: signal.accuracy.toFixed(1),
            rr: rr.toFixed(2),
            qty: quantity.toFixed(6),
            minNotional: 10,
            reason
          }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`);

          throw new Error(`${reason}: Calculated quantity (${quantity}) is below exchange minimum (${exchangeConstraints.minQty})`);
        }

        // Round quantity to stepSize if available
        if (exchangeConstraints.stepSize) {
          const stepSize = parseFloat(exchangeConstraints.stepSize);
          if (stepSize > 0) {
            quantity = Math.floor(quantity / stepSize) * stepSize;
            if (quantity < exchangeConstraints.minQty) {
              const reason = 'QUANTITY_ROUNDED_BELOW_MIN';
              logger.error({
                uid,
                symbol: signal.symbol,
                step: 'ORDER_PLACEMENT_BLOCKED',
                reason,
                originalQty: quantity,
                stepSize,
                roundedQty: quantity,
                minQty: exchangeConstraints.minQty
              }, `❌ [AUTO_TRADE_EXECUTION] BLOCKED: ${reason} - Rounded quantity (${quantity}) < minQty (${exchangeConstraints.minQty})`);

              await this.logAutoTradeSkip(uid, reason, {
                symbol: signal.symbol,
                accuracy: signal.accuracy,
                threshold: accuracyThreshold,
                signal: signal.signal,
                exchangeStatus: 'available',
                additionalDetails: {
                  roundedQty: quantity,
                  minQty: exchangeConstraints.minQty,
                  stepSize: exchangeConstraints.stepSize,
                }
              });

              await this.logTradeEvent(uid, 'TRADE_SKIPPED', {
                signal,
                reason,
                details: `Quantity rounded below minimum. Rounded: ${quantity}, MinQty: ${exchangeConstraints.minQty}`,
                accuracy: signal.accuracy
              });

              // Final mandatory log
              const rr = signal.takeProfit && signal.stopLoss && signal.entryPrice
                ? Math.abs((signal.takeProfit - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss))
                : 0;
              logger.info({
                uid,
                symbol: signal.symbol,
                acc: signal.accuracy.toFixed(1),
                rr: rr.toFixed(2),
                qty: quantity.toFixed(6),
                minNotional: 10,
                reason
              }, `[AUTO_TRADE_EXECUTION] acc=${signal.accuracy.toFixed(1)} rr=${rr.toFixed(2)} qty=${quantity.toFixed(6)} minNotional=10 → BLOCKED (${reason})`);

              throw new Error(`${reason}: Quantity rounded to stepSize is below minimum`);
            }
            positionValue = quantity * signal.entryPrice; // Recalculate after rounding
          }
        }

        logger.info({
          uid,
          symbol: signal.symbol,
          quantity,
          entryPrice: signal.entryPrice,
          notional: positionValue,
          side: signal.signal,
          requestId,
          exchangeConstraints
        }, 'Placing live order');

        // 🔍 [DEBUG] Final order payload before placement
        logger.info({
          uid,
          symbol: signal.symbol,
          step: 'ORDER_PLACEMENT_START',
          orderPayload: {
            symbol: signal.symbol,
            side: signal.signal,
            type: 'MARKET',
            quantity
          },
          leverage: modelLeverage,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          exchangeConstraints
        }, '🔍 [DEBUG_TRACE] Final order payload - placing order now');

        // Place order
        const orderResult = await engine.adapter!.placeOrder({
          symbol: signal.symbol,
          side: signal.signal,
          type: 'MARKET',
          quantity: quantity,
        });

        // 🔍 [DEBUG] Order placed successfully
        logger.info({
          uid,
          symbol: signal.symbol,
          step: 'ORDER_PLACED_SUCCESS',
          orderId: orderResult.exchangeOrderId || orderResult.id,
          fillPrice: orderResult.avgPrice || orderResult.price,
          quantity: orderResult.quantity || quantity
        }, '🔍 [DEBUG_TRACE] Order placed successfully - proceeding to TP/SL');

        trade.status = 'FILLED';
        trade.orderId = orderResult.exchangeOrderId || orderResult.id;
        trade.fillPrice = parseFloat(orderResult.avgPrice?.toString() || orderResult.price?.toString() || signal.entryPrice.toString());

        // Extract base and quote currencies from symbol (e.g., BTCUSDT -> BTC, USDT)
        const baseCurrency = signal.symbol.replace('USDT', '').replace('USD', '');
        const quoteCurrency = signal.symbol.includes('USDT') ? 'USDT' : 'USD';
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
                side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
                type: 'LIMIT',
                quantity: tp1Quantity,
                price: signal.takeProfit1
              });
              tp1OrderId = tp1Order.exchangeOrderId || tp1Order.clientOrderId;
              trade.takeProfit1OrderId = tp1OrderId;
              logger.info({
                uid,
                symbol: signal.symbol,
                tp1Price: signal.takeProfit1,
                tp1Quantity,
                tp1OrderId
              }, '[SCALPING] TP1 order placed - 50% partial close');
            }

            // TP2: Close 20% more (70% total of original)
            const tp2Quantity = Math.floor(originalQty * 0.2 * 100) / 100;
            if (tp2Quantity > 0) {
              const tp2Order = await engine.adapter!.placeOrder({
                symbol: `${baseCurrency}${quoteCurrency}`,
                side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
                type: 'LIMIT',
                quantity: tp2Quantity,
                price: signal.takeProfit2
              });
              tp2OrderId = tp2Order.exchangeOrderId || tp2Order.clientOrderId;
              trade.takeProfit2OrderId = tp2OrderId;
              logger.info({
                uid,
                symbol: signal.symbol,
                tp2Price: signal.takeProfit2,
                tp2Quantity,
                tp2OrderId
              }, '[SCALPING] TP2 order placed - 20% additional (70% total)');
            }

            // TP3: Close remaining 30% (100% total)
            if (signal.takeProfit3) {
              const tp3Quantity = Math.floor(originalQty * 0.3 * 100) / 100;
              if (tp3Quantity > 0) {
                const tp3Order = await engine.adapter!.placeOrder({
                  symbol: `${baseCurrency}${quoteCurrency}`,
                  side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
                  type: 'LIMIT',
                  quantity: tp3Quantity,
                  price: signal.takeProfit3
                });
                tp3OrderId = tp3Order.exchangeOrderId || tp3Order.clientOrderId;
                trade.takeProfit3OrderId = tp3OrderId;
                logger.info({
                  uid,
                  symbol: signal.symbol,
                  tp3Price: signal.takeProfit3,
                  tp3Quantity,
                  tp3OrderId
                }, '[SCALPING] TP3 order placed - 30% final (100% total)');
              }
            } else {
              // No TP3: Close remaining 30% at TP2
              const remainingQty = originalQty - tp1Quantity - tp2Quantity;
              if (remainingQty > 0) {
                // Update TP2 order to include remaining quantity (if exchange supports order modification)
                // For now, we'll handle this in monitoring
                logger.info({
                  uid,
                  symbol: signal.symbol,
                  remainingQty
                }, '[SCALPING] No TP3 - remaining 30% will be closed at TP2 or SL');
              }
            }
          } else {
            // NON-SCALPING: Use legacy single TP/SL logic
            if (config.takeProfitPct && config.takeProfitPct > 0) {
              const tpPrice = signal.signal === 'BUY'
                ? executedPrice * (1 + config.takeProfitPct / 100)
                : executedPrice * (1 - config.takeProfitPct / 100);

              const tpOrder = await engine.adapter!.placeOrder({
                symbol: `${baseCurrency}${quoteCurrency}`,
                side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
                type: 'LIMIT',
                quantity: executedQuantity,
                price: tpPrice
              });

              tpOrderId = tpOrder.exchangeOrderId || tpOrder.clientOrderId;
              trade.takeProfitOrderId = tpOrderId;
              trade.takeProfitPct = config.takeProfitPct;

              logger.info({
                uid,
                symbol: signal.symbol,
                tpPrice,
                tpOrderId
              }, 'TP order placed (non-scalping)');
            }
          }

          // Stop Loss: Always place for full remaining quantity
          // For scalping, SL will be updated (trailed) as TP levels are hit
          const slPrice = signal.stopLoss;
          const slQuantity = isScalping ? executedQuantity : executedQuantity; // Full quantity for SL

          const slOrder = await engine.adapter!.placeOrder({
            symbol: `${baseCurrency}${quoteCurrency}`,
            side: signal.signal === 'BUY' ? 'SELL' : 'BUY',
            type: 'LIMIT',
            quantity: slQuantity,
            price: slPrice
          });

          slOrderId = slOrder.exchangeOrderId || slOrder.clientOrderId;
          trade.stopLossOrderId = slOrderId;
          trade.trailingStopLoss = slPrice; // Initialize trailing SL

          logger.info({
            uid,
            symbol: signal.symbol,
            slPrice,
            slQuantity,
            slOrderId,
            isScalping
          }, isScalping ? '[SCALPING] SL order placed (will trail on TP hits)' : 'SL order placed');
        } catch (tpslError: any) {
          // P0 FIX: Atomic Execution Failure - Emergency Close
          logger.error({
            error: tpslError.message,
            uid,
            symbol: signal.symbol,
            tradeId: trade.tradeId
          }, 'CRITICAL: TP/SL placement failed. Executing EMERGENCY CLOSE to protect capital.');

          try {
            // Attempt to close the position immediately with a MARKET order
            await engine.adapter!.placeOrder({
              symbol: signal.symbol,
              side: signal.signal === 'BUY' ? 'SELL' : 'BUY', // Inverted side to close
              type: 'MARKET',
              quantity: executedQuantity
            });

            trade.status = 'CANCELLED'; // Mark as cancelled/failed
            await this.logTradeEvent(uid, 'EMERGENCY_CLOSE', {
              tradeId,
              symbol: signal.symbol,
              reason: 'TP/SL placement failed',
              originalError: tpslError.message
            });

            // Throw to stop further processing
            throw new Error(`Trade aborted: TP/SL placement failed. Position emergency closed. Error: ${tpslError.message}`);
          } catch (closeError: any) {
            // Worst case scenario: Position is open and unprotected, and close failed
            logger.error({
              uid,
              symbol: signal.symbol,
              closeError: closeError.message,
              originalError: tpslError.message
            }, 'FATAL: EMERGENCY CLOSE FAILED. Position is UNPROTECTED.');

            await this.logTradeEvent(uid, 'CRITICAL_FAILURE', {
              tradeId,
              symbol: signal.symbol,
              message: 'Position left OPEN and UNPROTECTED. Emergency close failed.',
              error: closeError.message
            });

            throw closeError; // Re-throw the close error
          }
        }

        // Save trade to trades collection for performance stats
        const db = getFirebaseAdmin().firestore();
        const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
        const exchangeConfig = exchangeConfigDoc.exists ? exchangeConfigDoc.data() : null;
        const exchangeName = exchangeConfig?.exchange || 'unknown';

        await firestoreAdapter.saveTrade(uid, {
          symbol: signal.symbol,
          side: signal.signal,
          qty: quantity,
          entryPrice: signal.entryPrice,
          exitPrice: undefined, // Will be set when trade is closed
          pnl: 0, // Will be calculated when trade is closed
          engineType: 'AI',
          orderId: trade.orderId,
          exchange: exchangeName,
          signalAccuracy: signal.accuracy,
          status: 'open',
          metadata: {
            requestId,
            takeProfitOrderId: tpOrderId,
            stopLossOrderId: slOrderId,
            fillPrice: trade.fillPrice,
            mode: 'AUTO'
          }
        });

        await this.logTradeEvent(uid, 'TRADE_EXECUTED', {
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

        logger.info({
          uid,
          tradeId,
          symbol: signal.symbol,
          orderId: trade.orderId,
          fillPrice: trade.fillPrice,
          takeProfitOrderId: tpOrderId,
          stopLossOrderId: slOrderId,
          requestId,
          mode: 'AUTO'
        }, 'Trade executed (LIVE mode)');

        // NOTIFICATION: Auto Trade Alert - COMPLETED with all details
        // CRITICAL: Only send if Auto Trade is enabled AND autoTradeAlerts is enabled
        try {
          const userSettings = await firestoreAdapter.getSettings(uid);
          const config = await this.loadConfig(uid);

          // Check both: Auto Trade must be ON and alerts must be enabled
          if (config.autoTradeEnabled && userSettings?.notifications?.autoTradeAlerts) {
            userNotificationService.sendAutoTradeAlert(
              uid,
              signal.symbol,
              signal.signal.toLowerCase() as 'buy' | 'sell',
              trade.fillPrice || trade.entryPrice,
              trade.stopLoss,
              trade.takeProfit,
              signal.accuracy
            );
            logger.info({ uid, symbol: signal.symbol }, 'Auto-trade alert sent (trade executed)');

            // NOTIFICATION: Telegram Execution Alert
            try {
              const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
              if (bgSettings?.backgroundResearchEnabled && bgSettings?.telegramBotToken && bgSettings?.telegramChatId) {
                const { telegramService } = await import('./telegramService');
                telegramService.sendTradeExecutionAlert(
                  bgSettings.telegramBotToken,
                  bgSettings.telegramChatId,
                  {
                    symbol: signal.symbol,
                    side: signal.signal.toUpperCase() as 'BUY' | 'SELL',
                    price: trade.fillPrice || trade.entryPrice,
                    accuracy: signal.accuracy,
                    sl: trade.stopLoss,
                    tp: trade.takeProfit,
                    requestId
                  }
                );
              }
            } catch (e) {
              logger.warn({ uid }, 'Failed to send Telegram execution alert');
            }
          } else {
            logger.debug({
              uid,
              autoTradeEnabled: config.autoTradeEnabled,
              autoTradeAlerts: userSettings?.notifications?.autoTradeAlerts
            }, 'Auto-trade alert skipped (disabled or auto-trade off)');
          }
        } catch (notifError: any) {
          logger.warn({ uid, error: notifError.message }, 'Failed to send auto-trade notification');
        }
      } catch (error: any) {
        trade.status = 'REJECTED';
        await this.logTradeEvent(uid, 'TRADE_FAILED', {
          trade,
          signal,
          error: error.message,
          requestId,
          exchangeError: error.response?.data || error.message,
        });
        logger.error({
          uid,
          tradeId,
          symbol: signal.symbol,
          error: error.message,
          requestId
        }, 'Trade execution failed');
        throw error;
      }
    } else {
      // Manual mode or override active - don't execute
      trade.status = 'CANCELLED';
      await this.logTradeEvent(uid, 'TRADE_CANCELLED', {
        trade,
        signal,
        reason: config.manualOverride ? 'Manual override active' : 'Manual mode',
        requestId,
      });
      logger.warn({ uid, symbol: signal.symbol, requestId, reason: config.manualOverride ? 'Manual override' : 'Manual mode' }, 'Trade cancelled');
      throw new Error('Trading is in manual mode or override is active');
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
      symbolCooldowns: symbolCooldowns
    });

    logger.info({
      uid,
      symbol: signal.symbol,
      cooldownSeconds,
      cooldownUntil: symbolCooldownEnd.toISOString()
    }, '✅ [PER_SYMBOL_COOLDOWN] Per-symbol cooldown set (other symbols can still trade)');

    // Update stats
    await this.updateStats(uid, trade);

    return trade;
  }

  /**
   * Default accuracy-based risk configuration (system defaults)
   * This is the single source of truth for default values
   */
  /**
   * Default accuracy-based risk configuration (system defaults)
   * CRITICAL: This is the single source of truth for default values
   * Leverage for ≥90% is 9x by default (10x is hard cap only)
   */
  private static getDefaultAccuracyRiskConfig(): AccuracyRiskConfigItem[] {
    return [
      { minAccuracy: 75, maxAccuracy: 79, tradeSizePct: 3, leverage: 4 },
      { minAccuracy: 80, maxAccuracy: 84, tradeSizePct: 5, leverage: 5 },
      { minAccuracy: 85, maxAccuracy: 89, tradeSizePct: 7, leverage: 7 },
      { minAccuracy: 90, maxAccuracy: null, tradeSizePct: 10, leverage: 9 } // null = no upper limit (≥90%), default leverage 9x (10x is hard cap)
    ];
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
          coinSelectionMode: 'manual',
          selectedCoins: ['BTCUSDT', 'ETHUSDT'],
          maxPositionPct: 10,
          accuracyTrigger: { min: 75, max: 100 },
          maxDailyLossPct: 5,
          maxTradesPerDay: 5, // Default safe limit
          autoTradeIntervalMinutes: 5,
          tradeConfirmationRequired: false,
          tradeType: 'Scalping',
          positionSizingMap: {
            '0-84': 0,
            '85-89': 3,
            '90-94': 6,
            '95-99': 8.5,
            '100': 10
          },
          accuracyRiskConfig: AutoTradeEngine.getDefaultAccuracyRiskConfig()
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
      const backgroundResearchSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const isTelegramEnabled = !!(backgroundResearchSettings?.telegramBotToken?.trim() && backgroundResearchSettings?.telegramChatId?.trim());

      // Rule: If Telegram disabled, default Auto Trade interval to 5 minutes.
      let unifiedFrequency = backgroundResearchSettings?.researchFrequencyMinutes || settings.autoTradeIntervalMinutes || 5;
      if (!isTelegramEnabled) {
        unifiedFrequency = 5;
        logger.debug({ uid }, 'Telegram disabled: Forcing 5-minute auto-trade interval');
      }

      return {
        coinSelectionMode: settings.coinSelectionMode || (settings.mode === 'MANUAL' ? 'manual' : settings.mode === 'TOP_100' ? 'top100' : 'top10'),
        selectedCoins: settings.selectedCoins || settings.manualCoins || ['BTCUSDT', 'ETHUSDT'],
        maxPositionPct: settings.maxPositionPct || settings.maxPositionPerTrade || 10,
        accuracyTrigger: typeof settings.accuracyTrigger === 'object' ? settings.accuracyTrigger : { min: settings.accuracyTrigger || 75, max: 100 },
        maxDailyLossPct: settings.maxDailyLossPct || settings.maxDailyLoss || 7,
        maxTradesPerDay: maxTrades,
        autoTradeIntervalMinutes: unifiedFrequency,
        tradeConfirmationRequired: userSettings?.notifications?.tradeConfirmationRequired ?? false,
        tradeType: settings.tradeType || 'Scalping',
        positionSizingMap: settings.positionSizingMap || {
          '0-84': 0,
          '85-89': 3,
          '90-94': 6,
          '95-99': 8.5,
          '100': 10
        },
        accuracyRiskConfig: settings.accuracyRiskConfig && Array.isArray(settings.accuracyRiskConfig) && settings.accuracyRiskConfig.length > 0
          ? settings.accuracyRiskConfig
          : AutoTradeEngine.getDefaultAccuracyRiskConfig()
      };
    } catch (error: any) {
      logger.error({ error: error.message, uid }, 'Error getting trading settings, using defaults');
      // Return defaults on error
      // Use centralized default config method

      return {
        coinSelectionMode: 'manual' as const,
        selectedCoins: ['BTCUSDT'],
        maxPositionPct: 10,
        tradeConfirmationRequired: false,
        accuracyTrigger: { min: 75, max: 100 },
        maxDailyLossPct: 7,
        maxTradesPerDay: 30, // Default to 30 (limitless feeling)
        autoTradeIntervalMinutes: 5,
        tradeType: 'Scalping',
        positionSizingMap: {
          '0-84': 0,
          '85-89': 3,
          '90-94': 6,
          '95-99': 8.5,
          '100': 10
        },
        accuracyRiskConfig: AutoTradeEngine.getDefaultAccuracyRiskConfig()
      };
    }
  }

  /**
   * Calculate position size based on accuracy and trading settings
   * Returns the position percentage to use for the trade
   */
  static calculatePositionSize(accuracy: number, settings: TradingSettings): PositionSizingResult {
    // P4: Use dynamic sizing model
    const acc = accuracy > 1 ? accuracy : accuracy * 100;

    // CRITICAL: Use user-defined accuracyTrigger.min for execution sizing
    // This ensures auto-trade respects user's selected accuracy threshold
    const minThreshold = settings.accuracyTrigger?.min ?? 75;

    if (acc < minThreshold) {
      return {
        positionPercent: 0,
        reason: `Accuracy ${acc.toFixed(1)}% below user-defined threshold (${minThreshold}%)`
      };
    }

    // Note: The modelPercent calculation below is legacy and may be replaced by accuracyRiskConfig
    // For now, it's kept for backward compatibility but accuracyRiskConfig in calculateDynamicParams takes precedence
    let modelPercent = 0;
    if (acc < minThreshold) modelPercent = 1;
    else if (acc < 80) modelPercent = 2;
    else if (acc < 85) modelPercent = 3;
    else if (acc < 90) modelPercent = 4;
    else modelPercent = 5;

    // Apply the user's hard cap from settings as well
    const positionPercent = Math.min(modelPercent, settings.maxPositionPct || 10);

    return {
      positionPercent,
      reason: `Accuracy ${acc.toFixed(1)}% maps to ${modelPercent}% (capped at ${settings.maxPositionPct}% user limit)`
    };
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
  async logTradeEvent(uid: string, eventType: string, data: any): Promise<void> {
    try {
      const db = getFirebaseAdmin().firestore();
      await db.collection('users').doc(uid).collection('autoTradeLogs').add({
        eventType,
        data,
        timestamp: admin.firestore.Timestamp.now(),
        userId: uid,
      });
    } catch (error: any) {
      logger.error({ error: error.message, uid, eventType }, 'Error logging trade event');
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
  private async logAutoTradeSkip(
    uid: string,
    reason: string | AutoTradeReason,
    context: {
      symbol?: string;
      accuracy?: number;
      threshold?: number;
      signal?: TradeSignalType | string;
      exchangeStatus?: 'available' | 'unavailable' | 'decryption_failed' | 'unknown';
      additionalDetails?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      const engine = await this.getUserEngine(uid);
      const config = engine.config;

      // Determine exchange status
      let exchangeStatus: 'available' | 'unavailable' | 'decryption_failed' | 'unknown' = context.exchangeStatus || 'unknown';
      if (exchangeStatus === 'unknown') {
        if (engine.adapter) {
          exchangeStatus = 'available';
        } else {
          // Try to check if exchange config exists but decryption failed
          try {
            const db = getFirebaseAdmin().firestore();
            const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();
            if (exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted) {
              try {
                const { decryptOrThrow } = await import('./keyManager');
                decryptOrThrow(exchangeConfigDoc.data()!.apiKeyEncrypted, 'API key');
                exchangeStatus = 'available';
              } catch {
                exchangeStatus = 'decryption_failed';
              }
            } else {
              exchangeStatus = 'unavailable';
            }
          } catch {
            exchangeStatus = 'unavailable';
          }
        }
      }

      // CRITICAL FIX: Ensure NO undefined values - use proper coercion
      const skipLog = {
        uid,
        symbol: context.symbol ?? null,
        reason,
        accuracy: Number(context.accuracy) || 0,
        accuracyUsed: Number(context.accuracy) || 0,
        threshold: Number(context.threshold) || 0,
        signal: context.signal,
        exchangeStatus,
        autoTradeEnabled: config.autoTradeEnabled,
        manualOverride: config.manualOverride,
        ...context.additionalDetails,
        timestamp: admin.firestore.Timestamp.now(),
      };

      // Log to execution logs
      await firestoreAdapter.saveExecutionLog(uid, {
        symbol: context.symbol ?? null,
        timestamp: admin.firestore.Timestamp.now(),
        action: 'SKIPPED',
        reason,
        accuracy: Number(context.accuracy) || 0,
        accuracyUsed: Number(context.accuracy) || 0,
        signal: context.signal as 'BUY' | 'SELL' | 'HOLD' | undefined,
        status: `SKIPPED: ${reason}`,
      });

      // Log to console with full context
      logger.info(skipLog, `⛔ [AUTO_TRADE_SKIP] ${reason} - acc=${context.accuracy?.toFixed(1) || 'N/A'}% threshold=${context.threshold || 'N/A'}% signal=${context.signal || 'N/A'} exchange=${exchangeStatus}`);
    } catch (error: any) {
      logger.error({ error: error.message, uid, reason }, 'Failed to log auto-trade skip');
    }
  }

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
    if (engine.adapter && typeof engine.adapter.getAccount === 'function') {
      try {
        const accountInfo = await engine.adapter.getAccount();

        // Handle different exchange response formats
        if (accountInfo.balances && Array.isArray(accountInfo.balances)) {
          const usdtBalance = accountInfo.balances.find((b: any) => b.asset === 'USDT');
          if (usdtBalance) {
            const free = parseFloat(usdtBalance.free || usdtBalance.available || '0');
            const locked = parseFloat(usdtBalance.locked || usdtBalance.frozen || '0');
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
        logger.warn({ error: error.message, uid }, 'Could not fetch equity for status');
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
    await this.logTradeEvent(uid, 'CIRCUIT_BREAKER_RESET', {});
  }

  /**
   * P3-B: Execute Panic Stop
   * Closes all open positions immediately and sets cooldown
   */
  async executePanicStop(uid: string): Promise<void> {
    logger.warn({ uid }, '🚨 PANIC STOP ACTIVATED: Initiating forced exit of all trades');

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
      panicStopEnabled: false // Reset switch so it doesn't stay stuck ON
    });

    await this.logTradeEvent(uid, 'PANIC_STOP_TRIGGERED', {
      reason: 'User panic stop enabled',
      cooldownUntil: cooldownUntil.toISOString(),
      activeTrades: engine.activeTrades.size
    });

    if (!engine.adapter && engine.activeTrades.size > 0) {
      logger.error({ uid }, 'Panic stop failed to close trades: No adapter available');
      // We still set cooldown, but couldn't close trades.
      // We should probably try to log failed closes.
      for (const tradeId of engine.activeTrades.keys()) {
        await this.logTradeEvent(uid, 'PANIC_CLOSE_FAILED', { tradeId, error: 'No adapter' });
      }
      return;
    }

    if (engine.activeTrades.size === 0) {
      return;
    }

    // 2. Iterate and Close Trades
    const tradesToClose = Array.from(engine.activeTrades.values());

    for (const trade of tradesToClose) {
      if (trade.status !== 'FILLED') continue;

      try {
        logger.info({ uid, tradeId: trade.tradeId, symbol: trade.symbol }, 'Panic closing trade');

        // A. Cancel Open Orders
        if (trade.takeProfitOrderId) {
          try {
            await engine.adapter!.cancelOrder(trade.symbol, trade.takeProfitOrderId);
          } catch (e: any) {
            logger.warn({ uid, symbol: trade.symbol, error: e.message }, 'Failed to cancel TP order');
          }
        }
        if (trade.stopLossOrderId) {
          try {
            await engine.adapter!.cancelOrder(trade.symbol, trade.stopLossOrderId);
          } catch (e: any) {
            logger.warn({ uid, symbol: trade.symbol, error: e.message }, 'Failed to cancel SL order');
          }
        }

        // B. Place Market Close Order
        const closeSide = trade.side === 'BUY' ? 'SELL' : 'BUY';

        // Execute Market Close
        const order = await engine.adapter!.placeOrder({
          symbol: trade.symbol,
          side: closeSide,
          type: 'MARKET',
          quantity: trade.quantity
        });

        // C. Update internal state
        trade.status = 'PANIC_CLOSED';
        engine.activeTrades.delete(trade.tradeId);

        // D. Log success
        await this.logTradeEvent(uid, 'PANIC_CLOSED', {
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          exitPrice: order.avgPrice || order.price,
          reason: 'Panic Stop',
          timestamp: new Date()
        });

      } catch (error: any) {
        logger.error({ uid, tradeId: trade.tradeId, error: error.message }, 'Failed to panic close trade');
        await this.logTradeEvent(uid, 'PANIC_CLOSE_FAILED', {
          tradeId: trade.tradeId,
          symbol: trade.symbol,
          error: error.message
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

      // We need an adapter to check status
      if (!engine.adapter && engine.activeTrades.size > 0) {
        await this.initializeAdapter(uid);
      }

      if (!engine.adapter || engine.activeTrades.size === 0) return;

      logger.info({ uid, activeTradeCount: engine.activeTrades.size }, 'Monitoring active trades');

      const tradesToRemove: string[] = [];

      for (const [tradeId, trade] of engine.activeTrades.entries()) {
        // Only monitor filled trades that are currently considered OPEN in our system
        if (trade.status !== 'FILLED') continue;

        try {
          // Check TP/SL status
          let isClosed = false;
          let closeReason = '';

          let tpStatus = 'UNKNOWN';
          let slStatus = 'UNKNOWN';

          // SCALPING: Check multiple TP orders for partial closes
          if (trade.isScalping) {
            // Check TP1
            if (trade.takeProfit1OrderId && !trade.tp1Hit) {
              try {
                const tp1Order = await engine.adapter.getOrderStatus(trade.symbol, trade.takeProfit1OrderId);
                if (tp1Order.status === 'FILLED') {
                  trade.tp1Hit = true;
                  const closedQty = trade.originalQuantity! * 0.5;
                  trade.remainingQuantity = (trade.remainingQuantity || trade.originalQuantity!) - closedQty;

                  // TRAILING SL: Move SL to entry price (break-even)
                  // CRITICAL: SL must NEVER move backward
                  const newSL = trade.entryPrice;
                  const currentSL = trade.trailingStopLoss || trade.stopLoss;

                  // Ensure SL never moves backward (for BUY: newSL >= currentSL, for SELL: newSL <= currentSL)
                  const slMovedBackward = trade.side === 'BUY'
                    ? (newSL < currentSL)
                    : (newSL > currentSL);

                  if (slMovedBackward) {
                    logger.warn({
                      uid,
                      tradeId,
                      currentSL,
                      attemptedNewSL: newSL,
                      side: trade.side
                    }, '[SCALPING] Trailing SL to entry would move backward - keeping current SL');
                    continue; // Skip SL update
                  }

                  if (trade.trailingStopLoss !== newSL) {
                    // Cancel old SL order
                    if (trade.stopLossOrderId) {
                      try {
                        await engine.adapter.cancelOrder(trade.symbol, trade.stopLossOrderId);
                      } catch (cancelErr) {
                        logger.warn({ uid, tradeId, error: cancelErr }, 'Failed to cancel old SL for trailing');
                      }
                    }

                    // Place new SL at entry
                    const newSLOrder = await engine.adapter.placeOrder({
                      symbol: trade.symbol,
                      side: trade.side === 'BUY' ? 'SELL' : 'BUY',
                      type: 'LIMIT',
                      quantity: trade.remainingQuantity!,
                      price: newSL
                    });

                    trade.stopLossOrderId = newSLOrder.exchangeOrderId || newSLOrder.clientOrderId;
                    trade.trailingStopLoss = newSL;

                    logger.info({
                      uid,
                      tradeId,
                      symbol: trade.symbol,
                      tp1Price: trade.takeProfit1,
                      closedQty,
                      remainingQty: trade.remainingQuantity,
                      newSL: newSL,
                      slOrderId: trade.stopLossOrderId
                    }, '[SCALPING] TP1 HIT → 50% closed, SL moved to entry (break-even)');

                    await this.logTradeEvent(uid, 'SCALPING_TP1_HIT', {
                      tradeId,
                      symbol: trade.symbol,
                      closedQty,
                      remainingQty: trade.remainingQuantity,
                      slMovedToEntry: true
                    });
                  }
                }
              } catch (e: any) {
                logger.warn({ uid, tradeId, error: e.message }, 'Failed to fetch TP1 order status');
              }
            }

            // Check TP2
            if (trade.takeProfit2OrderId && trade.tp1Hit && !trade.tp2Hit) {
              try {
                const tp2Order = await engine.adapter.getOrderStatus(trade.symbol, trade.takeProfit2OrderId);
                if (tp2Order.status === 'FILLED') {
                  trade.tp2Hit = true;
                  const closedQty = trade.originalQuantity! * 0.2; // Additional 20%
                  trade.remainingQuantity = (trade.remainingQuantity || trade.originalQuantity!) - closedQty;

                  // TRAILING SL: Move SL to entry + 0.2% (small profit buffer)
                  // CRITICAL: SL must NEVER move backward
                  const profitBuffer = trade.entryPrice * 0.002; // 0.2%
                  const newSL = trade.side === 'BUY'
                    ? trade.entryPrice + profitBuffer
                    : trade.entryPrice - profitBuffer;

                  // Ensure SL never moves backward (for BUY: newSL >= currentSL, for SELL: newSL <= currentSL)
                  const currentSL = trade.trailingStopLoss || trade.stopLoss;
                  const slMovedBackward = trade.side === 'BUY'
                    ? (newSL < currentSL)
                    : (newSL > currentSL);

                  if (slMovedBackward) {
                    logger.warn({
                      uid,
                      tradeId,
                      currentSL,
                      attemptedNewSL: newSL,
                      side: trade.side
                    }, '[SCALPING] Trailing SL would move backward - keeping current SL');
                    continue; // Skip SL update
                  }

                  if (trade.trailingStopLoss !== newSL) {
                    // Cancel old SL order
                    if (trade.stopLossOrderId) {
                      try {
                        await engine.adapter.cancelOrder(trade.symbol, trade.stopLossOrderId);
                      } catch (cancelErr) {
                        logger.warn({ uid, tradeId, error: cancelErr }, 'Failed to cancel old SL for trailing');
                      }
                    }

                    // Place new trailing SL
                    const newSLOrder = await engine.adapter.placeOrder({
                      symbol: trade.symbol,
                      side: trade.side === 'BUY' ? 'SELL' : 'BUY',
                      type: 'LIMIT',
                      quantity: trade.remainingQuantity!,
                      price: newSL
                    });

                    trade.stopLossOrderId = newSLOrder.exchangeOrderId || newSLOrder.clientOrderId;
                    trade.trailingStopLoss = newSL;

                    logger.info({
                      uid,
                      tradeId,
                      symbol: trade.symbol,
                      tp2Price: trade.takeProfit2,
                      closedQty,
                      remainingQty: trade.remainingQuantity,
                      newSL: newSL,
                      slOrderId: trade.stopLossOrderId
                    }, '[SCALPING] TP2 HIT → 70% total closed, SL trailed to entry +0.2%');

                    await this.logTradeEvent(uid, 'SCALPING_TP2_HIT', {
                      tradeId,
                      symbol: trade.symbol,
                      closedQty,
                      remainingQty: trade.remainingQuantity,
                      slTrailed: true,
                      slPrice: newSL
                    });
                  }
                }
              } catch (e: any) {
                logger.warn({ uid, tradeId, error: e.message }, 'Failed to fetch TP2 order status');
              }
            }

            // Check TP3 (full exit)
            if (trade.takeProfit3OrderId && trade.tp2Hit && !trade.tp3Hit) {
              try {
                const tp3Order = await engine.adapter.getOrderStatus(trade.symbol, trade.takeProfit3OrderId);
                if (tp3Order.status === 'FILLED') {
                  trade.tp3Hit = true;
                  isClosed = true;
                  closeReason = 'TAKE_PROFIT3_FILLED';

                  logger.info({
                    uid,
                    tradeId,
                    symbol: trade.symbol,
                    tp3Price: trade.takeProfit3,
                    totalClosed: trade.originalQuantity
                  }, '[SCALPING] TP3 HIT → 100% closed, full exit');

                  await this.logTradeEvent(uid, 'SCALPING_TP3_HIT', {
                    tradeId,
                    symbol: trade.symbol,
                    fullExit: true
                  });
                }
              } catch (e: any) {
                logger.warn({ uid, tradeId, error: e.message }, 'Failed to fetch TP3 order status');
              }
            }
          } else {
            // NON-SCALPING: Legacy single TP check
            if (trade.takeProfitOrderId) {
              try {
                const tpOrder = await engine.adapter.getOrderStatus(trade.symbol, trade.takeProfitOrderId);
                tpStatus = tpOrder.status;
                if (tpStatus === 'FILLED') {
                  isClosed = true;
                  closeReason = 'TAKE_PROFIT_FILLED';
                }
              } catch (e: any) {
                logger.warn({ uid, tradeId, error: e.message }, 'Failed to fetch TP order status');
              }
            }
          }

          // Check SL Order (if not already known closed)
          if (!isClosed && trade.stopLossOrderId) {
            try {
              const slOrder = await engine.adapter.getOrderStatus(trade.symbol, trade.stopLossOrderId);
              slStatus = slOrder.status;
              if (slStatus === 'FILLED') {
                isClosed = true;
                closeReason = 'STOP_LOSS_FILLED';
              }
            } catch (e: any) {
              logger.warn({ uid, tradeId, error: e.message }, 'Failed to fetch SL order status');
            }
          }

          // Update trade in memory after partial closes
          engine.activeTrades.set(tradeId, trade);

          if (isClosed) {
            logger.info({ uid, tradeId, reason: closeReason }, 'Trade closed by exchange order');
            tradesToRemove.push(tradeId);

            // P3-A: Loss Streak Tracking
            let consecutiveLosses = engine.config.consecutiveLosses || 0;
            let cooldownUntil = engine.config.cooldownUntil;
            let enteredCooldown = false;

            if (closeReason === 'STOP_LOSS_FILLED') {
              consecutiveLosses++;
              // Max consecutive losses = 2 (hardcoded for P3-A as requested)
              if (consecutiveLosses >= 2) {
                // Enter 24h Cooldown
                const cooldownDurationMs = 24 * 60 * 60 * 1000;
                cooldownUntil = new Date(Date.now() + cooldownDurationMs);
                enteredCooldown = true;

                logger.warn({ uid, consecutiveLosses }, '🚨 MAX CONSECUTIVE LOSSES REACHED: Entering 24h Cooldown.');
              }
            } else if (closeReason === 'TAKE_PROFIT_FILLED') {
              // Reset on win
              consecutiveLosses = 0;
            }

            // Persist state
            await this.saveConfig(uid, {
              consecutiveLosses,
              cooldownUntil
            });

            if (enteredCooldown) {
              await this.logTradeEvent(uid, 'COOLDOWN_ENTERED', {
                reason: 'Max consecutive losses reached',
                duration: '24h',
                consecutiveLosses
              });
            }

            const stats = engine.config.stats || { totalTrades: 0, winningTrades: 0, losingTrades: 0, totalPnL: 0, dailyPnL: 0, dailyTrades: 0 };

            // Note: Accurate PnL requires fetch of fill price. 
            // For P1/Stabilization, we log the event and remove the trade to allow new trades.
            // Logic to update PnL stats specifically should be added in P2.

            await this.logTradeEvent(uid, 'TRADE_CLOSED', {
              tradeId,
              symbol: trade.symbol,
              reason: closeReason,
              timestamp: new Date()
            });

            // NOTIFICATION: Telegram Closed Alert
            try {
              const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
              if (bgSettings?.backgroundResearchEnabled && bgSettings?.telegramBotToken && bgSettings?.telegramChatId) {
                const { telegramService } = await import('./telegramService');

                // Determine reason for Telegram
                let telegramReason: 'TP' | 'SL' | 'MANUAL' | 'PANIC' = 'TP';
                if (closeReason.includes('STOP_LOSS')) telegramReason = 'SL';
                else if (closeReason.includes('PANIC')) telegramReason = 'PANIC';
                else if (closeReason.includes('MANUAL')) telegramReason = 'MANUAL';

                telegramService.sendTradeClosedAlert(
                  bgSettings.telegramBotToken,
                  bgSettings.telegramChatId,
                  {
                    symbol: trade.symbol,
                    side: trade.side as 'BUY' | 'SELL',
                    exitPrice: 0, // Placeholder as PnL/Exit price isn't fully tracked here yet in P1
                    pnl: 0,       // Placeholder
                    reason: telegramReason
                  }
                );
              }
            } catch (e) {
              logger.warn({ uid }, 'Failed to send Telegram closed alert');
            }

            continue;
          }

          // P1.6 ORPHAN PROTECTION
          // Check if both TP and SL are missing or inactive (CANCELED/REJECTED/EXPIRED/UNKNOWN)
          const isTpActive = ['NEW', 'PARTIALLY_FILLED'].includes(tpStatus);
          const isSlActive = ['NEW', 'PARTIALLY_FILLED'].includes(slStatus);

          // If we had IDs but neither is active now (and trade is not closed), it's an orphan
          if (trade.takeProfitOrderId && trade.stopLossOrderId && !isTpActive && !isSlActive) {
            logger.warn({ uid, tradeId, symbol: trade.symbol }, '🚨 ORPHAN TRADE DETECTED: Position is UNPROTECTED (No active TP/SL)');
            // Log only, do not auto-close in P1 significantly to avoid race conditions with manual user actions
          }

        } catch (error: any) {
          logger.error({ uid, tradeId, error: error.message }, 'Error monitoring trade');
        }
      }





      // Cleanup closed trades from memory
      for (const id of tradesToRemove) {
        engine.activeTrades.delete(id);
      }

    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Fatal error in monitorActiveTrades');
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
  async startAutoTradeLoop(uid: string, researchFrequencyMinutes?: number): Promise<void> {
    logger.info({ uid, researchFrequencyMinutes }, '🔄 [AUTOTRADE] Starting auto-trade for user - Persisting state and triggering scheduler');

    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);

      // 1. Get existing background research settings to preserve frequency if not provided
      const existingBgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);
      const finalFrequency = researchFrequencyMinutes || existingBgSettings?.researchFrequencyMinutes || 5;

      // 2. Update autoTradeConfig - ensure engine knows it should be enabled
      await userRef.collection('autoTradeConfig').doc('current').set({
        autoTradeEnabled: true,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      // 3. Update backgroundResearchSettings - ensure scheduler knows it should run
      // CRITICAL: Persist research frequency for scheduler
      await userRef.collection('settings').doc('backgroundResearch').set({
        backgroundResearchEnabled: true,
        researchFrequencyMinutes: finalFrequency,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      // 4. Trigger immediate schedule update in BackgroundResearchScheduler
      const { backgroundResearchScheduler } = await import('./backgroundResearchScheduler');
      await backgroundResearchScheduler.onUserSettingsChanged(uid);

      logger.info({ uid, frequency: finalFrequency }, '✅ [AUTOTRADE] Auto-trade enabled and scheduled successfully');
    } catch (err: any) {
      logger.error({ uid, error: err.message }, '❌ [AUTOTRADE] Failed to start/persist auto-trade state');
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
  async runAutoTradeResearchCycleSafe(uid: string, skipHistoryStorage: boolean = false): Promise<ResearchDataResult | null> {
    console.log('🔥 [HARD_LOG] [AUTO_TRADE_SAFE_START] runAutoTradeResearchCycleSafe() called for user:', uid, 'skipHistoryStorage:', skipHistoryStorage);
    // Check if we should run
    if (!shouldRunBackgroundTasks()) {
      logger.debug({ uid }, 'Skipping research cycle - background tasks paused');
      return null;
    }

    // Yield control before heavy operations
    await yieldToEventLoop();

    // 🔥 DEBUG: Log auto-trade research cycle start
    logger.info({
      uid,
      skipHistoryStorage,
      serverSide: true,
      frontendIndependent: true
    }, '🔍 [AUTO_TRADE_LIFECYCLE_DEBUG] Starting auto-trade research cycle - server-side only');

    // Run the actual research cycle
    return await this.runAutoTradeResearchCycle(uid, skipHistoryStorage);
  }

  /**
   * Stop auto-trade background research loop for a user
   */
  async stopAutoTradeLoop(uid: string): Promise<void> {
    logger.info({ uid }, '🔄 [AUTOTRADE] Stopping auto-trade for user - Persisting state and triggering scheduler');

    try {
      const db = getFirebaseAdmin().firestore();
      const userRef = db.collection('users').doc(uid);

      // 1. Update autoTradeConfig
      await userRef.collection('autoTradeConfig').doc('current').set({
        autoTradeEnabled: false,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      // 2. Update backgroundResearchSettings
      await userRef.collection('settings').doc('backgroundResearch').set({
        backgroundResearchEnabled: false,
        updatedAt: admin.firestore.Timestamp.now()
      }, { merge: true });

      // 3. Trigger scheduler update (which will disable the job)
      const { backgroundResearchScheduler } = await import('./backgroundResearchScheduler');
      await backgroundResearchScheduler.onUserSettingsChanged(uid);

      logger.info({ uid }, '✅ [AUTOTRADE] Auto-trade disabled and unscheduled successfully');
    } catch (err: any) {
      logger.error({ uid, error: err.message }, '❌ [AUTOTRADE] Failed to stop/persist auto-trade state');
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
      const { backgroundResearchScheduler } = await import('./backgroundResearchScheduler');
      const hasInterval = backgroundResearchScheduler.isUserScheduled(uid);
      const jobState = backgroundResearchScheduler.getUserJobState(uid);

      if (hasInterval && jobState) {
        const mode = (jobState as any).mode;
        // Auto-trade is running if scheduler has interval and mode is AUTO_TRADE_RESEARCH
        if (mode === 'AUTO_TRADE_RESEARCH') {
          return true;
        }
      }

      // Fallback: Check Firestore config
      const config = await this.loadConfig(uid);
      return config.autoTradeEnabled === true;
    } catch (error: any) {
      logger.warn({ uid, error: error.message }, 'Failed to check auto-trade running state, using config fallback');
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
    if (process.env.DISABLE_AUTOTRADE === 'true') {
      logger.warn('Auto-trade bootstrap aborted: DISABLE_AUTOTRADE=true');
      return;
    }

    try {
      logger.info('🔄 [AUTOTRADE] Bootstrapping enabled loops for all users...');
      const db = getFirebaseAdmin().firestore();

      const usersSnapshot = await db.collection('users').get();
      let count = 0;

      for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;

        if (uid.startsWith('_')) continue;

        try {
          const config = await this.loadConfig(uid);
          if (config.autoTradeEnabled) {
            await this.startAutoTradeLoop(uid);
            count++;
            logger.info({ uid }, '✅ [BOOTSTRAP] Resumed auto-trade loop for user');
          }
        } catch (userErr: any) {
          logger.warn({ uid, error: userErr.message }, '⚠️ [BOOTSTRAP] Failed to resume loop for user, skipping');
        }
      }

      logger.info({ count }, `✅ [BOOTSTRAP] Multi-user auto-trade bootstrap completed. Resumed ${count} loops.`);
    } catch (error: any) {
      logger.error({ error: error.message }, '❌ [BOOTSTRAP] Fatal error during auto-trade bootstrap');
    }
  }

  /**
   * Get last research time for a user
   * CRITICAL: Now uses BackgroundResearchScheduler state (single source of truth)
   */
  async getLastResearchTime(uid: string): Promise<string | null> {
    try {
      // Check scheduler state (single source of truth)
      const { backgroundResearchScheduler } = await import('./backgroundResearchScheduler');
      const jobState = backgroundResearchScheduler.getUserJobState(uid);
      if (jobState?.lastRunAt) {
        return jobState.lastRunAt.toISOString();
      }

      // Fallback: Check Firestore research history
      const history = await firestoreAdapter.getResearchHistory(uid, 1);
      if (history && history.length > 0 && history[0].timestamp) {
        return typeof history[0].timestamp === 'string'
          ? history[0].timestamp
          : new Date(history[0].timestamp).toISOString();
      }

      return null;
    } catch (error: any) {
      logger.warn({ uid, error: error.message }, 'Failed to get last research time, using history fallback');
      // Fallback: Check Firestore research history
      try {
        const history = await firestoreAdapter.getResearchHistory(uid, 1);
        if (history && history.length > 0 && history[0].timestamp) {
          return typeof history[0].timestamp === 'string'
            ? history[0].timestamp
            : new Date(history[0].timestamp).toISOString();
        }
      } catch (histError: any) {
        logger.warn({ uid, error: histError.message }, 'Failed to get research history');
      }
      return null;
    }
  }

  /**
   * Get current market price for a symbol
   */
  private async getCurrentMarketPrice(symbol: string, uid: string): Promise<number> {
    try {
      // Try to get from exchange if adapter is available
      const engine = await this.getUserEngine(uid);
      if (engine.adapter) {
        const ticker = await engine.adapter.getTicker(symbol);
        return parseFloat(ticker.price.toString());
      }
    } catch (error: any) {
      logger.warn({ uid, symbol, error: error.message }, 'Could not get price from exchange');
      // P0 FIX: Throw hard error instead of dangerous fallback
      throw new Error(`PRICE_FETCH_FAILED: Could not get market price for ${symbol} - Trade aborted for safety`);
    }

    // If no adapter or failed to get price
    throw new Error(`PRICE_FETCH_FAILED: No adapter available or price fetch failed for ${symbol}`);
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
  async runAutoTradeResearchCycle(uid: string, skipHistoryStorage: boolean = false): Promise<ResearchDataResult | null> {
    console.log('🔥 [HARD_LOG] [AUTO_TRADE_CYCLE_START] runAutoTradeResearchCycle() called for user:', uid, 'skipHistoryStorage:', skipHistoryStorage);
    // CRITICAL: Prevent duplicate execution per cycle using uid+timestamp key
    // This ensures only ONE execution per user per cycle, even if called multiple times
    const cycleStartTime = new Date();
    let cycleResult: AutoTradeReason = AUTO_TRADE_REASONS.NO_SIGNAL;
    let accuracy = 0;
    let signal: TradeSignalType | 'UNKNOWN' | 'ANALYZING' | 'PENDING' = 'UNKNOWN';
    let skipReason = '';
    // CRITICAL: Track decision status and execution details for history
    let decisionStatus: 'EXECUTED' | 'SKIPPED' = 'SKIPPED';
    let tradeId: string | null = null;
    // CRITICAL: Track if history was already saved in this cycle to prevent duplicates
    let historySaved = false;
    let historySavedSymbol: string | null = null;
    // CRITICAL: Track if execution is blocked (e.g. exchange decryption failed) but research should continue
    let executionBlocked = false;
    let executionBlockReason = '';

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

    // Check if cycle is already running (within same second window)
    const cycleWindow = Math.floor(Date.now() / 1000); // 1-second window
    const cycleId = `${uid}_${cycleWindow}`;
    if (activeCycles.has(cycleId)) {
      const reason = 'DUPLICATE_CYCLE: Auto-trade cycle already running for this user';
      logger.warn({
        uid,
        cycleId,
        duplicateBlocked: true
      }, '⏭️ [CYCLE_GUARD] BLOCKED: Duplicate auto-trade cycle execution prevented - cycle already running');
      await this.logAutoTradeSkip(uid, reason, {
        exchangeStatus: 'unknown',
        additionalDetails: {
          cycleId,
          duplicateBlocked: true
        }
      });
      return null; // Return null to prevent duplicate execution
    }
    activeCycles.add(cycleId);

    // Cleanup: Remove cycle ID after 5 seconds (cycle should complete by then)
    setTimeout(() => {
      activeCycles.delete(cycleId);
    }, 5000);

    try {
      // 1. Initial Guards
      // CRITICAL: These guards only prevent research if system-wide flags are set
      // They do NOT check accuracy, signal, or trade conditions (those are evaluated AFTER research)
      if (process.env.DISABLE_AUTOTRADE === 'true') {
        const reason = 'DISABLE_AUTOTRADE_ENV_FLAG: Auto-trade disabled by environment variable';
        logger.info({ uid, reason }, '⏭️ [AUTO_TRADE_SKIP] Research skipped - DISABLE_AUTOTRADE env flag set');
        await this.logAutoTradeSkip(uid, reason, {
          exchangeStatus: 'unknown',
        });
        return null;
      }
      if (!shouldRunBackgroundTasks()) {
        const reason = 'BACKGROUND_TASKS_PAUSED: Background tasks are paused';
        logger.info({ uid, reason }, '⏭️ [AUTO_TRADE_SKIP] Research skipped - background tasks paused');
        await this.logAutoTradeSkip(uid, reason, {
          exchangeStatus: 'unknown',
        });
        return null;
      }

      logger.info({ uid, cycleStartTime: cycleStartTime.toISOString() }, '🔄 [CYCLE_START] Auto-trade research cycle initiated');
      console.log('🔥 [HARD_LOG] [AUTO_TRADE_CYCLE_INIT] Auto-trade research cycle initiated for user:', uid);

      // 2. Load Settings & Integrations
      const settings = await AutoTradeEngine.getTradingSettings(uid);
      const { getUserIntegrations } = await import('../routes/integrations');
      const integrationResult = await getUserIntegrations(uid);
      const integrations = (integrationResult as any).providerConfig;

      // Verify Research API Keys (Standard Logic Requirement)
      const hasResearchKeys = (integrations?.marketData && Object.keys(integrations.marketData).length > 0) ||
        (integrations?.metadata && Object.keys(integrations.metadata).length > 0);

      if (!hasResearchKeys) {
        // CRITICAL: Do NOT store history for skipped cycles (no research keys)
        // History should only be stored for completed FINAL research with real accuracy values
        // Skipped cycles do NOT represent completed research
        const reason = AUTO_TRADE_REASONS.NO_RESEARCH_KEYS;
        logger.info({
          uid,
          skipReason: reason,
          historyBlocked: true,
          reason: 'Research keys missing - research did not execute'
        }, '⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save for no-research-keys - only FINAL completed research should be saved');

        await this.logAutoTradeSkip(uid, reason, {
          exchangeStatus: 'unknown',
          additionalDetails: {
            details: 'No research API keys configured. Please add keys to enable auto-trading.',
          }
        });
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', {
          reason,
          details: 'No research API keys configured. Please add keys to enable auto-trading.',
          timestamp: new Date().toISOString()
        });
        // Return null instead of throwing - this is a configuration issue, not a system error

        // CRITICAL: Do NOT save history when research did NOT run (no research keys)
        // History should ONLY be saved when research actually executed and produced results
        // BTCUSDT fallback removed - only save history with REAL research data
        logger.info({
          uid,
          skipReason: reason,
          historyBlocked: true,
          reason: 'Research did not run - no history saved (BTC fallback removed)'
        }, '⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save - research did not run (no research keys). History only saved when research executes.');

        return null;
      }

      // 3. CRITICAL: Early exchange decryption check for AUTO_TRADE_RESEARCH mode
      // Skip deep research if exchange API key decryption fails to prevent "missing final aggregated data" errors
      let exchangeDecryptionFailed = false;
      let exchangeDecryptionError: string | null = null;

      try {
        const { resolveExchangeConnector } = await import('./exchangeResolver');
        const exchangeResolved = await resolveExchangeConnector(uid);

        if (!exchangeResolved) {
          // Check if exchange config exists but decryption failed
          const db = getFirebaseAdmin().firestore();
          const exchangeConfigDoc = await db.collection('users').doc(uid).collection('exchangeConfig').doc('current').get();

          if (exchangeConfigDoc.exists && exchangeConfigDoc.data()?.apiKeyEncrypted) {
            // Exchange config exists but resolver returned null - likely decryption failure
            try {
              const { decryptOrThrow } = await import('./keyManager');
              decryptOrThrow(exchangeConfigDoc.data()!.apiKeyEncrypted, 'API key');
              // If we get here, decryption worked - something else is wrong
            } catch (decryptErr: any) {
              // Decryption failed - this is the root cause
              exchangeDecryptionFailed = true;
              exchangeDecryptionError = decryptErr.message || 'EXCHANGE_KEY_DECRYPTION_FAILED';
            }
          }
        }
      } catch (resolveErr: any) {
        if (resolveErr.message?.includes('EXCHANGE_KEY_DECRYPTION_FAILED') ||
          resolveErr.message?.includes('decryption failed') ||
          resolveErr.message?.includes('invalid ENCRYPTION_SECRET')) {
          exchangeDecryptionFailed = true;
          exchangeDecryptionError = resolveErr.message;
        }
      }

      // CRITICAL: If exchange decryption failed, do NOT skip research.
      // Research must run to support Telegram alerts and History. Only EXECUTION is blocked.
      if (exchangeDecryptionFailed) {
        executionBlocked = true;
        executionBlockReason = exchangeDecryptionError || 'EXCHANGE_KEY_DECRYPTION_FAILED';
        const reason = AUTO_TRADE_REASONS.SKIPPED_EXCHANGE_UNAVAILABLE;

        logger.warn({
          uid,
          error: exchangeDecryptionError
        }, '⚠️ [AUTO_TRADE] Exchange key decryption failed - processing restricted to RESEARCH ONLY (Execution blocked)');

        // Log activity but CONTINUE to research
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', {
          reason,
          details: 'Exchange API key decryption failed. Execution blocked, but research will continue.',
          error: exchangeDecryptionError,
          timestamp: new Date().toISOString()
        });

        // DO NOT RETURN NULL - Proceed to research
      }

      // 4. Trade Monitoring (Cleanup)
      await withTimeout(() => this.monitorActiveTrades(uid), 5000);

      // HEARTBEAT: Log cycle start (fires even if no trade happens)
      logger.info({
        uid,
        cycleRunning: true,
        timestamp: new Date().toISOString()
      }, '[AUTO_TRADE_HEARTBEAT] cycleRunning=true');

      // 5. Run Research with error handling
      let researchData: ResearchData;
      let researchError: any = null;

      // CRITICAL: Store selected symbol BEFORE research to avoid BTC fallback on error
      let selectedSymbolForHistory: string | null = null;
      
      try {
        researchData = await runDeepResearchWithCoinSelection(uid, settings, undefined, integrations);
        // Extract selected symbol from research data (coinsAnalyzed is populated even on partial failure)
        selectedSymbolForHistory = researchData.coinsAnalyzed?.[0] || researchData.results?.[0]?.symbol || null;
      } catch (researchErr: any) {
        researchError = researchErr;
        logger.error({ uid, error: researchErr.message }, '❌ [AUTO_TRADE] Research execution failed');

        // CRITICAL FIX: Only skip history if coin selection NEVER happened
        // If coin selection already happened (symbol exists), history MUST be saved even if execution fails
        // Check if we have ANY symbol available (selectedSymbolForHistory, researchData, or researchResult.symbol)
        let symbolForHistory = selectedSymbolForHistory;
        // Try to extract symbol from partial researchData if it exists (might be available even on error)
        if (!symbolForHistory && researchData) {
          symbolForHistory = researchData.coinsAnalyzed?.[0] || researchData.results?.[0]?.symbol || null;
        }
        // Also check researchResult.symbol if researchData exists (might be partially populated)
        if (!symbolForHistory && researchData?.results?.[0]?.symbol) {
          symbolForHistory = researchData.results[0].symbol;
        }
        
        // Only skip history if NO symbol was ever selected (research failed before coin selection)
        // History MUST be saved if ANY symbol exists (selectedSymbolForHistory, researchResult.symbol, or from researchData)
        if (!symbolForHistory) {
          // Only skip if coin selection truly never happened (research failed before selection)
          // This is acceptable - research never started, so no history needed
          logger.warn({ 
            uid, 
            error: researchErr.message,
            historyBlocked: true,
            reason: 'Research failed before coin selection - no history saved'
          }, '⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save - research failed before coin selection (no symbol available). History only saved when research executes successfully.');
          await this.logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
            exchangeStatus: 'available',
            additionalDetails: {
              error: researchErr.message,
              details: 'Research execution failed before producing results'
            }
          });
          return null;
        }
        // CRITICAL: If research failed, do NOT save history with accuracy=0
        // History must only reflect real research runs with valid accuracy calculations
        // Research that fails before completion should not generate history entries

        // Log skip and return null
        await this.logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
          exchangeStatus: 'available',
          additionalDetails: {
            error: researchErr.message,
            details: 'Research execution failed'
          }
        });
        return null;
      }

      // Get symbol from researchData (from coinsAnalyzed or first result)
      // CRITICAL: Remove BTC fallback - if no symbol available, use null and save history anyway
      const researchSymbol = researchData.coinsAnalyzed?.[0] ||
        researchData.results?.[0]?.symbol ||
        null; // NO BTC fallback - use null and save history with null symbol

      if (!researchData.results || researchData.results.length === 0) {
        skipReason = AUTO_TRADE_REASONS.NO_SIGNAL;
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;

        // CRITICAL: Do NOT save history when research produces no results
        // History must only reflect real research runs with valid accuracy calculations
        // Research that produces no results should not generate history entries with accuracy=0

        await this.logAutoTradeSkip(uid, skipReason, {
          symbol: researchSymbol,
          exchangeStatus: 'available',
          additionalDetails: {
            resultsCount: researchData.results?.length || 0,
          }
        });
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', { reason: skipReason, timestamp: new Date().toISOString() });
        return null;
      }

      const researchResult = researchData.results[0];

      // CRITICAL: Verify symbol is in Top 25 before processing
      // CRITICAL FIX: Safe call to isSymbolInTop10 - ensure method exists before calling
      // Default to PASS (allow research) if any error occurs - never crash research
      let symbolTop25Check = true; // Default to PASS - only block if check succeeds and returns false
      try {
        if (this && typeof this.isSymbolInTop10 === 'function') {
          symbolTop25Check = await this.isSymbolInTop10(uid, researchResult.symbol);
        } else {
          // Fallback: use direct helper if method not available
          try {
            const { getTop100Coins } = await import('./researchModes');
            const top25 = await getTop100Coins(uid, 25);
            const normalizedSymbol = researchResult.symbol.toUpperCase();
            symbolTop25Check = top25.some(coin => coin.symbol === normalizedSymbol);
          } catch (fallbackError: any) {
            logger.error({ uid, symbol: researchResult.symbol, error: fallbackError.message }, '❌ [TOP_25_ERROR] Fallback helper failed - defaulting to PASS');
            symbolTop25Check = true; // Default to PASS on fallback error
          }
        }
      } catch (error: any) {
        logger.error({ uid, symbol: researchResult.symbol, error: error.message }, '❌ [TOP_25_ERROR] Error checking if symbol is in top 25 - defaulting to PASS');
        // On error, be safe and allow (don't block research) - default to PASS
        symbolTop25Check = true;
      }
      if (!symbolTop25Check) {
        logger.error({
          uid,
          symbol: researchResult.symbol,
          stack: new Error().stack
        }, '❌ [TOP_25_VIOLATION] Research result symbol outside Top 25 - blocking execution');

        // CRITICAL: Do NOT save history when symbol violates Top 25 constraint
        // Research may have run, but results are invalid - do not pollute history with invalid data

        await this.logAutoTradeSkip(uid, 'NOT_TOP_25', {
          symbol: researchResult.symbol,
          exchangeStatus: 'available',
          additionalDetails: {
            reason: 'Symbol outside Top 25 detected in research result'
          }
        });
        return null;
      }

      // CRITICAL: Use FINAL Deep Research result as source of truth
      // researchResult.result is the full FreeModeDeepResearchResult from researchAggregator
      const finalResult = researchResult.result;

      if (!finalResult) {
        logger.error({ uid, symbol: researchResult.symbol }, '❌ [AUTO_TRADE] No final result available - cannot proceed');

        // CRITICAL: Do NOT save history when final result is missing
        // Research incomplete - do not generate history entries without valid final result

        await this.logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
          symbol: researchResult.symbol,
          exchangeStatus: 'available',
          additionalDetails: {
            details: 'Research result missing final aggregated data'
          }
        });
        return null;
      }

      // CRITICAL: Extract FINAL signal from aggregated result (source of truth)
      signal = finalResult.signal || researchResult.signal || 'HOLD';

      // CRITICAL: Extract FINAL accuracy from aggregated result using centralized AccuracyGuard
      // finalResult.accuracy is the final aggregated accuracy from researchAggregator
      const finalAccuracyRaw = finalResult.accuracy;
      const accuracyValidation = AccuracyGuard.validateAndNormalize(finalAccuracyRaw);
      if (!accuracyValidation.isValid) {
        logger.error({
          uid,
          symbol: researchResult.symbol,
          accuracy: finalAccuracyRaw,
          reason: accuracyValidation.reason
        }, '❌ [AUTO_TRADE] Invalid accuracy in final result - cannot proceed');

        // CRITICAL: Do NOT save history when accuracy is invalid
        // Research produced invalid accuracy - do not generate history entries

        // Return null instead of throwing - this is a data validation failure, not a system error
        return null;
      }
      const accuracy = accuracyValidation.normalizedAccuracy;

      // INSTRUMENTATION: Log research cycle details
      logger.info({
        uid,
        symbol: researchResult.symbol,
        accuracy,
        signal,
        isFinal: finalResult.isFinal,
        hasTradePlan: !!finalResult.tradePlan,
        top25Verified: true,
        timestamp: new Date().toISOString()
      }, '🔍 [TOP_25_RESEARCH] Research cycle completed - Top 25 verified, accuracy calculated');

      // CRITICAL HARD GUARD: Detect if this is a FINAL guard cached result (execution was skipped)
      // FINAL guard returns cached results with isFinal=true but execution was NOT performed
      // These should NOT be saved to history as they represent skipped executions, not completed research
      const isCachedResult = finalResult.isFinal === true &&
        (finalResult as any).isProcessing === false &&
        accuracy === 0 &&
        signal === 'HOLD';

      if (isCachedResult) {
        logger.info({
          uid,
          symbol: researchResult.symbol,
          accuracy,
          signal,
          isFinal: finalResult.isFinal,
          historyBlocked: true,
          reason: 'FINAL guard cached result - execution was skipped, not a completed research'
        }, '⏭️ [HISTORY_GUARD] BLOCKED: Skipping history save for FINAL guard cached result - execution was skipped, not completed research');

        // CRITICAL: Do NOT save history for cached results with accuracy=0
        // History must only reflect real research runs with valid accuracy calculations

        await this.logAutoTradeSkip(uid, AUTO_TRADE_REASONS.NO_SIGNAL, {
          symbol: researchResult.symbol,
          exchangeStatus: 'available',
          additionalDetails: {
            details: 'FINAL guard cached result - execution was skipped'
          }
        });
        return null;
      }

      // CRITICAL: Extract FINAL trade plan from aggregated result (ensures consistency with signal/accuracy)
      // The tradePlan is at root level of FreeModeDeepResearchResult
      const finalTradePlan = finalResult.tradePlan || null;

      // INSTRUMENTATION: Log trade plan generation result
      logger.info({
        uid,
        symbol: researchResult.symbol,
        accuracy,
        signal,
        hasTradePlan: !!finalTradePlan,
        entryPrice: finalTradePlan?.entryPrice,
        stopLoss: finalTradePlan?.stopLoss,
        takeProfit: finalTradePlan?.takeProfit1 ?? finalTradePlan?.takeProfit2,
        riskRewardRatio: finalTradePlan?.riskRewardRatio,
        top25Verified: true,
        timestamp: new Date().toISOString()
      }, finalTradePlan ? '✅ [TOP_25_TRADE_PLAN] Trade plan generated successfully' : '⏭️ [TOP_25_TRADE_PLAN] Trade plan rejected (null)');

      // CRITICAL: Extract current market price from FINAL result
      // Priority: result.price > analysis.priceAction.price > indicators.price > metadata.price
      const historyPrice = finalResult.price ||
        finalResult.analysis?.priceAction?.currentPrice ||
        finalResult.analysis?.priceAction?.price ||
        finalResult.indicators?.price ||
        finalResult.metadata?.price ||
        0;

      // Validate price is valid
      if (historyPrice <= 0) {
        logger.warn({
          uid,
          symbol: researchResult.symbol,
          priceSources: {
            resultPrice: finalResult.price,
            analysisPrice: finalResult.analysis?.priceAction?.price,
            indicatorsPrice: finalResult.indicators?.price,
            metadataPrice: finalResult.metadata?.price
          }
        }, '⚠️ [HISTORY] Market price not found in final result - storing 0');
      }

      // CRITICAL: Store Auto-Trade research in history for UI visibility
      // This ensures users see what Auto-Trade is analyzing, even if valid trade is not executed
      // Store FINAL aggregated values (not partial/interim values)
      // CRITICAL: Ensure accuracy and signal are ALWAYS stored (never omitted)
      // CRITICAL: History is saved for EVERY cycle, regardless of execution (decision status tracked)
      // CRITICAL: Only store if skipHistoryStorage is false (caller handles storage for Telegram mode)
      if (!skipHistoryStorage && !historySaved) {
        try {
          // CRITICAL: History is saved for EVERY cycle, regardless of execution
          // Decision status (EXECUTED/SKIPPED) is tracked and included in history entry
          // CRITICAL HARD GUARD 1: Verify isFinal === true before saving FINAL research history
          // History must NEVER be saved for partial/intermediate results
          // However, we allow saving for SKIPPED cycles with valid research data
          if (finalResult.isFinal !== true && decisionStatus !== 'SKIPPED') {
            logger.error({
              uid,
              symbol: researchResult.symbol,
              isFinal: finalResult.isFinal,
              accuracy,
              signal,
              decisionStatus
            }, '❌ [HISTORY_GUARD] BLOCKED: History save attempted with isFinal !== true - this is a partial/intermediate result. Only FINAL research results can be saved to history.');
            throw new Error(`Cannot save history: research result is not final (isFinal=${finalResult.isFinal}). Only FINAL results can be saved to history. Partial/intermediate results are forbidden.`);
          }

          // CRITICAL: Do NOT save history with accuracy=0
          // History must only reflect real research runs with valid accuracy calculations (> 0)
          // If accuracy is 0, research either didn't run, failed, or didn't produce valid results - do not save history
          // This ensures UI never shows 0% accuracy unless it was genuinely calculated (which should never be exactly 0%)
          if (accuracy === 0) {
            logger.warn({
              uid,
              symbol: researchResult.symbol,
              accuracy,
              signal,
              decisionStatus,
              skipReason
            }, '⚠️ [HISTORY_GUARD] BLOCKED: Accuracy is 0 - research did not produce valid accuracy. History not saved.');
            throw new Error('Cannot save history: accuracy is 0. History must only reflect real research runs with valid accuracy calculations (> 0).');
          }

          // CRITICAL: Ensure signal is HOLD if accuracy < 60% (backend safety check for signal generation)
          // CRITICAL: Trade plan is only generated when accuracy >= 70% (enforced in researchAggregator)
          const finalSignal = (accuracy < 60 && signal !== 'HOLD') ? 'HOLD' : signal;

          // CRITICAL: Ensure accuracy is always a number (already validated above)
          // CRITICAL FIX: Use Number() || 0 for proper coercion to handle undefined/null properly
          const storedAccuracy = Math.max(0, Math.min(100, Number(accuracy) || 0)); // Clamp to 0-100 range, default to 0 if undefined

          // CRITICAL: Use tradePlan directly from researchAggregator (already validated there)
          // researchAggregator enforces: tradePlan is generated when accuracy >= 70% AND signal is BUY/SELL
          // Do NOT null tradePlan after accuracy validation - use it as-is from researchAggregator
          const safeTradePlan = finalTradePlan ?? null; // Use finalTradePlan directly, only ensure null (not undefined)

          // CRITICAL: Build history entry with FINAL result data - MUST match manual research payload exactly
          // CRITICAL: Mark source as AUTO_TRADE for auto-trade mode research
          // CRITICAL: Include decision status (EXECUTED/SKIPPED) and skipReason/tradeId
          // CRITICAL: Use FINAL tradePlan directly from researchAggregator - do NOT recompute
          // tradePlan from generateTradePlan has: entryPrice, stopLoss, takeProfit1, takeProfit2, takeProfit3, riskRewardRatio
          // For backward compatibility, takeProfit should be set to takeProfit2 (main TP)
          // CRITICAL FIX: Ensure NO undefined values in history entry
          // All fields must be explicitly set (null, 0, or valid value) - never undefined
          // CRITICAL: Use researchSymbol (extracted earlier) to ensure consistency with NO_SIGNAL handling
          // CRITICAL FIX: Ensure NO undefined values - enforce defaults BEFORE history save
          // CRITICAL: Enforce defaults - ensure NO undefined values
          // Use proper coercion: Number() || 0 for accuracy, ?? null for symbol/tradePlan
          const historySymbol = (researchSymbol ?? researchResult.symbol) ?? null; // Explicit null, never undefined
          const historyAccuracy = Number(storedAccuracy) || 0; // Use Number() || 0, explicit 0, never undefined
          const historySignal = finalSignal ?? 'HOLD'; // Explicit default, never undefined
          const historyPriceValue = Number(historyPrice) || 0; // Use Number() || 0, explicit 0, never undefined
          const historyTradePlan = safeTradePlan ?? null; // Explicit null, never undefined
          const historyDecisionStatus = decisionStatus ?? 'SKIPPED'; // Explicit default, never undefined
          
          const historyEntry: any = {
            symbol: historySymbol,
            signal: historySignal,
            accuracy: historyAccuracy,
            price: historyPriceValue,
            tradePlan: historyTradePlan,
            indicators: finalResult.analysis || null,
            isDeepResearch: true,
            source: 'AUTO_TRADE', // CRITICAL: Mark as auto-trade research for UI filtering
            status: 'FINAL', // Research completed successfully
            isFinal: true, // CRITICAL: Explicitly mark as final for history validation
            // CRITICAL: Decision tracking for every cycle - explicitly set or omit (never undefined)
            decision: historyDecisionStatus,
            // UI COMPATIBILITY: Flatten critical trade plan fields for Research History / Research Page
            // MUST match manual research payload structure exactly - explicitly 0 if missing
            entryPrice: safeTradePlan?.entryPrice ?? 0,
            stopLoss: safeTradePlan?.stopLoss ?? 0,
            takeProfit: safeTradePlan?.takeProfit2 ?? 0, // Use TP2 as main takeProfit (TradePlan doesn't have takeProfit, only takeProfit1/2/3)
            takeProfit1: safeTradePlan?.takeProfit1 ?? 0,
            takeProfit2: safeTradePlan?.takeProfit2 ?? 0,
            takeProfit3: safeTradePlan?.takeProfit3 ?? 0
          };
          
          // CRITICAL FIX: Only include optional fields if they have valid values (never undefined)
          if ((decisionStatus as string) === 'SKIPPED') {
            historyEntry.skipReason = skipReason ?? 'NO_SIGNAL'; // Explicitly set, never undefined
            if (skipReason) {
              historyEntry.skipReasons = [skipReason]; // Explicitly set array, never undefined
            }
          }
          if ((decisionStatus as string) === 'EXECUTED' && tradeId) {
            historyEntry.tradeId = tradeId ?? null; // Only include if exists, use ?? null for safety
          }

          // CRITICAL: Validate history entry schema before saving to Firestore
          // Ensure all required fields are present and valid
          // CRITICAL FIX: Allow null symbol for SKIPPED entries (NO_SIGNAL case)
          if (historyEntry.symbol !== null && (!historyEntry.symbol || typeof historyEntry.symbol !== 'string')) {
            logger.error({ uid, historyEntry }, '❌ [FIRESTORE_VALIDATION] Invalid symbol in history entry');
            throw new Error('Cannot save history: invalid symbol');
          }
          if (typeof historyEntry.accuracy !== 'number' || isNaN(historyEntry.accuracy) || historyEntry.accuracy < 0 || historyEntry.accuracy > 100) {
            logger.error({ uid, historyEntry }, '❌ [FIRESTORE_VALIDATION] Invalid accuracy in history entry');
            throw new Error('Cannot save history: invalid accuracy (must be 0-100)');
          }
          if (!['BUY', 'SELL', 'HOLD'].includes(historyEntry.signal)) {
            logger.error({ uid, historyEntry }, '❌ [FIRESTORE_VALIDATION] Invalid signal in history entry');
            throw new Error('Cannot save history: invalid signal');
          }
          if (typeof historyEntry.price !== 'number' || isNaN(historyEntry.price) || historyEntry.price < 0) {
            logger.error({ uid, historyEntry }, '❌ [FIRESTORE_VALIDATION] Invalid price in history entry');
            throw new Error('Cannot save history: invalid price');
          }
          if (historyEntry.isFinal !== true) {
            logger.error({ uid, historyEntry }, '❌ [FIRESTORE_VALIDATION] Missing isFinal flag in history entry');
            throw new Error('Cannot save history: missing isFinal flag');
          }
          // Validate numeric fields are numbers
          if (typeof historyEntry.entryPrice !== 'number' || typeof historyEntry.stopLoss !== 'number' ||
            typeof historyEntry.takeProfit !== 'number' || typeof historyEntry.takeProfit1 !== 'number' ||
            typeof historyEntry.takeProfit2 !== 'number' || typeof historyEntry.takeProfit3 !== 'number') {
            logger.error({ uid, historyEntry }, '❌ [FIRESTORE_VALIDATION] Invalid numeric fields in history entry');
            throw new Error('Cannot save history: invalid numeric fields');
          }

          // CRITICAL HARD GUARD 4: Prevent duplicate saves within same cycle
          // This ensures history is saved exactly ONCE per auto-trade cycle
          // BackgroundResearchScheduler calls with skipHistoryStorage=false for AUTO_TRADE_RESEARCH mode
          // This is the ONLY place where history is saved for AUTO_TRADE mode
          if (historySaved) {
            logger.error({
              uid,
              symbol: researchResult.symbol,
              alreadySavedSymbol: historySavedSymbol,
              attemptedSymbol: historyEntry.symbol,
              cycleId: `cycle_${Date.now()}`,
              duplicateBlocked: true
            }, '❌ [HISTORY_GUARD] BLOCKED: Duplicate history save prevented - history already saved in this cycle. Only ONE history entry per cycle is allowed.');
            throw new Error(`Cannot save history: history already saved for symbol ${historySavedSymbol} in this cycle. Only ONE history entry per cycle is allowed.`);
          }

          // CRITICAL: Save PRIMARY coin result from REAL research
          // researchResult.symbol comes from the actual selected coin from researchData.results[0]
          // This is the FINAL research result, so it's always the primary coin (not a fallback)
          // CRITICAL: This is the ONLY place where history is saved for successful AUTO_TRADE cycles
          // BackgroundResearchScheduler explicitly skips history save for AUTO_TRADE_RESEARCH mode
          
          // CRITICAL HARD GUARD 1: Verify symbol is from REAL research (not fallback)
          // Ensure symbol matches coinsAnalyzed (the actual selected coin)
          // CRITICAL: Allow null symbol for SKIPPED entries (NO_SIGNAL case)
          // CRITICAL: Check ALL possible symbol sources (researchResult.symbol, coinsAnalyzed, selectedSymbolForHistory)
          const actualSelectedCoin = researchData.coinsAnalyzed?.[0];
          const symbolForHistory = researchResult.symbol || actualSelectedCoin || researchSymbol || null;
          if (!symbolForHistory && decisionStatus !== 'SKIPPED') {
            logger.error({
              uid,
              coinsAnalyzed: researchData.coinsAnalyzed,
              researchResultSymbol: researchResult.symbol,
              historyBlocked: true,
              reason: 'No symbol in research result'
            }, '❌ [HISTORY_GUARD] BLOCKED: No symbol in research result - cannot save history');
            throw new Error('Cannot save history: no symbol in research result');
          }
          
          // CRITICAL HARD GUARD 2: Prevent BTCUSDT fallback unless it's actually the selected coin
          // If BTCUSDT appears but it's not in coinsAnalyzed, it's a fallback (BLOCK)
          if (researchResult.symbol === 'BTCUSDT') {
            if (!actualSelectedCoin) {
              logger.error({
                uid,
                symbol: researchResult.symbol,
                coinsAnalyzed: researchData.coinsAnalyzed,
                historyBlocked: true,
                reason: 'BTCUSDT detected but no coin was selected - fallback prevented'
              }, '❌ [HISTORY_GUARD] BLOCKED: BTCUSDT fallback detected - no coin was selected');
              throw new Error('Cannot save history: BTCUSDT fallback detected - no coin was selected');
            } else if (actualSelectedCoin !== 'BTCUSDT') {
              logger.error({
                uid,
                symbol: researchResult.symbol,
                actualSelectedCoin,
                coinsAnalyzed: researchData.coinsAnalyzed,
                historyBlocked: true,
                reason: 'BTCUSDT fallback detected but actual selected coin is different'
              }, '❌ [HISTORY_GUARD] BLOCKED: BTCUSDT fallback detected - actual selected coin is different');
              throw new Error(`Cannot save history: BTCUSDT fallback detected. Actual selected coin: ${actualSelectedCoin}`);
            }
            // If we get here, BTCUSDT is legitimately the selected coin - allow it
          }
          
          // CRITICAL HARD GUARD 3: Verify accuracy is from REAL research (not default 0)
          // If research ran successfully and isFinal=true, accuracy should be > 0 (unless truly HOLD signal)
          if (storedAccuracy === 0 && signal !== 'HOLD' && finalResult.isFinal === true) {
            logger.warn({
              uid,
              symbol: researchResult.symbol,
              accuracy: storedAccuracy,
              signal,
              isFinal: finalResult.isFinal,
              warning: 'Accuracy is 0 but signal is not HOLD - this may indicate a research issue'
            }, '⚠️ [HISTORY_WARNING] Accuracy is 0 but signal is not HOLD - proceeding with save but logging warning');
          }
          
          // CRITICAL HARD GUARD 4: Ensure popup and history use SAME research object
          // This ensures consistency between what user sees in popup and what's saved in history
          // Both should use researchResult.symbol and storedAccuracy from finalResult
          const popupSymbol = researchResult.symbol;
          const popupAccuracy = storedAccuracy;
          if (historyEntry.symbol !== popupSymbol || historyEntry.accuracy !== popupAccuracy) {
            logger.error({
              uid,
              historySymbol: historyEntry.symbol,
              popupSymbol,
              historyAccuracy: historyEntry.accuracy,
              popupAccuracy,
              historyBlocked: true,
              reason: 'Popup and history data mismatch'
            }, '❌ [HISTORY_GUARD] BLOCKED: Popup and history data mismatch - ensuring consistency');
            throw new Error('Cannot save history: popup and history data mismatch');
          }
          
          logger.info({
            uid,
            symbol: researchResult.symbol,
            accuracy: storedAccuracy,
            signal: finalSignal,
            actualSelectedCoin,
            historyType: 'REAL_RESEARCH',
            reason: 'Saving REAL research history - using actual symbol and accuracy from research'
          }, '🔍 [HISTORY_DEBUG] Saving REAL_RESEARCH history - using actual research output');
          
          await firestoreAdapter.storeResearchHistory(uid, historyEntry);
          historySaved = true;
          historySavedSymbol = historyEntry.symbol;

          logger.info({
            uid,
            symbol: researchResult.symbol,
            signal: finalSignal,
            accuracy: storedAccuracy,
            price: historyPrice,
            hasTradePlan: !!safeTradePlan,
            tradePlanEntryPrice: safeTradePlan?.entryPrice || null,
            tradePlanFields: safeTradePlan ? {
              entryPrice: safeTradePlan.entryPrice,
              stopLoss: safeTradePlan.stopLoss,
              takeProfit1: safeTradePlan.takeProfit1,
              takeProfit2: safeTradePlan.takeProfit2,
              takeProfit3: safeTradePlan.takeProfit3
            } : null,
            cycleId: `cycle_${Date.now()}`,
            savedOnce: true,
            historyType: 'REAL_RESEARCH',
            source: 'ACTUAL_RESEARCH_OUTPUT',
            popupConsistency: true,
            actualSelectedCoin
          }, '✅ [HISTORY_DEBUG] REAL_RESEARCH history saved successfully - using actual symbol and accuracy from research, popup consistency verified');
        } catch (histError: any) {
          logger.error({ uid, error: histError.message, stack: histError.stack }, '❌ [HISTORY] Failed to store auto-trade research history');
          // Do NOT throw - allow research cycle to continue even if history storage fails
        }
      } else {
        logger.debug({ uid, symbol: researchResult.symbol }, '⏭️ [HISTORY] History storage skipped - caller will handle with correct source');
      }

      // 5. Send Telegram Alert (if auto-trade is ON and accuracy >= telegramAccuracyTrigger)
      // CRITICAL: When Auto-Trade is ON, Telegram alerts come from AutoTradeEngine results
      // This replaces the Telegram background research engine alerts
      // CRITICAL: Must respect Telegram accuracy settings AND spam prevention
      // CRITICAL: Alerts are sent on EVERY qualifying research cycle (no silent skips)
      try {
        const alertId = `auto_trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const bgSettings = await firestoreAdapter.getBackgroundResearchSettings(uid);

        // HARD LOG: Telegram alert evaluation start
        logger.info({
          alertId,
          uid,
          symbol: researchResult.symbol,
          mode: 'AUTO_TRADE',
          accuracy,
          telegramConfigured: !!(bgSettings?.telegramBotToken && bgSettings?.telegramChatId),
          alertSource: 'AUTO_TRADE_ENGINE',
          telegramEngineBypassed: true
        }, '📱 [TELEGRAM_ALERT_EVAL] Evaluating Telegram alert from Auto-Trade engine (Telegram Background Research engine BYPASSED)');

        // HARD LOG: Active mode and frequency source
        logger.info({
          alertId,
          uid,
          symbol: researchResult.symbol,
          activeMode: 'AUTO_TRADE',
          frequencySource: 'AUTO_TRADE',
          telegramEngineBypassed: true,
          alertSource: 'AUTO_TRADE_ENGINE',
          timestamp: new Date().toISOString()
        }, '📱 [TELEGRAM_MODE] Active mode: AUTO_TRADE - frequency from Auto-Trade settings, Telegram Background Research engine BYPASSED');

        // Check Telegram configuration
        if (!bgSettings?.telegramBotToken || !bgSettings?.telegramChatId) {
          logger.info({
            alertId,
            uid,
            symbol: researchResult.symbol,
            mode: 'AUTO_TRADE',
            accuracy,
            status: 'SKIPPED',
            reason: 'Telegram configuration missing',
            alertSource: 'AUTO_TRADE_ENGINE'
          }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Auto-trade alert skipped - Telegram not configured');
        } else {
          // Check accuracy threshold (from Telegram Background settings)
          // CRITICAL: Threshold comes from Telegram settings, but alert is sent from Auto-Trade engine
          // CRITICAL: Alert must trigger on research completion when accuracy >= trigger
          // CRITICAL: Trade execution is NOT required for alert
          const telegramAccuracyTrigger = bgSettings.accuracyTrigger;
          const minTrigger = telegramAccuracyTrigger?.min ?? (typeof telegramAccuracyTrigger === 'number' ? telegramAccuracyTrigger : 80);
          const maxTrigger = telegramAccuracyTrigger?.max ?? 100;
          const isInRange = accuracy >= minTrigger && accuracy <= maxTrigger;

          // HARD LOG: Active mode, frequency source, accuracy threshold check
          logger.info({
            alertId,
            uid,
            symbol: researchResult.symbol,
            activeMode: 'AUTO_TRADE',
            frequencySource: 'AUTO_TRADE',
            telegramEngineBypassed: true,
            alertSource: 'AUTO_TRADE_ENGINE',
            accuracy,
            minTrigger,
            maxTrigger,
            isInRange,
            thresholdSource: 'TELEGRAM_SETTINGS',
            decision: isInRange ? 'SEND_ALERT' : 'SKIP_ALERT',
            reason: isInRange ? 'Accuracy >= trigger' : `Accuracy ${accuracy.toFixed(1)}% outside range [${minTrigger}-${maxTrigger}]%`
          }, '📱 [TELEGRAM_ALERT_THRESHOLD] Active mode: AUTO_TRADE, frequency source: AUTO_TRADE, accuracy threshold check - threshold from Telegram settings, alert from Auto-Trade engine');

          if (!isInRange) {
            logger.info({
              alertId,
              uid,
              symbol: researchResult.symbol,
              activeMode: 'AUTO_TRADE',
              frequencySource: 'AUTO_TRADE',
              accuracy,
              minTrigger,
              maxTrigger,
              status: 'SKIPPED',
              reason: `Accuracy ${accuracy.toFixed(1)}% outside range [${minTrigger}-${maxTrigger}]%`
            }, '⏭️ [TELEGRAM_ALERT_SKIPPED] Auto-trade alert skipped - accuracy outside threshold');
          } else {
            // CRITICAL: Alert must be sent EVERY TIME research completes AND accuracy >= trigger
            // CRITICAL: Trade execution is NOT required for alert
            // CRITICAL: Alerts fire based on accuracy threshold ONLY, not trade execution status
            logger.info({
              alertId,
              uid,
              symbol: researchResult.symbol,
              activeMode: 'AUTO_TRADE',
              frequencySource: 'AUTO_TRADE',
              accuracy,
              minTrigger,
              maxTrigger,
              thresholdMet: true,
              status: 'SENDING',
              reason: 'Accuracy >= trigger, alert sent on research completion (trade execution not required)'
            }, '📱 [TELEGRAM_ALERT_SEND] Sending Telegram alert from Auto-Trade engine - accuracy >= trigger on research completion');
            // CRITICAL: Alert must be sent EVERY TIME research completes AND accuracy >= trigger
            // CRITICAL: Trade execution is NOT required for alert
            // CRITICAL: Do NOT check unifiedDecision.allowed - that's for trade execution, not alerts
            // CRITICAL: Remove spam prevention that blocks valid alerts - alerts should fire on every qualifying cycle
            const finalResult = researchResult.result;
            const finalTradePlan = finalResult?.tradePlan || null;

            // All conditions met - send alert
            const { telegramService } = await import('./telegramService');
            const timestamp = new Date().toISOString();
            let message = '';

            if (signal === 'HOLD') {
              message = `🚨 *DLXTRADE Auto-Trade Research Alert*

**Coin:** ${researchResult.symbol}
**Signal:** HOLD
**Accuracy:** ${accuracy.toFixed(1)}%
**Reason:** Accuracy below 60% threshold - no trade plan generated
**Timestamp:** ${timestamp}

⚡ *Action:* Wait for higher confidence signal before trading.`;
            } else if (finalTradePlan && accuracy >= minTrigger) {
              // CRITICAL: Include trade plan in Telegram alert if accuracy >= user's Telegram trigger (not hardcoded 70%)
              // CRITICAL: Use FINAL tradePlan from researchAggregator - same as manual research
              // Verify tradePlan has required fields before sending
              if (!finalTradePlan.entryPrice || !finalTradePlan.stopLoss) {
                logger.error({
                  uid,
                  symbol: researchResult.symbol,
                  accuracy,
                  signal,
                  tradePlan: finalTradePlan
                }, '❌ [TELEGRAM_GUARD] BLOCKED: Trade plan missing required fields (entryPrice or stopLoss) - cannot send alert');
                // Fallback to HOLD message
                message = `🚨 *DLXTRADE Auto-Trade Research Alert*

**Coin:** ${researchResult.symbol}
**Signal:** HOLD (Trade plan incomplete)
**Accuracy:** ${accuracy.toFixed(1)}%
**Reason:** Trade plan missing required fields
**Timestamp:** ${timestamp}

⚡ *Action:* Trade plan generation failed - signal not actionable.`;
              } else {
                const entryPrice = finalTradePlan.entryPrice;
                const stopLoss = finalTradePlan.stopLoss;
                const tp1 = finalTradePlan.takeProfit1;
                const tp2 = finalTradePlan.takeProfit2;
                const tp3 = finalTradePlan.takeProfit3;

                logger.info({
                  uid,
                  symbol: researchResult.symbol,
                  accuracy,
                  signal,
                  hasTradePlan: true,
                  entryPrice,
                  stopLoss,
                  tp1,
                  tp2,
                  tp3
                }, '✅ [TELEGRAM] Sending auto-trade alert with FINAL trade plan');

                message = `🚨 *DLXTRADE Auto-Trade Research Alert*

**Coin:** ${researchResult.symbol}
**Signal:** ${signal}
**Accuracy:** ${accuracy.toFixed(1)}%
**Entry Price:** $${entryPrice.toFixed(2)}
**Stop Loss:** $${stopLoss.toFixed(2)}
**Take Profit 1:** $${tp1.toFixed(2)}
**Take Profit 2:** $${tp2.toFixed(2)}${tp3 ? `\n**Take Profit 3:** $${tp3.toFixed(2)}` : ''}
**Timestamp:** ${timestamp}

⚡ *Action:* Auto-trade will execute if accuracy >= 75% and all risk checks pass.`;
              }
            } else if ((signal === 'BUY' || signal === 'SELL') && !finalTradePlan) {
              // BUY/SELL signal but no trade plan - this should not happen but log it
              logger.error({
                uid,
                symbol: researchResult.symbol,
                accuracy,
                signal,
                reason: 'BUY/SELL signal but tradePlan is null'
              }, '❌ [TELEGRAM_GUARD] BLOCKED: BUY/SELL signal but tradePlan is missing - cannot send alert');
              // Fallback to HOLD message
              message = `🚨 *DLXTRADE Auto-Trade Research Alert*

**Coin:** ${researchResult.symbol}
**Signal:** HOLD (Trade plan missing)
**Accuracy:** ${accuracy.toFixed(1)}%
**Reason:** Trade plan not generated despite ${signal} signal
**Timestamp:** ${timestamp}

⚡ *Action:* Trade plan unavailable - signal not actionable.`;
            }

            if (message) {
              // CRITICAL: Validate Telegram payload before sending
              if (!bgSettings.telegramBotToken || typeof bgSettings.telegramBotToken !== 'string' || bgSettings.telegramBotToken.trim().length === 0) {
                logger.error({ uid, alertId }, '❌ [TELEGRAM_VALIDATION] BLOCKED: Invalid bot token - cannot send alert');
                throw new Error('Telegram bot token is invalid or missing');
              }
              if (!bgSettings.telegramChatId || typeof bgSettings.telegramChatId !== 'string' || bgSettings.telegramChatId.trim().length === 0) {
                logger.error({ uid, alertId }, '❌ [TELEGRAM_VALIDATION] BLOCKED: Invalid chat ID - cannot send alert');
                throw new Error('Telegram chat ID is invalid or missing');
              }
              if (!message || typeof message !== 'string' || message.trim().length === 0) {
                logger.error({ uid, alertId }, '❌ [TELEGRAM_VALIDATION] BLOCKED: Invalid message - cannot send alert');
                throw new Error('Telegram message is invalid or empty');
              }
              if (message.length > 4096) {
                logger.error({ uid, alertId, messageLength: message.length }, '❌ [TELEGRAM_VALIDATION] BLOCKED: Message too long (>4096 chars) - cannot send alert');
                throw new Error('Telegram message exceeds maximum length (4096 characters)');
              }

              // CRITICAL: sendMessage signature: (botToken: string, chatId: string, message: string)
              // HARD LOG: Sending Telegram alert from Auto-Trade engine
              logger.info({
                alertId,
                uid,
                symbol: researchResult.symbol,
                mode: 'AUTO_TRADE',
                accuracy,
                signal,
                hasTradePlan: !!finalTradePlan,
                messageLength: message.length,
                alertSource: 'AUTO_TRADE_ENGINE',
                telegramEngineBypassed: true,
                thresholdSource: 'TELEGRAM_SETTINGS',
                sendingNow: true
              }, '📱 [TELEGRAM_ALERT_SEND] Sending Telegram alert from Auto-Trade engine - EVERY qualifying cycle triggers alert (Telegram Background Research engine BYPASSED)');

              const telegramResult = await telegramService.sendMessage(
                bgSettings.telegramBotToken.trim(),
                bgSettings.telegramChatId.trim(),
                message.trim()
              );

              if (telegramResult.success) {
                // Update last alert sent
                const updatedLastAlertSent = {
                  ...(bgSettings.lastAlertSent || {}),
                  [researchResult.symbol]: {
                    timestamp: admin.firestore.Timestamp.now(),
                    accuracy: accuracy,
                  },
                };

                await firestoreAdapter.saveBackgroundResearchSettings(uid, {
                  lastAlertSent: updatedLastAlertSent
                });

                logger.info({
                  alertId,
                  uid,
                  symbol: researchResult.symbol,
                  activeMode: 'AUTO_TRADE',
                  frequencySource: 'AUTO_TRADE',
                  accuracy,
                  minTrigger,
                  maxTrigger,
                  thresholdMet: true,
                  status: 'SENT',
                  alertSource: 'AUTO_TRADE_ENGINE',
                  telegramEngineBypassed: true,
                  sentFromAutoTrade: true,
                  reason: 'Alert sent successfully - accuracy >= trigger on research completion'
                }, '✅ [TELEGRAM_ALERT_SENT] Auto-trade research alert sent successfully - sent from Auto-Trade engine, Telegram Background Research engine BYPASSED, accuracy >= trigger');
              } else {
                logger.error({
                  alertId,
                  uid,
                  symbol: researchResult.symbol,
                  mode: 'AUTO_TRADE',
                  accuracy,
                  status: 'FAILED',
                  error: telegramResult.error
                }, '❌ [TELEGRAM_ALERT_FAILED] Auto-trade alert failed after retries');
              }
            }
          }
        }
      } catch (telegramError: any) {
        const alertId = `auto_trade_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        logger.error({
          alertId,
          uid,
          symbol: researchResult.symbol,
          mode: 'AUTO_TRADE',
          accuracy,
          status: 'FAILED',
          error: telegramError.message
        }, '❌ [TELEGRAM_ALERT_ERROR] Failed to send Telegram alert from AutoTradeEngine');
      }

      // 6. EXECUTION ORDER ENFORCEMENT
      // STRICT ORDER: System Risk -> Accuracy Gate -> Execution

      // STEP 1: SYSTEM RISK CHECKS
      // Verify account health (Daily Loss, Cooldown, etc.) BEFORE evaluating accuracy or creating signals
      const systemRiskCheck = await this.checkSystemRisk(uid, false, settings, researchResult.symbol);

      if (!systemRiskCheck.allowed) {
        skipReason = systemRiskCheck.reason || 'System risk check failed';
        cycleResult = AUTO_TRADE_REASONS.SYSTEM_RISK_FAILURE;
        logger.info({ uid, reason: skipReason, step: 'SYSTEM_RISK_CHECK' }, '⛔ [EXECUTION_ORDER] BLOCKED: System risk check failed');
        await this.logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult.symbol,
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: 'available',
        });
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', { symbol: researchResult.symbol, reason: skipReason, accuracy, timestamp: new Date().toISOString() });
        return researchResult;
      }

      // STEP 2: ACCURACY GATE (User-Defined)
      // 6. Evaluate Signal & Accuracy Gate for Trade Execution
      // accuracy variable already calculated above using AccuracyGuard
      // CRITICAL: Use user-defined accuracyTrigger.min, NOT hardcoded 75%
      // CRITICAL: Validate threshold is in valid range (0-100)
      const rawThreshold = settings.accuracyTrigger?.min ?? 75;
      const threshold = Math.max(0, Math.min(100, rawThreshold)); // Clamp to 0-100 range
      if (rawThreshold !== threshold) {
        logger.warn({ uid, rawThreshold, clampedThreshold: threshold }, '⚠️ [ACCURACY_GUARD] Threshold clamped to valid range (0-100)');
      }

      logger.info({
        uid,
        symbol: researchResult.symbol,
        accuracy,
        userAccuracyTrigger: settings.accuracyTrigger,
        executionThreshold: threshold,
        signal,
        willExecute: accuracy >= threshold && signal !== 'HOLD',
        usingUserSetting: settings.accuracyTrigger?.min !== undefined
      }, `🎯 [RESEARCH_CYCLE] Accuracy gate evaluation - threshold: ${threshold}% (user-defined: ${settings.accuracyTrigger?.min ?? 'not set, using default 75%'})`);

      // CRITICAL: Use AccuracyGuard to ensure accuracy meets threshold
      // This provides additional safety and consistency with centralized accuracy logic
      if (!AccuracyGuard.meetsThreshold(accuracy, threshold, false)) {
        skipReason = `Accuracy ${accuracy.toFixed(1)}% below mandatory threshold (${threshold}%)`;
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = 'SKIPPED';
        logger.info({
          uid,
          symbol: researchResult.symbol,
          accuracy,
          threshold,
          reason: skipReason
        }, '⛔ [RESEARCH_CYCLE] BLOCKED: Accuracy below threshold');
        await this.logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult.symbol,
          accuracy,
          threshold,
          signal,
          exchangeStatus: 'available',
        });
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', { symbol: researchResult.symbol, reason: skipReason, accuracy, timestamp: new Date().toISOString() });
        // History will be saved at end of function
        return researchResult;
      }

      if (signal === 'HOLD' || !signal || signal === 'ANALYZING' || signal === 'PENDING' || (signal !== 'BUY' && signal !== 'SELL' && signal !== 'HOLD')) {
        skipReason = signal === 'HOLD' ? AUTO_TRADE_REASONS.HOLD_SIGNAL : AUTO_TRADE_REASONS.NO_SIGNAL;
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = 'SKIPPED';
        await this.logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult.symbol,
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: 'available',
        });
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', { symbol: researchResult.symbol, reason: skipReason, accuracy, timestamp: new Date().toISOString() });
        // History will be saved at end of function
        return researchResult;
      }

      // 7. Dynamic Parameters & Volatility Check (Requirement P4)
      // CRITICAL: Uses user's accuracyRiskConfig (single source of truth)
      const volClassification = researchResult.result?.analysis?.volatility?.classification || 'low';

      // Calculate news score for sentiment adjustment
      const newsArticles = researchResult.result?.news || [];
      const newsScore = this.calculateNewsScoreFromArticles(newsArticles);

      const params = await this.calculateDynamicParams(uid, accuracy, volClassification, newsScore);

      if (params.skip) {
        skipReason = params.skip;
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = 'SKIPPED';
        await this.logAutoTradeSkip(uid, skipReason, {
          symbol: researchResult.symbol,
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: 'available',
          additionalDetails: {
            volatility: volClassification,
            newsScore,
          }
        });
        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', { symbol: researchResult.symbol, reason: skipReason, accuracy, volatility: volClassification, timestamp: new Date().toISOString() });
        // History will be saved at end of function (decisionStatus already set to SKIPPED above)
        return researchResult;
      }

      // 8. Deterministic SL/TP (Requirement P5)
      const currentPrice = await this.getCurrentMarketPrice(researchResult.symbol, uid);
      const atr = researchResult.result?.analysis?.volatility?.atr || 0;
      const sr = {
        supportLevel: researchResult.result?.analysis?.structure?.support,
        resistanceLevel: researchResult.result?.analysis?.structure?.resistance
      };

      // DETECT SCALPING MODE from Trading Settings
      let isScalping = false;
      try {
        const tradingSettings = await firestoreAdapter.getTradingSettings(uid);
        isScalping = tradingSettings?.tradeType === 'Scalping';
      } catch (e) {
        logger.warn({ uid, error: e.message }, 'Failed to fetch trading settings, defaulting to non-scalping');
      }

      const sltp = this.calculateSLTP(signal as 'BUY' | 'SELL', currentPrice, accuracy, atr, sr, isScalping);

      // 9. Create & Execute Trade Signal
      const tradeSignal: TradeSignal = {
        symbol: researchResult.symbol,
        signal: signal as 'BUY' | 'SELL',
        entryPrice: currentPrice,
        accuracy: accuracy,
        stopLoss: sltp.stopLoss,
        takeProfit: sltp.takeProfit,
        takeProfit1: isScalping ? sltp.takeProfit1 : undefined,
        takeProfit2: isScalping ? sltp.takeProfit2 : undefined,
        takeProfit3: isScalping ? sltp.takeProfit3 : undefined,
        leverage: params.leverage,
        reasoning: `Accuracy ${accuracy.toFixed(1)}% | Model Size ${params.sizePct}% | Leverage ${params.leverage}x${isScalping ? ' | SCALPING' : ''}`,
        requestId: `auto_${uid}_${Date.now()}`,
        timestamp: new Date(),
        highImpactNewsDetected: researchResult.result?.analysis?.news?.highImpact,
        newsEvent: researchResult.result?.analysis?.news?.event
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
        logger.info({
          uid,
          symbol: researchResult.symbol,
          highImpactNews: true,
          newsEvent: researchResult.result?.analysis?.news?.event
        }, '⚠️ [NEWS_BLOCK] High-impact news detected - trade will be blocked for safety');
      }

      // STEP 3: TRADE EXECUTION
      // Accuracy Gate (75%) and System Checks passed above.

      logger.info({
        uid,
        symbol: researchResult.symbol,
        accuracy,
        step: 'EXECUTION'
      }, '🚀 [EXECUTION_ORDER] Proceeding to Trade Execution');

      // CRITICAL: Load config fresh before execution to ensure latest state
      const freshConfig = await this.loadConfig(uid);

      // CRITICAL: Check if execution is blocked by earlier failures (e.g. Exchange Decryption)
      if (executionBlocked) {
        skipReason = executionBlockReason || 'EXECUTION_BLOCKED';
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = 'SKIPPED';

        logger.warn({
          uid,
          symbol: researchResult.symbol,
          reason: executionBlockReason,
          step: 'PRE_EXECUTION_GUARD'
        }, '⛔ [EXECUTION_BLOCKED] Trade execution blocked by earlier failure (e.g. Exchange Decryption) - research and history saved, but trade aborted');

        await this.logAutoTradeSkip(uid, 'EXECUTION_BLOCKED', {
          symbol: researchResult.symbol,
          accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal,
          exchangeStatus: 'unavailable',
          additionalDetails: {
            reason: executionBlockReason
          }
        });

        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', {
          symbol: researchResult.symbol,
          reason: executionBlockReason,
          accuracy,
          timestamp: new Date().toISOString()
        });

        return researchResult;
      }

      // CRITICAL: Race Condition Guard - Check if auto-trade was disabled during research
      if (!freshConfig.autoTradeEnabled && !freshConfig.manualOverride) {
        skipReason = 'AUTO_TRADE_DISABLED_DURING_RESEARCH';
        cycleResult = AUTO_TRADE_REASONS.TRADE_SKIPPED;
        decisionStatus = 'SKIPPED';

        logger.warn({
          uid,
          symbol: researchResult.symbol,
          autoTradeEnabled: freshConfig.autoTradeEnabled,
          manualOverride: freshConfig.manualOverride,
          step: 'PRE_EXECUTION_GUARD'
        }, '⛔ [RACE_CONDITION_PREVENTED] Auto-trade was disabled during research cycle - aborting execution');

        await this.logAutoTradeSkip(uid, 'AUTO_TRADE_DISABLED', {
          symbol: researchResult.symbol,
          accuracy,
          threshold: threshold,
          signal,
          exchangeStatus: 'available',
          additionalDetails: {
            reason: 'User disabled auto-trade while research was running'
          }
        });

        await firestoreAdapter.logActivity(uid, 'TRADE_SKIPPED', {
          symbol: researchResult.symbol,
          reason: 'Auto-trade disabled during execution check',
          accuracy,
          timestamp: new Date().toISOString()
        });

        return researchResult;
      }

      logger.info({
        uid,
        symbol: researchResult.symbol,
        signal,
        accuracy,
        autoTradeEnabled: freshConfig.autoTradeEnabled,
        manualOverride: freshConfig.manualOverride,
        configSource: 'fresh-load-before-execution'
      }, '🔍 [RESEARCH_CYCLE] Loading fresh config before executeTrade call');

      // 🔍 [CHECKPOINT] Pre-execution validation and logging
      // Calculate Risk-Reward ratio
      const riskAmount = Math.abs(tradeSignal.entryPrice - tradeSignal.stopLoss);
      const rewardAmount = tradeSignal.signal === 'BUY'
        ? (tradeSignal.takeProfit - tradeSignal.entryPrice)
        : (tradeSignal.entryPrice - tradeSignal.takeProfit);
      const rr = riskAmount > 0 ? rewardAmount / riskAmount : 0;

      // Validate TP is logical vs SL
      let tpValid = true;
      let tpValidationError = '';
      if (tradeSignal.signal === 'BUY') {
        if (tradeSignal.takeProfit <= tradeSignal.entryPrice) {
          tpValid = false;
          tpValidationError = `TP (${tradeSignal.takeProfit}) must be > entry (${tradeSignal.entryPrice}) for BUY`;
        } else if (tradeSignal.stopLoss >= tradeSignal.entryPrice) {
          tpValid = false;
          tpValidationError = `SL (${tradeSignal.stopLoss}) must be < entry (${tradeSignal.entryPrice}) for BUY`;
        }
      } else { // SELL
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
        const reason = 'LOW_RR_PRE_EXECUTION';
        logger.error({
          uid,
          symbol: researchResult.symbol,
          step: 'PRE_EXECUTION_VALIDATION_FAILED',
          reason,
          calculatedRR: rr.toFixed(2),
          minimumRR: 1.2,
          entryPrice: tradeSignal.entryPrice,
          stopLoss: tradeSignal.stopLoss,
          takeProfit: tradeSignal.takeProfit,
          riskAmount,
          rewardAmount
        }, `❌ [PRE_EXECUTION_VALIDATION] BLOCKED: ${reason} - RR ${rr.toFixed(2)} < 1.2 minimum`);

        await this.logAutoTradeSkip(uid, reason, {
          symbol: researchResult.symbol,
          accuracy: tradeSignal.accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal: tradeSignal.signal,
          exchangeStatus: 'available',
          additionalDetails: {
            calculatedRR: rr,
            minimumRR: 1.2,
            entryPrice: tradeSignal.entryPrice,
            stopLoss: tradeSignal.stopLoss,
            takeProfit: tradeSignal.takeProfit,
          }
        });

        throw new Error(`${reason}: Risk-Reward ratio ${rr.toFixed(2)} < 1.2 minimum - trade blocked`);
      }

      // Validate TP logic
      if (!tpValid) {
        const reason = 'INVALID_TP_LOGIC';
        logger.error({
          uid,
          symbol: researchResult.symbol,
          step: 'PRE_EXECUTION_VALIDATION_FAILED',
          reason,
          tpValidationError,
          signal: tradeSignal.signal,
          entryPrice: tradeSignal.entryPrice,
          stopLoss: tradeSignal.stopLoss,
          takeProfit: tradeSignal.takeProfit
        }, `❌ [PRE_EXECUTION_VALIDATION] BLOCKED: ${reason} - ${tpValidationError}`);

        await this.logAutoTradeSkip(uid, reason, {
          symbol: researchResult.symbol,
          accuracy: tradeSignal.accuracy,
          threshold: settings.accuracyTrigger?.min ?? 75,
          signal: tradeSignal.signal,
          exchangeStatus: 'available',
          additionalDetails: {
            tpValidationError,
            entryPrice: tradeSignal.entryPrice,
            stopLoss: tradeSignal.stopLoss,
            takeProfit: tradeSignal.takeProfit,
          }
        });

        throw new Error(`${reason}: ${tpValidationError}`);
      }

      // Get accuracy slab info for logging (will be recalculated in executeTrade, but log what we have)
      const accuracySlabInfo = params.matchedRange
        ? `${params.matchedRange.minAccuracy}-${params.matchedRange.maxAccuracy ?? '∞'}%`
        : 'N/A';

      // 🔍 [CHECKPOINT] Log all trade parameters before execution
      logger.info({
        uid,
        symbol: researchResult.symbol,
        step: 'PRE_EXECUTION_CHECKPOINT',
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
        timestamp: new Date().toISOString()
      }, '✅ [PRE_EXECUTION_CHECKPOINT] All validations passed - entryPrice, SL, TP, RR logged [TOP_25_VERIFIED]');

      const execution = await this.executeTrade(uid, tradeSignal);

      // 🔍 [DEBUG] executeTrade returned
      logger.info({
        uid,
        symbol: researchResult.symbol,
        step: 'EXECUTE_TRADE_RETURNED',
        executionStatus: execution.status,
        tradeId: execution.tradeId
      }, '🔍 [DEBUG_TRACE] executeTrade returned successfully');

      cycleResult = execution.status === 'PENDING' ? AUTO_TRADE_REASONS.PENDING_CONFIRMATION : AUTO_TRADE_REASONS.TRADE_EXECUTED;
      decisionStatus = 'EXECUTED';
      tradeId = execution.tradeId || null;

      logger.info({
        uid,
        symbol: researchResult.symbol,
        signal,
        accuracy,
        result: cycleResult,
        executionStatus: execution.status,
        tradeId: execution.tradeId
      }, '✅ [CYCLE_COMPLETE] Trade cycle successful');
      // History will be saved at end of function
      return researchResult;

    } catch (error: any) {
      cycleResult = AUTO_TRADE_REASONS.TRADE_FAILED;
      skipReason = error.message;

      logger.error({ uid, error: error.message, stack: error.stack }, '❌ [CYCLE_FAILED] Trade cycle failed');

      // CRITICAL: Store history even on error (if not skipped)
      // This ensures every research attempt is logged, even if it fails
      // CRITICAL: Only save if history hasn't been saved yet in this cycle
      // CRITICAL: Do NOT save fallback/BTC entries - only save if we have a real symbol
      if (!skipHistoryStorage && !historySaved) {
        try {
          // Try to get actual symbol from research attempt if available
          let errorSymbol = 'BTCUSDT'; // Only use as last resort
          // Note: We don't save fallback/BTC entries, so this will be skipped if no real symbol
          // But we log it for diagnostics
          logger.debug({ uid, symbol: errorSymbol }, '⏭️ [HISTORY] Skipping error history save - fallback/BTC entries are not saved');
        } catch (histError: any) {
          logger.warn({ uid, error: histError.message }, 'Failed to store history for failed cycle');
        }
      } else if (!skipHistoryStorage && historySaved) {
        logger.warn({ uid, alreadySavedSymbol: historySavedSymbol }, '⏭️ [HISTORY_GUARD] BLOCKED: Duplicate history save prevented in error handler - history already saved in this cycle');
      }

      if (Object.values(AUTO_TRADE_REASONS).includes(skipReason as AutoTradeReason)) {
        // Skip reason is already standardized
      } else {
        await firestoreAdapter.logActivity(uid, 'TRADE_FAILED', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }

      // CRITICAL: Return null on error (research attempted but failed)
      // Scheduler will still update lastRunAt to track the attempt
      return null;
    }
  }

  /**
   * Save pending trade for user confirmation
   */
  private async savePendingTrade(uid: string, tradeData: {
    requestId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
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
  }): Promise<void> {
    await firestoreAdapter.savePendingTrade(uid, tradeData);
  }

  /**
   * Execute an approved pending trade
   */
  async executeApprovedPendingTrade(uid: string, requestId: string): Promise<TradeExecution> {
    try {
      // Get pending trade
      const pendingTrades = await firestoreAdapter.getPendingTrades(uid);
      const pendingTrade = pendingTrades.find(t => t.id === requestId || t.requestId === requestId);

      if (!pendingTrade) {
        // Double check Firestore for expired trades to give better error

        throw new Error('Pending trade not found or expired. Please re-run research.');
      }

      if (pendingTrade.status !== 'PENDING') {
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
        reasoning: pendingTrade.reasoning || 'Auto-generated trade signal',
        timestamp: new Date(),
        requestId: pendingTrade.requestId || requestId,
      };

      try {
        // Execute the trade (passing true to skip confirmation check)
        const execution = await this.executeTrade(uid, signal, true);

        // Mark pending trade as approved
        await firestoreAdapter.updatePendingTradeStatus(uid, requestId, 'APPROVED');

        logger.info({ uid, requestId, symbol: signal.symbol }, 'Approved pending trade executed');
        return execution;
      } catch (error: any) {
        logger.error({ uid, requestId, error: error.message }, 'Failed to execute approved pending trade');
        throw error;
      }
    } catch (error: any) {
      logger.error({ uid, requestId, error: error.message }, 'Failed to execute approved pending trade');
      throw error;
    }
  }

  /**
   * Reject a pending trade
   */
  async rejectPendingTrade(uid: string, requestId: string): Promise<void> {
    await firestoreAdapter.updatePendingTradeStatus(uid, requestId, 'REJECTED');
    await this.logTradeEvent(uid, 'TRADE_REJECTED', {
      requestId,
      reason: 'User rejected pending trade',
    });
    logger.info({ uid, requestId }, 'Pending trade rejected by user');
  }


  private async sendTradeConfirmationNotification(uid: string, signal: TradeSignal): Promise<void> {
    try {
      // Send notification that trade confirmation is required with full details
      userNotificationService.sendTradeConfirmationAlert(uid, {
        coin: signal.symbol,
        side: signal.signal.toLowerCase() as 'buy' | 'sell',
        entry: signal.entryPrice,
        sl: signal.stopLoss,
        tp: signal.takeProfit,
        tp1: signal.takeProfit1,
        tp2: signal.takeProfit2,
        tp3: signal.takeProfit3,
        accuracy: signal.accuracy,
        requestId: signal.requestId
      });

      logger.info({ uid, symbol: signal.symbol }, 'Trade confirmation notification sent with rich data');
    } catch (error: any) {
      logger.error({ uid, error: error.message }, 'Failed to send trade confirmation notification');
    }
  }

  async checkWhaleAlerts(uid: string, symbol: string): Promise<void> {
    try {
      // Initialize adapter if needed
      let adapter = this.userEngines.get(uid)?.adapter;
      if (!adapter) {
        adapter = await this.initializeAdapter(uid);
      }
      if (!adapter) return;

      // Get 24h ticker data for whale/vol spike detection
      const ticker = await adapter.getTicker(symbol);
      if (!ticker) return;

      const priceChangePct = Math.abs(parseFloat(ticker.priceChangePercent || '0'));
      const volume = parseFloat(ticker.volume || '0');
      const quoteVolume = parseFloat(ticker.quoteVolume || '0'); // USD value usually

      // 1. PRICE WHALE: Detect large price moves (> 3% in 24h)
      if (priceChangePct >= 3.0) {
        const direction = parseFloat(ticker.priceChangePercent) > 0 ? 'buy' : 'sell';
        userNotificationService.sendWhaleAlert(uid, symbol, direction, quoteVolume);

        await this.logTradeEvent(uid, 'WHALE_ALERT_PRICE', {
          symbol,
          priceChangePct,
          direction,
          volume: quoteVolume
        });

        logger.info({ uid, symbol, priceChangePct }, '🐋 WHALE ALERT: Large price movement detected');
      }

      // 2. VOLUME SPIKE: Detect volume spikes (> 200% of "normal" - here we simplified to absolute large vol)
      // Normally we'd compare to 24h avg, but ticker already gives 24h sum.
      // If quoteVolume > $1,000,000 for non-major or $10,000,000 for major, it's a "whale" move in this context
      if (quoteVolume >= 5000000) { // $5M+ volume is significant
        userNotificationService.sendWhaleAlert(uid, symbol, 'buy', quoteVolume);
        logger.info({ uid, symbol, quoteVolume }, '🐋 WHALE ALERT: High volume detected');
      }

    } catch (error: any) {
      logger.error({ uid, symbol, error: error.message }, 'Failed to check whale alerts');
    }
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
      const { backgroundResearchScheduler } = await import('./backgroundResearchScheduler');
      await backgroundResearchScheduler.onUserSettingsChanged(uid);
      logger.info({ uid }, '🔄 [AUTOTRADE] Settings changed, scheduler notified');
    } catch (error: any) {
      logger.warn({ uid, error: error.message }, 'Failed to notify scheduler of settings change');
      // Fallback: Try to restart loop (for backward compatibility)
      try {
        await this.startAutoTradeLoop(uid);
      } catch (fallbackError: any) {
        logger.error({ uid, error: fallbackError.message }, 'Failed to restart auto-trade loop');
      }
    }
  }
}

export const autoTradeEngine = new AutoTradeEngine();

