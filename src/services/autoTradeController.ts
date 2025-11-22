import type { ResearchResult } from './researchEngine';
import { tradingEngine, TradingOrderResponse } from './tradingEngine';
import { firestoreAdapter } from './firestoreAdapter';
import { logger } from '../utils/logger';

interface AutoTradeDecision {
  eligible: boolean;
  triggered: boolean;
  threshold: number;
  confidence: number;
  requiresConfirmation?: boolean;
  reason?: string;
  spread?: number;
  price?: number;
  quantity?: number;
  symbol?: string;
}

interface PendingDecision {
  uid: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  research: ResearchResult;
  expires: number;
}

class AutoTradeController {
  private pending: Map<string, PendingDecision> = new Map();
  private perUserRate: Map<string, { count: number; windowStart: number }> = new Map();

  private async getGlobalSettings() {
    try {
      return await firestoreAdapter.getGlobalSettings();
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to fetch global settings');
      return {};
    }
  }

  private enforceUserRateLimit(uid: string, maxPerMinute: number) {
    const now = Date.now();
    const entry = this.perUserRate.get(uid) || { count: 0, windowStart: now };
    if (now - entry.windowStart >= 60_000) {
      entry.count = 0;
      entry.windowStart = now;
    }
    if (entry.count >= maxPerMinute) {
      throw new Error('User order rate limit exceeded');
    }
    entry.count += 1;
    this.perUserRate.set(uid, entry);
  }

  private getAccuracyPercent(report: ResearchResult): number {
    if (typeof report.confidence === 'number') return report.confidence;
    if (typeof report.accuracy === 'number') return Math.round(report.accuracy * 100);
    return 0;
  }

  private determineSide(report: ResearchResult): 'BUY' | 'SELL' | null {
    if (report.signal === 'BUY') return 'BUY';
    if (report.signal === 'SELL') return 'SELL';
    if (report.entrySignal === 'LONG') return 'BUY';
    if (report.entrySignal === 'SHORT') return 'SELL';
    return null;
  }

  private getUserRiskSettings(userSettings: any) {
    return {
      perTradeRiskPct: userSettings?.per_trade_risk_pct || userSettings?.perTradeRiskPct || 1,
      maxSpreadPct: userSettings?.maxSpreadPct || userSettings?.maxSpread || 0.004,
      minNotional: userSettings?.minNotional || 10,
      manualConfirmation: userSettings?.autoTradeManualConfirm || false,
    };
  }

  async processResearch(uid: string, report: ResearchResult): Promise<AutoTradeDecision | null> {
    const accuracyPercent = this.getAccuracyPercent(report);
    const decision: AutoTradeDecision = {
      eligible: false,
      triggered: false,
      threshold: 75,
      confidence: accuracyPercent,
    };
    if (accuracyPercent < decision.threshold) {
      return decision;
    }

    const side = this.determineSide(report);
    if (!side) {
      decision.reason = 'Signal is neutral';
      return decision;
    }

    const [globalSettings, userSnapshot, userSettings] = await Promise.all([
      this.getGlobalSettings(),
      firestoreAdapter.getUser(uid),
      firestoreAdapter.getSettings(uid),
    ]);

    if (globalSettings?.autoTradePaused) {
      decision.reason = 'Auto-trade globally paused';
      return decision;
    }

    if (!userSnapshot?.autoTradeEnabled) {
      decision.reason = 'User auto-trade disabled';
      return decision;
    }

    const confluenceCount = report.mtfConfluenceCount ?? 0;
    if (confluenceCount < 2) {
      decision.reason = 'Insufficient multi-timeframe confluence';
      return decision;
    }

    const derivativesAligned = report.derivativesAligned === true;
    if (!derivativesAligned) {
      decision.reason = 'Derivatives contradict signal';
      return decision;
    }

    const liquidityAcceptable =
      typeof report.liquidityAcceptable === 'boolean'
        ? report.liquidityAcceptable
        : !(report.features?.liquidity?.toLowerCase().includes('low') ?? false);
    if (!liquidityAcceptable) {
      decision.reason = 'Liquidity not acceptable';
      return decision;
    }

    const risk = this.getUserRiskSettings(userSettings);
    const context = await firestoreAdapter.getActiveExchangeForUser(uid);
    if (!context) {
      decision.reason = 'No exchange adapter available';
      return decision;
    }

    // Orderbook spread check
    const orderbook = await context.adapter.getOrderbook(report.symbol, 5);
    const bestBid = parseFloat(orderbook.bids?.[0]?.price || '0');
    const bestAsk = parseFloat(orderbook.asks?.[0]?.price || '0');
    if (!bestBid || !bestAsk) {
      decision.reason = 'Insufficient liquidity';
      return decision;
    }
    const spread = Math.abs(bestAsk - bestBid) / bestBid;
    if (spread > risk.maxSpreadPct) {
      decision.reason = `Spread ${spread * 100}% exceeds threshold`;
      return decision;
    }

    // Balance check
    const balance = await tradingEngine.getBalance(uid);
    const price = report.entryPrice || report.currentPrice || bestAsk;
    const available = balance.availableUSDT || balance.totalUSDT;
    if (!available || available < risk.minNotional) {
      decision.reason = 'Insufficient balance';
      return decision;
    }
    const notional = Math.max((available * risk.perTradeRiskPct) / 100, risk.minNotional);
    const quantity = parseFloat((notional / price).toFixed(4));
    if (!quantity || quantity <= 0) {
      decision.reason = 'Calculated quantity is invalid';
      return decision;
    }

    // Position check
    const positions = await tradingEngine.getPositions(uid, report.symbol);
    if (positions.length > 0) {
      decision.reason = 'Existing position open';
      return decision;
    }

    // Rate limit per user
    const maxPerMinute = globalSettings?.autoTradeMaxOrdersPerMinute || 3;
    this.enforceUserRateLimit(uid, maxPerMinute);

    decision.eligible = true;
    decision.confidence = accuracyPercent;
    decision.spread = spread;
    decision.price = price;
    decision.quantity = quantity;
    decision.symbol = report.symbol;

    const requiresConfirmation = Boolean(userSnapshot?.autoTradeManualConfirm || risk.manualConfirmation);
    if (requiresConfirmation) {
      this.pending.set(uid, {
        uid,
        symbol: report.symbol,
        side,
        quantity,
        price,
        research: report,
        expires: Date.now() + 2 * 60 * 1000,
      });
      decision.requiresConfirmation = true;
      decision.reason = 'Awaiting manual confirmation';
      return decision;
    }

    try {
      const orderResponse = await tradingEngine.placeMarketOrder(uid, report.symbol, side, quantity, {
        rateLimitPerMinute: globalSettings?.adapterOrderRate || 30,
      });
      await this.persistSuccess(uid, report, quantity, price, orderResponse);
      decision.triggered = true;
      return decision;
    } catch (error: any) {
      await this.persistFailure(uid, report, error);
      decision.reason = error.message || 'Failed to place order';
      return decision;
    }
  }

