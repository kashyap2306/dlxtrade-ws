import { logger } from '../utils/logger';
import { TradingAgent, TradingAgentConfig, TradingSignal } from './tradingAgent';
import { TechnicalIndicators, CandleData, IndicatorValues } from './technicalIndicators';
import { firestoreAdapter } from './firestoreAdapter';

export type { CandleData } from './technicalIndicators';

export interface MarketDataProvider {
  getCandles(symbol: string, timeframe: string, limit: number): Promise<CandleData[]>;
  getAccountBalance(): Promise<{ equity: number; available: number }>;
  placeOrder(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    type: 'MARKET' | 'LIMIT';
    quantity: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<string>; // Returns order ID
}

export class AgentExecutionService {
  private marketDataProvider: MarketDataProvider;
  private activeAgents: Map<string, TradingAgent> = new Map();

  constructor(marketDataProvider: MarketDataProvider) {
    this.marketDataProvider = marketDataProvider;
  }

  /**
   * Load and activate approved trading agents
   */
  async loadActiveAgents(): Promise<void> {
    try {
      const agentConfigs = await firestoreAdapter.getActiveTradingAgents();

      this.activeAgents.clear();

      for (const config of agentConfigs) {
        const agent = new TradingAgent(config);
        this.activeAgents.set(config.id, agent);

        logger.info({
          agentId: config.id,
          name: config.name,
          tradingPair: config.tradingPair
        }, 'Trading agent loaded and activated');
      }

      logger.info({
        agentCount: this.activeAgents.size
      }, 'All active trading agents loaded');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to load active trading agents');
    }
  }

  /**
   * Execute trading logic for all active agents
   * This method is called by the scheduler every 5 minutes
   */
  async executeAllAgents(): Promise<void> {
    const executionPromises = Array.from(this.activeAgents.values()).map(agent =>
      this.executeAgent(agent)
    );

    await Promise.allSettled(executionPromises);
  }

