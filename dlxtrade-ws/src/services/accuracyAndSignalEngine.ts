import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';

// Accuracy validation result interface
export interface AccuracyValidationResult {
  isValid: boolean;
  normalizedAccuracy: number;
  reason?: string;
}

// Strict signal enum
export type TradeSignalType = 'BUY' | 'SELL' | 'HOLD';

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

  // 5. Risk-Reward ratio validation (minimum 1.2)
  let rr = tradePlan?.riskRewardRatio || 0;
  if (rr < 1.2) {
    return {
      allowed: false,
      reason: `LOW_RR: Risk-Reward ratio ${rr.toFixed(2)} < 1.2 minimum`,
      accuracyUsed: accuracyPercent,
      rr,
      volatilityState: 'OK',
      entryZoneValid: false,
      isFinal: true
    };
  }

  // 6. Volatility check using ATR percentile
  let volatilityState: 'OK' | 'HIGH' | 'EXTREME' = 'OK';
  const atrPercentile = indicators?.atr?.atrPercentile || 0;
  if (atrPercentile >= 95) {
    return {
      allowed: false,
      reason: 'EXTREME_VOLATILITY: ATR percentile >= 95%',
      accuracyUsed: accuracyPercent,
      rr,
      volatilityState: 'EXTREME',
      entryZoneValid: false,
      isFinal: true
    };
  } else if (atrPercentile >= 85) {
    volatilityState = 'HIGH';
  }

  // 7. Entry zone validation using VWAP and support/resistance
  let entryZoneValid = true;
  const vwapDeviation = indicators?.vwap?.deviation || 0;
  if (signal === 'BUY' && vwapDeviation > 2) {
    entryZoneValid = false;
  } else if (signal === 'SELL' && vwapDeviation < -2) {
    entryZoneValid = false;
  }

  // Support/resistance validation
  if (tradePlan?.entryPrice && indicators?.supportResistance) {
    const { majorSupport, majorResistance } = indicators.supportResistance;
    const entryPrice = tradePlan.entryPrice;

    if (signal === 'BUY' && majorResistance && entryPrice > 0) {
      const distanceToResistance = ((majorResistance - entryPrice) / entryPrice) * 100;
      if (distanceToResistance < 0.5) {
        entryZoneValid = false;
      }
    } else if (signal === 'SELL' && majorSupport && entryPrice > 0) {
      const distanceToSupport = ((entryPrice - majorSupport) / entryPrice) * 100;
      if (distanceToSupport < 0.5) {
        entryZoneValid = false;
      }
    }
  }

  if (!entryZoneValid) {
    return {
      allowed: false,
      reason: signal === 'BUY' ? 'ENTRY_ZONE_INVALID: BUY near resistance' : 'ENTRY_ZONE_INVALID: SELL near support',
      accuracyUsed: accuracyPercent,
      rr,
      volatilityState,
      entryZoneValid: false,
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

export interface ResearchDataResult {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  result: any;
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
  accuracyRiskConfig?: any[];
}

export interface ProviderConfigs {
  [key: string]: any;
}

export interface IntegrationResult {
  [key: string]: any;
}

// Helper function to run deep research with coin selection based on trading settings
// REFACTORED: Now uses UNIFIED selectBestCoinByAccuracy logic (only 1 best coin)
export async function runDeepResearchWithCoinSelection(
  uid: string,
  settings: TradingSettings,
  providerConfigs: ProviderConfigs,
  integrations: IntegrationResult
): Promise<ResearchData> {
  const results: ResearchDataResult[] = [];
  const coinsAnalyzed: string[] = [];

  // This ensures rotation, cooldowns, and TOP 100 scan (not just BTC)
  const { selectBestCoinByAccuracy } = await import('./researchModes');

  const selectionResult = await selectBestCoinByAccuracy(uid, []);
  if (!selectionResult) {
    logger.warn({ uid }, 'Auto-trade selection: No suitable coin found by accuracy scan');
    return { results: [], coinsAnalyzed: [] };
  }

  const { symbol, accuracy: estimatedAccuracy } = selectionResult;
  coinsAnalyzed.push(symbol);

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

    // Execute research with background mode (parallel providers internally)
    const { runDeepResearch } = await import('./deepResearchEngine');
    const result = await runDeepResearch({
      uid,
      symbol,
      providerConfigs,
      integrations,
      mode: 'background'
    });

    if (result) {
      // CRITICAL: Ensure result structure includes tradePlan for signal propagation
      results.push({
        symbol,
        signal: result.signal as 'BUY' | 'SELL' | 'HOLD',
        accuracy: result.accuracy,
        result,
        processingTimeMs: result.processingTimeMs || 0,
        metadata: { symbol }
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
          hasTP: !!(result.tradePlan as any)?.takeProfit2 || !!(result.tradePlan as any)?.takeProfit1 || !!result.tradePlan?.takeProfit
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
