import { logger } from '../utils/logger';
import { firestoreAdapter } from './firestoreAdapter';

export interface TradingAgentConfig {
  id: string;
  userId: string;
  name: string;
  tradingPair: 'BTC/USDT' | 'ETH/USDT';
  marketType: 'spot' | 'futures';
  riskPerTrade: number; // percentage (default: 1%)
  maxConcurrentTrades: number; // max 1 per pair, max 2 total
  maxTradesPerDay: number; // ideal 4-5, max 6
  apiKey?: string;
  apiSecret?: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'STOPPED';
  createdAt: Date;
  approvedAt?: Date;
  lastTradeAt?: Date;
  dailyTrades: number;
  consecutiveLosses: number;
  dailyPnL: number;
  totalPnL: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  drawdown: number;
}

export interface TradingSignal {
  signalId: string; // Unique deterministic signal ID
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: Date;
  candleTimestamp: Date;
  indicators: {
    rsi: number;
    ema50: number;
    bbUpper: number;
    bbLower: number;
    atr: number;
  };
}

export interface TradeRecord {
  id: string;
  signalId: string; // For idempotency
  agentId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  pnl?: number;
  status: 'OPEN' | 'CLOSED' | 'STOPPED';
  entryTime: Date;
  exitTime?: Date;
  candleTimestamp: Date;
  indicators: TradingSignal['indicators'];
}

export class TradingAgent {
  private config: TradingAgentConfig;

  constructor(config: TradingAgentConfig) {
    this.config = config;
  }

  /**
   * Check if agent can trade based on daily limits and risk rules
   * Note: This is now a legacy method - actual checks are done in executeAgent
   */
  canTrade(): { canTrade: boolean; reason?: string } {
    // This method is kept for compatibility but actual validation happens in executeAgent
    // with hardened daily counters from database
    return { canTrade: this.config.status === 'ACTIVE' };
  }

  /**
   * Calculate position size based on risk management rules
   */
  calculatePositionSize(accountBalance: number, entryPrice: number): number {
    const riskAmount = accountBalance * (this.config.riskPerTrade / 100);
    // Risk amount = account balance * risk percentage
    // Position size = risk amount / (entry price * risk per trade ATR multiple)
    // For simplicity, assume 1 ATR risk per trade
    const atrRisk = 1; // 1 ATR stop loss
    const positionValue = riskAmount / atrRisk;
    return positionValue / entryPrice;
  }

