"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoTradeController = void 0;
const tradingEngine_1 = require("./tradingEngine");
const firestoreAdapter_1 = require("./firestoreAdapter");
const logger_1 = require("../utils/logger");
class AutoTradeController {
    constructor() {
        this.pending = new Map();
        this.perUserRate = new Map();
    }
    async getGlobalSettings() {
        try {
            return await firestoreAdapter_1.firestoreAdapter.getGlobalSettings();
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message }, 'Failed to fetch global settings');
            return {};
        }
    }
    enforceUserRateLimit(uid, maxPerMinute) {
        const now = Date.now();
        const entry = this.perUserRate.get(uid) || { count: 0, windowStart: now };
        if (now - entry.windowStart >= 60000) {
            entry.count = 0;
            entry.windowStart = now;
        }
        if (entry.count >= maxPerMinute) {
            throw new Error('User order rate limit exceeded');
        }
        entry.count += 1;
        this.perUserRate.set(uid, entry);
    }
    getAccuracyPercent(report) {
        if (typeof report.confidence === 'number')
            return report.confidence;
        if (typeof report.accuracy === 'number')
            return Math.round(report.accuracy * 100);
        return 0;
    }
    determineSide(report) {
        if (report.signal === 'BUY')
            return 'BUY';
        if (report.signal === 'SELL')
            return 'SELL';
        if (report.entrySignal === 'LONG')
            return 'BUY';
        if (report.entrySignal === 'SHORT')
            return 'SELL';
        return null;
    }
    getUserRiskSettings(userSettings) {
        return {
            perTradeRiskPct: userSettings?.per_trade_risk_pct || userSettings?.perTradeRiskPct || 1,
            maxSpreadPct: userSettings?.maxSpreadPct || userSettings?.maxSpread || 0.004,
            minNotional: userSettings?.minNotional || 10,
            manualConfirmation: userSettings?.autoTradeManualConfirm || false,
        };
    }
    async processResearch(uid, report) {
        const accuracyPercent = this.getAccuracyPercent(report);
        const decision = {
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
            firestoreAdapter_1.firestoreAdapter.getUser(uid),
            firestoreAdapter_1.firestoreAdapter.getSettings(uid),
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
        const liquidityAcceptable = typeof report.liquidityAcceptable === 'boolean'
            ? report.liquidityAcceptable
            : !(report.features?.liquidity?.toLowerCase().includes('low') ?? false);
        if (!liquidityAcceptable) {
            decision.reason = 'Liquidity not acceptable';
            return decision;
        }
        const risk = this.getUserRiskSettings(userSettings);
        const context = await firestoreAdapter_1.firestoreAdapter.getActiveExchangeForUser(uid);
        // Handle fallback object when no exchange is configured
        if (context && typeof context === 'object' && 'exchangeConfigured' in context && context.exchangeConfigured === false) {
            decision.reason = 'No exchange integration configured';
            return decision;
        }
        // Type assertion since we've handled the fallback case
        const activeContext = context;
        if (!activeContext) {
            decision.reason = 'No exchange adapter available';
            return decision;
        }
        // Orderbook spread check
        const orderbook = await activeContext.adapter.getOrderbook(report.symbol, 5);
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
        const balance = await tradingEngine_1.tradingEngine.getBalance(uid);
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
        const positions = await tradingEngine_1.tradingEngine.getPositions(uid, report.symbol);
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
            const orderResponse = await tradingEngine_1.tradingEngine.placeMarketOrder(uid, report.symbol, side, quantity, {
                rateLimitPerMinute: globalSettings?.adapterOrderRate || 30,
            });
            await this.persistSuccess(uid, report, quantity, price, orderResponse);
            decision.triggered = true;
            return decision;
        }
        catch (error) {
            await this.persistFailure(uid, report, error);
            decision.reason = error.message || 'Failed to place order';
            return decision;
        }
    }
    async confirmPending(uid) {
        const pending = this.pending.get(uid);
        if (!pending) {
            throw new Error('No pending auto-trade found');
        }
        if (pending.expires < Date.now()) {
            this.pending.delete(uid);
            throw new Error('Pending auto-trade expired');
        }
        try {
            const response = await tradingEngine_1.tradingEngine.placeMarketOrder(uid, pending.symbol, pending.side, pending.quantity);
            await this.persistSuccess(uid, pending.research, pending.quantity, pending.price, response);
            this.pending.delete(uid);
            return response;
        }
        catch (error) {
            await this.persistFailure(uid, pending.research, error);
            this.pending.delete(uid);
            throw error;
        }
    }
    async persistSuccess(uid, report, quantity, price, orderResponse) {
        try {
            await firestoreAdapter_1.firestoreAdapter.saveTrade(uid, {
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
            await firestoreAdapter_1.firestoreAdapter.createNotification(uid, {
                title: 'Auto-Trade Executed',
                message: `${report.symbol} ${orderResponse.orderId || ''} filled`,
                type: 'success',
            });
            await firestoreAdapter_1.firestoreAdapter.logActivity(uid, 'AUTO_TRADE_EXECUTED', {
                symbol: report.symbol,
                qty: quantity,
                price,
                orderId: orderResponse.orderId,
            });
        }
        catch (error) {
            logger_1.logger.warn({ error: error.message, uid }, 'Failed to persist auto-trade success');
        }
    }
    async persistFailure(uid, report, error) {
        const errorId = `auto_trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            await firestoreAdapter_1.firestoreAdapter.logError(errorId, {
                uid,
                path: `autoTrade/${uid}`,
                message: 'Auto-trade failed',
                error: error.message || 'Unknown error',
                metadata: {
                    symbol: report.symbol,
                    confidence: this.getAccuracyPercent(report),
                },
            });
            await firestoreAdapter_1.firestoreAdapter.createNotification(uid, {
                title: 'Auto-Trade Failed',
                message: `${report.symbol} - ${error.message || 'Unknown error'} (ID: ${errorId})`,
                type: 'error',
            });
            await firestoreAdapter_1.firestoreAdapter.logActivity(uid, 'AUTO_TRADE_FAILED', {
                symbol: report.symbol,
                error: error.message,
                errorId,
            });
        }
        catch (persistErr) {
            logger_1.logger.error({ error: persistErr.message, uid }, 'Failed to persist auto-trade failure');
        }
    }
}
exports.autoTradeController = new AutoTradeController();