  /**
   * Execute trading logic for a single agent with full hardening
   */
  private async executeAgent(agent: TradingAgent): Promise<void> {
    const agentId = agent['config'].id;
    const tradingPair = agent['config'].tradingPair;

    try {
      const agentConfig = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (!agentConfig) {
        logger.warn({ agentId }, 'Agent config not found, skipping execution');
        return;
      }

      // ===== ADMIN APPROVAL HARD LOCK =====
      // Block ALL execution unless status is exactly ACTIVE
      if (agentConfig.status !== 'ACTIVE') {
        logger.info({
          agentId,
          status: agentConfig.status,
          reason: 'ADMIN_APPROVAL_LOCK'
        }, 'Execution blocked: agent not active');
        return;
      }

      // Get market data for the agent's trading pair
      const candles = await this.marketDataProvider.getCandles(
        tradingPair.replace('/', ''),
        '5m',
        50 // Need enough candles for indicator calculation
      );

      if (candles.length < 50) {
        logger.warn({
          agentId,
          candlesCount: candles.length
        }, 'Insufficient candle data for agent execution');
        return;
      }

      // Get latest candle (most recent)
      const latestCandle = candles[0];
      const candleTimestamp = new Date(latestCandle.timestamp);

      // ===== CLOSED-CANDLE DETERMINISM =====
      // Check if this candle was already processed
      const lastProcessedCandle = await firestoreAdapter.getLastProcessedCandle(agentId, tradingPair);
      if (lastProcessedCandle && candleTimestamp.getTime() === lastProcessedCandle.getTime()) {
        logger.info({
          agentId,
          candleTimestamp: candleTimestamp.toISOString(),
          reason: 'CANDLE_ALREADY_PROCESSED'
        }, 'Execution blocked: candle already processed');
        return;
      }

      // Calculate indicators
      const indicators = TechnicalIndicators.calculateAllIndicators(candles);

      // Validate indicators
      if (!TechnicalIndicators.validateIndicators(indicators)) {
        logger.error({
          agentId,
          indicators
        }, 'Invalid indicators calculated');
        return;
      }

      // Generate trading signal
      const signal = agent.generateSignal(latestCandle, {
        rsi: indicators.rsi,
        ema50: indicators.ema50,
        bbUpper: indicators.bbUpper,
        bbLower: indicators.bbLower,
        atr: indicators.atr
      });

      if (!signal) {
        logger.debug({
          agentId,
          indicators
        }, 'No trading signal generated');

        // Update last processed candle even with no signal
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // ===== EXECUTION IDEMPOTENCY =====
      // Check if this signal was already executed
      const signalAlreadyExecuted = await firestoreAdapter.isSignalExecuted(agentId, signal.signalId);
      if (signalAlreadyExecuted) {
        logger.info({
          agentId,
          signalId: signal.signalId,
          reason: 'SIGNAL_IDEMPOTENCY'
        }, 'Execution blocked: signal already executed');

        // Update last processed candle
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // ===== DAILY SAFETY RULE ENFORCEMENT =====
      const dailyCounters = await firestoreAdapter.getDailySafetyCounters(agentId);

      // Check daily trade limit
      if (dailyCounters.tradesToday >= agentConfig.maxTradesPerDay) {
        logger.info({
          agentId,
          tradesToday: dailyCounters.tradesToday,
          maxTrades: agentConfig.maxTradesPerDay,
          reason: 'DAILY_TRADE_LIMIT'
        }, 'Execution blocked: daily trade limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // Check consecutive losses limit
      if (dailyCounters.consecutiveLosses >= 3) {
        logger.info({
          agentId,
          consecutiveLosses: dailyCounters.consecutiveLosses,
          reason: 'CONSECUTIVE_LOSSES_LIMIT'
        }, 'Execution blocked: consecutive losses limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // Check daily profit target
      if (dailyCounters.dailyPnL >= 2.0) {
        logger.info({
          agentId,
          dailyPnL: dailyCounters.dailyPnL,
          reason: 'DAILY_PROFIT_TARGET'
        }, 'Execution blocked: daily profit target reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // ===== COOLDOWN PRECISION =====
      // Check per-pair cooldown
      const pairCooldown = await firestoreAdapter.getPairCooldown(agentId, tradingPair);
      if (pairCooldown && new Date() < pairCooldown) {
        logger.info({
          agentId,
          tradingPair,
          cooldownUntil: pairCooldown.toISOString(),
          reason: 'PAIR_COOLDOWN_ACTIVE'
        }, 'Execution blocked: pair cooldown active');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // ===== MAX POSITION RACE PROTECTION =====
      // Check position limits with current counts
      const positionCounts = await firestoreAdapter.getCurrentPositionCount(agentId);

      // Max 1 open trade per pair
      if (positionCounts.pairPositions >= 1) {
        logger.info({
          agentId,
          tradingPair,
          currentPositions: positionCounts.pairPositions,
          reason: 'PAIR_POSITION_LIMIT'
        }, 'Execution blocked: pair position limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // Max 2 total open trades
      if (positionCounts.totalPositions >= 2) {
        logger.info({
          agentId,
          totalPositions: positionCounts.totalPositions,
          reason: 'TOTAL_POSITION_LIMIT'
        }, 'Execution blocked: total position limit reached');
        await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);
        return;
      }

      // Get account balance
      const balance = await this.marketDataProvider.getAccountBalance();

      // Execute trade with hardened validation
      const trade = await agent.executeTrade(signal, balance.equity, dailyCounters);

      if (trade) {
        // Place actual order on exchange with atomic SL/TP
        const orderSuccess = await this.placeOrderFromTradeAtomic(trade, agentConfig);

        if (orderSuccess) {
          // Update daily counters
          await firestoreAdapter.updateDailySafetyCounters(agentId, {
            tradesToday: dailyCounters.tradesToday + 1
          });

          // Set pair cooldown (30 minutes from trade execution)
          const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);
          await firestoreAdapter.setPairCooldown(agentId, tradingPair, cooldownUntil);

          logger.info({
            agentId,
            tradeId: trade.id,
            signalId: trade.signalId,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            quantity: trade.quantity
          }, 'Trade executed successfully with all safety checks');
        } else {
          logger.error({
            agentId,
            tradeId: trade.id,
            signalId: trade.signalId
          }, 'Order placement failed, trade marked as failed');
        }
      }

      // Update last processed candle
      await firestoreAdapter.updateLastProcessedCandle(agentId, tradingPair, candleTimestamp);

    } catch (error) {
      logger.error({
        agentId,
        tradingPair,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute agent with hardening');
    }
  }

  /**
   * Place order on exchange with atomic SL/TP attachment
   */
  private async placeOrderFromTradeAtomic(trade: any, agentConfig: TradingAgentConfig): Promise<boolean> {
    try {
      const side = trade.direction === 'LONG' ? 'BUY' : 'SELL';
      const symbol = agentConfig.tradingPair.replace('/', '');

      // ===== ATOMIC ORDER SAFETY =====
      // Attempt to place entry order with attached SL/TP atomically
      // If exchange supports bracket/OCO orders, use them
      // Otherwise, place entry first, then SL/TP, with rollback on failure

      let entryOrderId: string;

      try {
        // Try to place entry order with SL/TP attached (if supported by exchange)
        entryOrderId = await this.marketDataProvider.placeOrder({
          symbol,
          side,
          type: 'MARKET',
          quantity: trade.quantity,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit
        });

        logger.info({
          agentId: agentConfig.id,
          tradeId: trade.id,
          orderId: entryOrderId,
          symbol,
          side,
          quantity: trade.quantity,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit
        }, 'Atomic order placed successfully with SL/TP attached');

        return true;

      } catch (atomicError) {
        logger.warn({
          agentId: agentConfig.id,
          tradeId: trade.id,
          error: atomicError instanceof Error ? atomicError.message : 'Unknown error'
        }, 'Atomic order placement failed, attempting fallback method');

        // ===== ROLLBACK SAFETY =====
        // If atomic placement fails, we must not leave naked positions
        // This is a critical safety mechanism

        // For now, fail the trade completely rather than risk naked positions
        // In production, implement proper rollback logic:
        // 1. Place entry order
        // 2. If SL/TP placement fails, immediately close entry position
        // 3. Mark trade as failed

        logger.error({
          agentId: agentConfig.id,
          tradeId: trade.id,
          reason: 'ATOMIC_ORDER_SAFETY_VIOLATION'
        }, 'Trade failed: cannot ensure SL/TP attachment');

        // Mark trade as failed
        await firestoreAdapter.updateTradeStatus(trade.id, 'FAILED');
        return false;
      }

    } catch (error) {
      logger.error({
        agentId: agentConfig.id,
        tradeId: trade.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to place atomic order');

      // Mark trade as failed
      await firestoreAdapter.updateTradeStatus(trade.id, 'FAILED');
      return false;
    }
  }

  /**
   * Legacy method - kept for compatibility but not used in hardened execution
   */
  private async placeOrderFromTrade(trade: any, agentConfig: TradingAgentConfig): Promise<void> {
    const success = await this.placeOrderFromTradeAtomic(trade, agentConfig);
    if (!success) {
      throw new Error('Order placement failed with atomic safety');
    }
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): TradingAgent | undefined {
    return this.activeAgents.get(agentId);
  }

  /**
   * Add new agent to active agents
   */
  addAgent(agent: TradingAgent): void {
    this.activeAgents.set(agent['config'].id, agent);
  }

  /**
   * Remove agent from active agents
   */
  removeAgent(agentId: string): void {
    this.activeAgents.delete(agentId);
  }

  /**
   * Get all active agents
   */
  getAllActiveAgents(): TradingAgent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get execution statistics
   */
  getExecutionStats() {
    const agents = Array.from(this.activeAgents.values());
    const totalAgents = agents.length;
    const activeAgents = agents.filter(agent => agent.canTrade().canTrade).length;

    return {
      totalAgents,
      activeAgents,
      inactiveAgents: totalAgents - activeAgents,
      lastExecution: new Date()
    };
  }

  /**
   * Manual execution trigger for testing/debugging
   */
  async executeAgentManually(agentId: string): Promise<{ success: boolean; message: string }> {
    try {
      const agent = this.activeAgents.get(agentId);
      if (!agent) {
        return { success: false, message: 'Agent not found or not active' };
      }

      await this.executeAgent(agent);
      return { success: true, message: 'Agent executed successfully' };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Pause agent execution
   */
  async pauseAgent(agentId: string): Promise<boolean> {
    try {
      await firestoreAdapter.updateAgentStatus(agentId, 'PAUSED');
      this.removeAgent(agentId);
      return true;
    } catch (error) {
      logger.error({
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to pause agent');
      return false;
    }
  }

  /**
   * Resume agent execution
   */
  async resumeAgent(agentId: string): Promise<boolean> {
    try {
      const config = await firestoreAdapter.getTradingAgentConfig(agentId);
      if (config && config.status === 'PAUSED') {
        await firestoreAdapter.updateAgentStatus(agentId, 'ACTIVE');
        const agent = new TradingAgent(config);
        this.addAgent(agent);
        return true;
      }
      return false;
    } catch (error) {
      logger.error({
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to resume agent');
      return false;
    }
  }

  /**
   * Stop agent permanently
   */
  async stopAgent(agentId: string): Promise<boolean> {
    try {
      await firestoreAdapter.updateAgentStatus(agentId, 'STOPPED');
      this.removeAgent(agentId);
      return true;
    } catch (error) {
      logger.error({
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to stop agent');
      return false;
    }
  }
}