  async confirmPending(uid: string): Promise<TradingOrderResponse> {
    const pending = this.pending.get(uid);
    if (!pending) {
      throw new Error('No pending auto-trade found');
    }
    if (pending.expires < Date.now()) {
      this.pending.delete(uid);
      throw new Error('Pending auto-trade expired');
    }

    try {
      const response = await tradingEngine.placeMarketOrder(uid, pending.symbol, pending.side, pending.quantity);
      await this.persistSuccess(uid, pending.research, pending.quantity, pending.price, response);
      this.pending.delete(uid);
      return response;
    } catch (error: any) {
      await this.persistFailure(uid, pending.research, error);
      this.pending.delete(uid);
      throw error;
    }
  }

  private async persistSuccess(
    uid: string,
    report: ResearchResult,
    quantity: number,
    price: number,
    orderResponse: TradingOrderResponse
  ) {
    try {
      await firestoreAdapter.saveTrade(uid, {
        symbol: report.symbol,
        side: this.determineSide(report) || 'BUY',
        qty: quantity,
        entryPrice: orderResponse.price || price,
        engineType: 'auto',
        orderId: orderResponse.orderId,
        metadata: {
          research: {
            confidence: this.getAccuracyPercent(report),
            signal: report.signal,
          },
          orderResponse,
        },
      });
      await firestoreAdapter.createNotification(uid, {
        title: 'Auto-Trade Executed',
        message: `${report.symbol} ${orderResponse.orderId || ''} filled`,
        type: 'success',
      });
      await firestoreAdapter.logActivity(uid, 'AUTO_TRADE_EXECUTED', {
        symbol: report.symbol,
        qty: quantity,
        price,
        orderId: orderResponse.orderId,
      });
    } catch (error: any) {
      logger.warn({ error: error.message, uid }, 'Failed to persist auto-trade success');
    }
  }

  private async persistFailure(uid: string, report: ResearchResult | PendingDecision['research'], error: any) {
    const errorId = `auto_trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await firestoreAdapter.logError(errorId, {
        uid,
        path: `autoTrade/${uid}`,
        message: 'Auto-trade failed',
        error: error.message || 'Unknown error',
        metadata: {
          symbol: report.symbol,
          confidence: this.getAccuracyPercent(report as ResearchResult),
        },
      });
      await firestoreAdapter.createNotification(uid, {
        title: 'Auto-Trade Failed',
        message: `${report.symbol} - ${error.message || 'Unknown error'} (ID: ${errorId})`,
        type: 'error',
      });
      await firestoreAdapter.logActivity(uid, 'AUTO_TRADE_FAILED', {
        symbol: report.symbol,
        error: error.message,
        errorId,
      });
    } catch (persistErr: any) {
      logger.error({ error: persistErr.message, uid }, 'Failed to persist auto-trade failure');
    }
  }
}

export const autoTradeController = new AutoTradeController();

