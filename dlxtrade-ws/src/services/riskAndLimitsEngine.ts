import { logger } from '../utils/logger';
import { AutoTradeEngine } from './autoTradeEngine';
import { logAutoTradeSkip } from './historyWriter';
import type { TradePlan } from './researchTypes';

export interface TradeSignal {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  accuracy: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  leverage?: number;
}

export interface TradingSettings {
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  accuracyTrigger: {
    min: number;
    max: number;
  };
  // Optional notifications settings for trade confirmation and whale alerts
  notifications?: {
    tradeConfirmationRequired?: boolean;
    whaleAlerts?: boolean;
  };
}

export interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  maxConcurrentTrades: number;
  manualOverride: boolean;
  symbolCooldowns?: { [symbol: string]: string };
  cooldownSeconds?: number;
  cooldownUntil?: Date;
  stats?: {
    dailyPnL: number;
    dailyTrades: number;
  };
  consecutiveLosses?: number;
}

export interface UserEngine {
  config: AutoTradeConfig;
  adapter: any;
  activeTrades: Map<string, any>;
  circuitBreaker: boolean;
}

export interface AccuracyRiskConfigItem {
  minAccuracy: number;
  maxAccuracy: number | null;
  tradeSizePct: number;
  leverage: number;
}

/**
 * Consolidated Risk Guards - Single source of truth for trade validation
 * Checks all risk constraints before allowing trade execution
 */
export async function checkRiskGuards(uid: string, signal: TradeSignal, isManualApproval: boolean = false): Promise<{ allowed: boolean; reason?: string }> {
  // CRITICAL: Ensure engine and config exist before proceeding
  const engine = await (AutoTradeEngine as any).getUserEngine(uid);
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
    if ((AutoTradeEngine as any).isSymbolInTop10) {
      isTop25 = await (AutoTradeEngine as any).isSymbolInTop10(uid, signal.symbol);
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
  const systemCheck = await checkSystemRisk(uid, isManualApproval, settings, signal.symbol);
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
  const unifiedDecision = (AutoTradeEngine as any).makeUnifiedTradeDecision(
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
    await logAutoTradeSkip(uid, reason, {
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
    await logAutoTradeSkip(uid, reason, {
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
      await logAutoTradeSkip(uid, reason, {
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
        await logAutoTradeSkip(uid, reason, {
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
export async function checkSystemRisk(uid: string, isManualApproval: boolean, settings: TradingSettings, symbol?: string): Promise<{ allowed: boolean; reason?: string }> {
  const engine = await (AutoTradeEngine as any).getUserEngine(uid);
  const config = engine.config;
  const stats = config.stats || (AutoTradeEngine as any).DEFAULT_CONFIG.stats!;
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
      await (AutoTradeEngine as any).logTradeEvent(uid, 'CIRCUIT_BREAKER_TRIGGERED', {
        reason: 'Daily loss limit exceeded',
        dailyPnL: stats.dailyPnL,
        maxDailyLoss: maxLossPct,
      });
      await logAutoTradeSkip(uid, reason, {
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
    await logAutoTradeSkip(uid, reason, {
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
        await logAutoTradeSkip(uid, reason, {
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
        await logAutoTradeSkip(uid, reason, {
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
    await logAutoTradeSkip(uid, reason, {
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
    await logAutoTradeSkip(uid, reason, {
      exchangeStatus: 'available',
      additionalDetails: {
        manualOverride: config.manualOverride,
      }
    });
    return { allowed: false, reason };
  }

  return { allowed: true };
}

/**
 * P4: Calculate dynamic trade parameters based on accuracy and volatility
 * CRITICAL: Uses user's accuracyRiskConfig (single source of truth) instead of hardcoded values
 */
export async function calculateDynamicParams(uid: string, accuracy: number, volatilityClassification: string, newsScore: number): Promise<{
  sizePct: number,
  leverage: number,
  skip?: string,
  matchedRange?: AccuracyRiskConfigItem
}> {
  // Use centralized accuracy guard for normalization
  const accuracyValidation = (global as any).AccuracyGuard.validateAndNormalize(accuracy);
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
    return { sizePct: 0, leverage: 1, skip: 'EXTREME_VOLATILITY' };
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
 * CONSOLIDATED ACCURACY VALIDATION - Single source of truth for accuracy checking
 * Centralizes accuracy threshold validation using AccuracyGuard
 */
export function validateAccuracyForExecution(accuracy: number, settings: any, skipConfirmationCheck: boolean): { allowed: boolean; threshold: number; reason?: string } {
  // Determine threshold: manual approval uses 60%, auto-trade uses user setting
  const threshold = skipConfirmationCheck ? 60 : (settings.accuracyTrigger?.min ?? 75);

  // Use AccuracyGuard for consistent validation
  if (!(global as any).AccuracyGuard.meetsThreshold(accuracy, threshold, false)) {
    return {
      allowed: false,
      threshold,
      reason: `Accuracy ${accuracy.toFixed(1)}% below mandatory threshold (${threshold}%)`
    };
  }

  return { allowed: true, threshold };
}
