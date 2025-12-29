import { logger } from '../utils/logger';
import { firestoreAdapter, isExchangeUsable } from './firestoreAdapter';
import { getFirebaseAdmin } from '../utils/firebase';
import * as admin from 'firebase-admin';
import type { ResearchDataResult, ResearchData, TradeSignalType, TradeExecutionStatus } from './autoTradeEngine';

// Import the AutoTradeConfig type and DEFAULT_CONFIG
interface AutoTradeConfig {
  autoTradeEnabled: boolean;
  perTradeRiskPct: number;
  maxConcurrentTrades: number;
  maxDailyLossPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  manualOverride: boolean;
  mode: 'AUTO' | 'MANUAL';
  maxTradesPerDay?: number;
  cooldownSeconds?: number;
  symbolCooldowns?: { [symbol: string]: string };
  panicStopEnabled?: boolean;
  slippageBlocker?: boolean;
  lastRun?: Date;
  consecutiveLosses?: number;
  cooldownUntil?: Date;
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

/**
 * Log auto-trade skip with full context and exchange status
 * Used when trades are blocked by risk guards or system conditions
 */
export async function logAutoTradeSkip(
  uid: string,
  reason: string | any, // AutoTradeReason
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
    // Load config - simplified version for history logging
    const db = getFirebaseAdmin().firestore();
    const configDoc = await db.collection('users').doc(uid).collection('autoTradeConfig').doc('current').get();

    let config: AutoTradeConfig = { ...DEFAULT_CONFIG };
    if (configDoc.exists) {
      const data = configDoc.data()!;
      config = {
        ...DEFAULT_CONFIG,
        ...data,
        lastRun: data.lastRun?.toDate(),
        stats: data.stats || DEFAULT_CONFIG.stats,
      } as AutoTradeConfig;
    }

    // Determine exchange status
    let exchangeStatus: 'available' | 'unavailable' | 'decryption_failed' | 'not_connected' | 'unknown' = context.exchangeStatus || 'unknown';
    if (exchangeStatus === 'unknown') {
      // Use unified exchange usability check (SINGLE SOURCE OF TRUTH)
      try {
        const usability = await isExchangeUsable(uid, 'background_job');
        if (usability.usable) {
          exchangeStatus = 'available';
        } else if (usability.reason === 'not_connected') {
          exchangeStatus = 'not_connected';
        } else {
          exchangeStatus = 'decryption_failed';
        }
      } catch (checkErr: any) {
        exchangeStatus = 'unknown';
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
      signal: (context.signal as 'BUY' | 'SELL' | 'HOLD') || 'HOLD',
      status: `SKIPPED: ${reason}`,
    });

    // Log to console with full context
    logger.info(skipLog, `⛔ [AUTO_TRADE_SKIP] ${reason} - acc=${context.accuracy?.toFixed(1) || 'N/A'}% threshold=${context.threshold || 'N/A'}% signal=${context.signal || 'N/A'} exchange=${exchangeStatus}`);
  } catch (error: any) {
    logger.error({ error: error.message, uid, reason }, 'Failed to log auto-trade skip');
  }
}

/**
 * Save SKIPPED auto-trade history when research never executes
 * Called when auto-trade cycle runs but cannot proceed due to provider/config issues
 */
export async function saveAutoTradeHistorySkipped(
  uid: string,
  skipReason: string,
  skipDetails: string,
  cycleId?: string
): Promise<void> {
  // ENFORCE: ONE CYCLE = ONE HISTORY ENTRY
  if (cycleId) {
    try {
      // Check if history already exists for this cycleId (limit to recent entries for performance)
      const recentHistory = await firestoreAdapter.getResearchHistory(uid, 20);
      const existingEntry = recentHistory.find(entry => entry.cycleId === cycleId);

      if (existingEntry) {
        // UPDATE existing entry instead of creating duplicate
        logger.info({ uid, cycleId, skipReason, existingId: existingEntry.id }, '🔄 [HISTORY_ENFORCE] Updating existing cycle history entry instead of creating duplicate');
        await firestoreAdapter.updateResearchHistory(uid, existingEntry.id, {
          skipReason: skipReason,
          skipDetails: skipDetails,
          status: 'SKIPPED',
          decision: 'SKIPPED',
          executionStatus: null,
          symbol: existingEntry.symbol || 'AUTO_TRADE_CYCLE', // Preserve existing symbol
          signal: existingEntry.signal || 'HOLD', // Preserve existing signal
          accuracy: existingEntry.accuracy || 0, // Preserve existing accuracy
          // Keep other fields from existing entry
        });
        return;
      }
    } catch (checkErr: any) {
      logger.warn({ uid, cycleId, error: checkErr.message }, 'Failed to check for existing history entry, proceeding with new entry');
    }
  }

  const historyEntry: any = {
    symbol: 'AUTO_TRADE_CYCLE', // Placeholder symbol for cycle tracking
    signal: 'HOLD', // No signal generated
    accuracy: 0, // No accuracy computed
    price: 0, // No price data
    tradePlan: null, // No trade plan
    indicators: null, // No indicators
    isDeepResearch: false, // Research never ran
    source: 'AUTO_TRADE',
    status: 'SKIPPED',
    isFinal: true,
    decision: 'SKIPPED',
    executionStatus: null,
    skipReason: skipReason,
    skipDetails: skipDetails,
    cycleId: cycleId,
    entryPrice: 0,
    stopLoss: 0,
    takeProfit: 0,
    takeProfit1: 0,
    takeProfit2: 0,
    takeProfit3: 0
  };

  await firestoreAdapter.storeResearchHistory(uid, historyEntry);
  logger.info({ uid, skipReason, cycleId }, '✅ [HISTORY] Auto-trade SKIPPED history saved for cycle');
}

