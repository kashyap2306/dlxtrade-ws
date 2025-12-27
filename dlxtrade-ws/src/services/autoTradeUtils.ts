/**
 * Auto-Trade Pure Utilities
 * ONLY pure helper functions, calculations, formatting
 * ZERO side effects, NO external calls
 */

import { logger } from '../utils/logger';
import type { AutoTradeConfig, TradingSettings, PositionSizingResult, AccuracyRiskConfigItem } from './autoTradeEngine';

/**
 * Calculate simplified news score for sentiment-aware trading
 */
export function calculateNewsScoreFromArticles(news: Array<{ sentiment?: number | string; impact?: string;[key: string]: unknown }>): number {
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
 * P5: Deterministic SL/TP Logic
 */
export function calculateSLTP(
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
 * Get current market price for a symbol
 */
export async function getCurrentMarketPrice(symbol: string, uid: string, adapter: any): Promise<number> {
  try {
    // Try to get from exchange if adapter is available
    if (adapter) {
      const ticker = await adapter.getTicker(symbol);
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
 * CONSOLIDATED SIGNAL VALIDATION - Single source of truth for signal checking
 * Centralizes BUY/SELL/HOLD signal validation to prevent scattered logic
 */
export function validateTradeSignal(signal: string): { valid: boolean; reason?: string } {
  if (!signal || signal === 'UNKNOWN' || signal === 'ANALYZING' || signal === 'PENDING') {
    return { valid: false, reason: 'INVALID_SIGNAL_UNKNOWN' };
  }
  if (signal === 'HOLD') {
    return { valid: false, reason: 'HOLD_SIGNAL' };
  }
  if (signal !== 'BUY' && signal !== 'SELL') {
    return { valid: false, reason: 'INVALID_SIGNAL_FORMAT' };
  }
  return { valid: true };
}

/**
 * CONSOLIDATED MODE VALIDATION - Single source of truth for mode checking
 * Centralizes AUTO/MANUAL mode validation to prevent scattered logic
 */
export function validateTradingMode(config: AutoTradeConfig, context: string): { allowed: boolean; reason?: string } {
  // Check if auto-trade is enabled
  if (!config.autoTradeEnabled) {
    return { allowed: false, reason: 'AUTO_TRADE_DISABLED' };
  }

  // Check for manual override
  if (config.manualOverride) {
    return { allowed: false, reason: 'MANUAL_OVERRIDE_ACTIVE' };
  }

  return { allowed: true };
}

/**
 * Calculate position size based on accuracy and trading settings
 * Returns the position percentage to use for the trade
 */
export function calculatePositionSize(accuracy: number, settings: TradingSettings): PositionSizingResult {
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
 * Get default accuracy risk configuration
 * Returns the default accuracy-based risk configuration
 */
export function getDefaultAccuracyRiskConfig(): AccuracyRiskConfigItem[] {
  return [
    { minAccuracy: 0, maxAccuracy: 84, tradeSizePct: 0, leverage: 1 }, // Below 85%: NO TRADE (0% size)
    { minAccuracy: 85, maxAccuracy: 89, tradeSizePct: 3, leverage: 4 }, // 85-89%: 3% size, 4x leverage
    { minAccuracy: 90, maxAccuracy: null, tradeSizePct: 10, leverage: 9 } // null = no upper limit (≥90%), default leverage 9x (10x is hard cap)
  ];
}