  /**
   * Generate trading signal based on indicators
   */
  generateSignal(
    candle: any,
    indicators: {
      rsi: number;
      ema50: number;
      bbUpper: number;
      bbLower: number;
      atr: number;
    }
  ): TradingSignal | null {
    const { price, timestamp } = candle;
    const { rsi, ema50, bbUpper, bbLower, atr } = indicators;

    // Create deterministic signal ID from agent + candle + indicators
    const createSignalId = (direction: 'LONG' | 'SHORT') => {
      const signalData = `${this.config.id}:${timestamp}:${direction}:${price}:${rsi}:${ema50}:${bbUpper}:${bbLower}:${atr}`;
      // Simple hash for deterministic ID
      let hash = 0;
      for (let i = 0; i < signalData.length; i++) {
        const char = signalData.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return `signal_${Math.abs(hash).toString(36)}`;
    };

    // LONG conditions - ALL must be met
    if (
      price > ema50 && // Price above EMA 50 (trend filter)
      rsi < 30 && // RSI oversold
      (price <= bbLower) // Price touches or closes below lower BB
    ) {
      const entryPrice = price;
      const stopLoss = entryPrice - atr; // 1 ATR stop loss
      const takeProfit = entryPrice + (0.8 * atr); // 0.8 ATR take profit
      const signalId = createSignalId('LONG');

      return {
        signalId,
        direction: 'LONG',
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp: new Date(),
        candleTimestamp: new Date(timestamp),
        indicators: { rsi, ema50, bbUpper, bbLower, atr }
      };
    }

    // SHORT conditions - ALL must be met
    if (
      price < ema50 && // Price below EMA 50 (trend filter)
      rsi > 70 && // RSI overbought
      (price >= bbUpper) // Price touches or closes above upper BB
    ) {
      const entryPrice = price;
      const stopLoss = entryPrice + atr; // 1 ATR stop loss
      const takeProfit = entryPrice - (0.8 * atr); // 0.8 ATR take profit
      const signalId = createSignalId('SHORT');

      return {
        signalId,
        direction: 'SHORT',
        entryPrice,
        stopLoss,
        takeProfit,
        timestamp: new Date(),
        candleTimestamp: new Date(timestamp),
        indicators: { rsi, ema50, bbUpper, bbLower, atr }
      };
    }

    return null; // No signal
  }

  /**
   * Check for duplicate/overtrading protection with idempotency
   * Note: Most checks are now done at executeAgent level for hardening
   */
  checkOvertradingProtection(signal: TradingSignal, recentTrades: TradeRecord[], lastProcessedCandle?: Date): boolean {
    // Check if this exact signal was already executed (idempotency)
    const existingSignal = recentTrades.find(t => t.signalId === signal.signalId);
    if (existingSignal) {
      logger.info({
        agentId: this.config.id,
        signalId: signal.signalId,
        existingTradeId: existingSignal.id
      }, 'Idempotency: signal already executed, skipping');
      return false;
    }

    // Note: Other checks (candle determinism, position limits, cooldowns) are now
    // handled at the executeAgent level with database-backed enforcement

    return true;
  }

  /**
   * Execute trade with risk management
   */
  async executeTrade(
    signal: TradingSignal,
    accountBalance: number,
    dailyCounters?: { consecutiveLosses: number; dailyPnL: number; tradesToday: number }
  ): Promise<TradeRecord | null> {
    try {
      // Validate agent can trade
      const canTradeCheck = this.canTrade();
      if (!canTradeCheck.canTrade) {
        logger.info({
          agentId: this.config.id,
          reason: canTradeCheck.reason
        }, 'Trade blocked by risk rules');
        return null;
      }

      // Get recent trades for overtrading protection
      const recentTrades = await firestoreAdapter.getAgentTrades(this.config.id, 10);

      // Check overtrading protection
      if (!this.checkOvertradingProtection(signal, recentTrades)) {
        return null;
      }

      // Calculate position size
      const quantity = this.calculatePositionSize(accountBalance, signal.entryPrice);

      // Create trade record
      const tradeRecord: TradeRecord = {
        id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        signalId: signal.signalId, // For idempotency
        agentId: this.config.id,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        quantity,
        status: 'OPEN',
        entryTime: signal.timestamp,
        candleTimestamp: signal.candleTimestamp,
        indicators: signal.indicators
      };

      // Save trade to database
      await firestoreAdapter.saveAgentTrade(tradeRecord);

      // Update agent stats
      await this.updateAgentStatsAfterTrade();

      logger.info({
        agentId: this.config.id,
        tradeId: tradeRecord.id,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        quantity
      }, 'Trade executed successfully');

      return tradeRecord;
    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute trade');
      return null;
    }
  }

  /**
   * Update agent statistics after trade
   */
  private async updateAgentStatsAfterTrade(): Promise<void> {
    try {
      // Update daily trades counter
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const updatedConfig = {
        ...this.config,
        dailyTrades: this.config.dailyTrades + 1,
        lastTradeAt: new Date()
      };

      // Reset daily counters if it's a new day
      const lastTradeDate = this.config.lastTradeAt ? new Date(this.config.lastTradeAt) : null;
      if (!lastTradeDate || lastTradeDate < today) {
        updatedConfig.dailyTrades = 1;
        updatedConfig.consecutiveLosses = 0;
        updatedConfig.dailyPnL = 0;
      }

      this.config = updatedConfig;
      await firestoreAdapter.updateAgentConfig(this.config.id, updatedConfig);
    } catch (error) {
      logger.error({
        agentId: this.config.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to update agent stats');
    }
  }

  /**
   * Get agent performance summary
   */
  getPerformanceSummary() {
    return {
      totalTrades: this.config.totalTrades,
      winningTrades: this.config.winningTrades,
      losingTrades: this.config.losingTrades,
      winRate: this.config.totalTrades > 0 ? (this.config.winningTrades / this.config.totalTrades) * 100 : 0,
      totalPnL: this.config.totalPnL,
      dailyPnL: this.config.dailyPnL,
      dailyTrades: this.config.dailyTrades,
      consecutiveLosses: this.config.consecutiveLosses,
      drawdown: this.config.drawdown,
      lastTradeAt: this.config.lastTradeAt
    };
  }

  /**
   * Get agent strategy overview
   */
  getStrategyOverview() {
    return {
      name: this.config.name,
      tradingPair: this.config.tradingPair,
      marketType: this.config.marketType,
      indicators: ['RSI (14)', 'Bollinger Bands (20, 2)', 'EMA (50)', 'ATR (14)'],
      entryConditions: {
        LONG: [
          'Price > EMA 50',
          'RSI (14) < 30',
          'Price touches or closes below Lower Bollinger Band'
        ],
        SHORT: [
          'Price < EMA 50',
          'RSI (14) > 70',
          'Price touches or closes above Upper Bollinger Band'
        ]
      },
      riskManagement: {
        stopLoss: '1 × ATR from entry',
        takeProfit: '0.8 × ATR from entry',
        riskPerTrade: `${this.config.riskPerTrade}% of account equity`,
        maxConcurrentTrades: this.config.maxConcurrentTrades,
        maxTradesPerDay: this.config.maxTradesPerDay,
        dailySafetyRules: [
          'Stop trading after 3 consecutive losses',
          'Stop trading after reaching +2R daily profit',
          'Maximum 6 trades per day'
        ]
      },
      expectedPerformance: {
        tradesPerDay: '4-5',
        expectedDrawdown: 'Conservative risk management prevents large drawdowns',
        survivability: 'Rule-based, deterministic strategy with strict risk controls'
      }
    };
  }
}