/**
 * Save auto-trade history AFTER execution attempt with executionStatus
 * CRITICAL: This is called ONLY after execution attempt (success or failure)
 * History includes executionStatus from actual execution attempt
 */
export async function saveAutoTradeHistoryWithExecutionStatus(
  uid: string,
  researchResult: ResearchDataResult,
  researchData: ResearchData,
  researchSymbol: string | null,
  finalResult: any,
  finalTradePlan: any,
  accuracy: number,
  signal: TradeSignalType | string,
  historyPrice: number,
  decisionStatus: 'EXECUTED' | 'SKIPPED',
  executionStatus: TradeExecutionStatus | null,
  tradeId: string | null
): Promise<void> {
  // CRITICAL: HISTORY MUST ALWAYS BE SAVED when research runs
  // If symbol is missing, force executionStatus = "SKIPPED" instead of skipping history
  const historySymbol = (researchSymbol ?? researchResult.symbol) ?? null;
  let forceSkipped = false;

  if (!historySymbol || historySymbol.trim().length === 0) {
    logger.warn({ uid, accuracy, signal }, '[HISTORY_FORCE_SKIPPED] Symbol missing from research - forcing executionStatus=SKIPPED but saving history');
    forceSkipped = true;
  }
  if (typeof accuracy !== 'number' || accuracy <= 0) {
    logger.warn({ uid, symbol: historySymbol, accuracy }, '[HISTORY_FORCE_SKIPPED] Invalid accuracy - forcing executionStatus=SKIPPED but saving history');
    forceSkipped = true;
  }
  if (!signal || signal === 'UNKNOWN' || signal === 'ANALYZING' || signal === 'PENDING') {
    logger.warn({ uid, symbol: historySymbol, signal }, '[HISTORY_FORCE_SKIPPED] Invalid signal - forcing executionStatus=SKIPPED but saving history');
    forceSkipped = true;
  }

  // Force executionStatus to SKIPPED if any guard failed
  const finalExecutionStatus = forceSkipped ? 'SKIPPED' : executionStatus;
  const finalDecisionStatus = forceSkipped ? 'SKIPPED' : decisionStatus;

  // CRITICAL: Preserve actual research signal in history, even if tradePlan is null
  // Do NOT force BUY/SELL to HOLD - history should reflect the research result accurately
  const finalSignal = forceSkipped ? 'HOLD' : signal;
  const storedAccuracy = forceSkipped ? 0 : Math.max(0, Math.min(100, Number(accuracy) || 0));
  const safeTradePlan = finalTradePlan ?? null;

  // Build history entry - ALWAYS SAVE when research runs
  const historyEntry: any = {
    symbol: historySymbol || 'BTCUSDT', // Fallback symbol if missing
    signal: finalSignal,
    accuracy: storedAccuracy,
    price: Number(historyPrice) || 0,
    tradePlan: safeTradePlan,
    indicators: finalResult?.analysis || null,
    isDeepResearch: true,
    source: 'AUTO_TRADE',
    status: 'FINAL',
    isFinal: true,
    decision: finalDecisionStatus,
    executionStatus: finalExecutionStatus || null, // CRITICAL: Include executionStatus
    entryPrice: safeTradePlan?.entryPrice ?? 0,
    stopLoss: safeTradePlan?.stopLoss ?? 0,
    takeProfit: safeTradePlan?.takeProfit2 ?? 0,
    takeProfit1: safeTradePlan?.takeProfit1 ?? 0,
    takeProfit2: safeTradePlan?.takeProfit2 ?? 0,
    takeProfit3: safeTradePlan?.takeProfit3 ?? 0
  };

  if (decisionStatus === 'EXECUTED' && tradeId) {
    historyEntry.tradeId = tradeId;
  }

  // CRITICAL: For AUTO_TRADE_RESEARCH, ensure exactly ONE history entry per cycle
  // If executionStatus is provided, this is an update to existing research history
  // If executionStatus is null, this is the initial research completion history save
  await firestoreAdapter.storeResearchHistory(uid, historyEntry);
  logger.info({ uid, symbol: researchResult.symbol, executionStatus, decisionStatus }, '✅ [HISTORY] Auto-trade history saved after execution');
}
