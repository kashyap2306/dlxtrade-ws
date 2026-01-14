import { logger } from '../utils/logger';
import { TradingAgent, TradingAgentConfig, TradingSignal } from './tradingAgent';
import { VWAPStrategy, VWAPStrategyConfig } from './vwapStrategy';
import { TechnicalIndicators, CandleData, IndicatorValues } from './technicalIndicators';
import { firestoreAdapter } from './firestoreAdapter';
import { TradingAgentMarketProvider } from './tradingAgentMarketProvider';
import { ExchangeCredentials } from './exchangeConnector';
import { CrowdConsensusService } from './crowdConsensusService';
import { AgentApprovalService } from './agentApprovalService';
import { vwapRuntimeService } from './vwapRuntimeService';

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
  private activeVWAPStrategies: Map<string, VWAPStrategy> = new Map();

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

      // Load VWAP Strategy agents
      await this.loadActiveVWAPStrategies();
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to load active trading agents');
    }
  }

  /**
   * Load and activate approved VWAP Strategy agents
   */
  async loadActiveVWAPStrategies(): Promise<void> {
    try {
      // Get all users with VWAP_STRATEGY access
      const usersWithVWAPAccess = await AgentApprovalService.getUsersWithAgentAccess('VWAP_STRATEGY');

      this.activeVWAPStrategies.clear();

      for (const userId of usersWithVWAPAccess) {
        // For now, create a basic VWAP strategy config
        // In production, this would be stored in user preferences or agent settings
        const vwapConfig: VWAPStrategyConfig = {
          userId,
          agentId: `vwap_${userId}`,
          tradingPair: 'BTC/USDT', // Default, could be configurable
          marketType: 'spot',
          exchange: 'binance', // Default, could be configurable
          riskPerTrade: 0.01, // 1%
          apiKey: '', // Would need to get from user's exchange settings
          apiSecret: '',
          dryRun: true // Safe default
        };

        // Only create if user has exchange credentials
        // For now, we'll skip if no credentials
        try {
          const strategy = new VWAPStrategy(vwapConfig);

          // Store the strategy instance (runtime state determines if it executes)
          this.activeVWAPStrategies.set(userId, strategy);

          // Check if this strategy should be running based on runtime state
          const isRunning = vwapRuntimeService.isAgentRunning(userId);
          if (isRunning) {
            await strategy.start();
          }

          logger.info({
            userId,
            agentId: vwapConfig.agentId,
            strategyType: 'VWAP_MEAN_REVERSION',
            isRunning
          }, 'VWAP Strategy agent loaded');
        } catch (error) {
          logger.warn({
            userId,
            error: error instanceof Error ? error.message : 'Unknown error'
          }, 'Failed to create VWAP Strategy agent');
        }
      }

      logger.info({
        vwapStrategyCount: this.activeVWAPStrategies.size
      }, 'VWAP Strategy agents loaded');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to load VWAP Strategy agents');
    }
  }

  /**
   * Execute trading logic for all active agents
   * This method is called by the scheduler every 5 minutes
   */
  async executeAllAgents(): Promise<void> {
    // Execute regular trading agents
    const tradingAgentPromises = Array.from(this.activeAgents.values()).map(agent =>
      this.executeAgent(agent)
    );

    // Execute VWAP strategy agents that are currently running according to runtime service
    const vwapStrategyPromises = Array.from(this.activeVWAPStrategies.entries())
      .filter(([userId, strategy]) => vwapRuntimeService.isAgentRunning(userId))
      .map(([userId, strategy]) => this.executeVWAPStrategy(strategy));

    const allPromises = [...tradingAgentPromises, ...vwapStrategyPromises];
    await Promise.allSettled(allPromises);
  }

  /**
   * Execute trading logic for a single agent with full hardening and diagnostics
   */
  private async executeAgent(agent: TradingAgent): Promise<void> {
    const agentId = agent['config'].id;
    const agentConfig = agent['config'];
    const tradingPair = agentConfig.tradingPair;

    // Initialize diagnostics
    const diagnostics: any = {
      timestamp: new Date(),
      agentId,
      tradingPair,
      sessionCheck: {},
      candleCheck: {},
      indicators: {},
      supportResistance: { calculated: false },
      signal: { direction: null, meetsConditions: false },
      riskAnalysis: {},
      srValidation: {},
      decision: { action: 'SKIP', reason: 'Execution started' }
    };

    try {
      // Create agent-specific market provider with exchange credentials
      const exchangeCredentials: ExchangeCredentials = {
        apiKey: agentConfig.apiKey,
        secret: agentConfig.apiSecret,
        passphrase: agentConfig.passphrase,
        testnet: false // Always production for live trading
      };

      const marketProvider = new TradingAgentMarketProvider(exchangeCredentials, agentConfig.exchange);

      // ===== SESSION-BASED TRADING (EXCHANGE SERVER TIME) =====
      // Only trade during London (8:00-16:59 UTC) or New York (14:30-21:29 UTC) sessions
      const now = new Date();
      const utcHour = now.getUTCHours();
      const utcMinute = now.getUTCMinutes();

      // London session: 8:00-16:59 UTC
      const isLondonSession = utcHour >= 8 && utcHour < 17;

      // New York session: 14:30-21:29 UTC
      const isNYSession = (utcHour === 14 && utcMinute >= 30) ||
                         (utcHour >= 15 && utcHour < 21) ||
                         (utcHour === 21 && utcMinute < 30);

      const isValidSession = isLondonSession || isNYSession;

      // Update diagnostics with session check
      diagnostics.sessionCheck = {
        isValidSession,
        currentTime: `${utcHour}:${utcMinute.toString().padStart(2, '0')} UTC`,
        sessionType: isLondonSession ? 'London' : isNYSession ? 'NewYork' : undefined,
        reason: isValidSession ? 'Valid trading session' : 'Outside trading hours'
      };

      if (!isValidSession) {
        diagnostics.decision = { action: 'SKIP', reason: 'Outside trading sessions' };
        await agent.storeDiagnostics(diagnostics);
        logger.info({
          agentId,
          currentTime: `${now.getUTCHours()}:${now.getUTCMinutes().toString().padStart(2, '0')} UTC`,
          sessionCheck: 'OUTSIDE_TRADING_HOURS'
        }, 'Execution blocked: outside trading sessions');
        return;
      }

      // Get COIN-M market data for the agent's trading pair
      const symbol = tradingPair.replace('/', '').toUpperCase();
      const candles = await marketProvider.getCandles(
        symbol,
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

      // Update diagnostics with candle info
      diagnostics.candleCheck = {
        isClosed: true, // Assuming we only get closed candles
        candleTimestamp,
        price: latestCandle.close
      };

      // ===== CLOSED-CANDLE DETERMINISM =====
      // Check if this candle was already processed
      const lastProcessedCandle = await firestoreAdapter.getLastProcessedCandle(agentId, tradingPair);
      if (lastProcessedCandle && candleTimestamp.getTime() === lastProcessedCandle.getTime()) {
        diagnostics.decision = { action: 'SKIP', reason: 'Candle already processed' };
        await agent.storeDiagnostics(diagnostics);
        logger.info({
          agentId,
          candleTimestamp: candleTimestamp.toISOString(),
          reason: 'CANDLE_ALREADY_PROCESSED'
        }, 'Execution blocked: candle already processed');
        return;
      }

      // Calculate indicators
      const indicators = TechnicalIndicators.calculateAllIndicators(candles);

      // Update diagnostics with indicators
      diagnostics.indicators = indicators;

      // Validate indicators
      if (!TechnicalIndicators.validateIndicators(indicators)) {
        diagnostics.decision = { action: 'SKIP', reason: 'Invalid indicators calculated' };
        await agent.storeDiagnostics(diagnostics);
        logger.error({
          agentId,
          indicators
        }, 'Invalid indicators calculated');
        return;
      }

      // Generate trading signal with S/R validation
      const signal = agent.generateSignal(latestCandle, {
        rsi: indicators.rsi,
        ema50: indicators.ema50,
        bbUpper: indicators.bbUpper,
        bbLower: indicators.bbLower,
        atr: indicators.atr
      }, candles);

      if (!signal) {
        diagnostics.decision = diagnostics.decision || { action: 'SKIP', reason: 'No trading signal generated' };
        await agent.storeDiagnostics(diagnostics);

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
        diagnostics.decision = { action: 'SKIP', reason: `Daily trade limit reached: ${dailyCounters.tradesToday}/${agentConfig.maxTradesPerDay}` };
        await agent.storeDiagnostics(diagnostics);
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
        diagnostics.decision = { action: 'SKIP', reason: `Consecutive losses limit: ${dailyCounters.consecutiveLosses}/3` };
        await agent.storeDiagnostics(diagnostics);
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
        diagnostics.decision = { action: 'SKIP', reason: `Daily profit target reached: ${dailyCounters.dailyPnL.toFixed(2)}R` };
        await agent.storeDiagnostics(diagnostics);
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

      // Get COIN-M account balance
      const balance = await marketProvider.getAccountBalance();

      // Update diagnostics with balance info
      diagnostics.riskAnalysis = {
        accountBalance: balance.equity,
        riskPercent: agentConfig.riskPerTrade,
        positionSize: 0, // Will be calculated below
        maxPositionSize: 0, // Will be calculated below
        availableMargin: true
      };

      // Execute trade with hardened validation
      const trade = await agent.executeTrade(signal, balance.equity, dailyCounters);

      if (trade) {
        // Update diagnostics with risk analysis
        diagnostics.riskAnalysis.positionSize = trade.quantity;
        diagnostics.riskAnalysis.maxPositionSize = Math.floor((balance.equity * agentConfig.riskPerTrade / 100) / (trade.entryPrice / agentConfig.leverage));

        // Place actual order on exchange with atomic SL/TP
        const orderSuccess = await this.placeOrderFromTradeAtomic(trade, agentConfig, marketProvider, diagnostics, agent);

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
   * Execute Crowd Consensus Copy Trading agent
   */
  private async executeCrowdConsensusAgent(): Promise<void> {
    try {
      // Check if Crowd Consensus is enabled (would be configurable)
      // For now, always run if agent has access

      // Get daily trade count
      const dailyTradeCount = await CrowdConsensusService.getDailyTradeCount('crowd-consensus-user');

      if (dailyTradeCount >= 6) {
        logger.info('Crowd Consensus daily trade limit reached');
        return;
      }

      // Monitor master trader positions
      const masterPositions = await CrowdConsensusService.monitorMasterTraders();

      // Detect consensus signals
      const consensusSignals = CrowdConsensusService.detectConsensus(masterPositions);

      if (consensusSignals.length === 0) {
        logger.debug('No consensus signals detected');
        return;
      }

      // Execute trades for each consensus signal
      for (const signal of consensusSignals) {
        try {
          // Check if we already have a position for this pair
          const hasPosition = await (this.marketDataProvider as any).hasCoinMPosition(signal.pair);
          if (hasPosition) {
            logger.info({ pair: signal.pair }, 'Position already exists - skipping consensus trade');
            continue;
          }

          // Execute consensus trade
          const result = await CrowdConsensusService.executeConsensusTrade(
            signal,
            'crowd-consensus-user'
          );

          if (result.success && result.trade) {
            // Save trade record
            await CrowdConsensusService.saveConsensusTrade('crowd-consensus-user', result.trade);
            logger.info({ tradeId: result.trade.id, pair: signal.pair }, 'Crowd Consensus trade executed');
          }
        } catch (error: any) {
          logger.error({
            error: error.message,
            pair: signal.pair,
            direction: signal.direction
          }, 'Failed to execute consensus trade');
        }
      }

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to execute Crowd Consensus agent');
    }
  }

  /**
   * Place order on exchange with atomic SL/TP attachment
   */
  /*
  private async placeOrderFromTradeAtomic(trade: any, agentConfig: TradingAgentConfig, marketProvider: TradingAgentMarketProvider, diagnostics: any, agent: TradingAgent): Promise<boolean> {
    try {
      const side = trade.direction === 'LONG' ? 'BUY' : 'SELL';
      const symbol = agentConfig.tradingPair.replace('/', '').toUpperCase();

      // Check if we already have a position for this symbol (COIN-M Futures)
      const hasExistingPosition = await (marketProvider as any).hasCoinMPosition(symbol);
      if (hasExistingPosition) {
        diagnostics.execution = { success: false, error: 'Position already exists for symbol' };
        await agent.storeDiagnostics(diagnostics);
        logger.info({
          agentId: agentConfig.id,
          tradeId: trade.id,
          symbol,
          reason: 'EXISTING_POSITION'
        }, 'Skipping trade: position already exists for symbol');
        return false;
      }

      // Get account balance for risk calculation
      const balance = await marketProvider.getAccountBalance();

      // Calculate position size based on configurable risk per trade (4-5%)
      const riskAmount = balance.totalBalance * (agentConfig.riskPerTrade / 100);
      const riskPerContract = trade.entryPrice * (1 / agentConfig.leverage); // Value per contract
      const maxContracts = Math.floor(riskAmount / riskPerContract);
      const quantity = Math.min(maxContracts, trade.quantity);

      if (quantity < 0.001) { // Minimum order size check
        diagnostics.execution = { success: false, error: `Insufficient risk budget: need ${riskPerContract.toFixed(4)} per contract, have ${(riskAmount / trade.entryPrice * agentConfig.leverage).toFixed(4)}` };
        await agent.storeDiagnostics(diagnostics);
        logger.warn({
          agentId: agentConfig.id,
          tradeId: trade.id,
          riskAmount,
          riskPerContract,
          maxContracts,
          quantity,
          reason: 'INSUFFICIENT_RISK_BUDGET'
        }, 'Skipping trade: insufficient risk budget for minimum position size');
        return false;
      }

      // ===== BITGET COIN-M BRACKET ORDER =====
      // Place atomic bracket order: entry + SL + TP together
      const orderResult = await (marketProvider as any).placeCoinMBracketOrder({
        symbol,
        side,
        quantity,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        leverage: agentConfig.leverage
      });

      // Update diagnostics with successful execution
      diagnostics.execution = {
        success: true,
        orderId: orderResult.orderId
      };
      await agent.storeDiagnostics(diagnostics);

      logger.info({
        agentId: agentConfig.id,
        tradeId: trade.id,
        orderId: orderResult.orderId,
        symbol,
        side,
        quantity,
        entryPrice: trade.entryPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        leverage: agentConfig.leverage,
        riskAmount,
        balance: balance.totalBalance
      }, 'COIN-M bracket order placed successfully');

      return true;

    } catch (error) {
      // Update diagnostics with failed execution
      diagnostics.execution = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      await agent.storeDiagnostics(diagnostics);

      logger.error({
        agentId: agentConfig.id,
        tradeId: trade.id,
        symbol: agentConfig.tradingPair.replace('/', ''),
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 'Failed to place COIN-M bracket order');

      return false;
  }
  */

  private async placeOrderFromTradeAtomic(trade: any, agentConfig: TradingAgentConfig, marketProvider: TradingAgentMarketProvider, diagnostics: any, agent: TradingAgent): Promise<boolean> {
    return false;
  }

  /**
   * Get agent by ID
   */
  public getAgent(agentId: string): TradingAgent | undefined {
    return this.activeAgents.get(agentId);
  }

  /**
   * Add new agent to active agents
   */
  public addAgent(agent: TradingAgent): void {
    this.activeAgents.set(agent['config'].id, agent);
  }

  /**
   * Remove agent from active agents
   */
  public removeAgent(agentId: string): void {
    this.activeAgents.delete(agentId);
  }

  /**
   * Get all active agents
   */
  public getAllActiveAgents(): TradingAgent[] {
    return Array.from(this.activeAgents.values());
  }

  /**
   * Get execution statistics
   */
  public getExecutionStats() {
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
  public async executeAgentManually(agentId: string): Promise<{ success: boolean; message: string }> {
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
  public async pauseAgent(agentId: string): Promise<boolean> {
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
  public async resumeAgent(agentId: string): Promise<boolean> {
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
  public async stopAgent(agentId: string): Promise<boolean> {
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

  /**
   * Execute VWAP strategy for a single agent
   */
  private async executeVWAPStrategy(strategy: any): Promise<void> {
    const agentId = strategy.config?.agentId || 'unknown';
    const userId = strategy.config?.userId || 'unknown';

    try {
      // Execute VWAP strategy logic
      const diagnostics = await strategy.execute(this.marketDataProvider);

      // Update runtime heartbeat
      const { vwapRuntimeService } = await import('./vwapRuntimeService');
      vwapRuntimeService.updateHeartbeat(userId);

      logger.info({
        agentId,
        userId,
        action: diagnostics.decision.action,
        reason: diagnostics.decision.reason
      }, 'VWAP Strategy execution completed');

    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : 'Unknown error',
        agentId,
        userId
      }, 'VWAP Strategy execution error');
    }
  }
}